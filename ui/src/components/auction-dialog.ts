import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";

const BACKEND_URL = "http://localhost:8000";

type DialogMode = "create" | "edit";
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
  teams?: Team[];
}

interface FormState {
  name: string;
  description: string;
  number_of_auctioners: number;
  credits_per_team: number;
  min_team_size: number;
  max_team_size: number;
  number_of_goalkeepers: number;
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

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  number_of_auctioners: 10,
  credits_per_team: 500,
  min_team_size: 27,
  max_team_size: 30,
  number_of_goalkeepers: 3,
};

const inputCls =
  "w-full bg-app border border-line text-fg rounded px-3 py-2 text-[13px] focus:outline-none focus:border-accent focus:bg-surface-2 transition-colors";

const labelCls =
  "text-[11px] font-semibold uppercase tracking-wider text-fg-muted";

@customElement("auction-dialog")
@localized()
export class AuctionDialog extends LitElement {
  @property({ type: String }) mode: DialogMode = "create";
  @property({ attribute: false }) auction: Auction | null = null;
  @property({ type: Boolean }) open = false;

  @state() private form: FormState = { ...DEFAULT_FORM };
  @state() private newTeams: string[] = [""];
  @state() private savedTeams: Team[] = [];
  @state() private newTeamDraft = "";
  @state() private busy = false;
  @state() private message = "";
  @state() private messageKind: "err" | "ok" | "busy" = "ok";

