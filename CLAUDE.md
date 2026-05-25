# Fantacalcio Mantra

Tools and (eventually) agents for the Italian Serie A fantasy football game **Fantacalcio**, played under the **Mantra** ruleset. Official rules: https://www.fantacalcio.it/regolamenti/sistema-mantra

## Project files

- `all_players.csv` — every player available in Serie A 2025/26.
- `rules.json` — Mantra role weights and the catalog of legal lineup modules.

CSVs share the same schema and use `;` as separator. The first row is a title banner; the real header is on row 2:

```
Id ; RM ; Nome ; Squadra ; Qt.A ; Qt.I ; Diff. ; Qt.A M ; Qt.I M ; Diff.M ; FVM ; FVM M
```

- `RM` — Mantra role(s). When a player has multiple roles they are quoted and separated by `;` inside the field (e.g. `"B;Ds;E"`).
- `Qt.*` — classic-mode quotations; `Qt.* M` are the Mantra-mode quotations.
- `FVM` / `FVM M` — Fanta-Valore-Mercato (market value), classic and Mantra.

## Roles (Mantra)

| Code | Italian          | Area       |
|------|------------------|------------|
| `P`  | Portiere         | goalkeeper |
| `Dc` | Difensore centrale | defense  |
| `Dd` | Difensore destro | defense    |
| `Ds` | Difensore sinistro | defense  |
| `B`  | Braccetto        | defense    |
| `E`  | Esterno          | wing-back  |
| `M`  | Mediano          | midfield   |
| `C`  | Centrocampista   | midfield   |
| `W`  | Ala (wing)       | attack     |
| `T`  | Trequartista     | attack     |
| `A`  | Attaccante       | attack     |
| `Pc` | Punta centrale   | striker    |

A player may have several roles. They are eligible for any slot whose accepted-role set contains at least one of theirs.

## Weights and the "12 rule"

Each role has an offensive weight (`rules.json -> weights`):

```
P=0  Dc=0  Dd=0  Ds=0  B=0  E=0  M=0
C=1  W=2  T=2  A=3  Pc=4
```

Every legal module in `rules.json -> modules` is calibrated so the **maximum total weight is exactly 12**. A slot expressed as e.g. `T/A/Pc` contributes the weight of whichever role you assign the player to in that slot.

Verified for all 11 modules in `rules.json`:

| Module | Max weight |
|--------|------------|
| 343    | 12 |
| 3412   | 12 |
| 3421   | 12 |
| 352    | 12 |
| 3511   | 12 |
| 433    | 12 |
| 4312   | 12 |
| 442    | 12 |
| 4141   | 12 |
| 4411   | 12 |
| 4231   | 12 |

Any new module added to `rules.json` MUST also max out at 12 — treat this as an invariant and check it before merging changes.

## Lineup-eligibility rules

A lineup is **legal** when:

1. The module name is one of the entries in `rules.json -> modules`.
2. Each of the 11 slots is filled by a distinct player from `team.csv`.
3. The player assigned to a slot has at least one role in that slot's accepted-role set (slots are written `Role1/Role2/...`).
4. The chosen role-assignments sum to a total weight `<= 12` (the cap; the listed modules are tuned so 12 is reachable).

Slot order in the JSON is positional (P first, then defenders, midfielders, attackers), but only the role constraints — not the order — affect legality.

## Conventions for code in this repo

- Read CSVs with `sep=';'` and `skiprows=1` (or handle the banner row explicitly).
- Treat `RM` as a list: split on `;` after stripping surrounding quotes.
- Treat slot specs in `rules.json` as a list: split on `/`.
- Do not hard-code role lists or weights in Python — read them from `rules.json` so the source of truth stays single.

