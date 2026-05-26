import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";

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
  number_of_teams: number;
}

interface EvaluationStatus {
  credits: { used: number; total: number; percentage: number; status: StatusKind };
  players: { evaluated: number; min: number; max: number; percentage: number; status: StatusKind };
  goalkeepers: { evaluated: number; target: number; percentage: number; status: StatusKind };
}

const ROLE_COLORS: Record<string, string> = {
  Por: "hsl(40, 94%, 52%)",
  Dc: "hsl(96, 70%, 46%)",
  Dd: "hsl(96, 70%, 46%)",
  Ds: "hsl(96, 70%, 46%)",
  B: "hsl(96, 70%, 46%)",
  E: "hsl(217, 93%, 52%)",
  M: "hsl(217, 93%, 52%)",
  C: "hsl(217, 93%, 52%)",
  W: "hsl(273, 100%, 61%)",
  T: "hsl(273, 100%, 61%)",
  A: "hsl(351, 89%, 53%)",
  Pc: "hsl(351, 89%, 53%)",
};

function toAuction(stored: number | null, credits: number): number | null {
  if (stored == null) return null;
  return Math.floor((stored * credits) / BASE_CREDITS);
}

function toBase(displayed: number, credits: number): number {
  // Ceil so a displayed value of 1 always round-trips back to >= 1
  // after toAuction's floor (otherwise stored=1 with credits<1000
  // displays as 0).
  return Math.ceil((displayed * BASE_CREDITS) / credits);
}

const FILL_CLS: Record<StatusKind, string> = {
  under: "bg-warn",
  ok: "bg-accent [box-shadow:0_0_8px_rgba(4,253,14,0.13)]",
  over: "bg-danger",
};

const PCT_CLS: Record<StatusKind, string> = {
  under: "text-warn",
  ok: "text-accent",
  over: "text-danger",
};

@customElement("auction-evaluations")
@localized()
export class AuctionEvaluations extends LitElement {
  @property({ attribute: false }) auction!: Auction;

