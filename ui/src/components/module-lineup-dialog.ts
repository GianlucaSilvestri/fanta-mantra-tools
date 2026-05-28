import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";
import {
  BACKEND_URL,
  renderRoleChips,
  reorderWingsToSides,
  ROLE_COLORS,
  type LineupBenchPlayer,
  type LineupSlotAssignment,
  type ModuleLineupResponse,
} from "../auction-shared";

// Module names are digit strings (e.g. "343", "4231"); split each digit
// into a row count. Position 1 is always the goalkeeper.
function rowsFromName(name: string): number[] {
  const rows: number[] = [1];
  for (const ch of name) {
    const n = Number.parseInt(ch, 10);
    if (Number.isFinite(n) && n > 0) rows.push(n);
  }
  return rows;
}

function sliceSlotsByRows(
  slots: LineupSlotAssignment[],
  rows: number[],
): LineupSlotAssignment[][] {
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  const out: LineupSlotAssignment[][] = [];
  let i = 0;
  for (const n of rows) {
    out.push(ordered.slice(i, i + n));
    i += n;
  }
  return out;
}

@customElement("module-lineup-dialog")
@localized()
export class ModuleLineupDialog extends LitElement {
  @property({ type: Number }) auctionId: number | null = null;
  @property({ type: Number }) teamId: number | null = null;
  @property({ type: String }) moduleName: string | null = null;
  @property({ type: Boolean }) open = false;

  @state() private lineup: ModuleLineupResponse | null = null;
  @state() private loading = false;
  @state() private loadError = "";

  @query("dialog") private dialogEl!: HTMLDialogElement;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("open")) {
      if (this.open) {
        void this.load();
        if (!this.dialogEl.open) this.dialogEl.showModal();
      } else {
        if (this.dialogEl.open) this.dialogEl.close();
        this.lineup = null;
        this.loadError = "";
      }
    } else if (
      this.open &&
      (changed.has("auctionId") || changed.has("teamId") || changed.has("moduleName"))
    ) {
      void this.load();
    }
  }

  private async load(): Promise<void> {
    if (
      this.auctionId == null ||
      this.teamId == null ||
      !this.moduleName
    ) {
      return;
    }
    this.loading = true;
    this.loadError = "";
    this.lineup = null;
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auctionId}/teams/${this.teamId}/modules/${encodeURIComponent(this.moduleName)}/lineup`,
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.lineup = (await res.json()) as ModuleLineupResponse;
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

  private renderSlot(slot: LineupSlotAssignment) {
    const slotLabel = slot.allowed_roles.join("/");
    const player = slot.player;
    const role = player?.assigned_role ?? slot.allowed_roles[0];
    const color = ROLE_COLORS[role] ?? "#888";

    return html`
      <div class="flex flex-col items-center gap-1 min-w-[78px] max-w-[110px]">
        <div
          class="inline-flex items-center justify-center px-1.5 py-px rounded text-[10px] font-bold text-black min-w-[34px] text-center"
          style=${`background: ${color};`}
          title=${slotLabel}
        >${slotLabel}</div>
        ${player
          ? html`
              <div
                class="w-full rounded-md border border-line-strong bg-surface/90 px-1.5 py-1 text-center backdrop-blur-sm"
                title=${`${player.name} · ${player.team} · ${player.price} cr · contrib ${player.contribution}`}
              >
                <div class="text-[11px] font-semibold leading-tight truncate">
                  ${player.name}
                </div>
                <div
                  class="text-[10px] text-fg-dim leading-tight truncate"
                >${player.team}</div>
                <div class="text-[10px] text-accent tabular-nums leading-tight mt-0.5">
                  ${msg(str`${player.price} cr`)}
                </div>
              </div>
            `
          : html`
              <div
                class="w-full rounded-md border border-dashed border-line bg-transparent px-1.5 py-2 text-center text-[10px] text-fg-muted italic"
              >${msg("empty")}</div>
            `}
      </div>
    `;
  }

  private renderPitch(lineup: ModuleLineupResponse) {
    const rows = sliceSlotsByRows(lineup.slots, rowsFromName(lineup.module_name));
    // Render attackers on top, goalkeeper at the bottom. Within each
    // row, push wing slots to the outsides so two wings sit on opposite
    // touchlines rather than stacked together.
    const visualRows = [...rows].reverse().map(reorderWingsToSides);
    return html`
      <div
        class="relative flex flex-col justify-between gap-3 px-3 py-4 rounded-xl border border-line min-h-[460px]"
        style="background:
          linear-gradient(180deg, rgba(34,197,94,0.16), rgba(34,197,94,0.04));"
      >
        <div
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full border border-line/40 pointer-events-none"
        ></div>
        <div
          class="absolute left-0 right-0 top-1/2 border-t border-line/40 pointer-events-none"
        ></div>
        ${visualRows.map(
          (rowSlots) => html`
            <div class="flex justify-evenly items-start gap-2 relative">
              ${rowSlots.map((slot) => this.renderSlot(slot))}
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderBenchPlayer(p: LineupBenchPlayer) {
    return html`
      <div
        class="flex items-center gap-2 px-2.5 py-1.5 border-b border-line last:border-b-0"
      >
        <div class="min-w-0 flex-1">
          <div class="text-[12px] font-semibold truncate">${p.name}</div>
          <div class="text-[10px] text-fg-dim truncate">${p.team}</div>
        </div>
        <div class="shrink-0">${renderRoleChips(p.mantra_roles)}</div>
        <div class="text-[12px] tabular-nums text-accent w-10 text-right">
          ${p.price}
        </div>
      </div>
    `;
  }

  private renderBody() {
    if (this.loading) {
      return html`<p class="text-fg-dim px-1 py-2">${msg("Loading…")}</p>`;
    }
    if (this.loadError) {
      return html`<p class="text-danger px-1 py-2">
        ${msg(str`Failed to load: ${this.loadError}`)}
      </p>`;
    }
    if (!this.lineup) return nothing;
    const lineup = this.lineup;
    const placed = lineup.slots.filter((s) => s.player !== null).length;
    return html`
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="md:col-span-2">
          <div class="flex items-center gap-3 mb-2">
            <div class="text-[13px] text-fg-muted">
              ${msg(str`${placed}/11 slots filled`)}
            </div>
            <div class="text-[13px] text-fg-muted">·</div>
            <div class="text-[13px] text-fg-muted">
              ${msg(str`score ${lineup.score}`)}
            </div>
          </div>
          ${this.renderPitch(lineup)}
        </div>
        <aside class="md:col-span-1">
          <h4 class="text-[12px] font-semibold uppercase tracking-wider text-fg-muted mb-2">
            ${msg(str`Bench (${lineup.bench.length})`)}
          </h4>
          ${lineup.bench.length === 0
            ? html`
                <div
                  class="rounded-lg border border-dashed border-line p-4 text-center text-[12px] text-fg-muted italic"
                >${msg("Every purchase fits the lineup")}</div>
              `
            : html`
                <div class="rounded-lg border border-line bg-app overflow-hidden">
                  ${lineup.bench.map((p) => this.renderBenchPlayer(p))}
                </div>
              `}
        </aside>
      </div>
    `;
  }

  override render() {
    const title = this.lineup
      ? msg(str`${this.lineup.team_name} — ${this.lineup.module_name}`)
      : this.moduleName
        ? msg(str`Module ${this.moduleName}`)
        : msg("Module lineup");
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
    "module-lineup-dialog": ModuleLineupDialog;
  }
}
