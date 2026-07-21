// src/render/ui/ui-context.ts
//
// Immediate-mode UI context (S1). Rebuild the whole widget list from game state
// every frame — no retained widget tree, no UI/world state sync bugs (Dear ImGui
// style). Widgets push geometry into the `UiBatcher`; `ui-pass` draws it.
//
// Input is INJECTED as a per-frame snapshot (`UiInput`). S1 passes an empty
// snapshot, so widgets render but are inert; S2 fills pointer/click in and the
// SAME hot/active logic lights up — that contract is unit-tested here now so S2
// only has to feed the snapshot. Pure CPU (no WebGPU/DOM), Node-testable.

import { UiBatcher, UiSpace } from '@/render/ui/ui-batcher';
import { UI_PALETTE, type UiPalette } from '@/render/ui/ui-palette';
import type { FontMetrics } from '@/render/ui/text/font';
import { BuiltinPixelFont } from '@/render/ui/text/pixel-font';
import { withAlpha, type Rgba } from '@/render/ui/ui-color';

/** Per-frame input snapshot. S1: all-zero/false. S2 fills this from PointerEvents. */
export interface UiInput {
  px: number;
  py: number;
  /** Pointer currently pressed. */
  down: boolean;
  /** A press was RELEASED this frame (the click trigger). */
  released: boolean;
}

export const EMPTY_INPUT: UiInput = { px: 0, py: 0, down: false, released: false };

/** A hit-testable region a widget claimed this frame — handed to S2's router. */
export interface UiHit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A `scrollList` region claimed this frame — handed to `UiRuntime`'s capture-phase
 *  wheel listener so a wheel tick over the list steps its rows instead of the world
 *  camera zoom. Same shape as `UiHit`; kept distinct because wheel routing and click
 *  routing are separate DOM event families. */
export interface UiScrollRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonOpts {
  disabled?: boolean;
  scale?: number;
  /** D10 quiet chrome: multiplies bg/border/label alpha (default 1 = full
   *  strength). Hit-testing and click behavior are UNCHANGED — a dimmed button
   *  stays exactly as clickable as a full-strength one; only its paint recedes. */
  alpha?: number;
}

function pointIn(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px < x + w && py >= y && py < y + h;
}

export class UiContext {
  readonly batcher: UiBatcher;
  private readonly palette: UiPalette;
  private readonly font: FontMetrics;

  private input: UiInput = EMPTY_INPUT;
  private hits: UiHit[] = [];
  /** The widget under the pointer this frame (last one wins = topmost drawn). */
  private hotId: string | null = null;

  /** D2 row-granular scroll: regions claimed THIS frame (reset in `begin()`, like
   *  `hits`) — read by `UiRuntime`'s wheel router after each frame. */
  private scrollRegions: UiScrollRegion[] = [];
  /** D2: per-list row offset, keyed by `scrollList` id. Transient runtime state that
   *  survives across frames (never reset in `begin()` — the same durability class as
   *  `UiRuntime`'s hover-popover state) and is never serialized. `scrollBy` mutates it
   *  directly from a wheel tick; `scrollList` clamps + consumes it on the next draw. */
  private scrollOffsets = new Map<string, number>();

  constructor(opts: { batcher?: UiBatcher; palette?: UiPalette; font?: FontMetrics } = {}) {
    this.batcher = opts.batcher ?? new UiBatcher();
    this.palette = opts.palette ?? UI_PALETTE;
    this.font = opts.font ?? new BuiltinPixelFont();
  }

  /** Start a frame: reset geometry + hit list, capture the input snapshot. Scroll
   *  OFFSETS are deliberately NOT reset here — they are durable per-id state (D2). */
  begin(input: UiInput = EMPTY_INPUT): void {
    this.batcher.reset();
    this.hits = [];
    this.scrollRegions = [];
    this.hotId = null;
    this.input = input;
  }

