// src/render/ui/ui-runtime.ts
//
// The live UI runtime (S2/S3): the one stateful object tying the immediate-mode
// `UiContext` to the running game. It owns
//   - the per-frame INPUT snapshot (pointer pos / down / released), fed from
//     capture-phase canvas listeners so UI clicks consume BEFORE world input;
//   - the barebones HUD (a diegetic presence orb + a MENU affordance);
//   - the Esc-summoned pause menu (left nav + a game-style settings panel).
//
// It is a module singleton (`getUiRuntime()`) so the GPU render frame can pull
// draw groups without threading a reference through the renderer factory, exactly
// like the `?connectome` overlay reads its flag. The Game calls `attach()` once on
// boot to wire input + state hooks. Pure-ish: geometry build is CPU/Node-testable
// (`frame()`), only `attach()` touches the DOM.

import { UiContext, type UiInput, type UiHit, type UiScrollRegion } from '@/render/ui/ui-context';
import { uiScaleFor } from '@/render/ui/ui-layer';
import { UI_PALETTE } from '@/render/ui/ui-palette';
import { shade, withAlpha } from '@/render/ui/ui-color';
import { clamp01 } from '@/core/math';
import { UiSpace, type UiDrawGroup } from '@/render/ui/ui-batcher';
import { SettingsIsland } from '@/render/ui/ui-settings-island';
import { WhisperInputIsland } from '@/render/ui/ui-whisper-island';
import type { ProviderConfig } from '@/llm/provider-factory';
import type { StorySession, Stage } from '@/story/story-session';
import type { UiSpec, UiSpecBlock, UiSpecChoice } from '@/story/uispec';
import { validateUiSpec } from '@/story/uispec';
import type { BeliefPowerView, InboxItem, InboxKind, InspectorView, PantheonRow, SettlementPeace } from '@/game/game-query';
import type { SiteCardView } from '@/game/causal-site-view';
import type { WorldLabelView } from '@/game/affordance/world-labels';
import type { SpeechBubbleView } from '@/game/affordance/speech-bubbles';
import type { Command } from '@/sim/command/types';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { TICKS_PER_HOUR } from '@/core/calendar';

/** Bigger-font multipliers (× the integer DPR scale). The S1 demo drew at 1×s
 *  which read tiny; the HUD/menu want chunky, legible pixel text. */
const FS_TITLE = 4;
const FS_BODY = 2;

/** What the runtime needs from the game to be live. All optional so the singleton
 *  renders a sane gray-box even before `attach()`. */
export interface UiRuntimeHooks {
  /** Force a frame (pointer events must redraw even while paused/idle). */
  requestRender?: () => void;
  /** Player presence in 0..1 (drives the orb fill). */
  getPower?: () => number;
  /** Menu "NEW WORLD". */
  onNewWorld?: () => void;
  /** Menu opened/closed — the game pauses while the menu is up. */
  onMenuToggle?: (open: boolean) => void;
  /** Toggle scene lighting (settings). Returns the new state. */
  onToggleLighting?: () => boolean;
  /** Current lighting state for the settings row. */
  getLighting?: () => boolean;
  /** Persist + live-apply a new LLM provider config (from the DOM input island). */
  onSaveLlmConfig?: (cfg: ProviderConfig) => void;
  /** A story card opened/closed — the game pauses the sim while one is up. */
  onStoryToggle?: (active: boolean) => void;
  /** Free-text whisper submitted from the conversation card's DOM input island. The
   *  game routes it through the same `sendWhisper` path the canned paths use. */
  onCardFreeText?: (text: string) => void;

  // ── Track B: belief-granted powers + the divine inbox ──
  /** The belief-granted powers to render in the skill panel (default []). */
  getBeliefPowers?: () => BeliefPowerView[];
  /** Cast an unlocked power (the Game picks/uses the current target). */
  onCastPower?: (verb: string) => void;
  /** Verb-first targeting in progress (reticle), or null — drives the aim hint bar. */
  getTargeting?: () => { label: string } | null;
  /** Top ranked affordances for whatever the cursor rests on — queried ONCE per
   *  dwell and frozen (the game resolves + freezes the target). Null ⇒ no popover. */
  getHoverAffordances?: () => { chips: HoverChipView[] } | null;
  /** Fire a hover-popover chip (the game acts on its frozen hover target). */
  onHoverChip?: (verb: string) => void;

  // ── P3.8: the target-first inspector (zoom-in focus surface) ──
  /** The inspector payload for the current selection, or null (no selection). */
  getInspector?: () => InspectorView | null;
  /** Cast a verb from the inspector's affordance list (acts on the selection). */
  onInspectorCast?: (verb: string) => void;
  /** Dismiss the inspector (clears the selection). */
  onCloseInspector?: () => void;
  /** The triageable divine-inbox items, salience-ranked (default []). */
  getInbox?: () => InboxItem[];
  /** Triage: act on an item (route to the matching divine action). */
  onInboxAct?: (item: InboxItem) => void;
  /** Triage: investigate (focus the subject — mind page / backfill). */
  onInboxInvestigate?: (item: InboxItem) => void;

  // ── W4 (D9): the chronicle browser — the inbox panel's ANNALS mode. ──
  /** Past daily annals, newest first (default []). Plain display data — the
   *  game glue reads `ChronicleService.entries()`. */
  getAnnals?: () => AnnalRow[];

  // ── W4 (D7): the pantheon panel (rivals finally visible) ──
  /** The pantheon roster — player first, then rivals by follower count desc
   *  (default []). */
  getPantheon?: () => PantheonRow[];
  /** Click a rival row: the game flies to + focuses its strongest settlement.
   *  Never fires for the player's own row. */
  onPantheonRow?: (id: string) => void;

  // ── P5 semantic zoom: the zoomed-out alert pins (inbox as world markers) ──
  /** Top-N inbox items projected to on-screen DEVICE-px pin centres, or null when
   *  the camera is in the zoomed-IN band (the game owns the band decision + the
   *  world→screen projection so a pin stays pixel-snapped as the camera moves). */
  getAlertPins?: () => AlertPinView[] | null;
  /** Click a world alert pin: the game camera-flies to it, then acts on the item. */
  onAlertPin?: (id: string) => void;

  // ── UI v2 W1/D4: World-band map typography (settlement name labels) ──
  /** Settlement labels for the World band, or null outside it — the game owns the
   *  band gate + the world→screen projection so a label stays pixel-snapped as the
   *  camera moves (same idiom as `getAlertPins`; alert pins stay parked, this is
   *  their sanctioned World-space replacement — text, not floating icons). */
  getWorldLabels?: () => WorldLabelView[] | null;
  /** Click a settlement label: the game focuses that settlement + flies to it. */
  onWorldLabel?: (poiId: string) => void;

  // ── "A Town You Can Watch" Phase 3: real-time dialog bubbles ──
  /** Live spoken lines over speakers' heads, or null in the world band. Views are
   *  already world→screen projected (device px) + carry a fade alpha; the game
   *  owns the projection so a bubble tracks its walking speaker with no swim. */
  getSpeechBubbles?: () => SpeechBubbleView[] | null;

  // ── W-I-d: the selected CAUSAL SITE card (flood plain / drowned village) ──
  /** The card view for the currently-selected causal site, or null. The runtime
   *  draws nothing when this returns null (no selection). */
  getSelectedSite?: () => SiteCardView | null;
  /** Dismiss the site card (clears `state.selectedCausalSiteId`). */
  onCloseSite?: () => void;

  // ── legacy-chrome L0: camera cluster (HUD) ──
  /** Camera cluster (HUD). When all four are set, the HUD draws zoom controls. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  onZoomActual?: () => void;

  // ── Round 9 WP-B: time transport (fastforward + jump-to-next-event) ──
  /** Snapshot of the sim clock's transport state. The cluster renders nothing
   *  (gray-box) until this is wired. */
  timeStatus?: () => TimeStatus;
  /** Dispatch a transport command (rate change / pause toggle / seek / cancel). */
  onTimeCommand?: (cmd: TimeCommand) => void;
}

// ── Round 9: time transport (fastforward + jump-to-next-event) ──────────────
// The host (game.ts) owns the sim clock; the runtime only renders a snapshot
// + relays clicks as commands. `TimeController` (WP-A, `src/game/time-controller.ts`)
// is the eventual source of truth for `requestedRate`/`effectiveRate`/`seeking`;
// until it lands the host falls back to `scheduler.getRate()` (see game.ts).

/** A snapshot of the sim clock's transport state, prebuilt by the host each frame. */
export interface TimeStatus {
  requestedRate: number;
  effectiveRate: number;
  /** Rate-ladder presets (measured, not guessed — never hardcoded by the UI). */
  ladder: number[];
  /** Soft pause = rate 0 (distinct from the hard pause the space key drives). */
  paused: boolean;
  /** Calendar date + solar time, prebuilt by the host (`calendarLabel`). */
  clockLabel: string;
  /** Non-null while a "jump to next event" seek is in flight. */
  seeking: null | { elapsedTicks: number; horizonTicks: number };
}

/** A transport command the HUD can dispatch — relayed verbatim to the host. */
export type TimeCommand =
  | { kind: 'set_rate'; rate: number }
  | { kind: 'toggle_pause' }
  | { kind: 'skip_to_next_event' }
  | { kind: 'cancel_seek' };

/** Which bottom-left side panel is open (mutually exclusive; below menu/story). */
type Panel = 'powers' | 'inbox' | 'pantheon' | null;

/** W4 (D9): one browsable chronicle entry — the inbox panel's ANNALS list row.
 *  `day` is a display ordinal (the chronicler's calendar day index), never a
 *  raw tick. Plain data; the game glue reads `ChronicleService.entries()`. */
export interface AnnalRow {
  day: number;
  title: string;
  body: string;
}

/** Which sub-view the divine-inbox panel shows (W4/D9): the triageable items
 *  (default) or the chronicle browser. */
type InboxMode = 'tidings' | 'annals';

type Section = 'settings' | null;

/** A device-px rect (the DOM island's reserved region). */
interface Rect { x: number; y: number; w: number; h: number }

/** A hover-popover chip (game-derived; the runtime only draws + reports clicks). */
export interface HoverChipView {
  verb: string;
  label: string;
  cost: number;
  unlocked: boolean;
  affordable: boolean;
  why: string | null;
}

/** A frozen hover popover: the chips + the cursor anchor + the last-drawn rect. */
interface HoverPopover { ax: number; ay: number; chips: HoverChipView[]; rect: Rect }

/** A world-anchored alert pin (P5 zoomed-out surface). The game projects the inbox
 *  item's world anchor to a DEVICE-px centre each frame; the runtime only draws the
 *  marker + reports clicks. */
export interface AlertPinView {
  id: string;
  /** Inbox kind, or `selection` — the collapsed inspector's subject rendered as a
   *  distinct pin so the selection survives zooming out (spec §6). */
  kind: InboxKind | 'selection';
  /** Pin centre in device px (already world→screen projected + pixel-snapped). */
  x: number;
  y: number;
  /** Fate-surfaced — ranks first + drawn on top with the accent tint. */
  surfaced: boolean;
}

/** Dwell before the hover popover appears (ms) + the grace margin (device px) that
 *  keeps it open as the cursor travels from the anchor onto the chips. */
const HOVER_DWELL_MS = 120;
const HOVER_GRACE_PX = 24;

/** D2: rows a `scrollList` steps per wheel notch. */
const SCROLL_ROWS_PER_NOTCH = 3;

// ── D10: quiet chrome + band-change label fade (polish wave) ────────────────
// Two distinct treatments, per the spec: the time/camera clusters RECEDE (an
// alpha dim, not a layout collapse — see `drawTimeCluster`/`drawCameraCluster`
// for why a true collapse-on-hover was rejected) while non-primary; world
// labels FADE across a band change (an actual alpha ramp over time, since a
// snap on/off reads as a glitch when the whole map's typography flips).

/** D10: paint alpha for a cluster's non-primary controls while the pointer
 *  isn't over the cluster's own footprint (1 = full strength, hovered). */
const CHROME_DIM_ALPHA = 0.35;

/** D10: how long the world-label band-change fade ramps, in ms. */
const LABEL_FADE_MS = 150;

/** Injectable timer seam (real timers in the app; a manual clock in tests). */
export interface UiTimers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}
const REAL_TIMERS: UiTimers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
};

export class UiRuntime {
  private ctx = new UiContext();
  private hooks: UiRuntimeHooks = {};

  // pointer state (device px)
  private ptr = { x: -1, y: -1, down: false };
  private pendingReleased = false;

