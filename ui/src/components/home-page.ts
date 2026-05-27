import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";
import "./auction-dialog";

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
  INITIAL:
    "text-fg-dim border-line-strong bg-surface",
  IN_PROGRESS:
    "text-accent border-accent/30 bg-accent/10",
  TERMINATED:
    "text-fg-muted border-line bg-transparent",
};

const STATUS_DOT: Record<AuctionStatus, string> = {
  INITIAL: "bg-fg-dim",
  IN_PROGRESS:
    "bg-accent animate-dot-pulse [box-shadow:0_0_6px_var(--color-accent)]",
  TERMINATED: "bg-fg-muted",
};

function primaryLabel(s: AuctionStatus): string {
  switch (s) {
    case "INITIAL":
      return msg("Continue setup");
    case "IN_PROGRESS":
      return msg("Resume auction");
    case "TERMINATED":
      return msg("View results");
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

@customElement("home-page")
@localized()
export class HomePage extends LitElement {
  @state() private auctions: Auction[] = [];
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
    void this.loadAuctions();
  }

  private async loadAuctions(): Promise<void> {
    this.loading = true;
    this.loadError = "";
    try {
      const res = await fetch(`${BACKEND_URL}/auctions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.auctions = (await res.json()) as Auction[];
      await Promise.all(this.auctions.map((a) => this.ensureAuctionDetail(a.id)));
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async ensureAuctionDetail(id: number): Promise<void> {
    const idx = this.auctions.findIndex((a) => a.id === id);
    if (idx === -1) return;
    if (this.auctions[idx].teams) return;
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${id}`);
      if (!res.ok) return;
      const detail = (await res.json()) as Auction;
      // Re-check after the await: a concurrent loadAuctions/delete may
      // have replaced or removed the entry while we were fetching.
      // Skipping in those cases avoids clobbering fresher state.
      const cur = this.auctions.find((a) => a.id === id);
      if (!cur || cur.teams) return;
      this.auctions = this.auctions.map((a) => (a.id === id ? detail : a));
    } catch {
      // best-effort
    }
  }

  private navigateToAuction(id: number): void {
    window.dispatchEvent(
      new CustomEvent("app-navigate", { detail: { path: `/auction/${id}` } }),
    );
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

  private onAuctionSaved = (): void => {
    this.dialogOpen = false;
    void this.loadAuctions();
  };

  private async deleteAuction(a: Auction): Promise<void> {
    if (
      !confirm(
        msg(str`Delete auction "${a.name}"? Teams and evaluations will be lost.`),
      )
    )
      return;
    try {
      const res = await fetch(`${BACKEND_URL}/auctions/${a.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await this.loadAuctions();
    } catch (err) {
      alert(
        msg(
          str`Failed to delete: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
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

  private renderTeamChips(a: Auction) {
    const teams = a.teams ?? [];
    const visible = teams.slice(0, 5);
    const hidden = teams.length - visible.length;
    if (teams.length === 0) {
      return html`
        <div class="text-[12px] text-fg-muted italic">
          ${msg("No teams yet")}
        </div>
      `;
    }
    return html`
      <div class="flex flex-wrap gap-1 max-h-[50px] overflow-hidden">
        ${visible.map(
          (t) => html`
            <span
              class="text-[11px] px-1.5 py-[3px] rounded bg-app border border-line text-fg-dim"
            >${t.team_name}</span>
          `,
        )}
        ${hidden > 0
          ? html`<span
              class="text-[11px] px-1.5 py-[3px] rounded border border-dashed border-line text-fg-muted"
            >${msg(str`+${hidden} more`)}</span>`
          : nothing}
      </div>
    `;
  }

  private renderAuctionCard(a: Auction) {
    return html`
      <div
        class="group relative flex flex-col gap-4 p-5 rounded-xl border border-line bg-surface transition-colors hover:border-line-strong"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-[17px] font-bold tracking-tight m-0 truncate">${a.name}</h3>
            <div class="text-[12px] text-fg-muted mt-0.5 truncate">
              ${a.description ?? msg(str`created ${formatDate(a.created_at)}`)}
            </div>
          </div>
          ${this.renderStatusPill(a.status)}
        </div>

        <div
          class="grid grid-cols-4 gap-2.5 py-3 border-y border-line"
        >
          <div class="flex flex-col gap-0.5 min-w-0">
            <div class="text-[18px] font-bold tracking-tight tabular-nums">
              ${a.number_of_teams}
            </div>
            <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              ${msg("Teams")}
            </div>
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <div class="text-[18px] font-bold tracking-tight tabular-nums text-accent">
              ${a.credits_per_team}
            </div>
            <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              ${msg("Credits")}
            </div>
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <div class="text-[18px] font-bold tracking-tight tabular-nums">
              ${a.min_team_size}–${a.max_team_size}
            </div>
            <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              ${msg("Roster")}
            </div>
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <div class="text-[18px] font-bold tracking-tight tabular-nums">
              ${a.number_of_goalkeepers}
            </div>
            <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              ${msg("GK")}
            </div>
          </div>
        </div>

        ${this.renderTeamChips(a)}

        <div
          class="flex gap-1.5 mt-auto"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <button
            type="button"
            @click=${() => this.navigateToAuction(a.id)}
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22] hover:border-[#19ff22] transition-colors"
          >
            ${primaryLabel(a.status)}
            ${icon("arrow-right", { size: 14 })}
          </button>
          <div class="flex-1"></div>
          ${a.status === "INITIAL"
            ? html`<button
                type="button"
                aria-label=${msg("Edit")}
                title=${msg("Edit")}
                @click=${() => this.openEditDialog(a)}
                class="w-8 h-8 grid place-items-center rounded border border-transparent text-fg-dim hover:text-fg hover:bg-surface-hover hover:border-line-strong transition-colors"
              >${icon("pencil", { size: 14 })}</button>`
            : nothing}
          <button
            type="button"
            aria-label=${msg("Delete")}
            title=${msg("Delete")}
            @click=${() => this.deleteAuction(a)}
            class="w-8 h-8 grid place-items-center rounded text-danger hover:bg-danger/10 hover:border-danger/30 border border-transparent transition-colors"
          >${icon("trash", { size: 14 })}</button>
        </div>
      </div>
    `;
  }

  private renderNewTile() {
    return html`
      <button
        type="button"
        @click=${() => this.openCreateDialog()}
        class="flex flex-col items-center justify-center gap-2 min-h-[220px] rounded-xl border border-dashed border-line text-fg-dim bg-surface/40 hover:text-accent hover:border-accent/30 transition-colors"
      >
        ${icon("plus", { size: 28 })}
        <div class="font-semibold text-[14px]">${msg("New auction")}</div>
      </button>
    `;
  }

  override render() {
    return html`
      <main class="max-w-screen-xl mx-auto px-6 pt-8 pb-20">
        <div class="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 class="text-[28px] font-bold tracking-tight m-0">
              ${msg("Auctions")}
            </h1>
            <p class="text-fg-dim m-0 mt-1 text-[14px]">
              ${msg("Pick an auction to continue, or create a new one.")}
            </p>
          </div>
          <button
            type="button"
            @click=${() => this.openCreateDialog()}
            class="inline-flex items-center gap-2 px-[18px] py-3 rounded text-[14px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22] hover:border-[#19ff22] transition-colors"
          >
            ${icon("plus", { size: 16 })}
            ${msg("New auction")}
          </button>
        </div>

        ${this.loading
          ? html`<p class="text-fg-dim">${msg("Loading auctions…")}</p>`
          : this.loadError
            ? html`<p class="text-danger">
                ${msg(str`Failed to load: ${this.loadError}`)}
              </p>`
            : html`
                <div
                  class="grid gap-4"
                  style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));"
                >
                  ${this.auctions.map((a) => this.renderAuctionCard(a))}
                  ${this.renderNewTile()}
                </div>
              `}

        <auction-dialog
          .mode=${this.dialogMode}
          .auction=${this.dialogAuction}
          .open=${this.dialogOpen}
          @dialog-closed=${this.onDialogClosed}
          @auction-saved=${this.onAuctionSaved}
        ></auction-dialog>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "home-page": HomePage;
  }
}
