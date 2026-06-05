# Fantacalcio Mantra Tools

Una piccola app full-stack per il gioco di fantacalcio della Serie A italiana **Fantacalcio**,
giocato secondo il regolamento **Mantra**. Ti aiuta a preparare e gestire l'asta della tua
lega: importi le quotazioni ufficiali dei giocatori, costruisci le valutazioni per ogni
giocatore e tieni traccia di squadre e offerte mentre l'asta si svolge.

Regolamento ufficiale Mantra: https://www.fantacalcio.it/regolamenti/sistema-mantra

📺 **Video di presentazione:** https://www.youtube.com/watch?v=o1TX0M_okCE

## Cosa fa

L'app è costruita intorno al concetto di **asta**. Ogni asta attraversa tre fasi:

1. **`INITIAL`** — preparazione. Configuri le preferenze (numero di squadre, budget,
   dimensione della rosa, portieri), aggiungi le squadre partecipanti e assegni una
   **valutazione** per ogni giocatore (la tua stima del valore di ciascuno). Un indicatore
   di completezza ti dice quando le tue valutazioni coprono una porzione sufficiente di
   budget, rosa e portieri per poter iniziare. Le valutazioni possono essere
   esportate/importate in CSV per essere riutilizzate tra aste diverse.
2. **`IN_PROGRESS`** — l'asta dal vivo. Tiene traccia di squadre, spesa, saturazione dei
   ruoli e indicazioni sull'idoneità ai moduli mentre fai le tue offerte.
3. **`TERMINATED`** — l'asta è chiusa.

### Una nota sul regolamento "Mantra"

Nel Mantra ogni giocatore ha uno o più ruoli specifici (ad es. `Dc`, `E`, `T`, `Pc`) e può
occupare qualsiasi slot della formazione che accetti uno di quei ruoli. Ogni formazione
legale è calibrata in modo che il peso offensivo massimo di uno schieramento sia esattamente
12. L'app codifica queste regole (pesi dei ruoli, gli 11 moduli legali e i loro slot) nel
database e le usa per alimentare le valutazioni e le previsioni sui moduli.

## Architettura

Tutto gira in Docker tramite `docker-compose.yml`:

- **`db`** — `postgres:16-alpine`. Esposto sull'host a `127.0.0.1:5433`
  (interno `5432`). Credenziali di default `fanta:fanta`, database `fanta_mantra`.
  I dati sono persistiti nel volume nominato `pgdata`.
- **`backend`** — [FastAPI](https://fastapi.tiangolo.com/) su
  `http://localhost:8000` (Python 3.14 + [uv](https://github.com/astral-sh/uv)).
  All'avvio esegue `alembic upgrade head` e poi `uvicorn --reload`.
- **`ui`** — server di sviluppo [LIT](https://lit.dev/) + TypeScript +
  [Vite](https://vitejs.dev/) su `http://localhost:5173`, con stile gestito da
  [Tailwind CSS v4](https://tailwindcss.com/). (Node 20 + yarn).

Le directory del codice sorgente (`./backend`, `./ui`, `./data`) sono montate (bind-mount)
nei container, così le modifiche al codice si ricaricano a caldo.

## Requisiti

L'unico prerequisito è **Docker Desktop** (oppure Docker Engine + Compose v2).

## Per iniziare

```bash
docker compose up        # alla prima esecuzione fa il build, poi avvia db + backend + ui
```

Poi apri:

- **Frontend**: http://localhost:5173
- **API del backend**: http://localhost:8000 (prova `/health` o la documentazione su `/docs`)

Il backend applica automaticamente le migrazioni del database (`alembic upgrade head`) a
ogni avvio, quindi un checkout pulito è pronto all'uso.

Per fermare:

```bash
docker compose down      # ferma; i dati restano nel volume pgdata
docker compose down -v   # ferma e CANCELLA il volume del database
```

## Caricare i dati dei giocatori

L'app viene distribuita senza dati dei giocatori — li carichi dal foglio di calcolo
ufficiale di fantacalcio.it (`Quotazioni_Fantacalcio_Stagione_2025_26.xlsx`). Scarica il
file più recente nella cartella `data/`, poi importalo in uno dei due modi:

- **UI**: apri http://localhost:5173/settings, scegli il file xlsx e conferma.
  Il file viene validato (foglio corretto, ≥ 1 giocatore, esattamente 20 squadre distinte)
  prima che la tabella dei giocatori venga svuotata e ricaricata.
- **CLI**:
  ```bash
  docker compose exec backend python -m backend.scripts.import_players \
      data/Quotazioni_Fantacalcio_Stagione_2025_26.xlsx
  ```

> L'importazione **svuota e re-inserisce** la tabella `players`. Le tue aste, le squadre e
> le valutazioni sono memorizzate separatamente e sopravvivono a un aggiornamento dei dati
> dei giocatori.

Aggiorna i dati settimanalmente durante la stagione per mantenere le quotazioni aggiornate.

## Flusso di lavoro tipico

1. Avvia lo stack (`docker compose up`) e carica i dati dei giocatori (vedi sopra).
2. Nella home page, crea una nuova asta e imposta le sue preferenze e le squadre; indica
   quale squadra è la tua.
3. Inserisci le tue valutazioni per ogni giocatore (oppure importale da CSV) finché
   l'indicatore di completezza diventa verde, poi avvia l'asta.
4. Gestisci l'asta dal vivo, tenendo traccia di squadre e spesa mentre fai le offerte.

## Comandi utili

Accesso diretto al database dall'host:

```bash
psql -h localhost -p 5433 -U fanta -d fanta_mantra   # password: fanta
```

Oppure dall'interno del container:

```bash
docker compose exec db psql -U fanta -d fanta_mantra
```

Creare una nuova migrazione dopo una modifica ai modelli:

```bash
docker compose exec backend alembic -c backend/alembic.ini revision -m "<msg>"
```

## Struttura del repository

- `backend/app/` — app FastAPI (`main.py`, `models.py`, `routers/`, `services/`).
- `backend/alembic/` — migrazioni del database.
- `backend/scripts/import_players.py` — CLI e libreria per l'importazione dei giocatori.
- `ui/src/components/` — componenti LIT (shell dell'app, home page, pannelli dell'asta,
  pagina delle impostazioni).
- `data/` — il foglio di calcolo canonico delle quotazioni di fantacalcio.it.
- `docker-compose.yml` — lo stack di sviluppo completo.
