import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";

const BACKEND_URL = "http://localhost:8000";
const BASE_CREDITS = 1000;

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
  credits_per_team: number;
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

@customElement("evaluations-view-dialog")
@localized()
export class EvaluationsViewDialog extends LitElement {
  @property({ attribute: false }) auction: Auction | null = null;
  @property({ type: Boolean }) open = false;

  @state() private players: PlayerRow[] = [];
  @state() private loading = false;
  @state() private loadError = "";
  @state() private teamFilter = "";
  @state() private roleFilter = "";
  @state() private nameFilter = "";

  @query("dialog") private dialogEl!: HTMLDialogElement;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("open")) {
      if (this.open) {
        this.resetFilters();
        if (this.auction) void this.load();
        if (!this.dialogEl.open) this.dialogEl.showModal();
      } else {
        if (this.dialogEl.open) this.dialogEl.close();
      }
    }
  }

  private resetFilters(): void {
    this.teamFilter = "";
    this.roleFilter = "";
    this.nameFilter = "";
  }

  private async load(): Promise<void> {
    if (!this.auction) return;
    this.loading = true;
    this.loadError = "";
    try {
      const res = await fetch(
        `${BACKEND_URL}/players?auction_id=${this.auction.id}`,
      );
      if (!res.ok) throw new Error(`/players HTTP ${res.status}`);
      this.players = (await res.json()) as PlayerRow[];
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private close(): void {
    this.dispatchEvent(
      new CustomEvent("dialog-closed", { bubbles: true, composed: true }),
    );
  }

  private get teams(): string[] {
    return Array.from(new Set(this.players.map((p) => p.team))).sort();
  }

  private get roles(): string[] {
    return Array.from(
      new Set(this.players.flatMap((p) => p.mantra_roles)),
    ).sort();
  }

  private get filtered(): PlayerRow[] {
    const name = this.nameFilter.trim().toLowerCase();
    const team = this.teamFilter;
    const role = this.roleFilter;
    const filtered = this.players.filter(
      (p) =>
        (!team || p.team === team) &&
        (!role || p.mantra_roles.includes(role)) &&
        (!name || p.name.toLowerCase().includes(name)),
    );
    return [...filtered].sort((a, b) => {
      const av = a.evaluation;
      const bv = b.evaluation;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
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

  private renderRow(p: PlayerRow, credits: number) {
    const scaledEval = toAuction(p.evaluation, credits);
    const hasEval = scaledEval !== null;
    return html`
      <tr class="hover:bg-surface-hover">
        <td class="px-3 py-[7px] text-[13px] font-semibold border-b border-line">
          ${p.name}
        </td>
        <td class="px-3 py-[7px] text-[13px] text-fg-dim border-b border-line">
          ${p.team}
        </td>
        <td class="px-3 py-[7px] text-[13px] whitespace-nowrap w-px border-b border-line">
          ${this.renderRoleChips(p.mantra_roles)}
        </td>
        <td class="px-3 py-[7px] text-[13px] text-right w-[100px] border-b border-line">
          <input
            type="number"
            disabled
            .value=${scaledEval === null ? "" : String(scaledEval)}
            placeholder="—"
            class=${"w-16 px-2 py-[5px] rounded text-right text-[13px] bg-surface-2 border border-line tabular-nums cursor-not-allowed opacity-80 " +
            (hasEval ? "text-accent" : "text-fg-muted")}
          />
        </td>
      </tr>
    `;
  }

  private renderBody() {
    if (!this.auction) return nothing;
    if (this.loading) {
      return html`<p class="text-fg-dim px-1 py-2">${msg("Loading…")}</p>`;
    }
    if (this.loadError) {
      return html`<p class="text-danger px-1 py-2">
        ${msg(str`Failed to load: ${this.loadError}`)}
      </p>`;
    }
    const rows = this.filtered;
    const credits = this.auction.credits_per_team;
    return html`
      <div class="flex flex-wrap gap-2.5 items-center mb-3">
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
          ${this.roles.map((r) => html`<option value=${r}>${r}</option>`)}
        </select>
        <select
          .value=${this.teamFilter}
          @change=${(e: Event) =>
            (this.teamFilter = (e.target as HTMLSelectElement).value)}
          class="bg-app border border-line text-fg rounded px-3 py-2 text-[13px] max-w-[200px] focus:outline-none focus:border-accent"
        >
          <option value="">${msg("All Serie A teams")}</option>
          ${this.teams.map((t) => html`<option value=${t}>${t}</option>`)}
        </select>
      </div>

      <div class="rounded-lg border border-line bg-app overflow-hidden">
        <div class="max-h-[60vh] overflow-auto">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th class="sticky top-0 z-10 bg-surface-2 px-3 py-[7px] text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-fg-muted border-b border-line">
                  ${msg("Name")}
                </th>
                <th class="sticky top-0 z-10 bg-surface-2 px-3 py-[7px] text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-fg-muted border-b border-line">
                  ${msg("Team")}
                </th>
                <th class="sticky top-0 z-10 bg-surface-2 px-3 py-[7px] text-left text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-fg-muted border-b border-line">
                  ${msg("Roles")}
                </th>
                <th class="sticky top-0 z-10 bg-surface-2 px-3 py-[7px] text-right text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap text-fg-muted border-b border-line">
                  ${msg("Evaluation")}
                </th>
              </tr>
            </thead>
            <tbody>
              ${rows.length === 0
                ? html`<tr>
                    <td
                      colspan="4"
                      class="text-center py-8 text-fg-muted text-[13px]"
                    >${msg("No players match these filters")}</td>
                  </tr>`
                : rows.map((p) => this.renderRow(p, credits))}
            </tbody>
          </table>
        </div>
      </div>

      <div class="text-[12px] text-fg-dim mt-2">
        ${msg(str`${rows.length} of ${this.players.length} players`)}
      </div>
    `;
  }

  override render() {
    const title = this.auction
      ? msg(str`Review evaluations — ${this.auction.name}`)
      : msg("Review evaluations");
    return html`
      <dialog
        @close=${() => this.close()}
        @cancel=${() => this.close()}
        class="fixed inset-0 m-auto bg-surface text-fg border border-line-strong rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.5)] p-0 w-[min(960px,calc(100vw-3rem))] max-h-[90vh] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <div class="flex flex-col max-h-[90vh]">
          <div
            class="flex items-center justify-between px-[22px] py-[18px] border-b border-line"
          >
            <h3 class="text-[16px] font-bold m-0 truncate">${title}</h3>
            <button
              type="button"
              aria-label=${msg("Close")}
              @click=${() => this.close()}
              class="w-9 h-9 grid place-items-center rounded text-fg-dim hover:bg-surface-hover hover:text-fg"
            >${icon("x", { size: 18 })}</button>
          </div>

          <div class="px-[22px] py-[22px] overflow-y-auto">
            ${this.renderBody()}
          </div>

          <div
            class="flex items-center justify-end px-[22px] py-[14px] border-t border-line"
          >
            <button
              type="button"
              @click=${() => this.close()}
              class="px-3.5 py-2 rounded text-[13px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover hover:border-line-strong"
            >${msg("Close")}</button>
          </div>
        </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "evaluations-view-dialog": EvaluationsViewDialog;
  }
}
