import csv
import io
import secrets
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from backend.app.db import SessionLocal
from backend.app.models import (
    Auction,
    AuctionPlayer,
    AuctionPurchase,
    AuctionStatus,
    AuctionTeam,
    AuctionType,
    Player,
)
from backend.app.services.autofill_evaluations import compute_autofill_evaluations
from backend.app.services.module_predictions import compute_module_predictions

router = APIRouter(prefix="/auctions", tags=["auctions"])

Status = Literal["under", "ok", "over"]

# Mantra role marker for goalkeepers.
GK_ROLE = "Por"

# A full evaluations CSV is a few tens of KB. Cap upload at 5 MB so a
# rogue multipart body cannot fill the spooled temp file.
MAX_CSV_BYTES = 5 * 1024 * 1024


class AuctionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str | None = None
    type: AuctionType = Field(default=AuctionType.CALL)
    number_of_auctioners: int = Field(ge=1)
    min_team_size: int = Field(ge=1)
    max_team_size: int = Field(ge=1)
    credits_per_team: int = Field(ge=1)
    number_of_goalkeepers: int = Field(ge=0)
    teams: list[str] = Field(default_factory=list)


class AuctionPatch(BaseModel):
    """Partial update. Any of these may be present; absent keys are left alone."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    status: AuctionStatus | None = None
    type: AuctionType | None = None
    number_of_auctioners: int | None = Field(default=None, ge=1)
    min_team_size: int | None = Field(default=None, ge=1)
    max_team_size: int | None = Field(default=None, ge=1)
    credits_per_team: int | None = Field(default=None, ge=1)
    number_of_goalkeepers: int | None = Field(default=None, ge=0)


class TeamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    team_name: str = Field(min_length=1)


class EvaluationPatch(BaseModel):
    """Single-field patch. Explicit `null` clears; absent key is rejected."""

    model_config = ConfigDict(extra="forbid")

    evaluation: int | None = Field(default=None, ge=1)


# Fields a PATCH cannot touch when the auction has moved past INITIAL.
LOCKED_FIELDS_OUTSIDE_INITIAL = {
    "name",
    "description",
    "type",
    "number_of_auctioners",
    "min_team_size",
    "max_team_size",
    "credits_per_team",
    "number_of_goalkeepers",
}


def _classify_range(value: int, minimum: int, maximum: int) -> Status:
    if value < minimum:
        return "under"
    if value > maximum:
        return "over"
    return "ok"


def _classify_target(value: int, target: int) -> Status:
    if target == 0:
        return "ok"
    if value < target:
        return "under"
    if value > target:
        return "over"
    return "ok"


def _pct(value: int, base: int) -> float:
    return round((value / base) * 100, 2) if base > 0 else 0.0


def _serialize_team(t: AuctionTeam) -> dict:
    return {"id": t.id, "team_name": t.team_name}


def _serialize_auction(a: Auction, team_count: int, teams: list[AuctionTeam] | None = None) -> dict:
    body = {
        "id": a.id,
        "name": a.name,
        "description": a.description,
        "status": a.status.value,
        "type": a.type.value,
        "number_of_auctioners": a.number_of_auctioners,
        "min_team_size": a.min_team_size,
        "max_team_size": a.max_team_size,
        "credits_per_team": a.credits_per_team,
        "number_of_goalkeepers": a.number_of_goalkeepers,
        "number_of_teams": team_count,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    if teams is not None:
        body["teams"] = [_serialize_team(t) for t in teams]
    return body


@router.post("")
def create_auction(body: AuctionCreate) -> dict:
    if body.max_team_size < body.min_team_size:
        raise HTTPException(
            status_code=400,
            detail=f"max_team_size ({body.max_team_size}) must be >= min_team_size ({body.min_team_size})",
        )

    if len(body.teams) > body.number_of_auctioners:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{len(body.teams)} teams provided but number_of_auctioners is "
                f"{body.number_of_auctioners}; cannot exceed the auctioner cap"
            ),
        )

    # Reject duplicate names in the same payload before hitting the DB.
    seen: set[str] = set()
    for name in body.teams:
        if name in seen:
            raise HTTPException(status_code=400, detail=f"duplicate team name: {name}")
        seen.add(name)

    with SessionLocal() as session:
        with session.begin():
            auction = Auction(
                name=body.name,
                description=body.description,
                type=body.type,
                number_of_auctioners=body.number_of_auctioners,
                min_team_size=body.min_team_size,
                max_team_size=body.max_team_size,
                credits_per_team=body.credits_per_team,
                number_of_goalkeepers=body.number_of_goalkeepers,
            )
            session.add(auction)
            session.flush()

            teams = [
                AuctionTeam(auction_id=auction.id, team_name=n) for n in body.teams
            ]
            for t in teams:
                session.add(t)
            session.flush()

            return _serialize_auction(auction, len(teams), teams)


@router.get("")
def list_auctions() -> list[dict]:
    with SessionLocal() as session:
        team_counts = (
            select(
                AuctionTeam.auction_id,
                func.count(AuctionTeam.id).label("team_count"),
            )
            .group_by(AuctionTeam.auction_id)
            .subquery()
        )
        stmt = (
            select(Auction, func.coalesce(team_counts.c.team_count, 0))
            .outerjoin(team_counts, team_counts.c.auction_id == Auction.id)
            .order_by(Auction.created_at.desc(), Auction.id.desc())
        )
        return [_serialize_auction(a, int(count)) for a, count in session.execute(stmt).all()]


def _load_auction_with_teams(session, auction_id: int) -> tuple[Auction, list[AuctionTeam]]:
    auction = session.get(Auction, auction_id)
    if auction is None:
        raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
    teams = list(
        session.execute(
            select(AuctionTeam)
            .where(AuctionTeam.auction_id == auction_id)
            .order_by(AuctionTeam.id.asc())
        )
        .scalars()
    )
    return auction, teams


@router.get("/{auction_id}")
def get_auction(auction_id: int) -> dict:
    with SessionLocal() as session:
        auction, teams = _load_auction_with_teams(session, auction_id)
        return _serialize_auction(auction, len(teams), teams)


@router.patch("/{auction_id}")
def patch_auction(auction_id: int, patch: AuctionPatch) -> dict:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")

    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id)
            if auction is None:
                raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")

            locked = LOCKED_FIELDS_OUTSIDE_INITIAL & fields.keys()
            if locked and auction.status != AuctionStatus.INITIAL:
                raise HTTPException(
                    status_code=409,
                    detail=f"auction is {auction.status.value}; cannot edit {sorted(locked)}",
                )

            new_min = fields.get("min_team_size", auction.min_team_size)
            new_max = fields.get("max_team_size", auction.max_team_size)
            if new_max < new_min:
                raise HTTPException(
                    status_code=400,
                    detail=f"max_team_size ({new_max}) must be >= min_team_size ({new_min})",
                )

            new_auctioners = fields.get(
                "number_of_auctioners", auction.number_of_auctioners
            )
            if new_auctioners != auction.number_of_auctioners:
                current_team_count = int(
                    session.execute(
                        select(func.count(AuctionTeam.id)).where(
                            AuctionTeam.auction_id == auction_id
                        )
                    ).scalar_one()
                )
                if current_team_count > new_auctioners:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"cannot set number_of_auctioners to {new_auctioners}: "
                            f"auction already has {current_team_count} teams"
                        ),
                    )

            # Gate the INITIAL → IN_PROGRESS transition on team count
            # matching number_of_auctioners AND a complete evaluation.
            new_status = fields.get("status")
            if (
                new_status == AuctionStatus.IN_PROGRESS
                and auction.status == AuctionStatus.INITIAL
            ):
                team_count = int(
                    session.execute(
                        select(func.count(AuctionTeam.id)).where(
                            AuctionTeam.auction_id == auction_id
                        )
                    ).scalar_one()
                )
                target_teams = fields.get(
                    "number_of_auctioners", auction.number_of_auctioners
                )
                if team_count != target_teams:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"cannot start auction: {team_count} teams created, "
                            f"expected {target_teams}"
                        ),
                    )

                snapshot = _compute_evaluation_status(session, auction)
                blockers = [
                    group for group, info in snapshot.items() if info["status"] != "ok"
                ]
                if blockers:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "cannot start auction: "
                            + ", ".join(f"{g} is {snapshot[g]['status']}" for g in blockers)
                        ),
                    )

                # Freeze the player set into auction_players: every player
                # not yet snapshotted for this auction gets a row with the
                # current `players` snapshot and evaluation=0. Existing rows
                # are left alone — their snapshots stay as-set, their
                # evaluation stays as the user set it.
                session.execute(
                    pg_insert(AuctionPlayer)
                    .from_select(
                        [
                            "auction_id",
                            "player_id",
                            "name",
                            "team",
                            "mantra_roles",
                            "fanta_evaluation",
                            "fanta_market_value",
                            "evaluation",
                        ],
                        select(
                            literal(auction_id),
                            Player.id,
                            Player.name,
                            Player.team,
                            Player.mantra_roles,
                            Player.fanta_evaluation,
                            Player.fanta_market_value,
                            literal(0),
                        ),
                    )
                    .on_conflict_do_nothing(
                        index_elements=[
                            AuctionPlayer.auction_id,
                            AuctionPlayer.player_id,
                        ],
                    )
                )

            # Gate IN_PROGRESS → TERMINATED on every team meeting the
            # roster minimums (min_team_size players, of which at least
            # number_of_goalkeepers are goalkeepers).
            if (
                new_status == AuctionStatus.TERMINATED
                and auction.status == AuctionStatus.IN_PROGRESS
            ):
                blockers = _compute_terminate_blockers(session, auction)
                if blockers:
                    raise HTTPException(
                        status_code=409,
                        detail="cannot terminate auction: " + " | ".join(blockers),
                    )

            for k, v in fields.items():
                setattr(auction, k, v)
            session.flush()

            teams = list(
                session.execute(
                    select(AuctionTeam)
                    .where(AuctionTeam.auction_id == auction_id)
                    .order_by(AuctionTeam.id.asc())
                )
                .scalars()
            )
            return _serialize_auction(auction, len(teams), teams)


@router.delete("/{auction_id}")
def delete_auction(auction_id: int) -> dict:
    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id)
            if auction is None:
                raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
            session.delete(auction)
    return {"deleted": auction_id}


@router.post("/{auction_id}/teams")
def add_team(auction_id: int, body: TeamCreate) -> dict:
    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id)
            if auction is None:
                raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
            if auction.status != AuctionStatus.INITIAL:
                raise HTTPException(
                    status_code=409,
                    detail=f"auction is {auction.status.value}; teams can only be edited while INITIAL",
                )
            current_team_count = int(
                session.execute(
                    select(func.count(AuctionTeam.id)).where(
                        AuctionTeam.auction_id == auction_id
                    )
                ).scalar_one()
            )
            if current_team_count >= auction.number_of_auctioners:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"auction already has {current_team_count} teams; "
                        f"number_of_auctioners is {auction.number_of_auctioners}"
                    ),
                )
            team = AuctionTeam(auction_id=auction_id, team_name=body.team_name)
            session.add(team)
            try:
                session.flush()
            except IntegrityError as exc:
                raise HTTPException(
                    status_code=409,
                    detail=f"team name {body.team_name!r} already exists for this auction",
                ) from exc
            return _serialize_team(team)


@router.delete("/{auction_id}/teams/{team_id}")
def delete_team(auction_id: int, team_id: int) -> dict:
    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id)
            if auction is None:
                raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
            if auction.status != AuctionStatus.INITIAL:
                raise HTTPException(
                    status_code=409,
                    detail=f"auction is {auction.status.value}; teams can only be edited while INITIAL",
                )
            team = session.get(AuctionTeam, team_id)
            if team is None or team.auction_id != auction_id:
                raise HTTPException(status_code=404, detail=f"team {team_id} not found in auction {auction_id}")
            session.delete(team)
    return {"deleted": team_id}


@router.patch("/{auction_id}/evaluations/{player_id}")
def patch_evaluation(auction_id: int, player_id: int, patch: EvaluationPatch) -> dict:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")

    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id)
            if auction is None:
                raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
            if auction.status != AuctionStatus.INITIAL:
                raise HTTPException(
                    status_code=409,
                    detail=f"auction is {auction.status.value}; evaluations can only be edited while INITIAL",
                )
            player = session.get(Player, player_id)
            if player is None:
                raise HTTPException(status_code=404, detail=f"player {player_id} not found")

            # Snapshot the current player columns on first insert; on
            # conflict only refresh the evaluation. The frozen snapshot
            # stays put for the lifetime of the auction.
            stmt = pg_insert(AuctionPlayer).values(
                auction_id=auction_id,
                player_id=player_id,
                name=player.name,
                team=player.team,
                mantra_roles=player.mantra_roles,
                fanta_evaluation=player.fanta_evaluation,
                fanta_market_value=player.fanta_market_value,
                **fields,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[AuctionPlayer.auction_id, AuctionPlayer.player_id],
                set_={**fields, "updated_at": func.now()},
            )
            session.execute(stmt)

            ap = session.execute(
                select(AuctionPlayer).where(
                    AuctionPlayer.auction_id == auction_id,
                    AuctionPlayer.player_id == player_id,
                )
            ).scalar_one()
            return {
                "auction_id": ap.auction_id,
                "player_id": ap.player_id,
                "evaluation": ap.evaluation,
            }


def _compute_evaluation_status(session, auction: Auction) -> dict:
    """Build the credits/players/goalkeepers completeness snapshot.

    Shared between the public GET /evaluations/status endpoint and the
    INITIAL → IN_PROGRESS transition gate in patch_auction.
    """
    stmt = (
        select(
            func.count(AuctionPlayer.evaluation).label("evaluated_count"),
            func.coalesce(func.sum(AuctionPlayer.evaluation), 0).label("stored_sum"),
            func.count(AuctionPlayer.evaluation)
            .filter(AuctionPlayer.mantra_roles.any(GK_ROLE))
            .label("goalkeepers_count"),
        )
        .where(
            AuctionPlayer.auction_id == auction.id,
            AuctionPlayer.evaluation.is_not(None),
            AuctionPlayer.evaluation > 0,
        )
    )
    evaluated_count, stored_sum, goalkeepers_count = session.execute(stmt).one()

    auctioners = auction.number_of_auctioners
    credits_per_team = auction.credits_per_team
    credit_total = auctioners * credits_per_team
    min_players = auctioners * auction.min_team_size
    max_players = auctioners * auction.max_team_size
    gk_target = auctioners * auction.number_of_goalkeepers

    # Stored evaluations are in 1000-credit base; rescale to the auction budget.
    credits_used = int((int(stored_sum) * credits_per_team) // 1000)
    evaluated_count = int(evaluated_count)
    goalkeepers_count = int(goalkeepers_count)

    return {
        "credits": {
            "used": credits_used,
            "total": credit_total,
            "percentage": _pct(credits_used, credit_total),
            "status": _classify_target(credits_used, credit_total),
        },
        "players": {
            "evaluated": evaluated_count,
            "min": min_players,
            "max": max_players,
            "percentage": _pct(evaluated_count, min_players),
            "status": _classify_range(evaluated_count, min_players, max_players),
        },
        "goalkeepers": {
            "evaluated": goalkeepers_count,
            "target": gk_target,
            "percentage": _pct(goalkeepers_count, gk_target),
            "status": _classify_target(goalkeepers_count, gk_target),
        },
    }


@router.get("/{auction_id}/evaluations/status")
def get_evaluation_status(auction_id: int) -> dict:
    """Completeness snapshot of the auction_players for a given auction.

    Drives the indicator card on the home page. Targets come from the auction's
    own preference columns.
    """
    with SessionLocal() as session:
        auction = session.get(Auction, auction_id)
        if auction is None:
            raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
        return _compute_evaluation_status(session, auction)


# CSV columns produced by /export and consumed by /import. Only `player_id`
# and `evaluation` are load-bearing on import — the rest are informational
# (so the file is readable in a spreadsheet). `evaluation` is stored in
# base-1000 units, the canonical auction-independent form; that's what makes
# CSVs round-trip cleanly between auctions with different credits_per_team.
CSV_COLUMNS = ("player_id", "name", "team", "roles", "evaluation")


def _slugify_for_filename(value: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in value).strip("_")
    return safe or "auction"


@router.get("/{auction_id}/evaluations/export")
def export_evaluations(auction_id: int) -> Response:
    """Export every non-null evaluation for this auction as a CSV download.

    The `evaluation` column is the base-1000 stored value (auction-independent).
    """
    with SessionLocal() as session:
        auction = session.get(Auction, auction_id)
        if auction is None:
            raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")

        rows = session.execute(
            select(
                AuctionPlayer.player_id,
                AuctionPlayer.evaluation,
                AuctionPlayer.name,
                AuctionPlayer.team,
                AuctionPlayer.mantra_roles,
            )
            .where(
                AuctionPlayer.auction_id == auction_id,
                AuctionPlayer.evaluation.is_not(None),
            )
            .order_by(AuctionPlayer.name.asc())
        ).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for player_id, evaluation, name, team, roles in rows:
        writer.writerow(
            [
                player_id,
                name,
                team,
                ";".join(r.value for r in roles),
                evaluation,
            ]
        )

    filename = f"{_slugify_for_filename(auction.name)}_evaluations.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{auction_id}/evaluations/import")
async def import_evaluations(auction_id: int, file: UploadFile = File(...)) -> dict:
    """Import evaluations from a CSV produced by /export (or hand-edited).

    Merge semantics: rows in the CSV upsert into `auction_players`;
    players absent from the CSV keep whatever they had. An empty
    `evaluation` cell clears that player's value. Unknown `player_id`s
    are skipped and reported in the response.
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    contents = await file.read(MAX_CSV_BYTES + 1)
    if len(contents) > MAX_CSV_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_CSV_BYTES // (1024 * 1024)} MB upload limit",
        )
    try:
        text = contents.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"CSV must be UTF-8 encoded: {exc}",
        ) from exc

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or "player_id" not in reader.fieldnames:
        raise HTTPException(
            status_code=400,
            detail="CSV header must include a `player_id` column",
        )
    if "evaluation" not in reader.fieldnames:
        raise HTTPException(
            status_code=400,
            detail="CSV header must include an `evaluation` column",
        )

    # (row_dict, line_no) tuples — header is line 1.
    csv_rows: list[tuple[dict, int]] = [
        (row, line_no) for line_no, row in enumerate(reader, start=2)
    ]

    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id)
            if auction is None:
                raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
            if auction.status != AuctionStatus.INITIAL:
                raise HTTPException(
                    status_code=409,
                    detail=f"auction is {auction.status.value}; evaluations can only be imported while INITIAL",
                )

            players_by_id: dict[int, Player] = {
                p.id: p for p in session.execute(select(Player)).scalars()
            }

            upserts: list[dict] = []
            unknown: list[int] = []
            invalid_rows: list[str] = []

            for row, line_no in csv_rows:
                raw_pid = (row.get("player_id") or "").strip()
                raw_eval = (row.get("evaluation") or "").strip()
                if not raw_pid:
                    invalid_rows.append(f"line {line_no}: missing player_id")
                    continue
                try:
                    pid = int(raw_pid)
                except ValueError:
                    invalid_rows.append(f"line {line_no}: non-integer player_id {raw_pid!r}")
                    continue

                if raw_eval == "":
                    evaluation: int | None = None
                else:
                    try:
                        evaluation = int(raw_eval)
                    except ValueError:
                        invalid_rows.append(f"line {line_no}: non-integer evaluation {raw_eval!r}")
                        continue
                    if evaluation < 1:
                        invalid_rows.append(
                            f"line {line_no}: evaluation must be >= 1 (got {evaluation})"
                        )
                        continue

                if pid not in players_by_id:
                    unknown.append(pid)
                    continue

                upserts.append({"player_id": pid, "evaluation": evaluation})

            if invalid_rows:
                # Keep detail a plain string: the UI surfaces it via
                # `data.detail ?? \`HTTP ${res.status}\`` and a dict
                # would render as "[object Object]".
                shown = invalid_rows[:20]
                summary = "CSV has invalid rows: " + "; ".join(shown)
                if len(invalid_rows) > len(shown):
                    summary += f" (+{len(invalid_rows) - len(shown)} more)"
                raise HTTPException(status_code=400, detail=summary)

            # Deduplicate within the file: keep the last occurrence per player.
            deduped: dict[int, dict] = {row["player_id"]: row for row in upserts}

            for row in deduped.values():
                player = players_by_id[row["player_id"]]
                stmt = pg_insert(AuctionPlayer).values(
                    auction_id=auction_id,
                    player_id=player.id,
                    name=player.name,
                    team=player.team,
                    mantra_roles=player.mantra_roles,
                    fanta_evaluation=player.fanta_evaluation,
                    fanta_market_value=player.fanta_market_value,
                    evaluation=row["evaluation"],
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=[
                        AuctionPlayer.auction_id,
                        AuctionPlayer.player_id,
                    ],
                    set_={
                        "evaluation": stmt.excluded.evaluation,
                        "updated_at": func.now(),
                    },
                )
                session.execute(stmt)

    return {
        "imported": len(deduped),
        "unknown_player_ids": unknown,
    }


