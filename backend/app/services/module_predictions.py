"""Predict the lineup module each team is building toward.

Per the rules in CLAUDE.md, every legal Mantra module has 11 positional
slots and each slot accepts a set of mantra roles.

For each team in an auction we score every module by solving the optimal
assignment of the team's purchases onto the module's 11 slots, weighting
each placed player by `price * (1 + role_weight)` (the +1 base keeps
zero-weight defenders in the signal — otherwise a Dd purchase would
contribute nothing and the 3-vs-4 defender distinction would vanish).

**Lowest-weight reduction (players)**: unlike the lineup-scoring
heuristic (which assumes a player slots at their highest-weight role),
prediction uses the opposite convention — each multi-role player is
reduced to the role(s) with the *lowest* weight. Rationale: when the
user buys a W/A they typically intend to use them as a W; treating them
as an A would falsely pull predictions toward A-heavy modules the user
isn't building. Ties on weight are kept (e.g. Dd/Dc both at weight 0
stays {Dd, Dc}) so positional flexibility within the same weight tier
is preserved.

**Fit-quality scaling (slots)**: an A/Pc slot's "true demand" is for
the highest-weight role it accepts (Pc, weight 4) — an A player in that
slot is the fallback, not the target. We capture this by scaling each
player's weight contribution by `fit = player_weight / slot_max_weight`
(1.0 when both are zero, e.g. a Por in the goalkeeper slot). So an A
(weight 3) in an A/Pc slot (max 4) contributes `price × (1 + 3 × 0.75)
= price × 3.25`, while the same A in a T/A slot (max 3) contributes
`price × (1 + 3 × 1.0) = price × 4`. Without this scaling, modules
with only A/Pc attacker slots would tie with modules that have an
explicit T/A or W/A slot whenever the user bought an A — masking the
"this slot really wants a Pc" signal.

The achieved score per module is divided by the team's best-scoring
module so the top module = 1.0 and the rest fall in `[0, 1]`. Teams with
zero purchases get 1.0 for every module (no signal → all equally
plausible).

Public surface: ``compute_module_predictions(session, auction)`` returns
``{team_id: {module_name: confidence_0_to_1}}``. The endpoint wraps this
in the response shape with team names and sorted module lists.
"""

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import (
    Auction,
    AuctionPlayer,
    AuctionPurchase,
    AuctionTeam,
    LineupModule,
    LineupModuleSlot,
    MantraRole,
    RoleWeight,
)


# A slot's max contribution from any role its weights table knows. With
# Mantra rules every weight is in [0, 4], so this fits in 32-bit easily
# even for very expensive purchases.
_INF = float("inf")


def compute_module_predictions(
    session: Session, auction: Auction
) -> dict[int, dict[str, float]]:
    """Return {team_id: {module_name: confidence}} for every team."""
    weights = _load_weights(session)
    modules = _load_modules(session)  # [(name, [frozenset[MantraRole], ...]), ...]
    teams = list(
        session.execute(
            select(AuctionTeam)
            .where(AuctionTeam.auction_id == auction.id)
            .order_by(AuctionTeam.id)
        ).scalars()
    )
    purchases_by_team = _load_purchases_by_team(session, auction.id)

    module_names = [name for name, _ in modules]

    out: dict[int, dict[str, float]] = {}
    for team in teams:
        purchases = purchases_by_team.get(team.id, [])
        if not purchases:
            out[team.id] = {name: 1.0 for name in module_names}
            continue

        reduced = [
            (price, _lowest_weight_roles(roles, weights))
            for price, roles in purchases
        ]
        achieved: dict[str, float] = {}
        for name, slots in modules:
            matrix = _value_matrix(reduced, slots, weights)
            achieved[name] = _rectangular_assignment_max(matrix)

        best = max(achieved.values())
        if best <= 0:
            out[team.id] = {name: 1.0 for name in module_names}
        else:
            out[team.id] = {name: achieved[name] / best for name in module_names}
    return out


def _load_weights(session: Session) -> dict[MantraRole, int]:
    return {
        row.role: int(row.weight)
        for row in session.execute(select(RoleWeight)).scalars()
    }


def _load_modules(
    session: Session,
) -> list[tuple[str, list[frozenset[MantraRole]]]]:
    rows = session.execute(
        select(
            LineupModule.id,
            LineupModule.name,
            LineupModuleSlot.position,
            LineupModuleSlot.allowed_roles,
        )
        .join(LineupModuleSlot, LineupModuleSlot.module_id == LineupModule.id)
        .order_by(LineupModule.id, LineupModuleSlot.position)
    ).all()

    names: dict[int, str] = {}
    slots: dict[int, list[frozenset[MantraRole]]] = defaultdict(list)
    for module_id, name, _position, allowed in rows:
        names[module_id] = name
        slots[module_id].append(frozenset(allowed))
    return [(names[mid], slots[mid]) for mid in names]


