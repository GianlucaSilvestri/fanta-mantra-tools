"""create user_preferences singleton table

One row, always present (PK fixed at 1 via a CHECK constraint), holding the
league-wide auction configuration. Seeded with sensible defaults so that the
UI never has to handle a "no preferences yet" state.

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("number_of_auctioners", sa.Integer(), nullable=False),
        sa.Column("min_team_size", sa.Integer(), nullable=False),
        sa.Column("max_team_size", sa.Integer(), nullable=False),
        sa.Column("credits_per_team", sa.Integer(), nullable=False),
        sa.Column("number_of_goalkeepers", sa.Integer(), nullable=False),
        sa.CheckConstraint("id = 1", name="user_preferences_singleton"),
    )
    op.execute(
        "INSERT INTO user_preferences "
        "(id, number_of_auctioners, min_team_size, max_team_size, "
        "credits_per_team, number_of_goalkeepers) "
        "VALUES (1, 10, 27, 30, 500, 3)"
    )


def downgrade() -> None:
    op.drop_table("user_preferences")
