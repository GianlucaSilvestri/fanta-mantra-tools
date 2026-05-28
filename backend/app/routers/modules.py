from collections import defaultdict

from fastapi import APIRouter
from sqlalchemy import select

from backend.app.db import SessionLocal
from backend.app.models import LineupModule, LineupModuleSlot

router = APIRouter(prefix="/modules", tags=["modules"])


@router.get("")
def list_modules() -> list[dict]:
    """List every legal Mantra lineup module with its 11 positional slots.

    Static reference data seeded by migration 0013. Slots are returned
    ordered by `position` (1..11). Each slot's `allowed_roles` is the
    set of mantra roles eligible for that pitch position.
    """
    with SessionLocal() as session:
        rows = session.execute(
            select(
                LineupModule.id,
                LineupModule.name,
                LineupModuleSlot.position,
                LineupModuleSlot.allowed_roles,
            )
            .join(LineupModuleSlot, LineupModuleSlot.module_id == LineupModule.id)
            .order_by(LineupModule.id, LineupModuleSlot.position)
        ).all()

        slots_by_module: dict[int, list[dict]] = defaultdict(list)
        names: dict[int, str] = {}
        for module_id, name, position, allowed in rows:
            names[module_id] = name
            slots_by_module[module_id].append(
                {
                    "position": position,
                    "allowed_roles": [r.value for r in allowed],
                }
            )

    return [
        {"id": mid, "name": names[mid], "slots": slots_by_module[mid]}
        for mid in names
    ]
