import { createState, resetState, type GameState } from '@/core/state';
import type { RenderFn, MetaRenderFn } from '@/render/select-renderer';
import { pan, zoomAt } from '@/render/camera';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import { isoEnvForMap } from '@/render/iso/iso-env';
import { pickTile } from '@/ui/pick-tile';
import { fitCameraToMap, clampCameraToMap } from '@/render/fit-camera';
import { computeFrame, type FrameSubject } from '@/game/framing/compute-frame';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import type { GameMap, WorldSeed, TerrainOptions, Relationship } from '@/core/types';
import { createDebugApi, type DebugApi } from '@/dev/debug-api';
import { createGameQuery, type GameQuery, type InboxItem, type InspectorView, type BeliefView, type BeliefPowerView } from '@/game/game-query';
import { causalSiteCardView } from '@/game/causal-site-view';
import type { Command, CommandVerb, CommandTarget, CommandTargetKind } from '@/sim/command/types';
import { clampAreaRadius } from '@/sim/command/types';
import { getCapability, acceptedTargetKinds, capFootprint, effectiveCost } from '@/sim/command/registry';
import { DEFAULT_STORM_RADIUS_TILES } from '@/render/divine-effects';
import { hoverChips } from '@/game/affordance/hover';
import { ConversationController } from '@/game/conversation-controller';
import { createGameBus, type GameBus } from '@/game/game-bus';
import { TimeController, TIME_RATE_LADDER } from '@/game/time-controller';
import { describeInterest } from '@/game/interest-predicate';
import { getUiRuntime } from '@/render/ui/ui-runtime';
import { FpsMeter, type FpsStats } from '@/dev/profile';
import { advanceNpcFrames } from '@/render/npc-animator';
import { isLayerHidden } from '@/render/layer-visibility';
import { getHydrologyResult } from '@/world/hydrology-store';
// divine-actions functions now invoked via DivineActionsController
import type { LLMClient } from "@/llm/llm-client";
import type { ProviderConfig, ProviderType } from '@/llm/provider-factory';
import { bootLlmClients, buildChatClient, buildCapableClient, paidArtGenOptions } from '@/game/llm-runtime';
import { CostTracker } from '@/llm/cost-tracker';
import { mountSpendChip, type SpendChipHandle } from '@/ui/spend-chip';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { getNpc, forEachNpc, npcProps } from '@/world/npc-helpers';
import { findBuildingAtTile, buildingInfoOf } from '@/world/building-helpers';
import { openMindPage } from '@/game/mind-orchestrator';
import { buildMindCard } from '@/game/affordance/mind-card';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { GameUi } from '@/game/game-ui';
import { ArtImageCache } from '@/render/decoration-image-cache';
import type { AssetLibrary } from '@/services/asset-library';
import type { ArtResolver } from '@/render/art-resolver';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import { GeneratedFloraArtSource } from '@/render/generated-flora-art-source';
import { ClutterFloraArtSource } from '@/render/clutter-flora-art-source';
import { FLORA_IMAGE_MODEL } from '@/assetgen/flora-image-prompt';
import { AssetManager } from '@/render/asset-manager';
import { Scheduler } from '@/core/scheduler';
import type { AppendedEvent } from '@/core/events';
import { TimelineController } from '@/core/timeline';
import { CommandQueue } from '@/sim/command/command-queue';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import type { ThreadSubject } from '@/sim/threads/thread-types';
import { StoryRegistry, StorySession, createBusStoryHost, busAllowedVerbs } from '@/story';
import { droughtOmenPack } from '@/story/samples/the-drought-omen';
import { PLAYER_SPIRIT_ID, BELIEVER_THRESHOLD } from '@/sim/believers';
import { cohortBelievers } from '@/sim/cohorts';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import { registerSimSystems } from '@/game/sim-systems';
import { applySkip } from '@/sim/time-skip';
import { settleArcsAcrossSkip } from '@/sim/fate/arc-era';
import { runBootSequence } from '@/game/boot-sequence';
import { kickOffSheets } from '@/game/bootstrap-world';
import { FrameLoop, type FrameAnimating } from '@/game/frame-loop';
import { PersistenceController } from '@/game/persistence-controller';
import {
  clearSave, deleteSlot, probeSlots, slotCompat, SAVE_SLOTS,
  type SaveSlot, type SaveMeta, type SaveMetaInput,
} from '@/services/save-store';
import { SAVE_VERSION } from '@/core/save-file';
import { WORLD_CONTENT_VERSION } from '@/core/content-version';
import { Shell, EMPTY_HALL_VIEW } from '@/render/ui/shell/shell';
import { isScreenId } from '@/render/ui/shell/shell-state';
import type { TitleAction, TitleView } from '@/render/ui/shell/title-screen';
import type { SaveAction, SaveScreenView, SlotRow } from '@/render/ui/shell/save-screen';
import type { LoadAction } from '@/render/ui/shell/load-screen';
import type { SettingsAction, SettingsScreenView, SettingsKey } from '@/render/ui/shell/settings-screen';
import type { GameOverAction } from '@/render/ui/shell/gameover-screen';
import type { PhotoView } from '@/render/ui/shell/photo-screen';
import type { NewGameAction } from '@/render/ui/shell/newgame-screen';
import type { HallAction, HallView } from '@/render/ui/shell/hall-screen';
import { composeHallView } from '@/game/hall-view';
import { encodeWorldCode, decodeWorldCode } from '@/game/world-code';
import { firstRunTidings, FIRST_RUN_TIDING_HORIZON_TICKS } from '@/game/first-run-tidings';
import * as settingsStore from '@/services/settings-store';
import { selectRenderer } from '@/render/select-renderer';
import { setUiScaleMultiplier } from '@/render/ui/ui-tokens';
import { injectTokens } from '@/ui/inject-tokens';
import { mountPastVeil } from '@/ui/chrome';
import { mountTimeBar, type TimeBarHandle } from '@/ui/panels/time-bar';
import type { RenderContextDeps } from '@/game/render-context';
import { applyFollowCamera, applyCameraFly } from '@/game/camera-follow';
import { coverageFor, descentCameraOffsetPx, ascentResetDue, stepHallOverlay } from '@/game/sky-transition';
import { zoomBand, type ZoomBand, SOUL_FLY_ZOOM, SETTLEMENT_FLY_ZOOM } from '@/game/affordance/zoom-band';
import { buildWorldLabels, type SettlementContest } from '@/game/affordance/world-labels';
import {
  SpeechBubbleStore, buildSpeechBubbles, describeEncounterLine, encounterSeed, lowestWorry,
} from '@/game/affordance/speech-bubbles';
import {
  GarnishThrottle, buildGarnishPrompt, sanitizeGarnish, type GarnishInput,
} from '@/game/affordance/bubble-garnish';
import { LlmBackfillService } from '@/game/llm-backfill';
import { soulWarmFocusDue } from '@/game/soul-warm-focus';
import { ChronicleService } from '@/game/chronicle-service';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import { FateTrigger } from '@/game/fate/fate-trigger';
import { FatePulse } from '@/game/fate/fate-pulse';
import { DevModeController } from '@/game/dev-mode-controller';
import { FrameRenderer } from '@/game/frame-renderer';
import { PresentationDirector } from '@/presentation/presentation-director';
import { createInteractionState, type TargetingMode } from '@/game/interaction-state';
import { InteractionController } from '@/game/interaction-controller';
import { calendarLabel, TICKS_PER_HOUR } from '@/core/calendar';
import { clamp01 } from '@/core/math';
import {
  DEFAULT_KEYMAP, isAction, bind, conflictsFor, promptFor, loadKeymap, diffFromDefault,
  type Action, type Keymap,
} from '@/game/input/keymap';
import { GamepadPoller, type GamepadFrame } from '@/game/input/gamepad';

/** How long the per-frame HUD sim-read memo (belief/powers/inbox) stays fresh.
 *  Belief moves at sim-tick rate (~1 Hz), so ~150 ms (≈7 Hz) is imperceptible for
 *  the readout yet collapses ~4–6 full congregation sweeps/frame to one. */
const HUD_SIM_TTL_MS = 150;

/** How long the photo screen's "PHOTO SAVED" hint takes to fade to nothing —
 *  real ms (a presentation timing, not fiction time), long enough to read at
 *  a glance without lingering over the shot the player just framed. */
const PHOTO_HINT_FADE_MS = 1800;

/** How long the legacy pause menu's "COPIED: …" world-code confirmation stays
 *  up — real ms, a plain hold rather than a fade (the menu isn't guaranteed
 *  to keep repainting while the world sits paused behind it). */
const WORLD_CODE_STATUS_MS = 2500;

/** How long the World-band settlement-contest memo stays fresh — DECOUPLED from
 *  `HUD_SIM_TTL_MS` (perf follow-up). `worldContest()` runs a full `forEachNpc`
 *  belief sweep on the RENDER thread, and it fires ONLY in the World band (via the
 *  `getWorldLabels` hook) — so at a world-view zoom-out it stacked a second whole-
 *  congregation sweep on top of `hudSim`'s at the 150 ms HUD cadence (~6.6 Hz),
 *  the zoom-specific cost the frame trace charged to `ui.frame()`. The contest is
 *  cosmetic, slow-changing map typography (which rival, if any, leads a town) — a
 *  ~1 s refresh is imperceptible on a label yet cuts that sweep frequency ~6.6×. */
const WORLD_CONTEST_TTL_MS = 1000;

/** Cadence of the post-boot LPC sheet re-kick (real ms) — catches NPCs born
 *  after the boot pass so they render with a sheet, not a fallback circle.
 *  Births are rare; the scan is a Map.has per NPC, so slow is plenty. */
const SHEET_REKICK_MS = 5000;

/** The sim rate a freshly entered world runs at. 1 = 1:1 with real time (the
 *  game's whole time contract); see `Game.enterWorldRunning` for why entry states
 *  this explicitly instead of trusting whatever the rate happened to be. */
const WORLD_ENTRY_RATE = 1;

/**
 * UI v3: what to do once the shell is up.
 *
 * `{ kind: 'auto' }` is today's behaviour verbatim — resume the autosave if one
 * is valid, else generate the pinned world — and it is what every dev flag
 * (`?genseed`, `?genome`, `?bridge`, `?studio`) and the embed API resolve to, so
 * those paths skip the title and boot straight in exactly as before.
 * Omitting `autostart` entirely is the NEW default: show the title and generate
 * nothing until the player (or an agent) asks.
 */
export type Autostart =
  | { kind: 'auto' }
  | { kind: 'fresh'; genSeed?: number; genome?: string; worldSeed?: WorldSeed; ephemeral?: boolean }
  | { kind: 'resume'; slot?: string };

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
  /** Skip the title and boot a world immediately (dev flags, embeds, tests).
   *  Absent ⇒ the title screen is shown and nothing is generated until asked. */
  autostart?: Autostart;
  /** Throwaway world: never autosave over the player's slot. Defaults from
   *  `?genome` (a generated terrain study is always throwaway) but is now a real
   *  parameter, because the Demo World needs it without being a genome. */
  ephemeral?: boolean;
}

/** `?flag` present in the URL (used to opt back into the dev UI, etc.). */
function hasQueryFlag(flag: string): boolean {
  try { return new URLSearchParams(window.location.search).has(flag); }
  catch { return false; }
}

// The shell screen ids an `open_screen` command may name USED to be a second
// hand-written list here, drifting freely from the `ScreenId` union — a screen
// the stack accepted was silently REFUSED over the external agent API. The
// predicate now lives with the union it decides (`shell-state.isScreenId`), and
// the union's runtime members are compiler-checked for exhaustiveness there;
// `tests/unit/screen-id-parity.test.ts` pins both.

/** Validates a bus-supplied slot param the same way `isScreenId` validates a
 *  screen name — an agent's `save_slot`/`load_slot`/`delete_slot` must be
 *  refused on an unknown slot, not cast and trusted. */
function isSaveSlot(v: string): v is SaveSlot {
  return (SAVE_SLOTS as readonly string[]).includes(v);
}

/** Validates a bus-supplied `set_setting` key the same way `isScreenId`/
 *  `isSaveSlot` validate theirs — an agent's key arrives from OUTSIDE and an
 *  unknown one must be refused, never cast and trusted. Restricted to the
 *  keys the settings SCREEN actually edits (`SettingsKey`), not every key
 *  `Settings` happens to declare (e.g. `llmProviderConfig` goes through the
 *  DOM island's own `onSaveLlmConfig` path, never `set_setting`). */
const SETTINGS_KEYS = new Set<SettingsKey>([
  'musicOn', 'musicVolume', 'sfxOn', 'sfxVolume', 'voiceOn', 'halfResWater', 'uiScale', 'lighting',
]);
/** Exported (unlike `isScreenId`/`isSaveSlot`, its siblings) so
 *  `tests/unit/shell-settings-screen.test.ts` can pin the refusal LOGIC
 *  directly, per the P4b brief: "test the predicate you add, not `Game`". */
export function isSettingsKey(v: string): v is SettingsKey {
  return (SETTINGS_KEYS as Set<string>).has(v);
}

/** Trigger a browser download of a data URL via a transient `<a download>`
 *  click — `capture_photo`'s one sanctioned DOM exception (spec §7: "an `<a
 *  download>` click is acceptable DOM here since it produces no visible
 *  chrome"). Appended to `document.body` only for the instant `.click()`
 *  needs an in-DOM element to fire reliably, then removed synchronously —
 *  never a mounted, persistent element, so this doesn't run afoul of the
 *  embed's "no `document.body` assumptions" rule (that rule guards the
 *  game's OWN standing UI, not a one-shot save-file trigger). */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Parse a bus param into a boolean, accepting the shapes a `Command.params`/
 *  `.payload` value can realistically arrive as (a real boolean from an
 *  in-process caller, or a string/number from the wire). Returns `undefined`
 *  on anything else — the caller refuses rather than guessing. */
function toBoolParam(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return undefined;
}

