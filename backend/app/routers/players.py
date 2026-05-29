from zipfile import BadZipFile

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import select

from backend.app.db import SessionLocal
from backend.app.models import Auction, AuctionPlayer, AuctionStatus, Player
from backend.scripts.import_players import parse_players, write_players

router = APIRouter(prefix="/players", tags=["players"])

# Generous cap for the Quotazioni xlsx (~200 KB in practice). Stops a
# rogue multi-GB POST from filling the backend container's spool.
MAX_XLSX_BYTES = 10 * 1024 * 1024  # 10 MB


def _serialize(player: Player, evaluation: int | None) -> dict:
    return {
        "id": player.id,
        "name": player.name,
        "team": player.team,
        "mantra_roles": [r.value for r in player.mantra_roles],
        "fanta_evaluation": player.fanta_evaluation,
        "fanta_market_value": player.fanta_market_value,
        "evaluation": evaluation,
        # The live `players` table / INITIAL view has no per-auction
        # discard state; discards only exist on the IN_PROGRESS snapshot.
        "discarded": False,
    }


def _serialize_snapshot(p: AuctionPlayer) -> dict:
    return {
        "id": p.player_id,
        "name": p.name,
        "team": p.team,
        "mantra_roles": [r.value for r in p.mantra_roles],
        "fanta_evaluation": p.fanta_evaluation,
        "fanta_market_value": p.fanta_market_value,
        "evaluation": p.evaluation,
        "discarded": p.discarded,
    }


@router.get("")
def list_players(auction_id: int | None = Query(default=None)) -> list[dict]:
    """List players for an auction view.

    * No `auction_id` → live `players` table, evaluation always null.
    * `auction_id` + auction is INITIAL → live `players` LEFT JOIN that
      auction's evaluation (so the user can edit values pre-start).
    * `auction_id` + auction is IN_PROGRESS / TERMINATED → the frozen
      `auction_players` snapshot. Reading from the live `players` table
      here would silently drop players removed by a later xlsx refresh
      and would surface post-refresh names/teams/roles instead of the
      ones the auction was started with.
    """
    with SessionLocal() as session:
        if auction_id is None:
            stmt = select(Player).order_by(
                Player.fanta_evaluation.desc().nullslast(), Player.name.asc()
            )
            return [_serialize(p, None) for p in session.execute(stmt).scalars().all()]

        auction = session.get(Auction, auction_id)
        if auction is None:
            raise HTTPException(
                status_code=404, detail=f"auction {auction_id} not found"
            )

        if auction.status == AuctionStatus.INITIAL:
            stmt = (
                select(Player, AuctionPlayer.evaluation)
                .outerjoin(
                    AuctionPlayer,
                    (AuctionPlayer.player_id == Player.id)
                    & (AuctionPlayer.auction_id == auction_id),
                )
                .order_by(
                    Player.fanta_evaluation.desc().nullslast(), Player.name.asc()
                )
            )
            return [_serialize(p, ev) for p, ev in session.execute(stmt).all()]

        snap_stmt = (
            select(AuctionPlayer)
            .where(AuctionPlayer.auction_id == auction_id)
            .order_by(
                AuctionPlayer.fanta_evaluation.desc().nullslast(),
                AuctionPlayer.name.asc(),
            )
        )
        return [
            _serialize_snapshot(p)
            for p in session.execute(snap_stmt).scalars().all()
        ]


@router.post("/import")
async def import_from_xlsx(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="File must be a .xlsx")

    contents = await file.read(MAX_XLSX_BYTES + 1)
    if len(contents) > MAX_XLSX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {MAX_XLSX_BYTES // (1024 * 1024)} MB upload limit",
        )

    try:
        players = parse_players(contents)
    except (InvalidFileException, BadZipFile, KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse xlsx: {exc}") from exc

    if not players:
        raise HTTPException(status_code=400, detail="No players recognized in the uploaded file")

    count = write_players(players)
    return {"imported": count, "filename": file.filename}
