# Fantacalcio Mantra

Small full-stack app for the Italian Serie A fantasy football game **Fantacalcio**, played under the **Mantra** ruleset. Official rules: https://www.fantacalcio.it/regolamenti/sistema-mantra

## League setup

This project targets a specific league with:

- **10 teams**, each with a budget of **500 credits**.
- Each team has a **30-player roster**, of which **3 must be goalkeepers**.
- Empirically, each team spends on average **~16 credits (≈3% of budget) on ~9 sub-5-credit players** — typically backups/substitutions and squad fillers, not starters.

## Architecture

Everything runs in Docker via `docker-compose.yml`:

- **`db`** — `postgres:16-alpine`. Internal port `5432`; exposed on host `127.0.0.1:5433` (avoids clashing with a host Postgres on `5432`). Data persisted in named volume `pgdata`. Default creds `fanta:fanta`, db `fanta_mantra`.
- **`backend`** — FastAPI on `http://localhost:8000`. Built from `backend/Dockerfile` (Python 3.14 + uv). On container start: runs `alembic upgrade head`, then `uvicorn --reload`. The host `./backend` and `./data` directories are bind-mounted so code changes hot-reload and the import script can see the xlsx.
- **`ui`** — LIT + TypeScript + Vite dev server on `http://localhost:5173`. Built from `ui/Dockerfile` (Node 20 + yarn). Host `./ui` is bind-mounted (with `node_modules` preserved from the image) so source edits hot-reload.
- **Config** — `DATABASE_URL` is set by compose for the backend container (`postgresql+psycopg2://fanta:fanta@db:5432/fanta_mantra`). A host-side `.env` is optional and only used when running backend Python scripts directly on the host.
- **Data refresh** — weekly: download the latest `Quotazioni_Fantacalcio_Stagione_2025_26.xlsx` from fantacalcio.it into `data/`, then run the import inside the backend container (see below). The script **truncates** the `players` table and re-inserts (no upsert, no transfer history).

## Project files

- `data/Quotazioni_Fantacalcio_Stagione_2025_26.xlsx` — **canonical source**. Original export from fantacalcio.it, season 2025/26. Sheets: `Tutti` (532 active players — the one we import), `Portieri`, `Difensori`, `Centrocampisti`, `Attaccanti`, `Ceduti` (131 transferred-out — intentionally NOT imported). Schema per sheet: `Id, R, RM, Nome, Squadra, Qt.A, Qt.I, Diff., Qt.A M, Qt.I M, Diff.M, FVM, FVM M`. Row 1 is a banner; the header is on row 2.
- Mantra game-rule reference data lives in the database (seeded by migration `0013`): `role_weights` (per-role offensive weight) and `lineup_modules` + `lineup_module_slots` (the 11 legal modules, each with 11 positional slots and an `allowed_roles` set). Models in `backend/app/models.py`.
- `backend/app/` — FastAPI app: `main.py`, `config.py`, `db.py`, `models.py`, `routers/health.py`, `routers/players.py`, `routers/auctions.py`.
- `backend/alembic/` — migrations.
- `backend/scripts/import_players.py` — both a CLI and a library. Exposes `parse_players(source)` (path/bytes/file-like → `list[Player]`, raises on bad data) and `write_players(rows)` (TRUNCATE + INSERT in one transaction). The CLI just chains the two.
- `ui/src/components/app-root.ts` — LIT root shell. Hand-rolled router (no library): tracks both `pathname` and `search`, renders `<home-page>` for `/` and `<settings-page>` for `/settings`. Anything else falls through to a "Not found" message. Components can navigate by dispatching an `app-navigate` CustomEvent on `window` (detail: `{path, search?}`).
- `ui/src/components/home-page.ts` — orchestrator. Fetches `GET /auctions` on mount, renders one card per auction (plus a "+ New auction" tile) and a center panel below. Clicking a card selects the auction and syncs `?auction_id=N` into the URL. The center panel swaps based on the selected auction's status: `<auction-evaluations>` while `INITIAL`, `<auction-running>` while `IN_PROGRESS`, `<auction-finished>` while `TERMINATED`. Mounts a single `<auction-dialog>` for create + edit flows.
- `ui/src/components/auction-dialog.ts` — single native `<dialog>` for both creating and editing an auction. Edit mode exposes inline team add/remove (POST/DELETE `/auctions/{id}/teams[/{team_id}]`); create mode bundles teams into the `POST /auctions` body. Dispatches `auction-saved` on success.
- `ui/src/components/auction-evaluations.ts` — the player evaluation panel rendered when the selected auction is `INITIAL`. Loads `GET /players?auction_id={id}` + `GET /auctions/{id}/evaluations/status`, renders the indicator card (credits / players / goalkeepers), filters/sorts (team, role, name; default sort `fanta_evaluation DESC`), CSV export/import (`/evaluations/export` and `/evaluations/import`), and an editable `evaluation` column whose values are normalised to the 1000-credit base before being saved (`PATCH /auctions/{id}/evaluations/{player_id}`). At the top, a "Start auction" button enables only when all three status groups are `"ok"`; click → `PATCH /auctions/{id}` with `{status: "IN_PROGRESS"}` then dispatches `auction-started`.
- `ui/src/components/auction-running.ts`, `ui/src/components/auction-finished.ts` — placeholder panels for the `IN_PROGRESS` and `TERMINATED` states. Currently just render "todo auction" / "todo finished".
- `ui/src/components/settings-page.ts` — single section: **Player data** file-upload form that POSTs the chosen xlsx to `/players/import` (with a confirm dialog since it wipes the table). Auction preferences live on the home page now.

