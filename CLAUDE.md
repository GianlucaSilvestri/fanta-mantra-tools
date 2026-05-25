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
- `rules.json` — Mantra role weights and the catalog of legal lineup modules.
- `backend/app/` — FastAPI app: `main.py`, `config.py`, `db.py`, `models.py`, `routers/health.py`, `routers/players.py`, `routers/evaluations.py`, `routers/preferences.py`.
- `backend/alembic/` — migrations.
- `backend/scripts/import_players.py` — both a CLI and a library. Exposes `parse_players(source)` (path/bytes/file-like → `list[Player]`, raises on bad data) and `write_players(rows)` (TRUNCATE + INSERT in one transaction). The CLI just chains the two.
- `ui/src/components/app-root.ts` — LIT root shell. Owns the tiny pathname-based router (no library) and renders `<home-page>` for `/`, `<evaluations-page>` for `/evaluations`, `<settings-page>` for `/settings`.
- `ui/src/components/home-page.ts` — pings `GET /health` on mount and shows the result.
- `ui/src/components/evaluations-page.ts` — table of every player joined with `user_evaluations`. On mount fetches `GET /players`, `GET /preferences`, and `GET /evaluations/status` in parallel; reads `credits_per_team` from preferences to scale `fanta_market_value` (read-only column) and the user's `evaluation` (editable column, `min=0`). The indicator card above the table is fully driven by `/evaluations/status` (credits / players / goalkeepers, each with `under | ok | over` status). Team + role + name filters, sortable headers (default: `fanta_evaluation DESC`). Edits PATCH `/evaluations/{player_id}` on `change`, with the displayed value **normalized to the 1000-credit base** before being sent and rescaled on render. After each successful save the page re-fetches `/evaluations/status` so the indicator stays in sync (no client-side stats math).
- `ui/src/components/settings-page.ts` — two sections. (1) **Auction preferences** form: five number inputs bound to `GET /preferences`, each `PUT`s the full body on `change`. (2) **Player data**: file-upload form that POSTs the chosen xlsx to `/players/import` (with a confirm dialog since it wipes the table).

## Database schema

One Postgres enum + one table (defined in `backend/app/models.py`, migrations in `backend/alembic/versions/`):

- Enum `mantra_role`: `Por, Dc, Dd, Ds, B, E, M, C, W, T, A, Pc` (12 values). Stable — defined by the game rules, doesn't drift season-to-season.
- Table `players` (file-driven; wiped + reinserted on every xlsx import):
  - `id` (int PK, the fantacalcio.it Id from the xlsx)
  - `name`, `team` (text, file-driven)
  - `mantra_roles` (`mantra_role[]`)
  - `fanta_evaluation` (int, nullable) — sourced from the xlsx `Qt.A M` column.
  - `fanta_market_value` (int, nullable) — sourced from the xlsx `FVM M` column, stored as-is.
- Table `user_evaluations` (user-supplied; **survives xlsx imports**):
  - `player_id` (int PK; **no FK** to `players.id` on purpose, so the `TRUNCATE players` in the import flow doesn't cascade here)
  - `evaluation` (int, nullable, ≥0 at the API layer) — the user's per-player auction valuation. **Stored normalized to a 1000-credit budget** (same scale as `fanta_market_value`). The UI scales it to/from `user_preferences.credits_per_team` on render/save.
- Table `user_preferences` (singleton — exactly one row, `id=1`, enforced by a CHECK constraint):
  - `number_of_auctioners`, `min_team_size`, `max_team_size`, `credits_per_team`, `number_of_goalkeepers` (all int, NOT NULL).
  - Seeded by migration `0006` with `(10, 27, 30, 500, 3)`.
  - Drives the evaluations page's scaling math, indicator card thresholds, and (eventually) lineup checks. Edited from `/settings`.

The xlsx columns we don't store: `Qt.A, Qt.I, Diff., Qt.I M, Diff.M, FVM`, and the `R` macro role (derivable from `mantra_roles`).

Migrations so far: `0001_create_players_table`, `0002_team_to_varchar`, `0003_simplify_player_columns`, `0004_drop_user_market_value`, `0005_create_user_evaluations`, `0006_create_user_preferences` (singleton table seeded with defaults), `0007_simplify_user_evaluations` (truncated the table and collapsed the four per-auction columns into a single `evaluation`).

Unknown MantraRole values in the xlsx still raise loudly (signals a real rule change — add the value to the enum + a new migration).

### Evaluation status (`GET /evaluations/status`)

Single source of truth for "is the user's evaluation work complete enough?". Lives in `backend/app/routers/evaluations.py` alongside the `PATCH /evaluations/{player_id}` handler. Returns three groups — `credits`, `players`, `goalkeepers` — each with `{used|evaluated, total|min|max|target, percentage, status}` where `status` is `"under" | "ok" | "over"`. Targets are derived from `user_preferences` (auctioners × credits_per_team, × min/max_team_size, × number_of_goalkeepers respectively). Credits are returned already scaled to the user's `credits_per_team` budget (not the 1000-base storage units).

The `/evaluations` page consumes this endpoint to render its indicator card. Future auction-creation flow will hit the same endpoint to gate creation on a sufficiently-complete evaluation (e.g. require `credits.status !== "under"` and `players.status === "ok"`).

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

Each role has an offensive weight (`rules.json -> weights`):

```
Por=0  Dc=0  Dd=0  Ds=0  B=0  E=0  M=0
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
2. Each of the 11 slots is filled by a distinct player.
3. The player assigned to a slot has at least one role in that slot's accepted-role set (slots are written `Role1/Role2/...`).
4. The chosen role-assignments sum to a total weight `<= 12` (the cap; the listed modules are tuned so 12 is reachable).

Slot order in the JSON is positional (Por first, then defenders, midfielders, attackers), but only the role constraints — not the order — affect legality.

## Conventions for code in this repo

- Treat `RM` from the xlsx as a list: split on `;`.
- Treat slot specs in `rules.json` as a list: split on `/`.
- Do not hard-code role lists or weights in Python — read them from `rules.json` so the source of truth stays single.
- Database-layer code lives in `backend/app/models.py`; never embed schema knowledge in scripts.
