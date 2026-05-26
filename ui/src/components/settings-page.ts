import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";

import { icon } from "../icons";

const BACKEND_URL = "http://localhost:8000";

type UploadStatus = "idle" | "uploading" | "success" | "error";

@customElement("settings-page")
export class SettingsPage extends LitElement {
  @state() private uploadStatus: UploadStatus = "idle";
  @state() private uploadMessage = "";
  @state() private importedCount: number | null = null;
  @state() private importedFilename = "";
  @state() private isDragging = false;
  @state() private selectedFile: File | null = null;

  @query('input[type="file"]') private fileInput!: HTMLInputElement;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private async uploadFile(file: File): Promise<void> {
    if (!confirm(`Upload ${file.name}? This will replace all current players in the database.`)) {
      return;
    }

    this.uploadStatus = "uploading";
    this.uploadMessage = `Uploading ${file.name}…`;
    this.selectedFile = file;

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
        this.importedCount = data.imported;
        this.importedFilename = data.filename ?? file.name;
        this.uploadMessage = `Imported ${data.imported} players from ${this.importedFilename}.`;
      } else {
        this.uploadStatus = "error";
        this.uploadMessage = data.detail ?? `Import failed (HTTP ${res.status}).`;
      }
    } catch (err) {
      this.uploadStatus = "error";
      this.uploadMessage = `Network error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (this.fileInput) this.fileInput.value = "";
    }
  }

  private onFileChosen(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void this.uploadFile(file);
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void this.uploadFile(file);
  }

  private clearSelection(): void {
    this.selectedFile = null;
    this.uploadStatus = "idle";
    this.uploadMessage = "";
    this.importedCount = null;
  }

  private renderResult() {
    if (!this.uploadMessage && !this.selectedFile) return nothing;

    if (this.uploadStatus === "uploading") {
      return html`
        <div class="mt-4 p-3.5 rounded-lg border border-line bg-surface flex items-center gap-3">
          <div
            class="w-9 h-9 grid place-items-center bg-app border border-line rounded-md text-accent"
          >${icon("file", { size: 16 })}</div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-[13px] truncate">
              ${this.selectedFile?.name ?? ""}
            </div>
            <div class="text-fg-muted text-[12px]">${this.uploadMessage}</div>
          </div>
        </div>
      `;
    }

    if (this.uploadStatus === "success") {
      return html`
        <div class="mt-4 p-3.5 rounded-lg border border-line bg-surface flex items-center gap-3">
          <div
            class="w-9 h-9 grid place-items-center bg-app border border-line rounded-md text-accent"
          >${icon("file", { size: 16 })}</div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-[13px] truncate">
              ${this.importedFilename}
            </div>
            <div class="text-fg-muted text-[12px]">
              ${this.importedCount} players · validated
            </div>
          </div>
          <button
            type="button"
            @click=${() => this.clearSelection()}
            class="px-2.5 py-1.5 rounded text-[12px] font-semibold border border-transparent text-fg hover:bg-surface-hover hover:border-line"
          >Dismiss</button>
        </div>
        <div
          class="mt-4 rounded-lg border border-line bg-app font-mono text-[12px] p-3.5 text-fg-dim whitespace-pre-wrap"
        >
<span class="text-accent">✓</span> Validated <span class="text-fg">${this.importedFilename}</span>
<span class="text-accent">✓</span> <span class="text-fg">${this.importedCount}</span> players recognized
<span class="text-accent">✓</span> 20 Serie A teams present
<span class="text-fg-dim">→</span> Wiped players table
<span class="text-fg-dim">→</span> Reloaded players
<span class="text-accent">✓</span> Done. Auction evaluations preserved.</div>
      `;
    }

    if (this.uploadStatus === "error") {
      return html`
        <div
          class="mt-4 p-3.5 rounded-lg border border-danger/30 bg-danger/10 text-danger text-[13px] flex items-start gap-2.5"
        >
          ${icon("alert", { size: 16 })}
          <div class="flex-1">${this.uploadMessage}</div>
          <button
            type="button"
            @click=${() => this.clearSelection()}
            class="px-2 py-1 rounded text-[12px] font-semibold text-danger hover:bg-danger/20"
          >Dismiss</button>
        </div>
      `;
    }

    return nothing;
  }

  override render() {
    return html`
      <main class="max-w-screen-xl mx-auto px-6 pt-8 pb-20">
        <div class="flex items-end justify-between gap-4 mb-6">
          <div>
            <h1 class="text-[28px] font-bold tracking-tight m-0">Settings</h1>
            <p class="text-fg-dim m-0 mt-1 text-[14px]">
              Server-wide configuration that persists across auctions.
            </p>
          </div>
        </div>

        <div class="rounded-xl border border-line bg-surface p-7 max-w-3xl">
          <h2 class="text-[16px] font-bold m-0 mb-1">Players database</h2>
          <p class="text-fg-dim text-[13px] m-0 mb-4 max-w-[60ch]">
            Upload the latest
            <code class="bg-app px-1.5 py-0.5 rounded text-accent">quotazioni.xlsx</code>
            from fantacalcio.it. The server validates the file and reloads Serie A teams and players.
          </p>

          <div
            class=${"rounded-lg border border-dashed text-center py-9 px-6 transition-colors cursor-pointer " +
            (this.isDragging
              ? "border-accent bg-accent/[0.08]"
              : "border-line-strong bg-app hover:border-accent hover:bg-accent/[0.08]")}
            @click=${() => this.fileInput?.click()}
            @dragover=${(e: DragEvent) => {
              e.preventDefault();
              this.isDragging = true;
            }}
            @dragleave=${() => (this.isDragging = false)}
            @drop=${(e: DragEvent) => this.onDrop(e)}
          >
            <div
              class="w-11 h-11 grid place-items-center mx-auto mb-3 rounded-lg border border-line bg-surface text-accent"
            >${icon("upload", { size: 20 })}</div>
            <div class="font-bold text-[15px] m-0 mb-1">
              Drop quotazioni.xlsx here
            </div>
            <p class="text-fg-dim text-[12px] m-0">
              or click to browse — .xlsx only
            </p>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              class="hidden"
              @change=${(e: Event) => this.onFileChosen(e)}
            />
          </div>

          ${this.renderResult()}
        </div>
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-page": SettingsPage;
  }
}
