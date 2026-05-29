# Fantacalcio Mantra Tools

A small full-stack app for the Italian Serie A fantasy football game **Fantacalcio**,
played under the **Mantra** ruleset. It helps you prepare for and run your league's
player auction: import the official player quotations, build per-player valuations,
and track teams and bids as the auction unfolds.

Official Mantra rules: https://www.fantacalcio.it/regolamenti/sistema-mantra

## What it does

The app is built around **auctions**. Each auction moves through three phases:

1. **`INITIAL`** — setup. You configure preferences (number of teams, budget, roster
   size, goalkeepers), add the participating teams, and assign a per-player
   **evaluation** (your valuation of each player). A completeness indicator tells you
   when your evaluations cover enough of the budget, roster, and goalkeepers to start.
   Evaluations can be exported/imported as CSV so they're reusable across auctions.
2. **`IN_PROGRESS`** — the live auction. Tracks teams, spend, role saturation, and
   module-fit insights while you bid.
3. **`TERMINATED`** — the auction is closed.

### A note on the "Mantra" ruleset

In Mantra, each player has one or more fine-grained roles (e.g. `Dc`, `E`, `T`, `Pc`)
and can fill any lineup slot that accepts one of those roles. Every legal formation is
calibrated so the maximum offensive weight of a lineup is exactly 12. The app encodes
these rules (role weights, the 11 legal modules and their slots) in the database and
uses them to power valuation and module-prediction insights.

## Architecture

Everything runs in Docker via `docker-compose.yml`:

- **`db`** — `postgres:16-alpine`. Exposed on the host at `127.0.0.1:5433`
  (internal `5432`). Default credentials `fanta:fanta`, database `fanta_mantra`.
  Data is persisted in the named volume `pgdata`.
- **`backend`** — [FastAPI](https://fastapi.tiangolo.com/) on
  `http://localhost:8000` (Python 3.14 + [uv](https://github.com/astral-sh/uv)).
  Runs `alembic upgrade head` then `uvicorn --reload` on start.
- **`ui`** — [LIT](https://lit.dev/) + TypeScript + [Vite](https://vitejs.dev/) dev
  server on `http://localhost:5173`, styled with
  [Tailwind CSS v4](https://tailwindcss.com/). (Node 20 + yarn).

Source directories (`./backend`, `./ui`, `./data`) are bind-mounted into the
containers, so code changes hot-reload.

## Requirements

The only prerequisite is **Docker Desktop** (or Docker Engine + Compose v2).

## Getting started

```bash
docker compose up        # builds on first run, then starts db + backend + ui
```

Then open:

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000 (try `/health` or the docs at `/docs`)

The backend applies database migrations (`alembic upgrade head`) automatically on
every start, so a fresh checkout is ready to go.

Stopping:

```bash
docker compose down      # stop; data persists in the pgdata volume
docker compose down -v   # stop and WIPE the database volume
```

## Loading player data

The app ships without player data — you load it from the official fantacalcio.it
spreadsheet (`Quotazioni_Fantacalcio_Stagione_2025_26.xlsx`). Download the latest
file into `data/`, then import it one of two ways:

- **UI**: open http://localhost:5173/settings, pick the xlsx, and confirm.
  The file is validated (correct sheet, ≥ 1 player, exactly 20 distinct teams)
  before the players table is wiped and reloaded.
- **CLI**:
  ```bash
  docker compose exec backend python -m backend.scripts.import_players \
      data/Quotazioni_Fantacalcio_Stagione_2025_26.xlsx
  ```

> Importing **truncates and re-inserts** the `players` table. Your auctions, teams,
> and evaluations are stored separately and survive a player-data refresh.

Refresh weekly during the season to keep quotations current.

## Typical workflow

1. Start the stack (`docker compose up`) and load player data (see above).
2. On the home page, create a new auction and set its preferences and teams; mark
   which team is yours.
3. Fill in your per-player evaluations (or import them from CSV) until the
   completeness indicator is green, then start the auction.
4. Run the live auction, tracking teams and spend as you bid.

## Useful commands

Ad-hoc database access from the host:

```bash
psql -h localhost -p 5433 -U fanta -d fanta_mantra   # password: fanta
```

Or from inside the container:

```bash
docker compose exec db psql -U fanta -d fanta_mantra
```

Create a new migration after a model change:

```bash
docker compose exec backend alembic -c backend/alembic.ini revision -m "<msg>"
```

## Repository layout

- `backend/app/` — FastAPI app (`main.py`, `models.py`, `routers/`, `services/`).
- `backend/alembic/` — database migrations.
- `backend/scripts/import_players.py` — player-import CLI and library.
- `ui/src/components/` — LIT components (app shell, home page, auction panels,
  settings page).
- `data/` — the canonical fantacalcio.it quotations spreadsheet.
- `docker-compose.yml` — the full dev stack.
