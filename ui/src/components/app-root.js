var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./home-page";
import "./settings-page";
let AppRoot = class AppRoot extends LitElement {
    constructor() {
        super(...arguments);
        this.path = window.location.pathname;
        this.search = window.location.search;
        this.onPopState = () => {
            this.path = window.location.pathname;
            this.search = window.location.search;
        };
        this.onAppNavigate = (event) => {
            const { path, search = "" } = event.detail;
            const url = path + (search.startsWith("?") || search === "" ? search : `?${search}`);
            if (this.path !== path || this.search !== search) {
                history.pushState(null, "", url);
                this.path = path;
                this.search = search;
            }
        };
    }
    createRenderRoot() {
        return this;
    }
    connectedCallback() {
        super.connectedCallback();
        window.addEventListener("popstate", this.onPopState);
        window.addEventListener("app-navigate", this.onAppNavigate);
    }
    disconnectedCallback() {
        window.removeEventListener("popstate", this.onPopState);
        window.removeEventListener("app-navigate", this.onAppNavigate);
        super.disconnectedCallback();
    }
    navigate(event, to) {
        event.preventDefault();
        if (this.path !== to || this.search !== "") {
            history.pushState(null, "", to);
            this.path = to;
            this.search = "";
        }
    }
    renderPage() {
        switch (this.path) {
            case "/settings":
                return html `<settings-page></settings-page>`;
            case "/":
                return html `<home-page></home-page>`;
            default:
                return html `<p class="text-slate-600">
          Not found: <code class="font-mono">${this.path}</code>
        </p>`;
        }
    }
    linkClass(active) {
        const base = "text-sky-700 no-underline hover:underline";
        return active ? `${base} font-semibold text-slate-900` : base;
    }
    render() {
        return html `
      <div class="mx-auto max-w-screen-2xl px-6 py-6">
        <h1 class="text-2xl font-bold tracking-tight">Fanta Mantra</h1>
        <nav class="flex gap-4 border-b border-slate-200 pb-2 mt-3 mb-6">
          <a
            href="/"
            class=${this.linkClass(this.path === "/")}
            @click=${(e) => this.navigate(e, "/")}
          >Home</a>
          <a
            href="/settings"
            class=${this.linkClass(this.path === "/settings")}
            @click=${(e) => this.navigate(e, "/settings")}
          >Settings</a>
        </nav>
        ${this.renderPage()}
      </div>
    `;
    }
};
__decorate([
    state()
], AppRoot.prototype, "path", void 0);
__decorate([
    state()
], AppRoot.prototype, "search", void 0);
AppRoot = __decorate([
    customElement("app-root")
], AppRoot);
export { AppRoot };