@router.post("/{auction_id}/evaluations/autofill")
def autofill_evaluations(auction_id: int) -> dict:
    """Replace all auction_players with an algorithmic autofill.

    Uses fanta_market_value as the anchor and produces a set sized to
    N × max_team_size, summing to N × 1000 (base-1000), with exactly
    N × number_of_goalkeepers goalkeepers — so all three groups of
    GET /evaluations/status come out "ok".
    """
    # Single transaction: locks the auction row (so a concurrent
    # PATCH cannot flip status mid-flight), runs the player-pool reads,
    # then DELETEs and re-INSERTs all evaluations. Commits on exit;
    # any HTTPException or DB error rolls everything back.
    with SessionLocal() as session:
        with session.begin():
            auction = session.get(Auction, auction_id, with_for_update=True)
            if auction is None:
                raise HTTPException(
                    status_code=404, detail=f"auction {auction_id} not found"
                )
            if auction.status != AuctionStatus.INITIAL:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"auction is {auction.status.value}; evaluations can "
                        f"only be autofilled while INITIAL"
                    ),
                )

            try:
                values = compute_autofill_evaluations(session, auction)
            except ValueError as exc:
                raise HTTPException(status_code=409, detail=str(exc)) from exc

            session.execute(
                delete(AuctionPlayer).where(
                    AuctionPlayer.auction_id == auction_id
                )
            )
            if values:
                players_by_id: dict[int, Player] = {
                    p.id: p
                    for p in session.execute(
                        select(Player).where(Player.id.in_(values.keys()))
                    ).scalars()
                }
                session.execute(
                    pg_insert(AuctionPlayer),
                    [
                        {
                            "auction_id": auction_id,
                            "player_id": pid,
                            "name": players_by_id[pid].name,
                            "team": players_by_id[pid].team,
                            "mantra_roles": players_by_id[pid].mantra_roles,
                            "fanta_evaluation": players_by_id[pid].fanta_evaluation,
                            "fanta_market_value": players_by_id[pid].fanta_market_value,
                            "evaluation": v,
                        }
                        for pid, v in values.items()
                    ],
                )

    return {"autofilled": len(values)}


