// src/render/ui/shell/photo-screen.ts
//
// Photo mode (UI v3 P5b) — the CHROME-FREE screen `capture_photo` pushes.
// Winning the shell stack (see `ui-runtime.ts`'s `frame()`: a pushed screen
// "wins over EVERYTHING") already means the ordinary in-game HUD does not
// draw — that IS the point, a clean composition for the screenshot the verb
// just captured. This module draws almost nothing on top of it: a small
// "PHOTO SAVED" hint that fades on its own, confirming the shot landed
// without asking the player to dismiss anything.
//
// No buttons, no hit regions — there is genuinely nothing to click here.
// Esc/back is the shell's ordinary generic screen-pop (`Game.onShellEscape`
// already pops any non-title/loading screen), which needs no help from this
// module. The world keeps rendering (and, if unpaused, keeps ticking) behind
// it exactly like every other shell screen — nothing here pauses anything.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, SPACING, shellTypeScaleFor } from '@/render/ui/ui-tokens';
import { withAlpha } from '@/render/ui/ui-color';

export interface PhotoView {
  /** Non-null while the "saved" hint is still fading in/out; null once it has
   *  fully faded (the caller then draws literally nothing here). */
  hintText: string | null;
  /** 0..1, computed by the caller (`Game.photoView`) from elapsed real time
   *  since the last capture. This module only ever multiplies its own paint
   *  alpha by it — the fade CURVE lives with the caller, not the geometry. */
  alpha: number;
}

/**
 * Paint the photo screen. Always returns null: there is nothing to click (see
 * the module header) — the signature still matches every other shell
 * screen's `(c, w, h, s, view) => action` shape so `Shell.draw`'s dispatch
 * stays uniform, even though this `action` type is trivially `null`.
 */
export function drawPhotoScreen(c: UiContext, w: number, h: number, s: number, view: PhotoView): null {
  const alpha = Math.max(0, Math.min(1, view.alpha));
  if (!view.hintText || alpha <= 0) return null;
  const T = shellTypeScaleFor(w, s);
  const scale = T.caption;
  const text = c.ellipsize(view.hintText.toUpperCase(), scale, w - SPACING.xxl * s);
  const tw = c.measure(text, scale);
  const x = Math.round((w - tw) / 2);
  const y = Math.round(h - SPACING.xxl * s - c.lineHeight(scale));
  c.label(text, x, y, scale, withAlpha(COLOR.parchment, 0.85 * alpha));
  return null;
}
