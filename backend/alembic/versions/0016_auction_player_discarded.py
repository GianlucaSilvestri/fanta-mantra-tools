"""add `discarded` flag to auction_players (per-auction "not in play"
state)

During a live auction the user can mark a player as discarded —
e.g. nobody was bidding on the random pick — and the player is then
permanently dropped from the active pool: the random-picker won't
resurface them, the per-role overview won't list them, and the
purchase endpoint refuses them. The flag is reversible from the UI
(restore button) so a misclick is recoverable.

No backfill needed: existing rows default to FALSE. Discards are only
created IN_PROGRESS, when `auction_players` already exists.

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "auction_players",
        sa.Column(
            "discarded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("auction_players", "discarded")
