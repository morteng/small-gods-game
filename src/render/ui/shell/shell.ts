// src/render/ui/shell/shell.ts
//
// The Shell — the mutable glue in front of the pure screen stack (UI v3, §3.3).
//
// `shell-state.ts` is the pure reducer; the screen modules are pure draw
// functions. This class is the only stateful piece: it holds the current stack,
// the data the screens read (boot progress, chronicle excerpts), and it kicks a
// render when any of that changes — because the frame loop is render-on-demand
// and idles whenever nothing is animating, so a `setProgress` that didn't
// request a frame would simply not appear.
//
// It deliberately does NOT know about `Game`. Screens that need game data get it
// through a per-frame view (see `src/game/shell-view.ts`), the same read-only
// idiom `game-query.ts` established.

import type { UiContext } from '@/render/ui/ui-context';
import {
  EMPTY_SHELL, type ScreenId, type ShellState,
  push, pop, replace, reset, topOf, depth, contains,
  type TransitionState, beginTransition, clearTransition as clearTransitionState,
  skipTransition as skipTransitionState, transitionPhase as pureTransitionPhase,
  DESCENT_TRANSITION_MS, ASCENT_TRANSITION_MS,
} from '@/render/ui/shell/shell-state';
import { drawLoadingScreen, type LoadingView } from '@/render/ui/shell/loading-screen';
import {
  drawTitleScreen, titleRows, type TitleAction, type TitleView,
} from '@/render/ui/shell/title-screen';
import {
  drawSaveScreen, saveRows, type SaveAction, type SaveScreenView, type SlotRow, type ScreenRow,
} from '@/render/ui/shell/save-screen';
import {
  drawLoadScreen, loadRows, type LoadAction, type LoadScreenView,
} from '@/render/ui/shell/load-screen';
import {
  drawSettingsScreen, settingsRows, formatRowValue, keymapRows, SETTINGS_TABS,
  type SettingsAction, type SettingsScreenView, type SettingsTab,
} from '@/render/ui/shell/settings-screen';
import {
  drawGameOverScreen, gameOverRows, type GameOverAction, type GameOverView,
} from '@/render/ui/shell/gameover-screen';
import { drawPhotoScreen, type PhotoView } from '@/render/ui/shell/photo-screen';
import {
  drawNewGameScreen, type NewGameAction, type NewGameView,
} from '@/render/ui/shell/newgame-screen';
import {
  drawHallScreen, hallRows, type HallAction, type HallView,
} from '@/render/ui/shell/hall-screen';
import { DEFAULT_KEYMAP } from '@/game/input/keymap';

/** A device-px rect (a DOM island's reserved region). Mirrors `ui-runtime`'s. */
interface Rect { x: number; y: number; w: number; h: number }

/** What one `Shell.draw` produced: an optional DOM-island reservation and any
 *  action the player triggered. The shell reports; the caller dispatches. */
export interface ShellDrawResult {
  island: Rect | null;
  title: TitleAction | null;
  save: SaveAction | null;
  load: LoadAction | null;
  settings: SettingsAction | null;
  gameover: GameOverAction | null;
  newgame: NewGameAction | null;
  hall: HallAction | null;
}

/** Nothing drawn, nothing triggered — shared so the common case allocates once. */
const INERT_DRAW: ShellDrawResult = {
  island: null, title: null, save: null, load: null, settings: null, gameover: null,
  newgame: null, hall: null,
};

/**
 * The surface `boot-sequence.ts` drives while a world loads.
 *
 * Structurally identical to the DOM `LoadingScreenHandle`'s used members, so the
 * boot sequence swaps from one to the other by changing a TYPE, not a call site
 * — which is what keeps the DOM loader's deletion a mechanical change instead of
 * a rewrite of the boot orchestration.
 */
export interface LoadingSurface {
  show(): void;
  setProgress(fraction: number, label?: string): void;
  setChronicle(texts: readonly string[]): void;
  hide(): void;
}

/**
 * One offered choice on the current screen — the unit an EXTERNAL AGENT reads to
 * navigate menus without screenshots (spec §3.7). `id` is the same widget id the
 * pointer/keyboard path uses, so "what can I do" and "what did I click" are the
 * same vocabulary. `note` carries the human reason a choice is refused (a stale
 * save's version mismatch), which is the whole point of surfacing it: an agent
 * must be able to learn *why* CONTINUE is unavailable, not just that it is.
 */
