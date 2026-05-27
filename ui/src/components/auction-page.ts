import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";
import {
  BACKEND_URL,
  GK_ROLE,
  renderRoleChips,
  toAuctionCredits,
  type Auction,
  type AuctionStatus,
  type PlayerRow,
  type Purchase,
} from "../auction-shared";
import "./auction-evaluations";
import "./auction-running";
import "./auction-finished";
import "./auction-dialog";
import "./evaluations-view-dialog";

function statusLabel(s: AuctionStatus): string {
  switch (s) {
    case "INITIAL":
      return msg("Initial");
    case "IN_PROGRESS":
      return msg("In Progress");
    case "TERMINATED":
      return msg("Terminated");
  }
}

const STATUS_PILL: Record<AuctionStatus, string> = {
  INITIAL: "text-fg-dim border-line-strong bg-surface",
  IN_PROGRESS: "text-accent border-accent/30 bg-accent/10",
  TERMINATED: "text-fg-muted border-line bg-transparent",
};

const STATUS_DOT: Record<AuctionStatus, string> = {
  INITIAL: "bg-fg-dim",
  IN_PROGRESS:
    "bg-accent animate-dot-pulse [box-shadow:0_0_6px_var(--color-accent)]",
  TERMINATED: "bg-fg-muted",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

@customElement("auction-page")
@localized()
export class AuctionPage extends LitElement {
  @property({ type: Number }) auctionId!: number;

  @state() private auction: Auction | null = null;
  @state() private loading = true;
  @state() private notFound = false;
  @state() private loadError = "";
  @state() private editDialogOpen = false;
  @state() private viewDialogOpen = false;
  @state() private players: PlayerRow[] = [];
  @state() private purchases: Purchase[] = [];
  @state() private terminating = false;
  @state() private terminateError = "";

  // Call/buy state — lifted from auction-running so the top-bar search
  // and the central-row selected card share one source of truth.
  @state() private searchQuery = "";
  @state() private showResults = false;
  @state() private selected: PlayerRow | null = null;
  @state() private buyTeamId: number | "" = "";
  @state() private buyPrice = "";
  @state() private buyBusy = false;
  @state() private buyError = "";

  // Derived state, recomputed in willUpdate so each render reads cached
  // arrays instead of re-scanning purchases/players for every getter call.
  @state() private terminateBlockers: string[] = [];
  @state() private searchResults: PlayerRow[] = [];

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("auctionId")) {
      const prev = changed.get("auctionId") as number | undefined;
      if (prev !== this.auctionId) {
        void this.load();
      }
    }
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (
      changed.has("auction") ||
      changed.has("players") ||
      changed.has("purchases")
    ) {
      this.terminateBlockers = this.computeTerminateBlockers();
    }
    if (
      changed.has("searchQuery") ||
      changed.has("players") ||
      changed.has("purchases")
    ) {
      this.searchResults = this.computeSearchResults();
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.notFound = false;
    this.loadError = "";
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${this.auctionId}`);
      if (res.status === 404) {
        this.notFound = true;
        this.auction = null;
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.auction = (await res.json()) as Auction;
      if (this.auction.status === "IN_PROGRESS") {
        await Promise.all([this.loadPlayers(), this.loadPurchases()]);
      } else {
        this.players = [];
        this.purchases = [];
        // Leaving IN_PROGRESS (e.g. just terminated) — drop any pending
        // call/buy selection so the UI doesn't render a buy form against
        // stale state.
        this.clearSelection();
      }
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async loadPlayers(): Promise<void> {
    const res = await fetch(
      `${BACKEND_URL}/players?auction_id=${this.auctionId}`,
    );
    if (!res.ok) throw new Error(`/players HTTP ${res.status}`);
    this.players = (await res.json()) as PlayerRow[];
  }

  private async loadPurchases(): Promise<void> {
    const res = await fetch(
      `${BACKEND_URL}/auctions/${this.auctionId}/purchases`,
    );
    if (!res.ok) throw new Error(`/purchases HTTP ${res.status}`);
    this.purchases = (await res.json()) as Purchase[];
  }

  private onAuctionStarted = (): void => {
    void this.load();
  };

  private onPurchasesChanged = (): void => {
    void this.loadPurchases();
  };

  private computeTerminateBlockers(): string[] {
    const a = this.auction;
    if (!a || a.status !== "IN_PROGRESS") return [];
    const playerById = new Map(this.players.map((p) => [p.id, p]));
    const teams = a.teams ?? [];
    const out: string[] = [];
    for (const t of teams) {
      let total = 0;
      let gks = 0;
      for (const p of this.purchases) {
        if (p.team_id !== t.id) continue;
        total += 1;
        const pl = playerById.get(p.player_id);
        if (pl && pl.mantra_roles.includes(GK_ROLE)) gks += 1;
      }
      const parts: string[] = [];
      if (total < a.min_team_size) {
        parts.push(`${total}/${a.min_team_size} players`);
      }
      if (gks < a.number_of_goalkeepers) {
        parts.push(`${gks}/${a.number_of_goalkeepers} GK`);
      }
      if (parts.length > 0) {
        out.push(`${t.team_name} (${parts.join(", ")})`);
      }
    }
    return out;
  }

  private get canTerminate(): boolean {
    return this.terminateBlockers.length === 0;
  }

  private async terminate(): Promise<void> {
    if (!this.auction || !this.canTerminate) return;
    if (
      !confirm(
        msg(
          str`Terminate "${this.auction.name}"? Purchases will be locked.`,
        ),
      )
    ) {
      return;
    }
    this.terminating = true;
    this.terminateError = "";
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${this.auctionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "TERMINATED" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      await this.load();
    } catch (err) {
      this.terminateError = err instanceof Error ? err.message : String(err);
    } finally {
      this.terminating = false;
    }
  }

  // ----- call / buy flow -----

  private computeSearchResults(): PlayerRow[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return [];
    const sold = new Set(this.purchases.map((p) => p.player_id));
    return this.players
      .filter((p) => !sold.has(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, 12);
  }

  private selectPlayer(p: PlayerRow): void {
    this.selected = p;
    this.searchQuery = "";
    this.showResults = false;
    this.buyTeamId = "";
    this.buyPrice = "";
    this.buyError = "";
  }

  private clearSelection(): void {
    this.selected = null;
    this.searchQuery = "";
    this.showResults = false;
    this.buyTeamId = "";
    this.buyPrice = "";
    this.buyError = "";
  }

  private async pickRandom(): Promise<void> {
    this.buyError = "";
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auctionId}/purchases/random-player`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      const p = (await res.json()) as PlayerRow;
      this.selectPlayer(p);
    } catch (err) {
      this.buyError = err instanceof Error ? err.message : String(err);
    }
  }

  private async confirmBuy(): Promise<void> {
    if (!this.selected) return;
    if (this.buyTeamId === "") {
      this.buyError = msg("Pick a team");
      return;
    }
    const teamId = this.buyTeamId;
    const price = Number.parseInt(this.buyPrice, 10);
    if (!Number.isFinite(price) || price < 0) {
      this.buyError = msg("Price must be >= 0");
      return;
    }
    this.buyBusy = true;
    this.buyError = "";
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auctionId}/purchases`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            player_id: this.selected.id,
            team_id: teamId,
            price,
          }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      await this.loadPurchases();
      this.clearSelection();
    } catch (err) {
      this.buyError = err instanceof Error ? err.message : String(err);
    } finally {
      this.buyBusy = false;
    }
  }

  private openEditDialog(): void {
    this.editDialogOpen = true;
  }

  private openViewDialog(): void {
    this.viewDialogOpen = true;
  }

  private onEditDialogClosed = (): void => {
    this.editDialogOpen = false;
  };

  private onViewDialogClosed = (): void => {
    this.viewDialogOpen = false;
  };

  private onAuctionSaved = (): void => {
    this.editDialogOpen = false;
    void this.load();
  };

  private renderHeaderAction(status: AuctionStatus) {
    const btnCls =
      "w-9 h-9 grid place-items-center rounded border border-transparent text-fg-dim hover:text-fg hover:bg-surface-hover hover:border-line-strong transition-colors";
    if (status === "INITIAL") {
      return html`<button
        type="button"
        aria-label=${msg("Edit auction")}
        title=${msg("Edit auction")}
        @click=${() => this.openEditDialog()}
        class=${btnCls}
      >${icon("pencil", { size: 16 })}</button>`;
    }
    return html`<button
      type="button"
      aria-label=${msg("Review evaluations")}
      title=${msg("Review evaluations")}
      @click=${() => this.openViewDialog()}
      class=${btnCls}
    >${icon("eye", { size: 16 })}</button>`;
  }

  private goHome(e: MouseEvent): void {
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent("app-navigate", { detail: { path: "/" } }),
    );
  }

  private renderStatusPill(status: AuctionStatus) {
    return html`
      <span
        class=${"inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] font-semibold uppercase tracking-wider border " +
        STATUS_PILL[status]}
      >
        <span class=${"w-1.5 h-1.5 rounded-full " + STATUS_DOT[status]}></span>
        ${statusLabel(status)}
      </span>
    `;
  }

  private renderTerminateWidget() {
    const blockers = this.terminateBlockers;
    const can = this.canTerminate;
    const blockerText = can
      ? msg("All teams meet the roster minimums.")
      : blockers.length === 1
        ? msg(str`Incomplete: ${blockers[0]}`)
        : msg(str`${blockers.length} teams incomplete`);
    return html`
      <div
        class="flex flex-col items-stretch gap-1.5 min-w-[170px] max-w-[260px]"
      >
        <button
          type="button"
          ?disabled=${!can || this.terminating}
          @click=${() => this.terminate()}
          title=${can ? msg("Terminate auction") : blockers.join("; ")}
          class="px-4 py-2 rounded text-[13px] font-semibold bg-danger text-white border border-danger hover:bg-danger/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ${this.terminating ? msg("Terminating…") : msg("Terminate auction")}
        </button>
        <p
          class=${"text-[11px] m-0 text-center " +
          (can ? "text-accent" : "text-fg-muted")}
          title=${can ? "" : blockers.join("; ")}
        >${blockerText}</p>
        ${this.terminateError
          ? html`<p class="text-danger text-[11px] m-0 text-center">
              ${this.terminateError}
            </p>`
          : nothing}
      </div>
    `;
  }

  private renderTopSearch() {
    const results = this.searchResults;
    return html`
      <div
        class="rounded-xl border border-line bg-surface p-3 h-full flex items-center"
      >
        <div class="relative w-full">
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none">
            ${icon("search", { size: 14 })}
          </span>
          <input
            type="text"
            placeholder=${msg("Search player…")}
            .value=${this.searchQuery}
            @input=${(e: Event) => {
              this.searchQuery = (e.target as HTMLInputElement).value;
              this.showResults = true;
            }}
            @focus=${() => (this.showResults = true)}
            class="w-full bg-app border border-line text-fg rounded px-3 py-2.5 pl-8 text-[13px] focus:outline-none focus:border-accent transition-colors"
          />
          ${this.showResults && results.length > 0
            ? html`
                <div
                  class="absolute left-0 top-full mt-1 min-w-full w-[320px] max-h-[280px] overflow-y-auto rounded border border-line-strong bg-surface shadow-[0_12px_28px_rgba(0,0,0,0.45)] z-20"
                >
                  ${results.map(
                    (p) => html`
                      <button
                        type="button"
                        @click=${() => this.selectPlayer(p)}
                        class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover border-b border-line last:border-b-0"
                      >
                        <span class="font-semibold text-[13px] flex-1 truncate">
                          ${p.name}
                        </span>
                        <span class="text-[12px] text-fg-dim">${p.team}</span>
                        ${renderRoleChips(p.mantra_roles)}
                      </button>
                    `,
                  )}
                </div>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private renderTopRandom() {
    return html`
      <div
        class="rounded-xl border border-line bg-surface p-3 h-full flex items-center"
      >
        <button
          type="button"
          @click=${() => this.pickRandom()}
          class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded text-[13px] font-semibold border border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
        >
          ${icon("play", { size: 14 })}
          ${msg("Pick a random player")}
        </button>
      </div>
    `;
  }

  private renderSelectedCard(a: Auction) {
    const p = this.selected;
    if (!p) return nothing;
    const teams = a.teams ?? [];
    const credits = a.credits_per_team;
    const scaledEval = toAuctionCredits(p.evaluation, credits);
    return html`
      <div
        class="rounded-xl border border-accent/30 bg-accent/[0.04] p-3 flex flex-col gap-2 h-full"
      >
        <div class="flex items-start gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <h3 class="text-[16px] font-bold m-0 leading-tight">
                ${p.name}
              </h3>
              ${renderRoleChips(p.mantra_roles)}
              <span
                class="inline-block text-[10px] font-bold tracking-wide px-1.5 py-px rounded bg-accent/15 text-accent tabular-nums align-middle"
              >${msg(str`Eval ${scaledEval ?? "—"}`)}</span>
            </div>
            <div class="text-[11px] text-fg-dim mt-1 truncate">${p.team}</div>
          </div>
          <button
            type="button"
            @click=${() => this.clearSelection()}
            aria-label=${msg("Cancel")}
            title=${msg("Cancel")}
            class="w-7 h-7 grid place-items-center rounded text-fg-dim hover:text-fg hover:bg-surface-hover shrink-0"
          >${icon("x", { size: 12 })}</button>
        </div>
        <div class="flex gap-1.5 items-center">
          <select
            .value=${String(this.buyTeamId)}
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              this.buyTeamId = v ? Number.parseInt(v, 10) : "";
            }}
            class="flex-1 min-w-0 bg-app border border-line text-fg rounded px-2 py-1.5 text-[12px] focus:outline-none focus:border-accent"
          >
            <option value="">${msg("— team —")}</option>
            ${teams.map(
              (t) => html`<option value=${t.id}>${t.team_name}</option>`,
            )}
          </select>
          <input
            type="number"
            min="0"
            step="1"
            .value=${this.buyPrice}
            @input=${(e: Event) =>
              (this.buyPrice = (e.target as HTMLInputElement).value)}
            placeholder=${msg("Price")}
            class="w-[68px] shrink-0 bg-app border border-line text-fg rounded px-2 py-1.5 text-[12px] text-right tabular-nums focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            ?disabled=${this.buyBusy ||
            this.buyTeamId === "" ||
            this.buyPrice.trim() === "" ||
            !Number.isFinite(Number.parseInt(this.buyPrice, 10)) ||
            Number.parseInt(this.buyPrice, 10) < 0}
            @click=${() => this.confirmBuy()}
            class="shrink-0 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22] hover:border-[#19ff22] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ${this.buyBusy ? msg("…") : msg("Buy")}
          </button>
        </div>
        ${this.buyError
          ? html`<p class="text-danger text-[11px] m-0">${this.buyError}</p>`
          : nothing}
      </div>
    `;
  }

  private renderInfoCard(a: Auction, span: string) {
    return html`
      <div class=${"rounded-xl border border-line bg-surface p-[22px] " + span}>
        <div class="flex items-center gap-6 flex-wrap">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-3 flex-wrap">
              <h1 class="text-[24px] font-bold tracking-tight m-0 truncate">
                ${a.name}
              </h1>
              ${this.renderStatusPill(a.status)}
              ${this.renderHeaderAction(a.status)}
            </div>
            <p class="text-[13px] text-fg-dim mt-1.5 mb-0">
              ${a.description ??
              msg(str`Created ${formatDate(a.created_at)}`)} ·
              ${msg(str`${a.number_of_teams} teams`)} ·
              ${msg(str`${a.number_of_auctioners} auctioners`)}
            </p>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-7">
            <div class="flex flex-col gap-0.5">
              <div class="text-[22px] font-bold tracking-tight tabular-nums">
                ${a.number_of_teams}
              </div>
              <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                ${msg("Teams")}
              </div>
            </div>
            <div class="flex flex-col gap-0.5">
              <div class="text-[22px] font-bold tracking-tight tabular-nums text-accent">
                ${a.credits_per_team}
              </div>
              <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                ${msg("Credits")}
              </div>
            </div>
            <div class="flex flex-col gap-0.5">
              <div class="text-[22px] font-bold tracking-tight tabular-nums">
                ${a.min_team_size}–${a.max_team_size}
              </div>
              <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                ${msg("Roster")}
              </div>
            </div>
            <div class="flex flex-col gap-0.5">
              <div class="text-[22px] font-bold tracking-tight tabular-nums">
                ${a.number_of_goalkeepers}
              </div>
              <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                ${msg("GK")}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderHeader(a: Auction) {
    const isRunning = a.status === "IN_PROGRESS";
    const infoSpan = isRunning ? "md:col-span-8" : "md:col-span-12";

    return html`
      <div class="flex items-center gap-2 mb-3 text-[12px] text-fg-muted">
        <a
          href="/"
          class="hover:text-fg transition-colors"
          @click=${(e: MouseEvent) => this.goHome(e)}
        >${msg("Auctions")}</a>
        ${icon("chevron", { size: 12 })}
        <span class="text-fg-dim">${a.name}</span>
      </div>

      <section class="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6 items-stretch">
        ${isRunning
          ? html`<div class="md:col-span-2">
              ${a.type === "CALL"
                ? this.renderTopSearch()
                : this.renderTopRandom()}
            </div>`
          : nothing}
        ${this.renderInfoCard(a, infoSpan)}
        ${isRunning
          ? html`<div
              class="md:col-span-2 rounded-xl border border-line bg-surface p-4 flex items-center justify-center"
            >${this.renderTerminateWidget()}</div>`
          : nothing}
      </section>
    `;
  }

  private renderCentralRow(a: Auction) {
    if (a.status !== "IN_PROGRESS") return nothing;
    const hint =
      a.type === "RANDOM"
        ? msg("Use the button above to pick a player.")
        : msg("Search above to call a player.");
    const leftSlot = this.selected
      ? this.renderSelectedCard(a)
      : html`<div
          class="rounded-xl border border-dashed border-line p-3 text-[12px] text-fg-muted h-full min-h-[120px] flex items-center justify-center text-center"
        >
          ${hint}
        </div>`;
    return html`
      <section class="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6 items-stretch">
        <div class="md:col-span-2">${leftSlot}</div>
        <div
          class="md:col-span-10 rounded-xl border border-line bg-surface min-h-[120px] p-4 flex items-center justify-center text-fg-muted text-[13px]"
        >
          ${msg("Auction overview — coming soon")}
        </div>
      </section>
    `;
  }

  private renderCenter(a: Auction) {
    switch (a.status) {
      case "INITIAL":
        return html`<auction-evaluations
          .auction=${a}
          @auction-started=${this.onAuctionStarted}
        ></auction-evaluations>`;
      case "IN_PROGRESS":
        return html`
          ${this.renderCentralRow(a)}
          <auction-running
            .auction=${a}
            .players=${this.players}
            .purchases=${this.purchases}
            @purchases-changed=${this.onPurchasesChanged}
          ></auction-running>
        `;
      case "TERMINATED":
        return html`<auction-finished .auction=${a}></auction-finished>`;
    }
  }

  override render() {
    const wide = this.auction?.status === "IN_PROGRESS";
    const mainCls = wide
      ? "px-6 pt-8 pb-20"
      : "max-w-screen-xl mx-auto px-6 pt-8 pb-20";
    return html`
      <main class=${mainCls}>
        ${this.loading
          ? html`<p class="text-fg-dim">${msg("Loading auction…")}</p>`
          : this.notFound
            ? html`
                <div
                  class="text-center py-16 px-6 rounded-xl border border-line bg-surface text-fg-dim"
                >
                  <h3 class="text-[18px] font-bold text-fg m-0 mb-1.5">
                    ${msg("Auction not found")}
                  </h3>
                  <p class="m-0 mb-3 text-[13px]">
                    ${msg(html`The auction
                    <code class="font-mono text-fg">#${this.auctionId}</code>
                    may have been deleted.`)}
                  </p>
                  <a
                    href="/"
                    class="text-accent hover:underline"
                    @click=${(e: MouseEvent) => this.goHome(e)}
                  >${msg("← Back to auctions")}</a>
                </div>
              `
            : this.loadError || !this.auction
              ? html`<p class="text-danger">
                  ${msg(
                    str`Failed to load: ${this.loadError || msg("unknown error")}`,
                  )}
                </p>`
              : html`
                  ${this.renderHeader(this.auction)}
                  ${this.renderCenter(this.auction)}
                `}

        <auction-dialog
          mode="edit"
          .auction=${this.auction}
          .open=${this.editDialogOpen}
          @dialog-closed=${this.onEditDialogClosed}
          @auction-saved=${this.onAuctionSaved}
        ></auction-dialog>

        <evaluations-view-dialog
          .auction=${this.auction}
          .open=${this.viewDialogOpen}
          @dialog-closed=${this.onViewDialogClosed}
        ></evaluations-view-dialog>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-page": AuctionPage;
  }
}
