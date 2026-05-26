import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";
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
  teams?: Team[];
}

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
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private onAuctionStarted = (): void => {
    void this.load();
  };

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

  private renderHeader(a: Auction) {
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

      <section
        class="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center p-[22px] mb-6 rounded-xl border border-line bg-surface"
      >
        <div class="min-w-0">
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="text-[24px] font-bold tracking-tight m-0 truncate">
              ${a.name}
            </h1>
            ${this.renderStatusPill(a.status)}
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
        return html`<auction-running .auction=${a}></auction-running>`;
      case "TERMINATED":
        return html`<auction-finished .auction=${a}></auction-finished>`;
    }
  }

  override render() {
    return html`
      <main class="max-w-screen-xl mx-auto px-6 pt-8 pb-20">
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
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-page": AuctionPage;
  }
}