### Frontend styling

The UI uses **Tailwind CSS v4** via the official `@tailwindcss/vite` plugin (no `tailwind.config.js` or `postcss.config.js` — Tailwind v4 auto-discovers sources). A single `ui/src/index.css` with `@import "tailwindcss";` is imported from `ui/src/main.ts`.

LIT components render to **light DOM** (each overrides `createRenderRoot()` to return `this`) so Tailwind utility classes apply normally. There are no `static styles = css\`…\`` blocks — every component composes Tailwind utilities directly in `html\`…\`` templates.

## Database schema

Two Postgres enums + four tables (defined in `backend/app/models.py`, migrations in `backend/alembic/versions/`):

- Enum `mantra_role`: `Por, Dc, Dd, Ds, B, E, M, C, W, T, A, Pc` (12 values). Stable — defined by the game rules, doesn't drift season-to-season.
- Enum `auction_status`: `INITIAL, IN_PROGRESS, TERMINATED`. Lifecycle for each auction. Only `INITIAL` allows edits (preferences, teams, evaluations).
- Table `players` (file-driven; wiped + reinserted on every xlsx import):
  - `id` (int PK, the fantacalcio.it Id from the xlsx)
  - `name`, `team` (text, file-driven)
  - `mantra_roles` (`mantra_role[]`)
  - `fanta_evaluation` (int, nullable) — sourced from the xlsx `Qt.A M` column.
  - `fanta_market_value` (int, nullable) — sourced from the xlsx `FVM M` column, stored as-is.
- Table `auction` (user-supplied; one row per auction the user wants to run side-by-side):
  - `id` (serial PK), `name` (text NOT NULL), `description` (text, nullable).
  - `status` (`auction_status` NOT NULL, default `INITIAL`).
  - `number_of_auctioners`, `min_team_size`, `max_team_size`, `credits_per_team`, `number_of_goalkeepers` — int NOT NULL, the per-auction preferences (carried over from the old `user_preferences`).
  - `created_at`, `updated_at` (TIMESTAMPTZ NOT NULL, defaulted to `now()`; `updated_at` auto-bumped via SQLAlchemy `onupdate`).
  - CHECK `max_team_size >= min_team_size`.
- Table `auction_teams` (the teams participating in a given auction; **fully editable only while the parent auction is `INITIAL`**):
  - `id` (serial PK), `auction_id` (int NOT NULL, FK → `auction.id` ON DELETE CASCADE), `team_name` (text NOT NULL).
  - `is_my_team` (bool NOT NULL, default FALSE) — marks the single team the user themselves controls. Enforced at-most-one-per-auction by a partial unique index `(auction_id) WHERE is_my_team = true`. Required to be set on exactly one team before the `INITIAL → IN_PROGRESS` transition.
  - `created_at`, `updated_at` (same shape as `auction`).
  - UNIQUE `(auction_id, team_name)`.
