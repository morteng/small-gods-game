import { createState, type GameState } from '@/core/state';
import { selectRenderer, type RenderFn } from '@/render/select-renderer';
import { zoomAt } from '@/render/camera';
import { quantizeIsoZoom } from '@/render/iso/iso-camera';
import { fitCameraToMap } from '@/render/fit-camera';
import { focusCameraOnTile } from '@/render/focus-camera';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import type { GameMap, WorldSeed, TerrainOptions } from '@/core/types';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { createDebugApi, type DebugApi } from '@/dev/debug-api';
import { createGameQuery, type GameQuery } from '@/game/game-query';
import { createGameBus, type GameBus } from '@/game/game-bus';
import { getUiRuntime } from '@/render/ui/ui-runtime';
import { bootMark, FpsMeter, type FpsStats } from '@/dev/profile';
import { createFpsHud, type FpsHudHandle } from '@/dev/fps-hud';
import { advanceNpcFrames } from '@/render/npc-animator';
// divine-actions functions now invoked via DivineActionsController
import { LLMClient } from "@/llm/llm-client";
import { createProvider, loadProviderConfig, openrouterImageBaseUrl, type ProviderConfig } from '@/llm/provider-factory';
import { CostTracker } from '@/llm/cost-tracker';
import { mountSpendChip, type SpendChipHandle } from '@/ui/spend-chip';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { simStateFromEntity, getNpc } from '@/world/npc-helpers';
import { sendWhisper } from '@/game/whisper-orchestrator';
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { GameUi } from '@/game/game-ui';
import { ArtImageCache } from '@/render/decoration-image-cache';
import { loadBaseLibrary } from '@/services/base-library-loader';
import { AssetLibrary } from '@/services/asset-library';
import { ArtResolver } from '@/render/art-resolver';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '@/llm/openrouter-image-client';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { AssetManager } from '@/render/asset-manager';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { CommandQueue } from '@/sim/command/command-queue';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import { RivalSystem } from '@/sim/systems/rival-system';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { PlotThreadSystem } from '@/sim/threads/systems/plot-thread-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { SettlementGrowthSystem } from '@/sim/systems/settlement-growth-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { applySkip } from '@/sim/time-skip';
import { identityOracle } from '@/world/oracle';
import { bootstrapWorld } from '@/game/bootstrap-world';
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
  private canvas: HTMLCanvasElement;
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
  private cleanupTokens: (() => void) | null = null;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private lastTime: number = 0;
  /** Rendered-frame FPS meter (always sampling; cheap). Read via the HUD / __perf. */
  private readonly fps = new FpsMeter();
  private fpsHud: FpsHudHandle | null = null;
  private detachProfileKeys: (() => void) | null = null;
  // Render-on-demand flag for the "real pause" path: a LIVE world redraws every
  // frame, but a PAUSED world only redraws when something visual changed (camera,
  // hover, selection, a UI toggle, resize). Starts true so the first frame draws.
  // Set via requestRender(); consumed in the frame loop.
  private needsRender = true;
  /** Mark the scene dirty so the next frame redraws even while paused. */
  private requestRender = (): void => { this.needsRender = true; };
  private divine!: DivineActionsController;
  private ui!: GameUi;
  /** The barebones game (WebGPU UI only). `?legacyui` flips back to the old
   *  DOM/Canvas2D chrome. Single source of truth for chrome suppression. */
  private readonly barebones = !hasQueryFlag('legacyui');
  private llmClient!: LLMClient;
  private llmBackfill!: LlmBackfillService;
  private fateBrain!: FateBrainService;
  private llmClientCapable: LLMClient | null = null;   // Tier-2 "key moments" — built, not yet called (Track 4 / Fate)
  private costTracker = new CostTracker();
  private spendChip: SpendChipHandle | null = null;
  private assetLibrary!: AssetLibrary;
  private artResolver!: ArtResolver;
  private buildingArtResolver!: ArtResolver;
  private readonly parametricBuildingSource = new ParametricBuildingSource();
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
  private decorationImages = new ArtImageCache((id) => this.assetLibrary.resolveBlob(id));
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();
  private assets = new AssetManager();
  private dispatcher = new OverlayDispatcher();
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
    }, this.authorLog));
    this.scheduler.register(new NpcMovementSystem(() => this.state.map));
    // Order: settlement events affect needs → NpcSimSystem decays needs + recomputes mood
    // → activity system picks activities from needs → belief propagation → spirits
    this.scheduler.register(new SettlementEventSystem());
    this.scheduler.register(new NpcSimSystem());
    this.scheduler.register(new AbandonmentSystem());
    this.scheduler.register(new NpcActivitySystem());
    this.scheduler.register(new BeliefPropagationSystem());
    this.scheduler.register(new SpiritSystem());
    this.scheduler.register(new RivalSystem(this.commandQueue));
    this.scheduler.register(new MortalitySystem());
    this.scheduler.register(new BirthSystem());
    this.scheduler.register(new SettlementGrowthSystem());
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
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // S0 command/query bus: the read facade + the unified seam a UI/MCP bridge
    // consumes. Built over the already-owned state/queue; __debug shims onto it.
    this.query = createGameQuery({
      state: this.state,
      canvas: this.canvas,
      rate: () => this.scheduler.getRate(),
      timeline: this.timeline,
    });
    this.bus = createGameBus({ queue: this.commandQueue, state: this.state, query: this.query });

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    this.cleanupTokens = injectTokens(this.container);

    this.chrome = mountChrome(this.container);
    this.veil = mountPastVeil(this.container);
    this.timeChip = mountTimeChip(this.chrome.anchorTopRight, {
      clock: this.state.clock,
      getRate: () => this.scheduler.getRate(),
      isPaused: () => this.scheduler.getRate() === 0,
      onClick: () => this.toggleTimeBar(),
    });

    this.detachTimeKeys = attachTimeKeys(window, {
      onToggleTimeBar: () => this.toggleTimeBar(),
      onTogglePause:   () => { this.scheduler.setRate(this.scheduler.getRate() === 0 ? 1 : 0); this.requestRender(); },
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
        focusCameraOnTile(this.state.camera, x, y, vp.width, vp.height);
        this.requestRender();
      },
      onZoomIn: () => {
        const vp = this.viewport();
        zoomAt(this.state.camera, 1.2, vp.width / 2, vp.height / 2, quantizeIsoZoom);
        this.requestRender();
      },
      onZoomOut: () => {
        const vp = this.viewport();
        zoomAt(this.state.camera, 1 / 1.2, vp.width / 2, vp.height / 2, quantizeIsoZoom);
        this.requestRender();
      },
      onFitView: () => {
        if (!this.state.map) return;
        const vp = this.viewport();
        fitCameraToMap(
          this.state.camera, this.state.map.width, this.state.map.height,
          vp.width, vp.height,
        );
        this.requestRender();
      },
      onZoomActual: () => {
        // Snap to exactly 1:1 about the viewport centre — keeps the centred world
        // point fixed while setting zoom to 1 (native pixel scale, crisp art).
        const vp = this.viewport();
        const z = this.state.camera.zoom || 1;
        zoomAt(this.state.camera, 1 / z, vp.width / 2, vp.height / 2);
        this.requestRender();
      },
      onNewWorld: () => { void this.newWorld(); },
      onGameSettingChange: (key, value) => {
        if (key === 'liveBuildingArt') this.liveBuildingArtEnabled = value !== false;
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
          focusCameraOnTile(this.state.camera, pos.x, pos.y, vp.width, vp.height);
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
    this.divine.register(this.dispatcher);

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
      state: this.state, dispatcher: this.dispatcher, interaction: this.interaction,
      dev: this.dev, placementModal: this.ui.placementModal, decorationImages: this.decorationImages,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      // Canvas interactions mutate selection / cast divine actions → redraw even
      // while paused (divine effects keep animating via DivineEffects.isActive()).
      onTileClick: (x, y) => { this.input.onTileClick(x, y); this.requestRender(); },
      onCanvasClick: (sx, sy) => { const r = this.input.onCanvasClick(sx, sy); this.requestRender(); return r; },
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

  private togglePause(): void {
    const paused = this.scheduler.getRate() === 0;
    this.scheduler.setRate(paused ? 1 : 0);
    this.refreshPauseBanner();
    this.requestRender();
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

  /** Stable debug surface for console/Playwright/MCP (see src/dev/debug-api.ts). */
  debug(): DebugApi {
    return createDebugApi({ query: this.query, state: this.state, viewport: () => this.viewport() });
  }

  /** Latest rendered-frame stats (see src/dev/profile.ts). For `window.__perf`. */
  fpsStats(): FpsStats { return this.fps.stats(); }

  /** Show/hide the in-page FPS HUD; created lazily on first show. */
  setFpsHud(visible: boolean): void {
    if (visible && !this.fpsHud) this.fpsHud = createFpsHud(this.container);
    this.fpsHud?.setVisible(visible);
    if (visible) this.requestRender();  // wake a frame so the HUD populates
  }

  toggleFpsHud(): boolean {
    this.setFpsHud(!(this.fpsHud?.isVisible() ?? false));
    return this.fpsHud?.isVisible() ?? false;
  }

  /** Wire profiling controls. The FPS HUD is dev tooling that lives in the dev /
   *  studio surface, never the barebones game — so it ONLY appears under `?dev`.
   *  The old `?fps`/`?profile` aliases are retired so a stale one can't leak the
   *  HUD into normal play; backtick toggles it only on the dev surface. */
  private installProfiling(): void {
    if (!hasQueryFlag('dev')) return;
    this.setFpsHud(true);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey) this.toggleFpsHud();
    };
    window.addEventListener('keydown', onKey);
    this.detachProfileKeys = () => window.removeEventListener('keydown', onKey);
  }

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
      parametricPlantSource: this.parametricPlantSource,
      generatedBuildingArtSource: this.generatedBuildingArtSource,
      devMode: this.dev.devMode,
    };
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
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
    this.renderMap = await selectRenderer();
    bootMark('renderer');
    loading.setProgress(0.38, 'Loading the art library…');
    const baseLibrary = await loadBaseLibrary();
    this.assetLibrary = new AssetLibrary(baseLibrary);
    this.artResolver = new ArtResolver(this.assetLibrary, 'pixel-art');
    this.buildingArtResolver = new ArtResolver(this.assetLibrary, 'pixel-art', 'building', ART_RECIPE_VERSION);
    bootMark('art-library');
    loading.setProgress(0.55, 'Generating the world…');
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
    this.installProfiling();
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

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();

    const loop = (now: number) => {
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      const live = this.scheduler.getRate() > 0 && this.state.world && !this.timeline.isScrubbed;
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
      // REAL PAUSE: when not live, do the expensive scene render + UI refresh only
      // if something changed (requestRender), an effect is still animating, or the
      // past is being scrubbed. Otherwise the rAF body is ~free and the GPU idles.
      if (live || this.needsRender || this.timeline.isScrubbed || this.ui.divineEffects.isActive()) {
        this.needsRender = false;
        applyFollowCamera(this.state, this.viewport());
        const r0 = performance.now();
        this.renderer.render(deltaMs);
        this.fps.frame(performance.now() - r0);
        if (this.fpsHud?.isVisible()) this.fpsHud.update(this.fps.stats());
        this.timeChip.refresh();
        this.refreshPauseBanner();
        this.timeBar?.refresh();
        this.dev.updateTimeDebug();
        this.veil.setActive(this.timeline.isScrubbed);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  destroy(): void {
    this.stopLoop();
    this.persistence?.destroy();
    this.detachProfileKeys?.();
    this.fpsHud?.destroy();
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
  }
}


