"""create auction_purchases

One row per (auction, player) sale. PK is `(auction_id, player_id)` so
the DB enforces one-team-per-player per auction. `player_id` is not a FK
to `players.id` (same rationale as `auction_players`: `players` is
truncated on every xlsx import).

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auction_purchases",
        sa.Column(
            "auction_id",
            sa.Integer(),
            sa.ForeignKey("auction.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column(
            "team_id",
            sa.Integer(),
            sa.ForeignKey("auction_teams.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("price", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("auction_id", "player_id"),
        sa.CheckConstraint("price >= 0", name="auction_purchases_price_nonneg"),
    )


def downgrade() -> None:
    op.drop_table("auction_purchases")
