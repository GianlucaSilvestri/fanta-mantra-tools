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

export type AuctionStatus = "INITIAL" | "IN_PROGRESS" | "TERMINATED";
export type AuctionType = "CALL" | "RANDOM";

export interface Team {
  id: number;
  team_name: string;
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
}

export interface Purchase {
  auction_id: number;
  player_id: number;
  team_id: number;
  price: number;
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
