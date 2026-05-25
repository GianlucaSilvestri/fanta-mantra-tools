import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import "./home-page";
import "./settings-page";
import "./evaluations-page";

@customElement("app-root")
export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: system-ui, sans-serif;
      padding: 1.5rem 2rem;
    }
    nav {
      display: flex;
      gap: 1rem;
      border-bottom: 1px solid #ddd;
      padding-bottom: 0.5rem;
      margin-bottom: 1.5rem;
    }
    nav a {
      color: #06c;
      text-decoration: none;
    }
    nav a.active {
      font-weight: 600;
      color: #000;
    }
    nav a:hover {
      text-decoration: underline;
    }
  `;

  @state() private path: string = window.location.pathname;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.onPopState);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    super.disconnectedCallback();
  }

  private onPopState = (): void => {
    this.path = window.location.pathname;
  };

  private navigate(event: MouseEvent, to: string): void {
    event.preventDefault();
    if (this.path !== to) {
      history.pushState(null, "", to);
      this.path = to;
    }
  }

  private renderPage() {
    switch (this.path) {
      case "/settings":
        return html`<settings-page></settings-page>`;
      case "/evaluations":
        return html`<evaluations-page></evaluations-page>`;
      case "/":
        return html`<home-page></home-page>`;
      default:
        return html`<p>Not found: <code>${this.path}</code></p>`;
    }
  }

  override render() {
    return html`
      <h1>Fanta Mantra</h1>
      <nav>
        <a
          href="/"
          class=${this.path === "/" ? "active" : ""}
          @click=${(e: MouseEvent) => this.navigate(e, "/")}
        >Home</a>
        <a
          href="/evaluations"
          class=${this.path === "/evaluations" ? "active" : ""}
          @click=${(e: MouseEvent) => this.navigate(e, "/evaluations")}
        >Evaluations</a>
        <a
          href="/settings"
          class=${this.path === "/settings" ? "active" : ""}
          @click=${(e: MouseEvent) => this.navigate(e, "/settings")}
        >Settings</a>
      </nav>
      ${this.renderPage()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot;
  }
}
