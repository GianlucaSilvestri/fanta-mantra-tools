import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";
import {
  PERFORMANCE_ICON,
  performanceBucket,
  ROLE_COLORS,
  ROLE_ORDER,
  toAuctionCredits,
  type Auction,
  type Performance,
  type PlayerRow,
  type Purchase,
  type RoleSaturationResponse,
  type RoleSaturationRow,
} from "../auction-shared";

const TOP_N = 5;

interface RoleBucket {
  role: string;
  players: PlayerRow[];
  // Per-role market performance: how teams are paying vs the user's
  // evaluations across every evaluated purchase in this role.
  evalSpent: number;
  evalExpected: number;
  performance: Performance;
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
    const credits = this.auction?.credits_per_team ?? 0;
    const playerById = new Map(this.players.map((p) => [p.id, p]));

    // Aggregate per-role evaluated spend in one pass over purchases —
    // a single purchase contributes to every role its player covers,
    // matching how the saturation bar treats multi-role players.
    const perfByRole = new Map<string, { spent: number; expected: number }>();
    for (const role of ROLE_ORDER) {
      perfByRole.set(role, { spent: 0, expected: 0 });
    }
    for (const purchase of this.purchases) {
      const player = playerById.get(purchase.player_id);
      if (!player) continue;
      const scaled = toAuctionCredits(player.evaluation ?? null, credits);
      if (scaled === null || scaled <= 0) continue;
      for (const role of player.mantra_roles) {
        const agg = perfByRole.get(role);
        if (!agg) continue;
        agg.spent += purchase.price;
        agg.expected += scaled;
      }
    }

