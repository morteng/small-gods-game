// src/render/ui/shell/title-screen.ts
//
// The title screen (UI v3 P2) — the first thing the game shows, within ~1–2 s of
// page load, over the animated sky backdrop and BEFORE any world exists.
//
// It is a pure draw function like every shell screen: state in, geometry out,
// actions reported back. It knows nothing about `Game`, save stores or IndexedDB
// — the caller hands it a `TitleView` (already probed) and receives a
// `TitleAction` to translate into a meta command (`new_game`, `load_slot`, …).
// That is what lets the whole title flow be driven by MCP / the dev bus / a
// pixel test with no live world and no DOM.
//
// The CONTINUE row is where honesty matters: a save that exists but was written
// by an older world/save version must SAY so and refuse, never quietly hand the
// player a freshly generated world they did not ask for (spec §5.2).

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS, SPACING, STROKE } from '@/render/ui/ui-tokens';
import { withAlpha } from '@/render/ui/ui-color';

/** Why CONTINUE cannot be offered, or `null` when it can. Prose, already
 *  resolved by the caller (it knows the real version numbers). */
export type ContinueBlock =
  | null
  | { reason: 'none'; text: string }         // no save at all
  | { reason: 'stale-save'; text: string }   // SAVE_VERSION mismatch
  | { reason: 'stale-world'; text: string }; // contentVersion mismatch

export interface TitleView {
  /** The autosave slot's summary line ("Day 34 · a small shrine · 2h 15m"), or
   *  null when there is nothing to continue. Prebuilt — the screen never formats
   *  a tick or a date itself. */
  continueLine: string | null;
  /** Non-null ⇒ CONTINUE is disabled and this explains why, in the player's words. */
  continueBlocked: ContinueBlock;
  /** Whether any named slot holds a save (drives LOAD WORLD's enabled state). */
  hasAnySave: boolean;
  /** Build/version line for the bottom corner (dim, informational). */
  buildLine: string;
}

/** What the player asked for. The caller maps these onto meta commands. */
export type TitleAction =
  | { kind: 'continue' }
  | { kind: 'new_world' }
  | { kind: 'load' }
  | { kind: 'demo' }
  | { kind: 'settings' };

const WORDMARK = 'SMALL GODS';
/** Canon, tenet 6 — the game's thesis, stated once, where it sets the tone. */
const EPIGRAPH = 'A GOD IS ONLY AS REAL AS ITS BELIEF';

/** One menu row: id, label, the action it emits, and whether it is offered. */
interface Row {
  id: string;
  label: string;
  action: TitleAction;
  enabled: boolean;
  /** Sub-line under the label (the continue summary, or a refusal reason). */
  note: string | null;
}

/** Build the menu rows from the view. Exported so a test can assert the
 *  enable/disable LOGIC without going through geometry. */
export function titleRows(view: TitleView): Row[] {
  const blocked = view.continueBlocked;
  return [
    {
      id: 'title.continue',
      label: 'CONTINUE',
      action: { kind: 'continue' },
      enabled: blocked === null,
      // When blocked, the reason replaces the summary — the player is told what
      // happened to their save instead of being shown a row that does nothing.
      note: blocked ? blocked.text : view.continueLine,
    },
    { id: 'title.new', label: 'NEW WORLD', action: { kind: 'new_world' }, enabled: true, note: null },
    {
      id: 'title.load', label: 'LOAD WORLD', action: { kind: 'load' },
      enabled: view.hasAnySave, note: view.hasAnySave ? null : 'NO SAVED WORLDS YET',
    },
    {
      id: 'title.demo', label: 'DEMO WORLD', action: { kind: 'demo' }, enabled: true,
      note: 'A WORLD TO WATCH — NOTHING IS SAVED',
    },
    { id: 'title.settings', label: 'SETTINGS', action: { kind: 'settings' }, enabled: true, note: null },
  ];
}

