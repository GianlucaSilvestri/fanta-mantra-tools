import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

interface Auction {
  id: number;
  name: string;
}

@customElement("auction-finished")
export class AuctionFinished extends LitElement {
  @property({ attribute: false }) auction!: Auction;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <div class="border-2 border-dashed border-slate-300 bg-slate-50 rounded-md p-8 text-center">
        <div class="text-slate-800 text-lg font-semibold">todo finished</div>
        <div class="text-sm text-slate-600 mt-2">
          Auction <strong>${this.auction.name}</strong> is terminated.
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-finished": AuctionFinished;
  }
}
