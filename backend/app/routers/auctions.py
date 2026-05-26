import csv
import io
from typing import Literal

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from backend.app.db import SessionLocal
from backend.app.models import (
    Auction,
    AuctionEvaluation,
    AuctionStatus,
    AuctionTeam,
    Player,
)

router = APIRouter(prefix="/auctions", tags=["auctions"])

Status = Literal["under", "ok", "over"]

# Mantra role marker for goalkeepers.
GK_ROLE = "Por"


class AuctionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str | None = None
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

    evaluation: int | None = Field(default=None, ge=0)


# Fields a PATCH cannot touch when the auction has moved past INITIAL.
LOCKED_FIELDS_OUTSIDE_INITIAL = {
    "name",
    "description",
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

            # Gate the INITIAL → IN_PROGRESS transition on a complete evaluation.
            new_status = fields.get("status")
            if (
                new_status == AuctionStatus.IN_PROGRESS
                and auction.status == AuctionStatus.INITIAL
            ):
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
            if not session.get(Player, player_id):
                raise HTTPException(status_code=404, detail=f"player {player_id} not found")

            stmt = pg_insert(AuctionEvaluation).values(
                auction_id=auction_id, player_id=player_id, **fields
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=[AuctionEvaluation.auction_id, AuctionEvaluation.player_id],
                set_=fields,
            )
            session.execute(stmt)

            ue = session.execute(
                select(AuctionEvaluation).where(
                    AuctionEvaluation.auction_id == auction_id,
                    AuctionEvaluation.player_id == player_id,
                )
            ).scalar_one()
            return {
                "auction_id": ue.auction_id,
                "player_id": ue.player_id,
                "evaluation": ue.evaluation,
            }


def _compute_evaluation_status(session, auction: Auction) -> dict:
    """Build the credits/players/goalkeepers completeness snapshot.

    Shared between the public GET /evaluations/status endpoint and the
    INITIAL → IN_PROGRESS transition gate in patch_auction.
    """
    stmt = (
        select(
            func.count(AuctionEvaluation.evaluation).label("evaluated_count"),
            func.coalesce(func.sum(AuctionEvaluation.evaluation), 0).label("stored_sum"),
            func.count(AuctionEvaluation.evaluation)
            .filter(Player.mantra_roles.any(GK_ROLE))
            .label("goalkeepers_count"),
        )
        .select_from(AuctionEvaluation)
        .join(Player, Player.id == AuctionEvaluation.player_id)
        .where(
            AuctionEvaluation.auction_id == auction.id,
            AuctionEvaluation.evaluation.is_not(None),
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
    """Completeness snapshot of the auction_evaluations for a given auction.

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
                AuctionEvaluation.player_id,
                AuctionEvaluation.evaluation,
                Player.name,
                Player.team,
                Player.mantra_roles,
            )
            .join(Player, Player.id == AuctionEvaluation.player_id)
            .where(
                AuctionEvaluation.auction_id == auction_id,
                AuctionEvaluation.evaluation.is_not(None),
            )
            .order_by(Player.name.asc())
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

    Merge semantics: rows in the CSV upsert into `auction_evaluations`;
    players absent from the CSV keep whatever they had. An empty
    `evaluation` cell clears that player's value. Unknown `player_id`s
    are skipped and reported in the response.
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    contents = await file.read()
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

            existing_ids: set[int] = set(
                session.execute(select(Player.id)).scalars()
            )

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
                    if evaluation < 0:
                        invalid_rows.append(f"line {line_no}: negative evaluation {evaluation}")
                        continue

                if pid not in existing_ids:
                    unknown.append(pid)
                    continue

                upserts.append(
                    {"auction_id": auction_id, "player_id": pid, "evaluation": evaluation}
                )

            if invalid_rows:
                raise HTTPException(
                    status_code=400,
                    detail={"message": "CSV has invalid rows", "errors": invalid_rows[:20]},
                )

            # Deduplicate within the file: keep the last occurrence per player.
            deduped: dict[int, dict] = {row["player_id"]: row for row in upserts}

            for row in deduped.values():
                stmt = pg_insert(AuctionEvaluation).values(**row)
                stmt = stmt.on_conflict_do_update(
                    index_elements=[
                        AuctionEvaluation.auction_id,
                        AuctionEvaluation.player_id,
                    ],
                    set_={"evaluation": stmt.excluded.evaluation},
                )
                session.execute(stmt)

    return {
        "imported": len(deduped),
        "unknown_player_ids": unknown,
    }
