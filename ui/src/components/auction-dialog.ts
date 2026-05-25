import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

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

const PREF_FIELDS: { key: keyof Omit<FormState, "name" | "description">; label: string; min: number }[] = [
  { key: "number_of_auctioners", label: "Auctioners", min: 1 },
  { key: "credits_per_team", label: "Credits per team", min: 1 },
  { key: "min_team_size", label: "MIN players / team", min: 1 },
  { key: "max_team_size", label: "MAX players / team", min: 1 },
  { key: "number_of_goalkeepers", label: "Goalkeepers / team", min: 0 },
];

const DEFAULT_FORM: FormState = {
  name: "",
  description: "",
  number_of_auctioners: 10,
  credits_per_team: 500,
  min_team_size: 27,
  max_team_size: 30,
  number_of_goalkeepers: 3,
};

@customElement("auction-dialog")
export class AuctionDialog extends LitElement {
  @property({ type: String }) mode: DialogMode = "create";
  @property({ attribute: false }) auction: Auction | null = null;
  @property({ type: Boolean }) open = false;

  @state() private form: FormState = { ...DEFAULT_FORM };
  /** Create mode only: pending team names entered in the form. */
  @state() private newTeams: string[] = [""];
  /** Edit mode only: the saved team list as currently in the DB. */
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
      // Auction prop refreshed (e.g. after a team add/remove); resync teams.
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
    this.newTeams = [...this.newTeams, ""];
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
      this.message = "MAX players / team must be >= MIN";
      return;
    }
    if (!this.form.name.trim()) {
      this.messageKind = "err";
      this.message = "Name is required";
      return;
    }

    this.busy = true;
    this.messageKind = "busy";
    this.message = "Saving…";

    try {
      if (this.mode === "create") {
        const teams = this.newTeams.map((t) => t.trim()).filter((t) => t.length > 0);
        if (new Set(teams).size !== teams.length) {
          throw new Error("Team names must be unique");
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

  private renderCreateTeams() {
    return html`
      <div class="flex flex-col gap-2">
        <strong class="text-sm">Teams (optional — can add later)</strong>
        <div class="flex flex-col gap-2 max-w-md">
          ${this.newTeams.map(
            (t, i) => html`
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="team name"
                  .value=${t}
                  @input=${(e: Event) =>
                    this.setNewTeam(i, (e.target as HTMLInputElement).value)}
                  class="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  @click=${() => this.removeNewTeamSlot(i)}
                  class="text-sm text-rose-700 hover:underline"
                >remove</button>
              </div>
            `,
          )}
          <div>
            <button
              type="button"
              @click=${() => this.addNewTeamSlot()}
              class="text-sm text-sky-700 hover:underline"
            >+ Add team</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderEditTeams() {
    return html`
      <div class="flex flex-col gap-2">
        <strong class="text-sm">Teams</strong>
        <div class="flex flex-col gap-1 max-w-md">
          ${this.savedTeams.length === 0
            ? html`<div class="text-sm text-slate-500">No teams yet.</div>`
            : this.savedTeams.map(
                (t) => html`
                  <div class="flex items-center gap-2 text-sm">
                    <span class="flex-1">${t.team_name}</span>
                    <button
                      type="button"
                      @click=${() => this.removeSavedTeam(t.id)}
                      class="text-rose-700 hover:underline"
                    >remove</button>
                  </div>
                `,
              )}
          <div class="flex items-center gap-2 mt-2">
            <input
              type="text"
              placeholder="new team name"
              .value=${this.newTeamDraft}
              @input=${(e: Event) =>
                (this.newTeamDraft = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void this.addSavedTeam();
                }
              }}
              class="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="button"
              @click=${() => this.addSavedTeam()}
              class="text-sm text-sky-700 hover:underline"
            >add</button>
          </div>
        </div>
      </div>
    `;
  }

  override render() {
    const title = this.mode === "create" ? "Create auction" : "Edit auction";
    const messageCls =
      this.messageKind === "err"
        ? "text-rose-700"
        : this.messageKind === "ok"
          ? "text-emerald-700"
          : "text-slate-600 italic";

    return html`
      <dialog
        @close=${() => this.close()}
        @cancel=${() => this.close()}
        class="rounded-lg shadow-xl p-0 backdrop:bg-slate-900/40 max-w-3xl w-full"
      >
        <form
          @submit=${this.submit}
          class="flex flex-col gap-4 p-5"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">${title}</h3>
            <button
              type="button"
              @click=${() => this.close()}
              aria-label="Close"
              class="text-slate-500 hover:text-slate-800 text-xl leading-none"
            >×</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="flex flex-col gap-1 text-sm">
              Name
              <input
                type="text"
                required
                .value=${this.form.name}
                @input=${(e: Event) =>
                  this.setForm("name", (e.target as HTMLInputElement).value)}
                class="rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
            <label class="flex flex-col gap-1 text-sm">
              Description
              <input
                type="text"
                .value=${this.form.description}
                @input=${(e: Event) =>
                  this.setForm("description", (e.target as HTMLInputElement).value)}
                class="rounded border border-slate-300 px-2 py-1.5"
              />
            </label>
            ${PREF_FIELDS.map(
              (f) => html`
                <label class="flex flex-col gap-1 text-sm">
                  ${f.label}
                  <input
                    type="number"
                    min=${String(f.min)}
                    step="1"
                    required
                    .value=${String(this.form[f.key])}
                    @input=${(e: Event) => {
                      const n = Number.parseInt(
                        (e.target as HTMLInputElement).value,
                        10,
                      );
                      if (Number.isFinite(n)) this.setForm(f.key, n);
                    }}
                    class="rounded border border-slate-300 px-2 py-1.5"
                  />
                </label>
              `,
            )}
          </div>

          ${this.mode === "create" ? this.renderCreateTeams() : this.renderEditTeams()}

          <div class="flex items-center gap-3 mt-2">
            <button
              type="submit"
              ?disabled=${this.busy}
              class="rounded bg-sky-700 px-4 py-1.5 text-white text-sm hover:bg-sky-800 disabled:opacity-50"
            >
              ${this.mode === "create" ? "Create" : "Save"}
            </button>
            <button
              type="button"
              @click=${() => this.close()}
              class="rounded border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50"
            >Cancel</button>
            ${this.message
              ? html`<span class="text-sm ${messageCls}">${this.message}</span>`
              : nothing}
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
