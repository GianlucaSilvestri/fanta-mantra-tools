import { noChange } from "lit";
import {
  directive,
  PartType,
  type ElementPart,
  type PartInfo,
} from "lit/directive.js";
import { AsyncDirective } from "lit/async-directive.js";

// Distance (px) the pointer must travel before a press is treated as a
// drag rather than a click. Keeps clicks on buttons/links inside the
// strip working while still letting a grab-and-drag scroll the row.
const DRAG_THRESHOLD = 5;

/**
 * Element directive that makes a horizontally-overflowing container
 * scrollable by click-and-drag — grab anywhere, not just the scrollbar.
 * A drag past the threshold swallows the trailing click so it doesn't
 * activate a control inside the strip.
 *
 * Usage: `<div class="overflow-x-auto" ${dragScroll()}>…</div>`
 */
class DragScrollDirective extends AsyncDirective {
  private el?: HTMLElement;
  private down = false;
  private dragging = false;
  private startX = 0;
  private startLeft = 0;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("dragScroll() can only be used on an element");
    }
  }

  render(): typeof noChange {
    return noChange;
  }

  override update(part: ElementPart): typeof noChange {
    const el = part.element as HTMLElement;
    if (el !== this.el) {
      this.teardown();
      this.el = el;
      this.setup();
    }
    return noChange;
  }

  private setup(): void {
    const el = this.el;
    if (!el) return;
    el.style.cursor = "grab";
    el.addEventListener("pointerdown", this.onPointerDown);
    // Capture phase so a post-drag click is suppressed before it reaches
    // any button inside the strip.
    el.addEventListener("click", this.onClickCapture, true);
  }

  private teardown(): void {
    const el = this.el;
    if (el) {
      el.removeEventListener("pointerdown", this.onPointerDown);
      el.removeEventListener("click", this.onClickCapture, true);
    }
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Primary button only. Don't preventDefault here — inputs/selects
    // inside the strip must keep focusing normally.
    if (e.button !== 0 || !this.el) return;
    this.down = true;
    this.dragging = false;
    this.startX = e.clientX;
    this.startLeft = this.el.scrollLeft;
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.down || !this.el) return;
    const dx = e.clientX - this.startX;
    if (!this.dragging && Math.abs(dx) > DRAG_THRESHOLD) {
      this.dragging = true;
      this.el.style.cursor = "grabbing";
      this.el.style.userSelect = "none";
    }
    if (this.dragging) {
      this.el.scrollLeft = this.startLeft - dx;
      e.preventDefault();
    }
  };

  private onPointerUp = (): void => {
    this.down = false;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    if (this.el) {
      this.el.style.cursor = "grab";
      this.el.style.userSelect = "";
    }
    // Leave `dragging` true until the trailing click is swallowed, then
    // clear it on the next tick.
    if (this.dragging) {
      setTimeout(() => (this.dragging = false), 0);
    }
  };

  private onClickCapture = (e: MouseEvent): void => {
    if (this.dragging) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  override disconnected(): void {
    this.teardown();
  }

  override reconnected(): void {
    this.setup();
  }
}

export const dragScroll = directive(DragScrollDirective);
