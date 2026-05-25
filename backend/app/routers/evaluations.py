from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.app.db import SessionLocal
from backend.app.models import Player, UserEvaluation

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


class EvaluationPatch(BaseModel):
    """Single-field patch. Explicit `null` clears; absent key is rejected."""

    model_config = ConfigDict(extra="forbid")

    evaluation: int | None = Field(default=None, ge=0)


def _serialize(ue: UserEvaluation) -> dict:
    return {"player_id": ue.player_id, "evaluation": ue.evaluation}


@router.patch("/{player_id}")
def patch_evaluation(player_id: int, patch: EvaluationPatch) -> dict:
    fields = patch.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields provided")

    with SessionLocal() as session:
        with session.begin():
            if not session.get(Player, player_id):
                raise HTTPException(status_code=404, detail=f"player {player_id} not found")

            stmt = pg_insert(UserEvaluation).values(player_id=player_id, **fields)
            stmt = stmt.on_conflict_do_update(
                index_elements=[UserEvaluation.player_id],
                set_=fields,
            )
            session.execute(stmt)

            ue = session.execute(
                select(UserEvaluation).where(UserEvaluation.player_id == player_id)
            ).scalar_one()
            return _serialize(ue)
