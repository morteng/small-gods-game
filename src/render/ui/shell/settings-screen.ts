// src/render/ui/shell/settings-screen.ts
//
// The SETTINGS screen (UI v3 P4b) — a tabbed screen over `settings-store`. Pure
// like every shell screen: state in, geometry out, actions reported back. It
// knows nothing about `Game` or `settings-store` itself — the caller
// (`Game.buildSettingsView`) hands it a prebuilt `SettingsScreenView` and
// receives a `SettingsAction` to translate into either a direct Shell-local
// tab switch or a `set_setting`/`close_screen` meta command (see `shell.ts`
// and `Game`'s `onSettingsAction` hook).
//
// Four tabs (spec §6): AUDIO and VIDEO are plain toggle/slider rows read
// straight off the view; GAMEPLAY reserves a DOM-island rect for the existing
// provider/model/key form (`SettingsIsland`, `ui-settings-island.ts`) — the
// SAME reserved-rect contract `drawMenu`'s settings panel already uses, not a
// new island class; CONTROLS is READ-ONLY this slice (P5 does rebinding) — it
// lists the current key bindings as `kit/key-chip` chips, sourced from a
// placeholder constant IN THIS FILE (there is no `src/game/input/keymap.ts`
// yet). That constant is marked below for wholesale deletion once P5's real
// keymap module lands.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS, SPACING } from '@/render/ui/ui-tokens';
import { toggle, slider, tabbar, keyChip, type TabDef, type Rect } from '@/render/ui/kit';
import { clamp01 } from '@/core/math';
import type { Settings } from '@/services/settings-store';

/** The four settings tabs, in display order. */
export type SettingsTab = 'audio' | 'video' | 'gameplay' | 'controls';

/** Every settings key this screen can `set`, restricted to real `Settings`
 *  fields — a typo (or a future rename in `settings-store.ts`) is a compile
 *  error here, not a silently-dropped bus command. */
export type SettingsKey = keyof Pick<
  Settings,
  'musicOn' | 'musicVolume' | 'sfxOn' | 'sfxVolume' | 'voiceOn' | 'halfResWater' | 'uiScale' | 'lighting'
>;

/**
 * Everything the AUDIO/VIDEO rows need, PREBUILT by the caller — the screen
 * never reads `settings-store` itself. `tab` is the SHELL's own local view
 * state (which tab is selected), not game state; `Shell` overwrites whatever
 * this field the caller supplies with its own (see `shell.ts`'s
 * `buildSettingsView`), so a caller may leave it at any value.
 *
 * `lighting`/`halfResWater` are booleans here even though `settings-store`
 * persists `lighting` as a 0/1 number — the caller resolves that (`Game`
 * reads the live `devMode.lighting` toggle, which is fundamentally binary).
 * `uiScale` is the real 1..3 integer rung, not a normalized slider fraction.
 */
export interface SettingsScreenView {
  tab: SettingsTab;
  musicOn: boolean;
  musicVolume: number;
  sfxOn: boolean;
  sfxVolume: number;
  voiceOn: boolean;
  halfResWater: boolean;
  uiScale: number;
  lighting: boolean;
}

/** What the player asked for. `set` carries the NEW value the widget produced
 *  (already flipped/moved) — the caller writes it, never toggles/adds a delta
 *  itself. `tab` is Shell-local UI state; `back` closes the screen. */
export type SettingsAction =
  | { kind: 'set'; key: SettingsKey; value: boolean | number }
  | { kind: 'tab'; tab: SettingsTab }
  | { kind: 'back' };

/** Paired with `island`: a settings-screen frame reserves a DOM rect on the
 *  GAMEPLAY tab regardless of whether an action fired, so the form stays
 *  positioned every frame it's visible — unlike the other shell screens,
 *  this one can't collapse to a single `Action | null` return. */
export interface SettingsDrawResult {
  action: SettingsAction | null;
  island: Rect | null;
}

export const SETTINGS_TABS: readonly TabDef[] = [
  { id: 'audio', label: 'AUDIO' },
  { id: 'video', label: 'VIDEO' },
  { id: 'gameplay', label: 'GAMEPLAY' },
  { id: 'controls', label: 'CONTROLS' },
];

/** One row's rendering plan for the AUDIO/VIDEO tabs. Exported so a test can
 *  assert the row LOGIC without going through geometry (matches `titleRows`/
 *  `saveRows`), and so `shell.ts`'s `describe()` can enumerate the SAME rows
 *  the draw path walks. */
