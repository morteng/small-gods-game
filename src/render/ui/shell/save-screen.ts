// src/render/ui/shell/save-screen.ts
//
// The SAVE screen (UI v3 P3b) — four slot tiles the player picks to write the
// live world into. Pure like every shell screen: state in, geometry out,
// actions reported back. It knows nothing about IndexedDB or `Game` — the
// caller (`Game.buildSlotsView`) hands it a prebuilt `SaveScreenView` and
// receives a `SaveAction` to translate into a meta command (`save_slot`,
// `delete_slot`, `close_screen`).
//
// `drawSlotsScreen` below is the shared layout both this module and
// `load-screen.ts` use — the two screens show the same four tiles, differing
// only in which slots are pickable and what picking one means (spec §5.4).

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, SPACING, shellTypeScaleFor } from '@/render/ui/ui-tokens';
import { slotTile } from '@/render/ui/kit/slot-tile';
import type { SaveSlot, SlotCompat } from '@/services/save-store';

/**
 * Everything a slot tile needs to draw, PREBUILT by the caller — the screen
 * never reads a `SaveMeta` row, never calls `slotCompat`, and never formats a
 * tick or a version number itself (the standing "fiction time only, no raw
 * ticks in the UI" rule extends here to version prose too: only `Game` knows
 * the real `SAVE_VERSION`/`WORLD_CONTENT_VERSION` constants).
 */
export interface SlotRow {
  slot: SaveSlot;
  /** Slot name, uppercased by the tile. Meaningless (ignored) when `empty`. */
  name: string;
  /** In-world date, prebuilt — never a raw tick. Empty string when `empty`. */
  dateLabel: string;
  /** God-tier + belief summary line. Empty string when `empty`. */
  tierLine: string;
  /** Real playtime, prebuilt ("2H 15M") — never a raw ms/tick. Empty when `empty`. */
  playtimeLabel: string;
  /** `'ok'` for an empty slot too (there is nothing to be stale) — `empty` is
   *  the field that actually gates the load screen's refusal. */
  compat: SlotCompat;
  /** True when nothing has ever been saved to this slot. */
  empty: boolean;
  /** 320×180 JPEG data URL, or null. UNUSED this slice — decoding it into a
   *  `drawThumb` callback for `slotTile` lands with the thumbnail-render
   *  slice; today every tile shows the tile's default empty well. */
  thumbnail: string | null;
  /** Prose for why `compat !== 'ok'`, with the real version numbers already
   *  interpolated by the caller — null when the slot opens fine. */
  staleReason: string | null;
}

export interface SaveScreenView { rows: SlotRow[] }

export type SaveAction =
  | { kind: 'save'; slot: SaveSlot }
  | { kind: 'delete'; slot: SaveSlot }
  | { kind: 'back' };

/** One row's rendering plan: the widget id, the enable/deletable verdict, and
 *  the reason text (if any) — everything `titleRows` does for the title menu,
 *  just shaped for a tile instead of a button row. Exported so a test can
 *  assert the LOGIC without going through geometry, matching `titleRows`. */
export interface ScreenRow {
  id: string;
  slot: SaveSlot;
  data: SlotRow;
  /** Whether picking this row (save / load) is allowed. */
  enabled: boolean;
  /** Whether the DELETE affordance is offered on this row. */
  deletable: boolean;
  /** Why `enabled` is false, in the player's words — null when it's true (or
   *  when disabled for a reason too obvious to spell out, e.g. see `empty`). */
  reason: string | null;
}

/**
 * The save screen's rows: every slot except `autosave` is a valid save
 * target, empty or not (spec §5.4 — "every slot is a valid target except
 * autosave"). `autosave` is always disabled here — the player must not
 * hand-overwrite the slot the game manages for them.
 */
export function saveRows(view: SaveScreenView): ScreenRow[] {
  return view.rows.map((data): ScreenRow => {
    if (data.slot === 'autosave') {
      return {
        id: `save.${data.slot}`, slot: data.slot, data,
        enabled: false, deletable: !data.empty,
        reason: 'MANAGED AUTOMATICALLY — CANNOT BE HAND-SAVED',
      };
    }
    return {
      id: `save.${data.slot}`, slot: data.slot, data,
      enabled: true, deletable: !data.empty, reason: null,
    };
  });
}

