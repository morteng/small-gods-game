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

  /**
   * Keyboard/gamepad focus target. Durable across frames — the SAME durability
   * class as `scrollOffsets` above, never reset in `begin()` — so a screen that
   * redraws every frame doesn't lose focus between them. `null` = nothing
   * focused (the initial state; nothing auto-focuses on first draw).
   */
  focusId: string | null = null;

  /** This frame's navigation order, built by `focusable()` calls AS widgets
   *  draw (registration order = nav order — the same contract `hits` follows
   *  for click routing). Reset in `begin()`, like `hits`. `focusNext`/
   *  `focusPrev` are called BETWEEN frames — in response to a key/gamepad
   *  event, before the next `begin()` — so they always read the array as the
   *  just-completed frame left it: "the LAST frame's ring". */
  private focusRing: string[] = [];

  /** One-shot ACTIVATE request armed by `activate()` (Enter / gamepad A).
   *  `begin()` copies it into `activateThisFrame` (valid for exactly that one
   *  frame) and clears it here, so a single keypress fires the focused
   *  widget's click behavior on the next frame only — never queued, never
   *  repeated. */
  private pendingActivate = false;
  private activateThisFrame = false;

  constructor(opts: { batcher?: UiBatcher; palette?: UiPalette; font?: FontMetrics } = {}) {
    this.batcher = opts.batcher ?? new UiBatcher();
    this.palette = opts.palette ?? UI_PALETTE;
    this.font = opts.font ?? new BuiltinPixelFont();
  }

  /** Start a frame: reset geometry + hit list, capture the input snapshot. Scroll
   *  OFFSETS and the focus ID are deliberately NOT reset here — they are durable
   *  per-id/singleton state (D2 / the focus model). The focus RING is reset like
   *  `hits`, but only after any pending `focusNext`/`focusPrev` from BETWEEN
   *  frames has already read the prior value (see the field comment). */
  begin(input: UiInput = EMPTY_INPUT): void {
    this.batcher.reset();
    this.hits = [];
    this.scrollRegions = [];
    this.hotId = null;
    this.input = input;
    this.focusRing = [];
    this.activateThisFrame = this.pendingActivate;
    this.pendingActivate = false;
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
   * released while hot) OR the frame a keyboard/gamepad ACTIVATE lands while
   * this button holds focus. Inert when `disabled` or when the input snapshot
   * is empty. Records a hit region for S2's router regardless. Labels wider
   * than the button are ellipsis-clipped (`…`) so text never overflows the
   * border. Registers into the focus ring (unless `disabled` — nothing to
   * activate) via `focusable()`, so every button is keyboard/gamepad
   * navigable for free.
   */
  button(id: string, label: string, x: number, y: number, w: number, h: number, opts: ButtonOpts = {}): boolean {
    const scale = opts.scale ?? 1;
    const disabled = !!opts.disabled;
    const alpha = opts.alpha ?? 1;
    const hot = !disabled && pointIn(this.input.px, this.input.py, x, y, w, h);
    // Pointer hover sets keyboard focus too, so the two never disagree — a
    // mouse user tabbing away and back lands where their cursor already is.
    if (hot) this.setFocus(id);
    if (hot) this.hotId = id;
    const active = hot && this.input.down;
    // `focusable()` both registers this id into the nav ring AND reports
    // whether it holds focus right now — one call, one source of truth.
    const focused = !disabled && this.focusable(id);

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

    // Focus ring: a 2px border INSIDE the widget bounds (never touches layout
    // — same paint-only rule as the `alpha` quiet-chrome option above) drawn
    // only when focused-but-not-hot, so a hovered focused button doesn't show
    // two overlapping indicators (the hover bg already reads as "here").
    if (focused && !hot) {
      this.batcher.border(x, y, w, h, 2, p.accent);
    }

    this.hits.push({ id, x, y, w, h });
    return (hot && !disabled && this.input.released) || (focused && this.activateThisFrame);
  }

  /**
   * A chrome-less clickable region — the caller draws its own visuals (e.g. the
   * presence orb) and uses this purely for hover/click + hit-registration.
   * Returns true on the frame the click completes, OR a keyboard/gamepad
   * ACTIVATE lands while this hotspot holds focus. Sets `hot()` while hovered.
   * Registers into the focus ring via `focusable()`, same as `button()` —
   * unless `opts.focusable` is explicitly `false` (P5): a region that only
   * eats pointer clicks (a modal card's body, a world label, an alert pin)
   * is NOT itself a control a keyboard/gamepad user should be able to Tab to.
   * Hit-testing/click behavior is UNCHANGED either way — only nav-ring
   * membership, and (since a non-focusable hotspot can never legitimately
   * hold keyboard focus) hovering it no longer steals focus from whatever a
   * keyboard/gamepad user was already on.
   */
  hotspot(id: string, x: number, y: number, w: number, h: number, opts: { focusable?: boolean } = {}): boolean {
    const wantsFocus = opts.focusable ?? true;
    const hot = pointIn(this.input.px, this.input.py, x, y, w, h);
    if (hot && wantsFocus) this.setFocus(id);
    if (hot) this.hotId = id;
    const focused = wantsFocus && this.focusable(id);
    this.hits.push({ id, x, y, w, h });
    return (hot && this.input.released) || (focused && this.activateThisFrame);
  }

  /** The id of the widget currently under the pointer (null if none). */
  hot(): string | null {
    return this.hotId;
  }

  /**
   * Register `id` into this frame's keyboard/gamepad navigation ring
   * (registration order = navigation order — call it in draw order) and
   * report whether it currently holds focus. `button()`/`hotspot()` call this
   * for you; kit widgets that draw their own hit regions (e.g. a `list` row)
   * call it directly.
   */
  focusable(id: string): boolean {
    this.focusRing.push(id);
    return id === this.focusId;
  }

  /** Move focus to the next entry in the LAST frame's ring, wrapping past the
   *  end. Lands on the first entry when nothing was focused (or the focused id
   *  no longer exists in the ring — e.g. its widget stopped drawing). A no-op
   *  when the ring is empty. */
  focusNext(): void {
    const ring = this.focusRing;
    if (ring.length === 0) return;
    const idx = this.focusId != null ? ring.indexOf(this.focusId) : -1;
    this.focusId = ring[idx === -1 ? 0 : (idx + 1) % ring.length];
  }

  /** Move focus to the previous entry, wrapping past the start. Lands on the
   *  LAST entry when nothing was focused (the mirror of `focusNext`'s "first
   *  entry" — Shift+Tab from nowhere should reach backward, not restart). */
  focusPrev(): void {
    const ring = this.focusRing;
    if (ring.length === 0) return;
    const idx = this.focusId != null ? ring.indexOf(this.focusId) : -1;
    this.focusId = ring[idx === -1 ? ring.length - 1 : (idx - 1 + ring.length) % ring.length];
  }

  /** Directly set (or clear) keyboard focus — pointer hover calls this from
   *  `button()`/`hotspot()` so pointer and keyboard focus never disagree. */
  setFocus(id: string | null): void {
    this.focusId = id;
  }

  /** Arm a one-shot ACTIVATE (Enter / gamepad A): the currently-focused
   *  widget's `button()`/`hotspot()` call returns true on the NEXT frame, as
   *  if clicked. Consumed automatically by that frame's `begin()` — calling
   *  this twice before a frame runs does not queue two activations. */
  activate(): void {
    this.pendingActivate = true;
  }

  /** The injected pointer position for this frame (device px). Kit widgets
   *  that need "click anywhere jumps" behavior (e.g. a slider track) read
   *  this directly rather than every widget re-deriving its own notion of
   *  pointer position from a fresh `UiInput` plumbed in separately. */
  pointer(): { x: number; y: number } {
    return { x: this.input.px, y: this.input.py };
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
    indicatorScale?: number,
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
    // Scale is CALLER-SUPPLIED: a hardcoded 2 sat below the shell's caption floor
    // once the responsive type scale landed, so a screen at menu tier grew tiny
    // scroll marks. Defaults to 2 for the in-game HUD lists, which are unaffected.
    const fs = indicatorScale ?? 2;
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
