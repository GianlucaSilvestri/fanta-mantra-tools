"""convert players.team from enum to varchar

Teams change every season (promotion / relegation) so the source-of-truth is
the imported xlsx, not a hardcoded enum. The Mantra-role enum stays because
those values are defined by the game's rules and don't drift.

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TEAM_VALUES = (
    "Atalanta", "Bologna", "Cagliari", "Como", "Cremonese",
    "Fiorentina", "Genoa", "Inter", "Juventus", "Lazio",
    "Lecce", "Milan", "Napoli", "Parma", "Pisa",
    "Roma", "Sassuolo", "Torino", "Udinese", "Verona",
)


def upgrade() -> None:
    op.alter_column(
        "players",
        "team",
        type_=sa.Text(),
        existing_nullable=False,
        postgresql_using="team::text",
    )
    op.execute("DROP TYPE team")


def downgrade() -> None:
    from sqlalchemy.dialects import postgresql

    team = postgresql.ENUM(*TEAM_VALUES, name="team")
    team.create(op.get_bind(), checkfirst=False)
    op.alter_column(
        "players",
        "team",
        type_=team,
        existing_nullable=False,
        postgresql_using="team::team",
    )
