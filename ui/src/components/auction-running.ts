import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

interface Auction {
  id: number;
  name: string;
}

@customElement("auction-running")
export class AuctionRunning extends LitElement {
  @property({ attribute: false }) auction!: Auction;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <div class="border-2 border-dashed border-sky-300 bg-sky-50 rounded-md p-8 text-center">
        <div class="text-sky-900 text-lg font-semibold">todo auction</div>
        <div class="text-sm text-sky-700 mt-2">
          Auction <strong>${this.auction.name}</strong> is in progress.
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-running": AuctionRunning;
  }
}
