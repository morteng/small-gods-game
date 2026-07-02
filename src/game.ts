import { createState, type GameState } from '@/core/state';
import { selectRenderer, type RenderFn } from '@/render/select-renderer';
import { zoomAt } from '@/render/camera';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import { isoEnvForMap } from '@/render/iso/iso-env';
import { fitCameraToMap, clampCameraToMap } from '@/render/fit-camera';
import { focusCameraOnTile } from '@/render/focus-camera';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import type { GameMap, WorldSeed, TerrainOptions } from '@/core/types';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { createDebugApi, type DebugApi } from '@/dev/debug-api';
import { createGameQuery, type GameQuery, type InboxItem } from '@/game/game-query';
import { causalSiteCardView } from '@/game/causal-site-view';
import type { CommandVerb } from '@/sim/command/types';
import { createGameBus, type GameBus } from '@/game/game-bus';
import { getUiRuntime } from '@/render/ui/ui-runtime';
import { bootMark, FpsMeter, type FpsStats } from '@/dev/profile';
import { advanceNpcFrames } from '@/render/npc-animator';
import { isLayerHidden } from '@/render/layer-visibility';
import { getHydrologyResult } from '@/world/hydrology-store';
// divine-actions functions now invoked via DivineActionsController
import { LLMClient } from "@/llm/llm-client";
import { createProvider, loadProviderConfig, openrouterImageBaseUrl, type ProviderConfig } from '@/llm/provider-factory';
import { CostTracker } from '@/llm/cost-tracker';
import { mountSpendChip, type SpendChipHandle } from '@/ui/spend-chip';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { simStateFromEntity, getNpc } from '@/world/npc-helpers';
import { sendWhisper } from '@/game/whisper-orchestrator';
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { GameUi } from '@/game/game-ui';
import { ArtImageCache } from '@/render/decoration-image-cache';
import { loadBaseLibrary } from '@/services/base-library-loader';
import { AssetLibrary } from '@/services/asset-library';
import { ArtResolver } from '@/render/art-resolver';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import { GeneratedFloraArtSource } from '@/render/generated-flora-art-source';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '@/llm/openrouter-image-client';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { AssetManager } from '@/render/asset-manager';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { CommandQueue } from '@/sim/command/command-queue';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import type { ThreadSubject } from '@/sim/threads/thread-types';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import { StoryRegistry, StorySession, createBusStoryHost, busAllowedVerbs } from '@/story';
import { droughtOmenPack } from '@/story/samples/the-drought-omen';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import { RivalSystem } from '@/sim/systems/rival-system';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { BeliefContentSystem } from '@/sim/systems/belief-content-system';
import { PerceptionSystem } from '@/world/perception-system';
import { PlotThreadSystem } from '@/sim/threads/systems/plot-thread-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { SettlementGrowthSystem } from '@/sim/systems/settlement-growth-system';
import { RoadEvolutionSystem } from '@/sim/systems/road-evolution-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { applySkip } from '@/sim/time-skip';
import { identityOracle } from '@/world/oracle';
import { bootstrapWorld } from '@/game/bootstrap-world';
import { FrameLoop, type FrameAnimating } from '@/game/frame-loop';
import { PersistenceController } from '@/game/persistence-controller';
import { clearSave } from '@/services/save-store';
import { injectTokens } from '@/ui/inject-tokens';
import { mountChrome, mountPastVeil, type ChromeHandle } from '@/ui/chrome';
import { mountTimeChip, type TimeChipHandle } from '@/ui/panels/time-chip';
import { mountTimeBar, type TimeBarHandle } from '@/ui/panels/time-bar';
import type { RenderContextDeps } from '@/game/render-context';
import { applyFollowCamera } from '@/game/camera-follow';
import { LlmBackfillService } from '@/game/llm-backfill';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import { FateTrigger } from '@/game/fate/fate-trigger';
import { DevModeController } from '@/game/dev-mode-controller';
import { FrameRenderer } from '@/game/frame-renderer';
import { PresentationDirector } from '@/presentation/presentation-director';
import { createInteractionState } from '@/game/interaction-state';
import { InteractionController } from '@/game/interaction-controller';

const SESSION_CAP_USD = 2; // per-session live building-art spend cap

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
}

