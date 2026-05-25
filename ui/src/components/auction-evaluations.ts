import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

const BACKEND_URL = "http://localhost:8000";
const BASE_CREDITS = 1000;

type SortKey =
  | "name"
  | "team"
  | "fanta_evaluation"
  | "fanta_market_value"
  | "evaluation";

type StatusKind = "under" | "ok" | "over";

interface PlayerRow {
  id: number;
  name: string;
  team: string;
  mantra_roles: string[];
  fanta_evaluation: number | null;
  fanta_market_value: number | null;
  evaluation: number | null;
}

interface Auction {
  id: number;
  name: string;
  status: "INITIAL" | "IN_PROGRESS" | "TERMINATED";
  number_of_auctioners: number;
  min_team_size: number;
  max_team_size: number;
  credits_per_team: number;
  number_of_goalkeepers: number;
}

interface EvaluationStatus {
  credits: { used: number; total: number; percentage: number; status: StatusKind };
  players: { evaluated: number; min: number; max: number; percentage: number; status: StatusKind };
  goalkeepers: { evaluated: number; target: number; percentage: number; status: StatusKind };
}

function toAuction(stored: number | null, credits: number): number | null {
  if (stored == null) return null;
  return Math.floor((stored * credits) / BASE_CREDITS);
}

function toBase(displayed: number, credits: number): number {
  return Math.floor((displayed * BASE_CREDITS) / credits);
}

const METRIC_CLASSES: Record<StatusKind, { bar: string; pct: string }> = {
  under: { bar: "bg-amber-500", pct: "text-amber-700" },
  ok: { bar: "bg-emerald-600", pct: "text-emerald-700" },
  over: { bar: "bg-rose-600", pct: "text-rose-700" },
};

@customElement("auction-evaluations")
export class AuctionEvaluations extends LitElement {
  @property({ attribute: false }) auction!: Auction;

