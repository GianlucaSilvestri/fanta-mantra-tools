import { html } from "lit";

export const BACKEND_URL = "http://localhost:8000";
export const BASE_CREDITS = 1000;

export function toAuctionCredits(
  stored: number | null,
  credits: number,
): number | null {
  if (stored == null) return null;
  return Math.floor((stored * credits) / BASE_CREDITS);
}

// Videogame-style 5-arrow performance indicator. "up" = paying less
// than the user's evaluations (bargains), "down" = paying more
// (overspending). "none" = no evaluated purchases to compare against.
export type Performance =
  | "up"
  | "up-right"
  | "right"
  | "down-right"
  | "down"
  | "none";

export function performanceBucket(spent: number, expected: number): Performance {
  if (expected <= 0) return "none";
  const ratio = (expected - spent) / expected;
  if (ratio > 0.2) return "up";
  if (ratio > 0.05) return "up-right";
  if (ratio > -0.05) return "right";
  if (ratio > -0.2) return "down-right";
  return "down";
}

// Icon name + tailwind class per performance bucket. Same palette
// reused everywhere a performance arrow renders (team headers,
// role cards in the overview, …).
export const PERFORMANCE_ICON: Record<
  Performance,
  { name: "arrow-up" | "arrow-up-right" | "arrow-right" | "arrow-down-right" | "arrow-down"; cls: string }
> = {
  up: { name: "arrow-up", cls: "text-accent" },
  "up-right": { name: "arrow-up-right", cls: "text-[#7ad97f]" },
  right: { name: "arrow-right", cls: "text-fg-muted" },
  "down-right": { name: "arrow-down-right", cls: "text-warn" },
  down: { name: "arrow-down", cls: "text-danger" },
  none: { name: "arrow-right", cls: "text-fg-muted opacity-50" },
};

export type AuctionStatus = "INITIAL" | "IN_PROGRESS" | "TERMINATED";
export type AuctionType = "CALL" | "RANDOM";

export interface Team {
  id: number;
  team_name: string;
  is_my_team: boolean;
}

export interface Auction {
  id: number;
  name: string;
  description: string | null;
  status: AuctionStatus;
  type: AuctionType;
  number_of_auctioners: number;
  min_team_size: number;
  max_team_size: number;
  credits_per_team: number;
  number_of_goalkeepers: number;
  number_of_teams: number;
  created_at: string | null;
  teams?: Team[];
}

export interface PlayerRow {
  id: number;
  name: string;
  team: string;
  mantra_roles: string[];
  fanta_evaluation: number | null;
  fanta_market_value: number | null;
  evaluation: number | null;
  // Per-(auction, player) "removed from the active pool" flag. Only ever
  // true on the IN_PROGRESS snapshot; the live table / INITIAL view
  // always reports false.
  discarded: boolean;
}

export interface Purchase {
  auction_id: number;
  player_id: number;
  team_id: number;
  price: number;
}

export interface ModulePrediction {
  name: string;
  confidence: number;
}

export interface TeamModulePredictions {
  team_id: number;
  team_name: string;
  modules: ModulePrediction[];
}

export interface ModulePredictionsResponse {
  auction_id: number;
  teams: TeamModulePredictions[];
}

export interface LineupModuleSlot {
  position: number;
  allowed_roles: string[];
}

export interface LineupModule {
  id: number;
  name: string;
  slots: LineupModuleSlot[];
}

export interface LineupSlotPlayer {
  id: number;
  name: string;
  team: string;
  mantra_roles: string[];
  price: number;
  assigned_role: string | null;
  contribution: number;
}

export interface LineupSlotAssignment {
  position: number;
  allowed_roles: string[];
  player: LineupSlotPlayer | null;
}

export interface LineupBenchPlayer {
  id: number;
  name: string;
  team: string;
  mantra_roles: string[];
  price: number;
}

export interface ModuleLineupResponse {
  auction_id: number;
  team_id: number;
  team_name: string;
  module_name: string;
  score: number;
  slots: LineupSlotAssignment[];
  bench: LineupBenchPlayer[];
}

export interface BuyerInterestTeam {
  team_id: number;
  team_name: string;
  confidence: number;
  fit: number;
  afford: number;
  remaining_credit: number;
}

export interface BuyerInterestResponse {
  auction_id: number;
  player_id: number;
  mv_scaled: number;
  broadness: number;
  teams: BuyerInterestTeam[];
}

export interface RoleSaturationRow {
  role: string;
  players_total: number;
  players_sold: number;
  evaluated_total: number;
  sold_total: number;
}

export interface RoleSaturationResponse {
  auction_id: number;
  roles: RoleSaturationRow[];
}

// GK marker (matches backend GK_ROLE = "Por").
export const GK_ROLE = "Por";

// Canonical role display order (Por first, then defenders, midfielders, attackers).
export const ROLE_ORDER = [
  "Por", "Dd", "Dc", "Ds", "B", "E", "M", "C", "W", "T", "A", "Pc",
];

export const ROLE_COLORS: Record<string, string> = {
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

// Roles that visually belong on the touchlines rather than central.
const WING_ROLES = new Set(["W", "E"]);

export function reorderWingsToSides<T extends { allowed_roles: string[] }>(
  row: T[],
): T[] {
  // Push wing slots (W/E) to the outsides of their row so two wings
  // end up on opposite touchlines instead of stacked together — e.g.
  // 3511 mid [M, M, C, E/W, E/W] becomes [E/W, M, M, C, E/W].
  // A no-op for rows that already have ≤1 wing or are already
  // symmetric (e.g. 343 attack [W/A, A/Pc, W/A]).
  if (row.length <= 2) return row;
  const wings: T[] = [];
  const others: T[] = [];
  for (const slot of row) {
    if (slot.allowed_roles.some((r) => WING_ROLES.has(r))) wings.push(slot);
    else others.push(slot);
  }
  if (wings.length < 2) return row;
  return [
    wings[0],
    ...others,
    ...wings.slice(1, -1),
    wings[wings.length - 1],
  ];
}

export function roleSortKey(roles: string[]): number {
  let min = ROLE_ORDER.length;
  for (const r of roles) {
    const i = ROLE_ORDER.indexOf(r);
    if (i >= 0 && i < min) min = i;
  }
  return min;
}

export function renderRoleChips(roles: string[]) {
  return html`
    <span class="inline-flex items-center gap-1 align-middle">
      ${roles.map(
        (r) => html`
          <span
            class="inline-block text-[10px] font-bold tracking-wide px-1.5 py-px rounded text-black min-w-[22px] text-center"
            style=${`background: ${ROLE_COLORS[r] ?? "#888"};`}
          >${r}</span>
        `,
      )}
    </span>
  `;
}
