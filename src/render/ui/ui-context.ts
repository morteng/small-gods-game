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
import type { Rgba } from '@/render/ui/ui-color';

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

export interface ButtonOpts {
  disabled?: boolean;
  scale?: number;
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

  constructor(opts: { batcher?: UiBatcher; palette?: UiPalette; font?: FontMetrics } = {}) {
    this.batcher = opts.batcher ?? new UiBatcher();
    this.palette = opts.palette ?? UI_PALETTE;
    this.font = opts.font ?? new BuiltinPixelFont();
  }

  /** Start a frame: reset geometry + hit list, capture the input snapshot. */
  begin(input: UiInput = EMPTY_INPUT): void {
    this.batcher.reset();
    this.hits = [];
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
   * empty. Records a hit region for S2's router regardless.
   */
  button(id: string, label: string, x: number, y: number, w: number, h: number, opts: ButtonOpts = {}): boolean {
    const scale = opts.scale ?? 1;
    const disabled = !!opts.disabled;
    const hot = !disabled && pointIn(this.input.px, this.input.py, x, y, w, h);
    if (hot) this.hotId = id;
    const active = hot && this.input.down;

    const p = this.palette;
    const bg = disabled ? p.disabledBg : active ? p.buttonActiveBg : hot ? p.buttonHotBg : p.buttonBg;
    const fg = disabled ? p.disabledText : p.buttonText;

    this.batcher.rect(x, y, w, h, bg);
    this.batcher.border(x, y, w, h, 1, p.buttonBorder);

    // centre the label within the button
    const tw = this.font.measure(label, scale);
    const th = this.font.lineHeight(scale);
    this.label(label, Math.round(x + (w - tw) / 2), Math.round(y + (h - th) / 2), scale, fg);

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

  /** End the frame; returns the hit regions claimed (for the input router). */
  end(): { hits: readonly UiHit[] } {
    return { hits: this.hits };
  }
}