# ---------------------------------------------------------------------
# Purchases — live-auction sales
# ---------------------------------------------------------------------


class PurchaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    player_id: int
    team_id: int
    price: int = Field(ge=0)


class PurchasePatch(BaseModel):
    """Partial update for a purchase: team_id and/or price.

    Keys may be omitted to leave the existing value untouched, but an
    explicit ``null`` is rejected — the patch handler does arithmetic
    on ``price`` and would otherwise raise a 500 TypeError.
    """

    model_config = ConfigDict(extra="forbid")

    team_id: int | None = Field(default=None, ge=1)
    price: int | None = Field(default=None, ge=0)

    @field_validator("team_id", "price")
    @classmethod
    def _reject_null(cls, v: int | None) -> int | None:
        if v is None:
            raise ValueError("must not be null; omit the key to leave unchanged")
        return v


def _serialize_purchase(p: AuctionPurchase) -> dict:
    return {
        "auction_id": p.auction_id,
        "player_id": p.player_id,
        "team_id": p.team_id,
        "price": p.price,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _compute_terminate_blockers(session, auction: Auction) -> list[str]:
    """Return a list of human-readable reasons why the auction can't yet
    be terminated. Empty list means it can.

    A team is "complete" when it has at least `min_team_size` purchases
    AND at least `number_of_goalkeepers` purchases of goalkeeper-role
    players (a goalkeeper = any player with 'Por' in mantra_roles).
    """
    rows = session.execute(
        select(
            AuctionTeam.id,
            AuctionTeam.team_name,
            func.count(AuctionPurchase.player_id).label("total"),
            func.count(AuctionPurchase.player_id)
            .filter(AuctionPlayer.mantra_roles.any(GK_ROLE))
            .label("gks"),
        )
        .select_from(AuctionTeam)
        .outerjoin(
            AuctionPurchase,
            (AuctionPurchase.team_id == AuctionTeam.id)
            & (AuctionPurchase.auction_id == auction.id),
        )
        .outerjoin(
            AuctionPlayer,
            (AuctionPlayer.auction_id == AuctionPurchase.auction_id)
            & (AuctionPlayer.player_id == AuctionPurchase.player_id),
        )
        .where(AuctionTeam.auction_id == auction.id)
        .group_by(AuctionTeam.id, AuctionTeam.team_name)
        .order_by(AuctionTeam.id.asc())
    ).all()

    blockers: list[str] = []
    for _team_id, team_name, total, gks in rows:
        missing = []
        if int(total) < auction.min_team_size:
            missing.append(
                f"{int(total)}/{auction.min_team_size} players"
            )
        if int(gks) < auction.number_of_goalkeepers:
            missing.append(
                f"{int(gks)}/{auction.number_of_goalkeepers} goalkeepers"
            )
        if missing:
            # team_name is user-controlled (could contain `;` `,` `|`),
            # so quote it with repr to keep the joined detail string
            # parseable by a human reader.
            blockers.append(f"{team_name!r} has " + ", ".join(missing))
    return blockers


def _team_totals(
    session, auction_id: int, team_id: int, exclude_player_id: int | None = None
) -> tuple[int, int]:
    """Return (current_player_count, current_spent) for a team, optionally
    excluding one player_id (used when PATCH-editing an existing row in
    place — the row being edited shouldn't count against itself)."""
    stmt = select(
        func.count(AuctionPurchase.player_id),
        func.coalesce(func.sum(AuctionPurchase.price), 0),
    ).where(
        AuctionPurchase.auction_id == auction_id,
        AuctionPurchase.team_id == team_id,
    )
    if exclude_player_id is not None:
        stmt = stmt.where(AuctionPurchase.player_id != exclude_player_id)
    count, spent = session.execute(stmt).one()
    return int(count), int(spent)


def _require_running_auction(session, auction_id: int) -> Auction:
    auction = session.get(Auction, auction_id)
    if auction is None:
        raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
    if auction.status != AuctionStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=409,
            detail=(
                f"auction is {auction.status.value}; purchases can only be "
                f"managed while IN_PROGRESS"
            ),
        )
    return auction


