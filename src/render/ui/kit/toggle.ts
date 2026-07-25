// src/render/ui/kit/toggle.ts
//
// Label + ON/OFF pill. Immediate mode like everything in `UiContext`: the
// caller owns `value` and re-draws every frame; `toggle()` returns true on the
// exact frame the player flips it (a click, or a keyboard/gamepad ACTIVATE
// while focused — for free, since the pill is a plain `c.button()`).
//
// Geometry contract: occupies the full `(x, y, w, h)` rect. The label sits at
// the left edge, vertically centred; the pill is right-aligned, sized to fit
// the wider of "ON"/"OFF" so it never resizes as the value flips (a resizing
// hit target would shift under a repeated click).

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS } from '@/render/ui/ui-tokens';

export interface ToggleOpts {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  value: boolean;
  disabled?: boolean;
  scale?: number;
}

/** Draws the toggle; returns true on the frame it flips (caller flips its own
 *  `value` in response — this never mutates anything itself). */
export function toggle(c: UiContext, opts: ToggleOpts): boolean {
  const s = opts.scale ?? FS.body;
  const disabled = !!opts.disabled;

  const labelY = Math.round(opts.y + (opts.h - c.lineHeight(s)) / 2);
  c.label(opts.label.toUpperCase(), opts.x, labelY, s, disabled ? COLOR.inkDim : COLOR.ink);

  // Pill sized to the wider of the two states so its width — and therefore its
  // hit region — never changes as `value` flips.
  const pillW = Math.max(c.measure('ON', s), c.measure('OFF', s)) + 16 * s;
  const pillX = opts.x + opts.w - pillW;
  return c.button(opts.id, opts.value ? 'ON' : 'OFF', pillX, opts.y, pillW, opts.h, { disabled, scale: s });
}
