import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { dragScroll } from "../drag-scroll";
import { icon } from "../icons";
import {
  BACKEND_URL,
  GK_ROLE,
  PERFORMANCE_ICON,
  performanceBucket,
  compareRoles,
  renderRoleChips,
  ROLE_ORDER,
  toAuctionCredits,
  type Auction,
  type LineupModule,
  type ModulePrediction,
  type Performance,
  type PlayerRow,
  type Purchase,
  type Team,
} from "../auction-shared";
import "./module-pitch";
import "./module-lineup-dialog";

interface TeamAggregate {
  team: Team;
  spent: number;
  count: number;
  gks: number;
  rows: { purchase: Purchase; player: PlayerRow | undefined }[];
  // Sum of price and sum of expected eval (scaled to auction credits)
  // — both restricted to purchases of players the user evaluated.
  evalSpent: number;
  evalExpected: number;
  performance: Performance;
}

// Sortable columns of the purchase-history table.
type HistSortKey = "time" | "name" | "serie" | "team" | "price" | "eval" | "deal";

// One denormalized purchase-history row: the purchase joined with its
// player + buying team, plus the precomputed eval/deal figures.
interface HistoryRow {
  purchase: Purchase;
  player: PlayerRow | undefined;
  playerName: string;
  serieTeam: string;
  teamName: string;
  scaledEval: number | null;
  performance: Performance;
}

// The teams board + purchase history, shared by the live-auction view
// (editable) and the finished view (`readonly`). In readonly mode every
// mutating affordance — inline edit, release, restore — is suppressed;
// the same layout and derived figures render as a static summary.
@customElement("auction-board")
@localized()
export class AuctionBoard extends LitElement {
  @property({ attribute: false }) auction!: Auction;
  @property({ attribute: false }) players: PlayerRow[] = [];
  @property({ attribute: false }) purchases: Purchase[] = [];
  @property({ attribute: false }) modulePredictions: Record<
    number,
    ModulePrediction[]
  > = {};
  // When true, render as a read-only summary (no edit/release/restore).
  @property({ type: Boolean }) readonly = false;

  @state() private editingPlayerId: number | null = null;
  @state() private editTeamId: number | "" = "";
  @state() private editPrice = "";
  @state() private editError = "";

  // Purchase-history table filters + sort. Independent of the per-team
  // edit state above (which the history table reuses for inline editing).
  @state() private histTeamFilter: number | "" = "";
  @state() private histSerieFilter = "";
  @state() private histRoleFilter = "";
  @state() private histNameFilter = "";
  @state() private histSortKey: HistSortKey = "time";
  @state() private histSortDir: "asc" | "desc" = "desc";

  // Derived once per (auction|players|purchases) change so the render
  // path doesn't rebuild the player Map per team and re-sort per render.
  @state() private teamAggregates: TeamAggregate[] = [];

  // Static reference data, fetched once on mount.
  @state() private modules: LineupModule[] = [];

  // Players removed from the active pool for this auction (restorable).
  @state() private discardedPlayers: PlayerRow[] = [];