@router.get("/{auction_id}/purchases")
def list_purchases(auction_id: int) -> list[dict]:
    with SessionLocal() as session:
        auction = session.get(Auction, auction_id)
        if auction is None:
            raise HTTPException(status_code=404, detail=f"auction {auction_id} not found")
        rows = list(
            session.execute(
                select(AuctionPurchase)
                .where(AuctionPurchase.auction_id == auction_id)
                .order_by(AuctionPurchase.created_at.asc())
            ).scalars()
        )
        return [_serialize_purchase(p) for p in rows]


@router.get("/{auction_id}/purchases/random-player")
def random_unsold_player(auction_id: int) -> dict:
    """Pick one random player from the auction pool not yet sold."""
    with SessionLocal() as session:
        auction = _require_running_auction(session, auction_id)
        unsold = select(AuctionPlayer).where(
            AuctionPlayer.auction_id == auction.id,
            ~select(AuctionPurchase.player_id)
            .where(
                AuctionPurchase.auction_id == auction.id,
                AuctionPurchase.player_id == AuctionPlayer.player_id,
            )
            .exists(),
        )
        # Count + OFFSET avoids ORDER BY random() sorting the full pool
        # on every call. Two cheap queries (indexed count + skip) beat
        # one O(N log N) per draw.
        total = session.execute(
            select(func.count()).select_from(unsold.subquery())
        ).scalar_one()
        if not total:
            raise HTTPException(
                status_code=404, detail="no unsold players left in this auction"
            )
        offset = secrets.randbelow(total)
        row = session.execute(unsold.offset(offset).limit(1)).scalar_one()
        return {
            "id": row.player_id,
            "name": row.name,
            "team": row.team,
            "mantra_roles": [r.value for r in row.mantra_roles],
            "fanta_evaluation": row.fanta_evaluation,
            "fanta_market_value": row.fanta_market_value,
            "evaluation": row.evaluation,
        }