  @state() private players: PlayerRow[] = [];
  @state() private status: EvaluationStatus | null = null;
  @state() private loading = true;
  @state() private loadError = "";
  @state() private teamFilter = "";
  @state() private roleFilter = "";
  @state() private nameFilter = "";
  @state() private sortKey: SortKey = "fanta_evaluation";
  @state() private sortDir: "asc" | "desc" = "desc";
  @state() private saveErrors = new Set<number>();
  @state() private csvBusy = false;
  @state() private csvMessage = "";
  @state() private csvMessageKind: "ok" | "err" | "busy" = "ok";
  @state() private starting = false;
  @state() private startError = "";

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("auction")) {
      const prev = changed.get("auction") as Auction | undefined;
      if (!prev || prev.id !== this.auction.id) {
        void this.load();
      }
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.loadError = "";
    this.saveErrors = new Set();
    try {
      const [playersRes, statusRes] = await Promise.all([
        fetch(`${BACKEND_URL}/players?auction_id=${this.auction.id}`),
        fetch(`${BACKEND_URL}/auctions/${this.auction.id}/evaluations/status`),
      ]);
      if (!playersRes.ok) throw new Error(`/players HTTP ${playersRes.status}`);
      if (!statusRes.ok) throw new Error(`/evaluations/status HTTP ${statusRes.status}`);
      this.players = (await playersRes.json()) as PlayerRow[];
      this.status = (await statusRes.json()) as EvaluationStatus;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/evaluations/status`,
      );
      if (!res.ok) return;
      this.status = (await res.json()) as EvaluationStatus;
    } catch {
      // Leave stale status in place.
    }
  }

  private get teams(): string[] {
    return Array.from(new Set(this.players.map((p) => p.team))).sort();
  }

  private get roles(): string[] {
    return Array.from(new Set(this.players.flatMap((p) => p.mantra_roles))).sort();
  }

  private get allGreen(): boolean {
    const s = this.status;
    return (
      !!s &&
      s.credits.status === "ok" &&
      s.players.status === "ok" &&
      s.goalkeepers.status === "ok"
    );
  }

  private get startBlockers(): string[] {
    const s = this.status;
    if (!s) return ["loading…"];
    const out: string[] = [];
    if (s.credits.status !== "ok") out.push(`credits ${s.credits.status}`);
    if (s.players.status !== "ok") out.push(`players ${s.players.status}`);
    if (s.goalkeepers.status !== "ok") out.push(`goalkeepers ${s.goalkeepers.status}`);
    return out;
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
    const trimmed = raw.trim();
    const displayed: number | null = trimmed === "" ? null : Number.parseInt(trimmed, 10);
    if (displayed !== null && (Number.isNaN(displayed) || displayed < 0)) return;

    const stored: number | null =
      displayed === null ? null : toBase(displayed, this.auction.credits_per_team);

    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/evaluations/${playerId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ evaluation: stored }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as { evaluation: number | null };
      this.players = this.players.map((p) =>
        p.id === playerId ? { ...p, evaluation: updated.evaluation } : p,
      );
      if (this.saveErrors.has(playerId)) {
        this.saveErrors.delete(playerId);
        this.saveErrors = new Set(this.saveErrors);
      }
      void this.refreshStatus();
    } catch {
      this.saveErrors = new Set(this.saveErrors).add(playerId);
    }
  }

  private exportCsv(): void {
    window.open(
      `${BACKEND_URL}/auctions/${this.auction.id}/evaluations/export`,
      "_blank",
      "noopener",
    );
  }

  private triggerImport(): void {
    const input = this.renderRoot.querySelector(
      'input[type="file"][data-csv]',
    ) as HTMLInputElement | null;
    input?.click();
  }

  private async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (
      !confirm(
        `Import evaluations from "${file.name}" into "${this.auction.name}"?\n` +
          `Players present in the CSV will be overwritten; others stay as they are.`,
      )
    ) {
      input.value = "";
      return;
    }

    this.csvBusy = true;
    this.csvMessageKind = "busy";
    this.csvMessage = `Uploading ${file.name}…`;

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/evaluations/import`,
        { method: "POST", body: fd },
      );
      const data = (await res.json().catch(() => ({}))) as {
        imported?: number;
        unknown_player_ids?: number[];
        detail?: unknown;
      };
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : data.detail != null
              ? JSON.stringify(data.detail)
              : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      const unknown = data.unknown_player_ids ?? [];
      const unknownNote = unknown.length
        ? ` (${unknown.length} unknown player_id${unknown.length === 1 ? "" : "s"} skipped)`
        : "";
      this.csvMessageKind = "ok";
      this.csvMessage = `Imported ${data.imported ?? 0} evaluation${data.imported === 1 ? "" : "s"}.${unknownNote}`;
      await this.load();
    } catch (err) {
      this.csvMessageKind = "err";
      this.csvMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.csvBusy = false;
      input.value = "";
    }
  }

  private async startAuction(): Promise<void> {
    if (!this.allGreen) return;
    if (
      !confirm(
        `Start auction "${this.auction.name}"? Evaluations will be locked once the auction is IN_PROGRESS.`,
      )
    ) {
      return;
    }
    this.starting = true;
    this.startError = "";
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${this.auction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.dispatchEvent(
        new CustomEvent("auction-started", {
          detail: { auctionId: this.auction.id },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this.startError = err instanceof Error ? err.message : String(err);
    } finally {
      this.starting = false;
    }
  }

  private renderStartBar() {
    const blockers = this.startBlockers;
    const tooltip = this.allGreen
      ? "All requirements met — ready to start"
      : `Blocked by: ${blockers.join(", ")}`;
    return html`
      <div class="flex items-center gap-3 flex-wrap">
        <button
          ?disabled=${!this.allGreen || this.starting}
          title=${tooltip}
          @click=${() => this.startAuction()}
          class=${"rounded px-4 py-2 text-sm font-semibold text-white shadow-sm transition " +
          (this.allGreen
            ? "bg-emerald-600 hover:bg-emerald-700"
            : "bg-slate-300 cursor-not-allowed")}
        >
          ${this.starting ? "Starting…" : "Start auction"}
        </button>
        ${this.allGreen
          ? html`<span class="text-sm text-emerald-700">
              All requirements met.
            </span>`
          : html`<span class="text-sm text-slate-500">
              Blocked: ${blockers.join(", ")}.
            </span>`}
        ${this.startError
          ? html`<span class="text-sm text-rose-700">${this.startError}</span>`
          : nothing}
      </div>
    `;
  }

  private renderCsvActions() {
    return html`
      <div class="flex items-center gap-2 flex-wrap text-sm">
        <button
          @click=${() => this.exportCsv()}
          ?disabled=${this.csvBusy}
          class="rounded border border-slate-300 px-3 py-1 bg-white hover:bg-slate-50 disabled:opacity-50"
        >
          Export CSV
        </button>
        <button
          @click=${() => this.triggerImport()}
          ?disabled=${this.csvBusy}
          class="rounded border border-slate-300 px-3 py-1 bg-white hover:bg-slate-50 disabled:opacity-50"
        >
          Import CSV
        </button>
        <input
          type="file"
          accept=".csv,text/csv"
          data-csv
          class="hidden"
          @change=${(e: Event) => this.onImportFile(e)}
        />
        ${this.csvMessage
          ? html`<span
              class=${this.csvMessageKind === "err"
                ? "text-rose-700"
                : this.csvMessageKind === "ok"
                  ? "text-emerald-700"
                  : "text-slate-600 italic"}
            >${this.csvMessage}</span>`
          : nothing}
      </div>
    `;
  }

  private renderIndicator() {
    const s = this.status;
    if (!s) return nothing;
    const a = this.auction;
    const fmtPct = (p: number) => `${p.toFixed(0)}%`;
    const barWidth = (p: number) => `${Math.min(p, 100)}%`;

    const metric = (
      label: string,
      value: string,
      kind: StatusKind,
      percentage: number,
    ) => {
      const cls = METRIC_CLASSES[kind];
      return html`
        <div class="flex flex-col gap-1">
          <div class="flex items-baseline gap-2 text-xs text-slate-600">
            <span>${label}</span>
            <span>${value}</span>
            <span class="ml-auto font-semibold text-sm ${cls.pct}">
              ${fmtPct(percentage)}
            </span>
          </div>
          <div class="h-1.5 rounded bg-slate-200 overflow-hidden">
            <div
              class="h-full transition-[width] duration-150 ${cls.bar}"
              style="width: ${barWidth(percentage)}"
            ></div>
          </div>
        </div>
      `;
    };

    return html`
      <div class="border border-slate-200 rounded-md p-3 bg-slate-50 max-w-xl flex flex-col gap-2">
        <div class="text-sm font-semibold text-slate-800">
          ${a.number_of_auctioners} auctioners · ${a.credits_per_team} credits/team
        </div>
        ${metric(
          "Credits spent",
          `${s.credits.used} / ${s.credits.total}`,
          s.credits.status,
          s.credits.percentage,
        )}
        ${metric(
          "Players evaluated",
          `${s.players.evaluated} / ${s.players.min}–${s.players.max}`,
          s.players.status,
          s.players.percentage,
        )}
        ${metric(
          "Goalkeepers evaluated",
          `${s.goalkeepers.evaluated} / ${s.goalkeepers.target}`,
          s.goalkeepers.status,
          s.goalkeepers.percentage,
        )}
      </div>
    `;
  }

  private headerCell(label: string, key: SortKey) {
    const arrow =
      this.sortKey === key
        ? html`<span class="text-sky-600 ml-1">
            ${this.sortDir === "asc" ? "▲" : "▼"}
          </span>`
        : nothing;
    return html`
      <th
        @click=${() => this.setSort(key)}
        class="sticky top-0 bg-slate-100 cursor-pointer select-none px-3 py-2 text-left whitespace-nowrap"
      >${label}${arrow}</th>
    `;
  }

  private renderRow(p: PlayerRow, credits: number) {
    const scaledEval = toAuction(p.evaluation, credits);
    return html`
      <tr class="border-b border-slate-100">
        <td class="px-3 py-1.5 whitespace-nowrap">${p.fanta_evaluation ?? ""}</td>
        <td class="px-3 py-1.5 whitespace-nowrap">
          ${p.name}
          ${this.saveErrors.has(p.id)
            ? html`<span class="text-rose-700 ml-1" title="last save failed">⚠</span>`
            : nothing}
        </td>
        <td class="px-3 py-1.5 whitespace-nowrap">${p.team}</td>
        <td class="px-3 py-1.5 whitespace-nowrap">${p.mantra_roles.join(", ")}</td>
        <td class="px-3 py-1.5 whitespace-nowrap">${toAuction(p.fanta_market_value, credits) ?? ""}</td>
        <td class="px-3 py-1.5 whitespace-nowrap">
          <input
            type="number"
            min="0"
            step="1"
            .value=${scaledEval === null ? "" : String(scaledEval)}
            @change=${(e: Event) => this.save(p.id, (e.target as HTMLInputElement).value)}
            class="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-right text-sm"
          />
        </td>
      </tr>
    `;
  }

  override render() {
    if (this.loading) return html`<p class="text-slate-600">Loading…</p>`;
    if (this.loadError)
      return html`<p class="text-rose-700">Failed to load: ${this.loadError}</p>`;

    const a = this.auction;
    const credits = a.credits_per_team;
    const rows = this.filteredSorted;

    return html`
      <div class="flex flex-col gap-4">
        ${this.renderStartBar()}

        <div class="text-sm text-slate-600">
          ${a.number_of_auctioners} auctioners ·
          ${a.credits_per_team} credits/team ·
          ${a.min_team_size}–${a.max_team_size} players/team
        </div>

        ${this.renderIndicator()} ${this.renderCsvActions()}

        <div class="flex items-center gap-3 flex-wrap text-sm">
          <label class="flex items-center gap-2">
            Team:
            <select
              .value=${this.teamFilter}
              @change=${(e: Event) =>
                (this.teamFilter = (e.target as HTMLSelectElement).value)}
              class="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">All</option>
              ${this.teams.map((t) => html`<option value=${t}>${t}</option>`)}
            </select>
          </label>
          <label class="flex items-center gap-2">
            Role:
            <select
              .value=${this.roleFilter}
              @change=${(e: Event) =>
                (this.roleFilter = (e.target as HTMLSelectElement).value)}
              class="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">All</option>
              ${this.roles.map((r) => html`<option value=${r}>${r}</option>`)}
            </select>
          </label>
          <label class="flex items-center gap-2">
            Name:
            <input
              type="text"
              placeholder="e.g. mart"
              .value=${this.nameFilter}
              @input=${(e: Event) =>
                (this.nameFilter = (e.target as HTMLInputElement).value)}
              class="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <span class="ml-auto text-xs text-slate-500">
            ${rows.length} / ${this.players.length} players
          </span>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr>
                ${this.headerCell("A", "fanta_evaluation")}
                ${this.headerCell("Name", "name")}
                ${this.headerCell("Team", "team")}
                <th class="sticky top-0 bg-slate-100 px-3 py-2 text-left whitespace-nowrap">
                  Roles
                </th>
                ${this.headerCell("Value", "fanta_market_value")}
                ${this.headerCell("Evaluation", "evaluation")}
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0
                ? html`<tr>
                    <td colspan="6" class="px-3 py-4 text-slate-500">
                      No players match the filters.
                    </td>
                  </tr>`
                : rows.map((p) => this.renderRow(p, credits))}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-evaluations": AuctionEvaluations;
  }
}