  private menuOpen = false;
  private section: Section = null;

  /** The story card currently on screen (modal narrative beat), or null. */
  private story: StorySession | null = null;

  /** A declarative UiSpec card on screen (the whisper card, P4), or null. Modal for
   *  INPUT like the story card. A chosen option calls `onChoose`; a one-shot card then
   *  dismisses, a `keepOpen` card (the conversation card) stays and is re-presented by
   *  the game via `updateOpenCard`. `keepOpen` cards deliberately do NOT pause the sim:
   *  a whisper is applied on a tick (the deterministic belief floor), so time must keep
   *  running for a multi-turn exchange to land its effects live. */
  private card: {
    spec: UiSpec;
    onChoose: (choice: UiSpecChoice) => void;
    keepOpen: boolean;
  } | null = null;

  /** Open bottom-left side panel (powers / inbox / pantheon), or null. Non-modal. */
  private panel: Panel = null;
  /** Inbox item ids the player has dismissed this session (local triage state). */
  private ignoredInbox = new Set<string>();
  /** W4 (D9): the inbox panel's sub-view (tidings list vs. chronicle browser). */
  private inboxMode: InboxMode = 'tidings';

  /** Hit regions claimed by the LAST built frame — used by capture-phase input to
   *  decide whether a pointer-down belongs to the UI (consume) or the world. */
  private lastHits: readonly UiHit[] = [];
  /** D2: `scrollList` regions claimed by the LAST built frame — used by the
   *  capture-phase wheel listener to decide whether a wheel tick steps a list's
   *  rows (consume) or falls through to the world camera zoom. */
  private lastScrollRegions: readonly UiScrollRegion[] = [];

  /** DOM input island (provider/model/key). Its target region is returned by
   *  drawMenu each frame (a local — avoids `this`-field narrowing pitfalls). */
  private island: SettingsIsland | null = null;

  /** DOM input island for the conversation card's free-text field. Its target region
   *  is returned by `renderUiSpec` each frame (only for `keepOpen` conversation cards). */
  private whisperIsland: WhisperInputIsland | null = null;

  /** The frozen hover popover currently on screen (dwell → freeze), or null. */
  private hover: HoverPopover | null = null;
  /** Pending dwell timer id (armed on move, fires the popover), or null. */
  private dwellId: number | null = null;
  private readonly timers: UiTimers;

  /** D10: a monotonic frame clock — `frame()`'s `nowMs` when the caller supplies
   *  one (the live game always does, threading the render frame's own
   *  `performance.now()`; see `gpu-render-frame.ts`), else a synthetic ~60fps
   *  tick so tests that never pass a timestamp still get a well-defined, if
   *  fake, elapsed time for the label fade below. Never serialized. */
  private clockMs = 0;

  /** D10: world-label band-change fade. `wasWorldLabelsVisible` is the last
   *  frame's visibility (the flip trigger); `frozenWorldLabels` is a snapshot
   *  kept fresh WHILE visible so a fade-OUT still has something to paint for
   *  its whole ~150ms (the hook itself goes null/empty the INSTANT the band
   *  leaves, so it can't supply positions for the ramp's later frames —
   *  overwriting the snapshot with that null every frame would truncate the
   *  fade to one frame). `labelFadeDir`/`labelFadeStartMs` track the in-flight
   *  ramp. All transient, never serialized (same durability class as `hover` /
   *  scroll offsets above). */
  private wasWorldLabelsVisible = false;
  private frozenWorldLabels: WorldLabelView[] | null = null;
  private labelFadeDir: 'in' | 'out' = 'in';
  private labelFadeStartMs: number | null = null;

  constructor(timers: UiTimers = REAL_TIMERS) {
    this.timers = timers;
  }

