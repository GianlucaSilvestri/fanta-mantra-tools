"""replace singleton preferences with first-class auctions

Drops `user_preferences` (singleton) and `user_evaluations` (data declared
garbage by the user), then creates `auction`, `auction_teams`, and
`auction_evaluations` so the app can hold multiple auctions side-by-side,
each with its own preferences, teams, evaluations, and lifecycle status.

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


AUCTION_STATUS_VALUES = ("INITIAL", "IN_PROGRESS", "TERMINATED")


def upgrade() -> None:
    op.drop_table("user_evaluations")
    op.drop_table("user_preferences")

    auction_status = postgresql.ENUM(*AUCTION_STATUS_VALUES, name="auction_status")
    auction_status.create(op.get_bind(), checkfirst=False)

    op.create_table(
        "auction",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(*AUCTION_STATUS_VALUES, name="auction_status", create_type=False),
            nullable=False,
            server_default="INITIAL",
        ),
        sa.Column("number_of_auctioners", sa.Integer(), nullable=False),
        sa.Column("min_team_size", sa.Integer(), nullable=False),
        sa.Column("max_team_size", sa.Integer(), nullable=False),
        sa.Column("credits_per_team", sa.Integer(), nullable=False),
        sa.Column("number_of_goalkeepers", sa.Integer(), nullable=False),
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
        sa.CheckConstraint(
            "max_team_size >= min_team_size", name="auction_team_size_range"
        ),
    )

    op.create_table(
        "auction_teams",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "auction_id",
            sa.Integer(),
            sa.ForeignKey("auction.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("team_name", sa.Text(), nullable=False),
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
        sa.UniqueConstraint("auction_id", "team_name", name="auction_teams_unique"),
    )

    # player_id is intentionally NOT a foreign key to players.id, so the
    # TRUNCATE players that runs on every xlsx re-import doesn't cascade
    # into here. Orphans from a later xlsx are tolerated.
    op.create_table(
        "auction_evaluations",
        sa.Column(
            "auction_id",
            sa.Integer(),
            sa.ForeignKey("auction.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("evaluation", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("auction_id", "player_id"),
    )


def downgrade() -> None:
    op.drop_table("auction_evaluations")
    op.drop_table("auction_teams")
    op.drop_table("auction")
    postgresql.ENUM(name="auction_status").drop(op.get_bind(), checkfirst=False)

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

    op.create_table(
        "user_evaluations",
        sa.Column("player_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("evaluation", sa.Integer(), nullable=True),
    )
