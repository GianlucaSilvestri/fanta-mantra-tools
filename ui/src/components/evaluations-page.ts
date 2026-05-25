import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

const BACKEND_URL = "http://localhost:8000";
const BASE_CREDITS = 1000;

type SortKey =
  | "name"
  | "team"
  | "fanta_evaluation"
  | "fanta_market_value"
  | "evaluation";

interface PlayerRow {
  id: number;
  name: string;
  team: string;
  mantra_roles: string[];
  fanta_evaluation: number | null;
  fanta_market_value: number | null;
  evaluation: number | null;
}

interface Preferences {
  number_of_auctioners: number;
  min_team_size: number;
  max_team_size: number;
  credits_per_team: number;
  number_of_goalkeepers: number;
}

type StatusKind = "under" | "ok" | "over";

interface EvaluationStatus {
  credits: { used: number; total: number; percentage: number; status: StatusKind };
  players: { evaluated: number; min: number; max: number; percentage: number; status: StatusKind };
  goalkeepers: { evaluated: number; target: number; percentage: number; status: StatusKind };
}

/** Scale base-1000 stored integer down to the user's auction credits. */
function toAuction(stored: number | null, credits: number): number | null {
  if (stored == null) return null;
  return Math.floor((stored * credits) / BASE_CREDITS);
}

/** Inverse of `toAuction`: user-typed value → base-1000 for storage. */
function toBase(displayed: number, credits: number): number {
  return Math.floor((displayed * BASE_CREDITS) / credits);
}