  @query("dialog") private dialogEl!: HTMLDialogElement;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("open")) {
      if (this.open) {
        this.resetFormFromProps();
        if (!this.dialogEl.open) this.dialogEl.showModal();
      } else {
        if (this.dialogEl.open) this.dialogEl.close();
      }
    } else if (changed.has("auction") && this.open) {
      this.savedTeams = this.auction?.teams ?? [];
    }
  }

  private resetFormFromProps(): void {
    this.message = "";
    this.busy = false;
    this.newTeamDraft = "";
    if (this.mode === "edit" && this.auction) {
      const a = this.auction;
      this.form = {
        name: a.name,
        description: a.description ?? "",
        number_of_auctioners: a.number_of_auctioners,
        credits_per_team: a.credits_per_team,
        min_team_size: a.min_team_size,
        max_team_size: a.max_team_size,
        number_of_goalkeepers: a.number_of_goalkeepers,
      };
      this.savedTeams = a.teams ?? [];
      this.newTeams = [];
    } else {
      this.form = { ...DEFAULT_FORM };
      this.savedTeams = [];
      this.newTeams = [""];
    }
  }

  private close(): void {
    this.dispatchEvent(
      new CustomEvent("dialog-closed", { bubbles: true, composed: true }),
    );
  }

  private setForm<K extends keyof FormState>(key: K, value: FormState[K]): void {
    this.form = { ...this.form, [key]: value };
  }

  private setNewTeam(idx: number, value: string): void {
    const next = this.newTeams.slice();
    next[idx] = value;
    this.newTeams = next;
  }

  private addNewTeamSlot(): void {
    if (!this.newTeamDraft.trim()) return;
    const next = [...this.newTeams.filter((t) => t.trim()), this.newTeamDraft.trim()];
    if (next.length > this.form.number_of_auctioners) return;
    this.newTeams = next;
    this.newTeamDraft = "";
  }

  private removeNewTeamSlot(idx: number): void {
    const next = this.newTeams.slice();
    next.splice(idx, 1);
    this.newTeams = next;
  }

  private async addSavedTeam(): Promise<void> {
    if (!this.auction) return;
    const name = this.newTeamDraft.trim();
    if (!name) return;
    if (this.savedTeams.length >= this.form.number_of_auctioners) {
      this.messageKind = "err";
      this.message = msg(
        str`Cannot add more than ${this.form.number_of_auctioners} teams (auctioners cap)`,
      );
      return;
    }
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/teams`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ team_name: name }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      const team = (await res.json()) as Team;
      this.savedTeams = [...this.savedTeams, team];
      this.newTeamDraft = "";
    } catch (err) {
      this.messageKind = "err";
      this.message = err instanceof Error ? err.message : String(err);
    }
  }

  private async removeSavedTeam(teamId: number): Promise<void> {
    if (!this.auction) return;
    try {
      const res = await fetch(
        `${BACKEND_URL}/auctions/${this.auction.id}/teams/${teamId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.savedTeams = this.savedTeams.filter((t) => t.id !== teamId);
    } catch (err) {
      this.messageKind = "err";
      this.message = err instanceof Error ? err.message : String(err);
    }
  }

  private async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.busy) return;
    if (this.form.max_team_size < this.form.min_team_size) {
      this.messageKind = "err";
      this.message = msg("MAX players / team must be >= MIN");
      return;
    }
    if (!this.form.name.trim()) {
      this.messageKind = "err";
      this.message = msg("Name is required");
      return;
    }

    this.busy = true;
    this.messageKind = "busy";
    this.message = msg("Saving…");

    try {
      if (this.mode === "create") {
        const teams = [...this.newTeams, this.newTeamDraft]
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        if (new Set(teams).size !== teams.length) {
          throw new Error(msg("Team names must be unique"));
        }
        if (teams.length > this.form.number_of_auctioners) {
          throw new Error(
            msg(
              str`Cannot have more than ${this.form.number_of_auctioners} teams (auctioners cap)`,
            ),
          );
        }
        const body = {
          name: this.form.name.trim(),
          description: this.form.description.trim() || null,
          number_of_auctioners: this.form.number_of_auctioners,
          min_team_size: this.form.min_team_size,
          max_team_size: this.form.max_team_size,
          credits_per_team: this.form.credits_per_team,
          number_of_goalkeepers: this.form.number_of_goalkeepers,
          teams,
        };
        const res = await fetch(`${BACKEND_URL}/auctions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(data.detail ?? `HTTP ${res.status}`);
        }
        const created = (await res.json()) as Auction;
        this.emitSaved(created);
      } else if (this.auction) {
        const body = {
          name: this.form.name.trim(),
          description: this.form.description.trim() || null,
          number_of_auctioners: this.form.number_of_auctioners,
          min_team_size: this.form.min_team_size,
          max_team_size: this.form.max_team_size,
          credits_per_team: this.form.credits_per_team,
          number_of_goalkeepers: this.form.number_of_goalkeepers,
        };
        const res = await fetch(
          `${BACKEND_URL}/auctions/${this.auction.id}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(data.detail ?? `HTTP ${res.status}`);
        }
        const updated = (await res.json()) as Auction;
        this.emitSaved(updated);
      }
    } catch (err) {
      this.messageKind = "err";
      this.message = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private emitSaved(auction: Auction): void {
    this.dispatchEvent(
      new CustomEvent("auction-saved", {
        detail: { auction },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderLockedWarning(status: AuctionStatus) {
    return html`
      <div
        class="flex items-center gap-2.5 p-3 mb-4 rounded text-[12px] text-warn border border-warn/25 bg-warn/[0.08]"
      >
        ${icon("alert", { size: 14 })}
        <span>
          ${msg(
            html`This auction is <b>${statusLabel(status)}</b>. Most fields
              are locked — only the name can be edited.`,
          )}
        </span>
      </div>
    `;
  }

  private renderCreateTeams() {
    const teams = this.newTeams;
    const cap = this.form.number_of_auctioners;
    const atCap = teams.length >= cap;
    return html`
      <div class="mb-3.5">
        <div class="flex items-baseline justify-between mb-1.5">
          <div class=${labelCls}>
            ${msg(str`Teams (${teams.length} / ${cap})`)}
          </div>
          ${atCap
            ? html`<div class="text-[11px] text-warn">
                ${msg("Auctioners cap reached")}
              </div>`
            : nothing}
        </div>
        <div
          class="flex flex-col gap-1.5 bg-app border border-line rounded p-2.5 max-h-[240px] overflow-y-auto"
        >
          ${this.newTeams.map(
            (t, i) => html`
              <div
                class="flex items-center gap-2 bg-surface rounded px-2 py-1.5"
              >
                <input
                  .value=${t}
                  @input=${(e: Event) =>
                    this.setNewTeam(i, (e.target as HTMLInputElement).value)}
                  placeholder=${msg("Team name")}
                  class="flex-1 bg-transparent border-0 text-fg text-[13px] focus:outline-none p-0"
                />
                <button
                  type="button"
                  aria-label=${msg("Remove team")}
                  @click=${() => this.removeNewTeamSlot(i)}
                  class="w-7 h-7 grid place-items-center rounded text-danger hover:bg-danger/10"
                >${icon("trash", { size: 14 })}</button>
              </div>
            `,
          )}
          <div class="flex gap-1.5 p-1">
            <input
              .value=${this.newTeamDraft}
              ?disabled=${atCap}
              @input=${(e: Event) =>
                (this.newTeamDraft = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  this.addNewTeamSlot();
                }
              }}
              placeholder=${atCap
                ? msg("Increase auctioners to add more")
                : msg("+ add team and press Enter")}
              class="flex-1 bg-transparent border-0 text-fg text-[13px] px-2 py-1.5 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              ?disabled=${atCap || !this.newTeamDraft.trim()}
              @click=${() => this.addNewTeamSlot()}
              class="px-2.5 py-1.5 rounded text-[12px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed"
            >${msg("Add")}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderEditTeams() {
    const cap = this.form.number_of_auctioners;
    const atCap = this.savedTeams.length >= cap;
    return html`
      <div class="mb-3.5">
        <div class="flex items-baseline justify-between mb-1.5">
          <div class=${labelCls}>
            ${msg(str`Teams (${this.savedTeams.length} / ${cap})`)}
          </div>
          ${atCap
            ? html`<div class="text-[11px] text-warn">
                ${msg("Auctioners cap reached")}
              </div>`
            : nothing}
        </div>
        <div
          class="flex flex-col gap-1.5 bg-app border border-line rounded p-2.5 max-h-[240px] overflow-y-auto"
        >
          ${this.savedTeams.length === 0
            ? html`<div class="text-[13px] text-fg-muted italic px-1 py-1">
                ${msg("No teams yet.")}
              </div>`
            : this.savedTeams.map(
                (t) => html`
                  <div
                    class="flex items-center gap-2 bg-surface rounded px-2 py-1.5"
                  >
                    <span class="flex-1 text-[13px]">${t.team_name}</span>
                    <button
                      type="button"
                      aria-label=${msg("Remove team")}
                      @click=${() => this.removeSavedTeam(t.id)}
                      class="w-7 h-7 grid place-items-center rounded text-danger hover:bg-danger/10"
                    >${icon("trash", { size: 14 })}</button>
                  </div>
                `,
              )}
          <div class="flex gap-1.5 p-1">
            <input
              .value=${this.newTeamDraft}
              ?disabled=${atCap}
              @input=${(e: Event) =>
                (this.newTeamDraft = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void this.addSavedTeam();
                }
              }}
              placeholder=${atCap
                ? msg("Increase auctioners to add more")
                : msg("+ add team and press Enter")}
              class="flex-1 bg-transparent border-0 text-fg text-[13px] px-2 py-1.5 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              ?disabled=${atCap || !this.newTeamDraft.trim()}
              @click=${() => this.addSavedTeam()}
              class="px-2.5 py-1.5 rounded text-[12px] font-semibold border border-line bg-surface text-fg hover:bg-surface-hover hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed"
            >${msg("Add")}</button>
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    const title = this.mode === "create" ? msg("Create auction") : msg("Edit auction");
    const locked = this.mode === "edit" && this.auction
      ? this.auction.status !== "INITIAL"
      : false;
    const messageCls =
      this.messageKind === "err"
        ? "text-danger"
        : this.messageKind === "ok"
          ? "text-accent"
          : "text-fg-dim italic";

    return html`
      <dialog
        @close=${() => this.close()}
        @cancel=${() => this.close()}
        class="fixed inset-0 m-auto bg-surface text-fg border border-line-strong rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.5)] p-0 w-[min(720px,calc(100vw-3rem))] max-h-[90vh] backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <form @submit=${this.submit} class="flex flex-col max-h-[90vh]">
          <div
            class="flex items-center justify-between px-[22px] py-[18px] border-b border-line"
          >
            <h3 class="text-[16px] font-bold m-0">${title}</h3>
            <button
              type="button"
              aria-label=${msg("Close")}
              @click=${() => this.close()}
              class="w-9 h-9 grid place-items-center rounded text-fg-dim hover:bg-surface-hover hover:text-fg"
            >${icon("x", { size: 18 })}</button>
          </div>

          <div class="px-[22px] py-[22px] overflow-y-auto">
            ${locked && this.auction
              ? this.renderLockedWarning(this.auction.status)
              : nothing}

            <div class="mb-3.5">
              <label class=${labelCls + " block mb-1.5"}>${msg("Name")}</label>
              <input
                type="text"
                required
                ?autofocus=${this.mode === "create"}
                .value=${this.form.name}
                @input=${(e: Event) =>
                  this.setForm("name", (e.target as HTMLInputElement).value)}
                placeholder=${msg("e.g. Lega Boys 2025/26")}
                class=${inputCls}
              />
            </div>

            <div class="mb-3.5">
              <label class=${labelCls + " block mb-1.5"}>${msg("Description")}</label>
              <input
                type="text"
                .value=${this.form.description}
                ?disabled=${locked}
                @input=${(e: Event) =>
                  this.setForm("description", (e.target as HTMLInputElement).value)}
                class=${inputCls + " disabled:opacity-40 disabled:cursor-not-allowed"}
              />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3.5">
              <div>
                <label class=${labelCls + " block mb-1.5"}>${msg("Credits per team")}</label>
                <input
                  type="number"
                  min="1"
                  required
                  .value=${String(this.form.credits_per_team)}
                  ?disabled=${locked}
                  @input=${(e: Event) => {
                    const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
                    if (Number.isFinite(n)) this.setForm("credits_per_team", n);
                  }}
                  class=${inputCls + " tabular-nums disabled:opacity-40 disabled:cursor-not-allowed"}
                />
              </div>
              <div>
                <label class=${labelCls + " block mb-1.5"}>${msg("Goalkeepers")}</label>
                <input
                  type="number"
                  min="0"
                  required
                  .value=${String(this.form.number_of_goalkeepers)}
                  ?disabled=${locked}
                  @input=${(e: Event) => {
                    const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
                    if (Number.isFinite(n)) this.setForm("number_of_goalkeepers", n);
                  }}
                  class=${inputCls + " tabular-nums disabled:opacity-40 disabled:cursor-not-allowed"}
                />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3.5">
              <div>
                <label class=${labelCls + " block mb-1.5"}>${msg("Min players / team")}</label>
                <input
                  type="number"
                  min="1"
                  required
                  .value=${String(this.form.min_team_size)}
                  ?disabled=${locked}
                  @input=${(e: Event) => {
                    const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
                    if (Number.isFinite(n)) this.setForm("min_team_size", n);
                  }}
                  class=${inputCls + " tabular-nums disabled:opacity-40 disabled:cursor-not-allowed"}
                />
              </div>
              <div>
                <label class=${labelCls + " block mb-1.5"}>${msg("Max players / team")}</label>
                <input
                  type="number"
                  min="1"
                  required
                  .value=${String(this.form.max_team_size)}
                  ?disabled=${locked}
                  @input=${(e: Event) => {
                    const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
                    if (Number.isFinite(n)) this.setForm("max_team_size", n);
                  }}
                  class=${inputCls + " tabular-nums disabled:opacity-40 disabled:cursor-not-allowed"}
                />
              </div>
            </div>

            <div class="mb-3.5">
              <label class=${labelCls + " block mb-1.5"}>${msg("Auctioners")}</label>
              <input
                type="number"
                min="1"
                required
                .value=${String(this.form.number_of_auctioners)}
                ?disabled=${locked}
                @input=${(e: Event) => {
                  const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
                  if (Number.isFinite(n)) this.setForm("number_of_auctioners", n);
                }}
                class=${inputCls + " tabular-nums disabled:opacity-40 disabled:cursor-not-allowed"}
              />
            </div>

            ${locked
              ? nothing
              : this.mode === "create"
                ? this.renderCreateTeams()
                : this.renderEditTeams()}
          </div>

          <div
            class="flex items-center gap-2 justify-end px-[22px] py-[14px] border-t border-line"
          >
            ${this.message
              ? html`<span class=${"mr-auto text-[12px] " + messageCls}>
                  ${this.message}
                </span>`
              : nothing}
            <button
              type="button"
              @click=${() => this.close()}
              class="px-3.5 py-2 rounded text-[13px] font-semibold border border-transparent bg-transparent text-fg hover:bg-surface-hover hover:border-line"
            >${msg("Cancel")}</button>
            <button
              type="submit"
              ?disabled=${this.busy}
              class="px-3.5 py-2 rounded text-[13px] font-semibold bg-accent text-black border border-accent hover:bg-[#19ff22] hover:border-[#19ff22] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ${this.mode === "create" ? msg("Create auction") : msg("Save changes")}
            </button>
          </div>
        </form>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-dialog": AuctionDialog;
  }
}
