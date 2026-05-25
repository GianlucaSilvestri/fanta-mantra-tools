import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

const BACKEND_URL = "http://localhost:8000";

type UploadStatus = "idle" | "uploading" | "success" | "error";
type PrefsStatus = "loading" | "ready" | "saving" | "saved" | "error";

interface Preferences {
  number_of_auctioners: number;
  min_team_size: number;
  max_team_size: number;
  credits_per_team: number;
  number_of_goalkeepers: number;
}

type PrefKey = keyof Preferences;

const PREF_FIELDS: { key: PrefKey; label: string; min: number }[] = [
  { key: "number_of_auctioners", label: "Auctioners", min: 1 },
  { key: "credits_per_team", label: "Credits per team", min: 1 },
  { key: "min_team_size", label: "MIN players / team", min: 1 },
  { key: "max_team_size", label: "MAX players / team", min: 1 },
  { key: "number_of_goalkeepers", label: "Goalkeepers / team", min: 0 },
];

@customElement("settings-page")
export class SettingsPage extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    section {
      margin-bottom: 2rem;
    }
    h3 {
      margin: 0 0 0.5rem;
      font-size: 1.05rem;
    }
    form.upload {
      display: flex;
      gap: 0.75rem;
      align-items: center;
      margin: 1rem 0;
    }
    .prefs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.6rem 1rem;
      margin: 0.75rem 0;
    }
    .prefs-grid label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.9rem;
    }
    .prefs-grid input {
      padding: 0.3rem 0.4rem;
      font: inherit;
      width: 100%;
      box-sizing: border-box;
    }
    .status {
      margin-top: 0.4rem;
      font-size: 0.85rem;
      min-height: 1.2rem;
    }
    .ok {
      color: green;
    }
    .err {
      color: crimson;
    }
    .busy {
      color: #555;
      font-style: italic;
    }
  `;

  // Preferences state
  @state() private prefs: Preferences | null = null;
  @state() private prefsStatus: PrefsStatus = "loading";
  @state() private prefsMessage = "";

  // Upload state
  @state() private uploadStatus: UploadStatus = "idle";
  @state() private uploadMessage = "";
  @query('input[type="file"]') private fileInput!: HTMLInputElement;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadPrefs();
  }

  private async loadPrefs(): Promise<void> {
    this.prefsStatus = "loading";
    try {
      const res = await fetch(`${BACKEND_URL}/preferences`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.prefs = (await res.json()) as Preferences;
      this.prefsStatus = "ready";
    } catch (err) {
      this.prefsStatus = "error";
      this.prefsMessage = `Failed to load preferences: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private async savePref(key: PrefKey, raw: string): Promise<void> {
    if (!this.prefs) return;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return;

    const next: Preferences = { ...this.prefs, [key]: n };

    this.prefsStatus = "saving";
    this.prefsMessage = "Saving…";
    try {
      const res = await fetch(`${BACKEND_URL}/preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      this.prefs = (await res.json()) as Preferences;
      this.prefsStatus = "saved";
      this.prefsMessage = "Saved.";
    } catch (err) {
      this.prefsStatus = "error";
      this.prefsMessage = err instanceof Error ? err.message : String(err);
    }
  }

  private async onUpload(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const file = this.fileInput.files?.[0];
    if (!file) return;

    if (!confirm("This will replace all current players in the database. Continue?")) {
      return;
    }

    this.uploadStatus = "uploading";
    this.uploadMessage = `Uploading ${file.name}…`;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${BACKEND_URL}/players/import`, {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { imported?: number; filename?: string; detail?: string };
      if (res.ok && typeof data.imported === "number") {
        this.uploadStatus = "success";
        this.uploadMessage = `Imported ${data.imported} players from ${data.filename ?? file.name}.`;
        this.fileInput.value = "";
      } else {
        this.uploadStatus = "error";
        this.uploadMessage = data.detail ?? `Import failed (HTTP ${res.status}).`;
      }
    } catch (err) {
      this.uploadStatus = "error";
      this.uploadMessage = `Network error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private renderPrefsStatus() {
    if (!this.prefsMessage) return nothing;
    const cls =
      this.prefsStatus === "saved"
        ? "ok"
        : this.prefsStatus === "error"
          ? "err"
          : "busy";
    return html`<div class="status ${cls}">${this.prefsMessage}</div>`;
  }

  private renderUploadStatus() {
    if (!this.uploadMessage) return nothing;
    const cls =
      this.uploadStatus === "success"
        ? "ok"
        : this.uploadStatus === "error"
          ? "err"
          : "busy";
    return html`<p class="${cls}">${this.uploadMessage}</p>`;
  }

  private renderPrefsForm() {
    if (this.prefsStatus === "loading") return html`<p>Loading preferences…</p>`;
    if (!this.prefs)
      return html`<p class="err">${this.prefsMessage || "No preferences loaded."}</p>`;

    return html`
      <div class="prefs-grid">
        ${PREF_FIELDS.map(
          (f) => html`
            <label>
              ${f.label}
              <input
                type="number"
                min=${String(f.min)}
                step="1"
                .value=${String(this.prefs![f.key])}
                @change=${(e: Event) =>
                  this.savePref(f.key, (e.target as HTMLInputElement).value)}
              />
            </label>
          `,
        )}
      </div>
      ${this.renderPrefsStatus()}
    `;
  }

  override render() {
    return html`
      <h2>Settings</h2>

      <section>
        <h3>Auction preferences</h3>
        <p>League-wide configuration. Drives the scaling and indicators on the
          <a href="/evaluations">evaluations</a> page. Saved automatically when you
          leave a field.</p>
        ${this.renderPrefsForm()}
      </section>

      <section>
        <h3>Player data</h3>
        <p>Upload the latest <code>Quotazioni_Fantacalcio_Stagione_2025_26.xlsx</code> from
          fantacalcio.it. The server validates the file and, if at least one player is
          recognized and exactly 20 teams are present, wipes the <code>players</code> table
          and reloads it.</p>
        <form class="upload" @submit=${this.onUpload}>
          <input type="file" accept=".xlsx" required />
          <button type="submit" ?disabled=${this.uploadStatus === "uploading"}>
            Upload &amp; import
          </button>
        </form>
        ${this.renderUploadStatus()}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-page": SettingsPage;
  }
}
