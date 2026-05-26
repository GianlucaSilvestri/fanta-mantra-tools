from zipfile import BadZipFile

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import select

from backend.app.db import SessionLocal
from backend.app.models import AuctionPlayer, Player
from backend.scripts.import_players import parse_players, write_players

router = APIRouter(prefix="/players", tags=["players"])


def _serialize(player: Player, evaluation: int | None) -> dict:
    return {
        "id": player.id,
        "name": player.name,
        "team": player.team,
        "mantra_roles": [r.value for r in player.mantra_roles],
        "fanta_evaluation": player.fanta_evaluation,
        "fanta_market_value": player.fanta_market_value,
        "evaluation": evaluation,
    }


@router.get("")
def list_players(auction_id: int | None = Query(default=None)) -> list[dict]:
    """List all players. With `?auction_id=N`, joins that auction's evaluations."""
    with SessionLocal() as session:
        if auction_id is None:
            stmt = select(Player).order_by(
                Player.fanta_evaluation.desc().nullslast(), Player.name.asc()
            )
            return [_serialize(p, None) for p in session.execute(stmt).scalars().all()]

        stmt = (
            select(Player, AuctionPlayer.evaluation)
            .outerjoin(
                AuctionPlayer,
                (AuctionPlayer.player_id == Player.id)
                & (AuctionPlayer.auction_id == auction_id),
            )
            .order_by(Player.fanta_evaluation.desc().nullslast(), Player.name.asc())
        )
        return [_serialize(p, ev) for p, ev in session.execute(stmt).all()]


@router.post("/import")
async def import_from_xlsx(file: UploadFile = File(...)) -> dict:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="File must be a .xlsx")

    contents = await file.read()

    try:
        players = parse_players(contents)
    except (InvalidFileException, BadZipFile, KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse xlsx: {exc}") from exc

    if not players:
        raise HTTPException(status_code=400, detail="No players recognized in the uploaded file")

    count = write_players(players)
    return {"imported": count, "filename": file.filename}