export interface ShellChoice {
  id: string;
  label: string;
  enabled: boolean;
  note: string | null;
}

/** The shell's full readable state (spec §3.7). Read-only; served through the
 *  same query seam as every other game read, so MCP / the dev CLI / a test all
 *  see the menus identically. */
export interface ShellDescription {
  /** The screen on top, or null when the in-game HUD owns the frame. */
  screen: ScreenId | null;
  stack: readonly ScreenId[];
  choices: readonly ShellChoice[];
  /** Boot progress, meaningful while `screen === 'loading'`. */
  progress: number;
  label: string;
}

export interface ShellDeps {
  /** Kick one frame — the loop is render-on-demand and may be idle. */
  requestRender?: () => void;
  /** Real-time clock (ms). Injected so the chronicle rotation is testable
   *  without fake timers; defaults to `performance.now`. */
  now?: () => number;
  /** Supplies the title screen's data (save probe results, build line). Injected
   *  rather than held, so the Shell never reaches into the save store itself and
   *  stays a pure-ish presentation object. Absent ⇒ the title screen draws its
   *  empty state (no save, nothing to continue). */
  titleView?: () => TitleView;
  /** Supplies the save screen's slot data. Absent ⇒ four empty slots (the
   *  honest empty state — never a fabricated save). */
  saveView?: () => SaveScreenView;
  /** Supplies the load screen's slot data. Same shape as `saveView` (both
   *  screens read the identical per-slot metadata; only what picking a row
   *  MEANS differs) — `Game` builds one probe and feeds both. */
  loadView?: () => LoadScreenView;
  /** Supplies the settings screen's persisted values (audio/video). Absent ⇒
   *  the honest all-defaults view (mirroring `settings-store.ts`'s own
   *  `DEFAULTS`). The `tab` field this returns is IGNORED — the selected tab
   *  is Shell-local UI state (see `setSettingsTab`), never game state, so the
   *  Shell always overwrites it with its own before handing the view to the
   *  screen or to `describe()`. */
  settingsView?: () => SettingsScreenView;
  /** Supplies the game-over screen's optional closing line. Absent ⇒ `null`
   *  (just the two fixed canon lines — see `gameover-screen.ts`). */
  gameoverView?: () => GameOverView;
  /** Supplies the photo screen's fading "saved" hint. Absent ⇒ nothing drawn
   *  (the honest empty state — see `photo-screen.ts`). */
  photoView?: () => PhotoView;
  /** Supplies the new-world screen's last paste-decode refusal, if any.
   *  Absent ⇒ no refusal shown yet. */
  newGameView?: () => NewGameView;
  /** Supplies the Hall of the Gods' pedestals + spirit strip. The FIRST view
   *  that reads live sim state (every other screen is meta-only), so `Game`
   *  builds it off the `hudSim()` wall-clock memo rather than a raw query —
   *  the hall draws every frame over a running world and `beliefPowers()` is a
   *  full congregation sweep. Absent ⇒ `EMPTY_HALL_VIEW`, the honest "no world"
   *  hall (it still stands; nothing is believed in it). */
  hallView?: () => HallView;
}

/** The title view used when no provider is wired — the honest empty state, never
 *  a fabricated "you have a save". */
const EMPTY_TITLE_VIEW: TitleView = {
  continueLine: null,
  continueBlocked: { reason: 'none', text: 'No world yet' },
  hasAnySave: false,
  buildLine: '',
};

const EMPTY_GAMEOVER_VIEW: GameOverView = { note: null };
const EMPTY_PHOTO_VIEW: PhotoView = { hintText: null, alpha: 0 };
const EMPTY_NEWGAME_VIEW: NewGameView = { error: null };

/** The hall with nothing believed in it — no world loaded, or no `hallView`
 *  wired. Deliberately NOT a fabricated pantheon: no pedestals at all (the
 *  screen draws hazy, hitless niches for them, see `GHOST_PEDESTALS`) and an
 *  `emptyLine` that states the truth. `faded` is false because a god with no
 *  world has not faded — it has not begun. */
