// src/render/ui/shell/gameover-screen.ts
//
// The GAME-OVER / fade screen (UI v3 P5b) — pushed once when the PLAYER god
// crosses into `fading` (`src/sim/god-tier.ts`'s hysteretic fade rule, fired
// through the `god_faded` event `SpiritSystem` logs exactly once per
// transition). This is NOT a failure box: canon (VISION §5, tenet 6) makes the
// whisper "the primal, contested channel" precisely so a faded god always has
// a way back — the SIM KEEPS RUNNING behind this screen (the world outlives
// its god; the shell is drawn as the frame's outermost layer over whatever the
// running world was doing, same as every other screen — see
// `ui-runtime.ts`'s `frame()`). Pure like every shell screen: state in,
// geometry out, action reported back.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, SPACING, STROKE, shellTypeScaleFor, minHitSize } from '@/render/ui/ui-tokens';
import { withAlpha } from '@/render/ui/ui-color';

export interface GameOverView {
  /** An optional closing line under the epigraph (e.g. a Fate-authored
   *  epitaph) — null shows the screen with just the two canon lines. Prebuilt
   *  prose, same "fiction time only, never a raw number in the UI" rule every
   *  shell screen follows. This slice's caller (`Game.gameOverView`) passes
   *  null (no epitaph text is authored yet); kept so a future slice can add
   *  detail without reshaping this screen or its geometry test. */
  note: string | null;
}

export type GameOverAction = { kind: 'keep_watching' } | { kind: 'begin_again' };

const HEADLINE = 'YOUR GOD HAS FADED';
const EPIGRAPH = 'A GOD IS ONLY AS REAL AS ITS BELIEF';
const SUBLINE = 'THE WORLD GOES ON WITHOUT YOU. IT KEEPS ONLY YOUR WHISPER.';

interface Row { id: string; label: string; action: GameOverAction }

/** The two choices this screen ever offers — exported so `Shell.describe()`
 *  (spec §3.7) walks the SAME list the draw path does, matching `titleRows`'
 *  contract exactly. Both are always enabled: the anti-softlock guarantee
 *  (canon, not mercy — see the module header) means a faded god can always
 *  keep watching, and can always begin again. */
export function gameOverRows(): readonly Row[] {
  return [
    { id: 'gameover.keep_watching', label: 'KEEP WATCHING', action: { kind: 'keep_watching' } },
    { id: 'gameover.begin_again', label: 'BEGIN AGAIN', action: { kind: 'begin_again' } },
  ];
}

/** The largest INTEGER scale at or below `preferred` at which `text` fits
 *  `maxW` — mirrors `title-screen.ts`'s `fitScale` (pixel-perfect law: no
 *  fractional scales). */
function fitScale(c: UiContext, text: string, maxW: number, preferred: number): number {
  for (let sc = preferred; sc > 1; sc--) {
    if (c.measure(text, sc) <= maxW) return sc;
  }
  return 1;
}

/**
 * Paint the game-over screen. Returns the action the player triggered this
 * frame, or null. Same measure-then-place, degrade-before-scale-down
 * discipline as `title-screen.ts`: a short/narrow viewport drops the optional
 * `note` and then the canon epigraph before it would ever shrink the font or
 * lose a row — the two rows are the only way out of this screen, so (like the
 * title's rows) they are never dropped.
 */
