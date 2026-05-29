"""add is_my_team flag to auction_teams (single team per auction the
user themselves controls)

A user can mark exactly one team in each auction as "mine". The flag is
enforced at the DB layer by a partial unique index, so the
at-most-one-per-auction invariant doesn't depend on application logic.
Once the auction transitions to IN_PROGRESS the flag is frozen (the
router refuses team mutations outside INITIAL, same guard as add/delete).

No backfill needed: existing teams default to FALSE. Auctions already
past INITIAL stay without a "mine" — only the INITIAL → IN_PROGRESS
gate enforces "must be set", and that only fires on new transitions.

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, Sequence[str], None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "auction_teams",
        sa.Column(
            "is_my_team",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "auction_teams_one_mine_per_auction",
        "auction_teams",
        ["auction_id"],
        unique=True,
        postgresql_where=sa.text("is_my_team = true"),
    )


def downgrade() -> None:
    op.drop_index("auction_teams_one_mine_per_auction", table_name="auction_teams")
    op.drop_column("auction_teams", "is_my_team")
