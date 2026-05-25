"""create user_evaluations table

User-supplied auction valuations per player, parameterised by league-size
scenario (6/8/10/12 active rosters). Lives in its own table so it survives
the TRUNCATE of `players` on every xlsx re-import. No FK to `players(id)` on
purpose: a FK would either force CASCADE (wiping evaluations on import) or
break the TRUNCATE.

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_evaluations",
        sa.Column("player_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("six_players_auction_evaluation", sa.Integer(), nullable=True),
        sa.Column("eight_players_auction_evaluation", sa.Integer(), nullable=True),
        sa.Column("ten_players_auction_evaluation", sa.Integer(), nullable=True),
        sa.Column("twelve_players_auction_evaluation", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("user_evaluations")
