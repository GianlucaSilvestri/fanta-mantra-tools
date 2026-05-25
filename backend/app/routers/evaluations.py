from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from backend.app.db import SessionLocal
from backend.app.models import Player, UserEvaluation, UserPreferences

router = APIRouter(prefix="/evaluations", tags=["evaluations"])

Status = Literal["under", "ok", "over"]

# Mantra role marker for goalkeepers.
GK_ROLE = "Por"


class EvaluationPatch(BaseModel):
    """Single-field patch. Explicit `null` clears; absent key is rejected."""

    model_config = ConfigDict(extra="forbid")

    evaluation: int | None = Field(default=None, ge=0)


def _serialize(ue: UserEvaluation) -> dict:
    return {"player_id": ue.player_id, "evaluation": ue.evaluation}


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


@router.get("/status")
def get_evaluation_status() -> dict:
    """Completeness snapshot of the user_evaluations table.

    Drives the indicator card on the /evaluations page and (later) the
    auction-creation gate. Targets come from the user_preferences singleton.
    """
    with SessionLocal() as session:
        prefs = session.get(UserPreferences, 1)
        if prefs is None:
            raise HTTPException(status_code=500, detail="user_preferences singleton row missing")

        stmt = (
            select(
                func.count(UserEvaluation.evaluation).label("evaluated_count"),
                func.coalesce(func.sum(UserEvaluation.evaluation), 0).label("stored_sum"),
                func.count(UserEvaluation.evaluation)
                .filter(Player.mantra_roles.any(GK_ROLE))
                .label("goalkeepers_count"),
            )
            .select_from(UserEvaluation)
            .join(Player, Player.id == UserEvaluation.player_id)
            .where(UserEvaluation.evaluation.is_not(None))
        )
        evaluated_count, stored_sum, goalkeepers_count = session.execute(stmt).one()

    auctioners = prefs.number_of_auctioners
    credits_per_team = prefs.credits_per_team
    credit_total = auctioners * credits_per_team
    min_players = auctioners * prefs.min_team_size
    max_players = auctioners * prefs.max_team_size
    gk_target = auctioners * prefs.number_of_goalkeepers

    # Stored evaluations are in 1000-credit base; rescale to the user's budget.
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
