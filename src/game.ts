import { createState, type GameState } from '@/core/state';
import { selectRenderer, readRenderMode, type RenderFn } from '@/render/select-renderer';
import { zoomAt } from '@/render/camera';
import { fitCameraToMap } from '@/render/fit-camera';
import { focusCameraOnTile } from '@/render/focus-camera';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import type { GameMap, WorldSeed, TerrainOptions } from '@/core/types';
import { advanceNpcFrames } from '@/render/npc-animator';
// divine-actions functions now invoked via DivineActionsController
import { LLMClient } from "@/llm/llm-client";
import { createProvider, loadProviderConfig, type ProviderConfig } from '@/llm/provider-factory';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { createWelcomeModal, type WelcomeModalHandle, ONBOARDED_KEY } from '@/ui/welcome-modal';
import { simStateFromEntity, getNpc } from '@/world/npc-helpers';
import { sendWhisper } from '@/game/whisper-orchestrator';
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { GameUi } from '@/game/game-ui';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { AssetManager } from '@/render/asset-manager';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { CommandQueue } from '@/sim/command/command-queue';
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
import { DevModeController } from '@/game/dev-mode-controller';
import { FrameRenderer } from '@/game/frame-renderer';
import { createInteractionState } from '@/game/interaction-state';
import { InteractionController } from '@/game/interaction-controller';

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
}

