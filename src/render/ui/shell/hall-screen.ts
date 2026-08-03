// src/render/ui/shell/hall-screen.ts
//
// THE HALL OF THE GODS (Phase C, slice H2) — the skill screen, staged as the
// divine realm above the clouds the title/loading/quit transitions already
// establish. One PEDESTAL per belief domain, each a vertical node ladder
// carrying the CLAIM → COMMAND → DOCTRINE ripening (belief-powers spec §3)
// with Skyrim's at-a-glance path readability — the STRUCTURE, not the skin.
//
// DESIGN STANCE (do not drift): Skyrim levels by DOING; we level by BEING
// BELIEVED. The hall is an OBSERVATORY of follower belief, never a point shop.
// Nothing here spends, buys or unlocks anything — the sim is truth and this
// screen makes it legible. The one interactive concession is CAST ⚡ on an
// unlocked pedestal, which closes the hall and arms the existing reticle: the
// same verb path the POWERS panel button uses, so a click and an agent's
// `emit_command` are one path.
//
// Pure like every shell screen: state in, geometry out, action reported back.
// It knows nothing of `Game`, the projection or the sim — the host hands it a
// `HallView` whose prose is ALREADY BUILT (no raw ticks; 0..1 fractions only
// for bars) and receives a `HallAction`.
//
// Two structural notes worth knowing before editing:
//
//   1. NO NEW BATCHER PRIMITIVE. `ui-batcher.ts` has axis-aligned quads only —
//      no line(), no rotated quad. The ladder spines are therefore plain
//      `rect` segments and the glyphs (`◎` reached / `🔒` dormant) are marks
//      ON that spine, never connective tissue. Every glyph used here must
//      exist in the pixel font's `G` table (guard:
//      `tests/unit/ui-pixel-font.test.ts` covers this file automatically).
//
//   2. OVERFLOW SCROLLS, IT NEVER SHRINKS. Pedestals lay out as COLUMNS across
//      the width. `UiContext` has exactly one scroll primitive and it is
//      VERTICAL (`scrollList`), so N pedestals wrap into a GRID of columns and
//      the grid's ROWS are what scrolls — the plan's "horizontal scrollList"
//      does not exist as a primitive and inventing one was explicitly out of
//      scope for this slice. The visible result is the same promise: nothing
//      below the caption tier, nothing clipped mid-row, and every pedestal
//      reachable by scrolling (pinned by the hit-id union test). With today's
//      two domains it is one row and nothing scrolls at all.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, SPACING, STROKE, shellTypeScaleFor } from '@/render/ui/ui-tokens';
import { withAlpha, type Rgba } from '@/render/ui/ui-color';
import { wrapLines } from '@/render/ui/shell/text-layout';
import { clamp01 } from '@/core/math';

// ── the view (frozen contract with the H1 projection — do not rename) ────────

/** A ripening node on a pedestal's ladder. Prose is PREBUILT by the host. */
export interface HallNodeView {
  tier: 'claim' | 'command' | 'doctrine';
  /** Short mark label, e.g. 'CLAIM'. */
  label: string;
  reached: boolean;
  /** One line of what this node MEANS, prebuilt. */
  hint: string;
}

export interface HallPedestalView {
  domain: string;
  /** Player-facing domain name (the screen uppercases for display). */
  label: string;
  blurb: string;
  /** The capability verb CAST arms. */
  verb: string;
  /** 0..1 fractions for the conviction bar + its threshold tick. */
  conviction: number;
  threshold: number;
  /** clamp01(conviction / threshold) — the materialization ramp (plan §1.7). */
  materialize: number;
  tier: 'dormant' | 'claim' | 'command' | 'doctrine';
  unlocked: boolean;
  /** Prebuilt, e.g. 'BELIEVED BY 12 — REACH 5'. Never a raw tick. */
  reachLine: string;
  /** 0..1 bars. */
  dimensions: { faith: number; understanding: number; devotion: number };
  /** Prebuilt "what would ripen this next" prose. */
  nextHint: string;
  /** Exactly three, in ladder order claim → command → doctrine. */
  nodes: readonly HallNodeView[];
  /** Non-null ⇒ CAST is refused, with the reason to show/report. */
  castBlocked: string | null;
}

