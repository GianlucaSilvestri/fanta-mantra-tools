"""simplify player columns and add user_market_value

We only need the Mantra-mode evaluation and FVM. Everything classic-mode plus
qt_i_m / diff_m is unused. While we're here, halve+round the kept FVM (per
product decision) and add a nullable user-supplied market value column whose
contents must survive future re-imports.

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("players", sa.Column("user_market_value", sa.Integer(), nullable=True))

    for col in ("qt_a", "qt_i", "diff", "qt_i_m", "diff_m", "fvm"):
        op.drop_column("players", col)

    op.alter_column("players", "qt_a_m", new_column_name="fanta_evaluation")
    op.alter_column("players", "fvm_m", new_column_name="fanta_market_value")

    # Bring existing data in line with the new "halve + round" rule so the DB
    # stays consistent even if the user doesn't immediately re-import.
    op.execute(
        "UPDATE players "
        "SET fanta_market_value = round(fanta_market_value / 2.0) "
        "WHERE fanta_market_value IS NOT NULL"
    )


def downgrade() -> None:
    # Best-effort reverse: undo the halving, rename back, re-add the dropped
    # columns as nullable (we don't have the data to backfill them).
    op.execute(
        "UPDATE players "
        "SET fanta_market_value = fanta_market_value * 2 "
        "WHERE fanta_market_value IS NOT NULL"
    )
    op.alter_column("players", "fanta_market_value", new_column_name="fvm_m")
    op.alter_column("players", "fanta_evaluation", new_column_name="qt_a_m")
    for col in ("fvm", "diff_m", "qt_i_m", "diff", "qt_i", "qt_a"):
        op.add_column("players", sa.Column(col, sa.Integer(), nullable=True))
    op.drop_column("players", "user_market_value")