- Table `auction_evaluations` (user-supplied; **survives xlsx imports**):
  - `auction_id` (int, FK → `auction.id` ON DELETE CASCADE) + `player_id` (int) → composite PK.
  - `player_id` is intentionally **not** a FK to `players.id`, so the `TRUNCATE players` in the import flow doesn't cascade here. Orphans from a later xlsx are tolerated.
  - `evaluation` (int, nullable, ≥0 at the API layer) — the user's per-player auction valuation. **Stored normalized to a 1000-credit budget** (same scale as `fanta_market_value`). The UI scales it to/from the parent auction's `credits_per_team` on render/save.

The xlsx columns we don't store: `Qt.A, Qt.I, Diff., Qt.I M, Diff.M, FVM`, and the `R` macro role (derivable from `mantra_roles`).

Migrations so far: `0001_create_players_table`, `0002_team_to_varchar`, `0003_simplify_player_columns`, `0004_drop_user_market_value`, `0005_create_user_evaluations`, `0006_create_user_preferences`, `0007_simplify_user_evaluations`, `0008_auctions_refactor` (dropped the singleton `user_preferences` and the player-only-keyed `user_evaluations`; introduced the `auction` / `auction_teams` / `auction_evaluations` trio and the `auction_status` enum), `0013_create_rules_tables` (moved `rules.json` weights + modules catalogue into `role_weights` / `lineup_modules` / `lineup_module_slots` and removed the JSON file), `0014_swap_dd_ds_slot_positions` (swapped the lower/upper position numbers for `Dd` and `Ds` so pitch rendering matches their semantic side), `0015_auction_team_is_my_team` (added `is_my_team` to `auction_teams` plus a partial unique index for at-most-one-per-auction).

Unknown MantraRole values in the xlsx still raise loudly (signals a real rule change — add the value to the enum + a new migration).

### Auctions API (`/auctions`)

Lives in `backend/app/routers/auctions.py`. All auction-scoped operations are nested under this router:

