import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized, msg } from "@lit/localize";

import { icon } from "../icons";

interface Auction {
  id: number;
  name: string;
}

@customElement("auction-running")
@localized()
export class AuctionRunning extends LitElement {
  @property({ attribute: false }) auction!: Auction;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <div class="rounded-xl border border-line bg-surface text-center py-16 px-6">
        <div
          class="w-14 h-14 grid place-items-center mx-auto mb-3.5 rounded-xl border border-line bg-surface text-accent"
        >${icon("play", { size: 22 })}</div>
        <h3 class="text-[18px] font-bold text-fg m-0 mb-1.5">
          ${msg("Live auction — coming soon")}
        </h3>
        <p class="text-[13px] text-fg-dim max-w-[360px] mx-auto m-0">
          ${msg(html`This screen will host the live bidding interface for
          <b>${this.auction.name}</b>. Designs to be defined.`)}
        </p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-running": AuctionRunning;
  }
}
