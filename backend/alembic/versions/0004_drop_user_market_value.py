"""drop user_market_value (moving to a separate table later)

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("players", "user_market_value")


def downgrade() -> None:
    op.add_column("players", sa.Column("user_market_value", sa.Integer(), nullable=True))
