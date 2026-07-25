// src/render/ui/kit/slider.ts
//
// Label + track + thumb + numeric readout. Value is 0..1; an optional `step`
// snaps both the drag/click result and the keyboard/gamepad `adjust` step.
// Immediate mode: the caller owns `value` and passes it in every frame;
// `slider()` returns the NEW value the frame it changes, else `null`.
//
// Geometry contract: top row (height = one line at `scale`) holds the label
// (left) and the readout (right); everything below is the track row, full
// width, vertically centred. The track itself is integer-pixel-snapped (no
// fractional rows) and is the ONE hit region — the whole track row, not just
// the thumb, so a click anywhere on it jumps.
//
// Keyboard/gamepad: the kit NEVER reads input itself (that's the ONE
// implementation rule — `UiContext.focusNext/focusPrev/activate` is the only
// place raw input becomes an intent). Callers that want arrow-key adjustment
// feed it in as `adjust`: -1 (decrement), 0 (none), or +1 (increment), sourced
// from whatever the runtime's key map decided this frame.

import type { UiContext } from '@/render/ui/ui-context';
import { clamp01 } from '@/core/math';
import { COLOR, FS, STROKE } from '@/render/ui/ui-tokens';

export interface SliderOpts {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1. */
  value: number;
  /** Quantization step for both click/drag results and `adjust` steps. */
  step?: number;
  disabled?: boolean;
  scale?: number;
  /** Caller-fed keyboard/gamepad delta for this frame (see module header). */
  adjust?: -1 | 0 | 1;
  /** Readout formatter; defaults to a rounded percentage. */
  format?: (value: number) => string;
}

/** Falls back to this step when `adjust` is used without an explicit `step` —
 *  a keyboard nudge still needs SOME granularity. */
const DEFAULT_ADJUST_STEP = 0.05;

function snap(value: number, step: number): number {
  return clamp01(Math.round(value / step) * step);
}

export function slider(c: UiContext, opts: SliderOpts): number | null {
  const s = opts.scale ?? FS.body;
  const disabled = !!opts.disabled;
  const value = clamp01(opts.value);

  const lh = c.lineHeight(s);
  c.label(opts.label.toUpperCase(), opts.x, opts.y, s, disabled ? COLOR.inkDim : COLOR.ink);
  const readoutText = opts.format ? opts.format(value) : `${Math.round(value * 100)}%`;
  const readoutW = c.measure(readoutText, s);
  c.label(readoutText, opts.x + opts.w - readoutW, opts.y, s, COLOR.inkDim);

  // Track row: everything below the label/readout row, vertically centred.
  const trackY = opts.y + lh;
  const trackH = Math.max(1, opts.h - lh);
  const trackRect = { x: opts.x, y: trackY, w: opts.w, h: trackH };

  const railY = Math.round(trackY + trackH / 2 - STROKE.hairline / 2);
  c.rect(trackRect.x, railY, trackRect.w, STROKE.hairline, disabled ? COLOR.inkDim : COLOR.ground);
  const fillW = Math.round(trackRect.w * value);
  c.rect(trackRect.x, railY, fillW, STROKE.hairline, disabled ? COLOR.inkDim : COLOR.gold);

  const thumbW = 4 * s;
  const thumbX = Math.round(trackRect.x + fillW - thumbW / 2);
  c.rect(thumbX, trackY, thumbW, trackH, disabled ? COLOR.inkDim : COLOR.gold);

  const clicked = !disabled && c.hotspot(opts.id, trackRect.x, trackRect.y, trackRect.w, trackRect.h);

  // `out` stays null unless an interaction happened THIS frame — a click/drag
  // on the track, or a caller-fed keyboard/gamepad `adjust`. "Unchanged" means
  // "nothing happened", not "happened to compute the same number".
  let out: number | null = null;
  if (clicked) {
    const { x: px } = c.pointer();
    const frac = clamp01((px - trackRect.x) / trackRect.w);
    out = opts.step ? snap(frac, opts.step) : frac;
  }
  if (!disabled && opts.adjust) {
    const stepSize = opts.step ?? DEFAULT_ADJUST_STEP;
    const nudged = clamp01((out ?? value) + opts.adjust * stepSize);
    out = opts.step ? snap(nudged, opts.step) : nudged;
  }
  return out;
}