  // Module-lineup explainer dialog state.
  @state() private lineupDialogOpen = false;
  @state() private lineupTeamId: number | null = null;
  @state() private lineupModuleName: string | null = null;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadModules();
  }

  private async loadModules(): Promise<void> {
    try {
      const res = await fetch(`${BACKEND_URL}/modules`);
      if (!res.ok) throw new Error(`/modules HTTP ${res.status}`);
      this.modules = (await res.json()) as LineupModule[];
    } catch {
      // Reference data — failing silently is fine; the row just stays empty.
      this.modules = [];
    }
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (
      changed.has("auction") ||
      changed.has("players") ||
      changed.has("purchases")
    ) {
      this.teamAggregates = this.computeTeamAggregates();
    }
    if (changed.has("players")) {
      this.discardedPlayers = this.players
        .filter((p) => p.discarded)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  private computeTeamAggregates(): TeamAggregate[] {
    const teams = this.auction?.teams ?? [];
    const credits = this.auction?.credits_per_team ?? 0;
    const playerById = new Map(this.players.map((p) => [p.id, p]));
    const byTeam = new Map<number, TeamAggregate>();
    for (const t of teams) {
      byTeam.set(t.id, {
        team: t,
        spent: 0,
        count: 0,
        gks: 0,
        rows: [],
        evalSpent: 0,
        evalExpected: 0,
        performance: "none",
      });
    }
    for (const purchase of this.purchases) {
      const agg = byTeam.get(purchase.team_id);
      if (!agg) continue;
      const player = playerById.get(purchase.player_id);
      agg.spent += purchase.price;
      agg.count += 1;
      if (player && player.mantra_roles.includes(GK_ROLE)) agg.gks += 1;
      agg.rows.push({ purchase, player });

      // Performance signal: only count purchases of players the user
      // actually evaluated > 0. Unrated purchases carry no signal.
      const evalScaled = toAuctionCredits(player?.evaluation ?? null, credits);
      if (evalScaled !== null && evalScaled > 0) {
        agg.evalExpected += evalScaled;
        agg.evalSpent += purchase.price;
      }
    }
    for (const agg of byTeam.values()) {
      agg.rows.sort((a, b) => {
        // Players without a snapshot sort last.
        if (!a.player || !b.player) {
          return (a.player ? 0 : 1) - (b.player ? 0 : 1);
        }
        // Most defensive → most attacking; a C/T sorts below a pure C.
        const c = compareRoles(a.player.mantra_roles, b.player.mantra_roles);
        if (c !== 0) return c;
        return a.player.name.localeCompare(b.player.name);
      });
      agg.performance = performanceBucket(agg.evalSpent, agg.evalExpected);
    }
    return teams.map((t) => byTeam.get(t.id)!);
  }

  private openLineup(teamId: number, moduleName: string): void {
    this.lineupTeamId = teamId;
    this.lineupModuleName = moduleName;
    this.lineupDialogOpen = true;
  }

  private onLineupDialogClosed = (): void => {
    this.lineupDialogOpen = false;
  };

  private notifyPurchasesChanged(): void {
    this.dispatchEvent(
      new CustomEvent("purchases-changed", { bubbles: true, composed: true }),
    );
  }

  // Restoring a player only changes the active pool (the snapshot's
  // `discarded` flags + role saturation), not purchases — a separate
  // signal so the parent reloads the right slices.
  private notifyPoolChanged(): void {
    this.dispatchEvent(
      new CustomEvent("pool-changed", { bubbles: true, composed: true }),
    );
  }

  private async restorePlayer(player: PlayerRow): Promise<void> {
    if (this.readonly) return;
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/players/${player.id}/discard`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ discarded: false }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.notifyPoolChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  private startEdit(p: Purchase): void {
    if (this.readonly) return;
    this.editingPlayerId = p.player_id;
    this.editTeamId = p.team_id;
    this.editPrice = String(p.price);
    this.editError = "";
  }

  private cancelEdit(): void {
    this.editingPlayerId = null;
    this.editTeamId = "";
    this.editPrice = "";
    this.editError = "";
  }

  private async saveEdit(): Promise<void> {
    if (this.editingPlayerId == null) return;
    if (this.editTeamId === "") {
      this.editError = msg("Pick a team");
      return;
    }
    const teamId = this.editTeamId;
    const price = Number.parseInt(this.editPrice, 10);
    if (!Number.isFinite(price) || price < 0) {
      this.editError = msg("Price must be >= 0");
      return;
    }
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/purchases/${this.editingPlayerId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ team_id: teamId, price }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.notifyPurchasesChanged();
      this.cancelEdit();
    } catch (err) {
      this.editError = err instanceof Error ? err.message : String(err);
    }
  }

  private async deletePurchase(p: Purchase): Promise<void> {
    if (this.readonly) return;
    const player = this.players.find((pl) => pl.id === p.player_id);
    const playerName = player?.name ?? `#${p.player_id}`;
    if (
      !confirm(msg(str`Release ${playerName} back to the unsold pool?`))
    ) {
      return;
    }
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/purchases/${p.player_id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.notifyPurchasesChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  // Denormalized, filtered and sorted purchase rows for the history table.
  private get historyRows(): HistoryRow[] {
    const credits = this.auction.credits_per_team;
    const playerById = new Map(this.players.map((p) => [p.id, p]));
    const teamById = new Map(
      (this.auction.teams ?? []).map((t) => [t.id, t]),
    );
    const rows: HistoryRow[] = this.purchases.map((purchase) => {
      const player = playerById.get(purchase.player_id);
      const scaledEval = toAuctionCredits(player?.evaluation ?? null, credits);
      return {
        purchase,
        player,
        playerName: player?.name ?? `#${purchase.player_id}`,
        serieTeam: player?.team ?? "",
        teamName: teamById.get(purchase.team_id)?.team_name ?? "",
        scaledEval,
        performance: performanceBucket(purchase.price, scaledEval ?? 0),
      };
    });

    const name = this.histNameFilter.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        (this.histTeamFilter === "" ||
          r.purchase.team_id === this.histTeamFilter) &&
        (!this.histSerieFilter || r.serieTeam === this.histSerieFilter) &&
        (!this.histRoleFilter ||
          (r.player?.mantra_roles.includes(this.histRoleFilter) ?? false)) &&
        (!name || r.playerName.toLowerCase().includes(name)),
    );

    const dir = this.histSortDir === "asc" ? 1 : -1;
    const key = this.histSortKey;
    return filtered.sort((a, b) => {
      switch (key) {
        case "name":
          return a.playerName.localeCompare(b.playerName) * dir;
        case "serie":
          return a.serieTeam.localeCompare(b.serieTeam) * dir;
        case "team":
          return a.teamName.localeCompare(b.teamName) * dir;
        case "price":
          return (a.purchase.price - b.purchase.price) * dir;
        case "eval":
          return ((a.scaledEval ?? 0) - (b.scaledEval ?? 0)) * dir;
        case "deal":
          return (
            ((a.scaledEval ?? 0) - a.purchase.price -
              ((b.scaledEval ?? 0) - b.purchase.price)) *
            dir
          );
        case "time":
        default:
          return (
            (a.purchase.created_at ?? "").localeCompare(
              b.purchase.created_at ?? "",
            ) * dir
          );
      }
    });
  }

  private setHistSort(key: HistSortKey): void {
    if (this.histSortKey === key) {
      this.histSortDir = this.histSortDir === "asc" ? "desc" : "asc";
    } else {
      this.histSortKey = key;
      // Text columns default ascending; numeric/time columns descending.
      this.histSortDir = key === "name" || key === "serie" || key === "team"
        ? "asc"
        : "desc";
    }
  }

  // Short HH:MM for the history "Time" column; "—" when missing/unparseable.
  private formatPurchaseTime(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private renderPerformanceArrow(agg: TeamAggregate) {
    const choice = PERFORMANCE_ICON[agg.performance];
    const diff = agg.evalExpected - agg.evalSpent;
    const title =
      agg.performance === "none"
        ? msg("no evaluated purchases yet")
        : msg(
            str`vs your evals: ${diff >= 0 ? "+" : ""}${diff} cr (${agg.evalExpected} expected, ${agg.evalSpent} paid)`,
          );
    return html`<span class=${"shrink-0 " + choice.cls} title=${title}
      >${icon(choice.name, { size: 14 })}</span
    >`;
  }

  private renderTeamColumn(agg: TeamAggregate, teams: Team[]) {
    const t = agg.team;
    const left = this.auction.credits_per_team - agg.spent;
    const minOk = agg.count >= this.auction.min_team_size;
    const gkOk = agg.gks >= this.auction.number_of_goalkeepers;
    // No purchases yet → backend returns 1.0 for every module (no
    // signal). Hide the predictions block in that case rather than
    // showing a meaningless "all modules tied" list.
    const top3 = agg.count === 0
      ? []
      : (this.modulePredictions[t.id] ?? []).slice(0, 3);

    return html`
      <div
        class=${"flex flex-col min-w-[240px] w-[240px] rounded-xl shrink-0 border " +
        (t.is_my_team
          ? "border-accent/30 bg-accent/[0.04]"
          : "border-line bg-surface")}
      >
        <div class="px-3 py-2.5 border-b border-line flex flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <div class="text-[13px] font-bold truncate">${t.team_name}</div>
              ${t.is_my_team
                ? html`<span
                    class="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1 py-px rounded bg-accent text-black"
                    title=${msg("This is your team")}
                  >${msg("you")}</span>`
                : nothing}
              ${this.renderPerformanceArrow(agg)}
            </div>
            <div
              class=${"flex items-center gap-1 text-[12px] font-semibold tabular-nums " +
              (left <= 0 ? "text-danger" : "text-accent")}
              title=${msg("Credits left")}
            >${left}<span class="text-warn">${icon("coins", { size: 12 })}</span></div>
          </div>
          <div class="flex items-center gap-2 text-[10px] uppercase tracking-wider">
            <span
              class=${"flex items-center gap-1 " +
              (minOk ? "text-accent" : "text-fg-muted")}
              title=${msg("Players")}
            >
              <span class="text-sky-400">${icon("users", { size: 11 })}</span>${agg.count}/${this.auction.min_team_size}
            </span>
            <span class=${gkOk ? "text-accent" : "text-fg-muted"}>
              ${msg(str`GK ${agg.gks}/${this.auction.number_of_goalkeepers}`)}
            </span>
            <span
              class="flex items-center gap-1 text-fg-muted ml-auto"
              title=${msg("Credits spent")}
            >
              ${msg("spent")} ${agg.spent}<span class="text-warn">${icon("coins", { size: 11 })}</span>
            </span>
          </div>
        </div>
        ${top3.length > 0
          ? html`<div class="px-3 py-2 border-b border-line flex flex-col gap-1">
              ${top3.map(
                (m) => html`
                  <button
                    type="button"
                    @click=${() => this.openLineup(t.id, m.name)}
                    title=${msg(str`Show ${m.name} lineup for ${t.team_name}`)}
                    class="flex items-center gap-2 text-[11px] w-full px-1 py-0.5 -mx-1 rounded hover:bg-surface-hover text-left"
                  >
                    <span class="font-semibold text-fg w-9">${m.name}</span>
                    <div class="flex-1 h-0.5 bg-line rounded-full overflow-hidden">
                      <div
                        class="h-full rounded-full"
                        style=${`width: ${Math.round(m.confidence * 100)}%; background-color: hsl(${Math.round(m.confidence * 100) * 1.2}, 80%, 50%);`}
                      ></div>
                    </div>
                    <span class="text-fg-muted tabular-nums w-9 text-right">
                      ${Math.round(m.confidence * 100)}%
                    </span>
                  </button>
                `,
              )}
            </div>`
          : nothing}
        <div class="flex flex-col">
          ${agg.rows.length === 0
            ? html`<div class="px-3 py-3 text-[12px] text-fg-muted italic">
                ${msg("No players yet")}
              </div>`
            : agg.rows.map(({ purchase, player }) =>
                this.renderPurchaseRow(purchase, player, teams),
              )}
        </div>
      </div>
    `;
  }

  private renderPurchaseRow(
    purchase: Purchase,
    player: PlayerRow | undefined,
    teams: Team[],
  ) {
    if (!this.readonly && this.editingPlayerId === purchase.player_id) {
      return html`
        <div class="px-2 py-2 border-b border-line last:border-b-0 flex flex-col gap-1.5 bg-app/40">
          <div class="text-[12px] font-semibold truncate">
            ${player?.name ?? `#${purchase.player_id}`}
          </div>
          <select
            .value=${String(this.editTeamId)}
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              this.editTeamId = v ? Number.parseInt(v, 10) : "";
            }}
            class="w-full bg-app border border-line text-fg rounded px-2 py-1 text-[12px] focus:outline-none focus:border-accent"
          >
            ${teams.map(
              (t) => html`<option value=${t.id}>${t.team_name}</option>`,
            )}
          </select>
          <div class="flex gap-1.5">
            <input
              type="number"
              min="0"
              step="1"
              .value=${this.editPrice}
              @input=${(e: Event) =>
                (this.editPrice = (e.target as HTMLInputElement).value)}
              class="flex-1 bg-app border border-line text-fg rounded px-2 py-1 text-[12px] text-right tabular-nums focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              @click=${() => this.saveEdit()}
              class="px-2 py-1 rounded text-[11px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22]"
            >${msg("OK")}</button>
            <button
              type="button"
              @click=${() => this.cancelEdit()}
              class="px-2 py-1 rounded text-[11px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover"
            >${msg("X")}</button>
          </div>
          ${this.editError
            ? html`<p class="text-danger text-[11px] m-0">${this.editError}</p>`
            : nothing}
        </div>
      `;
    }
    return html`
      <div class="group px-2.5 py-1.5 border-b border-line last:border-b-0 flex items-center gap-2 hover:bg-surface-hover">
        <div class="min-w-0 flex-1">
          <div class="text-[12px] font-semibold truncate">
            ${player?.name ?? `#${purchase.player_id}`}
          </div>
          <div class="text-[10px] text-fg-muted">
            ${player ? renderRoleChips(player.mantra_roles) : nothing}
          </div>
        </div>
        <div class="text-[12px] tabular-nums font-semibold">${purchase.price}</div>
        ${this.readonly
          ? nothing
          : html`<div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label=${msg("Edit")}
                title=${msg("Edit")}
                @click=${() => this.startEdit(purchase)}
                class="w-6 h-6 grid place-items-center rounded text-fg-dim hover:text-fg hover:bg-surface"
              >${icon("pencil", { size: 12 })}</button>
              <button
                type="button"
                aria-label=${msg("Release")}
                title=${msg("Release")}
                @click=${() => this.deletePurchase(purchase)}
                class="w-6 h-6 grid place-items-center rounded text-danger hover:bg-danger/10"
              >${icon("trash", { size: 12 })}</button>
            </div>`}
      </div>
    `;
  }

  private renderDiscardedPanel() {
    // Discarded players are a live-auction concern only — hidden once the
    // auction is terminated (readonly). While in progress the block is
    // always shown (even with none yet) so its slot stays stable.
    if (this.readonly) return nothing;
    const discarded = this.discardedPlayers;
    return html`
      <section class="mt-6">
        <h2 class="text-[16px] font-bold m-0 mb-3">
          ${msg(str`Discarded (${discarded.length})`)}
        </h2>
        <div class="rounded-xl border border-line bg-surface px-3 py-2.5">
          ${discarded.length === 0
            ? html`<p class="text-[12px] text-fg-muted italic m-0">
                ${msg("No discarded players.")}
              </p>`
            : html`<div class="flex flex-wrap gap-1.5">
                ${discarded.map(
                  (p) => html`
                    <div
                      class="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border border-line bg-app text-[12px]"
                    >
                      <span class="font-semibold text-fg-dim">${p.name}</span>
                      ${renderRoleChips(p.mantra_roles)}
                      <button
                        type="button"
                        @click=${() => this.restorePlayer(p)}
                        aria-label=${msg(str`Restore ${p.name}`)}
                        title=${msg("Restore to the active pool")}
                        class="w-6 h-6 grid place-items-center rounded-full text-accent hover:bg-accent/10"
                      >${icon("rotate-ccw", { size: 12 })}</button>
                    </div>
                  `,
                )}
              </div>`}
        </div>
      </section>
    `;
  }

  // Sortable column header for the history table.
  private histHeader(
    label: string,
    key: HistSortKey,
    align: "left" | "right" | "center" = "left",
  ) {
    const active = this.histSortKey === key;
    const arrow = active ? (this.histSortDir === "asc" ? "↑" : "↓") : "↕";
    const alignCls =
      align === "right"
        ? " text-right"
        : align === "center"
          ? " text-center"
          : " text-left";
    return html`
      <th
        @click=${() => this.setHistSort(key)}
        class=${"sticky top-0 z-10 bg-surface-2 cursor-pointer select-none px-3 py-[7px] text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap border-b border-line transition-colors " +
        (active ? "text-fg" : "text-fg-muted hover:text-fg") +
        alignCls}
      >
        ${label}
        <span
          class=${"inline-block ml-1 " +
          (active ? "opacity-100 text-accent" : "opacity-40")}
        >${arrow}</span>
      </th>
    `;
  }

  private renderHistoryRow(r: HistoryRow, teams: Team[]) {
    const p = r.purchase;
    if (!this.readonly && this.editingPlayerId === p.player_id) {
      return html`
        <tr class="border-b border-line last:border-b-0 bg-app/40">
          <td class="px-3 py-2 text-[12px] font-semibold">${r.playerName}</td>
          <td class="px-3 py-2" colspan="4">
            <div class="flex gap-1.5 items-center">
              <select
                @change=${(e: Event) => {
                  const v = (e.target as HTMLSelectElement).value;
                  this.editTeamId = v ? Number.parseInt(v, 10) : "";
                }}
                class="flex-1 min-w-0 bg-app border border-line text-fg rounded px-2 py-1 text-[12px] focus:outline-none focus:border-accent"
              >
                ${teams.map(
                  (t) => html`<option
                    value=${t.id}
                    ?selected=${t.id === this.editTeamId}
                  >${t.team_name}</option>`,
                )}
              </select>
              <input
                type="number"
                min="0"
                step="1"
                .value=${this.editPrice}
                @input=${(e: Event) =>
                  (this.editPrice = (e.target as HTMLInputElement).value)}
                class="w-[72px] shrink-0 bg-app border border-line text-fg rounded px-2 py-1 text-[12px] text-right tabular-nums focus:outline-none focus:border-accent"
              />
            </div>
            ${this.editError
              ? html`<p class="text-danger text-[11px] m-0 mt-1">
                  ${this.editError}
                </p>`
              : nothing}
          </td>
          <td class="px-3 py-2 text-right" colspan="3">
            <div class="flex gap-1.5 justify-end">
              <button
                type="button"
                @click=${() => this.saveEdit()}
                class="px-2 py-1 rounded text-[11px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22]"
              >${msg("OK")}</button>
              <button
                type="button"
                @click=${() => this.cancelEdit()}
                class="px-2 py-1 rounded text-[11px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover"
              >${msg("X")}</button>
            </div>
          </td>
        </tr>
      `;
    }
    const choice = PERFORMANCE_ICON[r.performance];
    const diff = (r.scaledEval ?? 0) - p.price;
    const dealTitle =
      r.performance === "none"
        ? msg("not evaluated")
        : msg(
            str`vs your eval: ${diff >= 0 ? "+" : ""}${diff} cr (eval ${r.scaledEval}, paid ${p.price})`,
          );
    return html`
      <tr class="group border-b border-line last:border-b-0 hover:bg-surface-hover">
        <td class="px-3 py-1.5">
          <div class="flex items-center gap-1.5">
            <span class="text-[12px] font-semibold">${r.playerName}</span>
            ${r.player ? renderRoleChips(r.player.mantra_roles) : nothing}
          </div>
        </td>
        <td class="px-3 py-1.5 text-[12px] text-fg-dim">${r.serieTeam || "—"}</td>
        <td class="px-3 py-1.5 text-[12px]">${r.teamName || "—"}</td>
        <td class="px-3 py-1.5 text-[12px] text-right tabular-nums font-semibold">
          ${p.price}
        </td>
        <td class="px-3 py-1.5 text-[12px] text-right tabular-nums text-fg-dim">
          ${r.scaledEval ?? "—"}
        </td>
        <td class="px-3 py-1.5 text-right">
          <span class=${"inline-flex justify-end " + choice.cls} title=${dealTitle}
            >${icon(choice.name, { size: 14 })}</span
          >
        </td>
        <td class="px-3 py-1.5 text-[11px] text-right tabular-nums text-fg-muted whitespace-nowrap">
          ${this.formatPurchaseTime(p.created_at)}
        </td>
        <td class="px-3 py-1.5 text-right whitespace-nowrap">
          ${this.readonly
            ? nothing
            : html`<div class="flex gap-0.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  aria-label=${msg("Edit")}
                  title=${msg("Edit")}
                  @click=${() => this.startEdit(p)}
                  class="w-6 h-6 grid place-items-center rounded text-fg-dim hover:text-fg hover:bg-surface"
                >${icon("pencil", { size: 12 })}</button>
                <button
                  type="button"
                  aria-label=${msg("Release")}
                  title=${msg("Release")}
                  @click=${() => this.deletePurchase(p)}
                  class="w-6 h-6 grid place-items-center rounded text-danger hover:bg-danger/10"
                >${icon("trash", { size: 12 })}</button>
              </div>`}
        </td>
      </tr>
    `;
  }

  private renderHistory() {
    const teams = this.auction.teams ?? [];
    const rows = this.historyRows;
    // Serie A clubs that actually appear among the purchases — keeps the
    // dropdown short and relevant.
    const serieTeams = [
      ...new Set(
        this.purchases
          .map((p) => this.players.find((pl) => pl.id === p.player_id)?.team)
          .filter((t): t is string => !!t),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const selectCls =
      "bg-app border border-line text-fg rounded px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-accent";
    return html`
      <section class="mt-6">
        <h2 class="text-[16px] font-bold m-0 mb-3">
          ${msg(str`History (${this.purchases.length})`)}
        </h2>
        <div class="rounded-xl border border-line bg-surface overflow-hidden">
          <div class="flex flex-wrap gap-2 items-center px-3 py-2.5 border-b border-line">
            <div class="relative">
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none">
                ${icon("search", { size: 14 })}
              </span>
              <input
                type="text"
                placeholder=${msg("Search player…")}
                .value=${this.histNameFilter}
                @input=${(e: Event) =>
                  (this.histNameFilter = (e.target as HTMLInputElement).value)}
                class="bg-app border border-line text-fg rounded px-3 py-1.5 pl-8 text-[12px] min-w-[180px] focus:outline-none focus:border-accent"
              />
            </div>
            <select
              .value=${this.histRoleFilter}
              @change=${(e: Event) =>
                (this.histRoleFilter = (e.target as HTMLSelectElement).value)}
              class=${selectCls}
            >
              <option value="">${msg("All roles")}</option>
              ${ROLE_ORDER.map((r) => html`<option value=${r}>${r}</option>`)}
            </select>
            <select
              .value=${String(this.histTeamFilter)}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                this.histTeamFilter = v ? Number.parseInt(v, 10) : "";
              }}
              class=${selectCls}
            >
              <option value="">${msg("All teams")}</option>
              ${teams.map(
                (t) => html`<option value=${t.id}>${t.team_name}</option>`,
              )}
            </select>
            <select
              .value=${this.histSerieFilter}
              @change=${(e: Event) =>
                (this.histSerieFilter = (e.target as HTMLSelectElement).value)}
              class=${selectCls}
            >
              <option value="">${msg("All Serie A teams")}</option>
              ${serieTeams.map((t) => html`<option value=${t}>${t}</option>`)}
            </select>
          </div>
          <div class="overflow-auto max-h-[360px]">
            <table class="w-full border-collapse text-left">
              <thead>
                <tr>
                  ${this.histHeader(msg("Player"), "name")}
                  ${this.histHeader(msg("Serie A"), "serie")}
                  ${this.histHeader(msg("Team"), "team")}
                  ${this.histHeader(msg("Price"), "price", "right")}
                  ${this.histHeader(msg("Eval"), "eval", "right")}
                  ${this.histHeader(msg("Deal"), "deal", "right")}
                  ${this.histHeader(msg("Time"), "time", "right")}
                  <th
                    class="sticky top-0 z-10 bg-surface-2 px-3 py-[7px] border-b border-line"
                  ></th>
                </tr>
              </thead>
              <tbody>
                ${rows.length === 0
                  ? html`<tr>
                      <td
                        colspan="8"
                        class="px-3 py-4 text-center text-[12px] text-fg-muted"
                      >
                        ${msg("No purchases match the filters.")}
                      </td>
                    </tr>`
                  : rows.map((r) => this.renderHistoryRow(r, teams))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;
  }

  override render() {
    const teams = this.auction.teams ?? [];
    return html`
      <section>
        <h2 class="text-[16px] font-bold m-0 mb-3">${msg("Teams")}</h2>
        <div class="flex gap-3 overflow-x-auto pb-2" ${dragScroll()}>
          ${this.teamAggregates.map((agg) => this.renderTeamColumn(agg, teams))}
        </div>
      </section>
      ${this.renderDiscardedPanel()}
      ${this.renderHistory()}
      ${!this.readonly && this.modules.length > 0
        ? html`
            <section class="mt-6">
              <h2 class="text-[16px] font-bold m-0 mb-3">${msg("Modules")}</h2>
              <div class="flex gap-3 overflow-x-auto pb-2" ${dragScroll()}>
                ${this.modules.map(
                  (m) => html`<module-pitch .module=${m}></module-pitch>`,
                )}
              </div>
            </section>
          `
        : nothing}

      <module-lineup-dialog
        .auctionId=${this.auction.id}
        .teamId=${this.lineupTeamId}
        .moduleName=${this.lineupModuleName}
        .open=${this.lineupDialogOpen}
        @dialog-closed=${this.onLineupDialogClosed}
      ></module-lineup-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-board": AuctionBoard;
  }
}