@customElement("evaluations-page")
export class EvaluationsPage extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .summary,
    .filters {
      display: flex;
      gap: 1rem;
      margin: 1rem 0;
      align-items: center;
      flex-wrap: wrap;
    }
    .summary {
      color: #555;
      font-size: 0.9rem;
    }
    .summary a {
      color: #06c;
    }
    .filters label {
      display: flex;
      gap: 0.4rem;
      align-items: center;
      font-size: 0.9rem;
    }
    .meta {
      color: #666;
      font-size: 0.85rem;
      margin-left: auto;
    }
    .indicator {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 0.7rem 0.9rem;
      background: #fafafa;
      max-width: 520px;
      margin: 0.5rem 0 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .indicator-header {
      font-weight: 600;
      font-size: 0.95rem;
      color: #333;
    }
    .metric {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .metric-label {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      font-size: 0.82rem;
      color: #555;
    }
    .metric-label .pct {
      margin-left: auto;
      font-weight: 600;
      font-size: 0.88rem;
    }
    .bar {
      height: 6px;
      background: #eee;
      border-radius: 3px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      transition: width 0.15s ease;
    }
    .metric.under .bar-fill { background: #c0a000; }
    .metric.under .pct { color: #8a7000; }
    .metric.ok .bar-fill { background: #2a8a3a; }
    .metric.ok .pct { color: #2a8a3a; }
    .metric.over .bar-fill { background: #c0392b; }
    .metric.over .pct { color: #c0392b; }
    .table-wrap {
      overflow-x: auto;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 0.9rem;
    }
    th,
    td {
      padding: 0.4rem 0.6rem;
      border-bottom: 1px solid #eee;
      text-align: left;
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: #f7f7f7;
      cursor: pointer;
      user-select: none;
    }
    th .arrow {
      color: #06c;
      margin-left: 0.25rem;
    }
    input[type="number"] {
      width: 4.5rem;
      padding: 0.15rem 0.3rem;
      text-align: right;
      font: inherit;
    }
    .err {
      color: crimson;
      margin-left: 0.3rem;
    }
    .empty {
      padding: 1rem;
      color: #666;
    }
  `;

  @state() private players: PlayerRow[] = [];
  @state() private prefs: Preferences | null = null;
  @state() private status: EvaluationStatus | null = null;
  @state() private loading = true;
  @state() private loadError = "";
  @state() private teamFilter = "";
  @state() private roleFilter = "";
  @state() private nameFilter = "";
  @state() private sortKey: SortKey = "fanta_evaluation";
  @state() private sortDir: "asc" | "desc" = "desc";
  @state() private saveErrors = new Set<number>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.loadError = "";
    try {
      const [playersRes, prefsRes, statusRes] = await Promise.all([
        fetch(`${BACKEND_URL}/players`),
        fetch(`${BACKEND_URL}/preferences`),
        fetch(`${BACKEND_URL}/evaluations/status`),
      ]);
      if (!playersRes.ok) throw new Error(`/players HTTP ${playersRes.status}`);
      if (!prefsRes.ok) throw new Error(`/preferences HTTP ${prefsRes.status}`);
      if (!statusRes.ok) throw new Error(`/evaluations/status HTTP ${statusRes.status}`);
      this.players = (await playersRes.json()) as PlayerRow[];
      this.prefs = (await prefsRes.json()) as Preferences;
      this.status = (await statusRes.json()) as EvaluationStatus;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch(`${BACKEND_URL}/evaluations/status`);
      if (!res.ok) return;
      this.status = (await res.json()) as EvaluationStatus;
    } catch {
      // Leave stale status in place; another save attempt will refresh it.
    }
  }

  private get teams(): string[] {
    return Array.from(new Set(this.players.map((p) => p.team))).sort();
  }

  private get roles(): string[] {
    return Array.from(new Set(this.players.flatMap((p) => p.mantra_roles))).sort();
  }

  private get filteredSorted(): PlayerRow[] {
    const name = this.nameFilter.trim().toLowerCase();
    const team = this.teamFilter;
    const role = this.roleFilter;
    const filtered = this.players.filter(
      (p) =>
        (!team || p.team === team) &&
        (!role || p.mantra_roles.includes(role)) &&
        (!name || p.name.toLowerCase().includes(name)),
    );

    const dir = this.sortDir === "asc" ? 1 : -1;
    const key = this.sortKey;
    return [...filtered].sort((a, b) => {
      const av = a[key] as number | string | null;
      const bv = b[key] as number | string | null;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
    } else {
      this.sortKey = key;
      this.sortDir = key === "name" || key === "team" ? "asc" : "desc";
    }
  }

  private async save(playerId: number, raw: string): Promise<void> {
    if (!this.prefs) return;
    const trimmed = raw.trim();
    const displayed: number | null = trimmed === "" ? null : Number.parseInt(trimmed, 10);
    if (displayed !== null && (Number.isNaN(displayed) || displayed < 0)) return;

    const stored: number | null =
      displayed === null ? null : toBase(displayed, this.prefs.credits_per_team);

    try {
      const res = await fetch(`${BACKEND_URL}/evaluations/${playerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evaluation: stored }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as { evaluation: number | null };
      this.players = this.players.map((p) =>
        p.id === playerId ? { ...p, evaluation: updated.evaluation } : p,
      );
      if (this.saveErrors.has(playerId)) {
        this.saveErrors.delete(playerId);
        this.saveErrors = new Set(this.saveErrors);
      }
      // Indicator card data lives on the server; pull a fresh snapshot.
      void this.refreshStatus();
    } catch {
      this.saveErrors = new Set(this.saveErrors).add(playerId);
    }
  }

  private headerCell(label: string, key: SortKey) {
    const arrow =
      this.sortKey === key
        ? html`<span class="arrow">${this.sortDir === "asc" ? "▲" : "▼"}</span>`
        : nothing;
    return html`<th @click=${() => this.setSort(key)}>${label}${arrow}</th>`;
  }

  private renderIndicator() {
    const s = this.status;
    const prefs = this.prefs;
    if (!s || !prefs) return nothing;
    const fmtPct = (p: number) => `${p.toFixed(0)}%`;
    const barWidth = (p: number) => `${Math.min(p, 100)}%`;
    return html`
      <div class="indicator">
        <div class="indicator-header">
          ${prefs.number_of_auctioners} auctioners · ${prefs.credits_per_team} credits/team
        </div>
        <div class="metric ${s.credits.status}">
          <div class="metric-label">
            Credits spent <span>${s.credits.used} / ${s.credits.total}</span>
            <span class="pct">${fmtPct(s.credits.percentage)}</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width: ${barWidth(s.credits.percentage)}"></div></div>
        </div>
        <div class="metric ${s.players.status}">
          <div class="metric-label">
            Players evaluated
            <span>${s.players.evaluated} / ${s.players.min}–${s.players.max}</span>
            <span class="pct">${fmtPct(s.players.percentage)}</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width: ${barWidth(s.players.percentage)}"></div></div>
        </div>
        <div class="metric ${s.goalkeepers.status}">
          <div class="metric-label">
            Goalkeepers evaluated
            <span>${s.goalkeepers.evaluated} / ${s.goalkeepers.target}</span>
            <span class="pct">${fmtPct(s.goalkeepers.percentage)}</span>
          </div>
          <div class="bar"><div class="bar-fill" style="width: ${barWidth(s.goalkeepers.percentage)}"></div></div>
        </div>
      </div>
    `;
  }

  private renderRow(p: PlayerRow) {
    const credits = this.prefs!.credits_per_team;
    const scaledEval = toAuction(p.evaluation, credits);
    return html`<tr>
      <td>${p.fanta_evaluation ?? ""}</td>
      <td>
        ${p.name}
        ${this.saveErrors.has(p.id)
          ? html`<span class="err" title="last save failed">⚠</span>`
          : nothing}
      </td>
      <td>${p.team}</td>
      <td>${p.mantra_roles.join(", ")}</td>
      <td>${toAuction(p.fanta_market_value, credits) ?? ""}</td>
      <td>
        <input
          type="number"
          min="0"
          step="1"
          .value=${scaledEval === null ? "" : String(scaledEval)}
          @change=${(e: Event) =>
            this.save(p.id, (e.target as HTMLInputElement).value)}
        />
      </td>
    </tr>`;
  }

  override render() {
    if (this.loading) return html`<p>Loading…</p>`;
    if (this.loadError)
      return html`<p style="color: crimson">Failed to load: ${this.loadError}</p>`;
    if (!this.prefs) return html`<p>No preferences available.</p>`;

    const rows = this.filteredSorted;

    return html`
      <h2>Evaluations</h2>

      <div class="summary">
        ${this.prefs.number_of_auctioners} auctioners ·
        ${this.prefs.credits_per_team} credits/team ·
        ${this.prefs.min_team_size}–${this.prefs.max_team_size} players/team
        <span style="margin-left: 0.5rem">(<a href="/settings">change</a>)</span>
      </div>

      ${this.renderIndicator()}

      <div class="filters">
        <label>
          Team:
          <select
            .value=${this.teamFilter}
            @change=${(e: Event) =>
              (this.teamFilter = (e.target as HTMLSelectElement).value)}
          >
            <option value="">All</option>
            ${this.teams.map((t) => html`<option value=${t}>${t}</option>`)}
          </select>
        </label>
        <label>
          Role:
          <select
            .value=${this.roleFilter}
            @change=${(e: Event) =>
              (this.roleFilter = (e.target as HTMLSelectElement).value)}
          >
            <option value="">All</option>
            ${this.roles.map((r) => html`<option value=${r}>${r}</option>`)}
          </select>
        </label>
        <label>
          Name:
          <input
            type="text"
            placeholder="e.g. mart"
            .value=${this.nameFilter}
            @input=${(e: Event) =>
              (this.nameFilter = (e.target as HTMLInputElement).value)}
          />
        </label>
        <span class="meta">${rows.length} / ${this.players.length} players</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${this.headerCell("A", "fanta_evaluation")}
              ${this.headerCell("Name", "name")}
              ${this.headerCell("Team", "team")}
              <th>Roles</th>
              ${this.headerCell("Value", "fanta_market_value")}
              ${this.headerCell("Evaluation", "evaluation")}
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? html`<tr><td colspan="6" class="empty">No players match the filters.</td></tr>`
              : rows.map((p) => this.renderRow(p))}
          </tbody>
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "evaluations-page": EvaluationsPage;
  }
}
