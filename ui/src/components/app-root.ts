import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { localized, msg, str } from "@lit/localize";

import { icon } from "../icons";
import "./home-page";
import "./settings-page";
import "./auction-page";

type Route =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "auction"; auctionId: number }
  | { kind: "not-found" };

function parseRoute(pathname: string): Route {
  if (pathname === "/" || pathname === "") return { kind: "home" };
  if (pathname === "/settings") return { kind: "settings" };
  const m = pathname.match(/^\/auction\/(\d+)\/?$/);
  if (m) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && id > 0) return { kind: "auction", auctionId: id };
  }
  return { kind: "not-found" };
}

@customElement("app-root")
@localized()
export class AppRoot extends LitElement {
  @state() private path: string = window.location.pathname;

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
  };

  private onAppNavigate = (event: CustomEvent<{ path: string }>): void => {
    const { path } = event.detail;
    if (this.path !== path) {
      history.pushState(null, "", path);
      this.path = path;
      window.scrollTo(0, 0);
    }
  };

  private navigate(event: MouseEvent, to: string): void {
    event.preventDefault();
    if (this.path !== to) {
      history.pushState(null, "", to);
      this.path = to;
      window.scrollTo(0, 0);
    }
  }

  private renderPage() {
    const route = parseRoute(this.path);
    switch (route.kind) {
      case "home":
        return html`<home-page></home-page>`;
      case "settings":
        return html`<settings-page></settings-page>`;
      case "auction":
        return html`<auction-page .auctionId=${route.auctionId}></auction-page>`;
      case "not-found":
        return html`
          <main class="mx-auto max-w-screen-xl px-6 py-12">
            <p class="text-fg-dim">
              ${msg(str`Not found: ${this.path}`)}
            </p>
          </main>
        `;
    }
  }

  override render() {
    const homeActive = this.path === "/" || this.path.startsWith("/auction/");
    const settingsActive = this.path === "/settings";
    return html`
      <header
        class="sticky top-0 z-50 h-14 px-6 flex items-center gap-5 border-b border-line bg-app/85 backdrop-blur-md"
      >
        <a
          href="/"
          class="flex items-center gap-2.5 font-bold tracking-tight text-[15px] text-fg"
          @click=${(e: MouseEvent) => this.navigate(e, "/")}
        >
          <span
            class="w-2.5 h-2.5 rounded-full bg-accent animate-dot-pulse"
            style="box-shadow: 0 0 12px var(--color-accent);"
          ></span>
          <span>fantarincag</span>
        </a>
        <nav class="flex gap-1 ml-3">
          <a
            href="/"
            class=${"px-3 py-1.5 rounded text-[13px] font-medium transition-colors " +
            (homeActive
              ? "text-accent"
              : "text-fg-dim hover:text-fg hover:bg-surface")}
            @click=${(e: MouseEvent) => this.navigate(e, "/")}
          >${msg("Home")}</a>
        </nav>
        <div class="flex-1"></div>
        <a
          href="/settings"
          aria-label=${msg("Settings")}
          title=${msg("Settings")}
          class=${"w-9 h-9 grid place-items-center rounded border transition-colors " +
          (settingsActive
            ? "text-accent border-line"
            : "text-fg-dim border-transparent hover:text-fg hover:bg-surface")}
          @click=${(e: MouseEvent) => this.navigate(e, "/settings")}
        >${icon("settings", { size: 18 })}</a>
      </header>
      ${this.renderPage()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-root": AppRoot;
  }
}
