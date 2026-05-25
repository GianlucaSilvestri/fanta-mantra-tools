import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import "./home-page";
import "./settings-page";

@customElement("app-root")
export class AppRoot extends LitElement {
  @state() private path: string = window.location.pathname;
  @state() private search: string = window.location.search;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.onPopState);
    window.addEventListener("app-navigate", this.onAppNavigate as EventListener);
  }

  override disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("app-navigate", this.onAppNavigate as EventListener);
    super.disconnectedCallback();
  }

  private onPopState = (): void => {
    this.path = window.location.pathname;
    this.search = window.location.search;
  };

  private onAppNavigate = (event: CustomEvent<{ path: string; search?: string }>): void => {
    const { path, search = "" } = event.detail;
    const url = path + (search.startsWith("?") || search === "" ? search : `?${search}`);
    if (this.path !== path || this.search !== search) {
      history.pushState(null, "", url);
      this.path = path;
      this.search = search;
    }
  };

  private navigate(event: MouseEvent, to: string): void {
    event.preventDefault();
    if (this.path !== to || this.search !== "") {
      history.pushState(null, "", to);
      this.path = to;
      this.search = "";
    }
  }

  private renderPage() {
    switch (this.path) {
      case "/settings":
        return html`<settings-page></settings-page>`;
      case "/":
        return html`<home-page></home-page>`;
      default:
        return html`<p class="text-slate-600">
          Not found: <code class="font-mono">${this.path}</code>
        </p>`;
    }
  }

  private linkClass(active: boolean): string {
    const base = "text-sky-700 no-underline hover:underline";
    return active ? `${base} font-semibold text-slate-900` : base;
  }

  override render() {
    return html`
      <div class="mx-auto max-w-screen-2xl px-6 py-6">
        <h1 class="text-2xl font-bold tracking-tight">Fanta Mantra</h1>
        <nav class="flex gap-4 border-b border-slate-200 pb-2 mt-3 mb-6">
          <a
            href="/"
            class=${this.linkClass(this.path === "/")}
            @click=${(e: MouseEvent) => this.navigate(e, "/")}
          >Home</a>
          <a
            href="/settings"
            class=${this.linkClass(this.path === "/settings")}
            @click=${(e: MouseEvent) => this.navigate(e, "/settings")}
          >Settings</a>
        </nav>
        ${this.renderPage()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot;
  }
}
