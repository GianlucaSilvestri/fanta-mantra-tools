"""add auction_type enum (CALL / RANDOM) + auction.type column

Mirrors the create/drop pattern from 0008 for `auction_status`. The
NOT NULL DEFAULT 'CALL' backfills every existing auction row in the
same ALTER statement, so no separate data migration is needed.

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


AUCTION_TYPE_VALUES = ("CALL", "RANDOM")


def upgrade() -> None:
    auction_type = postgresql.ENUM(*AUCTION_TYPE_VALUES, name="auction_type")
    auction_type.create(op.get_bind(), checkfirst=False)

    op.add_column(
        "auction",
        sa.Column(
            "type",
            postgresql.ENUM(*AUCTION_TYPE_VALUES, name="auction_type", create_type=False),
            nullable=False,
            server_default="CALL",
        ),
    )


def downgrade() -> None:
    op.drop_column("auction", "type")
    postgresql.ENUM(name="auction_type").drop(op.get_bind(), checkfirst=False)