  configure(hooks: UiRuntimeHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  isMenuOpen(): boolean {
    return this.menuOpen;
  }

  /** Whether a story card is currently on screen. */
  hasStory(): boolean {
    return this.story !== null;
  }

  /** Whether a declarative UiSpec card (whisper card) is currently on screen. */
  hasCard(): boolean {
    return this.card !== null;
  }

  /**
   * Present a declarative `UiSpec` as a modal card (the whisper card, P4). A chosen
   * option invokes `onChoose(choice)` — the game emits the choice's pre-paired
   * `Command`. A one-shot card then dismisses; a `keepOpen` card (the conversation
   * card) stays open and the game re-presents an updated spec via `updateOpenCard`.
   * Supersedes any hover popover and is mutually exclusive with a running story
   * session. A one-shot card pauses the sim (`onStoryToggle`); a `keepOpen` card does
   * NOT — the whisper floor applies on a tick, so a conversation needs time to run.
   */
  presentUiSpec(
    spec: UiSpec,
    onChoose: (choice: UiSpecChoice) => void,
    opts?: { keepOpen?: boolean },
  ): void {
    this.clearHover();
    this.story = null; // the card and the runner-driven story card never coexist
    const keepOpen = opts?.keepOpen ?? false;
    this.card = { spec, onChoose, keepOpen };
    if (!keepOpen) this.hooks.onStoryToggle?.(true);
    this.hooks.requestRender?.();
  }

  /** Swap the spec of the currently-open card in place (immediate-mode: next frame
   *  redraws). The game calls this after an async whisper reply resolves, so the
   *  conversation card grows a turn without dismissing. No-op if no card is open. */
  updateOpenCard(spec: UiSpec): void {
    if (!this.card) return;
    this.card = { ...this.card, spec };
    this.hooks.requestRender?.();
  }

  private dismissCard(): void {
    if (!this.card) return;
    const wasPausing = !this.card.keepOpen;
    this.card = null;
    if (wasPausing) this.hooks.onStoryToggle?.(false);
    this.hooks.requestRender?.();
  }

  /**
   * Present a storylet as a modal card. The runtime OWNS starting it (the caller
   * passes an un-started session + the storylet id to enter), so the first stage
   * is pumped here. A pack that yields nothing (immediate end / no eligible
   * storylet) is dropped silently. Pauses the sim via `onStoryToggle`.
   */
  presentStory(session: StorySession, startId?: string): void {
    try {
      session.start(startId);
    } catch {
      return; // no eligible storylet / bad id — never crash the frame
    }
    if (session.done) return;
    this.clearHover(); // the modal card supersedes any hover popover
    this.card = null;  // mutually exclusive with a declarative UiSpec card
    this.story = session;
    this.hooks.onStoryToggle?.(true);
    this.hooks.requestRender?.();
  }

  /**
   * Present the "while you watched the sands…" landing summary after a
   * `skip_to_next_event` seek lands (Round 9 WP-B). Rides the SAME declarative
   * UiSpec surface as the whisper card (`presentUiSpec`/`renderUiSpec`) rather
   * than a bespoke renderer — title + body paragraph + elapsed-span line, one
   * dismiss choice. The choice carries an inert placeholder `Command` (never
   * emitted — this card is purely informational) purely to satisfy
   * `UiSpecChoice`'s typed field; dismissing just closes the card.
   */
  showTimeLandingCard(card: { title: string; body: string; elapsedLabel: string; quiet: boolean }): void {
    // A quiet landing renders as a plain paragraph; an eventful one borrows the
    // `omen` block's accent tint so the triggering event reads as notable.
    const bodyBlock: UiSpecBlock = card.quiet
      ? { kind: 'paragraph', text: card.body }
      : { kind: 'omen', text: card.body };
    const spec: UiSpec = {
      title: card.title,
      body: [bodyBlock, { kind: 'paragraph', text: card.elapsedLabel }],
      choices: [{ text: 'Continue', command: TIME_LANDING_DISMISS_COMMAND }],
    };
    this.presentUiSpec(spec, () => {});
  }

  /** Whether a pointer at (px,py device) should be eaten by the UI. The menu and
   *  an open story card are modal (eat everything); the HUD only eats taps on its
   *  own widgets. */
  consumesPointer(px: number, py: number): boolean {
    if (this.menuOpen || this.story || this.card) return true;
    return this.lastHits.some((h) => px >= h.x && px < h.x + h.w && py >= h.y && py < h.y + h.h);
  }

  /** Hit regions claimed by the last built frame (for an external router / tests). */
  hitRegions(): readonly UiHit[] {
    return this.lastHits;
  }

  /** D2: `scrollList` regions claimed by the last built frame (for tests). */
  scrollRegions(): readonly UiScrollRegion[] {
    return this.lastScrollRegions;
  }

  /** D2: the id of the `scrollList` region at (px,py device), or null. Exposed for
   *  the wheel router (below) and for tests. */
  scrollRegionAt(px: number, py: number): string | null {
    const r = this.lastScrollRegions.find((rr) => px >= rr.x && px < rr.x + rr.w && py >= rr.y && py < rr.y + rr.h);
    return r ? r.id : null;
  }

  /**
   * D2 wheel routing: if (px,py) sits over a `scrollList` region registered last
   * frame, step that list `SCROLL_ROWS_PER_NOTCH` rows (signed by `deltaY`) and
   * return true — the caller (a capture-phase DOM listener, see `attach`) must then
   * suppress the event so it never reaches the world camera's own wheel zoom.
   * Returns false (no-op) when the pointer isn't over any scroll region, letting
   * the event fall through to world zoom untouched.
   */
  wheel(px: number, py: number, deltaY: number): boolean {
    const id = this.scrollRegionAt(px, py);
    if (id == null || deltaY === 0) return false;
    this.ctx.scrollBy(id, Math.sign(deltaY) * SCROLL_ROWS_PER_NOTCH);
    this.hooks.requestRender?.();
    return true;
  }

  // ── input edges (called by the canvas listeners in attach, and by tests) ──
  pointerMove(px: number, py: number): void {
    this.ptr.x = px;
    this.ptr.y = py;
    this.updateHover(px, py);
    this.hooks.requestRender?.();
  }

  /** Hover-popover lifecycle on move: a shown popover stays while the cursor is in
   *  its grace zone; otherwise (re)arm the dwell timer. Suppressed while a modal
   *  (menu / story card) owns the screen. */
  private updateHover(px: number, py: number): void {
    if (this.menuOpen || this.story || this.card) { this.clearHover(); return; }
    if (this.hover) {
      if (this.withinGrace(px, py)) return; // sticky — don't re-dwell under the card
      this.hover = null;
    }
    if (this.dwellId != null) this.timers.clear(this.dwellId);
    this.dwellId = this.timers.set(() => { this.dwellId = null; this.handleDwell(); }, HOVER_DWELL_MS);
  }

  /** Dwell elapsed: ask the game for the frozen target's chips; show if any. Public
   *  so tests can fire the dwell deterministically without a real timer. */
  handleDwell(): void {
    if (this.menuOpen || this.story || this.card) return;
    const hv = this.hooks.getHoverAffordances?.();
    if (!hv || hv.chips.length === 0) return;
    // rect is filled at draw time; the anchor freezes the target the game resolved.
    this.hover = { ax: this.ptr.x, ay: this.ptr.y, chips: hv.chips, rect: { x: 0, y: 0, w: 0, h: 0 } };
    this.hooks.requestRender?.();
  }

  private clearHover(): void {
    if (this.dwellId != null) { this.timers.clear(this.dwellId); this.dwellId = null; }
    this.hover = null;
  }

  /** Whether (px,py) is within the shown popover's rect or the anchor→card corridor
   *  (plus a margin) — the grace zone that keeps the popover from flickering shut. */
  private withinGrace(px: number, py: number): boolean {
    const h = this.hover;
    if (!h) return false;
    const x0 = Math.min(h.rect.x, h.ax) - HOVER_GRACE_PX;
    const y0 = Math.min(h.rect.y, h.ay) - HOVER_GRACE_PX;
    const x1 = Math.max(h.rect.x + h.rect.w, h.ax) + HOVER_GRACE_PX;
    const y1 = Math.max(h.rect.y + h.rect.h, h.ay) + HOVER_GRACE_PX;
    return px >= x0 && px <= x1 && py >= y0 && py <= y1;
  }
  pointerDown(px: number, py: number): void {
    this.ptr.x = px;
    this.ptr.y = py;
    this.ptr.down = true;
    this.hooks.requestRender?.();
  }
  pointerUp(px: number, py: number): void {
    this.ptr.x = px;
    this.ptr.y = py;
    this.ptr.down = false;
    this.pendingReleased = true; // consumed by the next frame() as the click edge
    this.hooks.requestRender?.();
  }

  /** Toggle the pause menu (Esc / gear). */
  toggleMenu(): void {
    this.setMenu(!this.menuOpen);
  }
  private setMenu(open: boolean): void {
    if (open === this.menuOpen) return;
    this.clearHover(); // a popover must never linger behind the modal menu
    this.menuOpen = open;
    this.section = open ? 'settings' : null;
    this.hooks.onMenuToggle?.(open);
    this.hooks.requestRender?.();
  }

  /**
   * Attach to the live canvas: capture-phase pointer + Esc key listeners, plus a
   * capture-phase WHEEL listener on `window` (D2 — see below). Capture phase +
   * `stopPropagation()` alone stops the pointer event ITSELF from reaching
   * `attachControls` (pan/zoom/divine clicks), but the browser still separately
   * synthesizes compat `mousedown`/`mouseup`/`mousemove` events afterward unless
   * `preventDefault()` is ALSO called — `controls.ts` listens to those compat
   * events, not `pointerdown`/`pointerup`, so without `preventDefault()` a UI click
   * used to fall through as a world click/pan underneath the panel (D3 fix: both
   * calls now fire together whenever `consumesPointer` is true). Returns a teardown fn.
   */
  attach(canvas: HTMLCanvasElement): () => void {
    // The DOM input island lives in the canvas's positioned container so its
    // css-px coords share the canvas origin.
    const container = canvas.parentElement;
    if (container && !this.island) {
      this.island = new SettingsIsland(container, (cfg) => this.hooks.onSaveLlmConfig?.(cfg));
    }
    if (container && !this.whisperIsland) {
      this.whisperIsland = new WhisperInputIsland(container, (text) => this.hooks.onCardFreeText?.(text));
    }
    const toDevice = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = canvas.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / Math.max(1, r.width)) * canvas.width;
      const sy = ((e.clientY - r.top) / Math.max(1, r.height)) * canvas.height;
      return [sx, sy];
    };
    const move = (e: PointerEvent) => {
      const [x, y] = toDevice(e);
      this.pointerMove(x, y);
      if (this.menuOpen) e.stopPropagation();
    };
    const down = (e: PointerEvent) => {
      const [x, y] = toDevice(e);
      if (this.consumesPointer(x, y)) { e.stopPropagation(); e.preventDefault(); }
      this.pointerDown(x, y);
    };
    const up = (e: PointerEvent) => {
      const [x, y] = toDevice(e);
      const consume = this.consumesPointer(x, y);
      this.pointerUp(x, y);
      if (consume) { e.stopPropagation(); e.preventDefault(); }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.card) this.dismissCard(); // Esc cancels the card before it reaches the menu
        else this.toggleMenu();
        e.stopPropagation(); // pause menu owns Esc (supersedes time-bar dismiss)
        e.preventDefault();
      }
    };
    // D2: a scroll-region wheel tick must beat `attachControls`' own `wheel`
    // listener on this SAME canvas — but same-element listeners fire in
    // REGISTRATION order regardless of the capture flag (capture only outranks
    // listeners on ANCESTORS). So this listens on `window`, capture:true: the
    // window's capturing phase always runs before the event reaches the canvas
    // target, letting `stopPropagation()` here keep it from ever arriving.
    // Off-canvas / off-region wheels are untouched (`wheel()` returns false).
    const onWheel = (e: WheelEvent) => {
      const [x, y] = toDevice(e);
      if (this.wheel(x, y, e.deltaY)) { e.preventDefault(); e.stopPropagation(); }
    };
    // capture phase so we run before attachControls' bubble-phase handlers
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => {
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('wheel', onWheel, true);
      this.island?.destroy();
      this.island = null;
      this.whisperIsland?.destroy();
      this.whisperIsland = null;
    };
  }

  /** Build this frame's UI draw groups (device px, integer DPR scale). `nowMs`
   *  is the render frame's own clock (D10: the label fade's elapsed-time base)
   *  — the live game threads `performance.now()` through from
   *  `gpu-render-frame.ts`; omitted (tests that don't care about fade timing)
   *  it falls back to a synthetic ~60fps tick so `frame()` stays callable with
   *  its original 3-arg shape. */
  frame(wDev: number, hDev: number, dpr: number, nowMs?: number): UiDrawGroup[] {
    this.clockMs = nowMs ?? this.clockMs + 16.7;
    const c = this.ctx;
    const input: UiInput = {
      px: this.ptr.x,
      py: this.ptr.y,
      down: this.ptr.down,
      released: this.pendingReleased,
    };
    this.pendingReleased = false;
    c.begin(input);

    const s = uiScaleFor(dpr);
    let r: Rect | null = null; // settings island target (menu)
    let whisperRect: Rect | null = null; // whisper input island target (conversation card)
    if (this.menuOpen) {
      const clickAt = input.released ? { x: input.px, y: input.py } : null;
      r = this.drawMenu(c, wDev, hDev, s, clickAt);
    } else if (this.card) {
      const clickAt = input.released ? { x: input.px, y: input.py } : null;
      whisperRect = this.renderUiSpec(c, wDev, hDev, s, this.card.spec, clickAt);
    } else if (this.story) {
      this.drawStory(c, wDev, hDev, s);
    } else {
      this.drawHud(c, wDev, hDev, s, this.clockMs);
    }

    const { hits, scrollRegions } = c.end();
    this.lastHits = hits;
    this.lastScrollRegions = scrollRegions;

    // Position/show the DOM input islands over their GPU targets (device→css px):
    // the provider form over the settings panel, the free-text field over the
    // conversation card's input row. Each hides when its target isn't on screen.
    if (this.island) {
      if (r) {
        this.island.layout({ x: r.x / dpr, y: r.y / dpr, w: r.w / dpr, h: r.h / dpr });
        this.island.show();
      } else {
        this.island.hide();
      }
    }
    if (this.whisperIsland) {
      if (whisperRect) {
        this.whisperIsland.layout({ x: whisperRect.x / dpr, y: whisperRect.y / dpr, w: whisperRect.w / dpr, h: whisperRect.h / dpr });
        this.whisperIsland.show();
      } else {
        this.whisperIsland.hide();
      }
    }
    return c.batcher.flush();
  }

  // ── barebones HUD: a single presence orb that also opens the menu ─────────
  private drawHud(c: UiContext, w: number, h: number, s: number, nowMs: number): void {
    // UI v2 W1/D4: World-band settlement labels are map typography, drawn FIRST
    // so every other HUD surface below wins any overlap (same rule the parked
    // alert pins followed) — the World band IS the map.
    this.drawWorldLabels(c, w, h, s, nowMs);
    // Phase 3: dialog bubbles ride just above the labels — town life over the map.
    this.drawSpeechBubbles(c, w, h, s);

    const pad = 16 * s;
    const orb = 30 * s;
    const ox = pad;
    const oy = h - orb - pad;
    const power = clamp01(this.hooks.getPower?.() ?? 0);

    // The orb IS the menu button: a click anywhere on it (or its hint) opens the
    // pause menu. Register the hotspot first so `hot()` reflects this frame.
    const clicked = c.hotspot('ui.orb', ox, oy, orb, orb);
    const hot = c.hot() === 'ui.orb';

    // orb: dark socket + accent fill rising with power + bright rim (gray-box;
    // a true round emissive orb is the S3.5 skin pass). Brightens on hover.
    c.rect(ox, oy, orb, orb, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.85));
    const fill = Math.round(orb * power);
    const accent = hot ? shade(UI_PALETTE.accent, 0.25) : UI_PALETTE.accent;
    if (fill > 0) c.rect(ox, oy + (orb - fill), orb, fill, accent);
    c.batcher.border(ox, oy, orb, orb, Math.max(1, Math.round(s * (hot ? 2 : 1))), accent);

    // tiny "MENU" hint to the orb's right so the affordance is discoverable.
    c.label('MENU', ox + orb + 10 * s, oy + (orb - c.lineHeight(FS_BODY * s)) / 2,
      FS_BODY * s, hot ? UI_PALETTE.text : UI_PALETTE.textDim);

    if (clicked) this.setMenu(true);

    // ── P5 semantic zoom: the zoomed-out inbox as world-anchored alert pins ──
    // Drawn first so the bottom-strip / inspector chrome wins any overlap hit-test.
    this.drawAlertPins(c, w, h, s);

    // ── Track B affordances: POWERS + INBOX toggles along the bottom strip ──
    const bh = 28 * s;
    const by = h - bh - pad;
    let bx = ox + orb + 64 * s;
    const powers = this.hooks.getBeliefPowers?.() ?? [];
    const unlocked = powers.filter((p) => p.unlocked).length;
    const pLabel = `⚡ POWERS${unlocked > 0 ? ` (${unlocked})` : ''}`;
    const pw = Math.ceil(c.measure(pLabel, FS_BODY * s)) + 24 * s;
    if (c.button('ui.powers', pLabel, bx, by, pw, bh, { scale: FS_BODY * s })) {
      this.panel = this.panel === 'powers' ? null : 'powers';
    }
    bx += pw + 10 * s;

    const inbox = (this.hooks.getInbox?.() ?? []).filter((it) => !this.ignoredInbox.has(it.id));
    const iLabel = `✉ INBOX${inbox.length > 0 ? ` (${inbox.length})` : ''}`;
    const iw = Math.ceil(c.measure(iLabel, FS_BODY * s)) + 24 * s;
    if (c.button('ui.inbox', iLabel, bx, by, iw, bh, { scale: FS_BODY * s })) {
      this.panel = this.panel === 'inbox' ? null : 'inbox';
    }
    bx += iw + 10 * s;

    // ── W4 (D7): the pantheon panel — the rival roster finally visible.
    // Plain text, no icon prefix (the pixel font renders only its documented
    // symbol set — no new glyph, per the epic's rule).
    const pantheon = this.hooks.getPantheon?.() ?? [];
    const sLabel = `SPIRITS${pantheon.length > 0 ? ` (${pantheon.length})` : ''}`;
    const sw = Math.ceil(c.measure(sLabel, FS_BODY * s)) + 24 * s;
    if (c.button('ui.pantheon', sLabel, bx, by, sw, bh, { scale: FS_BODY * s })) {
      this.panel = this.panel === 'pantheon' ? null : 'pantheon';
    }

    if (this.panel === 'powers') this.drawPowers(c, w, h, s, powers, by - pad);
    else if (this.panel === 'inbox') this.drawInbox(c, w, h, s, inbox, by - pad);
    else if (this.panel === 'pantheon') this.drawPantheon(c, w, h, s, pantheon, by - pad);

    const site = this.hooks.getSelectedSite?.() ?? null;
    if (site) this.drawSiteCard(c, w, s, site);

    // ── P3.8 inspector: a right-docked panel for the current selection ──
    const inspector = this.hooks.getInspector?.() ?? null;
    const inspectorW = inspector ? this.drawInspector(c, w, h, s, inspector) : 0;

    // ── Round 9 WP-B: time transport cluster (top-right; tucks left of the inspector) ──
    this.drawTimeCluster(c, w, h, s, inspectorW ? inspectorW + 16 * s : 0);

    // camera cluster tucks left of the inspector so the two never overlap.
    this.drawCameraCluster(c, w, h, s, inspectorW ? inspectorW + 16 * s : 0);

    // ── verb-first targeting: a top-centre reticle hint while aiming a cast ──
    const aim = this.hooks.getTargeting?.() ?? null;
    if (aim) {
      const fs = FS_BODY * s;
      const msg = `◎ CHOOSE A TARGET — ${aim.label.toUpperCase()}   ·   right-click to cancel`;
      const tw = Math.ceil(c.measure(msg, fs)) + 32 * s;
      const th = 34 * s;
      const tx = Math.round((w - tw) / 2);
      const ty = 16 * s;
      c.panel(tx, ty, tw, th);
      c.label(msg, tx + 16 * s, ty + (th - c.lineHeight(fs)) / 2, fs, UI_PALETTE.accent);
    }

    // ── hover popover: top ranked affordance chips at the cursor (dwell → freeze) ──
    if (this.hover && !aim) this.drawHover(c, w, h, s);
  }

  /** The frozen hover popover: a small stack of chip buttons anchored at the cursor.
   *  A castable chip fires its verb; locked / unaffordable chips render disabled. */
  private drawHover(c: UiContext, w: number, h: number, s: number): void {
    const pop = this.hover!;
    const fs = FS_BODY * s;
    const pad = 10 * s;
    const rowH = 26 * s;
    const gap = 4 * s;
    const labels = pop.chips.map((ch) => hoverChipLabel(ch));
    let widest = 0;
    for (const l of labels) widest = Math.max(widest, c.measure(l, fs));
    const pw = Math.ceil(widest) + pad * 2;
    const ph = pad * 2 + pop.chips.length * rowH + Math.max(0, pop.chips.length - 1) * gap;

    // anchor lower-right of the cursor, clamped to stay on-screen
    let x = pop.ax + 18 * s;
    let y = pop.ay + 18 * s;
    if (x + pw > w) x = Math.max(0, pop.ax - pw - 18 * s);
    if (y + ph > h) y = Math.max(0, h - ph);
    pop.rect = { x, y, w: pw, h: ph };

    c.panel(x, y, pw, ph);
    let ry = y + pad;
    pop.chips.forEach((ch, i) => {
      const castable = ch.unlocked && ch.affordable;
      if (c.button(`hover.chip.${ch.verb}`, labels[i], x + pad, ry, pw - pad * 2, rowH,
        { scale: fs, disabled: !castable })) {
        this.hooks.onHoverChip?.(ch.verb);
        this.clearHover();
        this.hooks.requestRender?.();
      }
      ry += rowH + gap;
    });
  }

  // ── UI v2 W1/D4: World-band map typography (settlement name labels) ────────
  // The parked-pins ruling holds ("no floating icons over the world") — this is
  // text pinned to places, drawn in `UiSpace.World` (same idiom `drawAlertPins`
  // used). Null ⇒ outside the world band, nothing drawn.
  private drawWorldLabels(c: UiContext, w: number, h: number, s: number, nowMs: number): void {
    // W5: while a left-side panel is open you're in a menu context, not reading
    // the map — suppress the labels so their bright text doesn't bleed through the
    // translucent panel (the panel bg is 82% opaque). They return on close.
    if (this.panel !== null) return;
    const hookLabels = this.hooks.getWorldLabels?.() ?? null;

    // D10: band-change fade. The hook's null/non-null-ness IS the band gate
    // (spec §D4), so a flip in that boolean is exactly "the band changed" —
    // (re)arm a ~150ms alpha ramp from here. Fading OUT has to paint the LAST
    // frame's labels (the hook already reports null the instant the band
    // leaves, so there's nothing current to fade); fading IN (or steady)
    // paints the current ones.
    const visibleNow = !!hookLabels && hookLabels.length > 0;
    if (visibleNow !== this.wasWorldLabelsVisible) {
      this.labelFadeDir = visibleNow ? 'in' : 'out';
      this.labelFadeStartMs = nowMs;
    }
    this.wasWorldLabelsVisible = visibleNow;
    if (visibleNow) this.frozenWorldLabels = hookLabels; // keep the snapshot fresh while visible
    const fadingOut = this.labelFadeDir === 'out';
    const labels = visibleNow ? hookLabels : fadingOut ? this.frozenWorldLabels : null;
    if (!labels || labels.length === 0) return;

    const elapsed = this.labelFadeStartMs != null ? nowMs - this.labelFadeStartMs : LABEL_FADE_MS;
    const t = clamp01(elapsed / LABEL_FADE_MS);
    const fadeAlpha = fadingOut ? 1 - t : t;
    // A fade-OUT that's run its course is steady-invisible — nothing left to
    // paint or click. A fade-IN's t=0 frame is deliberately NOT skipped even
    // though its paint alpha is 0: the label is logically in-band from the
    // instant the band engages (hit-testing/clickability track the BAND, not
    // the cosmetic ramp), only its paint eases up over the next ~150ms.
    if (fadingOut && fadeAlpha <= 0) return;

    const fs = FS_BODY * s;
    const fsSub = fs * 0.75; // contested-by: a smaller second line
    const pad = 6 * s;
    let clicked: string | null = null;
    for (const lb of labels) {
      const name = lb.name.toUpperCase();
      const badgeText = lb.badge > 0 ? ` ·${lb.badge}` : '';
      const nameW = c.measure(name, fs);
      const badgeW = badgeText ? c.measure(badgeText, fs) : 0;
      const lineW = nameW + badgeW;
      const lh = c.lineHeight(fs);
      const contested = lb.contestedBy ? lb.contestedBy.toUpperCase() : null;
      const subW = contested ? c.measure(contested, fsSub) : 0;
      const subH = contested ? c.lineHeight(fsSub) : 0;
      const boxW = Math.ceil(Math.max(lineW, subW)) + pad * 2;
      const boxH = Math.ceil(lh + subH) + pad * 2;
      const bx = Math.round(lb.x - boxW / 2);
      const by = Math.round(lb.y - boxH); // the label floats ABOVE its map anchor
      if (bx + boxW < 0 || by + boxH < 0 || bx > w || by > h) continue; // off-screen cull

      // subtle dark backing so the name reads over any terrain (spec: alpha ~0.35),
      // ramped by the band-change fade on top.
      c.rect(bx, by, boxW, boxH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.35 * fadeAlpha), UiSpace.World);
      const nameColor = withAlpha(lb.focused ? UI_PALETTE.accent : UI_PALETTE.text, fadeAlpha);
      const tx = Math.round(lb.x - lineW / 2);
      const ty = by + pad;
      c.label(name, tx, ty, fs, nameColor, UiSpace.World);
      if (badgeText) c.label(badgeText, Math.round(tx + nameW), ty, fs, withAlpha(UI_PALETTE.textDim, fadeAlpha), UiSpace.World);
      if (contested) {
        const sx = Math.round(lb.x - subW / 2);
        c.label(contested, sx, ty + lh, fsSub, withAlpha(UI_PALETTE.textDim, fadeAlpha), UiSpace.World);
      }
      // click target in screen coords (== the label's own backing rect). Only
      // live while genuinely in-band — a fading-OUT ghost is display-only (the
      // band already left, so a click on it shouldn't refocus/fly).
      if (!fadingOut && c.hotspot(`wlabel.${lb.poiId}`, bx, by, boxW, boxH)) clicked = lb.poiId;
    }
    if (clicked) {
      this.hooks.onWorldLabel?.(clicked);
      this.hooks.requestRender?.();
    }
  }

  /** Phase 3: dialog bubbles — a speaker's line in a small dark backing floated
   *  above their head, alpha from the view's fade. Display-only (no hotspot): a
   *  bubble is town ambience, not a control. Suppressed while a panel is open
   *  (you're reading a menu, not watching the town). */
  private drawSpeechBubbles(c: UiContext, w: number, h: number, s: number): void {
    if (this.panel !== null) return;
    const bubbles = this.hooks.getSpeechBubbles?.() ?? null;
    if (!bubbles || bubbles.length === 0) return;
    const fs = FS_BODY * s;
    const pad = 5 * s;
    for (const b of bubbles) {
      if (b.alpha <= 0) continue;
      const tw = c.measure(b.text, fs);
      const lh = c.lineHeight(fs);
      const boxW = Math.ceil(tw) + pad * 2;
      const boxH = Math.ceil(lh) + pad * 2;
      const bx = Math.round(b.x - boxW / 2);
      const by = Math.round(b.y - boxH); // float above the anchor
      if (bx + boxW < 0 || by + boxH < 0 || bx > w || by > h) continue;
      c.rect(bx, by, boxW, boxH, withAlpha(shade(UI_PALETTE.panelBg, -0.2), 0.72 * b.alpha), UiSpace.World);
      c.label(b.text, Math.round(b.x - tw / 2), by + pad, fs, withAlpha(UI_PALETTE.text, b.alpha), UiSpace.World);
    }
  }

  // ── P5 semantic zoom: world-anchored alert pins (the zoomed-out inbox) ──────
  // When the game reports the camera is in the zoomed-OUT band it hands back the
  // top-N inbox items projected to device-px centres; each renders as a small
  // kind-coded marker in `UiSpace.World` (so it draws beneath the HUD via the
  // world pass) plus a screen-space hotspot for clicks. No per-NPC chrome out here
  // (spec §6: aggregate visuals) — the pins ARE the surface. Null ⇒ zoomed-in band,
  // nothing drawn (the hover/inspector/list surfaces own that altitude).
  private drawAlertPins(c: UiContext, w: number, h: number, s: number): void {
    const pins = this.hooks.getAlertPins?.() ?? null;
    if (!pins || pins.length === 0) return;
    const size = Math.max(12, Math.round(18 * s));
    const half = Math.round(size / 2);
    const fs = FS_BODY * s;
    const t = Math.max(1, Math.round(2 * s));
    // Draw order (bottom→top): plain, Fate-surfaced, then the selection pin.
    const rank = (p: AlertPinView): number => (p.kind === 'selection' ? 2 : p.surfaced ? 1 : 0);
    const ordered = [...pins].sort((a, b) => rank(a) - rank(b));
    let clicked: string | null = null; // topmost clicked pin wins (one click = ONE action)
    for (const p of ordered) {
      const x = Math.round(p.x - half);
      const y = Math.round(p.y - half);
      if (x + size < 0 || y + size < 0 || x > w || y > h) continue; // off-screen cull
      const tint = p.surfaced ? UI_PALETTE.accent : pinColor(p.kind);
      // marker: dark backdrop + tinted ring, in WORLD space (renders via the world
      // pass, and a runtime test can assert the pins land in UiSpace.World).
      c.rect(x, y, size, size, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9), UiSpace.World);
      c.batcher.border(x, y, size, size, t, tint, UiSpace.World);
      const glyph = pinGlyph(p.kind);
      const gw = c.measure(glyph, fs);
      c.label(glyph, Math.round(x + (size - gw) / 2), Math.round(y + (size - c.lineHeight(fs)) / 2), fs, tint, UiSpace.World);
      // click target in screen coords (== the projected device-px marker rect).
      if (c.hotspot(`alert.${p.id}`, x, y, size, size)) clicked = p.id;
    }
    if (clicked) {
      this.hooks.onAlertPin?.(clicked);
      this.hooks.requestRender?.();
    }
  }

  // ── W-I-d: the selected causal-site card (a focused ephemeral place) ────────
  // A non-modal banner near the top centre: name, attribution, an intensity bar,
  // and the lifecycle line. The whole card registers a hotspot so a tap on it is
  // eaten by the UI (doesn't fall through to the world and deselect); the ✕ button
  // dismisses. Mirrors `drawInbox`'s panel/label/rect vocabulary.
  private drawSiteCard(c: UiContext, w: number, s: number, view: SiteCardView): void {
    const pad = 16 * s;
    const cw = 320 * s;
    const cx = Math.round((w - cw) / 2);
    const cy = pad;
    const fsName = 3 * s;
    const fsBody = FS_BODY * s;
    const nameLh = c.lineHeight(fsName);
    const lh = c.lineHeight(fsBody);
    const barH = 8 * s;
    const ch = 18 * s + nameLh + 6 * s + lh + 12 * s + barH + 10 * s + lh + 16 * s;

    c.panel(cx, cy, cw, ch);
    c.hotspot('ui.sitecard', cx, cy, cw, ch); // eat clicks on the card body

    const innerX = cx + 18 * s;
    const innerW = cw - 36 * s;
    let y = cy + 18 * s;

    c.label(view.name, innerX, y, fsName, UI_PALETTE.text);
    const close = 22 * s;
    if (c.button('ui.sitecard.close', '✕', cx + cw - close - 12 * s, cy + 12 * s, close, close, { scale: fsBody })) {
      this.hooks.onCloseSite?.();
    }
    y += nameLh + 6 * s;

    c.label(view.subtitle, innerX, y, fsBody, UI_PALETTE.textDim);
    y += lh + 12 * s;

    c.rect(innerX, y, innerW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.85));
    const fillW = Math.round(innerW * clamp01(view.intensity));
    if (fillW > 0) c.rect(innerX, y, fillW, barH, UI_PALETTE.accent);
    y += barH + 10 * s;

    c.label(view.status, innerX, y, fsBody, UI_PALETTE.textDim);
  }

  // ── P3.8 inspector: the target-first focus surface (zoom-in) ────────────────
  // A right-docked panel for the current selection (npc / settlement): full legible
  // state, what the target believes YOU command (the belief-loop feedback), and the
  // complete divine vocabulary here — locked/unaffordable verbs greyed, castable
  // ones fire on the selection. The WebGPU heir to legacy `npc-attention-panel.ts`.
  // Returns the panel width (device px) so the camera cluster can tuck beside it.
  //
  // UI v2 W2 (D5): the variable-length middle (npc: state+domains; settlement:
  // building-row + wards + recent + domains) is now ONE `scrollList` — no more
  // budget-clamp `break`. ACTS stays FIXED at the bottom-reserved position (never
  // scrolled, position invariant to the list's scroll offset — that's what "fixed"
  // means once the middle can scroll at all).
  private drawInspector(c: UiContext, w: number, h: number, s: number, view: InspectorView): number {
    const pad = 16 * s;
    const pw = 340 * s;
    const px = w - pw - pad;
    const top = pad;
    const ph = h - pad * 2;
    c.panel(px, top, pw, ph);
    c.hotspot('ui.inspector', px, top, pw, ph); // eat clicks on the body (no deselect)

    const fsName = 3 * s;
    const fsBody = FS_BODY * s;
    const lh = c.lineHeight(fsBody);
    const innerX = px + 20 * s;
    const innerW = pw - 40 * s;
    const bottom = top + ph - pad;
    let y = top + 20 * s;

    // title + subtitle + close
    c.label(view.title, innerX, y, fsName, UI_PALETTE.text);
    const close = 22 * s;
    if (c.button('ui.inspector.close', '✕', px + pw - close - 12 * s, top + 12 * s, close, close, { scale: fsBody })) {
      this.hooks.onCloseInspector?.();
    }
    y += c.lineHeight(fsName) + 4 * s;
    c.label(c.ellipsize(view.subtitle, fsBody, innerW), innerX, y, fsBody, UI_PALETTE.textDim);
    y += lh + 10 * s;

    // W3 (D6): the status-hint prose line sits fixed under the subtitle (same
    // "single fact, not a list" treatment as the settlement population/peace
    // block below) — clamped to 2 lines so a long read never eats the scroll
    // budget the TIES/domain rows need.
    if (view.kind === 'npc' && view.statusHint) {
      y = this.drawWrappedClamped(c, view.statusHint, innerX, y, innerW, fsBody, 2, UI_PALETTE.textDim);
      y += 4 * s;
    }

    // B (mind-reading): the soul's current thought — a quoted inner-monologue line
    // (deterministic, always present for an npc) sits under the stance line in the
    // accent tint, clamped to 3 lines so it never eats the scroll budget.
    if (view.kind === 'npc' && view.thought) {
      y = this.drawWrappedClamped(c, `"${view.thought}"`, innerX, y, innerW, fsBody, 3, UI_PALETTE.accent);
      y += 6 * s;
    }

    const rowH = lh + 8 * s;
    // W2 (D5): population/housing + peace/oath are single settlement-scale FACTS,
    // not a list — they sit fixed under the subtitle, never inside the scroll list.
    if (view.kind === 'settlement') {
      if (view.population !== undefined) {
        const housed = view.housing !== undefined ? ` · ${view.housing} housed` : '';
        c.label(c.ellipsize(`${view.population} souls${housed}`, fsBody, innerW), innerX, y, fsBody, UI_PALETTE.textDim);
        y += rowH;
      }
      if (view.peace) {
        c.label(c.ellipsize(peaceLine(view.peace), fsBody, innerW), innerX, y, fsBody, UI_PALETTE.textDim);
        y += rowH;
      }
      y += 4 * s;
    }

    // The affordance block is the actionable payload, so it reserves its height at
    // the bottom FIRST — the scroll list fills exactly the remaining space above it.
    const bh = 30 * s;
    const rowGap = 8 * s;
    const acts = view.affordances;
    const actsH = acts.length ? (10 * s + lh + 8 * s) + acts.length * (bh + rowGap) : 0;
    const contentLimit = bottom - actsH;

    const barH = 7 * s;
    const rows = inspectorRows(view);
    if (rows.length) {
      c.scrollList('ui.inspector.list', { x: px, y, w: pw, h: Math.max(0, contentLimit - y) }, rowH, rows.length,
        (i, rowY) => drawInspectorRow(c, rows[i], innerX, innerW, rowY, fsBody, lh, barH));
    }

    // the full divine vocabulary — FIXED at the reserved bottom position (never
    // scrolled). Target-first: the panel IS the subject, so a button needs only
    // the verb (the full `describe()` "whisper to <id>" would overflow the panel).
    if (acts.length) {
      let ay = contentLimit + 10 * s;
      c.label('ACTS', innerX, ay, fsBody, UI_PALETTE.textDim);
      ay += lh + 8 * s;
      for (const a of acts) {
        const castable = a.unlocked && a.affordable;
        const cost = a.cost > 0 ? ` · ${a.cost}` : '';
        const lock = a.unlocked ? '' : ' 🔒';
        const label = `${a.verb.replace(/_/g, ' ').toUpperCase()}${cost}${lock}`;
        if (c.button(`inspector.cast.${a.verb}`, label, innerX, ay, innerW, bh, { scale: fsBody, disabled: !castable })) {
          this.hooks.onInspectorCast?.(a.verb);
        }
        ay += bh + rowGap;
      }
    }

    return pw;
  }

  // ── skill panel: belief-granted powers, locked→unlocked with progress ──────
  private drawPowers(c: UiContext, _w: number, _h: number, s: number, powers: BeliefPowerView[], bottom: number): void {
    const pad = 16 * s;
    const pw = 360 * s;
    const px = pad;
    const top = Math.max(pad, 80 * s);
    const ph = bottom - top;
    c.panel(px, top, pw, ph);

    const innerX = px + 20 * s;
    const innerW = pw - 40 * s;
    let y = top + 20 * s;
    c.label('POWERS', innerX, y, FS_BODY * s, UI_PALETTE.textDim);
    y += c.lineHeight(FS_BODY * s) + 14 * s;

    if (powers.length === 0) {
      c.label('No powers yet. Make them believe.', innerX, y, FS_BODY * s, UI_PALETTE.textDim);
      return;
    }

    const rowH = 86 * s;
    // D2: row-granular scroll replaces the old budget-clamp `break` — the list
    // now scrolls instead of silently truncating past the panel bottom.
    c.scrollList('ui.powers.list', { x: px, y, w: pw, h: bottom - y }, rowH, powers.length, (i, rowY) => {
      const p = powers[i];
      const accent = p.unlocked ? UI_PALETTE.accent : UI_PALETTE.textDim;
      c.label(c.ellipsize(p.label.toUpperCase(), FS_BODY * s, innerW), innerX, rowY, FS_BODY * s, p.unlocked ? UI_PALETTE.text : UI_PALETTE.textDim);
      let ry = rowY + c.lineHeight(FS_BODY * s) + 6 * s;

      // progress bar: conviction vs threshold
      const barW = innerW;
      const barH = 8 * s;
      c.rect(innerX, ry, barW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
      const conv = Math.max(0, Math.min(1, p.conviction));
      if (conv > 0) c.rect(innerX, ry, Math.round(barW * conv), barH, accent);
      // threshold tick
      const tx = innerX + Math.round(barW * Math.max(0, Math.min(1, p.threshold)));
      c.rect(tx, ry - 2 * s, Math.max(1, Math.round(s)), barH + 4 * s, UI_PALETTE.text);
      ry += barH + 8 * s;

      const pct = Math.round(p.conviction * 100);
      const need = Math.round(p.threshold * 100);
      if (p.unlocked) {
        const bw = 110 * s;
        const bh = 26 * s;
        c.label(c.ellipsize(`believed by ${p.reach} — ${pct}%`, FS_BODY * s, innerW - bw - 8 * s), innerX, ry, FS_BODY * s, UI_PALETTE.textDim);
        if (c.button(`power.cast.${p.verb}`, 'CAST ⚡', innerX + innerW - bw, ry - 4 * s, bw, bh, { scale: FS_BODY * s })) {
          this.hooks.onCastPower?.(p.verb);
        }
      } else {
        c.label(c.ellipsize(`not yet believed — ${pct}% of ${need}% needed`, FS_BODY * s, innerW), innerX, ry, FS_BODY * s, UI_PALETTE.textDim);
      }
    });
  }

  // ── divine inbox: triageable prayers / opportunities / threats / tidings ───
  // W4 (D9): a TIDINGS/ANNALS toggle row leads the panel — TIDINGS is this
  // triage list (unchanged); ANNALS swaps in the chronicle browser below.
  private drawInbox(c: UiContext, _w: number, _h: number, s: number, items: InboxItem[], bottom: number): void {
    const pad = 16 * s;
    const pw = 400 * s;
    const px = pad;
    const top = Math.max(pad, 80 * s);
    const ph = bottom - top;
    c.panel(px, top, pw, ph);

    const innerX = px + 20 * s;
    const innerW = pw - 40 * s;
    const fsBody = FS_BODY * s;
    let y = top + 20 * s;

    // ── TIDINGS / ANNALS toggle row ──
    const tabH = 24 * s;
    const tabGap = 8 * s;
    const tabW = (innerW - tabGap) / 2;
    const tabs: { mode: InboxMode; label: string }[] = [
      { mode: 'tidings', label: 'TIDINGS' },
      { mode: 'annals', label: 'ANNALS' },
    ];
    let tx = innerX;
    for (const tab of tabs) {
      const selected = this.inboxMode === tab.mode;
      const clicked = c.hotspot(`ui.inbox.tab.${tab.mode}`, tx, y, tabW, tabH);
      c.rect(tx, y, tabW, tabH, selected ? withAlpha(UI_PALETTE.accent, 0.25) : withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
      c.batcher.border(tx, y, tabW, tabH, 1, selected ? UI_PALETTE.accent : UI_PALETTE.panelBorder);
      const tw = c.measure(tab.label, fsBody);
      c.label(tab.label, Math.round(tx + (tabW - tw) / 2), Math.round(y + (tabH - c.lineHeight(fsBody)) / 2),
        fsBody, selected ? UI_PALETTE.text : UI_PALETTE.textDim);
      if (clicked) { this.inboxMode = tab.mode; this.hooks.requestRender?.(); }
      tx += tabW + tabGap;
    }
    y += tabH + 14 * s;

    if (this.inboxMode === 'annals') {
      this.drawAnnals(c, px, pw, innerX, innerW, y, bottom, s);
      return;
    }

    c.label(`DIVINE INBOX (${items.length})`, innerX, y, fsBody, UI_PALETTE.textDim);
    y += c.lineHeight(fsBody) + 14 * s;

    if (items.length === 0) {
      c.label('All quiet. For now.', innerX, y, fsBody, UI_PALETTE.textDim);
      return;
    }

    const rowH = 92 * s;
    // D2: row-granular scroll replaces the old budget-clamp `break` — the list
    // now scrolls instead of silently truncating past the panel bottom.
    c.scrollList('ui.inbox.list', { x: px, y, w: pw, h: bottom - y }, rowH, items.length, (i, rowY) => {
      const it = items[i];
      const tag = it.surfaced ? UI_PALETTE.accent : kindColor(it.kind);
      // kind dot + title
      c.rect(innerX, rowY + 4 * s, 8 * s, 8 * s, tag);
      c.label(c.ellipsize(it.title, FS_BODY * s, innerW - 16 * s), innerX + 16 * s, rowY, FS_BODY * s, UI_PALETTE.text);
      let ry = rowY + c.lineHeight(FS_BODY * s) + 4 * s;
      c.label(c.ellipsize(it.detail, FS_BODY * s, innerW), innerX, ry, FS_BODY * s, UI_PALETTE.textDim);
      ry += c.lineHeight(FS_BODY * s) + 8 * s;

      // triage row: ACT · LOOK · IGNORE
      const bh = 24 * s;
      const gap = 8 * s;
      const bw = (innerW - 2 * gap) / 3;
      if (it.target.kind !== 'none' &&
          c.button(`inbox.act.${it.id}`, 'ACT', innerX, ry, bw, bh, { scale: FS_BODY * s })) {
        this.hooks.onInboxAct?.(it);
      }
      if (c.button(`inbox.look.${it.id}`, 'LOOK', innerX + (bw + gap), ry, bw, bh, { scale: FS_BODY * s })) {
        this.hooks.onInboxInvestigate?.(it);
      }
      if (c.button(`inbox.ignore.${it.id}`, 'IGNORE', innerX + 2 * (bw + gap), ry, bw, bh, { scale: FS_BODY * s })) {
        this.ignoredInbox.add(it.id);
        this.hooks.requestRender?.();
      }
    });
  }

  // ── W4 (D9): the chronicle browser — the inbox panel's ANNALS mode. A
  // scrollList of past entries (day + first line, truncated); clicking one
  // presents the full text as a one-shot UiSpec card (existing budgets, same
  // machinery as the whisper/landing cards). Read-only — no new commands.
  private drawAnnals(
    c: UiContext, px: number, pw: number, innerX: number, innerW: number, y: number, bottom: number, s: number,
  ): void {
    const fsBody = FS_BODY * s;
    const annals = this.hooks.getAnnals?.() ?? [];
    if (annals.length === 0) {
      c.label('NO ANNALS YET', innerX, y, fsBody, UI_PALETTE.textDim);
      return;
    }

    const rowH = 48 * s;
    let clickedIdx = -1;
    c.scrollList('ui.annals.list', { x: px, y, w: pw, h: bottom - y }, rowH, annals.length, (i, rowY) => {
      const a = annals[i];
      if (c.hotspot(`annal.row.${i}`, px, rowY, pw, rowH)) clickedIdx = i;
      c.label(c.ellipsize(a.title, fsBody, innerW), innerX, rowY, fsBody, UI_PALETTE.text);
      const firstLine = a.body.split('\n')[0] ?? '';
      c.label(c.ellipsize(firstLine, fsBody, innerW), innerX, rowY + c.lineHeight(fsBody) + 4 * s, fsBody, UI_PALETTE.textDim);
    });

    if (clickedIdx >= 0) {
      const a = annals[clickedIdx];
      const spec = validateUiSpec({
        title: a.title,
        body: [{ kind: 'paragraph', text: a.body }],
        choices: [{ text: 'Close', command: TIME_LANDING_DISMISS_COMMAND }],
      });
      this.presentUiSpec(spec, () => {});
    }
  }

  // ── W4 (D7): the pantheon panel — the rival roster finally visible.
  // sigil + name + power bar + follower count + a one-word stance for rivals.
  // Clicking a rival row flies to + focuses its strongest settlement; the
  // player's own row is never clickable.
  private drawPantheon(c: UiContext, _w: number, _h: number, s: number, rows: PantheonRow[], bottom: number): void {
    const pad = 16 * s;
    const pw = 360 * s;
    const px = pad;
    const top = Math.max(pad, 80 * s);
    const ph = bottom - top;
    c.panel(px, top, pw, ph);

    const innerX = px + 20 * s;
    const innerW = pw - 40 * s;
    const fsBody = FS_BODY * s;
    let y = top + 20 * s;
    c.label('SPIRITS', innerX, y, fsBody, UI_PALETTE.textDim);
    y += c.lineHeight(fsBody) + 14 * s;

    if (rows.length === 0) {
      c.label('No spirits abroad.', innerX, y, fsBody, UI_PALETTE.textDim);
      return;
    }

    const rowH = 58 * s;
    let clickedId: string | null = null;
    c.scrollList('ui.pantheon.list', { x: px, y, w: pw, h: bottom - y }, rowH, rows.length, (i, rowY) => {
      const row = rows[i];
      if (!row.isPlayer && row.strongestPoiId
          && c.hotspot(`pantheon.row.${row.id}`, px, rowY, pw, rowH)) {
        clickedId = row.id;
      }

      const glyph = sigilGlyph(row.sigil, row.name);
      const gw = c.measure(glyph, fsBody);
      c.label(glyph, innerX, rowY, fsBody, row.isPlayer ? UI_PALETTE.accent : UI_PALETTE.text);

      const nameX = innerX + Math.max(gw, c.measure('M', fsBody)) + 10 * s;
      const name = row.isPlayer ? `${row.name.toUpperCase()} (YOU)` : row.name.toUpperCase();
      // Stance sits right-aligned on the name row (its own room) so the
      // followers count below never has to share a line with it — that pairing
      // was what ran off the panel edge.
      const stance = row.isPlayer ? '' : (row.stance ? row.stance.toUpperCase() : '');
      const stanceW = stance ? c.measure(stance, fsBody) : 0;
      const nameMaxW = innerW - (nameX - innerX) - (stanceW ? stanceW + 12 * s : 0);
      c.label(c.ellipsize(name, fsBody, Math.max(0, nameMaxW)), nameX, rowY, fsBody, UI_PALETTE.text);
      if (stance) c.label(stance, innerX + innerW - stanceW, rowY, fsBody, UI_PALETTE.textDim);

      let ry = rowY + c.lineHeight(fsBody) + 6 * s;
      const barH = 8 * s;
      // Reserve room after the bar for the followers count so the bar can't push
      // it off-panel; the count is short ("N FOLLOWERS"), the bar takes the rest.
      const followers = `${row.followers} follower${row.followers === 1 ? '' : 's'}`.toUpperCase();
      const followW = c.measure(followers, fsBody);
      const barW = Math.max(40 * s, innerW - followW - 12 * s);
      c.rect(innerX, ry, barW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
      const powerFrac = Math.max(0, Math.min(1, row.power / 20));
      if (powerFrac > 0) c.rect(innerX, ry, Math.round(barW * powerFrac), barH, row.isPlayer ? UI_PALETTE.accent : UI_PALETTE.textDim);
      c.label(followers, innerX + innerW - followW, ry - 2 * s, fsBody, UI_PALETTE.textDim);
    });

    if (clickedId) this.hooks.onPantheonRow?.(clickedId);
  }

  // ── story card: a modal narrative beat (line / choice) over a dim backdrop ──
  private drawStory(c: UiContext, w: number, h: number, s: number): void {
    const session = this.story;
    if (!session) return;
    const stage: Stage = session.current;

    // dim the world so the beat reads as the focus
    c.rect(0, 0, w, h, withAlpha([0, 0, 0, 1], 0.45));

    const fsBody = FS_BODY * s;
    const fsName = FS_BODY * s;
    const lh = c.lineHeight(fsBody);

    // bottom-anchored card spanning most of the width
    const margin = 40 * s;
    const cardH = Math.max(160 * s, Math.round(h * 0.34));
    const cx = margin;
    const cy = h - cardH - margin;
    const cw = w - margin * 2;
    c.panel(cx, cy, cw, cardH);

    const innerX = cx + 28 * s;
    const innerW = cw - 56 * s;
    let y = cy + 24 * s;

    if (stage.kind === 'line') {
      if (stage.line.who) {
        c.label(stage.line.who.toUpperCase(), innerX, y, fsName, UI_PALETTE.accent);
        y += lh + 8 * s;
      }
      this.drawWrapped(c, stage.line.text, innerX, y, innerW, fsBody, UI_PALETTE.text);

      const bw = 150 * s;
      const bh = 30 * s;
      if (c.button('story.next', 'CONTINUE ▸', cx + cw - bw - 24 * s, cy + cardH - bh - 14 * s, bw, bh, { scale: fsBody })) {
        this.advanceStory(() => session.next());
      }
    } else if (stage.kind === 'choice') {
      // options stack upward from the button strip; one button each.
      const bh = 30 * s;
      const gap = 8 * s;
      const opts = stage.options;
      const stackH = opts.length * bh + Math.max(0, opts.length - 1) * gap;
      let by = cy + cardH - 14 * s - stackH; // bottom-aligned block of options
      const bw = innerW;
      opts.forEach((opt) => {
        if (c.button(`story.opt.${opt.index}`, opt.text, innerX, by, bw, bh, { scale: fsBody })) {
          this.advanceStory(() => session.choose(opt.index));
        }
        by += bh + gap;
      });
    }
  }

  /** Greedy word-wrap a run into the card width; returns the y past the last line. */
  private drawWrapped(c: UiContext, text: string, x: number, y: number, maxW: number, scale: number, color = UI_PALETTE.text): number {
    const lh = c.lineHeight(scale);
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word;
      if (line && c.measure(probe, scale) > maxW) {
        c.label(line, x, y, scale, color);
        y += lh + 2 * scale;
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) { c.label(line, x, y, scale, color); y += lh + 2 * scale; }
    return y;
  }

  /** W3 (D6): greedy word-wrap a run into at most `maxLines` lines within `maxW` —
   *  the npc inspector's status-hint prose has no room for a chat transcript, so
   *  it clamps rather than pushing the scroll-list start down unboundedly. The
   *  last shown line gets an ellipsis when content was cut. Returns the y past
   *  the last line drawn (same contract as `drawWrapped`). */
  private drawWrappedClamped(
    c: UiContext, text: string, x: number, y: number, maxW: number, scale: number,
    maxLines: number, color = UI_PALETTE.textDim,
  ): number {
    const lh = c.lineHeight(scale);
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word;
      if (line && c.measure(probe, scale) > maxW) { lines.push(line); line = word; }
      else line = probe;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, maxLines);
    if (lines.length > maxLines && shown.length) {
      shown[shown.length - 1] = c.ellipsize(`${shown[shown.length - 1]} …`, scale, maxW);
    }
    for (const ln of shown) { c.label(ln, x, y, scale, color); y += lh + 2 * scale; }
    return y;
  }

  /** Run one story step; dismiss when the beat ends. */
  private advanceStory(step: () => Stage): void {
    if (!this.story) return;
    const next = step();
    if (next.kind === 'done') this.dismissStory();
    this.hooks.requestRender?.();
  }

  private dismissStory(): void {
    if (!this.story) return;
    this.story = null;
    this.hooks.onStoryToggle?.(false);
    this.hooks.requestRender?.();
  }

  // ── the declarative UiSpec card (whisper card, P4): a centred modal that walks
  //    the spec's body blocks and offers its choices. The renderer owns ALL layout;
  //    the spec only carries content (spec §3). Content BUDGETS (no scroll yet):
  //    the choice stack is bottom-reserved so it always fits; body flows into the
  //    remainder and stops before it would collide. A pre-paired `Command` rides
  //    each choice, so picking one just hands it back to the game to `bus.emit()`.
  private renderUiSpec(c: UiContext, w: number, h: number, s: number, spec: UiSpec, clickAt: { x: number; y: number } | null): Rect | null {
    // dim the world so the card reads as the focus
    c.rect(0, 0, w, h, withAlpha([0, 0, 0, 1], 0.55));

    const fsTitle = 3 * s;
    const fsBody = FS_BODY * s;
    const lh = c.lineHeight(fsBody);

    // centred card
    const cw = Math.min(w - 80 * s, 560 * s);
    const cardH = Math.min(h - 80 * s, 520 * s);
    const cx = Math.round((w - cw) / 2);
    const cy = Math.round((h - cardH) / 2);
    const cardRect: Rect = { x: cx, y: cy, w: cw, h: cardH };
    c.panel(cx, cy, cw, cardH);
    c.hotspot('card.body', cx, cy, cw, cardH); // eat clicks inside the card body

    const innerX = cx + 28 * s;
    const innerW = cw - 56 * s;
    const bottom = cy + cardH - 22 * s;
    let y = cy + 24 * s;

    // title
    c.label(spec.title, innerX, y, fsTitle, UI_PALETTE.text);
    y += c.lineHeight(fsTitle) + 14 * s;

    // A conversation card (keepOpen) reserves a free-text input ROW below the choices
    // — the DOM whisper island floats over `inputRect` (C4). One-shot/info cards don't.
    const conversation = this.card?.keepOpen ?? false;
    const inputH = conversation ? 34 * s : 0;
    const inputGap = conversation ? 12 * s : 0;

    // reserve the choice stack + input row at the bottom, then flow the body into the rest
    const bh = 32 * s;
    const gap = 8 * s;
    const n = spec.choices.length;
    const stackH = n ? n * bh + (n - 1) * gap : 0;
    const contentLimit = bottom - inputH - inputGap - stackH - (n ? 14 * s : 0);

    for (const b of spec.body) {
      if (y >= contentLimit) break;
      y = this.drawSpecBlock(c, b, innerX, y, innerW, fsBody, lh, s, contentLimit);
    }

    // choices — a button stack anchored above the input row; each hands its command back
    let by = bottom - inputH - inputGap - stackH;
    spec.choices.forEach((choice, i) => {
      const label = choice.hint ? `${choice.text}  —  ${choice.hint}` : choice.text;
      if (c.button(`card.choice.${i}`, label, innerX, by, innerW, bh, { scale: fsBody })) {
        const card = this.card;
        if (card?.keepOpen) {
          // Conversation card: keep it open; the game emits the whisper and re-presents
          // an updated spec via `updateOpenCard` when the reply lands.
          card.onChoose(choice);
        } else {
          const onChoose = card?.onChoose;
          this.dismissCard();
          onChoose?.(choice);
        }
      }
      by += bh + gap;
    });

    // the free-text input row (conversation only): a gray-box field the DOM island
    // floats its <input> over. Drawn even in Node/tests so the row reads without the DOM.
    let inputRect: Rect | null = null;
    if (conversation) {
      const iy = bottom - inputH;
      c.rect(innerX, iy, innerW, inputH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.6));
      c.batcher.border(innerX, iy, innerW, inputH, Math.max(1, Math.round(s)), withAlpha(UI_PALETTE.textDim, 0.4));
      c.hotspot('card.input', innerX, iy, innerW, inputH); // eat clicks; the DOM input types
      inputRect = { x: innerX, y: iy, w: innerW, h: inputH };
    }

    // a click on the dim backdrop (outside the card) cancels — no choice emitted
    if (clickAt && !inRect(clickAt, cardRect)) this.dismissCard();
    return inputRect;
  }

  /** Walk one UiSpec body block; returns the y past it. */
  private drawSpecBlock(c: UiContext, b: UiSpecBlock, x: number, y: number, w: number, fs: number, lh: number, s: number, limit: number): number {
    switch (b.kind) {
      case 'paragraph':
        return this.drawWrapped(c, b.text, x, y, w, fs, UI_PALETTE.text) + 8 * s;
      case 'npcLine': {
        c.label(b.who.toUpperCase(), x, y, fs, UI_PALETTE.accent);
        y += lh + 4 * s;
        return this.drawWrapped(c, `“${b.text}”`, x, y, w, fs, UI_PALETTE.text) + 10 * s;
      }
      case 'playerLine': {
        // The god's own whisper — labelled YOU, muted, to read as the reply-to side.
        c.label('YOU', x, y, fs, UI_PALETTE.textDim);
        y += lh + 4 * s;
        return this.drawWrapped(c, `“${b.text}”`, x, y, w, fs, UI_PALETTE.textDim) + 10 * s;
      }
      case 'omen':
        return this.drawWrapped(c, `✦ ${b.text}`, x, y, w, fs, [0.55, 0.7, 0.9, 1]) + 8 * s;
      case 'divider':
        c.rect(x, y + 2 * s, w, Math.max(1, Math.round(s)), withAlpha(UI_PALETTE.textDim, 0.4));
        return y + 10 * s;
      case 'beliefBar': {
        if (y + lh > limit) return y;
        c.label(b.label, x, y, fs, UI_PALETTE.textDim);
        const barH = 7 * s;
        const trackW = w * 0.42;
        const trackX = x + w - trackW;
        const trackY = y + Math.round((lh - barH) / 2);
        c.rect(trackX, trackY, trackW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
        const fillW = Math.round(trackW * clamp01(b.value));
        if (fillW > 0) c.rect(trackX, trackY, fillW, barH, UI_PALETTE.accent);
        return y + lh + 8 * s;
      }
    }
  }

  // ── Round 9 WP-B: the WebGPU transport cluster (clock + pause + rate ladder
  //    + jump-to-next-event) — the WebGPU heir to the legacy DOM time-chip.
  //    Top-right, tucked left of the inspector when one is docked. Drawn only
  //    when `timeStatus` is wired (gray-box until then, like the camera cluster). ─

  /** Any transport input cancels an in-flight seek FIRST (per the round-9 plan:
   *  "transport input cancels seek"), then relays the actual command. */
  private dispatchTimeCommand(cmd: TimeCommand, seeking: boolean): void {
    if (seeking && cmd.kind !== 'cancel_seek') this.hooks.onTimeCommand?.({ kind: 'cancel_seek' });
    this.hooks.onTimeCommand?.(cmd);
    this.hooks.requestRender?.();
  }

  /** D10 quiet chrome: the clock chip always draws at full strength (the
   *  at-a-glance readout); the pause/ladder/skip (or cancel) row dims to
   *  `CHROME_DIM_ALPHA` until the pointer sits anywhere over the cluster's own
   *  footprint. Same "paint-only, never geometry" rule as the camera cluster
   *  (see its comment) — every control keeps its position + hit region on
   *  every frame. The footprint's width is measured (pure, no geometry) BEFORE
   *  any drawing so the hover test doesn't need a second layout pass. */
  private drawTimeCluster(c: UiContext, w: number, _h: number, s: number, rightInset = 0): void {
    const status = this.hooks.timeStatus?.();
    if (!status) return;
    const seeking = status.seeking !== null;
    const fs = FS_BODY * s;
    const pad = 16 * s;
    const rowH = 26 * s;
    const gap = 6 * s;
    const right = w - pad - rightInset;

    const badge = timeRateBadge(status);
    const clockText = badge ? `${status.clockLabel}   ${badge}` : status.clockLabel;
    const chipW = Math.ceil(c.measure(clockText, fs)) + 20 * s;
    const pauseLabel = status.paused ? '▶ RESUME' : '⏸ PAUSE';
    const pauseW = Math.ceil(c.measure(pauseLabel, fs)) + 20 * s;
    let transportW: number;
    if (status.seeking) {
      const cancelLabel = '✕ CANCEL';
      const cancelW = Math.ceil(c.measure(cancelLabel, fs)) + 20 * s;
      const elapsed = `⏳ ${formatElapsedTicks(status.seeking.elapsedTicks)}`;
      const elapsedW = Math.ceil(c.measure(elapsed, fs));
      transportW = cancelW + 10 * s + elapsedW;
    } else {
      const skipLabel = '⏭';
      let ladderW = Math.ceil(c.measure(skipLabel, fs)) + 20 * s;
      for (const rate of status.ladder) ladderW += gap + Math.ceil(c.measure(`${rate}×`, fs)) + 16 * s;
      transportW = ladderW;
    }
    const footprintW = Math.max(chipW, pauseW, transportW);
    const totalH = rowH * 3 + gap * 2;
    const hovered = inRect({ x: this.ptr.x, y: this.ptr.y }, { x: right - footprintW, y: pad, w: footprintW, h: totalH });
    const dim = hovered ? 1 : CHROME_DIM_ALPHA;

    let y = pad;

    // clock chip: calendar/solar label + an effective-rate badge (⏸ paused, or
    // ≈N× when the CPU can't sustain the requested rate). Always full strength.
    c.panel(right - chipW, y, chipW, rowH);
    c.label(clockText, right - chipW + 10 * s, y + (rowH - c.lineHeight(fs)) / 2, fs,
      status.paused ? UI_PALETTE.accent : UI_PALETTE.text);
    y += rowH + gap;

    // soft-pause toggle — always live (cancels an active seek first, per the
    // dispatch rule above), so it stays a reliable "stop" even mid-seek; dims
    // with the rest of the transport row when not hovered.
    if (c.button('ui.time.pause', pauseLabel, right - pauseW, y, pauseW, rowH, { scale: fs, alpha: dim })) {
      this.dispatchTimeCommand({ kind: 'toggle_pause' }, seeking);
    }
    y += rowH + gap;

    if (status.seeking) {
      // seeking: the ladder is replaced by a progress line + cancel.
      const cancelLabel = '✕ CANCEL';
      const cancelW = Math.ceil(c.measure(cancelLabel, fs)) + 20 * s;
      if (c.button('ui.time.cancel', cancelLabel, right - cancelW, y, cancelW, rowH, { scale: fs, alpha: dim })) {
        this.dispatchTimeCommand({ kind: 'cancel_seek' }, false);
      }
      const elapsed = `⏳ ${formatElapsedTicks(status.seeking.elapsedTicks)}`;
      const elapsedW = Math.ceil(c.measure(elapsed, fs));
      c.label(elapsed, right - cancelW - 10 * s - elapsedW, y + (rowH - c.lineHeight(fs)) / 2, fs, withAlpha(UI_PALETTE.textDim, dim));
    } else {
      // rate ladder (rendered FROM the hook — never hardcoded) + ⏭ next-event.
      const skipLabel = '⏭';
      const skipW = Math.ceil(c.measure(skipLabel, fs)) + 20 * s;
      let x = right - skipW;
      if (c.button('ui.time.skip', skipLabel, x, y, skipW, rowH, { scale: fs, alpha: dim })) {
        this.dispatchTimeCommand({ kind: 'skip_to_next_event' }, false);
      }
      x -= gap;
      for (let i = status.ladder.length - 1; i >= 0; i--) {
        const rate = status.ladder[i];
        const label = `${rate}×`;
        const bw = Math.ceil(c.measure(label, fs)) + 16 * s;
        x -= bw;
        const active = rate === status.requestedRate;
        if (c.button(`ui.time.rate.${rate}`, label, x, y, bw, rowH, { scale: fs, alpha: dim })) {
          this.dispatchTimeCommand({ kind: 'set_rate', rate }, false);
        }
        if (active) c.batcher.border(x, y, bw, rowH, Math.max(1, Math.round(2 * s)), withAlpha(UI_PALETTE.accent, dim));
        x -= gap;
      }
    }
  }

  /** Right-edge zoom controls (in/out/fit/1:1) — the GPU port of the legacy DOM
   *  `cameraControls`. Drawn only when the camera hooks are wired.
   *
   *  D10 quiet chrome: `+`/`-` (the at-a-glance zoom affordance) stay at full
   *  strength always; FIT/1:1 recede to `CHROME_DIM_ALPHA` until the pointer
   *  sits anywhere over the cluster's own footprint, then brighten back up.
   *  This is a dim, NOT a structural collapse-to-two-buttons: every button
   *  keeps its exact position + hit region on every frame, so a click never
   *  depends on a prior hover frame having already expanded the cluster (a
   *  true collapse would make FIT/1:1 unclickable from a cold pointerdown
   *  with no preceding pointermove — fine for a real mouse, which always
   *  moves before it clicks, but it silently breaks headless/single-shot
   *  interaction wherever a test or driver clicks without hovering first). */
  private drawCameraCluster(c: UiContext, w: number, h: number, s: number, rightInset = 0): void {
    const { onZoomIn, onZoomOut, onFitView, onZoomActual } = this.hooks;
    if (!onZoomIn || !onZoomOut || !onFitView || !onZoomActual) return;

    const pad = 16 * s;
    const bw = 38 * s;
    const bh = 32 * s;
    const gap = 4 * s;
    const fs = FS_BODY * s;
    const rows: Array<[string, string, () => void]> = [
      ['cam.in', '+', onZoomIn],
      ['cam.out', '-', onZoomOut],
      ['cam.fit', 'FIT', onFitView],
      ['cam.one', '1:1', onZoomActual],
    ];
    const bx = w - bw - pad - rightInset;
    const totalH = bh * rows.length + gap * (rows.length - 1);
    // vertically centred cluster on the right edge
    let by = Math.round((h - totalH) / 2);
    const hovered = inRect({ x: this.ptr.x, y: this.ptr.y }, { x: bx, y: by, w: bw, h: totalH });
    rows.forEach(([id, label, fn], i) => {
      const secondary = i >= 2; // FIT / 1:1
      const alpha = secondary && !hovered ? CHROME_DIM_ALPHA : 1;
      if (c.button(id, label, bx, by, bw, bh, { scale: fs, alpha })) fn();
      by += bh + gap;
    });
  }

  // ── Esc pause menu: dim backdrop + left nav + settings panel ──────────────
  /** Returns the DOM-island region (device px) when the settings form is shown.
   *  A click on the dim backdrop (outside the nav + panel) resumes the game. */
  private drawMenu(c: UiContext, w: number, h: number, s: number, clickAt: { x: number; y: number } | null): Rect | null {
    // full-screen dim so the world reads as "paused behind glass"
    c.rect(0, 0, w, h, withAlpha([0, 0, 0, 1], 0.62));

    const fsBody = FS_BODY * s;
    const fsTitle = FS_TITLE * s;

    // title
    c.label('SMALL GODS', 48 * s, 40 * s, fsTitle, UI_PALETTE.text);

    // ── left nav ──
    const navX = 48 * s;
    const navTop = 100 * s;
    let navY = navTop;
    const navW = 200 * s;
    const navH = 34 * s;
    const gap = 12 * s;
    const nav = (id: string, label: string, active: boolean): boolean => {
      // selected nav row gets an accent spine
      if (active) c.rect(navX - 8 * s, navY, 4 * s, navH, UI_PALETTE.accent);
      const clicked = c.button(id, label, navX, navY, navW, navH, { scale: fsBody });
      navY += navH + gap;
      return clicked;
    };
    if (nav('nav.resume', 'RESUME', false)) { this.setMenu(false); return null; }
    if (nav('nav.settings', 'SETTINGS', this.section === 'settings')) this.section = 'settings';
    if (nav('nav.world', 'NEW WORLD', false)) { this.setMenu(false); this.hooks.onNewWorld?.(); return null; }
    // the nav column's interactive box (covers all three rows + the spine)
    const navBox: Rect = { x: navX - 8 * s, y: navTop, w: navW + 8 * s, h: navY - navTop };

    // ── settings panel ──
    let island: Rect | null = null;
    let panelBox: Rect | null = null;
    if (this.section === 'settings') {
      const px = navX + navW + 40 * s;
      const py = 100 * s;
      const pw = Math.min(w - px - 48 * s, 460 * s);
      const ph = h - py - 48 * s;
      panelBox = { x: px, y: py, w: pw, h: ph };
      c.panel(px, py, pw, ph);

      const innerX = px + 24 * s;
      let rowY = py + 28 * s;
      const rowH = 30 * s;
      const rowGap = 18 * s;
      const ctrlW = 150 * s;
      const ctrlX = px + pw - ctrlW - 24 * s;

      // section header
      c.label('SETTINGS', innerX, rowY, fsBody, UI_PALETTE.textDim);
      rowY += rowH + rowGap;

      // LIGHTING toggle (stays a GPU button — no text input needed)
      c.label('LIGHTING', innerX, rowY + 6 * s, fsBody, UI_PALETTE.text);
      const lit = this.hooks.getLighting?.() ?? true;
      if (c.button('set.lighting', lit ? 'ON' : 'OFF', ctrlX, rowY, ctrlW, rowH, { scale: fsBody })) {
        this.hooks.onToggleLighting?.();
      }
      rowY += rowH + rowGap + 8 * s;

      // The provider FORM (provider/model/key) needs typed input → it renders in
      // the DOM island, positioned over this reserved region. We only reserve the
      // rect here; the island draws the actual fields (see frame()).
      island = { x: innerX, y: rowY, w: px + pw - 24 * s - innerX, h: py + ph - 20 * s - rowY };
    }

    // Backdrop click (outside the nav column and the settings panel) → resume.
    if (clickAt && !inRect(clickAt, navBox) && !(panelBox && inRect(clickAt, panelBox))) {
      this.setMenu(false);
      return null;
    }
    return island;
  }
}

function inRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/** Round 9 WP-B time transport: an inert placeholder `Command` for the landing
 *  card's sole "Continue" choice. `showTimeLandingCard`'s own `onChoose` never
 *  reads it (the card is purely informational — dismissing emits nothing); it
 *  exists only to satisfy `UiSpecChoice.command`'s type so the card can reuse
 *  the whisper-card's `presentUiSpec`/`renderUiSpec` machinery verbatim. */
const TIME_LANDING_DISMISS_COMMAND: Command = {
  verb: 'whisper',
  source: PLAYER_SPIRIT_ID,
  target: { kind: 'none' },
  seq: -1,
};

/** Effective-rate badge for the clock chip: `⏸` when soft-paused, `≈N×` when
 *  the CPU can't sustain the requested rate (>10% behind), else nothing (the
 *  requested and effective rates already agree — no badge needed). */
function timeRateBadge(status: TimeStatus): string | null {
  if (status.paused) return '⏸';
  const { requestedRate: req, effectiveRate: eff } = status;
  if (req > 0 && Math.abs(eff - req) / req > 0.1) {
    const rounded = eff >= 10 ? Math.round(eff) : Math.round(eff * 10) / 10;
    return `≈${rounded}×`;
  }
  return null;
}

/** "3h 20m" / "45m" elapsed-span label for the seek progress line, derived
 *  from raw ticks via the calendar's tick-per-hour constant. */
function formatElapsedTicks(ticks: number): string {
  const totalMinutes = Math.floor(ticks / (TICKS_PER_HOUR / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── UI v2 W2 (D5): the inspector's scrollList rows ───────────────────────────
// The variable-length middle (npc: state+domains; settlement: building-row +
// wards + recent + domains) flattens into ONE list of same-height rows so a
// single `scrollList` can carry it — `drawInspector` no longer flow-lays-out and
// budget-breaks each section by hand.
type InspectorRow =
  | { t: 'header'; label: string }
  | { t: 'bar'; label: string; value: number; accent: readonly [number, number, number, number] }
  | { t: 'text'; label: string }
  | { t: 'building'; label: string };

/** Storm-sky tint for "what they believe you command" bars — a belief you hold
 *  OVER them, distinct from the player-accent bars that read as THEIR state. */
const DOMAIN_BAR_ACCENT: readonly [number, number, number, number] = [0.55, 0.7, 0.9, 1];

/** W3 (D6): warm kinship tint for TIES trust bars — distinct from both the
 *  player-accent state bars (THEIR state) and the storm-sky domain bars (what
 *  they believe of YOU); this one is what they feel toward EACH OTHER. */
const TIE_BAR_ACCENT: readonly [number, number, number, number] = [0.85, 0.65, 0.35, 1];

/** Flatten an `InspectorView` into the scroll list's rows, in display order.
 *  Npc: state bars, then (if any) the domain-conviction bars under a header —
 *  unchanged content from pre-D2, just row-ized. Settlement (W2 D5): the
 *  building-row highlight (if the selection came from a building click) leads,
 *  then WARDS, then RECENT, then the same domain bars. */
function inspectorRows(view: InspectorView): InspectorRow[] {
  const rows: InspectorRow[] = [];
  if (view.kind === 'npc') {
    for (const b of view.state) rows.push({ t: 'bar', label: b.label, value: b.value, accent: UI_PALETTE.accent as [number, number, number, number] });
    if (view.domains.length) {
      rows.push({ t: 'header', label: 'THEY BELIEVE YOU COMMAND' });
      for (const d of view.domains) rows.push({ t: 'bar', label: d.label, value: d.value, accent: DOMAIN_BAR_ACCENT });
    }
    // B (mind-reading): what this soul remembers of YOU — the salient slice of its
    // interaction ring, newest-distilled summaries as plain text rows.
    if (view.memories?.length) {
      rows.push({ t: 'header', label: 'REMEMBERS' });
      for (const m of view.memories) rows.push({ t: 'text', label: m.summary });
    }
    // W3 (D6): top social ties — name + type as the label, trust as the bar.
    if (view.relationships?.length) {
      rows.push({ t: 'header', label: 'TIES' });
      for (const r of view.relationships) {
        rows.push({ t: 'bar', label: `${r.name} · ${r.type}`, value: r.trust, accent: TIE_BAR_ACCENT });
      }
    }
    return rows;
  }
  if (view.buildingRow) rows.push({ t: 'building', label: `${view.buildingRow.name} · ${view.buildingRow.type}` });
  if (view.wards?.length) {
    rows.push({ t: 'header', label: 'WARDS' });
    for (const wd of view.wards) rows.push({ t: 'text', label: `${wd.name} · ${wd.type}` });
  }
  if (view.recent?.length) {
    rows.push({ t: 'header', label: 'RECENT' });
    for (const r of view.recent) rows.push({ t: 'text', label: `${r.count} ${r.label}` });
  }
  if (view.domains.length) {
    rows.push({ t: 'header', label: 'THEY BELIEVE YOU COMMAND' });
    for (const d of view.domains) rows.push({ t: 'bar', label: d.label, value: d.value, accent: DOMAIN_BAR_ACCENT });
  }
  return rows;
}

/** Draw one flattened inspector row at `rowY` (the scroll list already clamped/
 *  windowed it — this only paints). `building` gets a tinted highlight band so
 *  the clicked building reads distinct from the wards list under it. */
function drawInspectorRow(
  c: UiContext, row: InspectorRow, innerX: number, innerW: number, rowY: number,
  fsBody: number, lh: number, barH: number,
): void {
  switch (row.t) {
    case 'header':
      c.label(c.ellipsize(row.label, fsBody, innerW), innerX, rowY, fsBody, UI_PALETTE.accent);
      return;
    case 'building':
      c.rect(innerX - 6, rowY - 2, innerW + 12, lh + 4, withAlpha(UI_PALETTE.accent, 0.16));
      c.label(c.ellipsize(row.label.toUpperCase(), fsBody, innerW), innerX, rowY, fsBody, UI_PALETTE.text);
      return;
    case 'text':
      c.label(c.ellipsize(row.label, fsBody, innerW), innerX, rowY, fsBody, UI_PALETTE.textDim);
      return;
    case 'bar': {
      const trackW = innerW * 0.42;
      const trackX = innerX + innerW - trackW;
      // W3 (D6): TIES rows carry an npc name + relationship type — long enough
      // to run into the trust bar — so the label ellipsis-clips to the space
      // actually left of the track (same idiom the button label already uses).
      const label = c.ellipsize(row.label, fsBody, Math.max(0, trackX - innerX - 8));
      c.label(label, innerX, rowY, fsBody, UI_PALETTE.textDim);
      const trackY = rowY + Math.round((lh - barH) / 2);
      c.rect(trackX, trackY, trackW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
      const fillW = Math.round(trackW * clamp01(row.value));
      if (fillW > 0) c.rect(trackX, trackY, fillW, barH, row.accent);
      return;
    }
  }
}

/** "Cwen · peace sworn (5d left)" / "Cwen · peace lapsed (2d ago)" / "Cwen · no
 *  oath sworn" — the M6 Peace-of-God readout, fiction days only (never ticks). */
function peaceLine(p: SettlementPeace): string {
  const days = Math.max(0, Math.round(p.expiryDays ?? 0));
  if (p.oath === 'sworn') return `${p.lordName} · peace sworn (${days}d left)`;
  if (p.oath === 'lapsed') return `${p.lordName} · peace lapsed (${days}d ago)`;
  return `${p.lordName} · no oath sworn`;
}

/** Chip caption: "WHISPER · 1  (praying)" with a lock glyph when belief-gated. */
function hoverChipLabel(ch: HoverChipView): string {
  const cost = ch.cost > 0 ? ` · ${ch.cost}` : '';
  const why = ch.why ? `  (${ch.why})` : '';
  const lock = ch.unlocked ? '' : ' 🔒';
  return `${ch.label.toUpperCase()}${cost}${why}${lock}`;
}

/** Alert-pin kind glyph. The builtin pixel font only renders A–Z / 0–9 / punctuation
 *  (symbol codepoints draw blank), so pins are kind-coded by a supported LETTER plus
 *  colour rather than the ✉/☀/⚠ marks the spec sketched: P(rayer) / O(pportunity) /
 *  X(=rival threat); `+` marks the surviving selection. */
function pinGlyph(kind: AlertPinView['kind']): string {
  switch (kind) {
    case 'prayer': return 'P';
    case 'opportunity': return 'O';
    case 'threat': return 'X';
    case 'tiding': return 'T';
    case 'selection': return '+';
  }
}

/** Alert-pin ring tint: inbox kinds share the list's dot colours; the selection pin
 *  is distinct (plain text-white, no urgency signal — it is YOUR focus, not news). */
function pinColor(kind: AlertPinView['kind']): [number, number, number, number] {
  if (kind === 'selection') return UI_PALETTE.text as [number, number, number, number];
  return kindColor(kind);
}

/** Inbox kind → dot colour (surfaced items override with the accent). */
function kindColor(kind: InboxItem['kind']): [number, number, number, number] {
  switch (kind) {
    case 'prayer': return UI_PALETTE.accent as [number, number, number, number];
    case 'opportunity': return [0.55, 0.7, 0.9, 1]; // storm-sky
    case 'threat': return [0.85, 0.32, 0.27, 1];    // rival red
    case 'tiding': return [0.5, 0.75, 0.5, 1];      // faith-turn green (low-key news)
  }
}

/** W4 (D7): the exact symbol set the builtin pixel font renders (see
 *  `text/pixel-font.ts`'s glyph table `G`) — A–Z / 0–9 / this fixed punctuation
 *  set. A spirit's `sigil` (e.g. '⊙', '◆') is almost never in it, so pantheon
 *  rows fall back to the first letter of the spirit's name rather than draw a
 *  blank cell. Mirrors `pinGlyph`'s reasoning for alert pins. */
const RENDERABLE_GLYPHS = new Set<string>([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  '-', '+', '/', '.', ':', '·', '…', '✕', '⏭', '⏳',
]);

/** One renderable glyph for a spirit's sigil: the sigil itself when the font
 *  supports it, else the name's first letter, else '' (blank — never crashes). */
function sigilGlyph(sigil: string, name: string): string {
  const ch = sigil.trim();
  if (ch.length === 1 && RENDERABLE_GLYPHS.has(ch.toUpperCase())) return ch.toUpperCase();
  const first = name.trim()[0];
  return first ? first.toUpperCase() : '';
}

let singleton: UiRuntime | null = null;

/** The shared live UI runtime. Lazily created; the render frame and the Game
 *  both reach it through this. */
export function getUiRuntime(): UiRuntime {
  if (!singleton) singleton = new UiRuntime();
  return singleton;
}
