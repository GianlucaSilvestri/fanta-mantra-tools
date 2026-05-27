import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";

const BACKEND_URL = "http://localhost:8000";

// Canonical role display order (Por first, then defenders, midfielders, attackers).
const ROLE_ORDER = [
  "Por", "Dd", "Dc", "Ds", "B", "E", "M", "C", "W", "T", "A", "Pc",
];

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

function roleSortKey(roles: string[]): number {
  let min = ROLE_ORDER.length;
  for (const r of roles) {
    const i = ROLE_ORDER.indexOf(r);
    if (i >= 0 && i < min) min = i;
  }
  return min;
}

interface Team {
  id: number;
  team_name: string;
}

interface Auction {
  id: number;
  name: string;
  status: "INITIAL" | "IN_PROGRESS" | "TERMINATED";
  type: "CALL" | "RANDOM";
  number_of_auctioners: number;
  min_team_size: number;
  max_team_size: number;
  credits_per_team: number;
  number_of_goalkeepers: number;
  number_of_teams: number;
  teams?: Team[];
}

interface PlayerRow {
  id: number;
  name: string;
  team: string;
  mantra_roles: string[];
  fanta_evaluation: number | null;
  fanta_market_value: number | null;
  evaluation: number | null;
}

interface Purchase {
  auction_id: number;
  player_id: number;
  team_id: number;
  price: number;
}

@customElement("auction-running")
@localized()
export class AuctionRunning extends LitElement {
  @property({ attribute: false }) auction!: Auction;
  @property({ attribute: false }) players: PlayerRow[] = [];
  @property({ attribute: false }) purchases: Purchase[] = [];

  @state() private editingPlayerId: number | null = null;
  @state() private editTeamId: number | "" = "";
  @state() private editPrice = "";
  @state() private editError = "";

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private notifyPurchasesChanged(): void {
    this.dispatchEvent(
      new CustomEvent("purchases-changed", { bubbles: true, composed: true }),
    );
  }

  private get playerById(): Map<number, PlayerRow> {
    return new Map(this.players.map((p) => [p.id, p]));
  }

  private spentByTeam(teamId: number): number {
    return this.purchases
      .filter((p) => p.team_id === teamId)
      .reduce((s, p) => s + p.price, 0);
  }

  private countByTeam(teamId: number): number {
    return this.purchases.filter((p) => p.team_id === teamId).length;
  }

  private gkByTeam(teamId: number): number {
    return this.purchases.filter((p) => {
      if (p.team_id !== teamId) return false;
      const pl = this.playerById.get(p.player_id);
      return !!pl && pl.mantra_roles.includes("Por");
    }).length;
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
    const teamId = typeof this.editTeamId === "number" ? this.editTeamId : 0;
    const price = Number.parseInt(this.editPrice, 10);
    if (!teamId) {
      this.editError = msg("Pick a team");
      return;
    }
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
    const pl = this.playerById.get(p.player_id);
    const playerName = pl?.name ?? `#${p.player_id}`;
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

  private renderTeamColumn(t: Team) {
    const teams = this.auction.teams ?? [];
    const spent = this.spentByTeam(t.id);
    const left = this.auction.credits_per_team - spent;
    const count = this.countByTeam(t.id);
    const gks = this.gkByTeam(t.id);
    const minOk = count >= this.auction.min_team_size;
    const gkOk = gks >= this.auction.number_of_goalkeepers;

    const teamPurchases = this.purchases
      .filter((p) => p.team_id === t.id)
      .map((p) => ({ purchase: p, player: this.playerById.get(p.player_id) }))
      .sort((a, b) => {
        const ar = a.player ? roleSortKey(a.player.mantra_roles) : ROLE_ORDER.length;
        const br = b.player ? roleSortKey(b.player.mantra_roles) : ROLE_ORDER.length;
        if (ar !== br) return ar - br;
        return (a.player?.name ?? "").localeCompare(b.player?.name ?? "");
      });

    return html`
      <div
        class="flex flex-col min-w-[240px] w-[240px] rounded-xl border border-line bg-surface shrink-0"
      >
        <div class="px-3 py-2.5 border-b border-line flex flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[13px] font-bold truncate">${t.team_name}</div>
            <div
              class=${"text-[12px] font-semibold tabular-nums " +
              (left <= 0 ? "text-danger" : "text-accent")}
            >${left}</div>
          </div>
          <div class="flex gap-2 text-[10px] uppercase tracking-wider">
            <span class=${minOk ? "text-accent" : "text-fg-muted"}>
              ${msg(str`P ${count}/${this.auction.min_team_size}`)}
            </span>
            <span class=${gkOk ? "text-accent" : "text-fg-muted"}>
              ${msg(str`GK ${gks}/${this.auction.number_of_goalkeepers}`)}
            </span>
            <span class="text-fg-muted ml-auto">
              ${msg(str`spent ${spent}`)}
            </span>
          </div>
        </div>
        <div class="flex flex-col">
          ${teamPurchases.length === 0
            ? html`<div class="px-3 py-3 text-[12px] text-fg-muted italic">
                ${msg("No players yet")}
              </div>`
            : teamPurchases.map(({ purchase, player }) =>
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
            ${player ? this.renderRoleChips(player.mantra_roles) : nothing}
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

  override render() {
    const teams = this.auction.teams ?? [];
    return html`
      <section>
        <h2 class="text-[16px] font-bold m-0 mb-3">${msg("Teams")}</h2>
        <div class="flex gap-3 overflow-x-auto pb-2">
          ${teams.map((t) => this.renderTeamColumn(t))}
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-running": AuctionRunning;
  }
}
