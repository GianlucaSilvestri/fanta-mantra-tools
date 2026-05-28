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


def compute_module_lineup(
    session: Session,
    auction: Auction,
    team_id: int,
    module_name: str,
) -> dict:
    """Compute the optimal player→slot assignment for one team & module.

    Mirrors the algorithm used by `compute_module_predictions` (same
    lowest-weight role reduction, same fit-quality scaled value
    matrix), but exposes the assignment indices so the UI can show
    *why* a module is being recommended — the actual lineup the team's
    purchases produce, plus which players are left on the bench.

    Raises ``LookupError`` if ``module_name`` is not a known module.
    """
    weights = _load_weights(session)
    modules = _load_modules(session)
    target = next(((n, s) for n, s in modules if n == module_name), None)
    if target is None:
        raise LookupError(f"unknown module {module_name!r}")
    _name, slots = target

    purchases = _load_team_purchases_full(session, auction.id, team_id)

    slot_payloads = [
        {"position": i + 1, "allowed_roles": [r.value for r in s]}
        for i, s in enumerate(slots)
    ]

    if not purchases:
        return {
            "module_name": module_name,
            "score": 0.0,
            "slots": [{**sp, "player": None} for sp in slot_payloads],
            "bench": [],
        }

    reduced_roles = [
        _lowest_weight_roles(frozenset(p["mantra_roles"]), weights)
        for p in purchases
    ]
    matrix = _value_matrix(
        [(p["price"], rr) for p, rr in zip(purchases, reduced_roles, strict=True)],
        slots,
        weights,
    )
    score, slot_to_row = _rectangular_assignment_max_with_indices(matrix)

    used_rows: set[int] = set()
    enriched_slots: list[dict] = []
    for j, slot_payload in enumerate(slot_payloads):
        r = slot_to_row[j]
        if r is None:
            enriched_slots.append({**slot_payload, "player": None})
            continue
        p = purchases[r]
        # The actual role the player is being slotted as: the highest-weight
        # role in (player's lowest-weight roles ∩ slot's allowed roles).
        intersection = reduced_roles[r] & slots[j]
        assigned_role = (
            max(intersection, key=lambda x: weights[x]).value if intersection else None
        )
        enriched_slots.append(
            {
                **slot_payload,
                "player": {
                    "id": p["player_id"],
                    "name": p["name"],
                    "team": p["team"],
                    "mantra_roles": [r.value for r in p["mantra_roles"]],
                    "price": p["price"],
                    "assigned_role": assigned_role,
                    "contribution": round(matrix[r][j], 2),
                },
            }
        )
        used_rows.add(r)

    bench = [
        {
            "id": p["player_id"],
            "name": p["name"],
            "team": p["team"],
            "mantra_roles": [r.value for r in p["mantra_roles"]],
            "price": p["price"],
        }
        for i, p in enumerate(purchases)
        if i not in used_rows
    ]

    return {
        "module_name": module_name,
        "score": round(score, 2),
        "slots": enriched_slots,
        "bench": bench,
    }


def compute_player_interest(
    session: Session,
    auction: Auction,
    player: AuctionPlayer,
) -> dict:
    """Per-team buying interest for one player.

    For each team we estimate how much adding ``player`` (at the player's
    scaled fanta_market_value) would lift the team's best-fit module
    score, weighted by how committed the team already is to that module.
    The result is multiplied by an affordability factor (does the team
    have credits left to buy at market value?) and a broadness factor
    keyed off the player's market value — cheap players surface fewer
    interested teams, expensive ones surface more.

    Returns ``{auction_id, player_id, mv_scaled, broadness, teams: [...]}``
    where ``teams`` is every team in the auction sorted by confidence
    descending.
    """
    weights = _load_weights(session)
    modules = _load_modules(session)
    purchases_by_team = _load_purchases_by_team(session, auction.id)

    teams = list(
        session.execute(
            select(AuctionTeam)
            .where(AuctionTeam.auction_id == auction.id)
            .order_by(AuctionTeam.id)
        ).scalars()
    )

    credits_per_team = int(auction.credits_per_team)
    raw_mv = int(player.fanta_market_value or 0)
    # The stored value is base-1000; scale into the auction's budget.
    # Floor at 1 when raw_mv > 0 so a sub-credit market value still
    # contributes some signal to the assignment matrix.
    mv_scaled = max(1, round(raw_mv * credits_per_team / 1000)) if raw_mv > 0 else 0

    # mv_anchor ≈ 10% of the per-team budget. A player at or above the
    # anchor is "broadly desirable" (broadness=1.0); a player well below
    # shrinks every team's bar proportionally.
    mv_anchor = max(1, credits_per_team * 0.10)
    broadness = max(0.1, min(1.0, mv_scaled / mv_anchor)) if mv_scaled > 0 else 0.1

    player_roles_reduced = _lowest_weight_roles(
        frozenset(player.mantra_roles), weights
    )

    per_team: list[dict] = []
    for team in teams:
        purchases = purchases_by_team.get(team.id, [])
        spent = sum(price for price, _ in purchases)
        remaining = max(0, credits_per_team - spent)

        # Module-by-module: solve assignment without and with the
        # hypothetical purchase at the player's market value.
        old_scores: list[float] = []
        deltas: list[float] = []
        for _name, slots in modules:
            old_matrix = _value_matrix(purchases, slots, weights)
            new_matrix = _value_matrix(
                [*purchases, (mv_scaled, player_roles_reduced)],
                slots,
                weights,
            )
            old_score = _rectangular_assignment_max(old_matrix)
            new_score = _rectangular_assignment_max(new_matrix)
            old_scores.append(old_score)
            deltas.append(max(0.0, new_score - old_score))

        best_old = max(old_scores) if old_scores else 0.0
        if best_old > 0:
            # Favor modules the team is already committed to: weight
            # each module's marginal gain by how strong that module
            # already is relative to the team's best module.
            fit = max(
                (
                    delta * (old / best_old)
                    for delta, old in zip(deltas, old_scores, strict=True)
                ),
                default=0.0,
            )
        else:
            # Empty team — no commitment yet to weight by. Use the raw
            # max marginal gain so empty teams aren't unfairly zeroed.
            fit = max(deltas, default=0.0)

        if mv_scaled <= 0:
            afford = 1.0
        else:
            afford = min(1.0, remaining / mv_scaled)

        raw = fit * afford
        per_team.append(
            {
                "team_id": team.id,
                "team_name": team.team_name,
                "fit": round(fit, 2),
                "afford": round(afford, 4),
                "remaining_credit": remaining,
                "_raw": raw,
            }
        )

    max_raw = max((row["_raw"] for row in per_team), default=0.0)
    for row in per_team:
        rel = (row["_raw"] / max_raw) if max_raw > 0 else 0.0
        row["confidence"] = round(rel * broadness, 4)
        del row["_raw"]

    per_team.sort(key=lambda r: r["confidence"], reverse=True)

    return {
        "auction_id": auction.id,
        "player_id": player.player_id,
        "mv_scaled": mv_scaled,
        "broadness": round(broadness, 4),
        "teams": per_team,
    }


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


