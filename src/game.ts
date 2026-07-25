import { createState, resetState, type GameState } from '@/core/state';
import type { RenderFn, MetaRenderFn } from '@/render/select-renderer';
import { zoomAt } from '@/render/camera';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import { isoEnvForMap } from '@/render/iso/iso-env';
import { pickTile } from '@/ui/pick-tile';
import { fitCameraToMap, clampCameraToMap } from '@/render/fit-camera';
import { focusCameraOnTile } from '@/render/focus-camera';
import { computeFrame, type FrameSubject } from '@/game/framing/compute-frame';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import type { GameMap, WorldSeed, TerrainOptions, Relationship } from '@/core/types';
import { createDebugApi, type DebugApi } from '@/dev/debug-api';
import { createGameQuery, type GameQuery, type InboxItem, type InspectorView, type BeliefView, type BeliefPowerView } from '@/game/game-query';
import { causalSiteCardView } from '@/game/causal-site-view';
import type { Command, CommandVerb, CommandTarget, CommandTargetKind } from '@/sim/command/types';
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
import { simStateFromEntity, getNpc, forEachNpc, npcProps } from '@/world/npc-helpers';
import { sendWhisper } from '@/game/whisper-orchestrator';
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
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
import { Shell } from '@/render/ui/shell/shell';
import type { ScreenId } from '@/render/ui/shell/shell-state';
import type { TitleAction, TitleView } from '@/render/ui/shell/title-screen';
import type { SaveAction, SaveScreenView, SlotRow } from '@/render/ui/shell/save-screen';
import type { LoadAction } from '@/render/ui/shell/load-screen';
import type { SettingsAction, SettingsScreenView, SettingsKey } from '@/render/ui/shell/settings-screen';
import * as settingsStore from '@/services/settings-store';
import { selectRenderer } from '@/render/select-renderer';
import { injectTokens } from '@/ui/inject-tokens';
import { mountChrome, mountPastVeil, type ChromeHandle } from '@/ui/chrome';
import { mountTimeChip, type TimeChipHandle } from '@/ui/panels/time-chip';
import { mountTimeBar, type TimeBarHandle } from '@/ui/panels/time-bar';
import type { RenderContextDeps } from '@/game/render-context';
import { applyFollowCamera, applyCameraFly } from '@/game/camera-follow';
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
import { createInteractionState } from '@/game/interaction-state';
import { InteractionController } from '@/game/interaction-controller';
import { calendarLabel, TICKS_PER_HOUR } from '@/core/calendar';
import { clamp01 } from '@/core/math';

/** How long the per-frame HUD sim-read memo (belief/powers/inbox) stays fresh.
 *  Belief moves at sim-tick rate (~1 Hz), so ~150 ms (≈7 Hz) is imperceptible for
 *  the readout yet collapses ~4–6 full congregation sweeps/frame to one. */
const HUD_SIM_TTL_MS = 150;

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

/** The shell screen ids an `open_screen` command may name. Validated rather than
 *  cast, because this value arrives from OUTSIDE (an agent over the bus) and an
 *  unknown screen must be refused, not pushed onto the stack. */
