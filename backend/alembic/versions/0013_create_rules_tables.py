"""create role_weights + lineup_modules + lineup_module_slots and seed

Moves the static Mantra game-rule data (role offensive weights and the
catalogue of 11 legal lineup modules) out of `rules.json` and into the
database. The JSON file is removed in the same change.

The source JSON used "P" for goalkeeper; we normalize it to "Por" to
match the `mantra_role` enum.

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MANTRA_ROLE_VALUES = (
    "Por", "Dc", "Dd", "Ds", "B", "E", "M", "C", "W", "T", "A", "Pc",
)

# Inlined verbatim from the deleted rules.json. `_norm` rewrites the
# legacy "P" code to "Por".
_RULES = {
    "weights": {
        "P": 0, "Dc": 0, "Dd": 0, "Ds": 0, "B": 0, "E": 0, "M": 0,
        "C": 1, "W": 2, "T": 2, "A": 3, "Pc": 4,
    },
    "modules": [
        {"name": "343",  "roles": ["P", "Dc", "Dc", "Dc/B", "E", "M/C", "C", "E", "W/A", "A/Pc", "W/A"]},
        {"name": "3412", "roles": ["P", "Dc", "Dc", "Dc/B", "E", "M/C", "C", "E", "T", "A/Pc", "A/Pc"]},
        {"name": "3421", "roles": ["P", "Dc", "Dc", "Dc/B", "E", "M", "M/C", "E/W", "T", "T/A", "A/Pc"]},
        {"name": "352",  "roles": ["P", "Dc", "Dc", "Dc/B", "E", "M", "M/C", "C", "E/W", "A/Pc", "A/Pc"]},
        {"name": "3511", "roles": ["P", "Dc", "Dc", "Dc/B", "M", "M", "C", "E/W", "E/W", "T/A", "A/Pc"]},
        {"name": "433",  "roles": ["P", "Dd", "Dc", "Dc", "Ds", "M", "M/C", "C", "W/A", "W/A", "A/Pc"]},
        {"name": "4312", "roles": ["P", "Dd", "Dc", "Dc", "Ds", "M", "M/C", "C", "T", "T/A/Pc", "A/Pc"]},
        {"name": "442",  "roles": ["P", "Dd", "Dc", "Dc", "Ds", "E", "M/C", "C", "E/W", "A/Pc", "A/Pc"]},
        {"name": "4141", "roles": ["P", "Dd", "Dc", "Dc", "Ds", "M", "C/T", "E/W", "W", "T", "A/Pc"]},
        {"name": "4411", "roles": ["P", "Dd", "Dc", "Dc", "Ds", "M", "C", "E/W", "E/W", "T/A", "A/Pc"]},
        {"name": "4231", "roles": ["P", "Dd", "Dc", "Dc", "Ds", "M", "M/C", "W/T", "T", "W/A", "A/Pc"]},
    ],
}


def _norm(code: str) -> str:
    return "Por" if code == "P" else code


def upgrade() -> None:
    mantra_role_enum = postgresql.ENUM(
        *MANTRA_ROLE_VALUES, name="mantra_role", create_type=False
    )

    role_weights = op.create_table(
        "role_weights",
        sa.Column("role", mantra_role_enum, nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("role"),
        sa.CheckConstraint("weight >= 0", name="role_weights_weight_nonneg"),
    )

    lineup_modules = op.create_table(
        "lineup_modules",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="lineup_modules_name_unique"),
    )

    lineup_module_slots = op.create_table(
        "lineup_module_slots",
        sa.Column(
            "module_id",
            sa.Integer(),
            sa.ForeignKey("lineup_modules.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "allowed_roles",
            postgresql.ARRAY(mantra_role_enum),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("module_id", "position"),
        sa.CheckConstraint(
            "position BETWEEN 1 AND 11",
            name="lineup_module_slots_position_range",
        ),
    )

    # ---- seed ----

    op.bulk_insert(
        role_weights,
        [{"role": _norm(r), "weight": w} for r, w in _RULES["weights"].items()],
    )

    # Explicit module IDs let us reference them from the slot inserts in
    # the same migration without a round-trip SELECT.
    module_rows = [
        {"id": idx, "name": m["name"]}
        for idx, m in enumerate(_RULES["modules"], start=1)
    ]
    op.bulk_insert(lineup_modules, module_rows)
    # Keep the serial sequence aligned with the explicit IDs.
    op.execute(
        f"SELECT setval('lineup_modules_id_seq', {len(module_rows)}, true)"
    )

    slot_rows = []
    for idx, m in enumerate(_RULES["modules"], start=1):
        for pos, spec in enumerate(m["roles"], start=1):
            allowed = [_norm(tok) for tok in spec.split("/") if tok]
            slot_rows.append(
                {"module_id": idx, "position": pos, "allowed_roles": allowed}
            )
    op.bulk_insert(lineup_module_slots, slot_rows)


def downgrade() -> None:
    op.drop_table("lineup_module_slots")
    op.drop_table("lineup_modules")
    op.drop_table("role_weights")