  /** Filled, bordered surface (gray-box panel). */
  panel(x: number, y: number, w: number, h: number): void {
    this.batcher.rect(x, y, w, h, this.palette.panelBg);
    this.batcher.border(x, y, w, h, 1, this.palette.panelBorder);
  }

  /** Solid fill (screen-space by default; pass `UiSpace.World` for a map-anchored
   *  mark whose geometry the caller has already projected to device px). */
  rect(x: number, y: number, w: number, h: number, color: Rgba, space: UiSpace = UiSpace.Screen): void {
    this.batcher.rect(x, y, w, h, color, space);
  }

  /** Draw a text run at (x, y); `color` defaults to primary text. `space` selects
   *  the screen HUD (default) vs a world-anchored group (P5 alert-pin glyphs). */
  label(text: string, x: number, y: number, scale = 1, color: Rgba = this.palette.text, space: UiSpace = UiSpace.Screen): void {
    for (const q of this.font.layout(text, x, y, scale)) {
      this.batcher.quad(q.x, q.y, q.w, q.h, color, q.page, space, q.uv);
    }
  }

  /**
   * A clickable button. Returns true on the frame the click completes (pointer
   * released while hot). Inert when `disabled` or when the input snapshot is
   * empty. Records a hit region for S2's router regardless. Labels wider than
   * the button are ellipsis-clipped (`…`) so text never overflows the border.
   */
  button(id: string, label: string, x: number, y: number, w: number, h: number, opts: ButtonOpts = {}): boolean {
    const scale = opts.scale ?? 1;
    const disabled = !!opts.disabled;
    const alpha = opts.alpha ?? 1;
    const hot = !disabled && pointIn(this.input.px, this.input.py, x, y, w, h);
    if (hot) this.hotId = id;
    const active = hot && this.input.down;

    const p = this.palette;
    const bg = disabled ? p.disabledBg : active ? p.buttonActiveBg : hot ? p.buttonHotBg : p.buttonBg;
    const fg = disabled ? p.disabledText : p.buttonText;
    // D10: dim the paint only — geometry/hit-testing above is untouched, so a
    // dimmed ("quiet") button is exactly as clickable as a full-strength one.
    const bgA = alpha < 1 ? withAlpha(bg, bg[3] * alpha) : bg;
    const fgA = alpha < 1 ? withAlpha(fg, fg[3] * alpha) : fg;
    const borderA = alpha < 1 ? withAlpha(p.buttonBorder, p.buttonBorder[3] * alpha) : p.buttonBorder;

    this.batcher.rect(x, y, w, h, bgA);
    this.batcher.border(x, y, w, h, 1, borderA);

    // centre the label within the button; clip to the inner width first
    const padX = Math.ceil(4 * scale); // breathing room inside the 1px border
    const text = this.ellipsize(label, scale, w - 2 * padX);
    const tw = this.font.measure(text, scale);
    const th = this.font.lineHeight(scale);
    this.label(text, Math.round(x + Math.max(padX, (w - tw) / 2)), Math.round(y + (h - th) / 2), scale, fgA);

    this.hits.push({ id, x, y, w, h });
    return hot && !disabled && this.input.released;
  }

  /**
   * A chrome-less clickable region — the caller draws its own visuals (e.g. the
   * presence orb) and uses this purely for hover/click + hit-registration.
   * Returns true on the frame the click completes; sets `hot()` while hovered.
   */
  hotspot(id: string, x: number, y: number, w: number, h: number): boolean {
    const hot = pointIn(this.input.px, this.input.py, x, y, w, h);
    if (hot) this.hotId = id;
    this.hits.push({ id, x, y, w, h });
    return hot && this.input.released;
  }

  /** The id of the widget currently under the pointer (null if none). */
  hot(): string | null {
    return this.hotId;
  }

  /** Line height for a given text scale (for callers laying out their own text). */
  lineHeight(scale: number): number {
    return this.font.lineHeight(scale);
  }

  /** Pixel width of a text run at the given scale (for wrapping / centring). */
  measure(text: string, scale: number): number {
    return this.font.measure(text, scale);
  }