export const EMPTY_HALL_VIEW: HallView = {
  spirit: {
    name: 'A GOD WITH NO WORLD',
    tierLine: 'UNBELIEVED',
    massLine: '',
    intimacyLine: 'NO ONE HAS HEARD OF YOU',
    intimacy: 0,
    faded: false,
    fadedLine: null,
  },
  pedestals: [],
  emptyLine: 'THE HALL STANDS EMPTY — NO WORLD BELIEVES IN YOU YET',
};

/** Four empty slots — the honest default for the save/load screens when no
 *  provider is wired, mirroring `EMPTY_TITLE_VIEW` above. */
const EMPTY_SLOT_ROWS: readonly SlotRow[] = (['autosave', 'slot1', 'slot2', 'slot3'] as const).map((slot) => ({
  slot, name: '', dateLabel: '', tierLine: '', playtimeLabel: '',
  compat: 'ok', empty: true, thumbnail: null, staleReason: null,
}));
const EMPTY_SAVE_VIEW: SaveScreenView = { rows: [...EMPTY_SLOT_ROWS] };
const EMPTY_LOAD_VIEW: LoadScreenView = { rows: [...EMPTY_SLOT_ROWS] };

/** The settings view used when no provider is wired — matches
 *  `settings-store.ts`'s own `DEFAULTS`, so an unwired Shell reads exactly
 *  like a freshly-migrated store rather than an arbitrary placeholder. */
const EMPTY_SETTINGS_VIEW: SettingsScreenView = {
  tab: 'audio',
  musicOn: true, musicVolume: 0.35, sfxOn: true, sfxVolume: 0.6, voiceOn: false,
  halfResWater: true, uiScale: 1, lighting: true,
  keymap: DEFAULT_KEYMAP, capturing: null, keymapNote: null,
};

const realNow = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** `describe()`'s choices for a slot screen (save or load) — mirrors exactly
 *  what `drawSlotsScreen` draws: one choice per tile body, one per DELETE
 *  affordance when the row offers one, then BACK. Kept as ONE function shared
 *  by both screens so "described ids equal drawn hit ids" cannot drift
 *  between save and load. */
function describeSlotScreen(rows: readonly ScreenRow[], backId: string): ShellChoice[] {
  const choices: ShellChoice[] = [];
  for (const row of rows) {
    choices.push({
      id: `${row.id}.body`,
      label: row.data.empty ? 'EMPTY SLOT' : row.data.name,
      enabled: row.enabled,
      note: row.reason,
    });
    if (row.deletable) {
      choices.push({ id: `${row.id}.delete`, label: 'DELETE', enabled: true, note: null });
    }
  }
  choices.push({ id: backId, label: 'BACK', enabled: true, note: null });
  return choices;
}

/** `describe()`'s choices for the settings screen — mirrors exactly what
 *  `drawSettingsScreen` draws: one choice per tab (via the SAME `SETTINGS_TABS`
 *  list the tabbar walks), then one per row on the ACTIVE tab (via the SAME
 *  `settingsRows` the draw path uses), then BACK. GAMEPLAY contributes no
 *  rows here because it draws none (the DOM island isn't a `set`-able
 *  choice) — keeping "described ids equal drawn hit ids" true for audio/
 *  video/gameplay.
 *
 *  CONTROLS is the one deliberate exception (P5): it enumerates every
 *  `Action` via `keymapRows` regardless of the current scroll position,
 *  because an external agent needs to discover the FULL rebindable action
 *  set to do anything useful with `rebind_key` — but the draw path only
 *  registers a hit region for whatever the `scrollList` currently has
 *  visible. Every id `describe()` reports for CONTROLS is still something
 *  the draw path WILL eventually produce a hit for (just possibly after a
 *  scroll) — `tests/unit/shell-settings-screen.test.ts` proves that by
 *  unioning hit ids across every scroll offset, rather than asserting
 *  single-frame equality the way the other tabs can. */