/**
 * The largest INTEGER scale at or below `preferred` at which `text` fits `maxW`.
 *
 * The pixel-perfect law forbids fractional scales, so a wordmark too wide for the
 * window steps DOWN a whole scale rung rather than being squashed. Returns 1 as
 * the floor — below that there is no font.
 */
function fitScale(c: UiContext, text: string, maxW: number, preferred: number): number {
  for (let sc = preferred; sc > 1; sc--) {
    if (c.measure(text, sc) <= maxW) return sc;
  }
  return 1;
}

/**
 * Paint the title screen. Returns the action the player triggered this frame, or
 * null. Nothing is drawn behind it — the animated sky backdrop shows through
 * (that is the point of the meta render path), so the only scrim is a soft one
 * behind the text column for legibility.
 *
 * `s` is the integer HUD scale; all dimensions are design px × `s`, snapped.
 *
 * LAYOUT IS MEASURED BEFORE IT IS PLACED. The column is sized in a first pure
 * pass, then vertically centred and, if it still does not fit, degraded in a
 * fixed order (notes drop first, then the epigraph, then the gaps tighten) — so a
 * short or narrow window loses detail instead of spilling text off-screen. Both
 * failure modes were real and are pinned by `tests/unit/shell-title-screen.test.ts`.
 */