export function drawGameOverScreen(
  c: UiContext, w: number, h: number, s: number, view: GameOverView,
): GameOverAction | null {
  const T = shellTypeScaleFor(w, s);
  const cx = Math.round(w / 2);
  const edge = SPACING.xxl * s;

  const rows = gameOverRows();
  let widestRow = 0;
  for (const r of rows) widestRow = Math.max(widestRow, c.measure(r.label, T.menu));
  const rowW = Math.round(Math.min(
    Math.max(320 * s, Math.ceil(widestRow) + SPACING.lg * 2 * s),
    Math.max(80, w - edge * 2),
  ));
  const rowH = Math.max(
    Math.round(34 * s),
    c.lineHeight(T.menu) + SPACING.md * 2 * s,
    minHitSize(T.cls, s),
  );

  const fsHead = fitScale(c, HEADLINE, w - edge, T.heading);
  const fsEpi = fitScale(c, EPIGRAPH, w - edge, T.caption);
  const fsSub = fitScale(c, SUBLINE, w - edge, T.caption);
  const fsNote = T.caption;
  const headH = c.lineHeight(fsHead);
  const epiH = c.lineHeight(fsEpi);
  const subH = c.lineHeight(fsSub);
  const noteH = c.lineHeight(fsNote);

  interface Plan { detail: boolean; note: boolean; gap: number; hero: number }
  const gapFull = SPACING.md * s;
  const gapTight = SPACING.tight * s;
  const heroFull = SPACING.xxl * s;
  const heroTight = SPACING.md * s;

  const measure = (p: Plan): number =>
    headH
    + (p.detail ? p.gap + epiH + p.gap + subH : 0)
    + (p.note && view.note ? p.gap + noteH : 0)
    + p.hero
    + rows.length * rowH + (rows.length - 1) * p.gap;

  // Degradation ladder, richest first: the caller's optional note goes first
  // (it is the least essential — the fixed canon lines never change), then
  // the epigraph+subline pair (dropped together — they make one statement),
  // then gaps tighten — mirroring `title-screen.ts`'s ladder.
  const plans: Plan[] = [
    { detail: true, note: true, gap: gapFull, hero: heroFull },
    { detail: true, note: true, gap: gapTight, hero: heroTight },
    { detail: true, note: false, gap: gapTight, hero: heroTight },
    { detail: false, note: false, gap: gapTight, hero: heroTight },
  ];

  const budget = h - SPACING.lg * s * 2;
  if (s > 1 && measure(plans[plans.length - 1]) > budget) {
    return drawGameOverScreen(c, w, h, s - 1, view);
  }
  const plan = plans.find((p) => measure(p) <= budget) ?? plans[plans.length - 1];
  const columnH = measure(plan);

  // A heavier scrim than the title's: this is a somber beat, and (unlike the
  // title, which sits over the animated sky with nothing else running) there
  // is a live world ticking underneath it.
  c.rect(0, 0, w, h, withAlpha(COLOR.ink, 0.55));

  let y = Math.max(Math.round(SPACING.lg * s), Math.round((h - columnH) / 2));

  // `fitScale` picks the largest font that fits at that PREFERRED scale, but its
  // floor is 1 — a fixed line long enough to still overflow at scale 1 on a
  // very narrow viewport (SUBLINE runs 59 characters) needs an ellipsis
  // backstop too, same as the caller-supplied `note` below.
  const maxTextW = w - edge;
  c.labelCentered(c.ellipsize(HEADLINE, fsHead, maxTextW), cx, y, fsHead, COLOR.parchment);
  y += headH;

  if (plan.detail) {
    y += plan.gap;
    c.labelCentered(c.ellipsize(EPIGRAPH, fsEpi, maxTextW), cx, y, fsEpi, COLOR.goldDim);
    y += epiH;
    y += plan.gap;
    c.labelCentered(c.ellipsize(SUBLINE, fsSub, maxTextW), cx, y, fsSub, withAlpha(COLOR.parchment, 0.7));
    y += subH;
  }

  if (plan.note && view.note) {
    y += plan.gap;
    const noteText = c.ellipsize(view.note.toUpperCase(), fsNote, maxTextW);
    c.labelCentered(noteText, cx, y, fsNote, withAlpha(COLOR.parchment, 0.7));
    y += noteH;
  }

  y += plan.hero;

  const rowX = Math.round(cx - rowW / 2);
  let fired: GameOverAction | null = null;
  rows.forEach((row, i) => {
    if (c.button(row.id, row.label, rowX, y, rowW, rowH, { scale: T.menu })) fired = row.action;
    y += rowH;
    if (i < rows.length - 1) y += plan.gap;
  });

  // A heavy frame around the text column — `STROKE.heavy` exists precisely
  // for "a rare, deliberately loud emphasis frame (e.g. a game-over frame)".
  const bandW = Math.min(w, rowW + edge * 2);
  const bandX = Math.round(cx - bandW / 2);
  const frameColor = withAlpha(COLOR.gold, 0.35);
  c.rect(bandX, 0, STROKE.heavy * s, h, frameColor);
  c.rect(bandX + bandW - STROKE.heavy * s, 0, STROKE.heavy * s, h, frameColor);

  return fired;
}