/** `?flag` present in the URL (used to opt back into the dev UI, etc.). */
function hasQueryFlag(flag: string): boolean {
  try { return new URLSearchParams(window.location.search).has(flag); }
  catch { return false; }
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
  private commandQueue = new CommandQueue();
  private discoveryQueue = new DiscoveryQueue();
  /** Last NPC fed to the discovery queue, so we push a signal only on a switch. */
  private lastDiscoveredNpcId: string | null = null;
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
  private ui!: GameUi;
  /** The barebones game (WebGPU UI only). `?legacyui` flips back to the old
   *  DOM/Canvas2D chrome. Single source of truth for chrome suppression. */
  private readonly barebones = !hasQueryFlag('legacyui');
  /** Interior reveal (epic I-1…I-6): the SELECTED building renders as a roof-off cutaway
   *  (interior rooms, rood screen, stacked storeys, crypt). ON by default now that the cutaway
   *  is verified coherent in-game; `?noInterior` opts back to the solid-exterior render. (The
   *  legacy `?interiorReveal`/`?i2` enable-flags are kept as harmless no-ops.) With nothing
   *  selected, `cutawayBuildingId` is null and the render is unchanged from before. */
  private readonly interiorReveal = !hasQueryFlag('noInterior');
  private llmClient!: LLMClient;
  private llmBackfill!: LlmBackfillService;
  private fateBrain!: FateBrainService;
  private llmClientCapable: LLMClient | null = null;   // Tier-2 "key moments" — built, not yet called (Track 4 / Fate)
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
  private readonly parametricPlantSource = new ParametricPlantSource();
  // Paid building-art generation is OFF by default while the renderer + connectome
  // (roads, etc.) stabilise and the FLUX img2img settings are retuned — re-enable
  // via the `liveBuildingArt` setting once generation is worth paying for again.
  // Cached/vendored sprites still render; uncached buildings fall back to the grey
  // parametric model. The negative-cache (generated-art-cache.ts) means even when
  // re-enabled a gate-failing building is paid for once, not every load.
  private liveBuildingArtEnabled = false; // setting `liveBuildingArt`, default OFF
  private readonly generatedBuildingArtSource = new GeneratedBuildingArtSource({
    enabled: () => this.liveBuildingArtEnabled,
    canSpend: () => this.costTracker.snapshot().sessionUsd < SESSION_CAP_USD,
    model: () => BUILDING_IMAGE_MODEL,
    generate: async (initImageDataUri, prompt) => {
      const cfg = loadProviderConfig();
      const res = await generateBuildingImage(
        { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(),
          siteName: cfg.openrouterSiteName },
        { initImageDataUri, prompt, model: BUILDING_IMAGE_MODEL },
      );
      this.costTracker.record({ cost: res.costUsd, cacheStatus: 'MISS' });
      return res.blob;
    },
  });
  // img2img flora sprites — same pipeline + gating as buildings, default OFF (the
  // `liveFloraArt` setting). With no key + an unseeded library it always misses and
  // the renderer shows grey parametric massing; a funded seed (scripts/seed-flora-art.ts)
  // + the flag turns it on. Reuses BUILDING_IMAGE_MODEL so keys match the seed run.
  private liveFloraArtEnabled = false; // setting `liveFloraArt`, default OFF
  private readonly generatedFloraArtSource = new GeneratedFloraArtSource({
    enabled: () => this.liveFloraArtEnabled,
    canSpend: () => this.costTracker.snapshot().sessionUsd < SESSION_CAP_USD,
    model: () => BUILDING_IMAGE_MODEL,
    generate: async (initImageDataUri, prompt) => {
      const cfg = loadProviderConfig();
      const res = await generateBuildingImage(
        { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(),
          siteName: cfg.openrouterSiteName },
        { initImageDataUri, prompt, model: BUILDING_IMAGE_MODEL },
      );
      this.costTracker.record({ cost: res.costUsd, cacheStatus: 'MISS' });
      return res.blob;
    },
  });
  private decorationImages = new ArtImageCache((id) => this.assetLibrary.resolveBlob(id));
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();
  private assets = new AssetManager();
  private chrome!: ChromeHandle;
  private veil!: ReturnType<typeof mountPastVeil>;
  private timeChip!: TimeChipHandle;
  private timeBar: TimeBarHandle | null = null;
  private detachTimeKeys: (() => void) | null = null;
  private renderMap: RenderFn | null = null;
  private dev!: DevModeController;
  private renderer!: FrameRenderer;
  private interaction = createInteractionState();
  private input!: InteractionController;
  private presentation!: PresentationDirector;

  constructor(container: HTMLElement, _options: GameOptions = {}) {
    this.container = container;
    this.state = createState();

    this.scheduler = new Scheduler();
    // Command executor runs FIRST: queued player/rival/Fate commands apply at the
    // top of the tick, before the sim systems compute this tick's state.
    this.scheduler.register(new CommandExecutorSystem(this.commandQueue, (r) => {
      if (r.status === 'rejected' && r.source === 'player') {
        // Seam for a player-facing rejection toast (Fate/UI cycle). Common
        // rejections (insufficient power / cooldown) are already pre-suppressed at
        // emit by the controller's previewCommand gate, so this is rare.
        console.debug('[command] player command rejected:', r.verb, r.reason);
      }
      // A god-mode climate re-zone changed worldSeed.climate; the renderer's
      // getClimateFields re-derives on its next read (cache key folds in the
      // climate signature) — just force a redraw so the new band shows at once.
      if (r.status === 'applied' && r.verb === 'author_set_climate') {
        this.renderer.forceInfoRefresh();
        this.requestRender();
      }
    }, this.authorLog, () => this.state.weather));
    this.scheduler.register(new NpcMovementSystem(() => this.state.map));
    // Order: settlement events affect needs → NpcSimSystem decays needs + recomputes mood
    // → activity system picks activities from needs → belief propagation → spirits
    this.scheduler.register(new SettlementEventSystem());
    this.scheduler.register(new NpcSimSystem());
    this.scheduler.register(new AbandonmentSystem());
    this.scheduler.register(new NpcActivitySystem());
    this.scheduler.register(new BeliefPropagationSystem());
    // Belief CONTENT (Track B): propagate + decay what they think you can DO.
    // After propagation (faith spread) so content rides the same social graph.
    this.scheduler.register(new BeliefContentSystem());
    this.scheduler.register(new SpiritSystem());
    this.scheduler.register(new RivalSystem(this.commandQueue));
    this.scheduler.register(new MortalitySystem());
    this.scheduler.register(new BirthSystem());
    this.scheduler.register(new SettlementGrowthSystem());
    this.scheduler.register(new RoadEvolutionSystem());
    // W-G: deterministic water/atmosphere tick — steps the stepper installed on world
    // seed + polls the flood watch, writing place_flooded/receded into the event log.
    this.scheduler.register(new WeatherSystem(
      () => this.state.weather,
      () => this.state.floodWatch,
      () => this.state.causalSites,
    ));
    this.scheduler.register(new PerceptionSystem(identityOracle, () => this.state.map));
    // Narrative substrate: recognizers + stub producers run LAST so they see this
    // frame's events; activation fires armed beats (its commands apply next tick).
    this.scheduler.register(new PlotThreadSystem(
      () => this.state.plotThreads,
      () => this.state.staging,
      () => this.llmClientCapable === null,   // stub runs only as the offline fallback
    ));
    this.scheduler.register(new StagingActivationSystem(
      this.discoveryQueue, this.commandQueue,
      () => this.state.staging, () => this.state.plotThreads,
      (subject, soft) => {
        // Prime soft narration where the player will find it: an NPC's mind page.
        if (subject.kind === 'npc') {
          this.attentionStore.putPage(subject.npcId, pathKey(['staged']), { prose: soft.text, links: [], depth: 0 });
        }
      },
      // A fired beat carrying a storylet ref opens it as an interactive card.
      (subject, storyletId) => {
        this.cuePresentationBeat(subject);
        return this.playStorylet(storyletId);
      },
      // W-I: reap beats armed at a causal site once it has faded.
      () => this.state.causalSites,
    ));

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
        this.attentionStore.clearAll();
      },
      authorLog: this.authorLog,
    });

    // Autosave: persist the live world to IndexedDB, throttled-on-change and
    // gated on !timeline.isScrubbed. Started once the world is ready (generateWorld).
    this.persistence = new PersistenceController({
      state: this.state,
      timeline: this.timeline,
      now: () => Date.now(),
    });


    // ── LLM Client (uses provider factory) ──────────
    const providerConfig = loadProviderConfig();
    let provider;
    try {
      provider = createProvider(providerConfig);
    } catch (err) {
      console.warn('[llm] stored provider config invalid, falling back to mock:', err);
      provider = createProvider({ type: 'mock' });
    }
    this.llmClient = new LLMClient(provider, (r) => this.costTracker.record(r));
    // Build the capable (Tier-2) client at boot too — otherwise a returning,
    // already-onboarded user whose stored config has a capable model boots with
    // llmClientCapable === null and the Create panel stays dead until they
    // re-save LLM settings. (applyLlmConfig rebuilds both on live config change.)
    try {
      this.llmClientCapable = this.buildCapableClient(providerConfig);
    } catch (err) {
      console.warn('[llm] capable client not built at boot:', err);
    }
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
    });
    this.bus = createGameBus({ queue: this.commandQueue, state: this.state, query: this.query });

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
    this.timeChip = mountTimeChip(this.chrome.anchorTopRight, {
      clock: this.state.clock,
      getRate: () => this.scheduler.getRate(),
      isPaused: () => this.scheduler.getRate() === 0,
      onClick: () => this.toggleTimeBar(),
    });

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
            if (page) this.ui.npcAttentionPanel.showMindPage(['surface'], page);
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
          this.ui.npcAttentionPanel.showMindPage(
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
          this.renderer.forceInfoRefresh();
          this.requestRender();
          return;
        }
        // Gold place-link: pan the camera to the POI.
        const poi = this.state.worldSeed?.pois.find((p) => p.id === entityId);
        const pos =
          poi?.position ??
          (poi?.region
            ? { x: (poi.region.x_min + poi.region.x_max) / 2, y: (poi.region.y_min + poi.region.y_max) / 2 }
            : null);
        if (pos) {
          const vp = this.viewport();
          focusCameraOnTile(this.state.camera, pos.x, pos.y, vp.width, vp.height, this.state.map);
          this.requestRender();
        }
      },
      onCloseBuilding: () => { this.state.selectedBuildingId = null; this.requestRender(); },
    });

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
    });
    const fateTrigger = new FateTrigger({
      clock: this.state.clock,
      cooldownTicks: 480,                       // ~5 game-days between deliberations
      isReady: () => this.fateBrain.isReady(),
      onTrigger: (focus) => { void this.fateBrain.deliberate(focus); },
    });
    fateTrigger.attach((fn) => this.state.eventLog.subscribe(fn));

    this.divine = new DivineActionsController({ state: this.state, queue: this.commandQueue, divineEffects: this.ui.divineEffects });

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
      onTileClick: (x, y) => { this.input.onTileClick(x, y); this.requestRender(); },
      onTileRightClick: (x, y) => { void this.input.onTileRightClick(x, y); this.requestRender(); },
      onRightClick: (sx, sy) => { void this.input.onRightClick(sx, sy); this.requestRender(); },
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
      onUserCameraInput: () => { this.state.followNpc = false; this.requestRender(); },
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
      getPower: () => Math.min(1, this.query.beliefState().power / 20),
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
      onStoryToggle: (active) => {
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
      // ── Track B: belief-granted powers + the divine inbox ──
      getBeliefPowers: () => this.query.beliefPowers(),
      onCastPower: (verb) => this.castPower(verb),
      getInbox: () => this.query.divineInbox(),
      onInboxAct: (item) => this.actOnInbox(item),
      onInboxInvestigate: (item) => {
        if (item.target.kind === 'npc') {
          this.state.selectedNpcId = item.target.npcId;
          this.requestRender();
        }
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
    });
    this.cleanupUi = ui.attach(this.canvas);

    // ── Barebones: the WebGPU HUD + pause menu ARE the chrome ──
    // (presence orb ⇒ power/spirit HUD, orb-click/Esc ⇒ menu + settings). One
    // call tears down the always-mounted legacy DOM (DRY); on-demand panels are
    // gated by `legacyChrome` at their render sites.
    if (this.barebones) {
      this.ui.suppressLegacyChrome();
      // The top-right anchor holds only the legacy time chip (time stays reachable
      // via the T key / time bar). The top-left anchor is empty but hide it too.
      this.chrome.anchorTopRight.style.display = 'none';
      this.chrome.anchorTopLeft.style.display = 'none';
    }
  }

  /** The Tier-2 "capable" client, or null when no capable model is configured. */
  private buildCapableClient(config: ProviderConfig): LLMClient | null {
    return config.openrouterModelCapable
      ? new LLMClient(createProvider({
          ...config,
          openrouterModel: config.openrouterModelCapable,
          openrouterCostQualityTradeoff: config.openrouterCostQualityTradeoffCapable,
        }), (r) => this.costTracker.record(r))
      : null;
  }

  private applyLlmConfig(config: ProviderConfig): void {
    try {
      this.llmClient = new LLMClient(createProvider(config), (r) => this.costTracker.record(r));
      this.llmBackfill.setClient(this.llmClient);
      this.llmClientCapable = this.buildCapableClient(config);
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
  playStorylet(storyletId: string): boolean {
    const pack = this.storyRegistry.findByStorylet(storyletId);
    if (!pack) return false;
    const host = createBusStoryHost(this.bus, { source: PLAYER_SPIRIT_ID });
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
   * Cast a belief-granted power (the skill panel's "CAST"). NPC-targeted verbs
   * (smite) fire on the selected NPC, or — until a dedicated targeting UX lands —
   * a deterministic default (the first NPC by id) so the loop is exercisable. The
   * command still runs the full belief-gate at the tick boundary, so a not-yet-
   * believed power is rejected even if the panel button were somehow pressed.
   */
  private castPower(verb: string): void {
    const cap = this.bus.capabilities().find(c => c.verb === verb);
    if (!cap) return;
    if (cap.targetKind === 'npc') {
      const npcId = this.state.selectedNpcId ?? this.query.npcs()[0]?.id;
      if (!npcId) return;
      this.bus.emit({ verb: verb as CommandVerb, source: PLAYER_SPIRIT_ID, target: { kind: 'npc', npcId } });
    } else if (cap.targetKind === 'settlement') {
      const poiId = this.state.worldSeed?.pois[0]?.id;
      if (!poiId) return;
      this.bus.emit({ verb: verb as CommandVerb, source: PLAYER_SPIRIT_ID, target: { kind: 'settlement', poiId } });
    }
    this.requestRender();
  }

  /** Triage "Act": route an inbox item to the matching divine action. */
  private actOnInbox(item: InboxItem): void {
    if (item.target.kind === 'npc') {
      // A prayer → answer it; any other npc-target → focus for now.
      const verb: CommandVerb = item.kind === 'prayer' ? 'answer_prayer' : 'whisper';
      this.bus.emit({ verb, source: PLAYER_SPIRIT_ID, target: { kind: 'npc', npcId: item.target.npcId } });
    } else if (item.target.kind === 'settlement') {
      // An opportunity → show a sign over it (the claim that bootstraps belief).
      this.bus.emit({ verb: 'omen', source: PLAYER_SPIRIT_ID, target: { kind: 'settlement', poiId: item.target.poiId } });
    }
    this.requestRender();
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
        applySkip(this.state.world, this.state.clock, this.state.rng, this.state.eventLog, years);
        this.timeline.commitSkip();
        // Immediate chrome refresh (the era_skipped chip self-appends via the event log).
        this.timeChip.refresh();
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

  async generateWorld(worldSeed?: WorldSeed, _terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
    const loading = this.ui.loadingScreen;
    loading.show();
    bootMark('start');
    loading.setProgress(0.08, 'Summoning the engine…');
    initManifoldWasm();
    bootMark('engine');
    loading.setProgress(0.22, 'Preparing the canvas…');
    this.renderMap = await selectRenderer(this.canvas);
    bootMark('renderer');
    loading.setProgress(0.38, 'Loading the art library…');
    const baseLibrary = await loadBaseLibrary();
    this.assetLibrary = new AssetLibrary(baseLibrary);
    this.artResolver = new ArtResolver(this.assetLibrary, 'pixel-art');
    this.buildingArtResolver = new ArtResolver(this.assetLibrary, 'pixel-art', 'building', ART_RECIPE_VERSION);
    bootMark('art-library');
    loading.setProgress(0.5, 'Growing the forest…');
    await this.parametricPlantSource.prewarmAll(); // species sprites ready before frame 1 — no placeholder flash
    bootMark('flora-prewarm');
    loading.setProgress(0.6, 'Generating the world…');
    const map = await bootstrapWorld({
      state: this.state, assets: this.assets, sheets: this.sheets,
      decorationImages: this.decorationImages, getViewport: () => this.viewport(),
      worldSeed,
      onReady: () => {
        bootMark('worldgen');
        this.ui.loadingScreen.setProgress(1, 'Entering the world…');
        this.ui.loadingScreen.hide();
        if (!this.barebones) this.ui.spiritHud.show(); // barebones: orb replaces it
        this.dev.updateInspector();
        this.persistence.start();
      },
    });
    this.startLoop();
    // Auto-pause when the tab is hidden (the loop + audio fully idle; resumes on return) —
    // so a backgrounded game never burns CPU/GPU on this machine.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibilityChange);
    return map;
  }

  /** Abandon the current world: stop autosaving, clear the slot, reload fresh.
   *  Reload is the simplest correct reset — boot then finds no save and seeds. */
  async newWorld(): Promise<void> {
    this.persistence?.destroy();
    await clearSave();
    this.stopLoop();
    location.reload();
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
    const live = !paused && this.scheduler.getRate() > 0 && this.state.world && !this.timeline.isScrubbed;
    // Presentation runs every frame (keeps the audio scheduler fed); ducks on scrub. Skipped
    // while hard-paused (audio is muted and the loop is about to idle).
    if (!paused) this.presentation.update(deltaMs, { live: !!live, scrubbed: this.timeline.isScrubbed });
    if (live) {
      advanceNpcFrames(this.state.world!, deltaMs);  // presentation animation - not a scheduled system
      // Focusing a new NPC = the player's attention reaching it → a discovery
      // signal that can fire staged beats armed on that NPC.
      if (this.state.selectedNpcId && this.state.selectedNpcId !== this.lastDiscoveredNpcId) {
        this.lastDiscoveredNpcId = this.state.selectedNpcId;
        this.discoveryQueue.push({ subject: { kind: 'npc', npcId: this.state.selectedNpcId } });
      }
      this.scheduler.tick(deltaMs, {
        world: this.state.world!,
        spirits: this.state.spirits,
        log: this.state.eventLog,
        clock: this.state.clock,
        rng: this.state.rng,
      });
      this.timeline.onAfterLiveTick();
    }
    // The cinematic camera owns the view while active; stash it for onRender.
    this.lastCinematic = !paused && this.presentation.cameraActive();
    // Animating = anything that needs continuous redraw: live sim, a scrub, an in-flight
    // divine effect, or the cinematic camera — all full-rate. Ambient water ripples alone
    // demote to 'ambient' so the driver renders at a reduced cadence (~20 fps) instead of
    // burning full-scene GPU at display rate on an otherwise idle watery world. (A hard
    // pause forces all of these false, so the driver renders one frame then rests.)
    if (!!live || this.timeline.isScrubbed || this.ui.divineEffects.isActive() || this.lastCinematic) return true;
    return !paused && this.waterAnimating() ? 'ambient' : false;
  }

  /** The expensive scene render + UI refresh — only invoked when onFrame reported animating
   *  or a one-shot requestRender is pending. */
  private onRender(deltaMs: number): void {
    // The cinematic camera owns the view while active; otherwise follow normally.
    if (!this.lastCinematic) applyFollowCamera(this.state, this.viewport());
    // Keep the island from being panned/zoomed fully off-screen.
    if (this.state.map) {
      const vp = this.viewport();
      clampCameraToMap(this.state.camera, this.state.map.width, this.state.map.height, vp.width, vp.height);
    }
    const r0 = performance.now();
    this.renderer.render(deltaMs);
    this.fps.frame(performance.now() - r0);
    this.timeChip.refresh();
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
    this.timeChip.dispose();
    this.veil.dispose();
    this.chrome.dispose();
    this.dev.destroy();
    this.canvas.remove();
    this.overlayCanvas.remove();
  }
}


