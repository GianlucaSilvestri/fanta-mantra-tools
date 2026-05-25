import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

const BACKEND_URL = "http://localhost:8000";

type UploadStatus = "idle" | "uploading" | "success" | "error";

@customElement("settings-page")
export class SettingsPage extends LitElement {
  @state() private uploadStatus: UploadStatus = "idle";
  @state() private uploadMessage = "";
  @query('input[type="file"]') private fileInput!: HTMLInputElement;

  protected override createRenderRoot(): HTMLElement {
    return this;
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

  private renderUploadStatus() {
    if (!this.uploadMessage) return nothing;
    const cls =
      this.uploadStatus === "success"
        ? "text-emerald-700"
        : this.uploadStatus === "error"
          ? "text-rose-700"
          : "text-slate-600 italic";
    return html`<p class="mt-2 text-sm ${cls}">${this.uploadMessage}</p>`;
  }

  override render() {
    return html`
      <h2 class="text-xl font-semibold mb-4">Settings</h2>

      <section class="max-w-2xl">
        <h3 class="text-base font-semibold mb-2">Player data</h3>
        <p class="text-sm text-slate-600 mb-3">
          Upload the latest
          <code class="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">Quotazioni_Fantacalcio_Stagione_2025_26.xlsx</code>
          from fantacalcio.it. The server validates the file and, if at least
          one player is recognized and exactly 20 teams are present, wipes the
          <code class="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">players</code>
          table and reloads it. Auction evaluations survive (they don't
          reference players by FK).
        </p>
        <form class="flex items-center gap-3" @submit=${this.onUpload}>
          <input
            type="file"
            accept=".xlsx"
            required
            class="block text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-white file:cursor-pointer hover:file:bg-slate-700"
          />
          <button
            type="submit"
            ?disabled=${this.uploadStatus === "uploading"}
            class="rounded bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
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