export interface HallView {
  spirit: {
    name: string;
    /** Prebuilt, e.g. 'A SMALL GOD'. */
    tierLine: string;
    /** Prebuilt, e.g. 'BELIEF ENOUGH FOR A HAMLET'. */
    massLine: string;
    /** Prebuilt intimacy prose. */
    intimacyLine: string;
    /** 0..1 for the intimacy bar. */
    intimacy: number;
    faded: boolean;
    /** Canon line when faded ('ONLY WHISPERS REMAIN'), else null. */
    fadedLine: string | null;
  };
  pedestals: readonly HallPedestalView[];
  /** Non-null ⇒ the honest empty state caption (no world, or no believers). */
  emptyLine: string | null;
}

export type HallAction =
  | { kind: 'back' }
  | { kind: 'select'; domain: string }
  | { kind: 'cast'; verb: string };

export interface HallRow {
  id: string;
  label: string;
  action: HallAction;
  enabled: boolean;
  /** Refusal reason when `!enabled` — surfaces as `ShellChoice.note`. */
  reason: string | null;
}

// ── fixed strings + marks ───────────────────────────────────────────────────

const HEADER = 'HALL OF THE GODS';
/** The same verb+glyph the POWERS panel casts with — one label, one path. */
const CAST_LABEL = 'CAST ⚡';
const BACK_LABEL = 'BACK';
/** Canon (VISION tenet 6) — the fallback when the host supplied no line but
 *  did report `faded`. A faded god keeps ONLY its whisper, so nothing in the
 *  hall can be cast; the screen states that rather than showing live buttons. */
const FADED_REASON = 'ONLY WHISPERS REMAIN';
/** Reached / dormant ladder marks. Both in the pixel font's `G` table. */
const MARK_REACHED = '◎';
const MARK_DORMANT = '🔒';
/** Pedestal glyph: the wieldable power vs. the promise of one. */
const GLYPH_UNLOCKED = '⚡';
const GLYPH_DORMANT = '✦';
/** The three belief dimensions, in the order the detail pane bars them. */
const DIMENSION_LABELS = ['FAITH', 'UNDERSTANDING', 'DEVOTION'] as const;
/** Empty state: the hall STANDS even with no world — this many hazy, hitless
 *  niches so it reads as "nothing is believed yet", not as a broken screen. */
const GHOST_PEDESTALS = 2;

/**
 * The empty niche's paint. It used to be a spine at 0.10 and a plinth at 0.12,
 * which on the bright sky backdrop came out as two hairline scratches — FAINTER
 * than a real but fully dormant pedestal (spine 0.18, plinth 0.15), so a hall
 * with nothing in it read as a rendering failure rather than as an empty hall.
 *
 * A ghost must stay QUIETER than the dormant real thing (it is a niche, not a
 * power) while still reading as architecture, so the weights sit just under the
 * dormant ones and the presence comes from a `BODY` fill instead — mass rather
 * than brightness. That keeps the contract in `drawColumn` intact: no glyph, no
 * label, nothing to click.
 */
const GHOST_BODY = 0.05;
const GHOST_SPINE = 0.15;
const GHOST_PLINTH = 0.14;

// ── rows (the single source of enable/reason) ────────────────────────────────

/**
 * The pure row/enable logic `Shell.describe()` walks and `drawHallScreen`
 * paints. A function of the VIEW ALONE — selection is presentation, so it must
 * not change the offered choices: CAST is offered on EVERY pedestal, not only
 * the selected one, so a click and an agent's `emit_command` see the identical
 * row set. Ids: `hall.select.<domain>`, `hall.cast.<domain>`, `hall.back`.
 *
 * A faded god's refusal wins over a per-pedestal one: `castBlocked` says "this
 * domain is not ripe", while `faded` says "nothing at all can be cast" — the
 * larger truth is the one to report.
 */