  /** Clip a run to `maxW` px, appending `…` when it doesn't fit (card choice
   *  labels can exceed their button — the primitive owns the clip so every
   *  button stays inside its border). Returns the text unchanged when it fits. */
  ellipsize(text: string, scale: number, maxW: number): string {
    if (this.font.measure(text, scale) <= maxW) return text;
    for (let n = text.length - 1; n > 0; n--) {
      const clipped = `${text.slice(0, n).trimEnd()}…`;
      if (this.font.measure(clipped, scale) <= maxW) return clipped;
    }
    return '…';
  }

  /**
   * D2 row-granular scroll list: draws only rows that FULLY fit `rect.h` at `rowH`
   * (no clipping needed — a row is either wholly drawn or not drawn), starting at
   * this id's current offset (clamped to `[0, max(0, rowCount - visibleRows)]`).
   * When the list overflows, draws `+`/`-` more-indicators (top-right / bottom-right
   * corners; only the existing pixel-font glyphs are used) and a thin position track
   * on the right edge. Registers the region so `UiRuntime`'s wheel router can find it.
   * The offset itself is mutated by `scrollBy` (a wheel tick), not by this method —
   * this method only clamps + consumes + draws.
   */
  scrollList(
    id: string,
    rect: { x: number; y: number; w: number; h: number },
    rowH: number,
    rowCount: number,
    drawRow: (i: number, rowY: number) => void,
  ): void {
    const { x, y, w, h } = rect;
    const visibleRows = rowH > 0 ? Math.max(0, Math.floor(h / rowH)) : 0;
    const maxOffset = Math.max(0, rowCount - visibleRows);
    const offset = Math.min(Math.max(this.scrollOffsets.get(id) ?? 0, 0), maxOffset);
    this.scrollOffsets.set(id, offset);
    this.scrollRegions.push({ id, x, y, w, h });

    const last = Math.min(rowCount, offset + visibleRows);
    for (let i = offset; i < last; i++) drawRow(i, y + (i - offset) * rowH);

    if (rowCount <= visibleRows) return; // nothing to indicate — the whole list fits

    // more-indicators: a small dim glyph tucked in the region's right corners.
    const fs = 2; // fixed — independent of the caller's row/text scale
    const gw = this.font.measure('+', fs);
    const gh = this.font.lineHeight(fs);
    const pad = 4;
    if (offset > 0) {
      this.label('-', x + w - gw - pad, y + pad, fs, this.palette.textDim);
    }
    if (offset + visibleRows < rowCount) {
      this.label('+', x + w - gw - pad, y + h - gh - pad, fs, this.palette.textDim);
    }

    // thin position track on the right edge: dim rail + an accent thumb sized to
    // the visible fraction, positioned to the current offset's fraction of travel.
    const trackW = 2;
    const trackX = x + w - trackW;
    this.rect(trackX, y, trackW, h, withAlpha(this.palette.textDim, 0.35));
    const thumbH = Math.max(4, Math.round((h * visibleRows) / rowCount));
    const thumbY = maxOffset > 0 ? y + Math.round(((h - thumbH) * offset) / maxOffset) : y;
    this.rect(trackX, thumbY, trackW, thumbH, this.palette.accent);
  }

  /** D2: bump a `scrollList` id's row offset by `deltaRows` (the wheel router calls
   *  this with ±3 per notch). Unclamped here — `scrollList` clamps on its next draw,
   *  so an overshoot from a shrinking list self-corrects the following frame. */
  scrollBy(id: string, deltaRows: number): void {
    this.scrollOffsets.set(id, (this.scrollOffsets.get(id) ?? 0) + deltaRows);
  }

  /** End the frame; returns the hit + scroll regions claimed (for the input router). */
  end(): { hits: readonly UiHit[]; scrollRegions: readonly UiScrollRegion[] } {
    return { hits: this.hits, scrollRegions: this.scrollRegions };
  }
}
