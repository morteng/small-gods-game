// src/render/ui/kit/key-chip.ts
//
// A small bordered chip rendering a key/gamepad prompt string (e.g. "ESC",
// "F", "TAB"). Pure geometry + label — no click behavior, no focus
// registration (a key-chip is a HINT drawn next to something else, not itself
// an interactive target). Returns the chip's own `Rect` so callers can chain
// layout (e.g. lay out several chips left-to-right).

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS, SPACING, STROKE } from '@/render/ui/ui-tokens';
import type { Rect } from '@/render/ui/kit/rect';

export interface KeyChipOpts {
  text: string;
  x: number;
  y: number;
  scale?: number;
}

export function keyChip(c: UiContext, opts: KeyChipOpts): Rect {
  const s = opts.scale ?? FS.small;
  const label = opts.text.toUpperCase();
  const tw = c.measure(label, s);
  const th = c.lineHeight(s);
  const w = tw + 2 * SPACING.tight;
  const h = th + 2 * SPACING.hairline;

  c.rect(opts.x, opts.y, w, h, COLOR.ground);
  c.batcher.border(opts.x, opts.y, w, h, STROKE.hairline, COLOR.inkDim);
  c.label(label, opts.x + SPACING.tight, opts.y + SPACING.hairline, s, COLOR.ink);

  return { x: opts.x, y: opts.y, w, h };
}