export function hallRows(view: HallView): readonly HallRow[] {
  const rows: HallRow[] = [];
  const faded = view.spirit.faded;
  const fadedReason = view.spirit.fadedLine ?? FADED_REASON;
  for (const p of view.pedestals) {
    const label = p.label.toUpperCase();
    rows.push({
      id: `hall.select.${p.domain}`,
      label,
      action: { kind: 'select', domain: p.domain },
      enabled: true,
      reason: null,
    });
    const reason = faded ? fadedReason : p.castBlocked;
    rows.push({
      id: `hall.cast.${p.domain}`,
      label: `${CAST_LABEL} — ${label}`,
      action: { kind: 'cast', verb: p.verb },
      enabled: reason === null,
      reason,
    });
  }
  rows.push({ id: 'hall.back', label: BACK_LABEL, action: { kind: 'back' }, enabled: true, reason: null });
  return rows;
}

// ── small local paint helpers ───────────────────────────────────────────────

/** The largest INTEGER scale at or below `preferred` at which `text` fits
 *  `maxW` — the same `fitScale` every other shell screen keeps a copy of
 *  (pixel-perfect law: no fractional scales). */
function fitScale(c: UiContext, text: string, maxW: number, preferred: number): number {
  for (let sc = preferred; sc > 1; sc--) {
    if (c.measure(text, sc) <= maxW) return sc;
  }
  return 1;
}

/** A hollow rectangle as four axis-aligned rects — the batcher has no stroke
 *  primitive and `c.panel` paints the legacy gray-box palette. */
function outline(c: UiContext, x: number, y: number, w: number, h: number, t: number, color: Rgba): void {
  c.rect(x, y, w, t, color);
  c.rect(x, y + h - t, w, t, color);
  c.rect(x, y, t, h, color);
  c.rect(x + w - t, y, t, h, color);
}

/** A 0..1 meter: sunken track plus fill. Shared by the intimacy bar, the
 *  conviction bar and the detail pane's dimension bars so all four read as one
 *  grammar (the `drawPowers` grammar this screen inherits). */
function meter(c: UiContext, x: number, y: number, w: number, h: number, value: number, fill: Rgba): void {
  c.rect(x, y, w, h, withAlpha(COLOR.ink, 0.6));
  const v = clamp01(value);
  if (v > 0) c.rect(x, y, Math.max(1, Math.round(w * v)), h, fill);
}

// ── the screen ──────────────────────────────────────────────────────────────

/** The degradation ladder's rungs (richest first). `nodeLabels` is NOT a rung:
 *  the ladder's text labels are dropped by a WIDTH FIT test instead (see
 *  `nodeLabels` below), because they cost width, not height.
 *
 *  `pane` has a middle rung on purpose: the selected pedestal's NUMBERS (reach,
 *  the three dimension bars, what would ripen it next) are the point of
 *  selecting it, so the flavour blurb goes a full rung before they do. Dropping
 *  the pane outright is the last thing this screen gives up before the header. */
interface Plan {
  header: boolean;
  strip: 'full' | 'compact';
  pane: 'full' | 'compact' | 'none';
  gap: number;
}

/**
 * Paint the hall. Returns the action the player triggered this frame, or null.
 *
 * LAYOUT IS MEASURED BEFORE IT IS PLACED, the same discipline as
 * `title-screen.ts`/`settings-screen.ts`: a degradation ladder drops the
 * detail pane, then compacts the spirit strip, then drops the header before
 * the WHOLE screen steps down an integer UI-scale rung. Nothing ever renders
 * below the caption tier — the pedestal grid scrolls instead.
 *
 * `selectedDomain` is Shell-local presentation state (`Shell.hallDomain`, the
 * `settingsTab` precedent). It only adds the detail pane; it never changes
 * which rows exist (see `hallRows`).
 */
