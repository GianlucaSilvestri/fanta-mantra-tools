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
  renderRoleChips,
  roleSortKey,
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

@customElement("auction-running")
@localized()
export class AuctionRunning extends LitElement {
  @property({ attribute: false }) auction!: Auction;
  @property({ attribute: false }) players: PlayerRow[] = [];
  @property({ attribute: false }) purchases: Purchase[] = [];
  @property({ attribute: false }) modulePredictions: Record<
    number,
    ModulePrediction[]
  > = {};

  @state() private editingPlayerId: number | null = null;
  @state() private editTeamId: number | "" = "";
  @state() private editPrice = "";
  @state() private editError = "";

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
        const ar = a.player ? roleSortKey(a.player.mantra_roles) : ROLE_ORDER.length;
        const br = b.player ? roleSortKey(b.player.mantra_roles) : ROLE_ORDER.length;
        if (ar !== br) return ar - br;
        return (a.player?.name ?? "").localeCompare(b.player?.name ?? "");
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
    if (this.editingPlayerId === purchase.player_id) {
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
        <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
        </div>
      </div>
    `;
  }

  private renderDiscardedPanel() {
    const discarded = this.discardedPlayers;
    if (discarded.length === 0) return nothing;
    return html`
      <section class="mt-6">
        <div class="rounded-xl border border-line bg-surface px-3 py-2.5">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-warn">${icon("ban", { size: 14 })}</span>
            <h2 class="text-[12px] font-bold uppercase tracking-wider text-fg-muted m-0">
              ${msg(str`Discarded (${discarded.length})`)}
            </h2>
          </div>
          <div class="flex flex-wrap gap-1.5">
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
      ${this.modules.length > 0
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
    "auction-running": AuctionRunning;
  }
}