const SCREEN_IDS = new Set<ScreenId>([
  'title', 'newgame', 'load', 'save', 'settings', 'controls', 'loading', 'pause', 'gameover', 'photo',
]);
function isScreenId(v: string): v is ScreenId {
  return SCREEN_IDS.has(v as ScreenId);
}

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
  /** The barebones game (WebGPU UI only). `?legacyui` flips back to the old
   *  DOM/Canvas2D chrome. Single source of truth for chrome suppression. */
  private readonly barebones = !hasQueryFlag('legacyui');
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
  private chrome!: ChromeHandle;
  private veil!: ReturnType<typeof mountPastVeil>;
  /** Legacy DOM chip — superseded by the WebGPU clock chip (Round 9 WP-B);
   *  only mounted under `?legacyui` (barebones renders the clock via the HUD). */
  private timeChip: TimeChipHandle | null = null;
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
  /** Real playtime accrued in THIS world (ms, real time). Persisted with the
   *  save; meta state, deliberately outside the deterministic sim stream. */
  private playtimeMs = 0;
  /** True once `onWorldReady` has fired — i.e. the world is fully built. Gates
   *  the sim advance, because since the boot restructure the frame loop is
   *  already running while worldgen is in progress (see `onFrame`). */
  private worldReady = false;

  constructor(container: HTMLElement, options: GameOptions = {}) {
    this.container = container;
    this.state = createState();
    this.autostart = options.autostart ?? null;
    if (options.ephemeral !== undefined) this.ephemeral = options.ephemeral;
    this.shell = new Shell({
      requestRender: () => this.requestRender(),
      titleView: () => this.buildTitleView(),
      saveView: () => this.buildSlotsView(),
      loadView: () => this.buildSlotsView(),
      settingsView: () => this.buildSettingsView(),
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
      onClimateApplied: () => { this.renderer.forceInfoRefresh(); this.requestRender(); },
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

    this.chrome = mountChrome(this.container);
    this.veil = mountPastVeil(this.container);

    // Presentation layer (adaptive score + sfx + cinematic camera + voice). Pure
    // observer of the sim — reads GameState + EventLog, never mutates. Off the
    // deterministic path; turning it off leaves the game bit-identical.
    this.presentation = new PresentationDirector(this.state, { viewport: () => this.viewport() });
    this.presentation.attach();
    // The DOM chip is legacy chrome — barebones (default) renders the clock via
    // the WebGPU HUD's transport cluster instead (Round 9 WP-B); `?legacyui`
    // keeps the DOM chip since that chrome path never mounts the WebGPU HUD.
    if (!this.barebones) {
      this.timeChip = mountTimeChip(this.chrome.anchorTopRight, {
        clock: this.state.clock,
        getRate: () => this.scheduler.getRate(),
        isPaused: () => this.scheduler.getRate() === 0,
        onClick: () => this.toggleTimeBar(),
      });
    }

    this.detachTimeKeys = attachTimeKeys(window, {
      onToggleTimeBar: () => this.toggleTimeBar(),
      onTogglePause:   () => this.togglePause(),
      onSetRate:       (n) => { this.scheduler.setRate(n); this.requestRender(); },
      timeBarOpen:     () => this.timeBar !== null,
      onEscape:        () => { if (this.timeBar) this.toggleTimeBar(); },
    });

    this.ui = new GameUi(this.container, {
      onSelectRival: (rivalId) => {
        const rival = this.state.spirits.get(rivalId);
        if (rival && this.state.world) {
          // Find competing NPCs (simplified - get first few NPCs)
          const entities = this.state.world.query({ kind: 'npc' }).slice(0, 5);
          const npcSimStates = entities.map(e => simStateFromEntity(e) as any);
          this.ui.rivalPanel.update(rival as any, npcSimStates);
          this.ui.rivalPanel.show();
        }
      },
      onTargetNpc: (npcId) => {
        this.state.selectedNpcId = npcId;
        this.frameSubject({ kind: 'npc', npcId });
        this.requestRender();
      },
      onClickMinimapTile: (x, y) => {
        const vp = this.viewport();
        focusCameraOnTile(this.state.camera, x, y, vp.width, vp.height, this.state.map);
        this.requestRender();
      },
      onZoomIn: () => this.cameraZoomIn(),
      onZoomOut: () => this.cameraZoomOut(),
      onFitView: () => this.cameraFitView(),
      onZoomActual: () => this.cameraZoomActual(),
      onNewWorld: () => { void this.newWorld(); },
      onGameSettingChange: (key, value) => {
        if (key === 'liveBuildingArt') this.liveBuildingArtEnabled = value !== false;
        if (key === 'liveFloraArt') this.liveFloraArtEnabled = value !== false;
        if (key === 'showLabels') this.state.showLabels = value as boolean;
        if (key === 'showPoiMarkers') this.state.showPoiMarkers = value as boolean;
        if (key === 'debug') {
          this.state.debug = value as boolean;
          this.ui.debugHud.style.display = this.state.debug ? 'block' : 'none';
        }
        this.requestRender();
      },
      onLLMConfigChange: (config) => this.applyLlmConfig(config),
      attentionStore: this.attentionStore,
      onWhisperSend: (npcId: string, text: string) => {
        const world = this.state.world;
        if (!world) return;
        const entity = getNpc(world, npcId);
        if (!entity) return;
        void sendWhisper(entity, text, {
          queue: this.commandQueue,
          llm: this.llmClient,
          store: this.attentionStore,
          playerSpiritId: 'player',
          now: () => this.state.clock.now(),
        }).then(() => {
          // The whisper re-shapes their surface thoughts: drop the cached surface
          // page and re-read it (free, depth 0) with the new whisper as context.
          if (!this.state.world) return;
          const npc = getNpc(this.state.world, npcId);
          if (!npc) return;
          this.attentionStore.invalidatePage(npcId, pathKey(['surface']));
          return openMindPage(npc, ['surface'], 0, {
            world: this.state.world,
            store: this.attentionStore,
            queue: this.commandQueue,
            llm: this.llmClientCapable ?? this.llmClient,
            playerSpirit: this.state.spirits.get('player')!,
            playerSpiritId: 'player',
          }).then((page) => {
            if (page) this.ui.npcAttentionPanel?.showMindPage(['surface'], page);
          });
        });
      },
      onMindOpen: (npcId: string, path: string[], depth: number) => {
        const world = this.state.world;
        if (!world) return;
        const entity = getNpc(world, npcId);
        if (!entity) return;
        void openMindPage(entity, path, depth, {
          world,
          store: this.attentionStore,
          queue: this.commandQueue,
          llm: this.llmClientCapable ?? this.llmClient, // structured output prefers capable tier; fall back to NPC tier
          playerSpirit: this.state.spirits.get('player')!,
          playerSpiritId: 'player',
        }).then((page) => {
          this.ui.npcAttentionPanel?.showMindPage(
            path,
            page ?? { prose: 'Not enough power to drill deeper.', links: [], depth },
          );
        });
      },
      onMindCrossNav: (entityId: string) => {
        const world = this.state.world;
        if (!world) return;
        const target = getNpc(world, entityId);
        if (target) {
          // Gold person-link: select the NPC. frame-renderer's `switched` detection
          // calls npcAttentionPanel.setNpc() (which opens their mind surface);
          // forceInfoRefresh makes it happen immediately.
          this.state.selectedNpcId = entityId;
          this.frameSubject({ kind: 'npc', npcId: entityId });
          this.renderer.forceInfoRefresh();
          this.requestRender();
          return;
        }
        // Gold place-link: frame the settlement (region-fit, settlement altitude).
        if (this.state.worldSeed?.pois.some((p) => p.id === entityId)) {
          this.frameSubject({ kind: 'settlement', poiId: entityId });
          this.requestRender();
        }
      },
      onCloseBuilding: () => { this.state.selectedBuildingId = null; this.requestRender(); },
    // C5: barebones never mounts the legacy whisper chrome (attention panel +
    // narration card) — the WebGPU conversation card is the whisper surface.
    }, { legacyChrome: !this.barebones });

    this.spendChip = mountSpendChip(this.ui.bottomLeftBar, this.costTracker);
    this.spendChip.setVisible(providerConfig.type === 'openrouter');

    this.llmBackfill = new LlmBackfillService({
      state: this.state,
      llmDisplay: this.ui.llmDisplay,
      client: this.llmClient,
      onWriteback: () => { this.renderer.forceInfoRefresh(); this.requestRender(); },
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
      // Fallback: emit the pre-paired command directly (one-shot).
      emitFallback: (choice) => {
        const cmd = choice.command;
        this.bus.emit({ verb: cmd.verb, source: cmd.source, target: cmd.target, params: cmd.params, payload: cmd.payload });
        this.invalidateHudSim();
        this.fireCastFx(cmd.verb, cmd.target);
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
      ui: { minimap: this.ui.minimap, spiritHud: this.ui.spiritHud, divineEffects: this.ui.divineEffects,
            npcInfoPanel: this.ui.npcInfoPanel, npcAttentionPanel: this.ui.npcAttentionPanel,
            buildingInfoPanel: this.ui.buildingInfoPanel,
            tooltip: this.ui.tooltip, debugHud: this.ui.debugHud },
      divine: this.divine, dev: this.dev, llmBackfill: this.llmBackfill,
      interaction: this.interaction,
      getRenderDeps: () => this.renderDeps(), getViewport: () => this.viewport(),
      renderMap: () => this.renderMap,
      isPaused: () => this.scheduler.getRate() === 0,
      legacyChrome: !this.barebones,
    });

    this.input = new InteractionController({
      state: this.state, interaction: this.interaction,
      dev: this.dev, placementModal: this.ui.placementModal, decorationImages: this.decorationImages,
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
      onTogglePause: () => this.togglePause(),
      onToggleLabels: () => { this.state.showLabels = !this.state.showLabels; this.requestRender(); },
      onTogglePoiMarkers: () => { this.state.showPoiMarkers = !this.state.showPoiMarkers; this.requestRender(); },
      onToggleDebug: () => {
        this.state.debug = !this.state.debug;
        this.ui.debugHud.style.display = this.state.debug ? 'block' : 'none';
        // Sync with unified settings
        this.ui.unifiedSettings.updateGameSetting('debug', this.state.debug);
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
      onToggleSettings: () => { if (this.barebones) getUiRuntime().toggleMenu(); else this.ui.unifiedSettings.toggle(); },
      onToggleMinimap: () => { this.ui.minimap?.toggle(); this.requestRender(); },
      onShowTutorial: () => this.ui.tutorial?.show('welcome'),
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
        this.refreshPauseBanner();
        this.requestRender();
      },
      getLighting: () => this.dev.devMode.lighting !== 'off',
      onToggleLighting: () => {
        this.dev.devMode.lighting = this.dev.devMode.lighting === 'off' ? 'banded' : 'off';
        this.requestRender();
        return this.dev.devMode.lighting !== 'off';
      },
      onSaveLlmConfig: (cfg) => this.applyLlmConfig(cfg),
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
        this.refreshPauseBanner();
        this.requestRender();
      },
      onCardFreeText: (text) => this.conversation.sendFreeText(text),
      // ── Track B: belief-granted powers + the divine inbox ──
      getBeliefPowers: () => this.hudSim().powers,
      onCastPower: (verb) => this.castPower(verb),
      getTargeting: () => this.interaction.targeting ? { label: this.interaction.targeting.label } : null,
      getHoverAffordances: () => this.hoverAffordances(),
      onHoverChip: (verb) => this.castHoverChip(verb),
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
            this.bus.emit({ verb: 'new_game', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
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
            break;
          case 'back':
            this.bus.emit({ verb: 'close_screen', source: PLAYER_SPIRIT_ID, target: { kind: 'none' } });
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
    });
    ui.setShell(this.shell);
    this.cleanupUi = ui.attach(this.canvas);

    // ── Barebones: the WebGPU HUD + pause menu ARE the chrome ──
    // (presence orb ⇒ power/spirit HUD, orb-click/Esc ⇒ menu + settings). One
    // call tears down the always-mounted legacy DOM (DRY); on-demand panels are
    // gated by `legacyChrome` at their render sites.
    if (this.barebones) {
      this.ui.suppressLegacyChrome();
      // The DOM time chip never mounts here in barebones (see above); hide the
      // anchor anyway (idempotent) — the top-left anchor is empty but hide it too.
      this.chrome.anchorTopRight.style.display = 'none';
      this.chrome.anchorTopLeft.style.display = 'none';
    }
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
   * Cast a belief-granted power (the skill panel's "CAST"). If a compatible NPC is
   * already selected, an npc-verb fires on it at once (the fast path); otherwise we
   * enter verb-first *targeting* — a reticle whose next map click resolves the
   * target (`resolveTargetedCast`). The command still runs the full belief-gate at
   * the tick boundary, so a not-yet-believed power is rejected regardless.
   */
  private castPower(verb: string): void {
    const cap = this.bus.capabilities().find(c => c.verb === verb);
    if (!cap) return;
    // Fast path: an npc-capable verb with an NPC already selected fires immediately.
    if (cap.targetKinds.includes('npc') && this.state.selectedNpcId) {
      this.emitDivine(verb as CommandVerb, { kind: 'npc', npcId: this.state.selectedNpcId });
      return;
    }
    // Otherwise aim it: the next left-click on the world resolves the target.
    const label = this.query.beliefPowers().find(p => p.verb === verb)?.label ?? verb;
    this.interaction.targeting = { verb, label };
    this.requestRender();
  }

  /** Resolve an in-progress verb-first cast against the tile the player clicked. */
  private resolveTargetedCast(x: number, y: number): void {
    const aim = this.interaction.targeting;
    this.interaction.targeting = null;   // one click resolves or misses; either way exit
    if (!aim || !this.state.world) return;
    const cap = this.bus.capabilities().find(c => c.verb === aim.verb);
    if (!cap) return;
    const target = this.resolveTargetAt(x, y, cap.targetKinds);
    if (!target) return;
    this.emitDivine(aim.verb as CommandVerb, target);
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
   * `whisper` becomes the whisper card (P4). Everything else emits its `Command` and
   * fires any cast FX (the smite thunderbolt). One seam so all surfaces behave alike.
   */
  private emitDivine(verb: CommandVerb, target: CommandTarget): void {
    if (verb === 'whisper' && this.conversation.present(target)) return;
    this.bus.emit({ verb, source: PLAYER_SPIRIT_ID, target });
    this.invalidateHudSim(); // belief/inbox shift → refresh the HUD memo next frame
    this.fireCastFx(verb, target);
    this.requestRender();
  }

  /** Visual feedback for a cast — the smite thunderbolt at the resolved world tile.
   *  (Other verbs' FX ride their own controller paths; smite had none until now.) */
  private fireCastFx(verb: CommandVerb, target: CommandTarget): void {
    if (verb !== 'smite') return;
    const pos = this.targetWorldPos(target);
    if (pos) this.ui.divineEffects.trigger('smite', pos.x, pos.y);
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
    const fresh = {
      t: now,
      belief: this.query.beliefState(),
      powers: this.query.beliefPowers(),
      inbox: this.query.divineInbox(),
    };
    this.hudSimCache = fresh;
    return fresh;
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
        void this.returnToTitle().catch((err) => console.error('[shell] quit_to_title failed', err));
        break;
      case 'open_screen': {
        const screen = str('screen');
        if (screen && isScreenId(screen)) { this.shell.push(screen); this.requestRender(); }
        break;
      }
      case 'close_screen':
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
      case 'rename_slot':
      case 'rebind_key':
      case 'capture_photo':
      case 'copy_world_code':
        // Declared in the registry (so the vocabulary + `capabilities` discovery
        // are stable from the start) but serviced by their own phases. An honest
        // log beats a silent no-op: an agent that calls one early can tell.
        console.info(`[shell] '${cmd.verb}' is declared but not yet serviced`);
        break;
    }
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
        settingsStore.setUiScale(Math.round(v));
        // NO live apply path: `ui-layer.ts`'s `uiScaleFor(dpr)` derives the HUD
        // scale from device pixel ratio alone, never this store. Persisted
        // honestly; effective on a future slice, not even on reload yet.
        console.info("[shell] 'uiScale' saved — no render-side apply path exists yet");
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
    };
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

  private refreshPauseBanner(): void {
    // Barebones shows pause via the WebGPU menu's "behind glass" dim — the DOM
    // banner is legacy chrome and stays hidden.
    if (this.barebones) return;
    this.ui.pausedBanner.style.display = this.scheduler.getRate() === 0 ? 'block' : 'none';
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
        this.timeChip?.refresh();
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
   * composite relied on). Returns '' before the renderer/world exist.
   */
  private captureFrame(): string {
    if (!this.renderMap || !this.state.map) return '';
    this.renderer.render(0);
    const tmp = document.createElement('canvas');
    tmp.width = this.canvas.width;
    tmp.height = this.canvas.height;
    const t = tmp.getContext('2d');
    if (!t) return '';
    t.drawImage(this.canvas, 0, 0);          // WebGPU scene (fresh this frame)
    t.drawImage(this.overlayCanvas, 0, 0);   // 2D overlays (HUD, connectome)
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
    void this.probeSaves();
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
        if (!this.barebones) this.ui.spiritHud.show(); // barebones: orb replaces it
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
  private onFrame(_now: number, deltaMs: number, paused: boolean): FrameAnimating {
    // META MODE: no world to advance. The sky backdrop is wall-clock animated, so
    // report "animating" to keep the loop drawing — but at the reduced 'ambient'
    // cadence, because a slowly drifting cloud band does not need display rate
    // (and the title screen must not spin a laptop fan).
    if (!this.state.map) return paused ? false : 'ambient';

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
      // UI v2 W3 (D6): "focus warms the soul" — a FRESH npc selection (barebones
      // only; legacy chrome keeps its manual backfill button) made while the
      // camera sits in the soul band is the v1 spec's "zoom = attention =
      // narration trigger", finally wired automatically. Selection-change
      // detected the same way as the discovery signal above, but tracked in its
      // OWN field — deselecting and reselecting the same soul must count as a
      // fresh focus (cooldown decides whether it actually fires).
      if (this.barebones && this.state.selectedNpcId !== this.lastSoulFocusSelection) {
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
    // divine effect, or the cinematic camera — all full-rate. Ambient water ripples alone
    // demote to 'ambient' so the driver renders at a reduced cadence (~20 fps) instead of
    // burning full-scene GPU at display rate on an otherwise idle watery world. (A hard
    // pause forces all of these false, so the driver renders one frame then rests.)
    if (!!live || this.timeline.isScrubbed || this.ui.divineEffects.isActive() || this.lastCinematic || this.state.cameraFly) return true;
    return !paused && this.waterAnimating() ? 'ambient' : false;
  }

  /** The expensive scene render + UI refresh — only invoked when onFrame reported animating
   *  or a one-shot requestRender is pending. */
  private onRender(deltaMs: number): void {
    // ── META MODE (UI v3 §3.1) ──
    // No world exists (title screen, or between worlds after quit-to-title), so
    // there is no camera, no terrain, no entities and no 2D overlay to draw —
    // just the animated sky backdrop and the UI pass. Branching here rather than
    // in a second loop keeps ONE frame driver for both modes.
    if (!this.state.map) {
      this.renderMeta?.({ nowMs: performance.now() });
      return;
    }

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
    const r0 = performance.now();
    this.renderer.render(deltaMs);
    this.fps.frame(performance.now() - r0);
    this.timeChip?.refresh();
    this.refreshPauseBanner();
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
    this.refreshPauseBanner();
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
    this.timeChip?.dispose();
    this.veil.dispose();
    this.chrome.dispose();
    this.dev.destroy();
    this.canvas.remove();
    this.overlayCanvas.remove();
  }
}