export interface SettingsRow {
  id: string;
  key: SettingsKey;
  label: string;
  kind: 'toggle' | 'slider';
  /** The row's CURRENT value in native units — a plain 0/1 boolean for a
   *  toggle, 0..1 for a volume slider, or the real 1..3 rung for `uiScale`
   *  (never a normalized slider fraction; the draw path converts that itself). */
  value: boolean | number;
}

/**
 * The rows for one tab. GAMEPLAY (the DOM island) and CONTROLS (read-only
 * key-chips) own their own layout and contribute no `set`-able rows — an
 * empty array here, matched by zero hit regions there, keeps `describe()`
 * and the draw path in lockstep for every tab.
 */
export function settingsRows(view: SettingsScreenView, tab: SettingsTab = view.tab): SettingsRow[] {
  if (tab === 'audio') {
    return [
      { id: 'settings.musicOn', key: 'musicOn', label: 'MUSIC', kind: 'toggle', value: view.musicOn },
      { id: 'settings.musicVolume', key: 'musicVolume', label: 'MUSIC VOLUME', kind: 'slider', value: view.musicVolume },
      { id: 'settings.sfxOn', key: 'sfxOn', label: 'SFX', kind: 'toggle', value: view.sfxOn },
      { id: 'settings.sfxVolume', key: 'sfxVolume', label: 'SFX VOLUME', kind: 'slider', value: view.sfxVolume },
      { id: 'settings.voiceOn', key: 'voiceOn', label: 'VOICE NARRATION', kind: 'toggle', value: view.voiceOn },
    ];
  }
  if (tab === 'video') {
    return [
      { id: 'settings.halfResWater', key: 'halfResWater', label: 'HALF-RES WATER', kind: 'toggle', value: view.halfResWater },
      { id: 'settings.uiScale', key: 'uiScale', label: 'UI SCALE', kind: 'slider', value: view.uiScale },
      { id: 'settings.lighting', key: 'lighting', label: 'LIGHTING', kind: 'toggle', value: view.lighting },
    ];
  }
  return [];
}

/** A row's value as the human-readable note `describe()` reports — mirrors
 *  what the widget itself paints (ON/OFF, a rounded percentage, or "2X" for
 *  the discrete UI-scale rungs) without redrawing anything. */
export function formatRowValue(row: SettingsRow): string {
  if (row.kind === 'toggle') return row.value ? 'ON' : 'OFF';
  if (row.key === 'uiScale') return `${Math.round(row.value as number)}X`;
  return `${Math.round((row.value as number) * 100)}%`;
}

/**
 * P5 PLACEHOLDER — DELETE WHOLESALE when `src/game/input/keymap.ts` lands
 * (see the P5 brief in `docs/superpowers/plans/2026-07-25-ui-v3-handoff.md`).
 * There is no keymap module yet, so the CONTROLS tab reads this constant
 * instead of a real binding table; it is display-only (no rebinding, no
 * conflict detection) — that is P5's job. Sourced from the current hardcoded
 * key handling in `src/ui/controls.ts`.
 */
const PLACEHOLDER_KEYMAP: readonly { action: string; keys: readonly string[] }[] = [
  { action: 'PAUSE MENU / BACK', keys: ['ESC'] },
  { action: 'PAUSE / RESUME', keys: ['SPACE'] },
  { action: 'TIME BAR', keys: ['T'] },
  { action: 'SET RATE 1/2/4/8', keys: ['1', '2', '4', '8'] },
  { action: 'TOGGLE LABELS', keys: ['L'] },
  { action: 'TOGGLE MINIMAP', keys: ['M'] },
  { action: 'TOGGLE FOLLOW', keys: ['F'] },
  { action: 'SETTINGS', keys: ['K'] },
  { action: 'DEBUG OVERLAY', keys: ['~'] },
];

/** The largest INTEGER scale at or below `preferred` at which `text` fits
 *  `maxW` — mirrors `title-screen.ts`/`save-screen.ts`'s `fitScale` (pixel-
 *  perfect law: no fractional scales). */
function fitScale(c: UiContext, text: string, maxW: number, preferred: number): number {
  for (let sc = preferred; sc > 1; sc--) {
    if (c.measure(text, sc) <= maxW) return sc;
  }
  return 1;
}

/**
 * Paint the settings screen. Returns the action the player triggered this
 * frame (or null) PLUS the GAMEPLAY tab's reserved island rect (or null on
 * every other tab) — see `SettingsDrawResult`'s doc for why this can't
 * collapse to a bare `Action | null` like the other screens.
 *
 * LAYOUT IS MEASURED BEFORE IT IS PLACED, same discipline as
 * `title-screen.ts`/`save-screen.ts`: a degradation ladder tightens gaps and
 * row heights before the whole screen steps down an integer UI-scale rung,
 * so a cramped viewport loses spacing, never overflows.
 */