function describeSettingsScreen(view: SettingsScreenView): ShellChoice[] {
  const choices: ShellChoice[] = [];
  for (const t of SETTINGS_TABS) {
    choices.push({
      id: `settings.tabs.${t.id}`, label: t.label, enabled: true,
      note: t.id === view.tab ? 'CURRENT TAB' : null,
    });
  }
  for (const row of settingsRows(view, view.tab)) {
    choices.push({ id: row.id, label: row.label, enabled: true, note: formatRowValue(row) });
  }
  if (view.tab === 'controls') {
    for (const row of keymapRows(view)) {
      const capturingThis = view.capturing === row.action;
      choices.push({
        id: row.id,
        label: `${row.label}: ${row.prompt}`,
        enabled: view.capturing === null || capturingThis,
        note: capturingThis ? 'PRESS A KEY' : null,
      });
    }
    choices.push({
      id: 'settings.controls.reset', label: 'RESET TO DEFAULTS',
      enabled: view.capturing === null, note: null,
    });
  }
  choices.push({ id: 'settings.back', label: 'BACK', enabled: true, note: null });
  return choices;
}

export class Shell implements LoadingSurface {
  private state: ShellState = EMPTY_SHELL;
  private readonly requestRender: () => void;
  private readonly now: () => number;
  private readonly titleView: () => TitleView;
  private readonly saveView: () => SaveScreenView;
  private readonly loadView: () => LoadScreenView;
  private readonly settingsValuesView: () => SettingsScreenView;
  private readonly gameoverView: () => GameOverView;
  private readonly photoView: () => PhotoView;
  private readonly newGameView: () => NewGameView;
  private readonly hallView: () => HallView;
  /** The Hall of the Gods' SELECTED PEDESTAL (a belief-domain id), or null for
   *  "nothing selected". Exactly the `settingsTab` precedent below: pure
   *  presentation state, so it lives here and NOT on `GameState` (which pins
   *  its field count) and NOT in `open_screen` params (no such mechanism
   *  exists). Selecting only adds the detail pane — it never changes which
   *  choices the hall offers, which is why `hallRows` is a function of the view
   *  alone and `describe()` can ignore this entirely. */
  private hallDomain: string | null = null;
  /** The settings screen's SELECTED TAB — pure presentation state, not game
   *  state (see `ShellDeps.settingsView`'s doc), so it lives here rather than
   *  in `Game`. Set by `Game`'s `onSettingsAction` hook on a `{kind:'tab'}`
   *  action, via `setSettingsTab` below — never by the screen module itself
   *  (screens are pure; the Shell is the one stateful piece). */
  private settingsTab: SettingsTab = 'audio';

  // Boot-progress state. `shownAtMs` anchors the chronicle rotation to when the
  // loading screen appeared, not to process start, so the first excerpt gets a
  // full period on screen.
  private progress = 0;
  private label = '';
  private chronicle: readonly string[] = [];
  private shownAtMs = 0;

  constructor(deps: ShellDeps = {}) {
    this.requestRender = deps.requestRender ?? ((): void => {});
    this.now = deps.now ?? realNow;
    this.titleView = deps.titleView ?? ((): TitleView => EMPTY_TITLE_VIEW);
    this.saveView = deps.saveView ?? ((): SaveScreenView => EMPTY_SAVE_VIEW);
    this.loadView = deps.loadView ?? ((): LoadScreenView => EMPTY_LOAD_VIEW);
    this.settingsValuesView = deps.settingsView ?? ((): SettingsScreenView => EMPTY_SETTINGS_VIEW);
    this.gameoverView = deps.gameoverView ?? ((): GameOverView => EMPTY_GAMEOVER_VIEW);
    this.photoView = deps.photoView ?? ((): PhotoView => EMPTY_PHOTO_VIEW);
    this.newGameView = deps.newGameView ?? ((): NewGameView => EMPTY_NEWGAME_VIEW);
    this.hallView = deps.hallView ?? ((): HallView => EMPTY_HALL_VIEW);
  }

  /** The settings screen's full view: the caller's persisted values, with the
   *  Shell's OWN selected tab spliced in (see the `settingsTab` field doc). */
  private buildSettingsView(): SettingsScreenView {
    return { ...this.settingsValuesView(), tab: this.settingsTab };
  }

