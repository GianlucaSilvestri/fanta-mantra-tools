import { html, type TemplateResult } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import {
  AlertCircle,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Eye,
  File,
  Pencil,
  Play,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X,
} from "lucide";

type IconChild = [string, Record<string, string | number | undefined>];
type IconData = IconChild[];

const ICONS = {
  settings: Settings as IconData,
  pencil: Pencil as IconData,
  trash: Trash2 as IconData,
  x: X as IconData,
  plus: Plus as IconData,
  play: Play as IconData,
  "arrow-up": ArrowUp as IconData,
  "arrow-up-right": ArrowUpRight as IconData,
  "arrow-right": ArrowRight as IconData,
  "arrow-down-right": ArrowDownRight as IconData,
  "arrow-down": ArrowDown as IconData,
  chevron: ChevronRight as IconData,
  upload: Upload as IconData,
  file: File as IconData,
  check: Check as IconData,
  alert: AlertCircle as IconData,
  search: Search as IconData,
  eye: Eye as IconData,
} as const;

export type IconName = keyof typeof ICONS;

function nodeToSvg(node: IconData): string {
  return node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
}

export function icon(
  name: IconName,
  { size = 16, class: cls = "" }: { size?: number; class?: string } = {},
): TemplateResult {
  return html`<svg
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    class=${cls}
    aria-hidden="true"
  >
    ${unsafeSVG(nodeToSvg(ICONS[name]))}
  </svg>`;
}