/** The largest INTEGER scale at or below `preferred` at which `text` fits
 *  `maxW` — mirrors `title-screen.ts`'s `fitScale` (pixel-perfect law: no
 *  fractional scales, so a too-wide header steps DOWN a whole rung). */
function fitScale(c: UiContext, text: string, maxW: number, preferred: number): number {
  for (let sc = preferred; sc > 1; sc--) {
    if (c.measure(text, sc) <= maxW) return sc;
  }
  return 1;
}

/** Neutral outcome of a slot-screen frame, before the caller (save or load
 *  wrapper) maps it onto its own typed action — keeps the geometry/layout
 *  code below shared between `drawSaveScreen` and `drawLoadScreen` without
 *  generic gymnastics over two structurally-different action unions. */
export type SlotScreenOutcome =
  | { kind: 'activate'; slot: SaveSlot }
  | { kind: 'delete'; slot: SaveSlot }
  | { kind: 'back' }
  | null;

/**
 * Shared layout for both slot screens: a header, one `slotTile` per row (each
 * followed by its disabled/refusal reason, when it has one and the plan keeps
 * it), and a BACK button. Rows are NEVER dropped — like the title screen, a
 * cramped viewport degrades detail (the reason line, inter-row gaps, tile
 * height) before it would ever let a row's hit region leave the target.
 *
 * `id` prefix distinguishes the two screens' hit regions ("save." / "load.");
 * `rows` is the caller's already-computed `ScreenRow[]` (see `saveRows` /
 * `loadRows`) so this function does no enable/disable logic of its own.
 */