@router.post("/{auction_id}/purchases")
def create_purchase(auction_id: int, body: PurchaseCreate) -> dict:
    with SessionLocal() as session:
        with session.begin():
            auction = _require_running_auction(session, auction_id)

            team = session.get(AuctionTeam, body.team_id)
            if team is None or team.auction_id != auction_id:
                raise HTTPException(
                    status_code=404,
                    detail=f"team {body.team_id} not found in auction {auction_id}",
                )

            in_pool = session.execute(
                select(func.count())
                .select_from(AuctionPlayer)
                .where(
                    AuctionPlayer.auction_id == auction_id,
                    AuctionPlayer.player_id == body.player_id,
                )
            ).scalar_one()
            if not in_pool:
                raise HTTPException(
                    status_code=404,
                    detail=f"player {body.player_id} is not in auction {auction_id}",
                )

            existing = session.get(AuctionPurchase, (auction_id, body.player_id))
            if existing is not None:
                raise HTTPException(
                    status_code=409,
                    detail=f"player {body.player_id} already sold to team {existing.team_id}",
                )

            count, spent = _team_totals(session, auction_id, body.team_id)
            if count >= auction.max_team_size:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"team {team.team_name!r} is full "
                        f"({count}/{auction.max_team_size})"
                    ),
                )
            if spent + body.price > auction.credits_per_team:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"team {team.team_name!r} would exceed credits_per_team: "
                        f"{spent} spent + {body.price} > {auction.credits_per_team}"
                    ),
                )

            purchase = AuctionPurchase(
                auction_id=auction_id,
                player_id=body.player_id,
                team_id=body.team_id,
                price=body.price,
            )
            session.add(purchase)
            try:
                session.flush()
            except IntegrityError as exc:
                # PK collision: another request inserted the same
                # (auction_id, player_id) between our existence check
                # and the flush. Surface as 409 instead of 500.
                raise HTTPException(
                    status_code=409,
                    detail=f"player {body.player_id} already sold in auction {auction_id}",
                ) from exc
            return _serialize_purchase(purchase)