  /** Switch the settings screen's active tab. Called by `Game`'s
   *  `onSettingsAction` hook in response to a `{kind:'tab'}` action — a
   *  direct method call, not a bus round-trip, because the selected tab is
   *  pure Shell-local presentation state (see the field doc), not something
   *  an agent needs a stable verb to drive yet. */
  setSettingsTab(tab: SettingsTab): void {
    if (tab === this.settingsTab) return;
    this.settingsTab = tab;
    this.requestRender();
  }

  /** Select a pedestal in the Hall of the Gods (or `null` to deselect).
   *  Called by `Game`'s `onHallAction` hook on a `{kind:'select'}` — a direct
   *  method call, not a bus round-trip, for exactly the reason
   *  `setSettingsTab` is: which pedestal's detail pane is open is Shell-local
   *  presentation, not game state, and an agent already sees the full pedestal
   *  set through `describe()` without selecting anything. Re-selecting the
   *  same domain TOGGLES it back off, so the pane is dismissable without
   *  leaving the hall. */
  setHallDomain(domain: string | null): void {
    const next = domain !== null && domain === this.hallDomain ? null : domain;
    if (next === this.hallDomain) return;
    this.hallDomain = next;
    this.requestRender();
  }

  /** The selected pedestal, for tests + the drawer (mirrors `loadingView`). */
  selectedHallDomain(): string | null { return this.hallDomain; }

  /**
   * The shell's readable state — the external-agent navigation surface
   * (spec §3.7). Pure read: calling it never draws, never mutates, and never
   * advances the chronicle rotation, so an agent can poll it freely.
   *
   * `choices` is derived from the SAME functions the draw path uses
   * (`titleRows`), so what an agent is told it can do and what a click can
   * actually do cannot drift apart.
   */
  describe(): ShellDescription {
    const screen = this.top();
    let choices: ShellChoice[] = [];
    if (screen === 'title') {
      choices = titleRows(this.titleView()).map((r) => ({
        id: r.id, label: r.label, enabled: r.enabled, note: r.note,
      }));
    } else if (screen === 'save') {
      choices = describeSlotScreen(saveRows(this.saveView()), 'save.back');
    } else if (screen === 'load') {
      choices = describeSlotScreen(loadRows(this.loadView()), 'load.back');
    } else if (screen === 'settings') {
      choices = describeSettingsScreen(this.buildSettingsView());
    } else if (screen === 'gameover') {
      choices = gameOverRows().map((r) => ({ id: r.id, label: r.label, enabled: true, note: null }));
    } else if (screen === 'newgame') {
      choices = [
        { id: 'newgame.random', label: 'RANDOM WORLD', enabled: true, note: null },
        { id: 'newgame.back', label: 'BACK', enabled: true, note: null },
      ];
    } else if (screen === 'hall') {
      // DERIVED from `hallRows` — the same function `drawHallScreen` walks, so a
      // headless agent's choice list and the painted buttons cannot disagree
      // about what exists or why a CAST is refused. (The hardcoded `newgame`
      // arm above is the anti-pattern; it predates that screen having a rows
      // function at all.)
      choices = hallRows(this.hallView()).map((r) => ({
        id: r.id, label: r.label, enabled: r.enabled, note: r.reason,
      }));
    }
    // `photo` deliberately reports NO choices — see `photo-screen.ts`'s header:
    // there is genuinely nothing to click while a photo is framing (Esc/back is
    // the shell's generic screen-pop, not a described choice here).
    //
    // Screens beyond these contribute their choices as they land; an
    // unimplemented screen (e.g. `pause`) honestly reports none rather than
    // guessing.
    return {
      screen,
      stack: [...this.state.stack],
      choices,
      progress: this.progress,
      label: this.label,
    };
  }

  // ── stack ────────────────────────────────────────────────────────────────
  /** The screen on top, or null when the in-game HUD owns the frame. */
  top(): ScreenId | null { return topOf(this.state); }
  /** Stack depth (0 ⇒ HUD). */
  depth(): number { return depth(this.state); }
  /** Whether a screen is anywhere on the stack. */
  has(id: ScreenId): boolean { return contains(this.state, id); }
  /** True while ANY screen is up — screens are modal, so this is what the input
   *  router asks to decide whether the world sees a pointer at all. */
  isActive(): boolean { return depth(this.state) > 0; }