export function drawSlotsScreen(
  c: UiContext, w: number, h: number, s: number,
  headerText: string, rows: ScreenRow[], backId: string,
): SlotScreenOutcome {
  const edge = Math.round(SPACING.lg * s);
  const cx = Math.round(w / 2);
  const colW = Math.round(Math.min(560 * s, Math.max(140, w - edge * 2)));
  const colX = Math.round(cx - colW / 2);

  // Responsive 10-foot type: the header is a heading, slot NAMES and BACK are
  // interactive rows (menu tier); only the date/tier/playtime metadata and
  // refusal notes sit on the caption floor. Drawing the WHOLE tile at caption
  // was the "settings/menus are too small" bug the user reported.
  const T = shellTypeScaleFor(w, s);
  const fsHeader = fitScale(c, headerText, w - edge * 2, T.heading);
  const headerH = c.lineHeight(fsHeader);

  const fsTile = T.menu;
  const fsMeta = T.caption;
  const lhTile = c.lineHeight(fsTile);
  const lhMeta = c.lineHeight(fsMeta);
  const reasonGap = Math.round(SPACING.tight * s);
  const reasonH = reasonGap + lhMeta;

  const backH = Math.round(30 * s);
  const backW = Math.round(Math.min(160 * s, colW));

  interface Plan { reason: boolean; tileH: number; gap: number }
  const tileHFull = Math.round(lhTile + 3 * lhMeta + 2 * SPACING.sm * s);
  const tileHTight = Math.round(lhTile + lhMeta + 2 * SPACING.tight * s);
  const tileHMin = Math.max(Math.round(lhTile + 2 * SPACING.tight * s), 20);
  const gapFull = Math.round(SPACING.sm * s);
  const gapTight = Math.round(SPACING.tight * s);
  const reasonCount = rows.filter((r) => r.reason).length;

  // Degradation ladder, richest first: the refusal/occupied reason lines go
  // first, then the gaps tighten, then the tiles themselves shrink toward a
  // bare clickable strip — mirroring `title-screen.ts`'s plan array exactly.
  const plans: Plan[] = [
    { reason: true, tileH: tileHFull, gap: gapFull },
    { reason: true, tileH: tileHFull, gap: gapTight },
    { reason: false, tileH: tileHFull, gap: gapTight },
    { reason: false, tileH: tileHTight, gap: gapTight },
    { reason: false, tileH: tileHMin, gap: gapTight },
  ];

  const measure = (p: Plan): number =>
    headerH + p.gap
    + rows.length * p.tileH + (rows.length - 1) * p.gap
    + (p.reason ? reasonCount * reasonH : 0)
    + p.gap + backH;

  const budget = h - edge * 2;
  // As with the title screen: if not even the floor plan fits at this UI
  // scale, step the WHOLE screen down an integer scale rung and retry —
  // better a smaller-but-complete screen than rows running off the bottom.
  if (s > 1 && measure(plans[plans.length - 1]) > budget) {
    return drawSlotsScreen(c, w, h, s - 1, headerText, rows, backId);
  }
  const plan = plans.find((p) => measure(p) <= budget) ?? plans[plans.length - 1];
  const columnH = measure(plan);

  let y = Math.max(Math.round(SPACING.lg * s), Math.round((h - columnH) / 2));

  const hw = c.measure(headerText, fsHeader);
  c.label(headerText, Math.round(cx - hw / 2), y, fsHeader, COLOR.ink);
  y += headerH + plan.gap;

  // `slotTile` draws its 4 metadata lines UNCLIPPED (it has no notion of the
  // caller's window width) — its own text column starts exactly `plan.tileH`
  // px in from the tile's left edge (the thumbnail well is square, sized to
  // the tile's height). A long real date/tier string (`calendarLabel`'s
  // "Y1 SPRING · 34/365 · 08:15" style output easily runs 25+ chars) WILL run
  // past the screen edge on a narrow window unless clipped here first.
  const textMaxW = Math.max(10, colW - plan.tileH - Math.round(SPACING.tight * s));
  const fit = (text: string): string => c.ellipsize(text, fsTile, textMaxW);

  let outcome: SlotScreenOutcome = null;
  for (const row of rows) {
    // The tile is ALWAYS drawn+clickable (kit/slot-tile has no disabled
    // concept) — the guard that a disabled row can never fire lives HERE, in
    // the handler, not only in the paint, exactly as `title-screen.ts` does
    // for its rows.
    const clicked = slotTile(c, {
      id: row.id, x: colX, y, w: colW, h: plan.tileH,
      name: row.data.empty ? 'EMPTY SLOT' : fit(row.data.name),
      dateLabel: row.data.empty ? '—' : fit(row.data.dateLabel),
      tierLabel: row.data.empty ? '—' : fit(row.data.tierLine),
      playtimeLabel: row.data.empty ? '—' : fit(row.data.playtimeLabel),
      deletable: row.deletable,
      empty: row.data.empty,
      scale: fsTile,
      metaScale: fsMeta,
      // No `drawThumb` yet — the tile draws its own placeholder (a sigil for a
      // real save with no picture, bare parchment for an empty slot). Decoding
      // `row.data.thumbnail` into a blitted quad lands with the thumbnail-render
      // slice; this screen only reserves the rect for it.
    });
    if (clicked === 'activate' && row.enabled) outcome = { kind: 'activate', slot: row.slot };
    if (clicked === 'delete' && row.deletable) outcome = { kind: 'delete', slot: row.slot };
    y += plan.tileH;

    if (plan.reason && row.reason) {
      const reasonY = y + reasonGap;
      const maxW = colW - 2 * Math.round(SPACING.sm * s);
      const reasonText = c.ellipsize(row.reason.toUpperCase(), fsMeta, maxW);
      c.label(reasonText, colX + Math.round(SPACING.sm * s), reasonY, fsMeta, COLOR.inkDim);
      y = reasonY + lhTile;
    }
    y += plan.gap;
  }

  const backX = Math.round(cx - backW / 2);
  if (c.button(backId, 'BACK', backX, y, backW, backH, { scale: fsTile })) {
    outcome = { kind: 'back' };
  }

  return outcome;
}

/** Paint the save screen. Returns the action the player triggered this frame,
 *  or null — same contract every shell screen follows. */
export function drawSaveScreen(c: UiContext, w: number, h: number, s: number, view: SaveScreenView): SaveAction | null {
  const outcome = drawSlotsScreen(c, w, h, s, 'SAVE WORLD', saveRows(view), 'save.back');
  if (!outcome) return null;
  if (outcome.kind === 'back') return { kind: 'back' };
  if (outcome.kind === 'delete') return { kind: 'delete', slot: outcome.slot };
  return { kind: 'save', slot: outcome.slot };
}