  @state() private players: PlayerRow[] = [];
  @state() private status: EvaluationStatus | null = null;
  @state() private loading = true;
  @state() private loadError = "";
  @state() private teamFilter = "";
  @state() private roleFilter = "";
  @state() private nameFilter = "";
  @state() private onlyUneval = false;
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
      // leave stale
    }
  }

  private get teams(): string[] {
    return Array.from(new Set(this.players.map((p) => p.team))).sort();
  }

  private get roles(): string[] {
    return Array.from(new Set(this.players.flatMap((p) => p.mantra_roles))).sort();
  }

  private get teamsOk(): boolean {
    return this.auction.number_of_teams === this.auction.number_of_auctioners;
  }

  private get allGreen(): boolean {
    const s = this.status;
    return (
      !!s &&
      s.credits.status === "ok" &&
      s.players.status === "ok" &&
      s.goalkeepers.status === "ok" &&
      this.teamsOk
    );
  }

  private get filteredSorted(): PlayerRow[] {
    const name = this.nameFilter.trim().toLowerCase();
    const team = this.teamFilter;
    const role = this.roleFilter;
    const filtered = this.players.filter(
      (p) =>
        (!team || p.team === team) &&
        (!role || p.mantra_roles.includes(role)) &&
        (!name || p.name.toLowerCase().includes(name)) &&
        (!this.onlyUneval || p.evaluation == null || p.evaluation === 0),
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
    if (displayed !== null && (Number.isNaN(displayed) || displayed < 0)) {
      this.saveErrors = new Set(this.saveErrors).add(playerId);
      return;
    }

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
        msg(
          str`Import evaluations from "${file.name}" into "${this.auction.name}"?\nPlayers present in the CSV will be overwritten; others stay as they are.`,
        ),
      )
    ) {
      input.value = "";
      return;
    }

    this.csvBusy = true;
    this.csvMessageKind = "busy";
    this.csvMessage = msg(str`Uploading ${file.name}…`);

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
      const unknownNote = unknown.length === 0
        ? ""
        : unknown.length === 1
          ? msg(" (1 unknown player_id skipped)")
          : msg(str` (${unknown.length} unknown player_ids skipped)`);
      const imported = data.imported ?? 0;
      this.csvMessageKind = "ok";
      this.csvMessage =
        imported === 1
          ? msg(str`Imported 1 evaluation.${unknownNote}`)
          : msg(str`Imported ${imported} evaluations.${unknownNote}`);
      await this.load();
    } catch (err) {
      this.csvMessageKind = "err";
      this.csvMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.csvBusy = false;
      input.value = "";
    }
  }

  private async autofill(): Promise<void> {
    if (
      !confirm(
        msg(
          str`Autofill will REPLACE all evaluations for "${this.auction.name}". Continue?`,
        ),
      )
    ) {
      return;
    }
    this.csvBusy = true;
    this.csvMessageKind = "busy";
    this.csvMessage = msg("Autofilling…");
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/evaluations/autofill`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        autofilled?: number;
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
      const n = data.autofilled ?? 0;
      this.csvMessageKind = "ok";
      this.csvMessage =
        n === 1
          ? msg("Autofilled 1 evaluation.")
          : msg(str`Autofilled ${n} evaluations.`);
      await this.load();
    } catch (err) {
      this.csvMessageKind = "err";
      this.csvMessage = err instanceof Error ? err.message : String(err);
    } finally {
      this.csvBusy = false;
    }
  }

  private async startAuction(): Promise<void> {
    if (!this.allGreen) return;
    if (
      !confirm(
        msg(
          str`Start auction "${this.auction.name}"? Evaluations will be locked once the auction is IN_PROGRESS.`,
        ),
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

  private renderBar(value: number, scaleMax: number, okFromPct: number, okToPct: number, statusKind: StatusKind) {
    const fillPct = Math.min(100, (value / scaleMax) * 100);
    return html`
      <div
        class="relative h-2.5 rounded-full bg-app border border-line"
      >
        <div
          class="absolute -top-px -bottom-px border-l border-r border-line-strong bg-accent/[0.06] pointer-events-none"
          style=${`left:${okFromPct}%; width:${okToPct - okFromPct}%;`}
        ></div>
        <div
          class=${"absolute top-0 bottom-0 left-0 rounded-full transition-[width] duration-200 " +
          FILL_CLS[statusKind]}
          style=${`width:${fillPct}%;`}
        ></div>
        <div
          class="absolute -top-1 -bottom-1 w-px bg-white/15"
          style=${`left:${okFromPct}%;`}
        ></div>
        <div
          class="absolute -top-1 -bottom-1 w-px bg-white/15"
          style=${`left:${okToPct}%;`}
        ></div>
      </div>
    `;
  }

  private renderEvalCard() {
    const s = this.status;
    if (!s) return nothing;

    const credits = s.credits;
    const players = s.players;
    const gk = s.goalkeepers;

    // Bar scales (130% of target gives an "over" zone visualization)
    const cScale = Math.max(credits.total * 1.3, credits.used * 1.05, 1);
    const cTargetPct = (credits.total / cScale) * 100;
    const cBand = 2; // ±2% visual band around the exact target

    const pScale = Math.max(players.max * 1.3, players.evaluated * 1.05, 1);
    const pOkFrom = (players.min / pScale) * 100;
    const pOkTo = (players.max / pScale) * 100;

    const gScale = Math.max(gk.target * 1.5, gk.evaluated * 1.05, 1);
    const gTargetPct = (gk.target / gScale) * 100;

    return html`
      <div
        class="rounded-xl border border-line bg-surface p-5 flex flex-col gap-3.5"
      >
        <div class="flex items-baseline justify-between">
          <h3 class="text-[13px] font-bold uppercase tracking-[0.08em] m-0">
            ${msg("Evaluation status")}
          </h3>
          <span class="text-[12px] text-fg-muted">
            ${msg(str`Targets × ${this.auction.number_of_auctioners} teams`)}
          </span>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between gap-3">
            <div class="text-[13px] font-semibold">${msg("Credits spent")}</div>
            <div class="text-[12px] text-fg-dim tabular-nums">
              <span>${credits.used} / ${credits.total}</span>
              <span class=${"ml-2 font-bold " + PCT_CLS[credits.status]}>
                ${Math.round(credits.percentage)}%
              </span>
            </div>
          </div>
          ${this.renderBar(
            credits.used,
            cScale,
            Math.max(0, cTargetPct - cBand),
            Math.min(100, cTargetPct + cBand),
            credits.status,
          )}
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between gap-3">
            <div class="text-[13px] font-semibold">${msg("Players evaluated")}</div>
            <div class="text-[12px] text-fg-dim tabular-nums">
              <span>${players.evaluated} / ${players.min}–${players.max}</span>
              <span class=${"ml-2 font-bold " + PCT_CLS[players.status]}>
                ${Math.round(players.percentage)}%
              </span>
            </div>
          </div>
          ${this.renderBar(players.evaluated, pScale, pOkFrom, pOkTo, players.status)}
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex items-baseline justify-between gap-3">
            <div class="text-[13px] font-semibold">${msg("Goalkeepers evaluated")}</div>
            <div class="text-[12px] text-fg-dim tabular-nums">
              <span>${gk.evaluated} / ${gk.target}</span>
              <span class=${"ml-2 font-bold " + PCT_CLS[gk.status]}>
                ${Math.round(gk.percentage)}%
              </span>
            </div>
          </div>
          ${this.renderBar(
            gk.evaluated,
            gScale,
            Math.max(0, gTargetPct - 3),
            Math.min(100, gTargetPct + 3),
            gk.status,
          )}
        </div>

        <div class="flex items-baseline justify-between gap-3">
          <div class="text-[13px] font-semibold">${msg("Teams ready")}</div>
          <div class="text-[12px] text-fg-dim tabular-nums">
            <span>
              ${this.auction.number_of_teams} /
              ${this.auction.number_of_auctioners}
            </span>
            <span
              class=${"ml-2 font-bold " +
              (this.teamsOk ? PCT_CLS.ok : PCT_CLS.under)}
            >
              ${this.teamsOk ? msg("ok") : msg("under")}
            </span>
          </div>
        </div>

        <div class="h-px bg-line my-1"></div>

        <button
          type="button"
          ?disabled=${!this.allGreen || this.starting}
          @click=${() => this.startAuction()}
          class="w-full inline-flex items-center justify-center gap-2 px-[18px] py-3 rounded text-[14px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22] hover:border-[#19ff22] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ${icon("play", { size: 14 })}
          ${this.starting ? msg("Starting…") : msg("Start auction")}
        </button>
        ${this.allGreen
          ? nothing
          : html`<p class="text-fg-dim text-[12px] text-center m-0">
              ${msg(html`All indicators (credits, players, goalkeepers,
              teams) must be
              <span class="text-accent font-bold">ok</span> to start.`)}
            </p>`}
        ${this.startError
          ? html`<p class="text-danger text-[12px] text-center m-0">
              ${this.startError}
            </p>`
          : nothing}
      </div>
    `;
  }

  private renderRoleChips(roles: string[]) {
    return html`
      <span>
        ${roles.map(
          (r) => html`
            <span
              class="inline-block text-[10px] font-bold tracking-wide px-1.5 py-px rounded mr-1 text-black min-w-[22px] text-center align-middle"
              style=${`background: ${ROLE_COLORS[r] ?? "#888"};`}
            >${r}</span>
          `,
        )}
      </span>
    `;
  }

  private headerCell(label: string, key: SortKey, align: "left" | "right" = "left") {
    const active = this.sortKey === key;
    const arrow = active ? (this.sortDir === "asc" ? "↑" : "↓") : "↕";
    return html`
      <th
        @click=${() => this.setSort(key)}
        class=${"sticky top-0 z-10 bg-surface-2 cursor-pointer select-none px-3 py-[7px] text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap border-b border-line transition-colors " +
        (active ? "text-fg" : "text-fg-muted hover:text-fg") +
        (align === "right" ? " text-right" : " text-left")}
      >
        ${label}
        <span class=${"inline-block ml-1 " + (active ? "opacity-100 text-accent" : "opacity-40")}>
          ${arrow}
        </span>
      </th>
    `;
  }

  private renderRow(p: PlayerRow, credits: number) {
    const scaledEval = toAuction(p.evaluation, credits);
    const scaledVal = toAuction(p.fanta_market_value, credits);
    // 0 is a real user-set value (means "I won't bid on this player") but it
    // doesn't count toward completeness — render it muted to mirror the
    // backend's `/evaluations/status` filter.
    const hasEval = scaledEval !== null && scaledEval > 0;
    return html`
      <tr class="hover:bg-surface-hover">
        <td class="px-3 py-[7px] text-[13px] text-right text-fg-muted w-[50px] border-b border-line tabular-nums">
          ${p.fanta_evaluation ?? ""}
        </td>
        <td class="px-3 py-[7px] text-[13px] font-semibold border-b border-line">
          ${p.name}
          ${this.saveErrors.has(p.id)
            ? html`<span class="text-danger ml-1" title=${msg("last save failed")}>⚠</span>`
            : nothing}
        </td>
        <td class="px-3 py-[7px] text-[13px] text-fg-dim border-b border-line">
          ${p.team}
        </td>
        <td class="px-3 py-[7px] text-[13px] whitespace-nowrap w-px border-b border-line">
          ${this.renderRoleChips(p.mantra_roles)}
        </td>
        <td class="px-3 py-[7px] text-[13px] text-right font-semibold w-[70px] border-b border-line tabular-nums">
          ${scaledVal ?? ""}
        </td>
        <td class="px-3 py-[7px] text-[13px] text-right w-[120px] border-b border-line">
          <input
            type="number"
            min="0"
            step="1"
            .value=${scaledEval === null ? "" : String(scaledEval)}
            @change=${(e: Event) => this.save(p.id, (e.target as HTMLInputElement).value)}
            placeholder="—"
            class=${"w-24 px-2 py-[5px] rounded text-right text-[13px] bg-surface-2 border border-line tabular-nums focus:outline-none focus:border-accent transition-colors " +
            (hasEval ? "text-accent" : "text-fg-muted")}
          />
        </td>
      </tr>
    `;
  }

  private renderTable() {
    const rows = this.filteredSorted;
    const credits = this.auction.credits_per_team;
    const csvMsgCls =
      this.csvMessageKind === "err"
        ? "text-danger"
        : this.csvMessageKind === "ok"
          ? "text-accent"
          : "text-fg-dim italic";

    return html`
      <div class="rounded-xl border border-line bg-surface overflow-hidden mt-6">
        <div class="flex flex-wrap gap-2.5 items-center px-4 py-3.5 border-b border-line">
          <div class="flex gap-2 flex-1 flex-wrap items-center">
            <div class="relative">
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none">
                ${icon("search", { size: 14 })}
              </span>
              <input
                type="text"
                placeholder=${msg("Search player…")}
                .value=${this.nameFilter}
                @input=${(e: Event) =>
                  (this.nameFilter = (e.target as HTMLInputElement).value)}
                class="bg-app border border-line text-fg rounded px-3 py-2 pl-8 text-[13px] min-w-[200px] max-w-[220px] focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <select
              .value=${this.roleFilter}
              @change=${(e: Event) =>
                (this.roleFilter = (e.target as HTMLSelectElement).value)}
              class="bg-app border border-line text-fg rounded px-3 py-2 text-[13px] max-w-[140px] focus:outline-none focus:border-accent"
            >
              <option value="">${msg("All roles")}</option>
              ${this.roles.map(
                (r) => html`<option value=${r}>${r}</option>`,
              )}
            </select>
            <select
              .value=${this.teamFilter}
              @change=${(e: Event) =>
                (this.teamFilter = (e.target as HTMLSelectElement).value)}
              class="bg-app border border-line text-fg rounded px-3 py-2 text-[13px] max-w-[200px] focus:outline-none focus:border-accent"
            >
              <option value="">${msg("All Serie A teams")}</option>
              ${this.teams.map(
                (t) => html`<option value=${t}>${t}</option>`,
              )}
            </select>
          </div>
          <label class="inline-flex items-center gap-1.5 text-[12px] text-fg-dim select-none cursor-pointer">
            <input
              type="checkbox"
              .checked=${this.onlyUneval}
              @change=${(e: Event) =>
                (this.onlyUneval = (e.target as HTMLInputElement).checked)}
              style="accent-color: var(--color-accent);"
            />
            ${msg("Only unevaluated")}
          </label>
        </div>

        <div class="max-h-[60vh] overflow-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                ${this.headerCell(msg("A"), "fanta_evaluation", "right")}
                ${this.headerCell(msg("Name"), "name")}
                ${this.headerCell(msg("Team"), "team")}
                <th
                  class="sticky top-0 z-10 bg-surface-2 px-3 py-[7px] text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-fg-muted border-b border-line"
                >${msg("Roles")}</th>
                ${this.headerCell(msg("Value"), "fanta_market_value", "right")}
                ${this.headerCell(msg("Evaluation"), "evaluation", "right")}
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0
                ? html`<tr>
                    <td
                      colspan="6"
                      class="text-center py-8 text-fg-muted text-[13px]"
                    >${msg("No players match these filters")}</td>
                  </tr>`
                : rows.map((p) => this.renderRow(p, credits))}
            </tbody>
          </table>
        </div>

        <div class="flex justify-between items-center px-4 py-3 border-t border-line text-[12px] text-fg-dim flex-wrap gap-2">
          <div>${msg(str`${rows.length} of ${this.players.length} players`)}</div>
          <div class="flex items-center gap-2">
            ${this.csvMessage
              ? html`<span class=${"text-[12px] " + csvMsgCls}>
                  ${this.csvMessage}
                </span>`
              : nothing}
            <button
              type="button"
              @click=${() => this.autofill()}
              ?disabled=${this.csvBusy}
              class="px-2.5 py-1.5 rounded text-[12px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover hover:border-line-strong disabled:opacity-40"
            >${msg("Autofill")}</button>
            <button
              type="button"
              @click=${() => this.exportCsv()}
              ?disabled=${this.csvBusy}
              class="px-2.5 py-1.5 rounded text-[12px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover hover:border-line-strong disabled:opacity-40"
            >${msg("Export CSV")}</button>
            <button
              type="button"
              @click=${() => this.triggerImport()}
              ?disabled=${this.csvBusy}
              class="px-2.5 py-1.5 rounded text-[12px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover hover:border-line-strong disabled:opacity-40"
            >${msg("Import CSV")}</button>
            <input
              type="file"
              accept=".csv,text/csv"
              data-csv
              class="hidden"
              @change=${(e: Event) => this.onImportFile(e)}
            />
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    if (this.loading) return html`<p class="text-fg-dim">${msg("Loading…")}</p>`;
    if (this.loadError)
      return html`<p class="text-danger">${msg(str`Failed to load: ${this.loadError}`)}</p>`;

    return html`
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div class="min-w-0">
          <h2 class="text-[18px] font-bold m-0 mb-1">${msg("Evaluate players")}</h2>
          <p class="text-[13px] text-fg-dim m-0">
            ${msg("Enter the maximum credits you'd spend on each player. Saves automatically.")}
          </p>
          ${this.renderTable()}
        </div>
        <aside class="flex flex-col gap-4 lg:sticky lg:top-[76px]">
          ${this.renderEvalCard()}
        </aside>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-evaluations": AuctionEvaluations;
  }
}
