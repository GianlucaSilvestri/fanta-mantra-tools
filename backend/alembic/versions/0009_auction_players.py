"""rename auction_evaluations to auction_players + snapshot player columns

Turns the thin `auction_evaluations` join table into a frozen snapshot of
the relevant `players` columns for each (auction, player) pair. The
auction now owns its view of each player it cares about, so a subsequent
xlsx re-import (which TRUNCATE/INSERTs `players`) cannot drift the
auction's data.

`player_id` remains intentionally NOT a foreign key to `players.id` for
the same reason as before.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


MANTRA_ROLE_VALUES = (
    "Por", "Dc", "Dd", "Ds", "B", "E", "M", "C", "W", "T", "A", "Pc",
)


def upgrade() -> None:
    op.rename_table("auction_evaluations", "auction_players")

    op.add_column(
        "auction_players",
        sa.Column("name", sa.Text(), nullable=True),
    )
    op.add_column(
        "auction_players",
        sa.Column("team", sa.Text(), nullable=True),
    )
    op.add_column(
        "auction_players",
        sa.Column(
            "mantra_roles",
            postgresql.ARRAY(
                postgresql.ENUM(
                    *MANTRA_ROLE_VALUES, name="mantra_role", create_type=False
                )
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "auction_players",
        sa.Column("fanta_evaluation", sa.Integer(), nullable=True),
    )
    op.add_column(
        "auction_players",
        sa.Column("fanta_market_value", sa.Integer(), nullable=True),
    )

    # Drop orphan rows (player_id not in players) — they can't satisfy the
    # NOT NULL constraints we're about to add and were already meaningless.
    op.execute(
        """
        DELETE FROM auction_players
        WHERE player_id NOT IN (SELECT id FROM players)
        """
    )

    # Backfill snapshot columns from current players state.
    op.execute(
        """
        UPDATE auction_players ap
        SET name = p.name,
            team = p.team,
            mantra_roles = p.mantra_roles,
            fanta_evaluation = p.fanta_evaluation,
            fanta_market_value = p.fanta_market_value
        FROM players p
        WHERE ap.player_id = p.id
        """
    )

    op.alter_column("auction_players", "name", nullable=False)
    op.alter_column("auction_players", "team", nullable=False)
    op.alter_column("auction_players", "mantra_roles", nullable=False)


def downgrade() -> None:
    op.drop_column("auction_players", "fanta_market_value")
    op.drop_column("auction_players", "fanta_evaluation")
    op.drop_column("auction_players", "mantra_roles")
    op.drop_column("auction_players", "team")
    op.drop_column("auction_players", "name")
    op.rename_table("auction_players", "auction_evaluations")
