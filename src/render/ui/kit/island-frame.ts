// src/render/ui/kit/island-frame.ts
//
// The generalised "DOM island" shell (UI v3 P1-A named it, P5b builds it): the
// ONE reason the WebGPU UI ever needs real DOM is typed text input (a canvas
// can't host a caret). `SettingsIsland` and `WhisperInputIsland` each hand-rolled
// an identical root <div> (position/display/z-index/pointer-events) plus
// identical show/hide/isShown/layout/destroy — this factors that boilerplate
// into ONE class so a THIRD island (the world-code paste field, P5b) composes
// it instead of copying the pattern a third time. Per the house rule:
// generalise this, never invent a second (or third) island class.
//
// Self-contained: inline styles, no CSS deps. Callers append their own field-
// specific children to `.root` and keep their own field logic (value read,
// submit handler, …) — this class owns only the shared shell.

/** CSS-pixel rect (top-left origin) the island should occupy — the same shape
 *  every shell screen's reserved-rect contract (`ShellDrawResult.island`)
 *  hands back, just in CSS px instead of device px. */
export interface IslandRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IslandFrameOptions {
  /** `column` (settings-style stacked fields) or `row` (whisper-style inline
   *  input + button). Default `column`. */
  flexDirection?: 'row' | 'column';
  /** Gap between children, css px. */
  gap?: number;
  /** Padding shorthand, e.g. `'14px'`. */
  padding?: string;
}

/** The shared island shell: a positioned, initially-hidden root `<div>` a
 *  caller fills with its own fields/buttons, plus the show/hide/layout/destroy
 *  lifecycle every island needs. Composition, not inheritance — a caller holds
 *  an `IslandFrame` as a field and appends its own children to `.root`. */
export class IslandFrame {
  readonly root: HTMLDivElement;
  private shown = false;

  constructor(container: HTMLElement, opts: IslandFrameOptions = {}) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:absolute', 'display:none', 'box-sizing:border-box',
      `flex-direction:${opts.flexDirection ?? 'column'}`,
      `gap:${opts.gap ?? 10}px`,
      `padding:${opts.padding ?? '0'}`,
      'font-family:ui-monospace,Menlo,Consolas,monospace', 'color:#e8e6f0',
      'background:transparent', 'z-index:30', 'pointer-events:auto',
    ].join(';');
    this.root.style.display = 'none'; // explicit — some CSSOMs drop the multi-prop cssText's display
    container.appendChild(this.root);
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.style.display = 'flex';
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.style.display = 'none';
  }

  isShown(): boolean {
    return this.shown;
  }

  /** Position the island over its GPU-drawn reserved rect (CSS px). */
  layout(r: IslandRect): void {
    this.root.style.left = `${Math.round(r.x)}px`;
    this.root.style.top = `${Math.round(r.y)}px`;
    this.root.style.width = `${Math.round(r.w)}px`;
    this.root.style.height = `${Math.round(r.h)}px`;
  }

  destroy(): void {
    this.root.remove();
  }
}