export function drawHallScreen(
  c: UiContext, w: number, h: number, s: number,
  view: HallView, selectedDomain: string | null,
): HallAction | null {
  // ── type first, then every metric from it ──────────────────────────────
  const T = shellTypeScaleFor(w, s);
  const edge = Math.round(SPACING.lg * s);
  const cx = Math.round(w / 2);
  const tight = Math.round(SPACING.tight * s);
  const inset = Math.round(SPACING.md * s);
  const pad = Math.round(SPACING.md * s);
  const lhMenu = c.lineHeight(T.menu);
  const lhCaption = c.lineHeight(T.caption);
  const contentW = Math.max(40, w - edge * 2);
  const barH = Math.max(4, Math.round(6 * s));
  const spineW = Math.max(2, Math.round(STROKE.focus * s));
  const hair = Math.max(1, Math.round(STROKE.hairline * s));

  const rows = hallRows(view);
  const enabledById = new Map(rows.map((r) => [r.id, r.enabled] as const));

  // ── pedestal COLUMN metrics (content-derived; never a bare px constant) ──
  const castW = c.buttonWidth(CAST_LABEL, T.menu);
  const markW = Math.ceil(c.measure(MARK_DORMANT, T.menu));
  let widestNodeLabel = 0;
  let widestColContent = castW;
  for (const p of view.pedestals) {
    widestColContent = Math.max(
      widestColContent,
      Math.ceil(c.measure(`${GLYPH_UNLOCKED} ${p.label.toUpperCase()}`, T.menu)),
    );
    for (const n of p.nodes) {
      widestNodeLabel = Math.max(widestNodeLabel, Math.ceil(c.measure(n.label.toUpperCase(), T.caption)));
    }
  }
  const laddedW = markW + tight + widestNodeLabel;
  const naturalColW = Math.max(Math.round(180 * s), widestColContent, laddedW) + inset * 2;
  const colW = Math.min(contentW, naturalColW);
  // The ladder's text labels are the first thing width costs us: they are drawn
  // only when the column is wide enough to hold mark + label without clipping.
  // A clamped (too-narrow) column shows a glyph-only ladder — dimmer detail,
  // never smaller type.
  const nodeLabels = widestNodeLabel > 0 && colW >= laddedW + inset * 2;

  const gutter = Math.round(SPACING.lg * s);
  const slots = view.pedestals.length > 0 ? view.pedestals.length : GHOST_PEDESTALS;
  const fitCols = Math.max(1, Math.floor((contentW + gutter) / (colW + gutter)));
  const cols = Math.max(1, Math.min(fitCols, slots));
  const gridRows = Math.ceil(slots / cols);
  const bandW = cols * colW + (cols - 1) * gutter;
  const bandCenteredX = Math.round(cx - bandW / 2);

  const nodeH = Math.max(lhMenu, lhCaption);
  const spineH = Math.round(SPACING.md * s);
  const plinthH = Math.max(4, Math.round(8 * s));
  const baseH = plinthH + tight + lhMenu;
  const castH = Math.max(Math.round(30 * s), c.buttonHeight(T.menu));
  const barBlockH = tight + barH + tight;
  const columnH = 3 * nodeH + 3 * spineH + baseH + barBlockH + castH;
  /** The column's SELECT region: everything above CAST, so the two hit regions
   *  never overlap (a click can only ever mean one of them). */
  const selectH = columnH - castH;

  // ── the spirit strip + header + the selected pedestal's detail pane ──────
  const fsHeader = fitScale(c, HEADER, contentW, T.heading);
  const headerH = c.lineHeight(fsHeader);
  const faded = view.spirit.faded;
  const fadedLine = faded ? (view.spirit.fadedLine ?? FADED_REASON) : null;
  const stripFullH = lhMenu + tight + lhCaption + tight + barH + tight + lhCaption
    + (fadedLine ? tight + lhCaption : 0);
  const stripCompactH = lhMenu + tight + lhCaption + (fadedLine ? tight + lhCaption : 0);

  const sel = selectedDomain === null
    ? null
    : (view.pedestals.find((p) => p.domain === selectedDomain) ?? null);
  let dimLabelW = 0;
  for (const d of DIMENSION_LABELS) dimLabelW = Math.max(dimLabelW, Math.ceil(c.measure(d, T.caption)));
  // WHERE the detail pane goes is a WIDTH decision, and it matters: stacked
  // BELOW the band it costs height the 10-foot type has none of (at 1080p the
  // stacked pane cost the header AND the full spirit strip), while BESIDE the
  // band it costs nothing vertical at all. So it sits beside the pedestals
  // whenever the leftover width can hold it, and stacks under them otherwise
  // (tall/narrow windows, or a band already using the full width).
  const dimNeedW = pad * 2 + dimLabelW + inset + Math.round(80 * s);
  const sideRoom = contentW - bandW - gutter;
  const sidePaneW = Math.min(sideRoom, Math.max(Math.round(420 * s), dimNeedW));
  const sideBySide = sel !== null && sideRoom >= Math.max(dimNeedW, Math.round(300 * s));
  const paneW = sideBySide ? sidePaneW : Math.min(contentW, Math.max(Math.round(420 * s), bandW));
  // Beside the band, the band + pane are centred as ONE group; stacked, both are
  // centred on their own.
  const bandX = sideBySide ? Math.round(cx - (bandW + gutter + paneW) / 2) : bandCenteredX;
  const paneX = sideBySide ? bandX + bandW + gutter : Math.round(cx - paneW / 2);
  const paneInnerW = Math.max(20, paneW - pad * 2);
  const blurbLines = sel ? wrapLines(sel.blurb.toUpperCase(), paneInnerW, T.caption, (t, sc) => c.measure(t, sc)) : [];
  const hintLines = sel ? wrapLines(sel.nextHint.toUpperCase(), paneInnerW, T.caption, (t, sc) => c.measure(t, sc)) : [];
  const dimRowH = Math.max(lhCaption, barH) + tight;
  // The pane's numbers (reach + the three dimension bars + the next-node hint)
  // are its FLOOR; the blurb and a multi-line hint are what the compact rung
  // gives up.
  const paneNumbersH = pad * 2 + lhCaption + tight + DIMENSION_LABELS.length * dimRowH + tight;
  const paneCompactH = sel ? paneNumbersH + lhCaption : 0;
  const paneFullH = sel
    ? paneNumbersH
      + (blurbLines.length ? blurbLines.length * lhCaption + tight : 0)
      + hintLines.length * lhCaption
    : 0;
  const paneHeightFor = (mode: Plan['pane']): number =>
    mode === 'full' ? paneFullH : mode === 'compact' ? paneCompactH : 0;

  const backH = Math.max(Math.round(30 * s), c.buttonHeight(T.menu));
  const backW = Math.min(contentW, Math.max(Math.round(200 * s), c.buttonWidth(BACK_LABEL, T.menu)));

  // ── measure, then choose how much detail fits ────────────────────────────
  // The band's term is ONE grid row: the band itself STRETCHES to whatever is
  // left between the strip and the bottom-anchored pane/BACK, and a
  // `scrollList` only draws rows that FULLY fit — which is what actually
  // guarantees this screen can never overflow, however cramped the viewport.
  const measure = (p: Plan): number =>
    (p.header ? headerH + p.gap : 0)
    + (p.strip === 'full' ? stripFullH : stripCompactH)
    + (view.emptyLine ? p.gap + lhCaption : 0)
    + p.gap + columnH
    // A side-by-side pane contributes NO height — it lives in the band's own
    // vertical region (see `sideBySide`).
    + (sel && !sideBySide && p.pane !== 'none' ? p.gap + paneHeightFor(p.pane) : 0)
    + p.gap + backH;

  const gapFull = Math.round(SPACING.md * s);
  const gapTight = Math.round(SPACING.tight * s);
  const plans: Plan[] = [
    { header: true, strip: 'full', pane: 'full', gap: gapFull },
    { header: true, strip: 'full', pane: 'full', gap: gapTight },
    { header: true, strip: 'compact', pane: 'full', gap: gapTight },
    { header: true, strip: 'compact', pane: 'compact', gap: gapTight },
    { header: false, strip: 'compact', pane: 'compact', gap: gapTight },
    { header: false, strip: 'compact', pane: 'none', gap: gapTight },
  ];
  const budget = h - edge * 2;
  // Not even the floor plan fits at this UI scale ⇒ step the WHOLE screen down
  // an integer rung and retry, BEFORE anything is drawn (so the failed attempt
  // leaves no geometry behind). Terminates at s === 1.
  if (s > 1 && measure(plans[plans.length - 1]) > budget) {
    return drawHallScreen(c, w, h, s - 1, view, selectedDomain);
  }
  const plan = plans.find((p) => measure(p) <= budget) ?? plans[plans.length - 1];

  // ── paint ────────────────────────────────────────────────────────────────
  // The hall sits ABOVE THE CLOUDS: a scrim, not an opaque page. In world mode
  // the sky overlay behind it is what occludes the running world (H4's coverage
  // ramp); in meta mode the meta sky IS the backdrop.
  c.rect(0, 0, w, h, withAlpha(COLOR.ink, 0.5));

  let fired: HallAction | null = null;
  let y = Math.max(edge, Math.round((h - measure(plan)) / 2));

  if (plan.header) {
    c.labelCentered(c.ellipsize(HEADER, fsHeader, contentW), cx, y, fsHeader, COLOR.parchment);
    y += headerH + plan.gap;
  }

  // ── spirit strip: who is being believed in, and how much ─────────────────
  c.labelCentered(
    c.ellipsize(view.spirit.name.toUpperCase(), T.menu, contentW),
    cx, y, T.menu, COLOR.parchment,
  );
  y += lhMenu + tight;
  const tierMass = view.spirit.massLine
    ? `${view.spirit.tierLine.toUpperCase()} · ${view.spirit.massLine.toUpperCase()}`
    : view.spirit.tierLine.toUpperCase();
  c.labelCentered(c.ellipsize(tierMass, T.caption, contentW), cx, y, T.caption, COLOR.goldDim);
  y += lhCaption;
  if (plan.strip === 'full') {
    y += tight;
    const imW = Math.min(contentW, Math.round(320 * s));
    meter(c, Math.round(cx - imW / 2), y, imW, barH, view.spirit.intimacy, COLOR.goldDim);
    y += barH + tight;
    c.labelCentered(
      c.ellipsize(view.spirit.intimacyLine.toUpperCase(), T.caption, contentW),
      cx, y, T.caption, withAlpha(COLOR.parchment, 0.7),
    );
    y += lhCaption;
  }
  if (fadedLine) {
    y += tight;
    // Canon, not a failure notice — and the reason every CAST below is refused.
    c.labelCentered(c.ellipsize(fadedLine.toUpperCase(), T.caption, contentW), cx, y, T.caption, COLOR.gold);
    y += lhCaption;
  }

  if (view.emptyLine) {
    y += plan.gap;
    c.labelCentered(
      c.ellipsize(view.emptyLine.toUpperCase(), T.caption, contentW),
      cx, y, T.caption, withAlpha(COLOR.parchment, 0.7),
    );
    y += lhCaption;
  }

  // ── bottom anchors: BACK, then the detail pane above it ──────────────────
  const bandY = y + plan.gap;
  const backY = h - edge - backH;
  // A pane that does not fit its region would draw off the screen — step it
  // down (full → compact → dropped) rather than overflow. The measure ladder
  // normally settles this; this is the geometry backstop for the cases it
  // cannot (a side-by-side pane, whose height the ladder never measured; an
  // emptyLine plus a header on a very short viewport).
  const roomForPane = sideBySide
    ? backY - plan.gap - bandY          // the band's own region, beside the columns
    : backY - plan.gap - bandY - plan.gap; // stacked: what is left under the band
  let paneMode: Plan['pane'] = sel ? plan.pane : 'none';
  while (paneMode !== 'none' && paneHeightFor(paneMode) > roomForPane) {
    paneMode = paneMode === 'full' ? 'compact' : 'none';
  }
  const paneH = paneHeightFor(paneMode);
  const showPane = paneMode !== 'none';
  const paneY = sideBySide || !showPane ? bandY : backY - plan.gap - paneH;
  // The band keeps its full region when the pane sits beside it.
  const bandH = Math.max(0, (sideBySide || !showPane ? backY - plan.gap : paneY - plan.gap) - bandY);

  // ── the pedestal grid ────────────────────────────────────────────────────
  const drawColumn = (idx: number, colX: number, colY: number): void => {
    const p = view.pedestals[idx] as HallPedestalView | undefined;
    const centerX = colX + Math.round(colW / 2);
    const spineX = nodeLabels ? colX + inset + Math.round(markW / 2) : centerX;
    const isSel = p !== undefined && p.domain === selectedDomain;

    if (isSel) {
      c.rect(colX, colY, colW, columnH, withAlpha(COLOR.parchment, 0.07));
      outline(c, colX, colY, colW, columnH, hair, withAlpha(COLOR.gold, 0.45));
    }

    // An empty hall still STANDS: a hazy, hitless niche (no glyph, no label,
    // nothing to click) rather than a blank band.
    if (p === undefined) {
      // The niche BODY first, so the spine and plinth read as parts of a recess
      // rather than as two loose scratches on the sky (see GHOST_BODY). It stops
      // at the plinth's underside — `columnH` also spans the name row a real
      // pedestal writes below its plinth, and a ghost has no name, so filling the
      // whole column would hang the recess below its own floor.
      const ladderH = 3 * (nodeH + spineH);
      c.rect(colX + inset, colY, colW - inset * 2, ladderH + plinthH, withAlpha(COLOR.parchment, GHOST_BODY));
      let gy = colY;
      for (let k = 0; k < 3; k++) {
        c.rect(spineX - Math.round(spineW / 2), gy + nodeH, spineW, spineH, withAlpha(COLOR.parchment, GHOST_SPINE));
        gy += nodeH + spineH;
      }
      c.rect(colX + inset, gy, colW - inset * 2, plinthH, withAlpha(COLOR.parchment, GHOST_PLINTH));
      return;
    }

    // Materialization is a PAINT RAMP, not state (plan §1.7): hazy silhouette →
    // solid lit marble as conviction approaches the unlock bar. It drives the
    // plinth fill and the name's ink below; nothing about it is persisted, and
    // it walks BACKWARD when belief decays (conviction is non-monotonic).
    const mat = clamp01(p.materialize);

    // ── the ladder: DOCTRINE at the top, CLAIM at the base ────────────────
    // Drawn top-down, so the view's claim → command → doctrine order reverses.
    let ny = colY;
    for (let k = p.nodes.length - 1; k >= 0; k--) {
      const n = p.nodes[k];
      const mark = n.reached ? MARK_REACHED : MARK_DORMANT;
      const markColor = n.reached ? COLOR.gold : withAlpha(COLOR.parchment, 0.3);
      c.label(mark, spineX - Math.round(markW / 2), ny + Math.round((nodeH - lhMenu) / 2), T.menu, markColor);
      if (nodeLabels) {
        const lx = spineX + Math.round(markW / 2) + tight;
        const lw = Math.max(8, colX + colW - inset - lx);
        c.label(
          c.ellipsize(n.label.toUpperCase(), T.caption, lw),
          lx, ny + Math.round((nodeH - lhCaption) / 2), T.caption,
          n.reached ? withAlpha(COLOR.parchment, 0.9) : withAlpha(COLOR.parchment, 0.45),
        );
      }
      ny += nodeH;
      // The spine descending FROM this node — lit when the node above it is
      // reached, so the path reads at a glance (the Skyrim property).
      c.rect(
        spineX - Math.round(spineW / 2), ny, spineW, spineH,
        n.reached ? withAlpha(COLOR.gold, 0.4) : withAlpha(COLOR.parchment, 0.18),
      );
      ny += spineH;
    }

    // ── the pedestal itself: plinth + glyph + name ─────────────────────────
    const plinthX = colX + inset;
    const plinthW = colW - inset * 2;
    if (p.tier === 'doctrine') {
      // DOCTRINE's gold glow — the only place the accent spreads past a mark,
      // and it means "this belief now sustains itself".
      c.rect(plinthX - tight, ny - tight, plinthW + tight * 2, plinthH + tight * 2, withAlpha(COLOR.gold, 0.22));
    }
    c.rect(plinthX, ny, plinthW, plinthH, withAlpha(COLOR.parchment, 0.15 + 0.55 * mat));
    ny += plinthH + tight;
    const nameText = `${p.unlocked ? GLYPH_UNLOCKED : GLYPH_DORMANT} ${p.label.toUpperCase()}`;
    c.labelCentered(
      c.ellipsize(nameText, T.menu, plinthW), centerX, ny, T.menu,
      withAlpha(COLOR.parchment, 0.5 + 0.5 * mat),
    );
    ny += lhMenu;

    // ── conviction bar + threshold tick (the `drawPowers` grammar) ─────────
    ny += tight;
    meter(c, plinthX, ny, plinthW, barH, p.conviction, p.unlocked ? COLOR.gold : COLOR.goldDim);
    const tickOver = Math.min(tight, Math.max(1, Math.round(2 * s)));
    const tickX = plinthX + Math.round(plinthW * clamp01(p.threshold));
    c.rect(
      Math.min(tickX, plinthX + plinthW - Math.max(1, Math.round(s))),
      ny - tickOver, Math.max(1, Math.round(s)), barH + tickOver * 2,
      withAlpha(COLOR.parchment, 0.85),
    );
    ny += barH + tight;

    // ── the two hit regions ───────────────────────────────────────────────
    // SELECT is the whole column above CAST — chrome-less, because the column
    // IS its own affordance. Registered before CAST so the two never fight
    // over one click (they do not overlap either).
    if (c.hotspot(`hall.select.${p.domain}`, colX, colY, colW, selectH)) {
      fired = { kind: 'select', domain: p.domain };
    }
    const castId = `hall.cast.${p.domain}`;
    const castOk = enabledById.get(castId) ?? false;
    const clicked = c.button(castId, CAST_LABEL, plinthX, ny, plinthW, castH, {
      scale: T.menu, disabled: !castOk,
    });
    // The disabled guard lives HERE, in the handler — never only in the paint —
    // so a mis-routed click or a gamepad activate cannot cast a locked power.
    if (clicked && castOk) fired = { kind: 'cast', verb: p.verb };
  };

  c.scrollList(
    'hall.pedestals', { x: bandX, y: bandY, w: bandW, h: bandH }, columnH, gridRows,
    (i, rowY) => {
      for (let k = 0; k < cols; k++) {
        const idx = i * cols + k;
        if (idx >= slots) break;
        drawColumn(idx, bandX + k * (colW + gutter), rowY);
      }
    },
    T.caption, // overflow marks ride the caption tier, never below the floor
  );

  // ── the selected pedestal's detail pane ──────────────────────────────────
  if (showPane && sel) {
    c.rect(paneX, paneY, paneW, paneH, withAlpha(COLOR.ink, 0.55));
    outline(c, paneX, paneY, paneW, paneH, hair, withAlpha(COLOR.gold, 0.3));
    let py = paneY + pad;
    const textX = paneX + pad;
    // The blurb is flavour — the compact rung drops it and keeps the numbers.
    if (paneMode === 'full' && blurbLines.length) {
      for (const line of blurbLines) {
        c.label(c.ellipsize(line, T.caption, paneInnerW), textX, py, T.caption, withAlpha(COLOR.parchment, 0.85));
        py += lhCaption;
      }
      py += tight;
    }
    c.label(c.ellipsize(sel.reachLine.toUpperCase(), T.caption, paneInnerW), textX, py, T.caption, COLOR.goldDim);
    py += lhCaption + tight;

    const dims = [sel.dimensions.faith, sel.dimensions.understanding, sel.dimensions.devotion];
    let dimLabelW = 0;
    for (const d of DIMENSION_LABELS) dimLabelW = Math.max(dimLabelW, Math.ceil(c.measure(d, T.caption)));
    const dimBarX = textX + dimLabelW + inset;
    const dimBarW = Math.max(8, paneX + paneW - pad - dimBarX);
    DIMENSION_LABELS.forEach((label, i) => {
      c.label(label, textX, py, T.caption, withAlpha(COLOR.parchment, 0.7));
      meter(c, dimBarX, py + Math.round((lhCaption - barH) / 2), dimBarW, barH, dims[i], COLOR.goldDim);
      py += dimRowH;
    });
    py += tight;
    // The next-node hint always survives (it is the only "what would ripen
    // this" prose on the screen) — the compact rung clips it to ONE line
    // rather than dropping it.
    // Clipped with an explicit '…' rather than silently cut after its first
    // wrapped line — a half sentence with no mark reads as a bug, not a hint.
    const hint = paneMode === 'full'
      ? hintLines
      : sel.nextHint ? [c.ellipsize(sel.nextHint.toUpperCase(), T.caption, paneInnerW)] : [];
    for (const line of hint) {
      c.label(c.ellipsize(line, T.caption, paneInnerW), textX, py, T.caption, withAlpha(COLOR.parchment, 0.7));
      py += lhCaption;
    }
  }

  if (c.button('hall.back', BACK_LABEL, Math.round(cx - backW / 2), backY, backW, backH, { scale: T.menu })) {
    fired = { kind: 'back' };
  }

  return fired;
}
