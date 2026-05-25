"""simplify user_evaluations to a single `evaluation` column

The user settled on a single auction setup per league, so the four scenario
columns (6P/8P/10P/12P) collapse into one. Existing rows were experimentation
garbage — TRUNCATE before reshaping.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DROPPED = (
    "eight_players_auction_evaluation",
    "ten_players_auction_evaluation",
    "twelve_players_auction_evaluation",
)


def upgrade() -> None:
    op.execute("TRUNCATE TABLE user_evaluations")
    op.alter_column(
        "user_evaluations",
        "six_players_auction_evaluation",
        new_column_name="evaluation",
    )
    for col in DROPPED:
        op.drop_column("user_evaluations", col)


def downgrade() -> None:
    op.alter_column(
        "user_evaluations",
        "evaluation",
        new_column_name="six_players_auction_evaluation",
    )
    for col in DROPPED:
        op.add_column("user_evaluations", sa.Column(col, sa.Integer(), nullable=True))
