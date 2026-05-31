import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { selectRenderer, toggleRenderMode, type RenderFn } from '@/render/select-renderer';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import type { GameMap, WorldSeed, TerrainOptions } from '@/core/types';
import { advanceNpcFrames } from '@/render/npc-animator';
// divine-actions functions now invoked via DivineActionsController
import { LLMClient } from "@/llm/llm-client";
import { createProvider, loadProviderConfig } from '@/llm/provider-factory';
import { simStateFromEntity } from '@/world/npc-helpers';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { GameUi } from '@/game/game-ui';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { AssetManager } from '@/render/asset-manager';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { identityOracle } from '@/world/oracle';
import { bootstrapWorld } from '@/game/bootstrap-world';
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
  private timeline!: TimelineController;
  private cleanupControls: (() => void) | null = null;
  private cleanupTokens: (() => void) | null = null;
  private cleanupRenderToggle: (() => void) | null = null;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private lastTime: number = 0;
  private divine!: DivineActionsController;
  private ui!: GameUi;
  private llmClient!: LLMClient;
  private llmBackfill!: LlmBackfillService;
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
    this.scheduler.register(new NpcMovementSystem(() => this.state.map));
    // Order: settlement events affect needs → NpcSimSystem decays needs + recomputes mood
    // → activity system picks activities from needs → belief propagation → spirits
    this.scheduler.register(new SettlementEventSystem());
    this.scheduler.register(new NpcSimSystem());
    this.scheduler.register(new AbandonmentSystem());
    this.scheduler.register(new NpcActivitySystem());
    this.scheduler.register(new BeliefPropagationSystem());
    this.scheduler.register(new SpiritSystem());
    this.scheduler.register(new PerceptionSystem(identityOracle, () => this.state.map));

    this.timeline = new TimelineController({
      state: this.state,
      scheduler: this.scheduler,
    });


    // ── LLM Client (uses provider factory) ──────────
    const providerConfig = loadProviderConfig();
    const provider = createProvider(providerConfig);
    this.llmClient = new LLMClient(provider);
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

    // Ctrl+Shift+I toggles render mode (topdown ↔ iso) and reloads
    this.cleanupRenderToggle = this.attachRenderToggleKey();

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
        // Move camera to tile
        const cam = this.state.camera;
        cam.x = x * TILE_SIZE - (this.canvas.width / devicePixelRatio) / 2;
        cam.y = y * TILE_SIZE - (this.canvas.height / devicePixelRatio) / 2;
      },
      onGameSettingChange: (key, value) => {
        if (key === 'showLabels') this.state.showLabels = value as boolean;
        if (key === 'showPoiMarkers') this.state.showPoiMarkers = value as boolean;
        if (key === 'debug') {
          this.state.debug = value as boolean;
          this.ui.debugHud.style.display = this.state.debug ? 'block' : 'none';
        }
      },
    });

    this.llmBackfill = new LlmBackfillService({
      state: this.state,
      llmDisplay: this.ui.llmDisplay,
      client: this.llmClient,
      onWriteback: () => this.renderer.forceInfoRefresh(),
    });

    this.divine = new DivineActionsController({ state: this.state, divineEffects: this.ui.divineEffects });
    this.divine.register(this.dispatcher);

    this.dev = new DevModeController({
      container: this.container, state: this.state, scheduler: this.scheduler,
      getViewport: () => this.viewport(), getRenderDeps: () => this.renderDeps(),
    });

    this.renderer = new FrameRenderer({
      ctx: this.ctx, state: this.state,
      ui: { minimap: this.ui.minimap, spiritHud: this.ui.spiritHud, divineEffects: this.ui.divineEffects,
            npcInfoPanel: this.ui.npcInfoPanel, tooltip: this.ui.tooltip, debugHud: this.ui.debugHud },
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

  private attachRenderToggleKey(): () => void {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyI') {
        e.preventDefault();
        toggleRenderMode();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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
        this.dev.updateWorldInspector();
      },
    });
    this.startLoop();
    return map;
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
    this.cleanupControls?.();
    this.cleanupTokens?.();
    this.cleanupRenderToggle?.();
    this.resizeObserver.disconnect();
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


