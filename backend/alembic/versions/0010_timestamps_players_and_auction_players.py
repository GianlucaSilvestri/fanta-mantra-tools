"""add created_at / updated_at to players and auction_players

Matches the pattern already used by `auction` and `auction_teams`:
TIMESTAMPTZ NOT NULL, server_default = now(). On the DB side `now()`
yields a UTC instant; the TIMESTAMPTZ column preserves the offset.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_timestamps(table: str) -> None:
    op.add_column(
        table,
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.add_column(
        table,
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def upgrade() -> None:
    _add_timestamps("players")
    _add_timestamps("auction_players")


def downgrade() -> None:
    op.drop_column("auction_players", "updated_at")
    op.drop_column("auction_players", "created_at")
    op.drop_column("players", "updated_at")
    op.drop_column("players", "created_at")
