import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import "./auction-dialog";
import "./auction-evaluations";
import "./auction-running";
import "./auction-finished";

const BACKEND_URL = "http://localhost:8000";

type AuctionStatus = "INITIAL" | "IN_PROGRESS" | "TERMINATED";

interface Team {
  id: number;
  team_name: string;
}

interface Auction {
  id: number;
  name: string;
  description: string | null;
  status: AuctionStatus;
  number_of_auctioners: number;
  min_team_size: number;
  max_team_size: number;
  credits_per_team: number;
  number_of_goalkeepers: number;
  number_of_teams: number;
  created_at: string | null;
  updated_at: string | null;
  teams?: Team[];
}

type DialogMode = "create" | "edit";

const STATUS_BADGE: Record<AuctionStatus, string> = {
  INITIAL: "bg-amber-100 text-amber-800 border-amber-200",
  IN_PROGRESS: "bg-sky-100 text-sky-800 border-sky-200",
  TERMINATED: "bg-slate-200 text-slate-700 border-slate-300",
};

@customElement("home-page")
export class HomePage extends LitElement {
  @state() private auctions: Auction[] = [];
  @state() private selectedAuctionId: number | null = null;
  @state() private loading = true;
  @state() private loadError = "";

  @state() private dialogOpen = false;
  @state() private dialogMode: DialogMode = "create";
  @state() private dialogAuction: Auction | null = null;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.selectedAuctionId = this.readSelectionFromUrl();
    window.addEventListener("popstate", this.onPopState);
    void this.loadAuctions();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    super.disconnectedCallback();
  }

  private onPopState = (): void => {
    this.selectedAuctionId = this.readSelectionFromUrl();
    if (this.selectedAuctionId != null) {
      void this.ensureAuctionDetail(this.selectedAuctionId);
    }
  };

  private readSelectionFromUrl(): number | null {
    const raw = new URLSearchParams(window.location.search).get("auction_id");
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private writeSelectionToUrl(id: number | null): void {
    const url = id == null ? "/" : `/?auction_id=${id}`;
    if (url !== window.location.pathname + window.location.search) {
      history.pushState(null, "", url);
    }
  }

  private async loadAuctions(): Promise<void> {
    this.loading = true;
    this.loadError = "";
    try {
      const res = await fetch(`${BACKEND_URL}/auctions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.auctions = (await res.json()) as Auction[];
      // If the URL points at an auction that no longer exists, clear selection.
      if (
        this.selectedAuctionId != null &&
        !this.auctions.some((a) => a.id === this.selectedAuctionId)
      ) {
        this.selectedAuctionId = null;
        this.writeSelectionToUrl(null);
      }
      if (this.selectedAuctionId != null) {
        await this.ensureAuctionDetail(this.selectedAuctionId);
      }
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async ensureAuctionDetail(id: number): Promise<void> {
    const idx = this.auctions.findIndex((a) => a.id === id);
    if (idx === -1) return;
    if (this.auctions[idx].teams) return; // already detailed
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${id}`);
      if (!res.ok) return;
      const detail = (await res.json()) as Auction;
      this.auctions = this.auctions.map((a) => (a.id === id ? detail : a));
    } catch {
      // Best-effort enrichment; cards still render without teams.
    }
  }

  private selectAuction(id: number): void {
    if (this.selectedAuctionId === id) return;
    this.selectedAuctionId = id;
    this.writeSelectionToUrl(id);
    void this.ensureAuctionDetail(id);
  }

  private clearSelection(): void {
    if (this.selectedAuctionId == null) return;
    this.selectedAuctionId = null;
    this.writeSelectionToUrl(null);
  }

  private openCreateDialog(): void {
    this.dialogMode = "create";
    this.dialogAuction = null;
    this.dialogOpen = true;
  }

  private openEditDialog(a: Auction): void {
    this.dialogMode = "edit";
    this.dialogAuction = a;
    this.dialogOpen = true;
    void this.ensureAuctionDetail(a.id);
  }

  private onDialogClosed = (): void => {
    this.dialogOpen = false;
  };

  private onAuctionSaved = (event: Event): void => {
    const detail = (event as CustomEvent<{ auction: Auction }>).detail;
    this.dialogOpen = false;
    void this.loadAuctions().then(() => {
      // Auto-select newly created auction so user sees the panel.
      if (this.dialogMode === "create" && detail?.auction) {
        this.selectAuction(detail.auction.id);
      }
    });
  };

  private onAuctionStarted = (): void => {
    void this.loadAuctions();
  };

  private async deleteAuction(a: Auction): Promise<void> {
    if (!confirm(`Delete auction "${a.name}"? Teams and evaluations will be lost.`))
      return;
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${a.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (this.selectedAuctionId === a.id) {
        this.clearSelection();
      }
      await this.loadAuctions();
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private get selectedAuction(): Auction | null {
    if (this.selectedAuctionId == null) return null;
    return this.auctions.find((a) => a.id === this.selectedAuctionId) ?? null;
  }

  private renderAuctionCard(a: Auction) {
    const isSelected = a.id === this.selectedAuctionId;
    const canEdit = a.status === "INITIAL";
    const cardCls =
      "rounded-lg border bg-white p-3 shadow-sm cursor-pointer transition " +
      (isSelected
        ? "border-sky-500 ring-2 ring-sky-500/30"
        : "border-slate-200 hover:border-slate-300");
    return html`
      <div class=${cardCls} @click=${() => this.selectAuction(a.id)}>
        <div class="flex items-start gap-2 justify-between">
          <h4 class="font-semibold text-sm leading-tight">${a.name}</h4>
          <span
            class=${"text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border " +
            STATUS_BADGE[a.status]}
          >${a.status}</span>
        </div>
        <div class="text-xs text-slate-600 mt-1 min-h-[1rem]">
          ${a.description ?? ""}
        </div>
        <div class="text-xs text-slate-700 mt-2 flex flex-wrap gap-x-3 gap-y-1">
          <span><strong>${a.number_of_teams}</strong> teams</span>
          <span>${a.number_of_auctioners} auct.</span>
          <span>${a.credits_per_team} cr.</span>
          <span>${a.min_team_size}–${a.max_team_size} pl.</span>
          <span>${a.number_of_goalkeepers} GK</span>
        </div>
        <div class="flex gap-3 mt-2 text-xs" @click=${(e: Event) => e.stopPropagation()}>
          ${canEdit
            ? html`<button
                @click=${() => this.openEditDialog(a)}
                class="text-sky-700 hover:underline"
              >Edit</button>`
            : nothing}
          <button
            @click=${() => this.deleteAuction(a)}
            class="text-rose-700 hover:underline ml-auto"
          >Delete</button>
        </div>
      </div>
    `;
  }

  private renderNewTile() {
    return html`
      <button
        @click=${() => this.openCreateDialog()}
        class="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-slate-600 hover:bg-slate-100 hover:border-slate-400 flex flex-col items-center justify-center min-h-[7rem]"
      >
        <div class="text-2xl leading-none">+</div>
        <div class="text-xs mt-1">New auction</div>
      </button>
    `;
  }

  private renderCenterPanel() {
    const a = this.selectedAuction;
    if (a == null) {
      if (this.auctions.length === 0) return nothing;
      return html`
        <div class="border border-dashed border-slate-300 rounded-md p-6 text-center text-sm text-slate-500">
          Select an auction above to see its details.
        </div>
      `;
    }
    switch (a.status) {
      case "INITIAL":
        return html`<auction-evaluations
          .auction=${a}
          @auction-started=${this.onAuctionStarted}
        ></auction-evaluations>`;
      case "IN_PROGRESS":
        return html`<auction-running .auction=${a}></auction-running>`;
      case "TERMINATED":
        return html`<auction-finished .auction=${a}></auction-finished>`;
    }
  }

  override render() {
    return html`
      <h2 class="text-xl font-semibold mb-3">Home</h2>

      <section class="mb-6">
        <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-2">
          Auctions
        </h3>
        ${this.loading
          ? html`<p class="text-slate-600">Loading auctions…</p>`
          : this.loadError
            ? html`<p class="text-rose-700">Failed to load: ${this.loadError}</p>`
            : html`
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  ${this.auctions.map((a) => this.renderAuctionCard(a))}
                  ${this.renderNewTile()}
                </div>
              `}
      </section>

      <section>
        ${this.renderCenterPanel()}
      </section>

      <auction-dialog
        .mode=${this.dialogMode}
        .auction=${this.dialogAuction}
        .open=${this.dialogOpen}
        @dialog-closed=${this.onDialogClosed}
        @auction-saved=${this.onAuctionSaved}
      ></auction-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "home-page": HomePage;
  }
}