/** Same shape as `toBoolParam`, for a numeric setting (volumes, UI scale). */
function toNumParam(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** A manual save's default name when the player didn't type one (no naming
 *  island lands this slice — see `save-screen.ts`'s module doc) — "Slot 1",
 *  never the autosave's own "Autosave" default the meta provider would
 *  otherwise stamp on every slot indiscriminately. */
function defaultSlotName(slot: SaveSlot): string {
  return slot === 'autosave' ? 'Autosave' : `Slot ${slot.slice(4)}`;
}

/** Real playtime (ms) → a short prose label ("2H 15M" / "40M") for a slot
 *  tile. `playtimeMs` is wall-clock, never sim ticks, so this is NOT the
 *  "fiction time only" rule's business — that governs `dateLabel` instead. */
function formatPlaytime(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}

/** Prose for why a slot cannot be opened, from its meta ALONE, with the real
 *  version numbers already interpolated — SHARED by the title screen's
 *  CONTINUE row and every save/load tile, so "why won't this open" reads
 *  identically everywhere it appears. Null when the slot opens fine. */
function staleReasonText(meta: Pick<SaveMeta, 'version' | 'contentVersion'>): string | null {
  const compat = slotCompat(meta);
  if (compat === 'stale-save') {
    return `Saved by an older version of the game (save v${meta.version}; this build is v${SAVE_VERSION})`;
  }
  if (compat === 'stale-world') {
    return `Saved under an older world (content ${meta.contentVersion}; this build is ${WORLD_CONTENT_VERSION})`;
  }
  return null;
}

/** L1: NPC mood word for the hover tooltip (ported from the deleted
 *  `src/ui/npc-tooltip.ts` — same three-band thresholds). */
function npcMoodLabel(mood: number): string {
  if (mood >= 0.75) return 'content';
  if (mood >= 0.40) return 'uneasy';
  return 'miserable';
}

export class Game {
  private container: HTMLElement;
  /** The interactive WebGPU scene canvas (bottom layer). All pointer input, the
   *  WebGPU swap chain and coordinate math reference THIS canvas. Never gets a 2D
   *  context — the scene renders straight to its swap chain (no offscreen copy). */
  private canvas: HTMLCanvasElement;
  /** Transparent Canvas2D overlay stacked ON TOP of the scene canvas
   *  (pointer-events:none, so clicks fall through to the scene). Holds the 2D
   *  overlays the WebGPU-only decree explicitly keeps on 2D-ctx: perf HUD, divine
   *  effects, the cast-flash, dev overlays and the `?connectome` graph. */
  private overlayCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private scheduler: Scheduler;
  /** R9: budgeted fastforward + "jump to next event" seek engine. Wraps the
   *  scheduler; the frame loop advances the sim through THIS, not scheduler.tick. */
  private timeController!: TimeController;
  /** R9: set by a user/host `cancel_seek` so the landing card is skipped. */
  private suppressLandingCard = false;
  private commandQueue = new CommandQueue();
  private discoveryQueue = new DiscoveryQueue();
  /** Last NPC fed to the discovery queue, so we push a signal only on a switch. */
  private lastDiscoveredNpcId: string | null = null;
  /** UI v2 W3 (D6): last `selectedNpcId` seen by the soul-warm-focus check, so a
   *  fresh selection (including a re-selection after deselecting) is detected —
   *  independent of `lastDiscoveredNpcId`'s own change-tracking above. */
  private lastSoulFocusSelection: string | null = null;
  /** UI v2 W3 (D6): per-npc real-clock (`Date.now()`) timestamp of the last warm-
   *  focus backfill fire — transient, NEVER serialized/snapshotted (a save/load
   *  or timeline scrub must not reset or extend the spend cooldown). */
  private soulFocusFiredAt = new Map<string, number>();
  /** UI v2 W3 (D6): the fast-tier provider's TYPE (mirrors `providerConfig.type`
   *  the spend chip already gates on) — 'mock' means no LLM is actually
   *  configured, so warm-focus has nothing to warm and silently skips. */
  private llmProviderType: ProviderType = 'mock';
  private attentionStore = new NpcAttentionStore();
  private authorLog = new AuthorCommandLog();
  private timeline!: TimelineController;
  /** Read-only facade over GameState (S0). The bus + __debug both read through it. */
  private query!: GameQuery;
  /** The unified command/query seam a UI or MCP bridge consumes (S0). */
  bus!: GameBus;
  private persistence!: PersistenceController;
  private cleanupControls: (() => void) | null = null;
  private cleanupUi: (() => void) | null = null;
  /** Sim rate captured when the pause menu opened, restored on close. */
  private menuPrevRate = 1;
  /** Sim rate captured when a story card opened, restored when it dismisses. */
  private storyPrevRate = 1;
  /** Guards the modal rate-stash against double-present / double-dismiss. */
  private storyModalActive = false;
  /** Loaded story packs; a fired beat's `storylet` ref is looked up here. */
  private storyRegistry = new StoryRegistry();
  private cleanupTokens: (() => void) | null = null;
  private resizeObserver: ResizeObserver;
  /** The rAF driver: owns scheduling, the real pause (CPU+GPU idle), render-on-demand and
   *  tab-visibility auto-pause. The Game supplies per-frame work via the onFrame/onRender/
   *  onPauseChange hooks. */
  private frameLoop = new FrameLoop({
    onFrame: (now, deltaMs, paused) => this.onFrame(now, deltaMs, paused),
    onRender: (deltaMs) => this.onRender(deltaMs),
    onPauseChange: (paused) => this.onPauseChange(paused),
  });
  /** Cinematic-camera state carried from onFrame → onRender (the cinematic camera owns the
   *  view while active, so the normal follow-camera is skipped that frame). */
  private lastCinematic = false;
  /** UI v3 sky-transition spike: this frame's cloud-overlay params for the
   *  world render path (`renderDeps()` reads this — it isn't `GameState`,
   *  it's Shell presentation state recomputed fresh every frame). Null
   *  outside a transition. Set by `tickShellTransition`. */
  private currentSkyOverlay: { coverage: number; timeSec: number } | null = null;
  /** UI v3 sky-transition spike: guards the ascent's real state reset
   *  (`returnToTitle`) so it fires exactly once per ascent — see
   *  `tickShellTransition`/`beginQuitToTitle`. */
  private ascentResetFired = false;
  /** Phase C H4: the Hall of the Gods' cloud ramp — its LINEAR position
   *  (0 = clear sky, 1 = fully closed above the world), carried across frames.
   *  Presentation state like `currentSkyOverlay`, deliberately NOT a
   *  `GameState` field (that would trip the field-count pin for something a
   *  save has no business remembering). Stepped by `stepHallOverlay`. */
  private hallRampLinear = 0;
  /** Wall-clock ms of the last `hallRampLinear` step, so the ramp is driven by
   *  elapsed time rather than by frame count (render-on-demand means frames
   *  are not evenly spaced). Null = no step yet. */
  private hallRampAtMs: number | null = null;
  /** UI v2 W0/D1: the last committed attention band (world/settlement/soul), carried
   *  across frames so `zoomBand`'s per-boundary hysteresis can't flicker at a rung. */
  private zoomBandState: ZoomBand = 'soul';
  /** Rendered-frame FPS meter (always sampling; cheap). Read via `__perf.fps()`. The
   *  on-screen FPS pill is drawn on the canvas in gpu-render-frame (dev-only); there
   *  is no DOM HUD on the game surface. */
  private readonly fps = new FpsMeter();
  /** Sim rate to restore on resume (a hard pause forces rate 0). */
  private savedRate = 1;
  /** Mark the scene dirty so the next frame redraws. While hard-paused the loop is stopped,
   *  so this also kicks a single on-demand frame (then it idles again). Delegates to the
   *  FrameLoop driver; the wrapper keeps the bound reference stable for early subsystem wiring. */
  private requestRender = (): void => {
    this.frameLoop.requestRender();
  };
  // Ambient water ripples animate on wall-clock time, so the loop must keep
  // drawing while visible water is on screen — even with the sim PAUSED — or the
  // ocean only moves on interaction. Memoised has-water scan per map identity.
  private waterAnimMapRef: GameMap | null = null;
  private waterAnimHasWater = false;
  private divine!: DivineActionsController;
  /** The living whisper/conversation card (C1/C2/C4) — see conversation-controller.ts. */
  private conversation!: ConversationController;
  private ui!: GameUi;
  /** Ephemeral world: never autosave over the player's slot. A generated genome
   *  (`?genome=…`) is always throwaway, and the Demo World sets it explicitly —
   *  which is why this is no longer `readonly`-bound to the query flag (UI v3
   *  §3.5): `startWorld` sets it per world, since one session can now go
   *  title → demo → title → real game without a reload. */
  private ephemeral = hasQueryFlag('genome');
  /** Interior reveal (epic I-1…I-6): the SELECTED building renders as a roof-off cutaway
   *  (interior rooms, rood screen, stacked storeys, crypt). ON by default now that the cutaway
   *  is verified coherent in-game; `?noInterior` opts back to the solid-exterior render. (The
   *  legacy `?interiorReveal`/`?i2` enable-flags are kept as harmless no-ops.) With nothing
   *  selected, `cutawayBuildingId` is null and the render is unchanged from before. */
  private readonly interiorReveal = !hasQueryFlag('noInterior');
  private llmClient!: LLMClient;
  private llmBackfill!: LlmBackfillService;
  private chronicleService!: ChronicleService;
  private fateBrain!: FateBrainService;
  private fateTrigger!: FateTrigger;
  private fatePulse!: FatePulse;
  /** Phase 3 (dialog bubbles): transient store of who is "speaking" right now.
   *  Fed by npc_encounter events, read each frame. Presentation-only (never sim). */
  private speechBubbles = new SpeechBubbleStore();
  /** Phase 3c: budget throttle for the OPTIONAL LLM bubble garnish — reword ONLY
   *  the watched soul's line, at most one call every few seconds, under a hard
   *  session cap. The deterministic line is always the fallback. */
  private garnishThrottle = new GarnishThrottle();
  private llmClientCapable: LLMClient | null = null;   // Tier-2 "key moments" — consumed by the Fate brain (+ structured-output fallbacks)
  private costTracker = new CostTracker();
  private spendChip: SpendChipHandle | null = null;
  private assetLibrary!: AssetLibrary;
  private artResolver!: ArtResolver;
  private buildingArtResolver!: ArtResolver;
  // onWarm kicks a render as each pack lands so buildings texture the moment they're
  // composed — even while the frame loop is idle/paused (otherwise they stay flatblocks
  // until the next camera move; see [[gotcha-buildings-flatblock-static-cache]]).
  private readonly parametricBuildingSource = new ParametricBuildingSource({ onWarm: () => this.requestRender() });
  // Walls/barriers ride the same generate→sprite pipeline as buildings (lit SpritePack per run
  // chunk), replacing the flat-quad barrierSlabs. onWarm re-renders an idle loop as packs land.
  private readonly parametricBarrierSource = new ParametricBarrierSource({ onWarm: () => this.requestRender() });
  // onWarm re-renders an idle loop as lazily-warmed flora VARIANTS land (variant 0 is
  // prewarmed at boot; the extra seeded silhouettes compose off the loading path).
  private readonly parametricPlantSource = new ParametricPlantSource({ onWarm: () => this.requestRender() });
  // Paid building-art generation is OFF by default while the renderer + connectome
  // (roads, etc.) stabilise and the FLUX img2img settings are retuned — re-enable
  // via the `liveBuildingArt` setting once generation is worth paying for again.
  // Cached/vendored sprites still render; uncached buildings fall back to the grey
  // parametric model. The negative-cache (generated-art-cache.ts) means even when
  // re-enabled a gate-failing building is paid for once, not every load.
  private liveBuildingArtEnabled = false; // setting `liveBuildingArt`, default OFF
  // Spend gate + auto-dispatching generate call live in llm-runtime.ts
  // (paidArtGenOptions) — one wiring shared by both paid sources.
  private readonly generatedBuildingArtSource = new GeneratedBuildingArtSource(
    paidArtGenOptions({ enabled: () => this.liveBuildingArtEnabled, costTracker: this.costTracker }),
  );
  // img2img flora sprites — same pipeline + gating as buildings, default OFF (the
  // `liveFloraArt` setting). With no key + an unseeded library it always misses and
  // the renderer shows grey parametric massing; a funded seed (scripts/seed-flora-art.ts)
  // + the flag turns it on. Reuses BUILDING_IMAGE_MODEL so keys match the seed run.
  private liveFloraArtEnabled = false; // setting `liveFloraArt`, default OFF
  private readonly generatedFloraArtSource = new GeneratedFloraArtSource({
    ...paidArtGenOptions({ enabled: () => this.liveFloraArtEnabled, costTracker: this.costTracker, modelId: FLORA_IMAGE_MODEL }),
    // Re-render as each skinned sprite lands, and bump the draw-cache art-rev so the
    // tree layer rebuilds — else the vendored img2img sprite loads but never draws.
    onWarm: () => this.requestRender(),
  });
  // Ground flora (herb/grass/fern) renders as clutter-atlas billboards — one async
  // atlas fetch, no compose. onWarm repaints the billboard fallbacks once it lands.
  private readonly clutterFloraSource = new ClutterFloraArtSource({ onWarm: () => this.requestRender() });
  private decorationImages = new ArtImageCache((id) => this.assetLibrary.resolveBlob(id));
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();
  /** Slow re-kick so post-boot births get LPC sheets too (see generateWorld). */
  private sheetRekickTimer: ReturnType<typeof setInterval> | null = null;
  private assets = new AssetManager();
  private veil!: ReturnType<typeof mountPastVeil>;
  private timeBar: TimeBarHandle | null = null;
  private detachTimeKeys: (() => void) | null = null;
  private renderMap: RenderFn | null = null;
  /** The world-less meta-mode entry (sky backdrop + UI, no sim/terrain/camera).
   *  `onRender` uses it whenever `state.map` is null — that is what lets the
   *  title screen exist before any world does (UI v3 §3.1). */
  private renderMeta: MetaRenderFn | null = null;
  private dev!: DevModeController;
  private renderer!: FrameRenderer;
  private interaction = createInteractionState();
  private input!: InteractionController;
  private presentation!: PresentationDirector;

  /** UI v3: the meta screen stack. Constructed eagerly (it is pure state + draw
   *  dispatch), attached to the UI runtime during construction, and driven by
   *  `bootShell`/`startWorld`/`returnToTitle`. */
  private readonly shell: Shell;
  /** What to boot once the shell is up, or null to stay on the title. */
  private readonly autostart: Autostart | null;
  /** Cached per-slot metadata for the title CONTINUE row and the save/load
   *  screens, refreshed by `bootShell`/`returnToTitle`/`probeSaves` (after any
   *  save or delete). Keyed by slot; a slot with no row here has never been
   *  saved to. `slotsProbed` is false until the FIRST probe lands — the title
   *  never blocks on IndexedDB, so it draws immediately and the CONTINUE row
   *  fills in a frame or two later, same as before this replaced the interim
   *  `SlotSummary` reader (P3a's `save-meta` store now exists to serve this). */
  private slotMetas = new Map<SaveSlot, SaveMeta>();
  private slotsProbed = false;
  /** Settles when the boot-time save probe has (successfully or not) finished
   *  — `probeSaves` never rejects. The page's boot veil races this against a
   *  short grace timeout so the title usually reveals with its CONTINUE/LOAD
   *  notes already in place instead of streaming them in a beat later. */
  savesProbed: Promise<void> = Promise.resolve();
  /** Real playtime accrued in THIS world (ms, real time). Persisted with the
   *  save; meta state, deliberately outside the deterministic sim stream. */
  private playtimeMs = 0;
  /** True once `onWorldReady` has fired — i.e. the world is fully built. Gates
   *  the sim advance, because since the boot restructure the frame loop is
   *  already running while worldgen is in progress (see `onFrame`). */
  private worldReady = false;

  // ── P5: controls (keymap + gamepad) ───────────────────────────────────────
  /** The LIVE keybinding map — `DEFAULT_KEYMAP` merged with whatever the
   *  player has rebound (persisted as a diff in `settings-store.ts`). Read by
   *  `attachControls`/`attachTimeKeys` on every keydown via `getKeymap`, so a
   *  rebind takes effect immediately with no re-attach. */
  private keymap: Keymap = loadKeymap(settingsStore.getKeymap());
  /** The action currently waiting for its next physical key/gamepad button
   *  (the settings CONTROLS tab's REBIND capture state) — the runtime, not
   *  the pure screen module, owns this (see `settings-screen.ts`'s header
   *  doc): a capture is real DOM/gamepad plumbing. Null = not capturing. */
  private capturingAction: Action | null = null;
  /** A one-line status from the LAST rebind (e.g. which action lost a key to
   *  a conflict) — cleared on the next capture start / tab switch / screen
   *  close, surfaced through `SettingsScreenView.keymapNote`. */
  private keymapNote: string | null = null;
  /** Polled once per frame from `onFrame` — a COMPLETE no-op with no pad
   *  connected (see `GamepadPoller`'s doc). */
  private readonly gamepad = new GamepadPoller();

  // ── P5b: photo mode, seed share, tutorial toasts ──────────────────────────
  /** Real-time (`performance.now()`) of the LAST `capture_photo`, or null
   *  before the first one this session — `photoView()` fades the "PHOTO
   *  SAVED" hint from this, never a stored duration (see its own doc). */
  private lastPhotoAt: number | null = null;
  /** The last new-world paste attempt's refusal message (malformed code / a
   *  contentVersion mismatch), or null — surfaced through
   *  `NewGameView.error`. Cleared whenever the new-world screen is (re)opened
   *  so a stale refusal from a PREVIOUS visit never reappears. */
  private newGameError: string | null = null;
  /** Real-time of the last successful `copy_world_code`, paired with the code
   *  itself — feeds the legacy pause menu's "COPIED: …" confirmation
   *  (`worldCodeStatus()`). Both null before the first copy this session. */
  private worldCodeCopiedAt: number | null = null;
  private lastWorldCode: string | null = null;

  constructor(container: HTMLElement, options: GameOptions = {}) {
    this.container = container;
    this.state = createState();
    this.autostart = options.autostart ?? null;
    if (options.ephemeral !== undefined) this.ephemeral = options.ephemeral;
    // Apply the persisted UI-scale preference BEFORE the first frame, so the
    // shell and HUD come up at the player's size rather than snapping after boot.
    setUiScaleMultiplier(settingsStore.getUiScale());
    this.shell = new Shell({
      requestRender: () => this.requestRender(),
      titleView: () => this.buildTitleView(),
      saveView: () => this.buildSlotsView(),
      loadView: () => this.buildSlotsView(),
      settingsView: () => this.buildSettingsView(),
      gameoverView: () => ({ note: null }),
      photoView: () => this.buildPhotoView(),
      newGameView: () => ({ error: this.newGameError }),
      hallView: () => this.buildHallView(),
    });

    this.scheduler = new Scheduler();
    // R9: TimeController owns the requested rate + seek state and advances the
    // scheduler in budgeted slices (fastforward without freezing the frame). It
    // wraps the scheduler; the rate ≤ 1 path is byte-identical to a direct
    // scheduler.tick, so replay/scrub are unaffected.
    this.timeController = new TimeController({
      scheduler: this.scheduler,
      clock: this.state.clock,
      eventLog: this.state.eventLog,
      state: this.state,
    });
    // Seek landings surface as a UiSpec card ("what happened while you were
    // away") — except user-initiated cancels, which land silently.
    this.timeController.onLanded((summary) => {
      const cancelled = this.suppressLandingCard;
      this.suppressLandingCard = false;
      this.requestRender();
      if (cancelled) return;
      const hours = summary.elapsedTicks / TICKS_PER_HOUR;
      const elapsedLabel =
        hours >= 1
          ? `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m passed`
          : `${Math.max(1, Math.round(hours * 60))}m passed`;
      getUiRuntime().showTimeLandingCard(
        summary.quiet || !summary.trigger
          ? { title: 'A quiet stretch', body: 'Nothing of note stirred the world.', elapsedLabel, quiet: true }
          : { title: 'Something stirs', body: describeInterest(summary.trigger.event).label, elapsedLabel, quiet: false },
      );
    });
    // The scheduler's tick-system roster (order is load-bearing) lives in
    // sim-systems.ts; game.ts supplies only the coordinator-side seams.
    registerSimSystems({
      state: this.state, scheduler: this.scheduler,
      commandQueue: this.commandQueue, discoveryQueue: this.discoveryQueue,
      attentionStore: this.attentionStore, authorLog: this.authorLog,
      storyRegistry: this.storyRegistry,
      fateOffline: () => this.llmClientCapable === null,
      onClimateApplied: () => { this.requestRender(); },
      onBeatFired: (subject, storyletId) => {
        this.cuePresentationBeat(subject);
        return this.playStorylet(storyletId, subject);
      },
      focusView: () => this.focusView(),
    });

    this.timeline = new TimelineController({
      state: this.state,
      scheduler: this.scheduler,
      // Pending commands are exogenous input, not sim state — drop them on any
      // snapshot restore so scrubbing/committing never replays a stale click.
      // The authorLog is history (NOT cleared on restore): the executor re-emits
      // recorded editor edits during silent replay. It is truncated on commit and
      // reset on a time-skip baseline.
      onRestore: () => {
        this.commandQueue.clear();
        this.discoveryQueue.clear();
        this.lastDiscoveredNpcId = null;
        this.lastSoulFocusSelection = null; // (cooldown map itself is real-time, not reset)
        this.attentionStore.clearAll();
        // WP-D: Fate's wake throttle is game-side (outside the snapshot seam);
        // a scrub can put the clock BEFORE its lastTick, wedging the cooldown
        // gate shut. Reset — worst case Fate deliberates one cycle sooner.
        this.fateTrigger?.reset();
        // The pulse's day-cadence anchor is runtime throttle state too (arc STATE
        // itself rides the snapshot); a scrub can put the clock before it, so reset.
        this.fatePulse?.reset();
      },
      authorLog: this.authorLog,
    });

    // Autosave: persist the live world to IndexedDB, throttled-on-change and
    // gated on !timeline.isScrubbed. Started once the world is ready (generateWorld).
    this.persistence = new PersistenceController({
      state: this.state,
      timeline: this.timeline,
      now: () => Date.now(),
      // The event history rides an append-only journal now, so each autosave
      // appends only the delta since this slot's cursor. `initialCursor` is set
      // from the resumed save in `onWorldReady` — before that a fresh world
      // legitimately starts at 0.
      meta: () => this.saveMetaInput(),
    });


    // ── LLM Clients (both tiers, from the stored provider config) ──────────
    const llm = bootLlmClients(this.costTracker);
    const providerConfig = llm.config;
    this.llmClient = llm.client;
    this.llmClientCapable = llm.capable;
    this.llmProviderType = providerConfig.type;
    // M1: the chronicler's voice — fast/chat tier, off the sim tick, strictly
    // read-only over the event log. Constructed before `createGameQuery` so its
    // `chronicleLatest` dep closure below is wired the same way `rate`/`timeline`
    // reference already-assigned fields.
    this.chronicleService = new ChronicleService({ state: this.state, client: this.llmClient });
    // Scene canvas (bottom): the WebGPU swap chain renders straight to it — no
    // offscreen canvas, no per-frame drawImage copy. It is the interactive layer.
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    container.appendChild(this.canvas);

    // Overlay canvas (top): transparent 2D-ctx layer for the few overlays the
    // WebGPU-only decree keeps on Canvas2D. pointer-events:none so input reaches
    // the scene canvas underneath; it never clears to an opaque colour, so the
    // GPU scene shows through everywhere it doesn't draw.
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
    container.appendChild(this.overlayCanvas);
    this.ctx = this.overlayCanvas.getContext('2d')!;

    // S0 command/query bus: the read facade + the unified seam a UI/MCP bridge
    // consumes. Built over the already-owned state/queue; __debug shims onto it.
    this.query = createGameQuery({
      state: this.state,
      canvas: this.canvas,
      capture: () => this.captureFrame(),
      rate: () => this.scheduler.getRate(),
      timeline: this.timeline,
      chronicleLatest: () => this.chronicleService.latest(),
    });
    this.bus = createGameBus({
      queue: this.commandQueue, state: this.state, query: this.query,
      // R9: meta verbs (time controls) route to TimeController, never onto the sim
      // queue — so MCP/Fate/story-host/UI all drive time through the same verbs.
      onMeta: (cmd) => this.handleMetaCommand(cmd),
    });

    // Story packs are validated against the bus's actual capability set on load,
    // so an authored `do` can only invoke registered, sandboxed verbs. The drought
    // sample ships as a built-in; UGC/Fate-authored packs register the same way.
    const packErrors = this.storyRegistry.register(droughtOmenPack, { allowedVerbs: busAllowedVerbs(this.bus) });
    if (packErrors.length) console.warn('[story] sample pack rejected:', packErrors);

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    this.cleanupTokens = injectTokens(this.container);

    this.veil = mountPastVeil(this.container);

    // Presentation layer (adaptive score + sfx + cinematic camera + voice). Pure
    // observer of the sim — reads GameState + EventLog, never mutates. Off the
    // deterministic path; turning it off leaves the game bit-identical.
    this.presentation = new PresentationDirector(this.state, { viewport: () => this.viewport() });
    this.presentation.attach();
    // L6 (legacy chrome retirement): the clock renders via the WebGPU HUD's
    // transport cluster (Round 9 WP-B) — the DOM time chip (`mountTimeChip`,
    // `?legacyui`'s only mount point) and its `chrome.ts` anchor slots are
    // gone; nothing mounts DOM chrome over the canvas anymore.

    this.detachTimeKeys = attachTimeKeys(window, {
      onToggleTimeBar: () => this.toggleTimeBar(),
      onTogglePause:   () => this.togglePause(),
      onSetRate:       (n) => { this.scheduler.setRate(n); this.requestRender(); },
      timeBarOpen:     () => this.timeBar !== null,
      onEscape:        () => { if (this.timeBar) this.toggleTimeBar(); },
      getKeymap:       () => this.keymap,
    });

    // L2-L6 (legacy chrome retirement): `GameUiCallbacks` is gone — every
    // field it used to carry (camera zoom, new-world, game-setting/LLM-config
    // change, the L2/L3 whisper-mind-mode/rival plumbing) fed a DOM surface
    // that's since been deleted or superseded by an independently-wired GPU
    // path (the camera cluster and `new_game` meta verb both call straight
    // into `this.cameraZoomIn`/`this.newWorld` etc. a few lines below,
    // untouched). `liveBuildingArt`/`liveFloraArt`/`showPoiMarkers` lose their
    // last (already-unreachable — gated behind the same dead DOM settings
    // panel) toggle path; `showLabels`/`debug` keep their independent keybind
    // toggles (`onToggleLabels`/`onToggleDebug`, below).
    this.ui = new GameUi(this.container);

    this.spendChip = mountSpendChip(this.ui.bottomLeftBar, this.costTracker);
    this.spendChip.setVisible(providerConfig.type === 'openrouter');

    this.llmBackfill = new LlmBackfillService({
      state: this.state,
      client: this.llmClient,
      onWriteback: () => { this.requestRender(); },
    });

    // ── Fate brain (Track 4) — autonomous reactive producer ──────────────────
    this.fateBrain = new FateBrainService({
      getState: () => this.state,
      getCapableClient: () => this.llmClientCapable,
      isScrubbed: () => this.timeline.isScrubbed,
      emitCommand: (cmd) => this.commandQueue.emit(cmd),
      getValidStoryletIds: () => this.storyRegistry.storyletIds(),
    });
    this.fateTrigger = new FateTrigger({
      clock: this.state.clock,
      cooldownTicks: 480,                       // ≥8 real seconds between deliberations — an LLM-call throttle (real-time intent), NOT fiction pacing
      isReady: () => this.fateBrain.isReady(),
      onTrigger: (focus) => { void this.fateBrain.deliberate(focus); },
    });
    this.fateTrigger.attach((fn) => this.state.eventLog.subscribe(fn));
    // Phase 3 (dialog bubbles): an encounter makes its speaker say something. The
    // deterministic producer runs FREE for every encounter; we only bother spawning
    // a bubble when the player is close enough to read one (settlement/soul band) —
    // out at the world band the town is a map, not a stage.
    this.state.eventLog.subscribe((a) => this.onEncounterEvent(a));
    // P5b: the game-over / fade screen. `god_faded` fires EXACTLY ONCE per
    // transition (`SpiritSystem`'s own `wasFaded` guard — see
    // `sim/spirit-system.ts`), so this needs no debouncing of its own; a
    // RESUMED save that was already faded before this session started does
    // not refire it (`EventLog.hydrate` deliberately does not re-notify
    // subscribers), which is the correct "once per transition" contract, not
    // a gap. Symmetric wiring point for player, rivals and great gods alike
    // (VISION §5) — only the PLAYER's fade owns the shell, though: a rival's
    // or a great god's fade is the player's news, not the player's screen.
    this.state.eventLog.subscribe((a) => {
      const ev = a.event;
      if (ev.type !== 'god_faded' || ev.spiritId !== PLAYER_SPIRIT_ID) return;
      this.shell.push('gameover');
      this.requestRender();
    });
    // abilities-v1 A4: cast FX subscribe to the event log, not to the player's
    // click. `emitDivine` (the player-only surface) used to fire FX itself, right
    // after `bus.emit` — so a cast issued by the bus/MCP/a rival/Fate produced no
    // visual feedback at all (wrong direction for player-agent-control). Same
    // subscription seam `onEncounterEvent` above already uses, so it inherits the
    // SAME replay/scrub safety for free: `TimelineController.forwardSilent` drives
    // scrub replay through a `SilentEventLog` (append/subscribe are no-ops, see
    // `core/events.ts`) rather than `state.eventLog`, and a save load calls
    // `eventLog.hydrate()`, which is explicitly silent (does not re-notify
    // subscribers). So this fires exactly once per genuine append — never during
    // a scrub-forward or a load replaying history.
    this.state.eventLog.subscribe((a) => this.onDivineFxEvent(a));
    // F2: Fate's heartbeat — wakes the brain once a game-day even when nothing
    // happened ("what are you building toward?"), sharing FateTrigger's cooldown so
    // a pulse can't pile onto a just-fired event deliberation. Ticked from onFrame.
    this.fatePulse = new FatePulse({
      getState: () => this.state,
      isOffline: () => this.llmClientCapable === null,
      fire: (focus) => { this.fateTrigger.pulse(focus, this.state.clock.now()); },
    });

    this.divine = new DivineActionsController({ state: this.state, queue: this.commandQueue, divineEffects: this.ui.divineEffects });

    this.conversation = new ConversationController({
      state: this.state, queue: this.commandQueue, attentionStore: this.attentionStore,
      // A conversation is a focused key moment: prefer the capable tier when the
      // provider configures one, falling back to the chat tier (the mind-page
      // pattern). applyLlmConfig rebuilds both clients live — read through.
      llm: () => this.llmClientCapable ?? this.llmClient,
      // Fallback: emit the pre-paired command directly (one-shot). Cast FX are
      // no longer fired here (abilities-v1 A4) — they fire off the event log
      // once the command actually applies, same as every other emitter.
      emitFallback: (choice) => {
        const cmd = choice.command;
        this.bus.emit({ verb: cmd.verb, source: cmd.source, target: cmd.target, params: cmd.params, payload: cmd.payload });
        this.invalidateHudSim();
        this.requestRender();
      },
      invalidateHudSim: () => this.invalidateHudSim(),
      requestRender: this.requestRender,
    });

    this.dev = new DevModeController({
      container: this.container, state: this.state, scheduler: this.scheduler,
      getViewport: () => this.viewport(), getRenderDeps: () => this.renderDeps(),
      commandQueue: this.commandQueue,
      getLlmCapable: () => this.llmClientCapable,
      // Dev tooling moved to the Studio harness; the game ships without the
      // in-game dev UI. `?dev` opts it back in for local debugging.
      headless: !hasQueryFlag('dev'),
    });

    this.renderer = new FrameRenderer({
      ctx: this.ctx, state: this.state,
      ui: { divineEffects: this.ui.divineEffects,
            tooltip: this.ui.tooltip, debugHud: this.ui.debugHud },
      divine: this.divine, dev: this.dev,
      interaction: this.interaction,
      getRenderDeps: () => this.renderDeps(), getViewport: () => this.viewport(),
      renderMap: () => this.renderMap,
      isPaused: () => this.scheduler.getRate() === 0,
      wouldResolveTarget: (x, y, kinds) => this.resolveTargetAt(x, y, kinds) !== null,
    });

    this.input = new InteractionController({
      state: this.state, interaction: this.interaction,
      dev: this.dev,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      // Canvas interactions mutate selection / cast divine actions → redraw even
      // while paused (divine effects keep animating via DivineEffects.isActive()).
      onTileClick: (x, y) => {
        // A verb-first cast in progress? This click IS the target.
        if (this.interaction.targeting) { this.resolveTargetedCast(x, y); this.requestRender(); return; }
        this.input.onTileClick(x, y); this.requestRender();
      },
      onTileRightClick: (x, y) => {
        if (this.interaction.targeting) { this.interaction.targeting = null; this.requestRender(); return; } // cancel aim
        void this.input.onTileRightClick(x, y); this.requestRender();
      },
      onRightClick: (sx, sy) => {
        if (this.interaction.targeting) { this.interaction.targeting = null; this.requestRender(); return; } // cancel aim
        void this.input.onRightClick(sx, sy); this.requestRender();
      },
      // abilities-v1 B4: only an 'area'-footprint armed cast captures the drag —
      // a 'point' cast (or nothing armed) is untouched, so the camera pans
      // exactly as it always has (the regression this slice is strictest about).
      shouldCaptureDrag: () => this.interaction.targeting?.footprint === 'area',
      onDragArea: (phase, x, y) => this.onDragArea(phase, x, y),
      onTogglePause: () => this.togglePause(),
      onToggleLabels: () => { this.state.showLabels = !this.state.showLabels; this.requestRender(); },
      onToggleDebug: () => {
        this.state.debug = !this.state.debug;
        this.ui.debugHud.style.display = this.state.debug ? 'block' : 'none';
        this.requestRender();
      },
      onHoverTile: (x, y, sx, sy) => {
        this.interaction.hoverTile = { x, y };
        this.interaction.hoverScreen = { x: sx, y: sy };
        this.requestRender();  // hover highlight must redraw even while paused
      },
      onToggleFollow: () => {
        if (!this.state.selectedNpcId) return;
        this.state.followNpc = !this.state.followNpc;
        this.requestRender();
      },
      onUserCameraInput: () => { this.state.followNpc = false; this.state.cameraFly = null; this.requestRender(); },
      // Lift-aware picking: bind the live world's terrain so a click/hover resolves the
      // tile actually drawn under the cursor on slopes (not its flat sea-level shadow).
      getPickEnv: () => (this.state.map ? isoEnvForMap(this.state.map) : null),
      getZoomQuantize: () => quantizeIsoZoom,
      // Barebones: the settings shortcut opens the WebGPU pause menu (which hosts
      // settings); only legacy mode toggles the old DOM settings panel.
      onToggleSettings: () => getUiRuntime().toggleMenu(),
      onPhotoMode: () => this.bus.emit({ verb: 'capture_photo', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } }),
      getKeymap: () => this.keymap,
      onRedraw: this.requestRender,  // controls fire this on drag-pan + wheel-zoom
    });

    // ── WebGPU UI runtime (barebones HUD + Esc pause menu) ────────────────
    // Capture-phase listeners on the canvas, so menu/HUD taps consume before the
    // world handlers above. Power drives the presence orb; menu opening pauses sim.
    const ui = getUiRuntime();
    ui.configure({
      requestRender: this.requestRender,
      getPower: () => Math.min(1, this.hudSim().belief.power / 20),
      onNewWorld: () => { void this.newWorld(); },
      onMenuToggle: (open) => {
        // pause while the menu is up; restore the PRIOR rate on close (don't
        // clobber a pre-existing pause or a 2×/4×/8× speed)
        if (open) {
          this.menuPrevRate = this.scheduler.getRate();
          this.scheduler.setRate(0);
        } else {
          this.scheduler.setRate(this.menuPrevRate);
        }
        this.requestRender();
      },
      getLighting: () => this.dev.devMode.lighting !== 'off',
      onToggleLighting: () => {
        this.dev.devMode.lighting = this.dev.devMode.lighting === 'off' ? 'banded' : 'off';
        this.requestRender();
        return this.dev.devMode.lighting !== 'off';
      },
      onSaveLlmConfig: (cfg) => this.applyLlmConfig(cfg),
      // P5b: seed share, from the legacy pause menu's left nav — the same
      // meta-verb path every shell action takes (spec §3.7); `Game` owns the
      // real `WORLD_CONTENT_VERSION`/clipboard write in `handleMetaCommand`'s
      // `copy_world_code` case, not this hook.
      onCopyWorldCode: () => this.bus.emit({ verb: 'copy_world_code', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } }),
      getWorldCodeStatus: () => this.worldCodeStatus(),
      // Phase C H4: HALL OF THE GODS, from the pause menu's left nav. `open_screen`
      // and nothing else — a player's click and a connected agent's
      // `emit_command` take the identical route in, so the hall has ONE entry
      // point with one set of bugs (plan §1.4). The row already closed the menu
      // before this fires (see `onOpenHall`'s doc: the menu's rate stash must
      // not be left holding the world at 0 behind the hall).
      onOpenHall: () => this.bus.emit({
        verb: 'open_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' },
        params: { screen: 'hall' },
      }),
      // A story card is modal narrative — pause the sim while it's up, restore the
      // prior rate (could be 2×/4×/8× or an existing pause) when it dismisses.
      // Idempotent on repeat toggles: presenting a card OVER an open card would
      // otherwise re-stash the already-zeroed rate and wedge the game paused on
      // dismiss (R9 landing cards made this collision likely).
      onStoryToggle: (active) => {
        if (active === this.storyModalActive) return;
        this.storyModalActive = active;
        if (active) {
          this.storyPrevRate = this.scheduler.getRate();
          this.scheduler.setRate(0);
        } else {
          this.scheduler.setRate(this.storyPrevRate);
        }
        this.presentation.setStoryActive(active); // duck the score while modal
        this.requestRender();
      },
      onCardFreeText: (text) => this.conversation.sendFreeText(text),
      // ── Track B: belief-granted powers + the divine inbox ──
      getBeliefPowers: () => this.hudSim().powers,
      onCastPower: (verb) => this.castPower(verb),
      getTargeting: () => {
        const t = this.interaction.targeting;
        if (!t) return null;
        const miss = performance.now() - this.missFlashAt < Game.MISS_FLASH_MS;
        return { label: t.label, targetKinds: t.targetKinds, footprint: t.footprint, miss, drag: this.dragPreview(t) };
      },
      // A3: Esc cancels an in-progress cast before it reaches the card/menu chain.
      // Consumed only while actually aiming — otherwise Esc falls through to the
      // runtime's own dismissCard()/toggleMenu() precedence.
      onCancelTargeting: () => {
        if (!this.interaction.targeting) return false;
        this.interaction.targeting = null;
        this.requestRender();
        return true;
      },
      getHoverAffordances: () => this.hoverAffordances(),
      onHoverChip: (verb) => this.castHoverChip(verb),
      getHoverTooltip: () => this.hoverTooltip(),
      // ── P3.8: the target-first inspector (reads the live selection) ──
      getInspector: () => this.inspectorView(),
      onInspectorCast: (verb) => this.castInspector(verb),
      onCloseInspector: () => {
        this.state.selectedNpcId = null;
        this.state.selectedBuildingId = null;
        this.state.pinnedNpcId = null;
        this.requestRender();
      },
      getInbox: () => this.hudSim().inbox,
      onInboxAct: (item) => this.actOnInbox(item),
      onInboxInvestigate: (item) => {
        if (item.target.kind === 'npc') {
          this.state.selectedNpcId = item.target.npcId;
          this.frameSubject({ kind: 'npc', npcId: item.target.npcId });
          this.requestRender();
        }
      },
      // ── W4 (D9): the chronicle browser (inbox panel's ANNALS mode) — plain
      // reads off the chronicler's ring, newest first (the runtime browses,
      // never mutates). `dayIndex` doubles as the row's display `day`.
      getAnnals: () => this.chronicleService.entries()
        .slice()
        .reverse()
        .map((e) => ({ day: e.dayIndex, title: `Y${e.year} ${e.season}, day ${e.dayOfYear}`, body: e.text })),
      // ── W4 (D7): the pantheon panel (rivals finally visible) — pure read +
      // focus, no new commands. A rival click flies to + selects its strongest
      // settlement, the exact idiom `onWorldLabel` already uses.
      getPantheon: () => this.query.pantheon(),
      onPantheonRow: (id) => {
        const row = this.query.pantheon().find((r) => r.id === id);
        if (!row || row.isPlayer || !row.strongestPoiId) return;
        this.state.selectedPoiId = row.strongestPoiId;
        this.state.selectedNpcId = null;
        this.state.selectedBuildingId = null;
        this.frameSubject({ kind: 'settlement', poiId: row.strongestPoiId });
        this.requestRender();
      },
      // P5 alert pins are PARKED (user: no floating icons over the world) — the
      // projection (`affordance/alert-pins.ts`) and the ui-runtime renderer stay,
      // but nothing feeds them. Re-enable by restoring the getAlertPins hook here.
      // ── UI v2 W1/D4: World-band settlement labels — the parked pins' honest
      // replacement (map typography, not icons). World-band-only by construction:
      // `buildWorldLabels` gets a fresh viewport read each call, but the hook
      // itself gates on `currentBand()` so the labels simply don't exist outside it.
      getWorldLabels: () => {
        if (this.currentBand() !== 'world') return null;
        const pois = this.state.worldSeed?.pois ?? [];
        if (pois.length === 0) return null;
        return buildWorldLabels(
          pois,
          this.hudSim().inbox,
          this.worldContest(),
          this.focusedSettlementPoiId(),
          this.state.camera,
          devicePixelRatio,
          { w: this.canvas.width, h: this.canvas.height },
        );
      },
      // Phase 3 (dialog bubbles): live spoken lines over speakers' heads. Gated to
      // the close bands (settlement/soul) — out at the world band the town is a map,
      // not a stage. Projected per-frame from each speaker's LIVE position (same
      // idiom as the labels above) so a bubble tracks its walking speaker.
      getSpeechBubbles: () => {
        if (this.currentBand() === 'world') return null;
        const world = this.state.world;
        if (!world) return null;
        return buildSpeechBubbles(
          this.speechBubbles,
          performance.now(),
          (id) => { const e = world.registry.get(id); return e ? { x: e.x, y: e.y } : null; },
          this.state.camera,
          devicePixelRatio,
          { w: this.canvas.width, h: this.canvas.height },
        );
      },
      // Click a settlement label: focus it directly (the world band has no
      // building to hang the selection off) + fly to the settlement altitude.
      onWorldLabel: (poiId) => {
        this.state.selectedPoiId = poiId;
        this.state.selectedNpcId = null;
        this.state.selectedBuildingId = null;
        this.frameSubject({ kind: 'settlement', poiId });
        this.requestRender();
      },
      // ── W-I-d: selected causal-site card ──
      getSelectedSite: () => {
        const id = this.state.selectedCausalSiteId;
        if (!id) return null;
        const site = this.state.causalSites?.byId(id);
        return site ? causalSiteCardView(site, this.state.spirits) : null;
      },
      onCloseSite: () => {
        this.state.selectedCausalSiteId = null;
        this.requestRender();
      },
      // ── legacy-chrome L0: camera controls as GPU buttons ──
      onZoomIn: () => this.cameraZoomIn(),
      onZoomOut: () => this.cameraZoomOut(),
      onFitView: () => this.cameraFitView(),
      onZoomActual: () => this.cameraZoomActual(),
      // ── Round 9: time transport (fastforward + jump-to-next-event) ──
      // All dispatch funnels through the meta-verb path (`dispatchTimeCommand`)
      // so the UI, MCP, Fate, and story hosts drive time identically.
      timeStatus: () => {
        const requestedRate = this.timeController.getRequestedRate();
        return {
          requestedRate,
          effectiveRate: this.timeController.getEffectiveRate(),
          ladder: [...TIME_RATE_LADDER],
          paused: requestedRate === 0,
          clockLabel: calendarLabel(this.state.clock.now()),
          seeking: this.timeController.seekStatus(),
        };
      },
      onTimeCommand: (cmd) => {
        switch (cmd.kind) {
          case 'set_rate':
            this.dispatchTimeCommand({ verb: 'set_time_rate', params: { rate: cmd.rate } });
            break;
          case 'toggle_pause':
            this.dispatchTimeCommand({
              verb: 'set_time_rate',
              params: { rate: this.timeController.getRequestedRate() === 0 ? 1 : 0 },
            });
            break;
          case 'skip_to_next_event':
            this.dispatchTimeCommand({ verb: 'skip_to_next_event', params: {} });
            break;
          case 'cancel_seek':
            this.dispatchTimeCommand({ verb: 'cancel_seek', params: {} });
            break;
        }
      },

      // ── UI v3: the meta shell ──
      // Every title choice becomes a META COMMAND rather than a direct method
      // call, so the exact path a player's click takes is the path a connected
      // agent's `emit_command` takes (spec §3.7). One route, one set of bugs.
      onTitleAction: (action: TitleAction) => {
        switch (action.kind) {
          case 'continue':
            this.bus.emit({ verb: 'load_slot', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { slot: 'autosave' } });
            break;
          case 'new_world':
            // P5b: NEW WORLD lands on the new-world screen (random OR a pasted
            // seed-share code) rather than firing `new_game` straight away —
            // see `newgame-screen.ts`'s header. `open_screen` is the SAME
            // meta-verb path every other shell navigation takes (and clears
            // any stale refusal from a PREVIOUS visit — see its own case).
            this.bus.emit({ verb: 'open_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { screen: 'newgame' } });
            break;
          case 'demo':
            this.bus.emit({ verb: 'new_game', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { demo: 1 } });
            break;
          case 'load':
            this.bus.emit({ verb: 'open_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { screen: 'load' } });
            break;
          case 'settings':
            this.bus.emit({ verb: 'open_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { screen: 'settings' } });
            break;
        }
      },
      onSaveAction: (action: SaveAction) => {
        switch (action.kind) {
          case 'save':
            this.bus.emit({ verb: 'save_slot', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { slot: action.slot } });
            break;
          case 'delete':
            this.bus.emit({ verb: 'delete_slot', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { slot: action.slot } });
            break;
          case 'back':
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
        }
      },
      onLoadAction: (action: LoadAction) => {
        switch (action.kind) {
          case 'load':
            this.bus.emit({ verb: 'load_slot', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { slot: action.slot } });
            break;
          case 'delete':
            this.bus.emit({ verb: 'delete_slot', source: PLAYER_SPIRIT_ID, target: { kind: 'none' }, params: { slot: action.slot } });
            break;
          case 'back':
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
        }
      },
      onGameOverAction: (action: GameOverAction) => {
        switch (action.kind) {
          case 'keep_watching':
            // Pop the screen; the god is already whisper-only (spirit.faded,
            // enforced by `isSilenced` at the divine-action guard) — nothing
            // else changes. Same meta path as every other "back".
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
          case 'begin_again':
            this.bus.emit({ verb: 'new_game', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
        }
      },
      onNewGameAction: (action: NewGameAction) => {
        switch (action.kind) {
          case 'random':
            this.bus.emit({ verb: 'new_game', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
          case 'back':
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
        }
      },
      // P5b: the new-world screen's paste field submitted raw text. Decoding
      // (and the real `WORLD_CONTENT_VERSION`) lives HERE, not in the pure
      // screen module — a successful decode fires `new_game` with the
      // recovered `genSeed` through the SAME meta path every other shell
      // action takes; a refusal is stored for `NewGameView.error` to show,
      // never thrown or silently dropped.
      onWorldCodeSubmit: (text) => {
        const decoded = decodeWorldCode(text, WORLD_CONTENT_VERSION);
        if (!decoded.ok) {
          this.newGameError = decoded.message;
          this.requestRender();
          return;
        }
        this.newGameError = null;
        this.bus.emit({
          verb: 'new_game', source: PLAYER_SPIRIT_ID, target: { kind: 'none' },
          params: { genSeed: decoded.code.genSeed },
        });
      },
      onSettingsAction: (action: SettingsAction) => {
        switch (action.kind) {
          case 'set':
            // Always a meta command, even though `Game` owns `this.shell` directly
            // — the point is that a player's click and an agent's `emit_command`
            // for `set_setting` are the SAME path (spec §3.7). `Command.params`
            // is `string | number` only, so a boolean value rides as a string —
            // `toBoolParam`/`applySetting` on the receiving end already accepts
            // that shape (a bus-connected agent's value arrives the same way).
            this.bus.emit({
              verb: 'set_setting', source: PLAYER_SPIRIT_ID, target: { kind: 'none' },
              params: { key: action.key, value: typeof action.value === 'boolean' ? String(action.value) : action.value },
            });
            break;
          case 'tab':
            // Pure Shell-local presentation state (which tab is selected) — a
            // direct call, not a bus round-trip. See `Shell.setSettingsTab`'s doc.
            this.shell.setSettingsTab(action.tab);
            // Navigating away mid-capture must not leave the capture-phase
            // listener live — it would silently steal the NEXT keypress
            // anywhere in the game (a rebind for a row the player can no
            // longer even see) instead of doing whatever key that was meant
            // to do. Leaving a stale note behind reads as a bug too ("why is
            // this still here") once the player has moved on.
            this.cancelKeyCapture();
            this.keymapNote = null;
            break;
          case 'rebind_start':
            // Arm the capture: the actual key/gamepad LISTEN happens once, in
            // `startKeyCapture` below — not re-armed per render, and not a
            // bus round-trip itself (only the RESULT, `rebind_key`, is).
            this.startKeyCapture(action.action);
            break;
          case 'rebind_cancel':
            this.cancelKeyCapture();
            break;
          case 'reset_controls':
            // DEVIATION (documented, not silent): every other settings mutation
            // in this hook is a meta Command through the bus (spec §3.7's rule),
            // but no `reset_keymap` verb exists in the registry — the brief
            // scoped this slice to servicing `rebind_key` specifically, and
            // adding a whole new registry verb (+ capability discovery + tests)
            // for ONE button is out of scope here. `rebind_start`/`rebind_cancel`
            // get the same direct-call treatment `Shell.setSettingsTab`'s 'tab'
            // case already established as precedent (arming/disarming a local
            // capture listener, not itself persisted game state). A future slice
            // wanting RESET agent-drivable should add `reset_keymap` to the
            // registry the same way `rebind_key` already is, then route this
            // through `this.bus.emit` like `set_setting` does.
            this.keymap = DEFAULT_KEYMAP;
            settingsStore.setKeymap({});
            this.keymapNote = 'RESET TO DEFAULTS.';
            this.cancelKeyCapture();
            this.requestRender();
            break;
          case 'back':
            this.cancelKeyCapture();
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
        }
      },
      onHallAction: (action: HallAction) => {
        switch (action.kind) {
          case 'back':
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            break;
          case 'select':
            // Pure Shell-local presentation state (which pedestal's detail pane
            // is open) — a direct call, not a bus round-trip, exactly as the
            // settings screen's `{kind:'tab'}` case does. An agent already sees
            // every pedestal through `describe()` without selecting one.
            this.shell.setHallDomain(action.domain);
            break;
          case 'cast':
            // CLOSE THE HALL FIRST, then arm: `castPower` arms the reticle for
            // the next MAP click, and the hall is a full-surface modal that
            // swallows every pointer event — arming underneath it would leave
            // the player aiming at a screen they cannot click through. Same
            // `close_screen` meta verb every other shell "back" uses, then the
            // SAME `castPower` path the POWERS panel button takes (one reticle,
            // one set of bugs).
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
            this.castPower(action.verb);
            break;
        }
      },
      onShellEscape: () => {
        // "Back" on the title is nothing (there is nowhere further out); on any
        // deeper screen it pops one level.
        const top = this.shell.top();
        if (top !== null && top !== 'title' && top !== 'loading') {
          this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
        }
      },
      // UI v3 sky-transition spike: click-to-skip. `tickShellTransition` (run
      // from the very next `onRender`) reads the now-jumped-to-1 phase and
      // reacts exactly as natural completion would — including firing the
      // ascent's real reset.
      onTransitionSkip: () => {
        this.shell.skipTransition();
        this.requestRender();
      },
    });
    ui.setShell(this.shell);
    this.cleanupUi = ui.attach(this.canvas);
  }

  /**
   * UI v2 W3 (D6): fire the LLM backfill for a freshly soul-focused npc, gated by
   * a per-npc real-time cooldown (`soulWarmFocusDue`) so re-selecting doesn't
   * spam paid calls. Silent no-op (no error, no UI) when: no LLM is actually
   * configured (mock provider), the npc no longer resolves, or the cooldown
   * hasn't elapsed. Fire-and-forget — never awaited, never blocks the frame loop.
   */
  private noteSoulFocus(npcId: string): void {
    if (this.llmProviderType === 'mock') return; // nothing configured to warm
    const now = Date.now();
    if (!soulWarmFocusDue(npcId, this.soulFocusFiredAt, now)) return;
    const world = this.state.world;
    if (!world) return;
    const entity = getNpc(world, npcId);
    if (!entity) return;
    this.soulFocusFiredAt.set(npcId, now); // record on ATTEMPT, not on resolve — a mid-flight re-select must still respect the cooldown
    void this.llmBackfill.trigger(entity).catch((err) => {
      console.error('[soul-focus] warm backfill failed:', err);
    });
  }

  /** Rebuild both client tiers in place from a just-saved config (no reload). */
  private applyLlmConfig(config: ProviderConfig): void {
    try {
      this.llmClient = buildChatClient(config, this.costTracker);
      this.llmBackfill.setClient(this.llmClient);
      this.chronicleService.setClient(this.llmClient);
      this.llmClientCapable = buildCapableClient(config, this.costTracker);
      this.llmProviderType = config.type;
      this.spendChip?.setVisible(config.type === 'openrouter');
    } catch (err) {
      console.warn('[llm] config not applied:', err);
    }
  }

  /**
   * Open a storylet as an interactive card in the WebGPU UI. Looks the id up in
   * the registry, builds a bus-backed host (so `do` effects become real, sandboxed
   * commands acting as the player) and a deterministic session (seeded from the
   * world + clock), then hands it to the UI runtime. Returns false if the id is
   * unknown — the staging seam and `__debug.playStory` both route through here.
   */
  playStorylet(storyletId: string, subject?: ThreadSubject): boolean {
    const pack = this.storyRegistry.findByStorylet(storyletId);
    if (!pack) return false;
    const host = createBusStoryHost(this.bus, { source: PLAYER_SPIRIT_ID, subject });
    const seed = ((this.state.map?.seed ?? 1) ^ (this.state.clock.now() | 0)) >>> 0;
    const session = new StorySession(pack, { host, seed });
    getUiRuntime().presentStory(session, storyletId);
    // Voice the opening line (no-op unless voiceover is enabled).
    const stage = session.current;
    if (stage.kind === 'line' && stage.line.text) this.presentation.speakLine(stage.line.text);
    return true;
  }

  /** Cinematic + leitmotif cue when a staged beat fires on a subject. Resolves
   *  the subject to a tile so the camera can frame it; pure presentation. */
  private cuePresentationBeat(subject: ThreadSubject): void {
    let key: string | null = null;
    let tile: { x: number; y: number } | null = null;
    if (subject.kind === 'npc') {
      key = subject.npcId;
      const e = this.state.world ? getNpc(this.state.world, subject.npcId) : undefined;
      if (e) tile = { x: e.x, y: e.y };
    } else if (subject.kind === 'settlement') {
      key = subject.poiId;
      const poi = this.state.worldSeed?.pois.find((p) => p.id === subject.poiId);
      if (poi?.position) tile = { x: poi.position.x, y: poi.position.y };
    } else if (subject.kind === 'site') {
      key = subject.siteId;
      const site = this.state.causalSites?.byId(subject.siteId);
      if (site) tile = { x: site.pos.x, y: site.pos.y };
    } else {
      key = subject.spiritId;
    }
    this.presentation.cueBeat(key, tile);
  }

  /**
   * Cast a belief-granted power (the skill panel's "CAST"). CAST always arms the
   * reticle — the next map click resolves the target (`resolveTargetedCast`); a
   * previously-selected NPC may pre-highlight under the reticle (A2) but no longer
   * fires instantly (that auto-pick fast path shadowed the whole verb-first-cast
   * feature — product decision 1, abilities-v1 plan §1). The command still runs
   * the full belief-gate at the tick boundary, so a not-yet-believed power is
   * rejected regardless.
   */
  private castPower(verb: string): void {
    // Target shapes + reticle footprint come from the registry (the single source
    // of truth), NOT from `this.bus.capabilities()` — the CapabilityView doesn't
    // carry footprint (yet). `beliefPowers()` still supplies the human label.
    const cap = getCapability(verb as CommandVerb);
    if (!cap) return;
    const label = this.query.beliefPowers().find(p => p.verb === verb)?.label ?? verb;
    this.interaction.targeting = {
      verb, label,
      targetKinds: acceptedTargetKinds(cap),
      footprint: capFootprint(cap),
    };
    this.requestRender();
  }

  /** Real-clock timestamp of the last invalid-click miss while aiming a cast, so
   *  `getTargeting` can flash an honest "nothing there" for a short window (A5)
   *  instead of the reticle silently doing nothing. 0 = no recent miss. */
  private missFlashAt = 0;
  private static readonly MISS_FLASH_MS = 900;

  /**
   * Resolve an in-progress verb-first cast against the tile the player clicked.
   * An invalid click (nothing under the cursor the verb's `targetKinds` accept)
   * STAYS armed and flashes a miss — only a successful resolve, Esc, or
   * right-click exits aim (product decision 2, abilities-v1 plan §1).
   */
  private resolveTargetedCast(x: number, y: number): void {
    const aim = this.interaction.targeting;
    if (!aim || !this.state.world) return;
    const target = this.resolveTargetAt(x, y, aim.targetKinds);
    if (!target) {
      this.missFlashAt = performance.now();
      this.requestRender();
      // Force one more redraw after the flash window so it actually clears when
      // the sim is paused (idle/paused frames only render on-demand — nothing
      // else would wake the driver up to notice the flash expired).
      setTimeout(() => this.requestRender(), Game.MISS_FLASH_MS + 50);
      return;
    }
    this.interaction.targeting = null;   // clear immediately before emitDivine fires
    this.emitDivine(aim.verb as CommandVerb, target);
  }

  /**
   * abilities-v1 B4: the click+drag gesture for an 'area'-footprint cast
   * (`summon_storm`). `attachControls` routes the WHOLE gesture here instead
   * of the ordinary pan/click path once `shouldCaptureDrag` claims it — see
   * that callback's doc for why. 'start' stamps the anchor (the disc's fixed
   * centre) onto the live `TargetingMode`; 'update' is a no-op here because
   * the live radius is derived on the fly from `anchor` + the ALREADY-tracked
   * `interaction.hoverTile` (via the ordinary `onHoverTile` callback, which
   * `attachControls` keeps firing throughout — no separate state to keep in
   * sync); 'end' clamps that same distance and emits the cast.
   *
   * A plain click (`start` immediately followed by `end` on ~the same tile,
   * abilities-v1 B4's "minimum radius" requirement) needs no special case:
   * distance(anchor, anchor) is 0, and `clampAreaRadius` floors that to 2 —
   * the SAME clamp `previewCommand`/`summonStormAt` apply, so the preview,
   * the hint-bar readout, and the actual cast can never disagree.
   */
  private onDragArea(phase: 'start' | 'update' | 'end' | 'cancel', x: number, y: number): void {
    const aim = this.interaction.targeting;
    if (!aim || aim.footprint !== 'area') return; // aim cancelled (Esc/right-click) mid-gesture
    if (phase === 'start') {
      aim.anchor = { x, y };
      this.requestRender();
      return;
    }
    if (phase === 'cancel') {
      // The cursor left the canvas mid-drag: drop the anchor so the disc
      // preview stops (anchor presence IS "mid-drag" for the renderer and the
      // hint bar) — but stay ARMED, because an accidental cursor exit is not a
      // decision to stop casting. The reticle falls back to its point form,
      // ready to anchor a fresh drag.
      aim.anchor = undefined;
      this.requestRender();
      return;
    }
    if (phase === 'update') {
      this.requestRender(); // repaint the growing disc preview each move
      return;
    }
    // 'end': commit at the anchor-to-release distance, clamped to the playable band.
    if (!aim.anchor) return; // defensive — 'start' always precedes 'end' in practice
    const radius = clampAreaRadius(Math.hypot(x - aim.anchor.x, y - aim.anchor.y));
    const target: CommandTarget = { kind: 'area', x: aim.anchor.x, y: aim.anchor.y, radius };
    this.interaction.targeting = null; // clear before emitDivine, same discipline as resolveTargetedCast
    this.emitDivine(aim.verb as CommandVerb, target);
  }

  /**
   * abilities-v1 B4: the hint bar's live "radius so far / what it will cost"
   * readout while dragging an area cast — undefined once the gesture hasn't
   * anchored yet (before mousedown) or outside area mode entirely. The cost
   * MUST come from `effectiveCost(def, cmd)`, never a re-derived formula here —
   * that's the one authority `previewCommand`/`summonStormAt` also read
   * through, so this readout structurally cannot drift from what a release
   * actually charges (registry.ts's whole point for `costFor`).
   */
  private dragPreview(t: TargetingMode): { radius: number; cost: number } | undefined {
    if (t.footprint !== 'area' || !t.anchor) return undefined;
    const hover = this.interaction.hoverTile;
    const radius = clampAreaRadius(hover ? Math.hypot(hover.x - t.anchor.x, hover.y - t.anchor.y) : 0);
    const cap = getCapability(t.verb as CommandVerb);
    if (!cap) return undefined;
    const cmd: Command = {
      verb: t.verb as CommandVerb, source: PLAYER_SPIRIT_ID,
      target: { kind: 'area', x: t.anchor.x, y: t.anchor.y, radius }, seq: 0,
    };
    return { radius, cost: effectiveCost(cap, cmd) };
  }

  /** The target the hover popover last froze onto, so a chip click acts on the tile
   *  the cursor rested on — not a hover that drifted onto the popover itself. */
  private hoverFrozen: CommandTarget | null = null;

  /**
   * Chips for whatever the cursor rests on — the hover popover's data (spec §5, P3).
   * Resolves the most meaningful target under the hovered tile (an NPC, else the
   * settlement a building belongs to), freezes it, and derives the top affordances
   * through the shared salience brain. Null over empty ground or while aiming a cast.
   */
  private hoverAffordances(): { chips: ReturnType<typeof hoverChips> } | null {
    if (this.interaction.targeting) return null;
    // UI v2 W2/D1: per-target hover chrome collapses ONLY in the `world` band (the
    // map — settlement labels/pins own that altitude, W1). `settlement` and `soul`
    // both resolve the same npc/building-settlement target below.
    if (this.currentBand() === 'world') { this.hoverFrozen = null; return null; }
    const world = this.state.world;
    const tile = this.interaction.hoverTile;
    if (!world || !tile) { this.hoverFrozen = null; return null; }
    const target = this.hoverTargetAt(tile.x, tile.y);
    if (!target) { this.hoverFrozen = null; return null; }
    this.hoverFrozen = target;
    const ctx = { world, spirits: this.state.spirits, log: this.state.eventLog };
    const chips = hoverChips(target, PLAYER_SPIRIT_ID, ctx, this.query.beliefPowers());
    return chips.length ? { chips } : null;
  }

  /**
   * L1 (legacy chrome retirement): the plain hover tooltip's text — an NPC's
   * "Name · role · mood", else a hovered building's "Title · WxH · door Face".
   * Null over empty ground, while aiming a cast, or over the current selection
   * (its own inspector already shows it — no need to double it under the cursor).
   * Ported 1:1 from the deleted `FrameRenderer.updateTooltip`'s normal-mode branch.
   */
  private hoverTooltip(): string | null {
    if (this.interaction.targeting) return null;
    const world = this.state.world;
    const tile = this.interaction.hoverTile;
    if (!world || !tile) return null;
    const npc = world.query({ kind: 'npc' })
      .find((e) => Math.floor(e.x) === tile.x && Math.floor(e.y) === tile.y);
    if (npc && npc.id !== this.state.selectedNpcId) {
      const p = npcProps(npc);
      return `${p.name} · ${p.role} · ${npcMoodLabel(p.mood)}`;
    }
    const building = findBuildingAtTile(world, tile.x, tile.y);
    if (building && building.id !== this.state.selectedBuildingId) {
      const info = buildingInfoOf(building);
      if (info) {
        const door = info.facts.find((f) => f.label === 'Door')?.value ?? '';
        return `${info.title} · ${info.footprint.w}×${info.footprint.h}${door ? ` · door ${door}` : ''}`;
      }
    }
    return null;
  }

  /** The meaningful hover target under a tile: an NPC → else a building's settlement. */
  private hoverTargetAt(x: number, y: number): CommandTarget | null {
    const world = this.state.world;
    if (!world) return null;
    const npc = world.query({ kind: 'npc' }).find((e) => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (npc) return { kind: 'npc', npcId: npc.id };
    const building = world.registry.getAtTile(x, y).find((e) => e.tags?.includes('building'));
    if (building) {
      const poiId = this.nearestPoiId(x, y);
      if (poiId) return { kind: 'settlement', poiId };
    }
    return null;
  }

  /** Fire a hover-popover chip against the frozen hover target. */
  private castHoverChip(verb: string): void {
    const target = this.hoverFrozen;
    if (!target) return;
    this.emitDivine(verb as CommandVerb, target);
  }

  /**
   * The single divine-cast path shared by every player surface (hover / inspector /
   * reticle / inbox / powers). BRANCH-shaped verbs open a card instead of firing:
   * `whisper` becomes the whisper card (P4). Everything else emits its `Command` — cast
   * FX ride the event log now (`onDivineFxEvent`, abilities-v1 A4), not this seam, so a
   * player click and a bus/MCP/rival/Fate cast of the same verb both animate identically.
   */
  private emitDivine(verb: CommandVerb, target: CommandTarget): void {
    if (verb === 'whisper' && this.conversation.present(target)) return;
    this.bus.emit({ verb, source: PLAYER_SPIRIT_ID, target });
    this.invalidateHudSim(); // belief/inbox shift → refresh the HUD memo next frame
    this.requestRender();
  }

  /**
   * abilities-v1 A4: fire cast FX off the event log, keyed on the EVENT'S OWN
   * coordinates — regardless of who cast it (player click, bus/MCP call, a rival,
   * Fate). Only fires on the events that already have a visual: `smite` (the
   * thunderbolt) and `summon_storm` (the raincloud, B5). The event only gets
   * appended when `divine-actions.ts` actually succeeds (see `smite`/`smiteLocation`/
   * `summonStorm`/`summonStormAt` — they append AFTER the power/precondition
   * checks pass), so this is also strictly more correct than the old
   * `emitDivine`-side fire: a doomed cast (insufficient power, precondition
   * failed) used to still flash FX optimistically; now it can't, because there's
   * no event to react to.
   */
  private onDivineFxEvent(a: AppendedEvent): void {
    const ev = a.event;
    if (ev.type === 'smite') {
      const pos = this.eventWorldPos(ev.npcId, ev.poiId, ev.x, ev.y);
      if (pos) this.ui.divineEffects.trigger('smite', pos.x, pos.y);
    } else if (ev.type === 'summon_storm') {
      const pos = this.eventWorldPos(undefined, ev.poiId, ev.x, ev.y);
      if (pos) {
        this.ui.divineEffects.trigger('storm', pos.x, pos.y, ev.radius);
        // abilities-v1 B4/B5: seed VISIBLE cloud over the cast disc, so a
        // placed raincloud actually reads as weather rather than only a
        // flood field + a sprite effect. `ev.radius` is undefined for a
        // settlement cast (only an area cast's event carries one) — fall
        // back to the SAME default `renderStorm` itself falls back to
        // (`DEFAULT_STORM_RADIUS_TILES`), so the cloud and the FX always
        // agree on how big the storm looks. `cloudArea` is deliberately NOT
        // on the `WeatherStepper` sim contract (a render-only decoration, see
        // its doc) — narrow to the concrete `WaterDynamics` shape, the same
        // pattern `debug-api.ts`'s `waterAt()` uses for `lakeOffsetM`/
        // `floodOffsetM`.
        const w = this.state.weather as { cloudArea?: (x: number, y: number, r: number, amount?: number) => number } | null;
        w?.cloudArea?.(pos.x, pos.y, ev.radius ?? DEFAULT_STORM_RADIUS_TILES);
      }
    }
  }

  /** Resolve an event's own npcId?/poiId?/x?/y? fields to a world tile, most
   *  specific first (an npc's LIVE position, else a named settlement, else a bare
   *  spot) — the same priority `targetWorldPos` gives a `CommandTarget`, reused via
   *  its npc/settlement/tile arms rather than re-walking `state.world`/`worldSeed`
   *  a second time. */
  private eventWorldPos(
    npcId: string | undefined, poiId: string | undefined,
    x: number | undefined, y: number | undefined,
  ): { x: number; y: number } | null {
    if (npcId) return this.targetWorldPos({ kind: 'npc', npcId });
    if (poiId) return this.targetWorldPos({ kind: 'settlement', poiId });
    if (x !== undefined && y !== undefined) return this.targetWorldPos({ kind: 'tile', x, y });
    return null;
  }

  /** Resolve a command target to a world tile (for FX / camera framing), or null. */
  private targetWorldPos(target: CommandTarget): { x: number; y: number } | null {
    const world = this.state.world;
    if (!world) return null;
    switch (target.kind) {
      case 'npc': { const e = getNpc(world, target.npcId); return e ? { x: e.x, y: e.y } : null; }
      case 'entity': { const e = world.registry.get(target.id); return e ? { x: e.x, y: e.y } : null; }
      case 'tile': return { x: target.x, y: target.y };
      case 'settlement': return this.state.worldSeed?.pois.find((p) => p.id === target.poiId)?.position ?? null;
      default: return null;
    }
  }

  /** The target the inspector last resolved from the selection, so a CAST acts on
   *  the inspected subject regardless of where the cursor is. */
  private inspectorFrozen: CommandTarget | null = null;

  /** The inspector payload for the current selection (spec §8, P3.8) — an NPC, else
   *  the settlement a selected building belongs to. Null when nothing is selected
   *  (a causal site has its own card). Freezes the target so CAST routes correctly.
   *  UI v2 W2/D1: the inspector collapses ONLY in the `world` band — it now lives in
   *  `settlement` too (W2 D5 grows the settlement payload: wards/population/peace/
   *  recent). Zooming to `world` hides it WITHOUT clearing the selection (its
   *  subject renders as a distinct alert pin instead, and zooming back in restores
   *  the panel). */
  private inspectorView(): InspectorView | null {
    if (this.currentBand() === 'world') return null;
    const target = this.inspectorTarget();
    if (!target) { this.inspectorFrozen = null; return null; }
    this.inspectorFrozen = target;
    // W2 (D5): a settlement target only ever resolves via a selected building (see
    // `inspectorTarget` below), so thread it along for the buildingRow highlight.
    const buildingId = target.kind === 'settlement' ? (this.state.selectedBuildingId ?? undefined) : undefined;
    return this.query.inspect(target, PLAYER_SPIRIT_ID, { buildingId });
  }

  /** Resolve the current selection to a command target: a selected NPC, else the
   *  settlement of a selected building. */
  private inspectorTarget(): CommandTarget | null {
    const s = this.state;
    if (s.selectedNpcId) return { kind: 'npc', npcId: s.selectedNpcId };
    if (s.selectedBuildingId && s.world) {
      const b = s.world.registry.get(s.selectedBuildingId);
      if (b) {
        const poiId = this.nearestPoiId(Math.floor(b.x), Math.floor(b.y));
        if (poiId) return { kind: 'settlement', poiId };
      }
    }
    return null;
  }

  /** Fire an inspector affordance against the frozen inspected target. `probe_mind`
   *  is BRANCH-shaped like `whisper`: instead of the bare (invisible) command it
   *  opens the read-only mind card (B). Everything else emits its command. */
  private castInspector(verb: string): void {
    const target = this.inspectorFrozen;
    if (!target) return;
    if (verb === 'probe_mind') { this.presentMindCard(target); return; }
    this.emitDivine(verb as CommandVerb, target);
  }

  /** B (mind-reading): open the read-only mind card for an npc target. The card is
   *  built deterministically from the InspectorView (thought + belief-in-you +
   *  remembered deeds) so it reads with NO model configured; when a capable model
   *  IS live, a richer `openMindPage` read is warmed and swapped into the open card
   *  (the deterministic version shows meanwhile). The orphaned mind pipeline finally
   *  reaches the WebGPU UI — the "PROBE MIND does nothing" no-op is closed. */
  private presentMindCard(target: CommandTarget): void {
    if (target.kind !== 'npc') return;
    const view = this.query.inspect(target, PLAYER_SPIRIT_ID);
    const spec = view && buildMindCard(view);
    if (!spec) return;
    getUiRuntime().presentUiSpec(spec, () => {}, { keepOpen: false });
    this.requestRender();

    const world = this.state.world;
    const player = this.state.spirits.get(PLAYER_SPIRIT_ID);
    if (!this.llmClientCapable || !world || !player) return;
    const npc = getNpc(world, target.npcId);
    if (!npc) return;
    void openMindPage(npc, ['surface'], 0, {
      world,
      store: this.attentionStore,
      queue: this.commandQueue,
      llm: this.llmClientCapable,
      playerSpirit: player,
      playerSpiritId: PLAYER_SPIRIT_ID,
    }).then((page) => {
      const rt = getUiRuntime();
      if (!page?.prose || !rt.hasCard()) return;
      const fresh = this.query.inspect(target, PLAYER_SPIRIT_ID);
      const enriched = fresh && buildMindCard(fresh, page.prose);
      if (enriched) { rt.updateOpenCard(enriched); this.requestRender(); }
    });
  }

  /** Pick the most specific target under a tile that the verb accepts (npc → entity → settlement → tile). */
  private resolveTargetAt(x: number, y: number, kinds: readonly CommandTargetKind[]): CommandTarget | null {
    const world = this.state.world;
    if (!world) return null;
    if (kinds.includes('npc')) {
      const npc = world.query({ kind: 'npc' }).find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
      if (npc) return { kind: 'npc', npcId: npc.id };
    }
    if (kinds.includes('entity')) {
      const ent = world.registry.getAtTile(x, y).find(e => e.kind !== 'npc');
      if (ent) return { kind: 'entity', id: ent.id };
    }
    if (kinds.includes('settlement')) {
      const poiId = this.nearestPoiId(x, y);
      if (poiId) return { kind: 'settlement', poiId };
    }
    if (kinds.includes('tile')) return { kind: 'tile', x, y };
    return null;
  }

  /** The settlement whose centre is nearest the clicked tile (for settlement-scoped casts). */
  private nearestPoiId(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const poi of this.state.worldSeed?.pois ?? []) {
      if (!poi.position) continue;
      const dx = poi.position.x - x, dy = poi.position.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = poi.id; }
    }
    return best;
  }

  /** UI v2 W1/D4: the settlement a World-band label click should render focused —
   *  either a direct label-click selection (`selectedPoiId`) or, mirroring
   *  `inspectorTarget`'s building→settlement resolution without touching that
   *  function (W2 owns it), a selected building's settlement. `selectedPoiId`
   *  wins: it's the more recent, more specific act when both are somehow set. */
  /** Phase 3: an npc_encounter makes its speaker say a line. The producer runs
   *  free; we only spawn a visible bubble when the player is close enough to read
   *  it (settlement/soul band) and both parties are live entities on the map. */
  private onEncounterEvent(a: AppendedEvent): void {
    const ev = a.event;
    if (ev.type !== 'npc_encounter') return;
    if (this.currentBand() === 'world') return;
    const world = this.state.world;
    if (!world) return;
    const speaker = world.registry.get(ev.aId);
    const partner = world.registry.get(ev.bId);
    if (!speaker || !partner) return;
    const sp = npcProps(speaker);
    const rel = sp.relationships.find(r => r.npcId === ev.bId);
    const line = describeEncounterLine({
      warm: ev.warm,
      relType: rel?.type ?? 'friend',
      personality: sp.personality,
      needs: sp.needs,
      partnerName: npcProps(partner).name,
      // Same meeting always voices the same line; different meetings vary
      // (presentation-only — no sim rng needed).
      seed: encounterSeed(ev.aId, ev.bId, a.t),
    });
    this.speechBubbles.spawn(ev.aId, line, performance.now());
    this.requestRender();

    // Phase 3c (OPTIONAL): when the player is watching this soul closely, reword
    // its line through the fast chat tier and slot the result into the same
    // bubble. Fire-and-forget — the deterministic line above already shows.
    this.maybeGarnishBubble(ev, line, sp.name, sp.role, rel?.type ?? 'friend', npcProps(partner).name);
  }

  /**
   * Phase 3c: the OPTIONAL LLM garnish. Rewords the deterministic bubble line for
   * the conversation the player is actively watching — gated hard so spend is a
   * rounding error and a no-LLM / offline session behaves exactly as before:
   *   • only in the SOUL band (the closest, one-soul-at-a-time view), and
   *   • only conversations involving the SELECTED soul (or any, if none selected), and
   *   • only when a real client is configured (mock/no-key → skip), and
   *   • only when the budget throttle (spend cap + rate + single in-flight) allows.
   * On success the reworded line is swapped IN PLACE via retext(), which refuses
   * if the speaker has since said something new or the bubble already faded — so a
   * late reply never clobbers a newer line or pops a ghost bubble.
   */
  private maybeGarnishBubble(
    ev: Extract<AppendedEvent['event'], { type: 'npc_encounter' }>,
    baseLine: string, speakerName: string, role: string,
    relType: Relationship['type'], partnerName: string,
  ): void {
    if (this.currentBand() !== 'soul') return;
    const sel = this.state.selectedNpcId;
    if (sel && ev.aId !== sel && ev.bId !== sel) return;
    if (!this.llmClient.isAvailable()) return;
    const nowMs = performance.now();
    if (!this.garnishThrottle.canGarnish(nowMs)) return;

    // The worry the deterministic producer would have coloured with: the speaker's
    // lowest need, if it crossed the worry floor (else null → a plain greeting).
    const needs = npcProps(this.state.world!.registry.get(ev.aId)!).needs;
    const worry = lowestWorry(needs);
    const input: GarnishInput = { speakerName, role, warm: ev.warm, relType, partnerName, worry, baseLine };
    const { system, user } = buildGarnishPrompt(input);

    this.garnishThrottle.begin(nowMs);
    void this.llmClient.generateNpcBackfill(system, user, { maxTokens: 48, temperature: 0.9 })
      .then((res) => {
        this.garnishThrottle.end(res.cost);
        const text = sanitizeGarnish(res.content, baseLine);
        if (text !== baseLine && this.speechBubbles.retext(ev.aId, baseLine, text, performance.now())) {
          this.requestRender();
        }
      })
      .catch((err) => {
        this.garnishThrottle.end(0);
        console.warn('[bubble-garnish] rewording failed, keeping template line:', err);
      });
  }

  private focusedSettlementPoiId(): string | null {
    const s = this.state;
    if (s.selectedPoiId) return s.selectedPoiId;
    if (s.selectedBuildingId && s.world) {
      const b = s.world.registry.get(s.selectedBuildingId);
      if (b) return this.nearestPoiId(Math.floor(b.x), Math.floor(b.y));
    }
    return null;
  }

  /** P2 living-population: the materializable settlement the camera is CENTRED on,
   *  or null. Unlike `focusedSettlementPoiId` (explicit click-selection), this lets
   *  the player bring a town to life by simply ZOOMING into it — the intent the
   *  MaterializationSystem's own docstring already describes ("when the player
   *  FOCUSES a settlement"). Without it, panning the camera onto a town spawned
   *  nobody; only a click did, so zoomed-in towns stood empty.
   *
   *  Restricted to POIs that actually carry a statistical cohort (only those
   *  materialize) and to the nearest one whose centre sits within the on-screen
   *  radius, so panning over open wilderness never wakes a distant settlement. The
   *  radius is read from the viewport itself (centre-tile vs edge-tile) so it tracks
   *  zoom. Flat (lift-free) picking is fine here — settlements sit near sea level and
   *  we only need nearest-POI resolution, not sub-tile precision. */
  private cameraFocusedSettlementPoiId(): string | null {
    const cohorts = this.state.cohorts;
    const seed = this.state.worldSeed;
    if (!cohorts || cohorts.size === 0 || !seed) return null;
    const cam = this.state.camera;
    const vp = this.viewport();
    const centre = pickTile(cam, vp.width / 2, vp.height / 2);
    const edge = pickTile(cam, vp.width, vp.height / 2);
    const radius = Math.hypot(edge.tx - centre.tx, edge.ty - centre.ty);
    const r2 = radius * radius;
    let best: string | null = null;
    let bestD = Infinity;
    for (const poi of seed.pois) {
      if (!poi.position || !cohorts.has(poi.id)) continue;
      const dx = poi.position.x - centre.tx, dy = poi.position.y - centre.ty;
      const d = dx * dx + dy * dy;
      if (d < bestD && d <= r2) { bestD = d; best = poi.id; }
    }
    return best;
  }

  /** P2 living-population: the live VIEW focus fed to the MaterializationSystem —
   *  the settlement the camera is framing + the current zoom band. Reads live
   *  camera/selection state only; nothing is written to the sim or snapshot. An
   *  explicit selection wins; otherwise, inside the close bands, the settlement the
   *  camera is centred on (so zooming into a town populates it — no click needed). */
  private focusView(): { poiId: string | null; band: ZoomBand } {
    const band = this.currentBand();
    const poiId = this.focusedSettlementPoiId()
      ?? (band !== 'world' ? this.cameraFocusedSettlementPoiId() : null);
    return { poiId, band };
  }

  /** UI v2 W1/D4: per-settlement believer tallies (player + every rival), folding
   *  BOTH population tiers — named NPCs (`forEachNpc`) and the P1 statistical
   *  cohort tier (`cohortBelievers`), same two-tier fold `buildRivalSituation`
   *  uses — so a settlement dominated by the statistical tier still reads as
   *  contested. Memoised behind its OWN, longer `WORLD_CONTEST_TTL_MS` window
   *  (own cache: this sweep only runs while a label consumer is asking, i.e. the
   *  World band is active, so it must not piggyback on `hudSim`'s unconditional
   *  every-frame refresh and tax the other two bands — and even in-band it refreshes
   *  ~6.6× less often than the HUD, since a contest label changes far slower than the
   *  power orb it sits beside). */
  private worldContestCache: { t: number; data: SettlementContest[] } | null = null;
  private worldContest(): SettlementContest[] {
    const now = performance.now();
    const c = this.worldContestCache;
    if (c && now - c.t < WORLD_CONTEST_TTL_MS) return c.data;
    const world = this.state.world;
    const byPoi = new Map<string, { player: number; rivals: Map<string, number> }>();
    const bump = (poiId: string, spiritId: string, n: number): void => {
      if (n <= 0) return;
      let rec = byPoi.get(poiId);
      if (!rec) { rec = { player: 0, rivals: new Map() }; byPoi.set(poiId, rec); }
      if (spiritId === PLAYER_SPIRIT_ID) rec.player += n;
      else rec.rivals.set(spiritId, (rec.rivals.get(spiritId) ?? 0) + n);
    };
    if (world) {
      forEachNpc(world, (e) => {
        const p = npcProps(e);
        const poiId = p.homePoiId;
        if (!poiId) return;
        for (const spiritId of Object.keys(p.beliefs).sort()) {
          if ((p.beliefs[spiritId]?.faith ?? 0) >= BELIEVER_THRESHOLD) bump(poiId, spiritId, 1);
        }
      });
    }
    for (const poiId of [...this.state.cohorts.keys()].sort()) {
      const sc = this.state.cohorts.get(poiId)!;
      for (const spiritId of [...this.state.spirits.keys()].sort()) {
        bump(poiId, spiritId, cohortBelievers(sc, spiritId));
      }
    }
    const data: SettlementContest[] = [...byPoi.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([poiId, rec]) => ({
        poiId,
        player: rec.player,
        rivals: [...rec.rivals.entries()]
          .map(([spiritId, count]) => ({ name: this.state.spirits.get(spiritId)?.name ?? spiritId, count }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      }));
    this.worldContestCache = { t: now, data };
    return data;
  }

  // ── UI v2 W0/D1: three attention bands on the zoom ladder ────────────────────
  /** The current attention band, updated with per-boundary hysteresis so a
   *  boundary rung can't oscillate. `soul` = per-NPC chrome; `settlement`/`world`
   *  both fall back to alert pins for now (W2 differentiates `settlement`). */
  private currentBand(): ZoomBand {
    this.zoomBandState = zoomBand(this.state.camera.zoom, this.zoomBandState);
    return this.zoomBandState;
  }

  // Sim-derived HUD reads (belief power, granted powers, divine inbox) come from
  // full-congregation sweeps, yet the barebones UI reads them EVERY frame — the orb
  // (beliefState), the POWERS pill (beliefPowers), the INBOX pill (divineInbox), AND
  // the P5 alert-pins path (`alertPins` calls divineInbox AGAIN). That was ~4–6 full
  // NPC/entity sweeps per frame at 60 Hz for values that only move at sim-tick rate.
  // Memoise them behind a short wall-clock TTL so they recompute at most ~7×/s instead
  // of 60×/s; user actions that shift belief bust the cache (see `emitDivine`) so the
  // readout never lags a click. The raw `this.query.*` methods stay uncached (MCP/tests
  // need live values); only this frame-path funnel is throttled.
  private hudSimCache: { t: number; belief: BeliefView; powers: BeliefPowerView[]; inbox: InboxItem[] } | null = null;
  private hudSim(): { belief: BeliefView; powers: BeliefPowerView[]; inbox: InboxItem[] } {
    const now = performance.now();
    const c = this.hudSimCache;
    if (c && now - c.t < HUD_SIM_TTL_MS) return c;
    // P5b: first-run tutorial toasts — appended here (not in `game-query.ts`'s
    // `divineInbox`) so the golden/inbox tests there stay untouched; this is
    // pure Game-side composition over an otherwise-unmodified query result.
    const simNow = this.state.clock.now();
    const fresh = {
      t: now,
      belief: this.query.beliefState(),
      powers: this.query.beliefPowers(),
      inbox: [
        ...this.query.divineInbox(),
        ...(this.firstRunTidingsOver(simNow) ? [] : firstRunTidings(simNow)),
      ],
    };
    this.hudSimCache = fresh;
    return fresh;
  }

  /** Has the first-run tiding window closed? `firstRunSeen` flips PERMANENTLY once the
   *  horizon has passed, whether or not the player actually opened the inbox tray —
   *  "delivered" means "made available for the window", the same honest best-effort
   *  every other auto-expiring tiding already settles for.
   *
   *  READ-ONLY, deliberately. It used to do the flip inline, which made `hudSim` — and
   *  therefore `Shell.describe()`, which reaches it through `hallView` — write a
   *  PERSISTED setting from what is documented as a pure read ("never mutates", so an
   *  agent can poll it freely). An agent polling the shell must not be able to retire
   *  the player's tutorial. The flip itself lives in `retireFirstRunTidings`, driven off
   *  the frame loop, where the clock passing a horizon actually belongs. */
  private firstRunTidingsOver(simNow: number): boolean {
    return settingsStore.getFirstRunSeen() || simNow >= FIRST_RUN_TIDING_HORIZON_TICKS;
  }

  /** Persist the first-run flip once the horizon has passed. Called from the frame
   *  loop: this is a consequence of TIME passing, not of anyone reading the inbox, so
   *  it belongs on the clock's path rather than a query's. Cheap and idempotent — one
   *  settings read per frame, and the store write happens exactly once per save. */
  private retireFirstRunTidings(): void {
    if (settingsStore.getFirstRunSeen()) return;
    if (this.state.clock.now() < FIRST_RUN_TIDING_HORIZON_TICKS) return;
    settingsStore.setFirstRunSeen(true);
    this.invalidateHudSim();
  }
  /** Drop the HUD memo so the next read recomputes — called when a divine action
   *  shifts belief, so the orb/powers/inbox reflect the change on the very next frame. */
  private invalidateHudSim(): void { this.hudSimCache = null; }

  /** Queue the P5 camera-fly toward a tile anchor — `flyTo(tx, ty)` or `flyTo({x, y})`.
   *  Lands at an in-band zoom when starting zoomed out; keeps the player's zoom when
   *  already in-band. An optional trailing `explicitZoom` (UI v2 W1/D4 — works with
   *  EITHER call form: `flyTo(tx, ty, zoom)` or `flyTo({x, y}, undefined, zoom)`)
   *  overrides that default, e.g. a World-band label click always wants to land at
   *  `SETTLEMENT_FLY_ZOOM` regardless of which band it was clicked from. Presentation
   *  only — cancelled by any user pan/zoom (`onUserCameraInput`). Non-finite / off-map
   *  targets are dropped: a bad call must never write NaN into `cameraFly` (the ease
   *  would poison `camera.x/y` for the rest of the session). */
  private flyTo(txOrPos: number | { x: number; y: number }, ty?: number, explicitZoom?: number): void {
    const tx = typeof txOrPos === 'object' ? txOrPos.x : txOrPos;
    const tyv = typeof txOrPos === 'object' ? txOrPos.y : ty;
    const map = this.state.map;
    if (
      typeof tx !== 'number' || typeof tyv !== 'number' ||
      !Number.isFinite(tx) || !Number.isFinite(tyv) ||
      (map && (tx < 0 || tyv < 0 || tx >= map.width || tyv >= map.height))
    ) {
      console.warn(`[camera] flyTo dropped invalid target (${String(tx)}, ${String(tyv)})`);
      return;
    }
    const zoom = explicitZoom ?? (this.currentBand() === 'soul' ? this.state.camera.zoom : SOUL_FLY_ZOOM);
    this.state.cameraFly = { tx, ty: tyv, zoom };
  }

  /**
   * D (camerawork): the ONE "frame this subject well" entry point every focusing
   * affordance routes through. Resolves the target's world-tile bounding box, then
   * `computeFrame` picks the largest ladder zoom at which it fits — capped at native
   * 1:1 for a soul/tile (a focused NPC lands pixel-perfect, which also enters the
   * soul band and warms narration) and at `SETTLEMENT_FLY_ZOOM` for a settlement
   * (they live at settlement altitude or wider, never 1:1). The zoom BAND now falls
   * out of the subject's size instead of the old two hardcoded landing zooms. Routes
   * through the existing eased `flyTo`/`cameraFly` — presentation only, no command. */
  private frameSubject(target: CommandTarget, opts?: { maxZoom?: number }): void {
    const bbox = this.subjectBBox(target);
    if (!bbox) return;
    const maxZoom = opts?.maxZoom ?? (target.kind === 'settlement' ? SETTLEMENT_FLY_ZOOM : 1);
    const frame = computeFrame(bbox, this.viewport(), { maxZoom });
    this.flyTo(frame.cx, frame.cy, frame.zoom);
  }

  /** The world-tile bounding box of a command target: a single tile for
   *  npc/entity/tile; the settlement's authored region when present, else its
   *  centre tile. Null when the subject can't be located on the current map. */
  private subjectBBox(target: CommandTarget): FrameSubject | null {
    const world = this.state.world;
    const pt = (x: number, y: number): FrameSubject => ({ min: { x, y }, max: { x, y } });
    switch (target.kind) {
      case 'npc': {
        const e = world ? getNpc(world, target.npcId) : null;
        return e ? pt(Math.floor(e.x), Math.floor(e.y)) : null;
      }
      case 'entity': {
        const e = world?.registry.get(target.id);
        return e ? pt(Math.floor(e.x), Math.floor(e.y)) : null;
      }
      case 'tile':
        return pt(target.x, target.y);
      case 'settlement': {
        const poi = this.state.worldSeed?.pois.find((p) => p.id === target.poiId);
        if (poi?.region) {
          return {
            min: { x: poi.region.x_min, y: poi.region.y_min },
            max: { x: poi.region.x_max, y: poi.region.y_max },
          };
        }
        return poi?.position ? pt(poi.position.x, poi.position.y) : null;
      }
      default:
        return null;
    }
  }

  /** Triage "Act": route an inbox item to the matching divine action, flying the
   *  camera to its anchor first (pin click AND list ACT — the action must never
   *  strand off-screen). The fly is pure presentation; the emitted Command stream
   *  is exactly what it was before P5. */
  private actOnInbox(item: InboxItem): void {
    // Frame the subject well before acting so the cast never fires off-screen —
    // a soul lands at 1:1, a settlement at its altitude; the anchor is the fallback.
    if (item.target.kind === 'npc') this.frameSubject({ kind: 'npc', npcId: item.target.npcId });
    else if (item.target.kind === 'settlement') this.frameSubject({ kind: 'settlement', poiId: item.target.poiId });
    else if (item.anchor) this.flyTo(item.anchor.x, item.anchor.y);
    if (item.target.kind === 'npc') {
      // A prayer → answer it; any other npc-target → a whisper (opens the whisper card).
      const verb: CommandVerb = item.kind === 'prayer' ? 'answer_prayer' : 'whisper';
      this.emitDivine(verb, { kind: 'npc', npcId: item.target.npcId });
    } else if (item.target.kind === 'settlement') {
      // An opportunity → show a sign over it (the claim that bootstraps belief).
      this.emitDivine('omen', { kind: 'settlement', poiId: item.target.poiId });
    }
  }

  // ── Camera ops (shared by the GPU HUD cluster and the legacy DOM controls) ──
  private cameraZoomIn(): void {
    const vp = this.viewport();
    zoomAt(this.state.camera, 1.2, vp.width / 2, vp.height / 2, quantizeIsoZoom);
    this.requestRender();
  }
  private cameraZoomOut(): void {
    const vp = this.viewport();
    zoomAt(this.state.camera, 1 / 1.2, vp.width / 2, vp.height / 2, quantizeIsoZoom);
    this.requestRender();
  }
  private cameraFitView(): void {
    if (!this.state.map) return;
    const vp = this.viewport();
    fitCameraToMap(this.state.camera, this.state.map.width, this.state.map.height, vp.width, vp.height);
    this.requestRender();
  }
  private cameraZoomActual(): void {
    // Snap to exactly 1:1 about the viewport centre — keeps the centred world
    // point fixed while setting zoom to 1 (native pixel scale, crisp art).
    const vp = this.viewport();
    const z = this.state.camera.zoom || 1;
    zoomAt(this.state.camera, 1 / z, vp.width / 2, vp.height / 2);
    this.requestRender();
  }

  private togglePause(): void {
    // The user-facing pause is a HARD pause — it idles the loop + audio, not just the sim.
    this.frameLoop.toggle();
  }

  /**
   * R9: route a meta (time-control) command to the TimeController. Called from the
   * bus `onMeta` seam (MCP / Fate / story host) and, via `dispatchTimeCommand`,
   * from the WebGPU UI's time hooks (WP-B). Meta commands NEVER touch the sim
   * queue / event log / snapshot / replay — they only change how fast time flows.
   * Params are read tolerantly from `params` or `payload` (bus callers differ).
   */
  private handleMetaCommand(cmd: Pick<Command, 'verb' | 'params' | 'payload'>): void {
    const num = (k: string): number | undefined => {
      const v = cmd.params?.[k] ?? (cmd.payload?.[k] as number | string | undefined);
      const n = typeof v === 'string' ? Number(v) : v;
      return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
    };
    const str = (k: string): string | undefined => {
      const v = cmd.params?.[k] ?? (cmd.payload?.[k] as unknown);
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    switch (cmd.verb) {
      case 'set_time_rate': {
        const rate = num('rate');
        if (rate !== undefined) { this.timeController.setRate(rate); this.requestRender(); }
        break;
      }
      case 'skip_to_next_event':
        this.timeController.requestSeek({ horizonHours: num('horizonHours') });
        this.requestRender();
        break;
      case 'cancel_seek':
        // User/host-initiated cancel: land silently (no "quiet stretch" card).
        this.suppressLandingCard = true;
        this.timeController.cancelSeek();
        this.requestRender();
        break;

      // ── UI v3 shell verbs (spec §3.6/§3.7) ──
      // These are the SAME entry point for a player's click and for a connected
      // agent's `emit_command` over the bus — including with no world loaded,
      // which is why they must never assume `state.map` exists. Long-running ones
      // are fire-and-forget with a logged rejection: a meta command must not be
      // able to take the frame down.
      case 'new_game': {
        const genSeed = num('genSeed');
        const genome = str('genome');
        const demo = cmd.params?.demo !== undefined || cmd.payload?.demo !== undefined;
        void this.newWorld({
          ...(genSeed !== undefined ? { genSeed } : {}),
          ...(genome !== undefined ? { genome } : {}),
          ...(demo ? { demo: true } : {}),
        }).catch((err) => console.error('[shell] new_game failed', err));
        break;
      }
      case 'load_slot': {
        // Honours its slot param (P3b): `startWorld({ slot })` threads it down
        // to `bootstrapWorld`'s `readSave`/`readJournal` via `boot-sequence.ts`,
        // so a non-autosave slot resumes for real rather than silently taking
        // the autosave path.
        const slotParam = str('slot');
        const slot: SaveSlot = slotParam && isSaveSlot(slotParam) ? slotParam : 'autosave';
        void this.startWorld({ slot }).catch((err) => console.error('[shell] load_slot failed', err));
        break;
      }
      case 'quit_to_title':
        this.beginQuitToTitle();
        break;
      case 'open_screen': {
        const screen = str('screen');
        if (screen && isScreenId(screen)) {
          // A stale refusal from a PREVIOUS visit to the new-world screen must
          // never reappear on a fresh one — cleared here (the one true entry
          // point, whether the click came from the title screen or an agent's
          // `open_screen` over the bus), not per-caller.
          if (screen === 'newgame') this.newGameError = null;
          // The legacy Esc menu must never overlap a shell screen. Every nav row
          // that opens one closes the menu FIRST, but an AGENT reaching the same
          // verb over the bus never touched a nav row — and the overlap is not
          // cosmetic: the menu stashes the sim rate at 0, so a screen opened
          // over it sits in front of a world that has silently stopped. Closing
          // here (the one true entry point) is what actually makes the claim
          // "a player's click and an agent's emit_command share one path" true,
          // rather than true only for the click.
          const rt = getUiRuntime();
          if (rt.isMenuOpen()) rt.toggleMenu();
          this.shell.push(screen);
          this.requestRender();
        }
        break;
      }
      case 'close_screen':
        // Popping out from under an in-progress rebind capture (Esc, a bus
        // `close_screen`) must not leave a dangling capture-phase listener.
        this.cancelKeyCapture();
        this.shell.pop();
        this.requestRender();
        break;
      case 'save_slot': {
        const slotParam = str('slot');
        const slot = slotParam && isSaveSlot(slotParam) ? slotParam : undefined;
        // Defense in depth: the save SCREEN already disables the autosave row
        // (spec §5.4 — the player must not hand-overwrite the managed slot),
        // but a bus-connected agent bypasses the paint entirely, so the same
        // rule is enforced here too.
        if (!slot || slot === 'autosave') {
          console.info(`[shell] 'save_slot' refused — ${slot === 'autosave' ? 'autosave is managed automatically' : 'missing/invalid slot'}`);
          break;
        }
        // No naming-island UI lands this slice (see save-screen.ts's module
        // doc) — but a manual save must still not silently mislabel itself
        // "Autosave" (`PersistenceController`'s default meta name), so an
        // unnamed save keeps the slot's EXISTING name across a re-save, or
        // falls back to a slot-derived one ("Slot 1") the first time.
        const name = str('name') ?? this.slotMetas.get(slot)?.name ?? defaultSlotName(slot);
        void this.persistence.saveNow(slot, name)
          .then(() => this.probeSaves())
          .catch((err) => console.error('[shell] save_slot failed', err));
        break;
      }
      case 'delete_slot': {
        const slotParam = str('slot');
        const slot = slotParam && isSaveSlot(slotParam) ? slotParam : undefined;
        if (!slot) { console.info("[shell] 'delete_slot' refused — missing/invalid slot"); break; }
        void deleteSlot(slot)
          .then(() => this.probeSaves())
          .catch((err) => console.error('[shell] delete_slot failed', err));
        break;
      }
      case 'set_setting': {
        // Same entry point for the settings SCREEN's own clicks and an agent's
        // `emit_command` (spec §3.7) — the key arrives from OUTSIDE either way,
        // so it is validated exactly like `open_screen`'s screen id and
        // `load_slot`'s slot, never cast and trusted.
        const key = str('key');
        if (!key || !isSettingsKey(key)) {
          console.info(`[shell] 'set_setting' refused — unknown key '${key ?? ''}'`);
          break;
        }
        const raw = cmd.params?.value ?? cmd.payload?.value;
        this.applySetting(key, raw);
        break;
      }
      case 'rebind_key': {
        // Same entry point for the settings CONTROLS tab's own capture
        // (`finishKeyCapture` below) and an agent's `emit_command` (spec
        // §3.7) — `action`/`code` arrive from OUTSIDE either way, so `action`
        // is validated against the real `Action` union exactly like
        // `open_screen`'s screen id / `load_slot`'s slot / `set_setting`'s
        // key, never cast and trusted.
        const actionParam = str('action');
        const code = str('code');
        if (!actionParam || !isAction(actionParam) || !code) {
          console.info(`[shell] 'rebind_key' refused — action '${actionParam ?? ''}' code '${code ?? ''}'`);
          break;
        }
        const losers = conflictsFor(this.keymap, code, actionParam);
        this.keymap = bind(this.keymap, actionParam, code);
        settingsStore.setKeymap(diffFromDefault(this.keymap));
        const label = promptFor(actionParam, this.keymap);
        this.keymapNote = losers.length
          ? `${label} REBOUND — ${losers.join(', ').toUpperCase()} LOST IT.`
          : `${label} REBOUND.`;
        this.requestRender();
        break;
      }
      case 'rename_slot':
        // Declared in the registry (so the vocabulary + `capabilities`
        // discovery are stable from the start) but serviced by its own phase
        // (slot naming — deferred in P3b, still open; see save-screen.ts's
        // header doc). An honest log beats a silent no-op: an agent that
        // calls it early can tell.
        console.info(`[shell] '${cmd.verb}' is declared but not yet serviced`);
        break;
      case 'capture_photo':
        this.capturePhoto();
        break;
      case 'copy_world_code':
        void this.copyWorldCode();
        break;
    }
  }

  // ── P5: controls — the rebind capture listener ────────────────────────────
  /** The live DOM listener for the CURRENTLY-armed capture (see
   *  `startKeyCapture`), or null when nothing is being captured — detached
   *  the instant a key resolves or cancels it, so at most one is ever live. */
  private captureKeyListener: ((e: KeyboardEvent) => void) | null = null;

  /** Arm a rebind capture for `action`: the settings CONTROLS tab reported
   *  `{kind:'rebind_start'}` (REBIND clicked). The capture listener lives
   *  HERE (the runtime), not in the pure screen module — see
   *  `settings-screen.ts`'s header doc. Listens in the CAPTURE phase on
   *  `window` so the rebind press never also fires its OLD action through
   *  `attachControls`/`attachTimeKeys` (both bubble-phase) or reaches the UI
   *  runtime's own Esc handler first. */
  private startKeyCapture(action: Action): void {
    this.cancelKeyCapture(); // only one capture at a time
    this.capturingAction = action;
    this.keymapNote = null;
    const listener = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { this.cancelKeyCapture(); return; }
      this.finishKeyCapture(action, e.code);
    };
    this.captureKeyListener = listener;
    window.addEventListener('keydown', listener, true);
    this.requestRender();
  }

  /** Abandon an in-progress capture with no rebind (Escape, RESET, tab
   *  switch, closing the screen). Idempotent — safe to call with nothing
   *  armed (every `onSettingsAction` case that might follow a capture calls
   *  it defensively). */
  private cancelKeyCapture(): void {
    if (this.captureKeyListener) {
      window.removeEventListener('keydown', this.captureKeyListener, true);
      this.captureKeyListener = null;
    }
    if (this.capturingAction !== null) {
      this.capturingAction = null;
      this.requestRender();
    }
  }

  /** A key resolved the capture: detach the listener and route the result
   *  through the SAME `rebind_key` meta verb an agent would use (spec
   *  §3.7) — a player's click-then-press and `emit_command` are one path. */
  private finishKeyCapture(action: Action, code: string): void {
    if (this.captureKeyListener) {
      window.removeEventListener('keydown', this.captureKeyListener, true);
      this.captureKeyListener = null;
    }
    this.capturingAction = null;
    this.bus.emit({
      verb: 'rebind_key', source: PLAYER_SPIRIT_ID, target: { kind: 'none' },
      params: { action, code },
    });
  }

  /**
   * Write ONE validated setting through `settings-store` and, where a live
   * apply path already exists, apply it immediately (no reload) — same
   * "persist + live-apply" contract `applyLlmConfig` follows for the provider
   * form. Where no apply path exists yet, this ONLY persists and says so; the
   * brief for this slice is explicit that inventing new apply plumbing is out
   * of scope (`halfResWater`/`uiScale` — see the case comments for exactly
   * what reads them today, which is nothing).
   */
  private applySetting(key: SettingsKey, raw: unknown): void {
    switch (key) {
      case 'musicOn': {
        const v = toBoolParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting musicOn' refused — not a boolean"); return; }
        this.presentation.setEnabled(v); // persists via settings-store internally
        break;
      }
      case 'musicVolume': {
        const v = toNumParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting musicVolume' refused — not a number"); return; }
        this.presentation.setVolume(clamp01(v)); // persists via settings-store internally
        break;
      }
      case 'sfxOn': {
        const v = toBoolParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting sfxOn' refused — not a boolean"); return; }
        this.presentation.setSfxEnabled(v); // persists via settings-store internally
        break;
      }
      case 'sfxVolume': {
        const v = toNumParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting sfxVolume' refused — not a number"); return; }
        this.presentation.setSfxVolume(clamp01(v)); // persists via settings-store internally
        break;
      }
      case 'voiceOn': {
        const v = toBoolParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting voiceOn' refused — not a boolean"); return; }
        this.presentation.setVoiceEnabled(v); // persists via settings-store internally
        break;
      }
      case 'halfResWater': {
        const v = toBoolParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting halfResWater' refused — not a boolean"); return; }
        settingsStore.setHalfResWater(v);
        // NO live apply path: `gpu-render-frame.ts`'s `halfWaterEnabled()` still
        // reads the `?fullwater` URL flag, not this store (settings-store.ts's
        // own doc calls this field "schema only — wiring is a later slice").
        // Persisted honestly; effective on a future slice, not even on reload yet.
        console.info("[shell] 'halfResWater' saved — no render-side apply path exists yet");
        break;
      }
      case 'uiScale': {
        const v = toNumParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting uiScale' refused — not a number"); return; }
        settingsStore.setUiScale(v);
        // LIVE: `uiScaleFor(dpr)` multiplies by this, and it feeds BOTH the HUD
        // and every shell screen, so one setting moves the whole interface. The
        // result is rounded back to an integer — fractional glyph scaling is
        // never allowed — so coarse steps are the honest granularity here.
        setUiScaleMultiplier(v);
        this.requestRender();
        break;
      }
      case 'lighting': {
        const v = toBoolParam(raw);
        if (v === undefined) { console.info("[shell] 'set_setting lighting' refused — not a boolean"); return; }
        settingsStore.setLighting(v ? 1 : 0);
        // Live apply: the SAME toggle `drawMenu`'s settings panel already flips
        // (`getLighting`/`onToggleLighting` hooks) — set outright here rather
        // than toggled, since `set_setting` carries the target value, not a delta.
        this.dev.devMode.lighting = v ? 'banded' : 'off';
        break;
      }
    }
    this.requestRender();
  }

  /** The settings screen's AUDIO/VIDEO values, read fresh from `settings-store`
   *  every frame (so a `set_setting` from ANY path — a click, the bus, another
   *  tab via a future cross-tab sync — shows up immediately). `tab` is a filler
   *  value the Shell always overwrites with its own local selection (see
   *  `ShellDeps.settingsView`'s doc) — never read here. */
  private buildSettingsView(): SettingsScreenView {
    const s = settingsStore.getAll();
    return {
      tab: 'audio',
      musicOn: s.musicOn,
      musicVolume: s.musicVolume,
      sfxOn: s.sfxOn,
      sfxVolume: s.sfxVolume,
      voiceOn: s.voiceOn,
      halfResWater: s.halfResWater,
      uiScale: s.uiScale,
      lighting: this.dev.devMode.lighting !== 'off',
      keymap: this.keymap,
      capturing: this.capturingAction,
      keymapNote: this.keymapNote,
    };
  }

  /** The photo screen's fading "PHOTO SAVED" hint, computed from real elapsed
   *  time since the last capture — see `photo-screen.ts`'s `PhotoView` doc for
   *  why the CURVE lives here and not in the (pure) screen module. */
  private buildPhotoView(): PhotoView {
    if (this.lastPhotoAt === null) return { hintText: null, alpha: 0 };
    const elapsed = performance.now() - this.lastPhotoAt;
    const alpha = 1 - clamp01(elapsed / PHOTO_HINT_FADE_MS);
    return alpha > 0 ? { hintText: 'PHOTO SAVED', alpha } : { hintText: null, alpha: 0 };
  }

  /** Public seam for the WebGPU UI (WP-B) to drive time controls through the same
   *  meta-verb path the bus uses. Keeps all time dispatch funnelling through one
   *  handler. */
  dispatchTimeCommand(cmd: Pick<Command, 'verb' | 'params' | 'payload'>): void {
    this.handleMetaCommand(cmd);
  }

  /** Read-only time status for the UI transport cluster (WP-B consumes via hooks). */
  timeStatus(): {
    requestedRate: number;
    effectiveRate: number;
    seek: null | { elapsedTicks: number; horizonTicks: number };
  } {
    return {
      requestedRate: this.timeController.getRequestedRate(),
      effectiveRate: this.timeController.getEffectiveRate(),
      seek: this.timeController.seekStatus(),
    };
  }

  private toggleTimeBar(): void {
    if (this.timeBar) {
      this.timeBar.dispose();
      this.timeBar = null;
      return;
    }
    this.timeBar = mountTimeBar(this.container, {
      timeline: this.timeline,
      scheduler: this.scheduler,
      eventLog: this.state.eventLog,
      clock: this.state.clock,
      onDismiss: () => this.toggleTimeBar(),
      onSkip: (years: number) => {
        if (!this.state.world) return;
        // Skips are committed one-way boundaries; never run while scrubbing the past.
        if (this.timeline.isScrubbed) this.timeline.returnToLive();
        const summary = applySkip(this.state.world, this.state.clock, this.state.rng, this.state.eventLog, years, this.state.trample, this.state.crossingTiers, this.state.adoptions);
        // F6: arcs that spanned the skip settle their dispositions against the
        // post-skip world BEFORE the boundary snapshot, so the committed
        // baseline carries the settled arcs (scrub-safe — deterministic sweep).
        const eraArcs = summary ? settleArcsAcrossSkip(this.state) : [];
        this.timeline.commitSkip();
        // F6: author the era summary from the skip + its spanning arcs — async,
        // off the sim tick, honest offline fallback (rides state.chronicle).
        if (summary) void this.chronicleService.generateEra(summary, eraArcs);
        // Immediate chrome refresh (the era_skipped chip self-appends via the event log).
        this.timeBar?.refresh();
        this.requestRender();  // the world jumped — redraw even if paused
      },
    });
  }

  private viewport(): { width: number; height: number } {
    return {
      width: this.canvas.width / devicePixelRatio,
      height: this.canvas.height / devicePixelRatio,
    };
  }

  /**
   * Capture the current frame as a PNG data URL (the `query.screenshot()` / dev
   * `grab()` backend). A WebGPU canvas can't be read between frames — the swap
   * chain detaches after present — so we render ONE fresh frame and `drawImage`
   * the scene + overlay into a temp 2D canvas synchronously, while the swap chain
   * texture is still live in this call stack (the same timing the old in-loop
   * composite relied on). Returns '' before the RENDERERS exist.
   *
   * BOTH render modes, mirroring `onRender`'s own branch: with no world the fresh
   * frame comes from `renderMeta` (sky backdrop + UI pass), because otherwise
   * every meta-mode screen — the title, the Hall of the Gods with no world, the
   * load/settings screens reached from the title — was uncapturable, and an
   * automation asking for a grab got a zero-byte file with no error. The old
   * `state.map` guard predates meta mode: before UI v3 there genuinely was
   * nothing to draw without a map.
   */
  private captureFrame(): string {
    if (!this.renderMap) return '';
    const meta = this.state.map === null;
    if (meta) this.renderMeta?.({ nowMs: performance.now() });
    else this.renderer.render(0);
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width;
    tmp.height = this.canvas.height;
    const t = tmp.getContext('2d');
    if (!t) return '';
    t.drawImage(this.canvas, 0, 0);          // WebGPU scene (fresh this frame)
    // Meta mode draws no 2D overlay at all (see `onRender`), so compositing the
    // overlay canvas would only stamp the last world's stale HUD onto the title.
    if (!meta) t.drawImage(this.overlayCanvas, 0, 0);
    return tmp.toDataURL('image/png');
  }

  /**
   * A small JPEG data URL of the current view, for a save slot's thumbnail.
   *
   * Deliberately NOT `captureFrame()`: that returns a full-resolution PNG data
   * URL (megabytes on a hidpi display), and one of those per slot would sit in
   * IndexedDB forever and be structured-cloned on every write. A 320×180 JPEG is
   * a couple of tens of kB and is all a menu tile can show anyway.
   *
   * Returns null with no world (nothing to picture) or if the 2D context is
   * unavailable — a missing thumbnail is cosmetic, never a save failure.
   */
  private captureThumbnail(w = 320, h = 180): string | null {
    if (!this.renderMap || !this.state.map) return null;
    try {
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const t = tmp.getContext('2d');
      if (!t) return null;
      // Draw the LAST rendered frame rather than forcing a fresh render: this runs
      // inside the autosave path, which is already the heaviest main-thread task
      // in the game — re-rendering the scene to decorate a menu would be perverse.
      t.drawImage(this.canvas, 0, 0, w, h);
      return tmp.toDataURL('image/jpeg', 0.7);
    } catch (err) {
      console.warn('[save] thumbnail capture failed', err);
      return null;
    }
  }

  /**
   * P5b: `capture_photo` — a chrome-free screenshot the player keeps. Pushes
   * the `photo` screen (idempotent if it's already on top — `shell-state.ts`'s
   * `push` is a no-op for the top screen, so a second press just takes ANOTHER
   * photo without re-pushing) then writes the PNG via a transient, invisible
   * `<a download>` click — the shell's one sanctioned DOM exception (spec §7):
   * it produces no visible or persistent chrome, unlike the mounted DOM
   * islands (settings/whisper/world-code) the embed's "no `document.body`
   * assumptions" rule actually guards against.
   */
  private capturePhoto(): void {
    const dataUrl = this.captureFrame();
    if (!dataUrl) {
      console.info("[shell] 'capture_photo' refused — no world to capture yet");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadDataUrl(dataUrl, `small-gods-${stamp}.png`);
    this.lastPhotoAt = performance.now();
    this.shell.push('photo');
    this.requestRender();
  }

  /**
   * P5b: `copy_world_code` — a short base36 code identifying the CURRENT
   * world (`@/game/world-code`), copied to the clipboard for the legacy pause
   * menu's COPY WORLD CODE row (`ui-runtime.ts`'s `drawMenu`) and pasteable
   * into the new-world screen elsewhere. Async because
   * `navigator.clipboard.writeText` is; a failure (no world yet, no clipboard
   * permission) logs rather than throwing — copying a code is a convenience,
   * never load-bearing.
   */
  private async copyWorldCode(): Promise<void> {
    if (!this.state.map) {
      console.info("[shell] 'copy_world_code' refused — no world yet");
      return;
    }
    const code = encodeWorldCode({
      genSeed: this.state.map.seed,
      worldSeedName: this.state.worldSeed?.name ?? '',
      contentVersion: WORLD_CONTENT_VERSION,
    });
    try {
      await navigator.clipboard?.writeText(code);
      this.worldCodeCopiedAt = performance.now();
      this.lastWorldCode = code;
      this.requestRender();
    } catch (err) {
      console.warn('[shell] copy_world_code: clipboard write failed', err);
    }
  }

  /** The legacy pause menu's "COPIED: …" confirmation, or null once
   *  `WORLD_CODE_STATUS_MS` has elapsed (or nothing has been copied yet). */
  private worldCodeStatus(): string | null {
    if (this.worldCodeCopiedAt === null || this.lastWorldCode === null) return null;
    if (performance.now() - this.worldCodeCopiedAt > WORLD_CODE_STATUS_MS) return null;
    return `COPIED: ${this.lastWorldCode}`;
  }

  /** The slot metadata a save is listed by. Read-only over live state, so the
   *  save store never has to know about `Game`. */
  private saveMetaInput(name = 'Autosave'): SaveMetaInput {
    const tick = this.state.clock.now();
    const player = this.state.spirits.get(PLAYER_SPIRIT_ID);
    return {
      name,
      tick,
      // Fiction time, prebuilt — a raw tick must never reach the UI.
      dateLabel: calendarLabel(tick),
      godTier: player?.tier ?? 'unknown',
      beliefMass: player?.beliefMass ?? 0,
      playtimeMs: this.playtimeMs,
      thumbnail: this.captureThumbnail(),
    };
  }

  /** Stable debug surface for console/Playwright/MCP (see src/dev/debug-api.ts). */
  debug(): DebugApi {
    return createDebugApi({
      query: this.query, state: this.state, viewport: () => this.viewport(),
      playStory: (id) => this.playStorylet(id),
      music: (arg) => {
        const snap = this.presentation.debug() as { voice: boolean; camera: boolean };
        if (typeof arg === 'boolean') this.presentation.setEnabled(arg);
        else if (typeof arg === 'number') this.presentation.setVolume(arg);
        else if (arg === 'voice') this.presentation.setVoiceEnabled(!snap.voice);
        else if (arg === 'camera') this.presentation.setCameraEnabled(!snap.camera);
        else if (arg === 'cinematic') {
          // Manual preview: frame the selected/first NPC as a staged beat would.
          const id = this.state.selectedNpcId ?? this.query.npcs()[0]?.id;
          if (id) this.cuePresentationBeat({ kind: 'npc', npcId: id });
        }
        return this.presentation.debug();
      },
      devMode: () => this.dev.devMode,
      requestRender: this.requestRender,
      newWorld: () => { void this.newWorld(); },
      setPaused: (p) => { this.setPaused(p); return this.isPaused(); },
      isPaused: () => this.isPaused(),
    });
  }

  /** Latest rendered-frame stats (see src/dev/profile.ts). For `window.__perf`. */
  fpsStats(): FpsStats { return this.fps.stats(); }

  private renderDeps(): RenderContextDeps {
    return {
      state: this.state,
      viewport: this.viewport(),
      sheets: this.sheets,
      assets: this.assets,
      decorationImages: this.decorationImages,
      artResolver: this.artResolver,
      buildingArtResolver: this.buildingArtResolver,
      parametricBuildingSource: this.parametricBuildingSource,
      parametricBarrierSource: this.parametricBarrierSource,
      parametricPlantSource: this.parametricPlantSource,
      generatedBuildingArtSource: this.generatedBuildingArtSource,
      generatedFloraArtSource: this.generatedFloraArtSource,
      clutterFloraSource: this.clutterFloraSource,
      devMode: this.dev.devMode,
      interiorReveal: this.interiorReveal,
      skyOverlay: this.currentSkyOverlay,
    };
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const dw = rect.width * devicePixelRatio;
    const dh = rect.height * devicePixelRatio;
    // Both layers share the device-pixel backing size: the scene canvas drives the
    // WebGPU swap chain, the overlay matches it 1:1 so 2D overlays land on the same
    // pixels. setTransform (not scale) resets first so repeated resizes don't stack.
    this.canvas.width = dw;
    this.canvas.height = dh;
    this.overlayCanvas.width = dw;
    this.overlayCanvas.height = dh;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.requestRender();  // a resized canvas is blank until the next draw
  }

  /** `runBootSequence`, but a THROW reaches the player instead of hanging them.
   *
   *  The loading overlay is held (by design) until the world is fully displayed —
   *  which means a boot that rejects holds it forever, with nothing to show for it
   *  but an unhandled rejection in a console nobody has open. Name the failure on
   *  the overlay, then rethrow so callers and tests still see the real error. */
  private async bootOrSayWhyNot(deps: Parameters<typeof runBootSequence>[0], worldSeed?: WorldSeed): Promise<GameMap> {
    try {
      return await runBootSequence(deps, worldSeed);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.shell.setProgress(1, `World generation failed — ${why}`);
      console.error('[boot] world generation failed', err);
      throw err;
    }
  }

  /**
   * UI v3 §3.1 — bring the SHELL up: GPU device + scene, then the title screen.
   * NO world is generated, no art library is loaded, no flora is prewarmed. This
   * is the fast path whose whole job is to put something real on screen within a
   * second or two of page load.
   *
   * Then, per `options.autostart`, either boot a world immediately (every dev
   * flag and the embed API resolve to that, so those paths behave exactly as
   * before) or sit on the title until the player — or a connected agent, over the
   * bus — asks for one.
   *
   * Idempotent: calling it twice does not rebuild the scene.
   */
  async bootShell(): Promise<void> {
    if (!this.renderMap) {
      const renderers = await selectRenderer(this.canvas);
      this.renderMap = renderers.render;
      this.renderMeta = renderers.renderMeta;
    }
    this.shell.reset(['title']);
    // Probe the save slot WITHOUT blocking the title: the point of this whole
    // phase is that the first frame is quick, and an IndexedDB open can be slow
    // (or wedged — idb-guard times it out at 4s). The title draws immediately
    // with CONTINUE pending, and the row fills itself in when the probe lands.
    // The promise is kept so the page's boot veil can grant the probe a SHORT
    // grace window (main.ts) — usually it has already settled by first frame,
    // and the menu then reveals complete instead of its notes streaming in.
    this.savesProbed = this.probeSaves();
    // The loop must run even with no world: the sky backdrop animates, and the
    // shell is render-on-demand for everything else.
    this.startLoop();
    if (this.autostart) await this.startFromAutostart(this.autostart);
  }

  /** Resolve an autostart descriptor into an actual world boot. */
  private async startFromAutostart(a: Autostart): Promise<void> {
    if (a.kind === 'fresh') {
      await this.startWorld({
        fresh: true, genSeed: a.genSeed, genome: a.genome,
        worldSeed: a.worldSeed, ephemeral: a.ephemeral,
      });
      return;
    }
    // 'auto' and 'resume' both take the ordinary path: bootstrapWorld resumes a
    // valid autosave and otherwise generates. That IS today's behaviour, which is
    // why every existing entry point maps onto it unchanged.
    await this.startWorld({});
  }

  /**
   * Generate or resume a world and enter it. The orchestration (engine → renderer
   * → art library → flora prewarm → worldgen → art-settle hold) lives in
   * boot-sequence.ts; the Game supplies the surfaces it fills in and the
   * world-ready chrome wiring.
   *
   * The ART-SETTLE HOLD IS UNCHANGED: the loading screen still outlives
   * worldgen-ready until every building/barrier/sheet has settled, with no
   * wall-clock cap. Only WHERE it draws changed (the WebGPU shell instead of the
   * DOM overlay).
   */
  async startWorld(opts: {
    fresh?: boolean;
    genSeed?: number;
    genome?: string;
    worldSeed?: WorldSeed;
    ephemeral?: boolean;
    /** Which slot to resume FROM (P3b's `load_slot`). Default 'autosave' —
     *  every existing caller (autostart, `?bridge`, embed) keeps reading the
     *  same slot it always did. Ignored when `fresh` forces a new generation. */
    slot?: SaveSlot;
  } = {}): Promise<GameMap> {
    if (opts.ephemeral !== undefined) this.ephemeral = opts.ephemeral;
    // A genome world is a throwaway terrain study by definition.
    if (opts.genome) this.ephemeral = true;
    this.playtimeMs = 0;
    this.worldReady = false;
    const worldSeed = opts.worldSeed
      ?? (opts.genome ? await this.genomeSeed(opts.genome) : undefined);
    return this.generateWorld(worldSeed, undefined, {
      fresh: opts.fresh, genSeed: opts.genSeed, slot: opts.slot,
    });
  }

  /** Resolve a named terrain genome to a WorldSeed (dev worlds only). */
  private async genomeSeed(name: string): Promise<WorldSeed | undefined> {
    try {
      const { terrainGenomeByName } = await import('@/world/genome');
      return terrainGenomeByName(name);
    } catch (err) {
      console.warn('[boot] unknown genome', name, err);
      return undefined;
    }
  }

  async generateWorld(
    worldSeed?: WorldSeed,
    _terrainOptions?: Partial<TerrainOptions>,
    boot: { fresh?: boolean; genSeed?: number; slot?: SaveSlot } = {},
  ): Promise<GameMap> {
    // Ground-flora atlas: one fetch, kicked alongside boot so herb/grass/fern
    // billboards are sliceable by frame one (misses degrade to flat billboards).
    void this.clutterFloraSource.warm();
    const slot: SaveSlot = boot.slot ?? 'autosave';
    const map = await this.bootOrSayWhyNot({
      canvas: this.canvas, state: this.state, loading: this.shell,
      renderersReady: this.renderMap !== null,
      forceFresh: boot.fresh, genSeedOverride: boot.genSeed, slot,
      assets: this.assets, sheets: this.sheets,
      decorationImages: this.decorationImages, getViewport: () => this.viewport(),
      parametricPlantSource: this.parametricPlantSource,
      parametricBuildingSource: this.parametricBuildingSource,
      parametricBarrierSource: this.parametricBarrierSource,
      generatedBuildingArtSource: this.generatedBuildingArtSource,
      setRenderMap: (renderers) => { this.renderMap = renderers.render; this.renderMeta = renderers.renderMeta; },
      setArt: (art) => {
        this.assetLibrary = art.assetLibrary;
        this.artResolver = art.artResolver;
        this.buildingArtResolver = art.buildingArtResolver;
      },
      onResumed: (save) => {
        // Continue the event journal where that save left off. Without this the
        // first autosave after a resume would re-append the entire hydrated
        // history, duplicating the world's annals.
        this.persistence.setCursor(slot, save.eventCursor);
        this.playtimeMs = save.playtimeMs ?? 0;
      },
      onWorldReady: () => {
        this.dev.updateInspector();
        if (!this.ephemeral) this.persistence.start();
        this.worldReady = true;
        this.enterWorldRunning();
      },
    }, worldSeed);
    this.startLoop();
    // Presentation: NPCs born after boot (birth/lineage) must get their LPC sheet
    // too, or they stand around as fallback circles — the boot pass only covered
    // the seeded population. A slow re-kick is enough: births are rare real-time
    // events, and kickOffSheets dedupes so a quiet world costs one map scan.
    if (this.sheetRekickTimer === null) {
      this.sheetRekickTimer = setInterval(() => {
        if (this.state.world) kickOffSheets(this.state, this.sheets);
      }, SHEET_REKICK_MS);
    }
    // Auto-pause when the tab is hidden (the loop + audio fully idle; resumes on return) —
    // so a backgrounded game never burns CPU/GPU on this machine.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
    return map;
  }

  /**
   * Probe EVERY slot's metadata for the title screen's CONTINUE row and the
   * save/load screens — one `probeSlots()` read (small `save-meta` rows only,
   * never the ~171k-tile blob) feeds all three surfaces.
   *
   * Deliberately honest about staleness (spec §5.2): a save written by an older
   * SAVE_VERSION or against an older WORLD_CONTENT_VERSION is REPORTED as such
   * and refused, never silently replaced by a freshly generated world the player
   * did not ask for. `probeSlots()` itself never throws (degrades to `[]` on a
   * wedged store); the try/catch here is defensive redundancy, not the primary
   * safety net.
   */
  private async probeSaves(): Promise<void> {
    try {
      const metas = await probeSlots();
      this.slotMetas = new Map(metas.map((m) => [m.slot, m]));
    } catch (err) {
      console.warn('[shell] save probe failed', err);
      this.slotMetas = new Map();
    }
    this.slotsProbed = true;
    this.requestRender();
  }

  /** Build the title screen's view from the (possibly still-pending) probe. */
  private buildTitleView(): TitleView {
    if (!this.slotsProbed) {
      // Still probing. Say so on EVERY row rather than claiming anything — an
      // IndexedDB open can take many seconds on a cold profile (~10 s seen
      // live), and "NO SAVED WORLDS YET" that flips to real metadata moments
      // later is a false statement, not just a stale one.
      return {
        continueLine: null,
        continueBlocked: { reason: 'none', text: 'Looking for a saved world…' },
        hasAnySave: false,
        probing: true,
        buildLine: `WORLD ${WORLD_CONTENT_VERSION}`,
      };
    }
    const auto = this.slotMetas.get('autosave');
    const hasAnySave = SAVE_SLOTS.some((s) => {
      const m = this.slotMetas.get(s);
      return m !== undefined && slotCompat(m) === 'ok';
    });
    let continueLine: string | null = null;
    let blocked: TitleView['continueBlocked'] = null;
    if (!auto) {
      blocked = { reason: 'none', text: 'No saved world yet' };
    } else {
      const reason = staleReasonText(auto);
      if (reason) {
        blocked = { reason: slotCompat(auto) === 'stale-save' ? 'stale-save' : 'stale-world', text: reason };
      } else {
        continueLine = `${auto.dateLabel} · BELIEF ${auto.beliefMass.toFixed(1)}`;
      }
    }
    return {
      continueLine,
      continueBlocked: blocked,
      hasAnySave,
      buildLine: `WORLD ${WORLD_CONTENT_VERSION}`,
    };
  }

  /**
   * The Hall of the Gods' view (Phase C, H3) — the FIRST shell view that reads
   * live sim state.
   *
   * THE MEMO IS MANDATORY: `hudSim().powers`, never `this.query.beliefPowers()`.
   * The hall draws every frame over a RUNNING world, and `beliefPowers()` runs
   * two full congregation sweeps per domain (conviction, then the H1 dimension
   * means). Through the memo that lands at the ~7 Hz HUD cadence; per-frame it
   * would be a dozen sweeps a second for numbers that move at tick rate.
   *
   * No world ⇒ `EMPTY_HALL_VIEW`: the hall still stands (hazy hitless niches,
   * one honest caption), because `open_screen screen=hall` works with nothing
   * loaded like every other meta verb. A player `Spirit` whose T5.0 fields have
   * not been written yet (a pre-T5.0 save, or before the first `SpiritSystem`
   * tick) degrades to the honest zero, never to a fabricated tier.
   *
   * All prose lives in `@/game/hall-view` — pure, and pinned against the
   * constants it paraphrases so a moved threshold fails a test instead of
   * quietly making the hall lie.
   */
  private buildHallView(): HallView {
    if (!this.state.world) return EMPTY_HALL_VIEW;
    const spirit = this.state.spirits.get(PLAYER_SPIRIT_ID);
    if (!spirit) return EMPTY_HALL_VIEW;
    return composeHallView(
      {
        name: spirit.name,
        beliefMass: spirit.beliefMass ?? 0,
        intimacy: spirit.intimacy ?? 0,
        tier: spirit.tier ?? 'nameless',
        faded: spirit.faded === true,
      },
      this.hudSim().powers,
      // The registry is the single source of truth for "is this verb real yet"
      // — the same read `castPower` makes. `BeliefPowerView.unlocked` fuses it
      // with "believed enough", and the hall has to tell those apart to say
      // anything true about what would ripen next.
      (verb) => getCapability(verb as CommandVerb)?.implemented ?? false,
    );
  }

  /** One slot's tile data, from the cached probe — empty rows for a slot
   *  never saved to. Shared by the save AND load screens (spec §5.4: they
   *  read the identical per-slot metadata; only what picking a row MEANS
   *  differs, which `saveRows`/`loadRows` decide, not this). */
  private slotRowFor(slot: SaveSlot): SlotRow {
    const meta = this.slotMetas.get(slot);
    if (!meta) {
      return {
        slot, name: '', dateLabel: '', tierLine: '', playtimeLabel: '',
        compat: 'ok', empty: true, thumbnail: null, staleReason: null,
      };
    }
    return {
      slot, name: meta.name, dateLabel: meta.dateLabel,
      tierLine: `${meta.godTier.toUpperCase()} · BELIEF ${meta.beliefMass.toFixed(1)}`,
      playtimeLabel: formatPlaytime(meta.playtimeMs),
      compat: slotCompat(meta), empty: false, thumbnail: meta.thumbnail,
      staleReason: staleReasonText(meta),
    };
  }

  /** The save/load screens' shared view — all four slots, canonical order. */
  private buildSlotsView(): SaveScreenView {
    return { rows: SAVE_SLOTS.map((s) => this.slotRowFor(s)) };
  }

  /**
   * UI v3 sky-transition spike: `quit_to_title`'s entry point. Billows the
   * clouds to full cover FIRST — `tickShellTransition` performs the actual
   * `returnToTitle` teardown once the ascent reaches phase 1 (or is skipped
   * straight there), masking the reset's hitch behind the cloud rather than
   * cutting to it. `returnToTitle` itself is UNCHANGED and still the direct
   * path `newWorld()` uses (a "new game" from mid-world doesn't get the
   * ascent — only this explicit quit verb does; kept scoped, see the spike's
   * report).
   *
   * NOTE for a future game-over screen: fading (`src/sim/god-tier.ts`) wants
   * this same "billow, then reset behind the cloud" shape — not wired there
   * yet, this spike only covers the explicit quit-to-title verb.
   */
  private beginQuitToTitle(): void {
    this.ascentResetFired = false;
    this.shell.beginAscent();
    this.requestRender();
  }

  /**
   * UI v3 §3.4 — leave this world and return to the title, IN PROCESS.
   *
   * A `location.reload()` would tear down the shell just to rebuild it (and would
   * be impossible for an agent driving over the bus to survive), so the world is
   * dismantled in place: `resetState` clears `GameState` while PRESERVING the
   * container identities every collaborator built in the constructor holds
   * (guarded by `tests/unit/state-reset-parity.test.ts`, which also pins that a
   * post-reset RNG stream matches a cold boot).
   *
   * Reload survives only as the last-resort fallback if this throws — logged,
   * never silent.
   */
  async returnToTitle(): Promise<void> {
    try {
      // A capture-phase rebind listener surviving a quit-to-title would
      // silently eat the next keypress on the title screen — this bypasses
      // `close_screen`'s own cancel (it resets the WHOLE stack directly), so
      // it needs the same defensive cancel.
      this.cancelKeyCapture();
      // No forced save here: autosave already persists on change and on
      // visibility-hidden/beforeunload, and an EXPLICIT "save" belongs on the
      // pause screen next to "quit", not silently inside the quit itself.
      this.persistence?.destroy();
      this.timeController.cancelSeek();
      this.scheduler.setRate(0);
      // Drop the world itself, then every per-world runtime cache that is NOT
      // part of GameState (so `resetState` cannot know about them). These are
      // cleared IN PLACE rather than reassigned, because collaborators built in
      // the constructor hold direct references to them — the same rule
      // `resetState`'s identity-stable half follows.
      resetState(this.state);
      this.timeline.reset();
      this.sheets.clear();
      this.attentionStore.clearAll();
      this.speechBubbles.clear();
      this.fateTrigger?.reset();
      this.fatePulse?.reset();
      this.zoomBandState = 'soul';
      this.lastDiscoveredNpcId = null;
      this.lastSoulFocusSelection = null;
      this.soulFocusFiredAt.clear();
      this.playtimeMs = 0;
      this.worldReady = false;
      // The rate stays 0 while we sit on the title — there is no world to
      // advance. `enterWorldRunning()` states it again on the next world entry,
      // so the title deliberately does NOT try to guess a "resting" rate.
      this.shell.reset(['title']);
      void this.probeSaves();
      this.requestRender();
    } catch (err) {
      // A failed teardown must not strand the player in a half-dismantled world.
      console.error('[shell] in-process return-to-title failed; reloading', err);
      this.stopLoop();
      location.reload();
    }
  }

  /**
   * A world is ENTERED RUNNING. Deliberate, and asserted rather than assumed.
   *
   * Time in this game is 1:1 with real time and the sim IS the game — a world
   * that opens frozen reads as broken, and it was the behaviour before the shell
   * existed. But "running" used to be incidental (nothing had touched the rate
   * yet), and once a session can pass through a title screen, a demo world and a
   * quit-to-title without reloading, plenty of things CAN have touched it: the
   * pause menu stashes the rate, a modal card zeroes it, a hard pause zeroes it.
   * A live GPU pass caught exactly that — a fresh world opened showing
   * "▶ RESUME" (2026-07-25).
   *
   * So world-entry states the rate outright, and LOGS when it had to correct a
   * non-default one, so an upstream leak stays visible instead of being silently
   * papered over here.
   */
  private enterWorldRunning(): void {
    // Clear a hard pause first: it owns `savedRate`, so restoring the rate under
    // it would just be re-zeroed by the next `onPauseChange`.
    if (this.frameLoop.isPaused()) {
      console.info('[boot] world entered while hard-paused — resuming');
      this.frameLoop.setPaused(false);
    }
    this.savedRate = 1;
    this.menuPrevRate = 1;
    this.storyPrevRate = 1;
    const rate = this.scheduler.getRate();
    if (rate !== WORLD_ENTRY_RATE) {
      console.info(`[boot] sim rate was ${rate} on world entry; setting ${WORLD_ENTRY_RATE}`);
    }
    this.scheduler.setRate(WORLD_ENTRY_RATE);
    this.requestRender();
  }

  /** Abandon the current world and start a brand-new one, without a reload.
   *  Kept as the public name the pause menu + embed API already call. */
  async newWorld(opts: { genSeed?: number; genome?: string; demo?: boolean } = {}): Promise<void> {
    this.persistence?.destroy();
    if (!opts.demo) await clearSave();
    if (this.state.map) await this.returnToTitle();
    await this.startWorld({
      fresh: true,
      ...(opts.genSeed !== undefined ? { genSeed: opts.genSeed } : {}),
      ...(opts.genome !== undefined ? { genome: opts.genome } : {}),
      // The Demo World is the pinned default world with autosave suppressed —
      // it must never write over the player's real save.
      ...(opts.demo ? { ephemeral: true } : {}),
    });
  }

  /** True when visible animated water is on screen — keeps the frame loop drawing
   *  so ambient ripples/caustics animate even while the sim is paused. Cheap: the
   *  has-water scan is memoised per map; the layer toggle is O(1). */
  private waterAnimating(): boolean {
    const map = this.state.map;
    if (!map) return false;
    if (isLayerHidden('rivers', this.dev.devMode)) return false;
    if (this.waterAnimMapRef !== map) {
      this.waterAnimMapRef = map;
      const wm = getHydrologyResult(map).waterMask;
      let any = false;
      for (let i = 0; i < wm.length; i++) { if (wm[i]) { any = true; break; } }
      this.waterAnimHasWater = any;
    }
    return this.waterAnimHasWater;
  }

  private startLoop(): void {
    this.frameLoop.start();
  }

  /** One frame of WORK (sim + presentation). Returns whether anything is still animating, so
   *  the FrameLoop driver knows whether to keep the continuous loop running. `paused` = hard
   *  pause: no sim advance, no presentation, no ambient water — the driver renders one pending
   *  frame then idles. */
  private onFrame(now: number, deltaMs: number, paused: boolean): FrameAnimating {
    // P5: gamepad polling — once per frame, unconditionally, even in META
    // MODE and while paused (a controller must be able to navigate the title
    // / resume from the pause menu). `pollGamepad` is a complete no-op with
    // no pad connected (see `GamepadPoller`'s doc), so this costs nothing in
    // the overwhelmingly common case. Its return threads into the animating
    // decision below: a CONNECTED pad keeps the loop ticking at the ambient
    // cadence instead of going fully idle, so held-repeat/fresh presses are
    // never missed for want of a scheduled frame.
    const gamepadConnected = this.pollGamepad(now, deltaMs);

    // META MODE: no world to advance. The sky backdrop is wall-clock animated, so
    // report "animating" to keep the loop drawing — but at the reduced 'ambient'
    // cadence, because a slowly drifting cloud band does not need display rate
    // (and the title screen must not spin a laptop fan).
    if (!this.state.map) return paused ? (gamepadConnected ? 'ambient' : false) : 'ambient';

    // `worldReady` is load-bearing since the boot restructure. The frame loop now
    // starts with the SHELL (so the title's backdrop animates), which means it is
    // already running while `bootstrapWorld` builds the world — and that function
    // sets `state.map`/`state.world` PARTWAY THROUGH, before it seeds the
    // statistical cohorts, installs the weather stepper or builds the flood watch.
    // Without this gate the sim would begin ticking against a half-initialised
    // world. Set in `onWorldReady`, which is exactly where the loop used to start
    // before the shell existed, so the timing is unchanged from pre-UI-v3.
    const live = !paused && this.worldReady && this.scheduler.getRate() > 0
      && this.state.world && !this.timeline.isScrubbed;
    // Real playtime, accrued only while the world actually runs (meta mode and a
    // pause do not count). Meta state — deliberately outside the deterministic
    // sim stream, so it rides the SaveFile top-level, never the snapshot.
    if (live) this.playtimeMs += deltaMs;
    // Presentation runs every frame (keeps the audio scheduler fed); ducks on scrub. Skipped
    // while hard-paused (audio is muted and the loop is about to idle).
    if (!paused) this.presentation.update(deltaMs, { live: !!live, scrubbed: this.timeline.isScrubbed });
    if (live) {
      // The first-run tiding window closes with the CLOCK, so retire it here rather
      // than inside the HUD memo — a read must not be able to spend it (see
      // `retireFirstRunTidings`).
      this.retireFirstRunTidings();
      advanceNpcFrames(this.state.world!, deltaMs);  // presentation animation - not a scheduled system
      // M1: the chronicler's voice — cheap per-frame day-boundary check; only
      // generates (async, off the sim tick, read-only over the log) once a full
      // game day has completed. Internally single-flight + skip-missed-days.
      void this.chronicleService.checkAndGenerate();
      // Focusing a new NPC = the player's attention reaching it → a discovery
      // signal that can fire staged beats armed on that NPC.
      if (this.state.selectedNpcId && this.state.selectedNpcId !== this.lastDiscoveredNpcId) {
        this.lastDiscoveredNpcId = this.state.selectedNpcId;
        this.discoveryQueue.push({ subject: { kind: 'npc', npcId: this.state.selectedNpcId } });
      }
      // UI v2 W3 (D6): "focus warms the soul" — a FRESH npc selection made
      // while the camera sits in the soul band is the v1 spec's "zoom =
      // attention = narration trigger", finally wired automatically.
      // Selection-change detected the same way as the discovery signal above,
      // but tracked in its OWN field — deselecting and reselecting the same
      // soul must count as a fresh focus (cooldown decides whether it
      // actually fires).
      if (this.state.selectedNpcId !== this.lastSoulFocusSelection) {
        this.lastSoulFocusSelection = this.state.selectedNpcId;
        if (this.state.selectedNpcId && this.currentBand() === 'soul') {
          this.noteSoulFocus(this.state.selectedNpcId);
        }
      }
      // R9: advance through TimeController (budgeted slices) instead of a raw
      // scheduler.tick. Rate ≤ 1 (incl. seek's pinned rate 1) is a single
      // tick(deltaMs) call — byte-identical to the old direct call.
      this.timeController.advance(deltaMs, {
        world: this.state.world!,
        spirits: this.state.spirits,
        log: this.state.eventLog,
        clock: this.state.clock,
        rng: this.state.rng,
      });
      this.timeline.onAfterLiveTick();
      // F2: Fate's heartbeat. Cheap when idle; skips unless an arc is live or a seed
      // condition is met, and shares FateTrigger's cooldown when it does fire.
      this.fatePulse.tick(this.state.clock.now());
    }
    // The cinematic camera owns the view while active; stash it for onRender.
    this.lastCinematic = !paused && this.presentation.cameraActive();
    // Animating = anything that needs continuous redraw: live sim, a scrub, an in-flight
    // divine effect, the cinematic camera, a sky-cloud transition (descent/ascent,
    // spike) or the hall's cloud ramp mid-flight (H4 — a paused world must still
    // watch its sky close when the hall opens) — all full-rate. Ambient water ripples
    // alone demote to 'ambient' so the driver renders at a reduced cadence (~20 fps)
    // instead of burning full-scene GPU at display rate on an otherwise idle watery
    // world. (A hard pause forces all of these false, so the driver renders one frame
    // then rests.)
    if (!!live || this.timeline.isScrubbed || this.ui.divineEffects.isActive() || this.lastCinematic
      || this.state.cameraFly || this.shell.transitionActive() || this.hallRampAnimating()) return true;
    if (!paused && this.waterAnimating()) return 'ambient';
    return gamepadConnected ? 'ambient' : false;
  }

  /**
   * P5: poll the gamepad once and apply whatever it produced. Returns
   * whether a pad is currently connected (see `onFrame`'s doc for why that
   * feeds the animating decision). `actions` route to the SAME `UiContext`
   * focus ring / Esc stack the keyboard would drive when a modal surface is
   * up (menu navigation has exactly one implementation); the left stick/
   * triggers pan/zoom the WORLD camera only when nothing modal owns the
   * frame — a stick input while a menu is open is that menu's business, not
   * the camera's.
   */
  private pollGamepad(nowMs: number, deltaMs: number): boolean {
    const frame = this.gamepad.poll(nowMs);
    if (!frame) return false;
    this.applyGamepadFrame(frame, deltaMs);
    return true;
  }

  /** Real-ms-sized gamepad camera constants (CLAUDE.md: input timing is
   *  wall-clock, never sim ticks). Tuned against `controls.ts`'s own drag/
   *  wheel constants for a comparable FEEL, not measured against real
   *  hardware — the studio review is where these get eyeballed for real. */
  private static readonly GAMEPAD_PAN_PX_PER_MS = 0.9;
  private static readonly GAMEPAD_ZOOM_PER_MS = 0.0016;

  private applyGamepadFrame(frame: GamepadFrame, deltaMs: number): void {
    const ui = getUiRuntime();
    const modal = ui.isModalActive();
    for (const action of frame.actions) {
      if (!modal) continue; // dpad/confirm/cancel are menu-navigation only (§7) — no world-view meaning yet
      switch (action) {
        case 'menu_up': case 'menu_left': ui.focusPrev(); break;
        case 'menu_down': case 'menu_right': ui.focusNext(); break;
        case 'confirm': ui.activateFocus(); break;
        case 'cancel': ui.escape(); break;
        default: break; // toggle_*/rate_*/photo_mode aren't gamepad-mapped (see BUTTON_ACTION in gamepad.ts)
      }
    }
    // Camera pan/zoom is a WORLD-view control — a menu owns the stick/
    // triggers while it's up, and there's no camera at all in meta mode.
    if (modal || !this.state.map) return;
    if (frame.pan.dx !== 0 || frame.pan.dy !== 0) {
      // Sign convention: pushing the stick right/down PANS the view right/
      // down (a "look that way" joystick), the mirror of a mouse DRAG (which
      // moves the camera opposite the drag direction) — see `attachControls`'
      // `onMouseMove` for the drag convention this deliberately differs from.
      pan(this.state.camera, -frame.pan.dx * Game.GAMEPAD_PAN_PX_PER_MS * deltaMs,
        -frame.pan.dy * Game.GAMEPAD_PAN_PX_PER_MS * deltaMs);
      this.state.followNpc = false;
      this.state.cameraFly = null;
      this.requestRender();
    }
    if (frame.zoomAxis !== 0) {
      const vp = this.viewport();
      const factor = Math.exp(-frame.zoomAxis * Game.GAMEPAD_ZOOM_PER_MS * deltaMs);
      zoomAt(this.state.camera, factor, vp.width / 2, vp.height / 2);
      this.requestRender();
    }
  }

  /**
   * H4: is the hall's cloud ramp mid-flight? Read by `onFrame`'s animating
   * chain, which runs BEFORE the render that steps the ramp — so it must be
   * derivable from stored state alone: the ramp is in flight exactly when its
   * carried position differs from the target the CURRENT screen implies. False
   * once settled (clouds fully closed above an open hall are not moving, so
   * the loop is free to idle again).
   */
  private hallRampAnimating(): boolean {
    return this.hallRampLinear !== (this.shell.top() === 'hall' ? 1 : 0);
  }

  /**
   * UI v3 sky-transition spike: drive the descent/ascent's overlay-coverage +
   * camera-nudge each frame the world is up, off `Shell.transition()`/
   * `transitionPhase()`. Sets `currentSkyOverlay` for `renderDeps()`; returns
   * the descent's temporary camera-Y offset (0 outside a descent) and whether
   * the ascent's real state reset fired THIS frame (so the caller stops
   * rendering the now-torn-down world for this one frame — the next frame's
   * meta-mode branch takes over cleanly). Pure decision logic lives in
   * `src/game/sky-transition.ts`; this method is only the per-frame glue.
   *
   * Phase C H4: it also steps the HALL's coverage ramp, because that ramp and
   * a real transition write the same one uniform — computing both in ONE pure
   * call is what makes "the transition owns the sky" a rule rather than a
   * race. Only ever reached from the WORLD render path; meta mode has no world
   * to hide, so it resets the ramp instead (see `onRender`).
   */
  private tickShellTransition(nowMs: number): { resetFired: boolean; cameraOffsetPx: number } {
    const t = this.shell.transition();
    const phase = t ? (this.shell.transitionPhase(nowMs) ?? 1) : null;
    // ONE author for `currentSkyOverlay`: the pure step composes the real
    // transition's coverage (if any) with the hall's own ramp (H4) and hands
    // back the single number this frame's overlay wants — the two never race
    // over the field. See `stepHallOverlay`'s doc for the precedence rule.
    const hall = stepHallOverlay({
      transitionCoverage: t && phase !== null ? coverageFor(t.kind, phase) : null,
      hallOpen: this.shell.top() === 'hall',
      linear01: this.hallRampLinear,
      deltaMs: this.hallRampAtMs === null ? 0 : nowMs - this.hallRampAtMs,
    });
    this.hallRampLinear = hall.linear01;
    this.hallRampAtMs = nowMs;
    this.currentSkyOverlay = hall.coverage === null
      ? null
      : { coverage: hall.coverage, timeSec: nowMs / 1000 };
    if (!t || phase === null) return { resetFired: false, cameraOffsetPx: 0 };
    if (t.kind === 'descent') {
      // Nothing further to do once fully parted — drop the transition so it
      // stops being "active" (frees the click-to-skip pointer capture, stops
      // recomputing every frame).
      if (phase >= 1) this.shell.clearTransition();
      return { resetFired: false, cameraOffsetPx: descentCameraOffsetPx(phase) };
    }
    // Ascent: the cloud has billowed to (near) full cover — perform the real
    // teardown BEHIND it. `returnToTitle` is synchronous end-to-end (no
    // `await` in its body), so by the time this call returns, `state.map` is
    // already null and `shell.reset(['title'])` has already cleared the
    // transition.
    if (ascentResetDue(t.kind, phase, this.ascentResetFired)) {
      this.ascentResetFired = true;
      void this.returnToTitle().catch((err) => console.error('[shell] quit_to_title failed', err));
      return { resetFired: true, cameraOffsetPx: 0 };
    }
    return { resetFired: false, cameraOffsetPx: 0 };
  }

  /** The expensive scene render + UI refresh — only invoked when onFrame reported animating
   *  or a one-shot requestRender is pending. */
  private onRender(deltaMs: number): void {
    const nowMs = performance.now();
    // ── META MODE (UI v3 §3.1) ──
    // No world exists (title screen, or between worlds after quit-to-title), so
    // there is no camera, no terrain, no entities and no 2D overlay to draw —
    // just the animated sky backdrop and the UI pass. Branching here rather than
    // in a second loop keeps ONE frame driver for both modes.
    if (!this.state.map) {
      this.currentSkyOverlay = null;
      // H4: meta mode SKIPS the hall's cloud ramp — `renderMeta` already IS the
      // sky, so there is nothing beneath the hall to hide. Resetting (rather
      // than merely ignoring) the ramp is what guarantees no dangling coverage
      // survives a world: quit-to-title lands here, and so does the direct
      // `returnToTitle` a mid-world NEW WORLD takes, so the next world's
      // descent always starts from a genuinely clear sky.
      this.hallRampLinear = 0;
      this.hallRampAtMs = null;
      this.renderMeta?.({ nowMs });
      return;
    }

    const transition = this.tickShellTransition(nowMs);
    if (transition.resetFired) return; // let the NEXT frame's meta branch take over

    // Camera authority order: a cinematic owns the view; else an in-flight P5 fly
    // (alert-pin click) tweens to the anchor; else the normal NPC follow.
    if (this.lastCinematic) {
      // cinematic owns it
    } else if (this.state.cameraFly) {
      applyCameraFly(this.state, this.viewport());
    } else {
      applyFollowCamera(this.state, this.viewport());
    }
    // Keep the island from being panned/zoomed fully off-screen.
    if (this.state.map) {
      const vp = this.viewport();
      clampCameraToMap(this.state.camera, this.state.map.width, this.state.map.height, vp.width, vp.height);
    }
    // Descent's camera-Y ease (spike): a RENDER-time-only nudge — applied
    // right before the draw and restored right after — so it never fights the
    // follow/fly camera's own persistent easing above (see
    // `descentCameraOffsetPx`'s doc). Iso-screen space, same as `camera.y`
    // everywhere else; no zoom touched (the integer zoom ladder stays intact).
    const cameraOffsetPx = transition.cameraOffsetPx;
    if (cameraOffsetPx) this.state.camera.y -= cameraOffsetPx;
    const r0 = performance.now();
    this.renderer.render(deltaMs);
    if (cameraOffsetPx) this.state.camera.y += cameraOffsetPx;
    this.fps.frame(performance.now() - r0);
    this.timeBar?.refresh();
    this.dev.updateTimeDebug();
    this.veil.setActive(this.timeline.isScrubbed);
  }

  /** Entering / leaving hard pause: suspend the sim rate + mute audio (the FrameLoop driver
   *  owns the rAF idle/resume around this). */
  private onPauseChange(paused: boolean): void {
    if (paused) {
      this.savedRate = this.scheduler.getRate() || 1;
      this.scheduler.setRate(0);
      this.presentation.suspendAudio(true);
    } else {
      this.presentation.suspendAudio(false);
      this.scheduler.setRate(this.savedRate);
    }
  }

  /** Hard pause / resume — idles the loop (CPU + GPU) and mutes audio. The view stays
   *  grabbable + interactive (each requestRender draws one on-demand frame). */
  setPaused(paused: boolean, opts: { auto?: boolean } = {}): void {
    this.frameLoop.setPaused(paused, opts);
  }

  /** True while hard-paused (loop + audio suspended). */
  isPaused(): boolean { return this.frameLoop.isPaused(); }

  private onVisibilityChange = (): void => {
    if (typeof document === 'undefined') return;
    this.frameLoop.handleVisibility(document.hidden);
  };

  private stopLoop(): void {
    this.frameLoop.stop();
  }

  destroy(): void {
    if (this.sheetRekickTimer !== null) { clearInterval(this.sheetRekickTimer); this.sheetRekickTimer = null; }
    this.frameLoop.destroy();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.presentation.destroy();
    this.persistence?.destroy();
    this.cleanupControls?.();
    this.cleanupUi?.();
    this.cleanupTokens?.();
    this.resizeObserver.disconnect();
    this.ui.destroy();
    this.spendChip?.destroy();
    this.decorationImages.destroy();
    this.detachTimeKeys?.();
    this.timeBar?.dispose();
    this.veil.dispose();
    this.dev.destroy();
    this.canvas.remove();
    this.overlayCanvas.remove();
  }
}