def _load_purchases_by_team(
    session: Session, auction_id: int
) -> dict[int, list[tuple[int, frozenset[MantraRole]]]]:
    """Return {team_id: [(price, frozenset(mantra_roles)), ...]}."""
    rows = session.execute(
        select(
            AuctionPurchase.team_id,
            AuctionPurchase.price,
            AuctionPlayer.mantra_roles,
        )
        .join(
            AuctionPlayer,
            (AuctionPlayer.auction_id == AuctionPurchase.auction_id)
            & (AuctionPlayer.player_id == AuctionPurchase.player_id),
        )
        .where(AuctionPurchase.auction_id == auction_id)
    ).all()

    out: dict[int, list[tuple[int, frozenset[MantraRole]]]] = defaultdict(list)
    for team_id, price, roles in rows:
        out[team_id].append((int(price), frozenset(roles)))
    return dict(out)


def _lowest_weight_roles(
    roles: frozenset[MantraRole], weights: dict[MantraRole, int]
) -> frozenset[MantraRole]:
    """Drop higher-weighted alternatives from a multi-role player.

    A W/A player becomes {W} (W has lower weight than A); a Dd/Dc player
    keeps both (same weight, no demotion to do). See module docstring
    for the rationale.
    """
    if not roles:
        return roles
    lo = min(weights[r] for r in roles)
    return frozenset(r for r in roles if weights[r] == lo)


def _value_matrix(
    purchases: list[tuple[int, frozenset[MantraRole]]],
    slots: list[frozenset[MantraRole]],
    weights: dict[MantraRole, int],
) -> list[list[float]]:
    """Build the |purchases| × |slots| value matrix.

    `value[i][j] = price_i * (1 + player_weight * fit)` where
    `player_weight = max(weights[r] for r in roles_i ∩ slots_j)` and
    `fit = player_weight / slot_max_weight` (1.0 when the slot's max is
    zero, e.g. the Por slot). Empty intersection → 0.
    """
    matrix: list[list[float]] = []
    for price, roles in purchases:
        row: list[float] = []
        for allowed in slots:
            shared = roles & allowed
            if not shared:
                row.append(0.0)
            else:
                player_weight = max(weights[r] for r in shared)
                slot_max = max(weights[r] for r in allowed)
                fit = 1.0 if slot_max == 0 else player_weight / slot_max
                row.append(price * (1.0 + player_weight * fit))
        matrix.append(row)
    return matrix


def _rectangular_assignment_max(matrix: list[list[float]]) -> float:
    """Return the maximum sum picking at most one cell per row and per
    column. Implementation: pad to a square with zeros and run a
    minimization Hungarian on `M - value`."""
    rows = len(matrix)
    cols = len(matrix[0]) if rows else 0
    if rows == 0 or cols == 0:
        return 0.0

    n = max(rows, cols)
    big = max(max(row) for row in matrix)
    # Pad to square. Padded cells have value 0, so cost = big - 0 = big
    # and the assignment will prefer real cells whenever possible.
    cost: list[list[float]] = [[big] * n for _ in range(n)]
    for i in range(rows):
        for j in range(cols):
            cost[i][j] = big - matrix[i][j]

    min_cost = _hungarian_min(cost)
    # Each of the n rows is assigned to one of n cols. Real cells
    # contribute (big - value); padded cells contribute big. So
    # min_cost = n*big - sum(selected real values). Solve for the sum.
    return n * big - min_cost


def _hungarian_min(cost: list[list[float]]) -> float:
    """Solve the n×n assignment problem (minimisation).

    Standard O(n³) potentials-based implementation (the e-maxx variant).
    Returns just the total cost — we don't need the assignment indices.
    1-indexed internally to keep the algorithm transcribable; arrays
    sized n+1 to accommodate the leading sentinel.
    """
    n = len(cost)
    INF = _INF
    u = [0.0] * (n + 1)
    v = [0.0] * (n + 1)
    p = [0] * (n + 1)
    way = [0] * (n + 1)

    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = [INF] * (n + 1)
        used = [False] * (n + 1)

        while True:
            used[j0] = True
            i0 = p[j0]
            delta = INF
            j1 = 0
            for j in range(1, n + 1):
                if used[j]:
                    continue
                cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                if cur < minv[j]:
                    minv[j] = cur
                    way[j] = j0
                if minv[j] < delta:
                    delta = minv[j]
                    j1 = j

            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta

            j0 = j1
            if p[j0] == 0:
                break

        while j0 != 0:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1

    total = 0.0
    for j in range(1, n + 1):
        if p[j] != 0:
            total += cost[p[j] - 1][j - 1]
    return total
