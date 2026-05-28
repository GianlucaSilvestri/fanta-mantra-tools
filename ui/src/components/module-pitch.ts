import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import { ROLE_COLORS, type LineupModule, type LineupModuleSlot } from "../auction-shared";

// Map module name digits ("343", "4231", …) to per-row slot counts.
// Position 1 is always the goalkeeper; subsequent digits slice the
// remaining 10 outfield slots into rows from defence to attack.
function rowsFromName(name: string): number[] {
  const rows: number[] = [1];
  for (const ch of name) {
    const n = Number.parseInt(ch, 10);
    if (Number.isFinite(n) && n > 0) rows.push(n);
  }
  return rows;
}

function sliceSlotsByRows(
  slots: LineupModuleSlot[],
  rows: number[],
): LineupModuleSlot[][] {
  const ordered = [...slots].sort((a, b) => a.position - b.position);
  const out: LineupModuleSlot[][] = [];
  let i = 0;
  for (const n of rows) {
    out.push(ordered.slice(i, i + n));
    i += n;
  }
  return out;
}

// A slot's headline color is the highest-weight role it accepts —
// matches the auctioneer heuristic that a slot's "true demand" is for
// its strongest role.
const ROLE_TIER: Record<string, number> = {
  Por: 0,
  Dc: 1, Dd: 1, Ds: 1, B: 1,
  E: 2, M: 2, C: 2,
  W: 3, T: 3,
  A: 4, Pc: 4,
};

function dominantRole(allowed: string[]): string {
  let best = allowed[0];
  let bestTier = ROLE_TIER[best] ?? -1;
  for (const r of allowed.slice(1)) {
    const t = ROLE_TIER[r] ?? -1;
    if (t > bestTier) {
      best = r;
      bestTier = t;
    }
  }
  return best;
}

@customElement("module-pitch")
export class ModulePitch extends LitElement {
  @property({ attribute: false }) module!: LineupModule;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    const rows = sliceSlotsByRows(
      this.module.slots,
      rowsFromName(this.module.name),
    );
    // Visually: attackers on top, goalkeeper on bottom — reverse the
    // logical (goalie-first) row order for rendering.
    const visualRows = [...rows].reverse();

    return html`
      <div
        class="flex flex-col min-w-[160px] w-[160px] rounded-xl border border-line bg-surface shrink-0 overflow-hidden"
      >
        <div class="px-3 py-2 border-b border-line flex items-center justify-center">
          <span class="text-[13px] font-bold tabular-nums tracking-wider">
            ${this.module.name}
          </span>
        </div>
        <div
          class="relative flex-1 flex flex-col justify-between gap-1 px-2 py-2 min-h-[240px]"
          style="background:
            linear-gradient(180deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02));"
        >
          <div
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border border-line/40 pointer-events-none"
          ></div>
          <div
            class="absolute left-0 right-0 top-1/2 border-t border-line/40 pointer-events-none"
          ></div>
          ${visualRows.map(
            (rowSlots) => html`
              <div class="flex justify-evenly items-center gap-1 relative">
                ${rowSlots.map((slot) => this.renderSlot(slot))}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderSlot(slot: LineupModuleSlot) {
    const dom = dominantRole(slot.allowed_roles);
    const color = ROLE_COLORS[dom] ?? "#888";
    const label = slot.allowed_roles.join("/");
    return html`
      <div
        class="inline-flex items-center justify-center px-1 py-0.5 rounded text-[9px] font-bold text-black min-w-[26px] text-center leading-tight"
        style=${`background: ${color};`}
        title=${label}
      >${label}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "module-pitch": ModulePitch;
  }
}