- `POST /auctions` — create a new auction. Body has the 5 preference fields + `name`, `description`, optional `teams: list[str]`, and optional `my_team_index: int` (index into `teams` marking which is the user's own team — required eventually, but can be set later via PATCH).
- `GET /auctions` — list all auctions ordered by `created_at DESC` (most recent first; the evaluations page relies on this for default selection). Each row includes `number_of_teams`.
- `GET /auctions/{id}` — full detail including the `teams` list. Teams come back sorted `is_my_team DESC, id ASC` (one ordering rule for every consumer — the dialog, the running view's team columns, and the team dropdown all inherit it).
- `PATCH /auctions/{id}` — partial update of name/description/status/preferences. Preference + name/description edits return 409 if `status != INITIAL`. The `INITIAL → IN_PROGRESS` transition is gated on (1) a complete evaluation — all three groups of `/evaluations/status` must be `"ok"` — and (2) exactly one team flagged `is_my_team`. Returns 409 otherwise. Other transitions (e.g. `IN_PROGRESS → TERMINATED`, manual rollback to `INITIAL`) are not enforced.
- `DELETE /auctions/{id}` — cascade-deletes `auction_teams` and `auction_evaluations` for that auction.
- `POST /auctions/{id}/teams`, `PATCH /auctions/{id}/teams/{team_id}`, and `DELETE /auctions/{id}/teams/{team_id}` — team CRUD. All three return 409 if the auction isn't `INITIAL`. `POST` returns 409 on a duplicate `(auction_id, team_name)` and accepts an optional `is_my_team: bool` to mark the team as the user's own on creation. `PATCH` body is `{is_my_team: bool}`; setting `true` atomically unsets any other team in the same auction that was previously marked.
- `PATCH /auctions/{id}/evaluations/{player_id}` — upsert one evaluation. Body `{"evaluation": int | null}`; explicit `null` clears. Returns 409 if auction isn't `INITIAL`. Stores the value normalized to the 1000-credit base.
- `GET /auctions/{id}/evaluations/status` — completeness snapshot for the evaluations indicator. See below.
- `GET /auctions/{id}/evaluations/export` — downloads a CSV of every non-null evaluation for the auction. See **CSV format** below.
- `POST /auctions/{id}/evaluations/import` — multipart CSV upload. **Merge** semantics: rows in the file upsert into `auction_evaluations`; players absent from the CSV keep their existing value, and an empty `evaluation` cell clears that player's value. Unknown `player_id`s are skipped and listed in the response (`{"imported": N, "unknown_player_ids": [...]}`). Returns 409 when auction isn't `INITIAL`, and 400 with a row-by-row error list when the CSV has invalid cells.

`GET /players` accepts an optional `?auction_id=N` query param; when present, it left-joins `auction_evaluations` filtered by that auction and includes the user's per-player `evaluation` in the response. Without the param, `evaluation` is always `null` (for future flows that don't need an auction).

### CSV format (export / import)

Columns produced by export and read by import: `player_id, name, team, roles, evaluation`. Only `player_id` and `evaluation` are load-bearing on import — the others are informational so the file is readable in a spreadsheet.

`evaluation` is the **base-1000 stored value** (the same canonical form the DB uses), not the credit-scaled value displayed in the UI. This makes the CSV auction-independent: a file exported from a 500-credit auction can be imported into a 600-credit auction and the spend ratios stay correct. To convert manually: `displayed_credits = evaluation × credits_per_team / 1000`.

The export only includes players with a non-null evaluation. On import, an empty `evaluation` cell clears that player's value; an absent player_id leaves their current value untouched.

### Evaluation status (`GET /auctions/{id}/evaluations/status`)

Single source of truth for "is the evaluation work complete enough for this auction?". Returns three groups — `credits`, `players`, `goalkeepers` — each with `{used|evaluated, total|min|max|target, percentage, status}` where `status` is `"under" | "ok" | "over"`. Targets are derived from the auction row's own preference columns (auctioners × credits_per_team, × min/max_team_size, × number_of_goalkeepers respectively). Credits are returned already scaled to the auction's `credits_per_team` budget (not the 1000-base storage units).

The `/evaluations` page consumes this endpoint to render its indicator card. Future auction-promotion flow will hit the same endpoint to gate the `INITIAL → IN_PROGRESS` transition on a sufficiently-complete evaluation (e.g. require `credits.status !== "under"` and `players.status === "ok"`).

## Running the app

Only prereq: **Docker Desktop** (or Docker Engine + Compose v2).

Dev loop:

```bash
docker compose up           # builds on first run, then starts db + backend + ui
docker compose down         # stop; data persists in the pgdata volume
docker compose down -v      # stop and WIPE the DB volume
```

Backend lives at `http://localhost:8000` (try `/health`, `/docs`); frontend at `http://localhost:5173`. The backend container applies `alembic upgrade head` on every start, so new migrations apply automatically.

**Loading / refreshing player data** — two equivalent ways:

- **UI**: open `http://localhost:5173/settings`, pick the xlsx, confirm. Hits `POST /players/import` which validates the file (open it, find the `Tutti` sheet, parse ≥ 1 player, and confirm exactly 20 distinct teams) and only then runs the TRUNCATE + INSERT. If validation fails the DB is left untouched.
- **CLI** (no UI needed, e.g., in CI or scripted weekly refresh):
  ```bash
  docker compose exec backend python -m backend.scripts.import_players \
      data/Quotazioni_Fantacalcio_Stagione_2025_26.xlsx
  ```

Both paths share the same `parse_players` / `write_players` functions, so behavior stays in sync.

**Ad-hoc DB access** from the host: `psql -h localhost -p 5433 -U fanta -d fanta_mantra` (password `fanta`). Or from inside: `docker compose exec db psql -U fanta -d fanta_mantra`.

**Creating a new migration** after a model change:

```bash
docker compose exec backend alembic -c backend/alembic.ini revision -m "<msg>"
```

(handwrite — autogenerate works but review the diff). The new file appears in `backend/alembic/versions/` via the bind mount, so it lands on the host immediately.

> If you also have a host Postgres running (e.g., via `brew services`), it doesn't conflict — compose binds DB to host port `5433`. You can stop the brew one with `brew services stop postgresql@16` if you want it out of the way.

## Roles (Mantra)

| Code | Italian          | Area       |
|------|------------------|------------|
| `Por`  | Portiere         | goalkeeper |
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

Each role has an offensive weight (stored in the `role_weights` table; seeded by migration `0013`):

```
Por=0  Dc=0  Dd=0  Ds=0  B=0  E=0  M=0
C=1  W=2  T=2  A=3  Pc=4
```

Every legal module in `lineup_modules` (with its slots in `lineup_module_slots.allowed_roles`) is calibrated so the **maximum total weight is exactly 12**. A slot whose `allowed_roles` is e.g. `{T, A, Pc}` contributes the weight of whichever role you assign the player to in that slot.

Verified for all 11 modules:

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

Any new module added (via a fresh migration that inserts into `lineup_modules` + `lineup_module_slots`) MUST also max out at 12 — treat this as an invariant and check it before merging changes.

## Auctioneer heuristic: max-weight slot assignment

When a `lineup_module_slots.allowed_roles` set contains more than one role, an auctioneer will (rationally) assign the player to the **highest-weighted role they can play**, because every weight point is offensive output. So a player with roles `{A, Pc}` placed in a `{T, A, Pc}` slot is counted as `Pc` (weight 4), not `A` (weight 3) or `T` (weight 2). This is exactly the same assignment rule that makes each module's max-weight lineup sum to 12 (see the table above).

Consequence for **insight/scoring features**: when valuing a player against a module — or estimating how many lineup-points a team's roster can produce — compute the slot's contribution as `max(role_weights.weight FOR role IN player.mantra_roles ∩ allowed_roles)`, not the average or the player's "primary" role. This is the assumption every other auctioneer in the league is making, so any tooling that recommends bids, ranks players, or projects team strength must agree with it.

### Exception: module-intent prediction inverts the convention

The module-prediction service (`backend/app/services/module_predictions.py`, exposed via `GET /auctions/{id}/module-predictions`) is **prediction-specific** and inverts the convention in two places. Future scoring/eligibility/strength features should still follow the max-weight rule above.

1. **Players are reduced to their lowest-weight role(s)**. A W/A is treated as a W (ties kept, e.g. Dd/Dc stays {Dd, Dc} since both are weight 0). Rationale: empirically, buyers acquire a W/A intending to play them as a W; counting them as an A would falsely pull the prediction toward A-heavy modules the buyer isn't building.
2. **Each slot's contribution is scaled by a fit factor** `fit = player_weight / slot_max_weight` (1.0 when both are zero). Rationale: an A/Pc slot's "true demand" is for the Pc (weight 4); putting an A there is the fallback. Without scaling, an A player in an A/Pc slot would tie with the same A in a T/A slot, so any module with at least one A-eligible slot would score identically — masking the fact that the buyer's A is a better fit for explicit-A modules. With scaling: A in A/Pc contributes `price × (1 + 3 × 0.75) = price × 3.25`; A in T/A contributes `price × (1 + 3 × 1.0) = price × 4`.

## Lineup-eligibility rules

A lineup is **legal** when:

1. The module name is one of the entries in `lineup_modules`.
2. Each of the 11 slots (`lineup_module_slots.position` 1..11) is filled by a distinct player.
3. The player assigned to a slot has at least one role in that slot's `allowed_roles` set.
4. The chosen role-assignments sum to a total weight `<= 12` (the cap; the seeded modules are tuned so 12 is reachable).

Slot `position` is positional (Por first, then defenders, midfielders, attackers), but only the role constraints — not the order — affect legality.

## Conventions for code in this repo

- Treat `RM` from the xlsx as a list: split on `;`.
- A slot's accepted roles live in `lineup_module_slots.allowed_roles` as a `mantra_role[]` — query them, don't re-parse strings.
- Do not hard-code role lists or weights in Python — read them from the `role_weights` / `lineup_modules` / `lineup_module_slots` tables (models in `backend/app/models.py`) so the source of truth stays single.
- Database-layer code lives in `backend/app/models.py`; never embed schema knowledge in scripts.