  push(id: ScreenId): void { this.commit(push(this.state, id)); }
  pop(): void { this.commit(pop(this.state)); }
  replace(id: ScreenId): void { this.commit(replace(this.state, id)); }
  /** Discard the stack and set it outright (quit-to-title, world-start). */
  reset(ids: readonly ScreenId[] = []): void { this.commit(reset(ids)); }

  private commit(next: ShellState): void {
    if (next === this.state) return; // the reducer returns the same object on a no-op
    this.state = next;
    this.requestRender();
  }

  // ── LoadingSurface (drives the WebGPU loading screen) ────────────────────
  show(): void {
    if (this.top() !== 'loading') {
      // `reset`, NOT `replace`: once a world starts loading there is nothing to
      // go back to, so the loading screen must become the WHOLE stack — not just
      // the top of it.
      //
      // `replace` (which this used to be) collapses only the topmost entry, so it
      // was depth-dependent: from `['title']` it gave `['loading']` and `hide()`
      // landed on the HUD correctly, but from `['title','load']` — the
      // title → LOAD WORLD → pick-a-slot path — it gave `['title','loading']`, and
      // `hide()` popped back to a title screen left drawn on top of the running
      // world, with no HUD. Found in a live GPU pass (2026-07-25); pinned for all
      // four entry paths by `tests/unit/shell-entry-paths.test.ts`.
      this.reset(['loading']);
      this.shownAtMs = this.now();
    }
  }

  setProgress(fraction: number, label?: string): void {
    this.progress = Math.max(0, Math.min(1, fraction));
    if (label !== undefined) this.label = label;
    this.requestRender();
  }

  setChronicle(texts: readonly string[]): void {
    this.chronicle = [...texts];
    // Re-anchor so the first excerpt gets its full period from the moment it
    // actually has something to say (a restored world sets this mid-boot).
    this.shownAtMs = this.now();
    this.requestRender();
  }

  hide(): void {
    // Clear the stack outright rather than popping one level: the world is up and
    // owns the frame, so NO meta screen should survive — the same depth-
    // independence `show()` needs (see its comment). A pop would be correct only
    // while `show()` guarantees depth 1, and relying on that coupling is exactly
    // what produced the title-over-the-world bug.
    //
    // UI v3 sky-transition spike: this is `holdLoadingUntilArtSettled`'s ONLY
    // call to `hide()` (boot-sequence.ts), which itself only runs after
    // `await waitForArtSettled(...)` resolves — so beginning the descent HERE,
    // rather than anywhere else, is exactly what keeps "never before the
    // art-settle gate clears" true by construction. The stack clears
    // immediately (the world/HUD takes over the frame right away, same as
    // before); the transition is a SEPARATE field that drives the cloud
    // overlay + camera ease independent of the stack (see `ShellState`'s doc).
    if (this.top() === 'loading') this.beginDescent();
  }

  // ── sky/cloud TRANSITION (spike) ──────────────────────────────────────────

  /** Begin the loading→world DESCENT. Private: the only legal trigger is
   *  `hide()` above (which is itself only ever called post-art-settle). */
  private beginDescent(): void {
    this.commit(beginTransition('descent', this.now(), DESCENT_TRANSITION_MS));
  }

  /**
   * Begin the world→title ASCENT: clouds billow to cover before `Game`
   * performs the real state reset (see `sky-transition.ts`'s `ascentResetDue`
   * + `Game`'s `quit_to_title` handling, which drives the reset off
   * `transitionPhase` reaching 1). Clears the stack outright, same as
   * `beginTransition`'s doc — a pause menu or confirm dialog open when quit
   * fires must not stay drawn over the billowing cloud.
   *
   * NOTE for a future game-over screen: fading (`src/sim/god-tier.ts`) wants
   * this same "billow, then reset behind the cloud" shape. Not wired there
   * yet — this spike only covers the explicit quit-to-title verb.
   */
  beginAscent(): void {
    this.commit(beginTransition('ascent', this.now(), ASCENT_TRANSITION_MS));
  }

  /** The active transition, or null. Read-only — `Game` drives the camera/
   *  overlay from this each frame (`src/game/sky-transition.ts`). */
  transition(): TransitionState | null { return this.state.transition; }

