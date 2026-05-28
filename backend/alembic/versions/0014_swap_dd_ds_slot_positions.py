"""swap Dd and Ds in lineup_module_slots so the pitch renders the right
back on the right and the left back on the left

The pitch UI (`module-pitch`, `module-lineup-dialog`) sorts slots by
`position` ascending and lays them out left-to-right within each row.
The original seed in 0013 put `Dd` (Difensore destro / right back) at
the lower position and `Ds` (Difensore sinistro / left back) at the
higher position, which displays them backwards. Swap the two so the
visual layout matches their semantic side.

Safe: `Dd` and `Ds` only appear as single-role slots in the seeded
modules (never inside a multi-role set like `{Dd, Dc}`), so the swap
is a 1:1 substitution. Player eligibility still works (a Dd player
matches a Dd slot, just at a different position number), and both
roles have weight 0 so the "max weight = 12" module invariant is
unaffected.

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-28

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0014"
down_revision: Union[str, Sequence[str], None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SWAP_SQL = """
    UPDATE lineup_module_slots
    SET allowed_roles = CASE
        WHEN allowed_roles = ARRAY['Dd']::mantra_role[]
            THEN ARRAY['Ds']::mantra_role[]
        WHEN allowed_roles = ARRAY['Ds']::mantra_role[]
            THEN ARRAY['Dd']::mantra_role[]
        ELSE allowed_roles
    END
    WHERE allowed_roles = ARRAY['Dd']::mantra_role[]
       OR allowed_roles = ARRAY['Ds']::mantra_role[]
"""


def upgrade() -> None:
    op.execute(_SWAP_SQL)


def downgrade() -> None:
    op.execute(_SWAP_SQL)