@router.patch("/{auction_id}/purchases/{player_id}")
def patch_purchase(auction_id: int, player_id: int, patch: PurchasePatch) -> dict:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")

    with SessionLocal() as session:
        with session.begin():
            auction = _require_running_auction(session, auction_id)

            purchase = session.get(AuctionPurchase, (auction_id, player_id))
            if purchase is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"player {player_id} is not currently sold in auction {auction_id}",
                )

            new_team_id = fields.get("team_id", purchase.team_id)
            new_price = fields.get("price", purchase.price)

            team: AuctionTeam | None = None
            if new_team_id != purchase.team_id:
                team = session.get(AuctionTeam, new_team_id)
                if team is None or team.auction_id != auction_id:
                    raise HTTPException(
                        status_code=404,
                        detail=f"team {new_team_id} not found in auction {auction_id}",
                    )

            count, spent = _team_totals(
                session, auction_id, new_team_id, exclude_player_id=player_id
            )

            def _team_label() -> str:
                # Lazy: same-team PATCH (the common price-edit case) avoids
                # a second SELECT unless we actually hit a validation error.
                nonlocal team
                if team is None:
                    team = session.get(AuctionTeam, new_team_id)
                return repr(team.team_name) if team is not None else f"id {new_team_id}"

            if count + 1 > auction.max_team_size:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"team {_team_label()} is full "
                        f"({count + 1}/{auction.max_team_size})"
                    ),
                )
            if spent + new_price > auction.credits_per_team:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"team {_team_label()} would exceed credits_per_team: "
                        f"{spent} spent + {new_price} > {auction.credits_per_team}"
                    ),
                )

            purchase.team_id = new_team_id
            purchase.price = new_price
            session.flush()
            return _serialize_purchase(purchase)