    return ROLE_ORDER.map((role) => {
      const candidates = this.players.filter(
        (p) =>
          !sold.has(p.id) &&
          !p.discarded &&
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
      const perf = perfByRole.get(role) ?? { spent: 0, expected: 0 };
      return {
        role,
        players: candidates.slice(0, TOP_N),
        evalSpent: perf.spent,
        evalExpected: perf.expected,
        performance: performanceBucket(perf.spent, perf.expected),
      };
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
          <span class="ml-auto">${this.renderPerformanceArrow(bucket)}</span>
        </div>
        <div class="px-2.5 py-2 border-b border-line flex items-center justify-center">
          ${this.renderGauge(bucket.role)}
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

  private renderPerformanceArrow(bucket: RoleBucket) {
    const choice = PERFORMANCE_ICON[bucket.performance];
    const title = this.performanceTooltip(bucket);
    return html`<span class=${"shrink-0 " + choice.cls} title=${title}
      >${icon(choice.name, { size: 12 })}</span
    >`;
  }

  private performanceTooltip(bucket: RoleBucket): string {
    switch (bucket.performance) {
      case "up":
        return msg(
          "Players in this role are being sold well below your evaluations — great time to buy.",
        );
      case "up-right":
        return msg(
          "Players in this role are being sold slightly below your evaluations — modest bargains.",
        );
      case "right":
        return msg(
          "Players in this role are being sold roughly at your evaluations — fair market.",
        );
      case "down-right":
        return msg(
          "Players in this role are being sold slightly above your evaluations — modestly overpriced.",
        );
      case "down":
        return msg(
          "Players in this role are being sold well above your evaluations — expensive market.",
        );
      case "none":
        return msg(
          "No evaluated players in this role have been bought yet — no signal.",
        );
    }
  }

  private renderGauge(role: string) {
    const placeholder = html`<span class="text-fg-muted">—</span>`;
    // No data yet: keep a faint placeholder so the band doesn't
    // collapse / jump while the first fetch is in flight.
    if (!this.roleSaturation) {
      return this.renderGaugeShell(null, 0, placeholder, null, msg("top 5"));
    }
    const row = this.saturationByRole.get(role);
    const evalTotal = row?.evaluated_total ?? 0;
    const soldTotal = row?.sold_total ?? 0;
    const playersTotal = row?.players_total ?? 0;
    const playersSold = row?.players_sold ?? 0;
    if (evalTotal <= 0) {
      return this.renderGaugeShell(
        null,
        0,
        placeholder,
        null,
        msg("no evaluated players for this role"),
      );
    }
    const remaining = Math.max(0, evalTotal - soldTotal);
    const remainingPct = Math.min(100, Math.round((remaining / evalTotal) * 100));
    const playersLeft = Math.max(0, playersTotal - playersSold);
    // Stored evaluations are base-1000; scale to this auction's budget so
    // the credit figure matches the team columns' "credits left".
    const remainingCredits =
      toAuctionCredits(remaining, this.auction.credits_per_team) ?? 0;
    // Inverse of the old saturation ramp: full (lots of budget left for
    // this role) is green, nearly-drained is red. Hue 0→120 via 60
    // (yellow) is the natural traffic-light ramp.
    const hue = remainingPct * 1.2;
    const title = msg(
      str`${remainingCredits} credits and ${playersLeft} of ${playersTotal} players still available for this role (${remainingPct}% of your evaluated credits unspent). Full/green = market still wide open; empty/red = nearly drained.`,
    );
    // Percentage left overlays inside the bowl; the concrete credits +
    // players figures sit below the gauge.
    const label = html`<span
      class="font-semibold uppercase tracking-wider text-fg-dim text-[10px]"
      >${remainingPct}%</span
    >`;
    const caption = html`
      <span class="flex items-center gap-0.5 text-warn">
        ${icon("coins", { size: 12 })}
        <span class="text-fg-dim font-semibold">${remainingCredits}</span>
      </span>
      <span class="flex items-center gap-0.5 text-sky-400">
        ${icon("users", { size: 12 })}
        <span class="text-fg-dim font-semibold">${playersLeft}</span>
      </span>
    `;
    return this.renderGaugeShell(hue, remainingPct, label, caption, title);
  }

  // Shared semicircular speedometer. `hue` null → inert/greyed arc
  // (loading or no evaluated players); otherwise the fill arc is drawn
  // to `pct` (0..100) in hsl(hue,…). `label` ("left N%") overlays inside
  // the arc bowl; `caption` (credits + players left) sits under it.
  private renderGaugeShell(
    hue: number | null,
    pct: number,
    label: unknown,
    caption: unknown,
    title: string,
  ) {
    // Geometry: 120×60 viewBox, semicircle radius 50 with baseline at
    // y=50. pathLength=100 lets the fill use the remaining percentage
    // directly as a dash length.
    const arc = "M 10 50 A 50 50 0 0 1 110 50";
    const fillColor = hue === null ? "var(--color-line-strong, #555)" : `hsl(${hue}, 80%, 50%)`;
    return html`
      <div
        class="flex flex-col items-center select-none"
        title=${title}
      >
        <div class="relative">
          <svg
            width="76"
            height="38"
            viewBox="0 0 120 60"
            fill="none"
            class="overflow-visible"
            aria-hidden="true"
          >
            <path
              d=${arc}
              stroke="var(--color-line, #262626)"
              stroke-width="9"
              stroke-linecap="round"
              pathLength="100"
            />
            <path
              d=${arc}
              stroke=${fillColor}
              stroke-width="9"
              stroke-linecap="round"
              pathLength="100"
              stroke-dasharray=${`${pct} 100`}
              class="transition-[stroke-dasharray,stroke] duration-200"
            />
          </svg>
          <div
            class="absolute inset-x-0 bottom-1 flex items-center justify-center gap-2.5 text-[11px] tabular-nums"
          >
            ${label}
          </div>
        </div>
        ${caption
          ? html`<div
              class="-mt-0.5 flex items-center justify-center gap-2.5 text-[11px] tabular-nums"
            >${caption}</div>`
          : nothing}
      </div>
    `;
  }

  private renderRow(p: PlayerRow, credits: number) {
    const scaled = toAuctionCredits(p.evaluation, credits);
    return html`
      <div
        class="px-2.5 py-1.5 border-b border-line last:border-b-0 flex items-center gap-2"
      >
        <button
          type="button"
          @click=${() => this.selectPlayer(p)}
          title=${msg("Put this player up for auction")}
          aria-label=${msg("Put this player up for auction")}
          class="shrink-0 p-1 rounded text-fg-muted hover:text-accent hover:bg-surface-hover transition-colors"
        >
          ${icon("play", { size: 12 })}
        </button>
        <div class="min-w-0 flex-1">
          <div class="text-[12px] text-fg-dim truncate">${p.name}</div>
          <div class="text-[10px] text-fg-muted truncate">${p.team}</div>
        </div>
        <span class="text-[12px] text-fg-muted tabular-nums shrink-0">
          ${scaled ?? "—"}
        </span>
      </div>
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
