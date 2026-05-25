from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.app.db import SessionLocal
from backend.app.models import UserPreferences

router = APIRouter(prefix="/preferences", tags=["preferences"])


# All fields required on PUT: this is a singleton config, not a partial update.
class PreferencesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    number_of_auctioners: int = Field(ge=1)
    min_team_size: int = Field(ge=1)
    max_team_size: int = Field(ge=1)
    credits_per_team: int = Field(ge=1)
    number_of_goalkeepers: int = Field(ge=0)


def _serialize(p: UserPreferences) -> dict:
    return {
        "number_of_auctioners": p.number_of_auctioners,
        "min_team_size": p.min_team_size,
        "max_team_size": p.max_team_size,
        "credits_per_team": p.credits_per_team,
        "number_of_goalkeepers": p.number_of_goalkeepers,
    }


@router.get("")
def get_preferences() -> dict:
    with SessionLocal() as session:
        prefs = session.get(UserPreferences, 1)
        if prefs is None:
            # Migration 0006 seeds the singleton row — this branch shouldn't
            # ever fire in practice. If it does, treat it as a setup error.
            raise HTTPException(status_code=500, detail="user_preferences singleton row missing")
        return _serialize(prefs)


@router.put("")
def put_preferences(body: PreferencesBody) -> dict:
    if body.max_team_size < body.min_team_size:
        raise HTTPException(
            status_code=400,
            detail=f"max_team_size ({body.max_team_size}) must be >= min_team_size ({body.min_team_size})",
        )

    with SessionLocal() as session:
        with session.begin():
            prefs = session.get(UserPreferences, 1)
            if prefs is None:
                raise HTTPException(status_code=500, detail="user_preferences singleton row missing")
            for k, v in body.model_dump().items():
                setattr(prefs, k, v)
            session.flush()
            return _serialize(prefs)
