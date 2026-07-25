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

/** A device-px rect (a DOM island's reserved region). Mirrors `ui-runtime`'s. */
interface Rect { x: number; y: number; w: number; h: number }

/** What one `Shell.draw` produced: an optional DOM-island reservation and any
 *  action the player triggered. The shell reports; the caller dispatches. */
export interface ShellDrawResult {
  island: Rect | null;
  title: TitleAction | null;
  save: SaveAction | null;
  load: LoadAction | null;
}

/** Nothing drawn, nothing triggered — shared so the common case allocates once. */
const INERT_DRAW: ShellDrawResult = { island: null, title: null, save: null, load: null };

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
}

/** The title view used when no provider is wired — the honest empty state, never
 *  a fabricated "you have a save". */
const EMPTY_TITLE_VIEW: TitleView = {
  continueLine: null,
  continueBlocked: { reason: 'none', text: 'No world yet' },
  hasAnySave: false,
  buildLine: '',
};

/** Four empty slots — the honest default for the save/load screens when no
 *  provider is wired, mirroring `EMPTY_TITLE_VIEW` above. */
const EMPTY_SLOT_ROWS: readonly SlotRow[] = (['autosave', 'slot1', 'slot2', 'slot3'] as const).map((slot) => ({
  slot, name: '', dateLabel: '', tierLine: '', playtimeLabel: '',
  compat: 'ok', empty: true, thumbnail: null, staleReason: null,
}));
const EMPTY_SAVE_VIEW: SaveScreenView = { rows: [...EMPTY_SLOT_ROWS] };
const EMPTY_LOAD_VIEW: LoadScreenView = { rows: [...EMPTY_SLOT_ROWS] };

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

export class Shell implements LoadingSurface {
  private state: ShellState = EMPTY_SHELL;
  private readonly requestRender: () => void;
  private readonly now: () => number;
  private readonly titleView: () => TitleView;
  private readonly saveView: () => SaveScreenView;
  private readonly loadView: () => LoadScreenView;

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
  }

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
    }
    // Screens beyond title/loading/save/load contribute their choices as they
    // land (P4+); an unimplemented screen honestly reports none rather than
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
      // `replace`, not `push`: the title screen must not survive underneath the
      // loading screen — once generation starts there is nothing to go back to.
      this.replace('loading');
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
    if (this.top() === 'loading') this.pop();
    // Popping 'loading' off a stack that had nothing under it lands on the HUD,
    // which is exactly right: the world is up and owns the frame.
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
        return title ? { island: null, title, save: null, load: null } : INERT_DRAW;
      }
      case 'save': {
        const save = drawSaveScreen(c, w, h, s, this.saveView());
        return save ? { island: null, title: null, save, load: null } : INERT_DRAW;
      }
      case 'load': {
        const load = drawLoadScreen(c, w, h, s, this.loadView());
        return load ? { island: null, title: null, save: null, load } : INERT_DRAW;
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
