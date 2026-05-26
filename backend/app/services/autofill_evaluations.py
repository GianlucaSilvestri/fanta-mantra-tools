"""Algorithmic autofill of auction_evaluations from fanta_market_value.

Two-phase algorithm:

1. **Goalkeepers first**: pick the top `N × number_of_goalkeepers` by
   `fanta_market_value` and assign each their FVM as-is (already in base-1000,
   the same scale as the stored evaluation). If the GK total would leave less
   than 1 credit per outfielder, scale the GKs proportionally down.
2. **Outfielders fill the rest**: pick the top
   `N × max_team_size - N × number_of_goalkeepers` non-goalkeepers by FVM,
   then distribute the remaining budget (`N × 1000 - gk_sum`) across them
   proportionally to FVM using the largest-remainder method. This guarantees
   an exact integer sum, every value >= 1, and the closest-to-proportional
   integer allocation.

Hard guarantees on output:
- exactly `N × max_team_size` evaluations
- exactly `N × number_of_goalkeepers` of them are goalkeepers
- sum of values == `N × 1000` exactly (base-1000)
- every value >= 1

All three groups of `GET /auctions/{id}/evaluations/status` therefore come out
`"ok"` (strict equality, see `_classify_target`).
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import Auction, MantraRole, Player


GK_ROLE = MantraRole.Por.value


def compute_autofill_evaluations(
    session: Session, auction: Auction
) -> dict[int, int]:
    """Return {player_id: evaluation_in_base_1000} for the given auction."""
    n = auction.number_of_auctioners
    credits_per_team = auction.credits_per_team
    gk_target = auction.number_of_goalkeepers * n
    total_target = auction.max_team_size * n
    outfield_target = total_target - gk_target
    total_budget = 1000 * n

    # Floor for stored values so they render as >= 1 credit in the UI
    # (display = floor(stored * credits_per_team / 1000) must be >= 1).
    min_stored = -(-1000 // credits_per_team)  # ceil(1000 / credits_per_team)

    if outfield_target < 0:
        raise ValueError(
            f"max_team_size ({auction.max_team_size}) must be >= "
            f"number_of_goalkeepers ({auction.number_of_goalkeepers})"
        )
    if total_budget < total_target * min_stored:
        raise ValueError(
            f"budget ({total_budget}) cannot fit {total_target} players "
            f"at >={min_stored} each (credits_per_team={credits_per_team})"
        )

    gks = _top_players(session, gk_only=True, limit=gk_target)
    if len(gks) < gk_target:
        raise ValueError(
            f"not enough goalkeepers with fanta_market_value: "
            f"need {gk_target}, found {len(gks)}"
        )

    gk_items = [(p.id, int(p.fanta_market_value)) for p in gks]

    # Cap the GK budget so each outfielder still gets at least min_stored.
    gk_budget_cap = total_budget - outfield_target * min_stored
    naive_gk = {pid: max(min_stored, v) for pid, v in gk_items}
    if sum(naive_gk.values()) > gk_budget_cap:
        gk_values = _allocate_proportional(
            gk_items, gk_budget_cap, min_per_item=min_stored
        )
    else:
        gk_values = naive_gk

    outfielders = _top_players(
        session, gk_only=False, limit=outfield_target, exclude_ids=set(gk_values)
    )
    if len(outfielders) < outfield_target:
        raise ValueError(
            f"not enough outfielders with fanta_market_value: "
            f"need {outfield_target}, found {len(outfielders)}"
        )

    non_gk_budget = total_budget - sum(gk_values.values())
    outfield_items = [(p.id, int(p.fanta_market_value)) for p in outfielders]
    outfield_values = _allocate_proportional(
        outfield_items, non_gk_budget, min_per_item=min_stored
    )

    return {**gk_values, **outfield_values}


def _top_players(
    session: Session,
    *,
    gk_only: bool,
    limit: int,
    exclude_ids: set[int] | None = None,
) -> list[Player]:
    stmt = select(Player).where(Player.fanta_market_value.is_not(None))
    if gk_only:
        stmt = stmt.where(Player.mantra_roles.any(GK_ROLE))
    else:
        stmt = stmt.where(~Player.mantra_roles.any(GK_ROLE))
    if exclude_ids:
        stmt = stmt.where(Player.id.notin_(exclude_ids))
    stmt = stmt.order_by(
        Player.fanta_market_value.desc(), Player.id.asc()
    ).limit(limit)
    return list(session.execute(stmt).scalars())


def _allocate_proportional(
    items: list[tuple[int, int]], total: int, min_per_item: int = 1
) -> dict[int, int]:
    """Distribute `total` across `items` proportionally to weights.

    Each item is (id, weight). Returns {id: value} with sum == total exactly
    and every value >= min_per_item. Uses the largest-remainder method on
    top of a floor of `min_per_item` per item.
    """
    n = len(items)
    if n == 0:
        if total != 0:
            raise ValueError(f"cannot allocate {total} across 0 items")
        return {}
    if total < n * min_per_item:
        raise ValueError(
            f"cannot allocate {total} across {n} items at >={min_per_item} each"
        )

    extra_budget = total - n * min_per_item
    weight_sum = sum(w for _, w in items)

    if weight_sum <= 0:
        # No weight signal → distribute the extra evenly.
        base = extra_budget // n
        leftover = extra_budget - base * n
        result: dict[int, int] = {}
        for i, (pid, _) in enumerate(items):
            result[pid] = min_per_item + base + (1 if i < leftover else 0)
        return result

    floats = [(pid, w * extra_budget / weight_sum) for pid, w in items]
    floors = [(pid, int(f)) for pid, f in floats]
    used = sum(v for _, v in floors)
    leftover = extra_budget - used  # always >= 0 and < n

    # Award the +1 leftover units to the items with the largest fractional
    # remainder (largest-remainder method). Tiebreak by original order
    # (highest weight first) so deterministic.
    remainders = sorted(
        range(n),
        key=lambda i: (floats[i][1] - floors[i][1], -i),
        reverse=True,
    )
    extras = set(remainders[:leftover])

    result = {}
    for i, (pid, base) in enumerate(floors):
        result[pid] = min_per_item + base + (1 if i in extras else 0)
    return result
