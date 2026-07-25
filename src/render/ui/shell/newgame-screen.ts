// src/render/ui/shell/newgame-screen.ts
//
// The NEW WORLD screen (UI v3 P5b — seed share's other half). Title's NEW
// WORLD row lands here instead of firing `new_game` straight away, so a
// player can either begin at random or paste a world code (`@/game/world-code`)
// shared by another session. Pure like every shell screen: state in, geometry
// out, action reported back — the paste field's own text lives in the DOM
// island this screen reserves a rect for (a canvas can't host a caret), never
// in this module or in Shell-local state.
//
// Decoding what was pasted is NOT this screen's job: the caller
// (`Game.onWorldCodeSubmit`) owns `WORLD_CONTENT_VERSION` and the actual
// `new_game` dispatch, and hands back only the refusal MESSAGE (already
// interpolated prose) when a code doesn't decode — this module just shows it.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, SPACING, shellTypeScaleFor } from '@/render/ui/ui-tokens';
import type { Rect } from '@/render/ui/kit';

export interface NewGameView {
  /** The last paste attempt's refusal message (malformed code / a
   *  contentVersion mismatch, spec §5.2's honesty rule extended to codes), or
   *  null when nothing has been tried yet. A SUCCESSFUL decode is not
   *  represented here: the caller has already moved on to `new_game` and this
   *  screen is off the stack by the next frame (see `shell.ts`'s `show()`,
   *  which collapses the whole stack to `['loading']`). */
  error: string | null;
}

export type NewGameAction = { kind: 'random' } | { kind: 'back' };

export interface NewGameDrawResult {
  action: NewGameAction | null;
  /** The paste field's reserved rect, EVERY frame it's on screen — same
   *  "can't collapse to a bare action" contract `settings-screen.ts`'s
   *  GAMEPLAY tab documents, and for the identical reason (the DOM island
   *  loses its position the instant nothing else fired). */
  island: Rect;
}

const HEADER = 'NEW WORLD';
const NOTE = 'PASTE A WORLD CODE, OR BEGIN AT RANDOM.';

/** The largest INTEGER scale at or below `preferred` at which `text` fits
 *  `maxW` — mirrors every other shell screen's `fitScale` (pixel-perfect law:
 *  no fractional scales). */
function fitScale(c: UiContext, text: string, maxW: number, preferred: number): number {
  for (let sc = preferred; sc > 1; sc--) {
    if (c.measure(text, sc) <= maxW) return sc;
  }
  return 1;
}

/**
 * Paint the NEW WORLD screen. Returns the GPU-button action fired this frame
 * (or null) plus the paste field's reserved rect — the paste SUBMIT itself
 * does not come through here (it is a DOM island event the caller wires
 * directly, the same split `onCardFreeText` uses for the whisper island).
 */
export function drawNewGameScreen(
  c: UiContext, w: number, h: number, s: number, view: NewGameView,
): NewGameDrawResult {
  const edge = Math.round(SPACING.lg * s);
  const cx = Math.round(w / 2);
  const T = shellTypeScaleFor(w, s);

  const colW = Math.round(Math.min(560 * s, Math.max(160, w - edge * 2)));
  const colX = Math.round(cx - colW / 2);
  const maxTextW = w - edge * 2;

  const fsHeader = fitScale(c, HEADER, maxTextW, T.heading);
  const headerH = c.lineHeight(fsHeader);
  const fsNote = T.caption;
  const noteH = c.lineHeight(fsNote);
  const fsError = T.caption;
  const errorH = view.error ? c.lineHeight(fsError) : 0;

  const fieldH = Math.max(Math.round(36 * s), c.buttonHeight(T.menu));
  const btnH = Math.max(Math.round(30 * s), c.buttonHeight(T.menu));
  const btnW = Math.round(Math.min(Math.max(220 * s, c.buttonWidth('RANDOM WORLD', T.menu)), colW));
  const backW = Math.round(Math.min(Math.max(160 * s, c.buttonWidth('BACK', T.menu)), colW));

  const fixedBtnH = backH(c, T.menu, s);
  const measure = (gap: number): number =>
    headerH + gap + noteH + gap + fieldH
    + (view.error ? gap + errorH : 0)
    + gap + btnH + gap + fixedBtnH;

  // A short, cheap degrade before stepping the whole screen down an integer
  // scale rung (same discipline as every other shell screen): tighten the
  // gaps first — this alone is enough for a phone-sized viewport, and it
  // costs the layout nothing visually on anything bigger, since the FULL gap
  // plan is always tried first.
  const gapFull = Math.round(SPACING.md * s);
  const gapTight = Math.round(SPACING.tight * s);
  const budget = h - edge * 2;
  const gap = measure(gapFull) <= budget ? gapFull : gapTight;
  const columnH = measure(gap);

  if (s > 1 && columnH > budget) {
    return drawNewGameScreen(c, w, h, s - 1, view);
  }

  let y = Math.max(Math.round(SPACING.lg * s), Math.round((h - Math.min(columnH, budget)) / 2));

  c.labelCentered(HEADER, cx, y, fsHeader, COLOR.ink);
  y += headerH + gap;

  c.labelCentered(c.ellipsize(NOTE, fsNote, maxTextW), cx, y, fsNote, COLOR.inkDim);
  y += noteH + gap;

  const island: Rect = { x: colX, y, w: colW, h: fieldH };
  y += fieldH;

  if (view.error) {
    y += gap;
    const errText = c.ellipsize(view.error.toUpperCase(), fsError, colW);
    c.labelCentered(errText, cx, y, fsError, COLOR.danger);
    y += errorH;
  }
  y += gap;

  let fired: NewGameAction | null = null;
  const btnX = Math.round(cx - btnW / 2);
  if (c.button('newgame.random', 'RANDOM WORLD', btnX, y, btnW, btnH, { scale: T.menu })) {
    fired = { kind: 'random' };
  }
  y += btnH + gap;

  const backX = Math.round(cx - backW / 2);
  if (c.button('newgame.back', 'BACK', backX, y, backW, fixedBtnH, { scale: T.menu })) {
    fired = { kind: 'back' };
  }

  return { action: fired, island };
}

function backH(c: UiContext, scale: number, s: number): number {
  return Math.max(Math.round(30 * s), c.buttonHeight(scale));
}