export class Game {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private scheduler: Scheduler;
  private commandQueue = new CommandQueue();
  private attentionStore = new NpcAttentionStore();
  private authorLog = new AuthorCommandLog();
  private timeline!: TimelineController;
  private persistence!: PersistenceController;
  private cleanupControls: (() => void) | null = null;
  private cleanupTokens: (() => void) | null = null;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private lastTime: number = 0;
  private divine!: DivineActionsController;
  private ui!: GameUi;
  private llmClient!: LLMClient;
  private llmBackfill!: LlmBackfillService;
  private llmClientCapable: LLMClient | null = null;   // Tier-2 "key moments" — built, not yet called (Track 4 / Fate)
  private welcomeModal: WelcomeModalHandle | null = null;
  private decorationImages = new DecorationImageCache();
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
    this.scheduler.register(new PerceptionSystem(identityOracle, () => this.state.map));
    // Narrative substrate: runs LAST so recognizers see this frame's events.
    this.scheduler.register(new PlotThreadSystem(() => this.state.plotThreads));

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
    this.llmClient = new LLMClient(provider);
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
      onTogglePause:   () => this.scheduler.setRate(this.scheduler.getRate() === 0 ? 1 : 0),
      onSetRate:       (n) => this.scheduler.setRate(n),
      timeBarOpen:     () => this.timeBar !== null,
      onEscape:        () => { if (this.timeBar) this.toggleTimeBar(); },
    });

    this.ui = new GameUi(this.container, {
      onStart: () => {
        if (!this.state.map) {
          void this.generateWorld();
        }
      },
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
      },
      onClickMinimapTile: (x, y) => {
        const vp = this.viewport();
        focusCameraOnTile(this.state.camera, x, y, vp.width, vp.height, readRenderMode());
      },
      onZoomIn: () => {
        const vp = this.viewport();
        zoomAt(this.state.camera, 1.2, vp.width / 2, vp.height / 2);
      },
      onZoomOut: () => {
        const vp = this.viewport();
        zoomAt(this.state.camera, 1 / 1.2, vp.width / 2, vp.height / 2);
      },
      onFitView: () => {
        if (!this.state.map) return;
        const vp = this.viewport();
        fitCameraToMap(
          this.state.camera, this.state.map.width, this.state.map.height,
          vp.width, vp.height, readRenderMode(),
        );
      },
      onNewWorld: () => { void this.newWorld(); },
      onGameSettingChange: (key, value) => {
        if (key === 'showLabels') this.state.showLabels = value as boolean;
        if (key === 'showPoiMarkers') this.state.showPoiMarkers = value as boolean;
        if (key === 'debug') {
          this.state.debug = value as boolean;
          this.ui.debugHud.style.display = this.state.debug ? 'block' : 'none';
        }
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
          focusCameraOnTile(this.state.camera, pos.x, pos.y, vp.width, vp.height, readRenderMode());
        }
      },
    });

    this.llmBackfill = new LlmBackfillService({
      state: this.state,
      llmDisplay: this.ui.llmDisplay,
      client: this.llmClient,
      onWriteback: () => this.renderer.forceInfoRefresh(),
    });

    if (!localStorage.getItem(ONBOARDED_KEY)) {
      this.welcomeModal = createWelcomeModal(this.container, {
        onComplete: (config) => { this.applyLlmConfig(config); this.welcomeModal = null; },
      });
    }

    this.divine = new DivineActionsController({ state: this.state, queue: this.commandQueue, divineEffects: this.ui.divineEffects });
    this.divine.register(this.dispatcher);

    this.dev = new DevModeController({
      container: this.container, state: this.state, scheduler: this.scheduler,
      getViewport: () => this.viewport(), getRenderDeps: () => this.renderDeps(),
      commandQueue: this.commandQueue,
      getLlmCapable: () => this.llmClientCapable,
    });

    this.renderer = new FrameRenderer({
      ctx: this.ctx, state: this.state,
      ui: { minimap: this.ui.minimap, spiritHud: this.ui.spiritHud, divineEffects: this.ui.divineEffects,
            npcInfoPanel: this.ui.npcInfoPanel, npcAttentionPanel: this.ui.npcAttentionPanel,
            tooltip: this.ui.tooltip, debugHud: this.ui.debugHud },
      divine: this.divine, dev: this.dev, llmBackfill: this.llmBackfill,
      interaction: this.interaction,
      getRenderDeps: () => this.renderDeps(), getViewport: () => this.viewport(),
      renderMap: () => this.renderMap,
      isPaused: () => this.scheduler.getRate() === 0,
    });

    this.input = new InteractionController({
      state: this.state, dispatcher: this.dispatcher, interaction: this.interaction,
      dev: this.dev, placementModal: this.ui.placementModal, decorationImages: this.decorationImages,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.input.onTileClick(x, y),
      onCanvasClick: (sx, sy) => this.input.onCanvasClick(sx, sy),
      onTileRightClick: (x, y) => void this.input.onTileRightClick(x, y),
      onRightClick: (sx, sy) => void this.input.onRightClick(sx, sy),
      onTogglePause: () => this.togglePause(),
      onToggleLabels: () => { this.state.showLabels = !this.state.showLabels; },
      onTogglePoiMarkers: () => { this.state.showPoiMarkers = !this.state.showPoiMarkers; },
      onToggleDebug: () => {
        this.state.debug = !this.state.debug;
        this.ui.debugHud.style.display = this.state.debug ? 'block' : 'none';
        // Sync with unified settings
        this.ui.unifiedSettings.updateGameSetting('debug', this.state.debug);
      },
      onHoverTile: (x, y, sx, sy) => {
        this.interaction.hoverTile = { x, y };
        this.interaction.hoverScreen = { x: sx, y: sy };
      },
      onToggleFollow: () => {
        if (!this.state.selectedNpcId) return;
        this.state.followNpc = !this.state.followNpc;
      },
      onUserCameraInput: () => { this.state.followNpc = false; },
      onToggleSettings: () => this.ui.unifiedSettings.toggle(),
      onToggleMinimap: () => this.ui.minimap?.toggle(),
      onShowTutorial: () => this.ui.tutorial?.show('welcome'),
      onRedraw: () => {},
    });
  }

  /** The Tier-2 "capable" client, or null when no capable model is configured. */
  private buildCapableClient(config: ProviderConfig): LLMClient | null {
    return config.openrouterModelCapable
      ? new LLMClient(createProvider({ ...config, openrouterModel: config.openrouterModelCapable }))
      : null;
  }

  private applyLlmConfig(config: ProviderConfig): void {
    try {
      this.llmClient = new LLMClient(createProvider(config));
      this.llmBackfill.setClient(this.llmClient);
      this.llmClientCapable = this.buildCapableClient(config);
    } catch (err) {
      console.warn('[llm] config not applied:', err);
    }
  }

  private togglePause(): void {
    const paused = this.scheduler.getRate() === 0;
    this.scheduler.setRate(paused ? 1 : 0);
    this.refreshPauseBanner();
  }

  private refreshPauseBanner(): void {
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
      },
    });
  }

  private viewport(): { width: number; height: number } {
    return {
      width: this.canvas.width / devicePixelRatio,
      height: this.canvas.height / devicePixelRatio,
    };
  }

  private renderDeps(): RenderContextDeps {
    return {
      state: this.state,
      viewport: this.viewport(),
      sheets: this.sheets,
      assets: this.assets,
      decorationImages: this.decorationImages,
      devMode: this.dev.devMode,
    };
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  async generateWorld(worldSeed?: WorldSeed, _terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
    this.renderMap = await selectRenderer();
    const map = await bootstrapWorld({
      state: this.state, assets: this.assets, sheets: this.sheets,
      decorationImages: this.decorationImages, getViewport: () => this.viewport(),
      worldSeed,
      onReady: () => {
        this.ui.mainMenu.hide();
        this.ui.spiritHud.show();
        if (!localStorage.getItem('small-gods-tutorial-seen')) setTimeout(() => this.ui.tutorial.show('welcome'), 500);
        this.dev.updateInspector();
        this.persistence.start();
      },
    });
    this.startLoop();
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
      if (this.scheduler.getRate() > 0 && this.state.world && !this.timeline.isScrubbed) {
        advanceNpcFrames(this.state.world, deltaMs);  // presentation animation - not a scheduled system
        this.scheduler.tick(deltaMs, {
          world: this.state.world,
          spirits: this.state.spirits,
          log: this.state.eventLog,
          clock: this.state.clock,
          rng: this.state.rng,
        });
        this.timeline.onAfterLiveTick();
      }
      applyFollowCamera(this.state, this.viewport());
      this.renderer.render(deltaMs);
      this.timeChip.refresh();
      this.refreshPauseBanner();
      this.timeBar?.refresh();
      this.dev.updateTimeDebug();
      this.veil.setActive(this.timeline.isScrubbed);
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
    this.cleanupControls?.();
    this.cleanupTokens?.();
    this.resizeObserver.disconnect();
    this.welcomeModal?.destroy();
    this.ui.destroy();
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


