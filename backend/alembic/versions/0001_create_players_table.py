"""create players table

Revision ID: 0001
Revises:
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MANTRA_ROLE_VALUES = (
    "Por", "Dc", "Dd", "Ds", "B", "E", "M", "C", "W", "T", "A", "Pc",
)

TEAM_VALUES = (
    "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese",
    "Fiorentina", "Genoa", "Inter", "Juventus", "Lazio",
    "Lecce", "Milan", "Napoli", "Parma", "Pisa",
    "Roma", "Sassuolo", "Torino", "Udinese", "Verona",
)


def upgrade() -> None:
    mantra_role = postgresql.ENUM(*MANTRA_ROLE_VALUES, name="mantra_role")
    team = postgresql.ENUM(*TEAM_VALUES, name="team")
    bind = op.get_bind()
    mantra_role.create(bind, checkfirst=False)
    team.create(bind, checkfirst=False)

    op.create_table(
        "players",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "team",
            postgresql.ENUM(*TEAM_VALUES, name="team", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "mantra_roles",
            postgresql.ARRAY(
                postgresql.ENUM(*MANTRA_ROLE_VALUES, name="mantra_role", create_type=False)
            ),
            nullable=False,
        ),
        sa.Column("qt_a", sa.Integer()),
        sa.Column("qt_i", sa.Integer()),
        sa.Column("diff", sa.Integer()),
        sa.Column("qt_a_m", sa.Integer()),
        sa.Column("qt_i_m", sa.Integer()),
        sa.Column("diff_m", sa.Integer()),
        sa.Column("fvm", sa.Integer()),
        sa.Column("fvm_m", sa.Integer()),
    )


def downgrade() -> None:
    op.drop_table("players")
    bind = op.get_bind()
    postgresql.ENUM(name="team").drop(bind, checkfirst=False)
    postgresql.ENUM(name="mantra_role").drop(bind, checkfirst=False)
