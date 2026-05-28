import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import {
  ROLE_COLORS,
  ROLE_ORDER,
  toAuctionCredits,
  type Auction,
  type PlayerRow,
  type Purchase,
  type RoleSaturationResponse,
  type RoleSaturationRow,
} from "../auction-shared";

const TOP_N = 5;

interface RoleBucket {
  role: string;
  players: PlayerRow[];
}

@customElement("auction-overview")
@localized()
export class AuctionOverview extends LitElement {
  @property({ attribute: false }) auction!: Auction;
  @property({ attribute: false }) players: PlayerRow[] = [];
  @property({ attribute: false }) purchases: Purchase[] = [];
  @property({ attribute: false }) roleSaturation: RoleSaturationResponse | null =
    null;

  // Derived once per (players|purchases) change so render doesn't
  // re-scan the full pool 12 times per paint.
  @state() private buckets: RoleBucket[] = [];
  @state() private saturationByRole: Map<string, RoleSaturationRow> = new Map();

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("players") || changed.has("purchases")) {
      this.buckets = this.computeBuckets();
    }
    if (changed.has("roleSaturation")) {
      const next = new Map<string, RoleSaturationRow>();
      for (const r of this.roleSaturation?.roles ?? []) next.set(r.role, r);
      this.saturationByRole = next;
    }
  }

  private computeBuckets(): RoleBucket[] {
    const sold = new Set(this.purchases.map((p) => p.player_id));
    return ROLE_ORDER.map((role) => {
      const candidates = this.players.filter(
        (p) =>
          !sold.has(p.id) &&
          p.mantra_roles.includes(role) &&
          (p.evaluation ?? 0) > 0,
      );
      candidates.sort((a, b) => {
        const ea = a.evaluation ?? 0;
        const eb = b.evaluation ?? 0;
        if (ea !== eb) return eb - ea;
        const va = a.fanta_market_value ?? 0;
        const vb = b.fanta_market_value ?? 0;
        return vb - va;
      });
      return { role, players: candidates.slice(0, TOP_N) };
    });
  }

  private selectPlayer(player: PlayerRow): void {
    this.dispatchEvent(
      new CustomEvent("player-selected", {
        detail: { player },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderCard(bucket: RoleBucket) {
    const color = ROLE_COLORS[bucket.role] ?? "#888";
    const credits = this.auction.credits_per_team;
    return html`
      <div class="rounded-xl border border-line bg-surface flex flex-col overflow-hidden">
        <div class="px-2.5 py-1.5 border-b border-line flex items-center gap-2">
          <span
            class="inline-block text-[10px] font-bold tracking-wide px-1.5 py-px rounded text-black min-w-[22px] text-center"
            style=${`background: ${color};`}
          >${bucket.role}</span>
          ${this.renderSaturation(bucket.role)}
        </div>
        ${bucket.players.length === 0
          ? html`<div class="px-2.5 py-3 text-[11px] text-fg-muted italic text-center">
              ${msg("— none —")}
            </div>`
          : html`<div class="flex flex-col">
              ${bucket.players.map((p) => this.renderRow(p, credits))}
            </div>`}
      </div>
    `;
  }

  private renderSaturation(role: string) {
    // No data yet: keep the original "top 5" label so the header
    // doesn't collapse / jump while the first fetch is in flight.
    if (!this.roleSaturation) {
      return html`<span
        class="text-[10px] text-fg-muted uppercase tracking-wider ml-auto"
      >${msg("top 5")}</span>`;
    }
    const row = this.saturationByRole.get(role);
    const evalTotal = row?.evaluated_total ?? 0;
    const soldTotal = row?.sold_total ?? 0;
    const playersTotal = row?.players_total ?? 0;
    const playersSold = row?.players_sold ?? 0;
    if (evalTotal <= 0) {
      return html`<span
        class="text-[10px] text-fg-muted tabular-nums ml-auto"
        title=${msg("no evaluated players for this role")}
      >—</span>`;
    }
    const pct = Math.min(100, Math.round((soldTotal / evalTotal) * 100));
    // Green at 0% → red at 100%: low saturation is good (lots of
    // budget left for this role); high saturation is bad (market is
    // drained). Hue 120→0 via 60 (yellow) is the natural traffic-light
    // ramp.
    const hue = 120 - (pct * 1.2);
    return html`
      <span
        class="text-[10px] text-fg-dim tabular-nums ml-auto"
        title=${msg(str`${playersSold} of ${playersTotal} players sold`)}
      >${playersSold}/${playersTotal}</span>
      <div
        class="flex-1 h-1.5 rounded-full bg-app border border-line overflow-hidden"
        title=${msg(str`${soldTotal} / ${evalTotal} evaluated credits sold`)}
      >
        <div
          class="h-full rounded-full transition-[width,background-color] duration-200"
          style=${`width: ${pct}%; background-color: hsl(${hue}, 80%, 50%);`}
        ></div>
      </div>
      <span class="text-[10px] text-fg-muted tabular-nums w-8 text-right">
        ${pct}%
      </span>
    `;
  }

  private renderRow(p: PlayerRow, credits: number) {
    const scaled = toAuctionCredits(p.evaluation, credits);
    return html`
      <button
        type="button"
        @click=${() => this.selectPlayer(p)}
        class="w-full text-left px-2.5 py-1.5 border-b border-line last:border-b-0 hover:bg-surface-hover transition-colors flex items-center gap-2"
      >
        <div class="min-w-0 flex-1">
          <div class="text-[12px] text-fg-dim truncate">${p.name}</div>
          <div class="text-[10px] text-fg-muted truncate">${p.team}</div>
        </div>
        <span class="text-[12px] text-fg-muted tabular-nums shrink-0">
          ${scaled ?? "—"}
        </span>
      </button>
    `;
  }

  override render() {
    if (!this.auction) return nothing;
    return html`
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
        ${this.buckets.map((b) => this.renderCard(b))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-overview": AuctionOverview;
  }
}
