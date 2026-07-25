// src/render/ui/kit/modal.ts
//
// A centred modal frame: dim backdrop across the whole screen, a parchment
// panel + hairline ink border (the devotional surface — NOT `UiContext.panel`,
// which stays the gray-box `UI_PALETTE` surface for legacy/unconverted
// chrome), and an uppercased title. `modalFrame` returns the INNER content
// rect (inset by `SPACING.lg`, below the title) so the caller lays out its own
// widgets without recomputing the title's height.
//
// `backdropClicked` is a free function — no `UiContext` needed — so a screen
// can call it against whatever rect it considers "the modal" (typically the
// panel/outer rect from `modalOuterRect`, but any `Rect` works) to decide
// whether a click should dismiss.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS, SPACING, STROKE } from '@/render/ui/ui-tokens';
import { withAlpha } from '@/render/ui/ui-color';
import type { Rect } from '@/render/ui/kit/rect';

export interface ModalOpts {
  w: number;
  h: number;
  screenW: number;
  screenH: number;
  title: string;
}

/** The modal's outer (panel) rect, centred on the screen. Exposed separately
 *  from `modalFrame` so a caller can compute it (e.g. for `backdropClicked`)
 *  without re-deriving the centring arithmetic themselves. */
export function modalOuterRect(opts: { w: number; h: number; screenW: number; screenH: number }): Rect {
  return {
    x: Math.round((opts.screenW - opts.w) / 2),
    y: Math.round((opts.screenH - opts.h) / 2),
    w: opts.w,
    h: opts.h,
  };
}

/** Draws the backdrop + panel + title; returns the inner content `Rect`. */
export function modalFrame(c: UiContext, opts: ModalOpts): Rect {
  const outer = modalOuterRect(opts);

  // Dim backdrop: the whole screen recedes to shadow so the panel reads as
  // the one lit, illuminated surface.
  c.rect(0, 0, opts.screenW, opts.screenH, withAlpha(COLOR.ink, 0.55));

  c.rect(outer.x, outer.y, outer.w, outer.h, COLOR.parchment);
  c.batcher.border(outer.x, outer.y, outer.w, outer.h, STROKE.hairline, COLOR.ink);

  const titleH = c.lineHeight(FS.title);
  c.label(opts.title.toUpperCase(), outer.x + SPACING.lg, outer.y + SPACING.md, FS.title, COLOR.ink);

  const contentY = outer.y + SPACING.md + titleH + SPACING.md;
  return {
    x: outer.x + SPACING.lg,
    y: contentY,
    w: outer.w - 2 * SPACING.lg,
    h: outer.y + outer.h - SPACING.lg - contentY,
  };
}

/** True when `clickAt` falls OUTSIDE `frameRect` — the caller's cue to treat
 *  it as a backdrop click (dismiss the modal). */
export function backdropClicked(clickAt: { x: number; y: number }, frameRect: Rect): boolean {
  const { x, y } = clickAt;
  return !(x >= frameRect.x && x < frameRect.x + frameRect.w && y >= frameRect.y && y < frameRect.y + frameRect.h);
}
