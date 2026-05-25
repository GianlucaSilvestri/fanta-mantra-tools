var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
let AuctionFinished = class AuctionFinished extends LitElement {
    createRenderRoot() {
        return this;
    }
    render() {
        return html `
      <div class="border-2 border-dashed border-slate-300 bg-slate-50 rounded-md p-8 text-center">
        <div class="text-slate-800 text-lg font-semibold">todo finished</div>
        <div class="text-sm text-slate-600 mt-2">
          Auction <strong>${this.auction.name}</strong> is terminated.
        </div>
      </div>
    `;
    }
};
__decorate([
    property({ attribute: false })
], AuctionFinished.prototype, "auction", void 0);
AuctionFinished = __decorate([
    customElement("auction-finished")
], AuctionFinished);
export { AuctionFinished };