  /** Whether a transition is running — the pointer-eating / click-to-skip
   *  condition `UiRuntime.isModalActive()` ORs in, independent of the screen
   *  STACK (the world HUD keeps drawing underneath one). */
  transitionActive(): boolean { return this.state.transition !== null; }

  /** Linear 0..1 progress through the active transition at `nowMs`, or `null`
   *  when none is running. */
  transitionPhase(nowMs: number): number | null {
    const t = this.state.transition;
    return t ? pureTransitionPhase(t, nowMs) : null;
  }

  /** Drop the active transition. A no-op when there isn't one. */
  clearTransition(): void {
    this.commit(clearTransitionState(this.state));
  }

  /** Click-to-skip: jump the active transition straight to its end state
   *  (phase 1). A no-op when there isn't one. */
  skipTransition(): void {
    this.commit(skipTransitionState(this.state, this.now()));
  }

  /** The loading screen's view for this frame (exposed for tests + the drawer). */
  loadingView(): LoadingView {
    return {
      progress: this.progress,
      label: this.label,
      chronicle: this.chronicle,
      elapsedMs: Math.max(0, this.now() - this.shownAtMs),
    };
  }

  // ── draw ─────────────────────────────────────────────────────────────────
  /**
   * Paint the top screen and report what the player triggered this frame.
   *
   * Draws NOTHING and returns an inert result when the stack is empty — the
   * caller then falls through to the in-game HUD.
   *
   * `island` is a DOM-island reservation rect for screens with a text field (the
   * same contract `drawMenu` already uses). `title` carries the title screen's
   * chosen action, which the caller translates into a meta command — the shell
   * itself never emits commands, so it stays testable without a bus.
   *
   * Screens beyond `title`/`loading` land with their phases (P3+); each is one
   * `case` here plus one pure module, never a branch inside a screen.
   */
  draw(c: UiContext, w: number, h: number, s: number): ShellDrawResult {
    switch (this.top()) {
      case 'loading':
        drawLoadingScreen(c, w, h, s, this.loadingView());
        return INERT_DRAW;
      case 'title': {
        const title = drawTitleScreen(c, w, h, s, this.titleView());
        return title ? { ...INERT_DRAW, title } : INERT_DRAW;
      }
      case 'save': {
        const save = drawSaveScreen(c, w, h, s, this.saveView());
        return save ? { ...INERT_DRAW, save } : INERT_DRAW;
      }
      case 'load': {
        const load = drawLoadScreen(c, w, h, s, this.loadView());
        return load ? { ...INERT_DRAW, load } : INERT_DRAW;
      }
      case 'settings': {
        // Unlike the other screens, this can't collapse to `INERT_DRAW` when no
        // action fired: the GAMEPLAY tab's island rect must be reported EVERY
        // frame it's on screen, or the DOM form loses its position the instant
        // nothing was clicked (see `SettingsDrawResult`'s doc).
        const res = drawSettingsScreen(c, w, h, s, this.buildSettingsView());
        return { ...INERT_DRAW, island: res.island, settings: res.action };
      }
      case 'gameover': {
        const gameover = drawGameOverScreen(c, w, h, s, this.gameoverView());
        return gameover ? { ...INERT_DRAW, gameover } : INERT_DRAW;
      }
      case 'photo':
        // Always returns null (see `photo-screen.ts`'s header) — drawn purely
        // for its fading hint's side effect, same idiom as the loading screen.
        drawPhotoScreen(c, w, h, s, this.photoView());
        return INERT_DRAW;
      case 'newgame': {
        // Same "can't collapse to INERT_DRAW" reasoning as settings' GAMEPLAY
        // tab: the paste field's island rect must be reported every frame this
        // screen is up.
        const res = drawNewGameScreen(c, w, h, s, this.newGameView());
        return { ...INERT_DRAW, island: res.island, newgame: res.action };
      }
      case 'hall': {
        const hall = drawHallScreen(c, w, h, s, this.hallView(), this.hallDomain);
        return hall ? { ...INERT_DRAW, hall } : INERT_DRAW;
      }
      case null:
        return INERT_DRAW;
      default:
        // A screen is on the stack but has no drawer yet (a phase not landed).
        // Paint nothing rather than guess — an empty frame is an obvious bug,
        // whereas a silently-wrong surface is not.
        return INERT_DRAW;
    }
  }
}
