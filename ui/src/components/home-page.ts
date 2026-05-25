import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

const BACKEND_URL = "http://localhost:8000";

type HealthStatus = "checking" | "ok" | "down" | "unreachable";

@customElement("home-page")
export class HomePage extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .status-ok {
      color: green;
    }
    .status-down,
    .status-unreachable {
      color: crimson;
    }
  `;

  @state() private status: HealthStatus = "checking";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.checkHealth();
  }

  private async checkHealth(): Promise<void> {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      const data = (await res.json()) as { status?: string };
      this.status = data.status === "ok" ? "ok" : "down";
    } catch {
      this.status = "unreachable";
    }
  }

  private renderStatus() {
    switch (this.status) {
      case "checking":
        return html`<span>checking…</span>`;
      case "ok":
        return html`<span class="status-ok">Backend OK</span>`;
      case "down":
        return html`<span class="status-down">Backend responded but not OK</span>`;
      case "unreachable":
        return html`<span class="status-unreachable">Backend unreachable</span>`;
    }
  }

  override render() {
    return html`
      <h2>Home</h2>
      <p>Backend health: ${this.renderStatus()}</p>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "home-page": HomePage;
  }
}