export function drawTitleScreen(
  c: UiContext, w: number, h: number, s: number, view: TitleView,
): TitleAction | null {
  const fsBody = FS.body * s;
  const fsSmall = FS.small * s;

  const cx = Math.round(w / 2);
  const edge = SPACING.xxl * s;
  const rowW = Math.round(Math.min(360 * s, Math.max(80, w - edge * 2)));
  let rowH = Math.round(34 * s);
  const rows = titleRows(view);

  // The wordmark steps down whole scale rungs until it fits the window width.
  const fsWord = fitScale(c, WORDMARK, w - edge, FS.display * s);
  // The epigraph is a single unbreakable line; same treatment.
  const fsEpi = fitScale(c, EPIGRAPH, w - edge, fsSmall);

  const epiH = c.lineHeight(fsEpi);
  const noteH = Math.round(SPACING.tight * s) + c.lineHeight(fsSmall);
  const noteCount = rows.filter((r) => r.note !== null).length;

  interface Plan {
    notes: boolean; epigraph: boolean; wordmark: boolean;
    gap: number; hero: number; rowH: number;
  }

  // ── measure, then decide how much detail fits ──
  const measure = (p: Plan): number =>
    (p.wordmark ? c.lineHeight(fsWord) : 0)
    + (p.wordmark && p.epigraph ? p.gap + epiH : p.epigraph ? epiH : 0)
    + (p.wordmark || p.epigraph ? p.hero : 0)
    + rows.length * p.rowH + (rows.length - 1) * p.gap
    + (p.notes ? noteCount * noteH : 0);

  const gapFull = SPACING.md * s;
  const gapTight = SPACING.tight * s;
  const heroFull = SPACING.xxxl * s;
  const heroTight = SPACING.md * s;
  const budget = h - SPACING.lg * s * 2;
  // A row can compress to its own text plus breathing room, never below — past
  // that the label stops being readable and the row stops being a control.
  const rowHMin = c.lineHeight(fsBody) + SPACING.tight * 2;

  // Degradation ladder, richest first: notes go, then the epigraph, then the rows
  // compress, then (only on an absurdly short viewport) the wordmark itself. The
  // ROWS ARE NEVER DROPPED — they are the only way out of this screen.
  const plans: Plan[] = [
    { notes: true, epigraph: true, wordmark: true, gap: gapFull, hero: heroFull, rowH },
    { notes: true, epigraph: true, wordmark: true, gap: gapTight, hero: heroTight, rowH },
    { notes: false, epigraph: true, wordmark: true, gap: gapTight, hero: heroTight, rowH },
    { notes: false, epigraph: false, wordmark: true, gap: gapTight, hero: heroTight, rowH },
    { notes: false, epigraph: false, wordmark: true, gap: gapTight, hero: heroTight, rowH: rowHMin },
    { notes: false, epigraph: false, wordmark: false, gap: gapTight, hero: 0, rowH: rowHMin },
  ];
  // If not even the FLOOR plan fits at this UI scale, the viewport is smaller
  // than this scale can serve — so step the whole screen down an integer scale
  // rung and try again, exactly as `fitScale` does for a single run of text.
  // Better a smaller-but-complete menu than a menu running off the bottom edge.
  // Terminates at s === 1, below which there is no smaller scale to take.
  if (s > 1 && measure(plans[plans.length - 1]) > budget) {
    return drawTitleScreen(c, w, h, s - 1, view);
  }

  const plan = plans.find((p) => measure(p) <= budget) ?? plans[plans.length - 1];
  rowH = plan.rowH;
  const columnH = measure(plan);

  // ── the text column's own scrim ──
  // A soft vertical band behind the column rather than a full-screen wash: the
  // sky IS the art here, so we darken only what the text needs to sit on.
  const bandW = Math.min(w, rowW + edge * 2);
  const bandX = Math.round(cx - bandW / 2);
  c.rect(bandX, 0, bandW, h, withAlpha(COLOR.ink, 0.42));

  // Vertically centred, but never above the top margin on a cramped window.
  let y = Math.max(Math.round(SPACING.lg * s), Math.round((h - columnH) / 2));

  // ── wordmark + epigraph ──
  if (plan.wordmark) {
    const wordW = c.measure(WORDMARK, fsWord);
    c.label(WORDMARK, Math.round(cx - wordW / 2), y, fsWord, COLOR.parchment);
    y += c.lineHeight(fsWord);
    if (plan.epigraph) y += plan.gap;
  }
  if (plan.epigraph) {
    const epiW = c.measure(EPIGRAPH, fsEpi);
    c.label(EPIGRAPH, Math.round(cx - epiW / 2), y, fsEpi, COLOR.goldDim);
    y += epiH;
  }
  if (plan.wordmark || plan.epigraph) y += plan.hero;

  // ── menu rows ──
  const rowX = Math.round(cx - rowW / 2);
  let fired: TitleAction | null = null;
  rows.forEach((row, i) => {
    const clicked = c.button(row.id, row.label, rowX, y, rowW, rowH, {
      scale: fsBody,
      disabled: !row.enabled,
    });
    // A disabled row can never fire, even if something upstream mis-routes a
    // click or a gamepad activate: the guard lives here, not only in the paint.
    if (clicked && row.enabled) fired = row.action;
    y += rowH;

    if (plan.notes && row.note) {
      const noteY = y + Math.round(SPACING.tight * s);
      const noteText = c.ellipsize(row.note.toUpperCase(), fsSmall, rowW);
      const nw = c.measure(noteText, fsSmall);
      // A refusal reads in the DIM ink; an offered summary reads gold-dim, so
      // "here is your world" and "your save cannot be opened" never look alike.
      const tone = row.enabled ? COLOR.goldDim : withAlpha(COLOR.parchment, 0.55);
      c.label(noteText, Math.round(cx - nw / 2), noteY, fsSmall, tone);
      y = noteY + c.lineHeight(fsSmall);
    }
    if (i < rows.length - 1) y += plan.gap;
  });

  // ── build line, bottom-right ──
  if (view.buildLine) {
    const bw = c.measure(view.buildLine, fsSmall);
    c.label(
      view.buildLine,
      Math.round(w - bw - SPACING.lg * s),
      Math.round(h - c.lineHeight(fsSmall) - SPACING.lg * s),
      fsSmall,
      withAlpha(COLOR.parchment, 0.4),
    );
  }

  // A hairline gold rule down each edge of the band — the manuscript margin.
  const ruleA = withAlpha(COLOR.gold, 0.25);
  c.rect(bandX, 0, STROKE.hairline * s, h, ruleA);
  c.rect(bandX + bandW - STROKE.hairline * s, 0, STROKE.hairline * s, h, ruleA);

  return fired;
}