export function drawSettingsScreen(
  c: UiContext, w: number, h: number, s: number, view: SettingsScreenView,
): SettingsDrawResult {
  const edge = Math.round(SPACING.lg * s);
  const cx = Math.round(w / 2);
  const colW = Math.round(Math.min(560 * s, Math.max(160, w - edge * 2)));
  const colX = Math.round(cx - colW / 2);

  const headerText = 'SETTINGS';
  const fsHeader = fitScale(c, headerText, w - edge * 2, FS.title * s);
  const headerH = c.lineHeight(fsHeader);

  const fsBody = FS.body * s;
  const fsSmall = FS.caption * s;
  const lh = c.lineHeight(fsBody);
  const lhSmall = c.lineHeight(fsSmall);
  const tabH = Math.round(30 * s);
  const backH = Math.round(30 * s);
  const backW = Math.round(Math.min(160 * s, colW));

  const rows = settingsRows(view, view.tab);

  interface Plan { gap: number; toggleH: number; sliderH: number }
  const gapFull = Math.round(SPACING.md * s);
  const gapTight = Math.round(SPACING.tight * s);
  const toggleHFull = Math.max(Math.round(30 * s), lh + Math.round(SPACING.sm * s) * 2);
  const toggleHTight = Math.max(lh + Math.round(SPACING.tight * s) * 2, 18);
  const sliderHFull = lh + Math.round(28 * s);
  const sliderHTight = lh + Math.max(8, Math.round(10 * s));

  const rowH = (kind: 'toggle' | 'slider', p: Plan): number => (kind === 'toggle' ? p.toggleH : p.sliderH);

  const plans: Plan[] = [
    { gap: gapFull, toggleH: toggleHFull, sliderH: sliderHFull },
    { gap: gapTight, toggleH: toggleHFull, sliderH: sliderHFull },
    { gap: gapTight, toggleH: toggleHTight, sliderH: sliderHTight },
  ];

  // GAMEPLAY (the DOM island) and CONTROLS (a `scrollList` of read-only
  // key-chip rows) don't have a fixed content height — both STRETCH to fill
  // whatever vertical space is left before BACK once drawn (see the draw path
  // below), which is what actually guarantees neither can overflow a cramped
  // viewport: a `scrollList` only ever draws rows that FULLY fit its rect, and
  // the island rect IS the remaining space by construction. `nonRowContentH`
  // below is therefore only a MINIMUM — enough to decide whether this tab's
  // fixed chrome (header/tabs/note/BACK) fits at all, never the real drawn size.
  // `keyChip`'s own height is `lineHeight(fsSmall) + 2*SPACING.hairline` (it does
  // NOT scale its padding by `s`, only by the text scale — see `key-chip.ts`) —
  // the row must be at least that tall or the chip's own bottom edge would clip
  // past the row `scrollList` allotted it.
  const controlsRowH = Math.max(lhSmall + Math.round(SPACING.tight * s), lhSmall + 2 * SPACING.hairline + 1, 16);
  const nonRowContentH = (p: Plan): number => {
    if (view.tab === 'gameplay') return lh + p.gap + Math.round(40 * s);
    if (view.tab === 'controls') return lhSmall + p.gap + controlsRowH;
    return 0;
  };

  const measure = (p: Plan): number => {
    const rowsH = rows.length
      ? rows.reduce((sum, r) => sum + rowH(r.kind, p), 0) + (rows.length - 1) * p.gap
      : nonRowContentH(p);
    return headerH + p.gap + tabH + p.gap + rowsH + p.gap + backH;
  };

  const budget = h - edge * 2;
  // As with the title/slot screens: if not even the floor plan fits at this UI
  // scale, step the WHOLE screen down an integer scale rung and retry — done
  // BEFORE any drawing happens, so the failed attempt never leaves geometry
  // behind for the retry to draw over.
  if (s > 1 && measure(plans[plans.length - 1]) > budget) {
    return drawSettingsScreen(c, w, h, s - 1, view);
  }
  const plan = plans.find((p) => measure(p) <= budget) ?? plans[plans.length - 1];

  let y = Math.max(Math.round(SPACING.lg * s), Math.round((h - measure(plan)) / 2));

  const hw = c.measure(headerText, fsHeader);
  c.label(headerText, Math.round(cx - hw / 2), y, fsHeader, COLOR.ink);
  y += headerH + plan.gap;

  let fired: SettingsAction | null = null;

  const picked = tabbar(c, {
    id: 'settings.tabs', tabs: SETTINGS_TABS, selected: view.tab,
    x: colX, y, w: colW, h: tabH, scale: fsBody,
  });
  if (picked) fired = { kind: 'tab', tab: picked as SettingsTab };
  y += tabH + plan.gap;

  let island: Rect | null = null;

  if (rows.length) {
    for (const row of rows) {
      const rh = rowH(row.kind, plan);
      if (row.kind === 'toggle') {
        const flipped = toggle(c, {
          id: row.id, label: row.label, x: colX, y, w: colW, h: rh,
          value: row.value as boolean, scale: fsBody,
        });
        if (flipped) fired = { kind: 'set', key: row.key, value: !(row.value as boolean) };
      } else if (row.key === 'uiScale') {
        // The only slider whose native units aren't already 0..1 — the three
        // integer rungs (1X/2X/3X) map onto the slider's three step positions.
        const sliderVal = clamp01(((row.value as number) - 1) / 2);
        const changed = slider(c, {
          id: row.id, label: row.label, x: colX, y, w: colW, h: rh,
          value: sliderVal, step: 0.5, scale: fsBody,
          format: (v) => `${Math.round(1 + v * 2)}X`,
        });
        if (changed !== null) fired = { kind: 'set', key: row.key, value: Math.round(1 + changed * 2) };
      } else {
        const changed = slider(c, {
          id: row.id, label: row.label, x: colX, y, w: colW, h: rh,
          value: row.value as number, scale: fsBody,
        });
        if (changed !== null) fired = { kind: 'set', key: row.key, value: changed };
      }
      y += rh + plan.gap;
    }
  } else if (view.tab === 'gameplay') {
    const note = 'PROVIDER · MODEL · API KEY';
    c.label(c.ellipsize(note, fsBody, colW), colX, y, fsBody, COLOR.inkDim);
    y += lh + plan.gap;
    // The provider FORM needs typed text input → it renders in the DOM island,
    // positioned over this reserved region (same contract `drawMenu`'s settings
    // panel already uses — see `ui-runtime.ts`'s `frame()`). Only the rect is
    // reserved here; nothing else is drawn under it. STRETCHES to fill the
    // remaining space down to BACK (bounded below by a small floor) — the same
    // "reserve whatever's left" idiom `drawMenu`'s own settings panel uses for
    // its island, and what keeps this tab from ever overflowing a cramped
    // viewport regardless of how the plan's other terms landed.
    const islandH = Math.max(Math.round(40 * s), h - edge - plan.gap - backH - y);
    island = { x: colX, y, w: colW, h: islandH };
    y += islandH + plan.gap;
  } else if (view.tab === 'controls') {
    const note = 'REBINDING ARRIVES IN A LATER PHASE';
    c.label(c.ellipsize(note, fsSmall, colW), colX, y, fsSmall, COLOR.inkDim);
    y += lhSmall + plan.gap;
    // A `scrollList` rather than an unconditional loop: it only ever draws rows
    // that FULLY fit its rect, so a long placeholder list can never push BACK
    // (or anything else) past the viewport — the geometry-safety property this
    // whole module otherwise gets from the measured degradation ladder. No
    // wheel wiring lands this slice (pure module, no runtime attach), so on an
    // overflowing list the `+` more-indicator is honest but inert until a
    // caller wires `scrollBy` — acceptable for a P5-replaced placeholder.
    const listY = y;
    const listH = Math.max(controlsRowH, h - edge - plan.gap - backH - listY);
    const labelMaxW = Math.round(colW * 0.58);
    const chipsX = colX + Math.round(colW * 0.62);
    c.scrollList(
      'settings.controls.list', { x: colX, y: listY, w: colW, h: listH },
      controlsRowH, PLACEHOLDER_KEYMAP.length,
      (i, rowY) => {
        const binding = PLACEHOLDER_KEYMAP[i];
        c.label(c.ellipsize(binding.action, fsSmall, labelMaxW), colX, rowY, fsSmall, COLOR.ink);
        let chipX = chipsX;
        for (const k of binding.keys) {
          const r = keyChip(c, { text: k, x: chipX, y: rowY, scale: fsSmall });
          chipX = r.x + r.w + Math.round(SPACING.tight * s);
        }
      },
    );
    y = listY + listH + plan.gap;
  }

  const backX = Math.round(cx - backW / 2);
  if (c.button('settings.back', 'BACK', backX, y, backW, backH, { scale: fsBody })) {
    fired = { kind: 'back' };
  }

  return { action: fired, island };
}
