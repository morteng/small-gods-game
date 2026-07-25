// src/render/ui/shell/settings-screen.ts
//
// The SETTINGS screen (UI v3 P4b/P5) — a tabbed screen over `settings-store`.
// Pure like every shell screen: state in, geometry out, actions reported
// back. It knows nothing about `Game` or `settings-store` itself — the
// caller (`Game.buildSettingsView`) hands it a prebuilt `SettingsScreenView`
// and receives a `SettingsAction` to translate into either a direct
// Shell-local tab switch or a meta command (see `shell.ts` and `Game`'s
// `onSettingsAction` hook).
//
// Four tabs (spec §6/§7): AUDIO and VIDEO are plain toggle/slider rows read
// straight off the view; GAMEPLAY reserves a DOM-island rect for the existing
// provider/model/key form (`SettingsIsland`, `ui-settings-island.ts`) — the
// SAME reserved-rect contract `drawMenu`'s settings panel already uses, not a
// new island class; CONTROLS (P5) lists every `keymap.ts` `Action` as a row
// (label + current binding + REBIND). Rebinding is a two-step, cross-module
// handshake: this screen reports `{ kind: 'rebind_start', action }` when
// REBIND is clicked; the RUNTIME (not this pure module — see `Game`'s
// `capturingAction`) then listens for the next physical keydown/gamepad
// button, resolves any conflict, persists, and feeds the updated
// `SettingsScreenView.keymap`/`capturing`/`keymapNote` back in on the next
// frame. The screen never touches `window`/`navigator` itself.

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, SPACING, shellTypeScaleFor } from '@/render/ui/ui-tokens';
import { toggle, slider, tabbar, keyChip, type TabDef, type Rect } from '@/render/ui/kit';
import { clamp01 } from '@/core/math';
import type { Settings } from '@/services/settings-store';
import { ACTIONS, promptFor, type Action, type Keymap } from '@/game/input/keymap';

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
 * Everything the AUDIO/VIDEO/CONTROLS rows need, PREBUILT by the caller — the
 * screen never reads `settings-store`/`keymap.ts`'s persistence itself. `tab`
 * is the SHELL's own local view state (which tab is selected), not game
 * state; `Shell` overwrites whatever this field the caller supplies with its
 * own (see `shell.ts`'s `buildSettingsView`), so a caller may leave it at
 * any value.
 *
 * `lighting`/`halfResWater` are booleans here even though `settings-store`
 * persists `lighting` as a 0/1 number — the caller resolves that (`Game`
 * reads the live `devMode.lighting` toggle, which is fundamentally binary).
 * `uiScale` is the real 1..3 integer rung, not a normalized slider fraction.
 *
 * `keymap`/`capturing`/`keymapNote` are CONTROLS-tab-only (P5): `keymap` is
 * the live map (default merged with whatever the player rebound); `capturing`
 * is the action currently waiting for its next keypress, or null; `keymapNote`
 * is a one-line status from the LAST rebind (e.g. which action lost a key to
 * a conflict), or null. All three live in `Game` (the runtime owns the actual
 * capture listener — see this file's header doc), never derived here.
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
  keymap: Keymap;
  capturing: Action | null;
  keymapNote: string | null;
}

/** What the player asked for. `set` carries the NEW value the widget produced
 *  (already flipped/moved) — the caller writes it, never toggles/adds a delta
 *  itself. `tab` is Shell-local UI state; `back` closes the screen.
 *  `rebind_start`/`rebind_cancel`/`reset_controls` are P5: the CONTROLS tab's
 *  own affordances, serviced by the `rebind_key`/`set_setting` meta verbs
 *  (see `Game.handleMetaCommand`). */
export type SettingsAction =
  | { kind: 'set'; key: SettingsKey; value: boolean | number }
  | { kind: 'tab'; tab: SettingsTab }
  | { kind: 'back' }
  | { kind: 'rebind_start'; action: Action }
  | { kind: 'rebind_cancel' }
  | { kind: 'reset_controls' };

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
 * The rows for one tab. GAMEPLAY (the DOM island) and CONTROLS (its own
 * `keymapRows` below) own their own layout and contribute no `set`-able rows
 * here — an empty array, matched by zero `set` hit regions in THIS function's
 * sense, keeps `describe()` and the draw path in lockstep for every tab.
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

/** Human labels for every `Action` — the CONTROLS tab's row text. Order-
 *  independent of `ACTIONS` (that list owns row ORDER; this owns row TEXT). */
const ACTION_LABELS: Readonly<Record<Action, string>> = {
  toggle_labels: 'TOGGLE LABELS',
  toggle_minimap: 'TOGGLE MINIMAP',
  toggle_debug: 'DEBUG OVERLAY',
  follow_selected: 'TOGGLE FOLLOW',
  open_settings: 'OPEN SETTINGS',
  open_tutorial: 'TUTORIAL',
  toggle_time_bar: 'TIME BAR',
  toggle_pause: 'PAUSE / RESUME',
  rate_1: 'SET RATE 1X',
  rate_2: 'SET RATE 2X',
  rate_4: 'SET RATE 4X',
  rate_8: 'SET RATE 8X',
  menu_up: 'MENU UP',
  menu_down: 'MENU DOWN',
  menu_left: 'MENU LEFT',
  menu_right: 'MENU RIGHT',
  confirm: 'CONFIRM',
  cancel: 'BACK / CANCEL',
  photo_mode: 'PHOTO MODE',
};

/** One CONTROLS-tab row: the action, its label, and its current prompt —
 *  exported so a test can assert row logic without geometry (same idiom as
 *  `settingsRows`), and so `shell.ts`'s `describe()` walks the SAME list the
 *  draw path does. */
export interface KeymapRow {
  id: string;
  action: Action;
  label: string;
  prompt: string;
}

export function keymapRows(view: SettingsScreenView): KeymapRow[] {
  return ACTIONS.map((action) => ({
    id: `settings.controls.rebind.${action}`,
    action,
    label: ACTION_LABELS[action],
    prompt: promptFor(action, view.keymap),
  }));
}

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
 * so a cramped viewport loses spacing, never overflows. The CONTROLS tab
 * (P5) never shrinks its TEXT to fit — its 19 rows are drawn at `FS.menu`
 * (the shell's 10-foot interactive tier) regardless of viewport, and a short
 * viewport gets a `scrollList` instead (see the `controls` branch below).
 */
export function drawSettingsScreen(
  c: UiContext, w: number, h: number, s: number, view: SettingsScreenView,
): SettingsDrawResult {
  const edge = Math.round(SPACING.lg * s);
  const cx = Math.round(w / 2);
  // ── TYPE FIRST, THEN LAYOUT ─────────────────────────────────────────────
  // Layout metrics MUST derive from the same tokens as the type tier. Growing
  // the type while leaving hardcoded widths behind is what made every CONTROLS
  // label truncate ("TOGGLE LA…") and every button read "REB…" — worse than the
  // small version it replaced. Nothing below may use a bare px constant for a
  // width that has to hold text.
  const T = shellTypeScaleFor(w, s);
  const fsHeaderMax = T.heading;
  const fsMenu = T.menu;
  const fsCaption = T.caption;
  const lhMenu = c.lineHeight(fsMenu);
  const lhCaption = c.lineHeight(fsCaption);
  // ALL settings rows share the interactive tier — AUDIO/VIDEO sitting at the
  // old body scale while CONTROLS sat at menu tier looked broken on one screen.
  const fsBody = fsMenu;
  const lh = lhMenu;

  const headerText = 'SETTINGS';

  // The widest thing any row must show, measured at the tier it will be drawn
  // at — the panel is sized to its CONTENT, then clamped to the viewport.
  // Through the widget's OWN metric — never a spacing token, which is what made
  // the box narrower than the clip `c.button` applies (see `buttonWidth`).
  // Measured against BOTH verbs so it cannot resize or truncate mid-capture.
  const rebindW = Math.max(c.buttonWidth('REBIND', fsMenu), c.buttonWidth('CANCEL', fsMenu));
  let widestLabel = 0;
  let widestChip = Math.max(c.measure('OFF', fsMenu), c.measure('1.5X', fsMenu));
  for (const r of settingsRows(view, view.tab)) {
    widestLabel = Math.max(widestLabel, c.measure(r.label, fsMenu));
  }
  // The CONTROLS tab's rows come from `keymapRows`, not `settingsRows` — measure
  // them too, or the panel is sized for the wrong tab's content.
  if (view.tab === 'controls') {
    for (const r of keymapRows(view)) {
      widestLabel = Math.max(widestLabel, c.measure(r.label, fsMenu));
      widestChip = Math.max(widestChip, c.measure(r.prompt, fsMenu));
    }
  }
  const chipW = Math.ceil(widestChip) + Math.round(SPACING.md * 2 * s);
  const gutter = Math.round(SPACING.lg * s);
  // The TAB ROW is content too: four equal tabs across a too-narrow panel cut
  // "GAMEPLAY" to "GAMEP…". Its natural width must feed the panel's.
  // `tabbar` divides the row EVENLY, so the panel must fit N x the WIDEST tab —
  // summing their natural widths still starves the longest one ("GAMEPLAY").
  let widestTab = 0;
  for (const t of SETTINGS_TABS) widestTab = Math.max(widestTab, c.measure(t.label, fsMenu));
  const tabsW = SETTINGS_TABS.length * (Math.ceil(widestTab) + Math.round(SPACING.md * 2 * s));
  const naturalW = Math.max(
    Math.ceil(widestLabel) + gutter + chipW + gutter + rebindW + Math.round(SPACING.lg * 2 * s),
    tabsW + Math.round(SPACING.lg * 2 * s),
  );
  const colW = Math.round(Math.max(
    Math.min(560 * s, Math.max(160, w - edge * 2)),   // never NARROWER than before
    Math.min(naturalW, w - edge * 2),                  // but widen to fit the type
  ));
  const colX = Math.round(cx - colW / 2);
  const fsHeader = fitScale(c, headerText, w - edge * 2, fsHeaderMax);
  const headerH = c.lineHeight(fsHeader);
  const tabH = Math.round(30 * s);
  const backH = Math.round(30 * s);
  const backW = Math.round(Math.min(Math.max(160 * s, c.buttonWidth('BACK', fsMenu)), colW));

  // CONTROLS tab only (P5): the shell's 10-foot interactive tier for every
  // binding row, and its caption floor for the one instructional/conflict
  // hint line — NEVER below `FS.caption`, and interactive text never below
  // `FS.menu` (product direction, 2026-07-25: this is a game, not a desktop
  // settings dialog — see `ui-tokens.ts`'s `FS` doc). A long action list
  // simply doesn't fit one screen at this scale; that's handled by scrolling
  // (`scrollList` below), never by a smaller font.
  const controlsRowH = Math.max(Math.round(30 * s), lhMenu + Math.round(SPACING.sm * s) * 2);

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

  // GAMEPLAY (the DOM island) and CONTROLS (a `scrollList` of binding rows)
  // don't have a fixed content height — both STRETCH to fill whatever
  // vertical space is left before BACK once drawn (see the draw path below),
  // which is what actually guarantees neither can overflow a cramped
  // viewport: a `scrollList` only ever draws rows that FULLY fit its rect,
  // and the island rect IS the remaining space by construction.
  // `nonRowContentH` below is therefore only a MINIMUM — enough to decide
  // whether this tab's genuinely FIXED chrome (header/tabs/note/RESET/BACK)
  // fits at all, never the real (scrollable) drawn size — the list itself
  // contributes NO term here, exactly because it is allowed to clip.
  const nonRowContentH = (tab: SettingsTab, p: Plan): number => {
    if (tab === 'gameplay') return lh + p.gap + Math.round(40 * s);
    if (tab === 'controls') return lhCaption + p.gap + backH; // note line + RESET button
    return 0;
  };

  // Measured per TAB, and everything below anchors on the TALLEST tab, never
  // the current one: the header and tab bar must sit at the SAME height on
  // every tab (centring each tab on its own content height made the chrome
  // jump as you navigated). The scale-rung and row-plan decisions share the
  // tallest measure for the same reason — per-tab plans would give per-tab
  // chrome gaps, which is the same jump by another route.
  const measureTab = (tab: SettingsTab, p: Plan): number => {
    const tabRows = tab === view.tab ? rows : settingsRows(view, tab);
    const rowsH = tabRows.length
      ? tabRows.reduce((sum, r) => sum + rowH(r.kind, p), 0) + (tabRows.length - 1) * p.gap
      : nonRowContentH(tab, p);
    return headerH + p.gap + tabH + p.gap + rowsH + p.gap + backH;
  };
  const measure = (p: Plan): number =>
    Math.max(...SETTINGS_TABS.map((t) => measureTab(t.id as SettingsTab, p)));

  const budget = h - edge * 2;
  // As with the title/slot screens: if not even the floor plan fits at this UI
  // scale, step the WHOLE screen down an integer scale rung and retry — done
  // BEFORE any drawing happens, so the failed attempt never leaves geometry
  // behind for the retry to draw over. NOTE: this is the pre-existing WHOLE-
  // SCREEN mechanism (every tab shares it); it is not a CONTROLS-specific
  // font-shrink tier — the controls branch itself never asks for less than
  // `FS.menu`/`FS.caption` at whatever `s` this lands on.
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
    // The note line: a conflict/status report from the LAST rebind (P5) reads
    // at the same MENU tier as the rows it's reporting on (product direction:
    // "conflict text" is interactive-adjacent, not a caption); the generic
    // instructional hint (nothing has happened yet) is a genuine caption.
    const hasNote = view.keymapNote !== null;
    const noteScale = hasNote ? fsMenu : fsCaption;
    const noteLh = hasNote ? lhMenu : lhCaption;
    const noteColor = hasNote ? COLOR.ink : COLOR.inkDim;
    const noteText = view.keymapNote ?? 'CLICK REBIND, THEN PRESS A KEY. ESC CANCELS.';
    c.label(c.ellipsize(noteText, noteScale, colW), colX, y, noteScale, noteColor);
    y += noteLh + plan.gap;

    const listY = y;
    // The list STRETCHES to fill whatever's left above RESET+BACK — see
    // `nonRowContentH`'s doc for why that's what actually guarantees this tab
    // never overflows regardless of how many rows exist. UNLIKE the other
    // tabs' island/list floors, this one floors at 0, not `controlsRowH`: a
    // floor of "at least one row" is exactly what caused a real overflow at
    // a cramped viewport (a giant `FS.menu`-scale row forced past what was
    // actually left) — an empty scrollList (0 visible rows) is an honest,
    // never-overflowing degraded state; the geometry-safety guarantee wins
    // over "always show at least one row" when they conflict.
    const listH = Math.max(0, h - edge - plan.gap - backH /* RESET */ - plan.gap - backH /* BACK */ - listY);
    // The label takes whatever the fixed-width controls leave — never a fraction
    // guessed independently of them, which is how the label ended up too narrow
    // for its own text at the larger tier.
    const labelMaxW = Math.max(
      Math.round(colW * 0.25),
      colW - rebindW - chipW - gutter * 2,
    );
    const chipX = colX + Math.round(colW * 0.48);
    const rebindX = colX + colW - rebindW;
    const krows = keymapRows(view);
    c.scrollList(
      'settings.controls.list', { x: colX, y: listY, w: colW, h: listH },
      controlsRowH, krows.length,
      (i, rowY) => {
        const row = krows[i];
        const capturingThis = view.capturing === row.action;
        c.label(c.ellipsize(row.label, fsMenu, labelMaxW), colX, rowY, fsMenu, COLOR.ink);
        if (capturingThis) {
          c.label('PRESS A KEY', chipX, rowY, fsMenu, COLOR.gold);
        } else {
          keyChip(c, { text: row.prompt, x: chipX, y: rowY, scale: fsMenu });
        }
        // While ANY row is capturing, every OTHER row's REBIND is disabled —
        // one capture at a time (a second REBIND click mid-capture would be
        // ambiguous about which row the next keypress belongs to).
        const disabled = view.capturing !== null && !capturingThis;
        const btnLabel = capturingThis ? 'CANCEL' : 'REBIND';
        if (c.button(`settings.controls.rebind.${row.action}`, btnLabel, rebindX, rowY, rebindW, controlsRowH,
          { scale: fsMenu, disabled })) {
          fired = capturingThis ? { kind: 'rebind_cancel' } : { kind: 'rebind_start', action: row.action };
        }
      },
      fsCaption,   // overflow marks ride the caption tier, never below the floor
    );
    y = listY + listH + plan.gap;

    if (c.button('settings.controls.reset', 'RESET TO DEFAULTS', colX, y, colW, backH,
      { scale: fsMenu, disabled: view.capturing !== null })) {
      fired = { kind: 'reset_controls' };
    }
    y += backH + plan.gap;
  }

  // BACK is pinned to the screen bottom on EVERY tab — the stretch tabs
  // (gameplay/controls) already land it there by construction; the row tabs
  // used to let it trail their content, so it jumped between tabs. The max()
  // keeps the old draw-after-content behaviour in the cramped case where the
  // stretch floors pushed y past the bottom anchor.
  const backY = Math.max(y, h - edge - backH);
  const backX = Math.round(cx - backW / 2);
  if (c.button('settings.back', 'BACK', backX, backY, backW, backH, { scale: fsBody })) {
    fired = { kind: 'back' };
  }

  return { action: fired, island };
}
