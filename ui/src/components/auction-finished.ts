import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { localized } from "@lit/localize";

import {
  type Auction,
  type ModulePrediction,
  type PlayerRow,
  type Purchase,
} from "../auction-shared";
import "./auction-board";

@customElement("auction-finished")
@localized()
export class AuctionFinished extends LitElement {
  @property({ attribute: false }) auction!: Auction;
  @property({ attribute: false }) players: PlayerRow[] = [];
  @property({ attribute: false }) purchases: Purchase[] = [];
  @property({ attribute: false }) modulePredictions: Record<
    number,
    ModulePrediction[]
  > = {};

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    return html`
      <auction-board
        .auction=${this.auction}
        .players=${this.players}
        .purchases=${this.purchases}
        .modulePredictions=${this.modulePredictions}
        .readonly=${true}
      ></auction-board>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "auction-finished": AuctionFinished;
  }
}