def _load_team_purchases_full(
    session: Session, auction_id: int, team_id: int
) -> list[dict]:
    """Full purchase rows for one team — used by the lineup explainer.

    Returns dicts with player_id/name/team/mantra_roles/price, sorted by
    name. The prediction hot-path uses the leaner `_load_purchases_by_team`.
    """
    rows = session.execute(
        select(
            AuctionPurchase.player_id,
            AuctionPurchase.price,
            AuctionPlayer.name,
            AuctionPlayer.team,
            AuctionPlayer.mantra_roles,
        )
        .join(
            AuctionPlayer,
            (AuctionPlayer.auction_id == AuctionPurchase.auction_id)
            & (AuctionPlayer.player_id == AuctionPurchase.player_id),
        )
        .where(
            AuctionPurchase.auction_id == auction_id,
            AuctionPurchase.team_id == team_id,
        )
        .order_by(AuctionPlayer.name)
    ).all()

    return [
        {
            "player_id": int(pid),
            "name": pname,
            "team": pteam,
            "mantra_roles": tuple(proles),
            "price": int(price),
        }
        for pid, price, pname, pteam, proles in rows
    ]


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
    column."""
    return _rectangular_assignment_max_with_indices(matrix)[0]


def _rectangular_assignment_max_with_indices(
    matrix: list[list[float]],
) -> tuple[float, list[int | None]]:
    """Maximum-sum rectangular assignment plus the chosen indices.

    Returns ``(total, slot_to_row)`` where ``slot_to_row[j]`` is the
    0-indexed row assigned to column j, or ``None`` if no real row was
    picked for that column (slot left empty: either filled by a padding
    dummy or by a zero-value real cell — a player with no role
    intersection contributes nothing, so we treat it as "no fit").

    Implementation: pad the matrix to a square with zeros and run a
    minimization Hungarian on ``big - value``.
    """
    rows = len(matrix)
    cols = len(matrix[0]) if rows else 0
    if rows == 0 or cols == 0:
        return 0.0, [None] * cols

    n = max(rows, cols)
    big = max(max(row) for row in matrix)
    # Pad to square. Padded cells have value 0, so cost = big - 0 = big
    # and the assignment will prefer real cells whenever possible.
    cost: list[list[float]] = [[big] * n for _ in range(n)]
    for i in range(rows):
        for j in range(cols):
            cost[i][j] = big - matrix[i][j]

    min_cost, col_to_row = _hungarian_min(cost)
    # Each of the n rows is assigned to one of n cols. Real cells
    # contribute (big - value); padded cells contribute big. So
    # min_cost = n*big - sum(selected real values). Solve for the sum.
    total = n * big - min_cost

    slot_to_row: list[int | None] = [None] * cols
    for j in range(cols):
        r = col_to_row[j]
        if r is None or r >= rows:
            continue
        if matrix[r][j] <= 0:
            # Zero-value real cell — no role intersection, treat as unfilled.
            continue
        slot_to_row[j] = r
    return total, slot_to_row


def _hungarian_min(cost: list[list[float]]) -> tuple[float, list[int | None]]:
    """Solve the n×n assignment problem (minimisation).

    Standard O(n³) potentials-based implementation (the e-maxx variant).
    Returns ``(total_cost, col_to_row)`` where ``col_to_row[j]`` is the
    0-indexed row matched to column j (always populated for a square
    matrix). 1-indexed internally to keep the algorithm transcribable;
    arrays sized n+1 to accommodate the leading sentinel.
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
    col_to_row: list[int | None] = [None] * n
    for j in range(1, n + 1):
        if p[j] != 0:
            total += cost[p[j] - 1][j - 1]
            col_to_row[j - 1] = p[j] - 1
    return total, col_to_row