@router.delete("/{auction_id}/purchases/{player_id}")
def delete_purchase(auction_id: int, player_id: int) -> dict:
    with SessionLocal() as session:
        with session.begin():
            _require_running_auction(session, auction_id)
            purchase = session.get(AuctionPurchase, (auction_id, player_id))
            if purchase is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"player {player_id} is not currently sold in auction {auction_id}",
                )
            session.delete(purchase)
    return {"deleted": player_id}


@router.get("/{auction_id}/module-predictions")
def get_module_predictions(auction_id: int) -> dict:
    """Confidence per lineup module each team is building toward.

    Allowed while the auction is `IN_PROGRESS` or `TERMINATED` (purchases
    only exist in those states). Empty teams get 1.0 for every module
    (no signal → all modules equally plausible).
    """
    with SessionLocal() as session:
        auction = session.get(Auction, auction_id)
        if auction is None:
            raise HTTPException(
                status_code=404, detail=f"auction {auction_id} not found"
            )
        if auction.status == AuctionStatus.INITIAL:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"auction is {auction.status.value}; module predictions "
                    f"are only available once IN_PROGRESS"
                ),
            )

        per_team = compute_module_predictions(session, auction)

        teams = list(
            session.execute(
                select(AuctionTeam)
                .where(AuctionTeam.auction_id == auction_id)
                .order_by(AuctionTeam.id)
            ).scalars()
        )
        return {
            "auction_id": auction_id,
            "teams": [
                {
                    "team_id": t.id,
                    "team_name": t.team_name,
                    "modules": [
                        {"name": name, "confidence": conf}
                        for name, conf in sorted(
                            per_team.get(t.id, {}).items(),
                            key=lambda kv: (-kv[1], kv[0]),
                        )
                    ],
                }
                for t in teams
            ],
        }
