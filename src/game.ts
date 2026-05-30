import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { selectRenderer, toggleRenderMode, readRenderMode, type RenderFn } from '@/render/select-renderer';
import { centerOn } from '@/render/camera';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions } from '@/core/types';
import { advanceNpcFrames } from '@/render/npc-animator';
// divine-actions functions now invoked via DivineActionsController
import { LLMClient } from "@/llm/llm-client";
import { createProvider, type ProviderConfig, loadProviderConfig } from '@/llm/provider-factory';
import { npcProps, simStateFromEntity } from '@/world/npc-helpers';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
// NEW: Import unified settings and new UI components
import { createSettingsPanel as createUnifiedSettings, type SettingsHandle } from '@/ui/settings-unified';
import { createMainMenu, type MainMenuHandle } from '@/ui/main-menu';
import { createSpiritHud, type SpiritHudHandle } from '@/ui/spirit-hud';
import { createRivalPanel, type RivalPanelHandle } from '@/ui/rival-panel';
import { createMinimapPanel, type MinimapHandle } from '@/ui/minimap-panel';
import { createTutorial, type TutorialHandle } from '@/ui/tutorial';
import { DivineEffects } from '@/render/divine-effects';
import { DivineActionsController } from '@/game/divine-actions-controller';
import {
  createDecorationPlacementModal,
  type DecorationPlacementModalHandle,
} from '@/ui/decoration-placement-modal';
import { loadDecorations, saveDecorations } from '@/services/decoration-store';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { AssetManager } from '@/render/asset-manager';
import { createLlmDisplay, type LlmDisplayHandle } from '@/ui/llm-display';
import { createLLMSettings, type LLMSettingsHandle } from "@/ui/llm-settings-new";
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { generateWithNoise } from '@/map/map-generator';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { BeliefPropagationSystem } from '@/sim/systems/belief-propagation-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { seedWorld } from '@/world/seed-world';
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
  private pausedBanner: HTMLDivElement;
  private debugHud: HTMLDivElement;
  private npcInfoPanel: HTMLDivElement;
  // NEW: UI components
  private mainMenu!: MainMenuHandle;
  private spiritHud!: SpiritHudHandle;
  private rivalPanel!: RivalPanelHandle;
  private minimap!: MinimapHandle;
  private tutorial!: TutorialHandle;
  private divineEffects!: DivineEffects;
  private unifiedSettings!: SettingsHandle;
  // Legacy components
  private llmDisplay: LlmDisplayHandle;
  private llmClient!: LLMClient;
  private llmBackfill!: LlmBackfillService;
  private tooltip: HTMLDivElement;
  private placementModal: DecorationPlacementModalHandle;
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
  private llmSettingsBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, _options: GameOptions = {}) {
    this.container = container;
    this.state = createState();

    this.scheduler = new Scheduler();
    this.scheduler.register(new NpcMovementSystem(() => this.state.map));
    // Order: settlement events affect needs → NpcSimSystem decays needs + recomputes mood
    // → activity system picks activities from needs → belief propagation → spirits
    this.scheduler.register(new SettlementEventSystem());
    this.scheduler.register(new NpcSimSystem());
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

    this.pausedBanner = document.createElement('div');
    this.pausedBanner.textContent = 'PAUSED';
    this.pausedBanner.style.cssText = [
      'position:absolute', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'padding:6px 14px', 'background:rgba(0,0,0,0.65)', 'color:#fff',
      'font:bold 14px sans-serif', 'letter-spacing:2px', 'border-radius:4px',
      'pointer-events:none', 'display:none', 'z-index:10',
    ].join(';');
    container.appendChild(this.pausedBanner);

    this.debugHud = document.createElement('div');
    this.debugHud.style.cssText = [
      'position:absolute', 'top:8px', 'right:8px',
      'padding:4px 8px', 'background:rgba(0,0,0,0.6)', 'color:#9fd8ff',
      'font:11px ui-monospace,monospace', 'border-radius:3px',
      'pointer-events:none', 'display:none', 'z-index:10',
      'white-space:nowrap',
    ].join(';');
    container.appendChild(this.debugHud);

    this.npcInfoPanel = document.createElement('div');
    this.npcInfoPanel.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px', 'width:220px',
      'padding:10px 12px', 'background:rgba(10,10,20,0.88)',
      'border:1px solid rgba(255,255,255,0.18)', 'border-radius:6px',
      'color:#fff', 'pointer-events:none', 'display:none', 'z-index:10',
      'box-sizing:border-box',
    ].join(';');
    container.appendChild(this.npcInfoPanel);

    // LLM display (shows dialogue/narration from LLM backfill)
    this.llmDisplay = createLlmDisplay(container, {
      onClose: () => {
        // Optional: do something when LLM display is closed
      },
    });

    this.llmBackfill = new LlmBackfillService({
      state: this.state,
      llmDisplay: this.llmDisplay,
      client: this.llmClient,
      onWriteback: () => this.renderer.forceInfoRefresh(),
    });

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = [
      'position:absolute', 'padding:3px 8px',
      'background:rgba(10,10,20,0.85)', 'color:#fff',
      'font:11px sans-serif', 'border-radius:3px',
      'pointer-events:none', 'display:none', 'z-index:11',
      'white-space:nowrap', 'transform:translate(12px, 12px)',
    ].join(';');
    container.appendChild(this.tooltip);

    // ── Unified Settings (replaces old settings) ────────────
    this.unifiedSettings = createUnifiedSettings(container, {
      onClose: () => { /* handle close */ },
      onLLMConfigChange: (config) => {
        // Update LLM client config
        console.log('[settings] LLM config changed:', config);
      },
      onGameSettingChange: (key, value) => {
        if (key === 'showLabels') this.state.showLabels = value as boolean;
        if (key === 'showPoiMarkers') this.state.showPoiMarkers = value as boolean;
        if (key === 'debug') {
          this.state.debug = value as boolean;
          this.debugHud.style.display = this.state.debug ? 'block' : 'none';
        }
      },
    });

    // ── NEW: Main Menu ────────────────────────────────────
    this.mainMenu = createMainMenu(this.container, {
      onStart: () => {
        if (!this.state.map) {
          void this.generateWorld();
        }
      },
      onSettings: () => this.unifiedSettings.toggle(),
      version: '1.0.0',
    });

    // ── NEW: Tutorial System ──────────────────────────────
    this.tutorial = createTutorial(this.container, {
      onComplete: () => {
        localStorage.setItem('small-gods-tutorial-seen', 'true');
        console.log('[tutorial] Completed');
      },
      onSkip: () => {
        localStorage.setItem('small-gods-tutorial-seen', 'true');
        console.log('[tutorial] Skipped');
      },
    });

    // ── NEW: Spirit HUD ───────────────────────────────────
    this.spiritHud = createSpiritHud(this.container, {
      onSelectRival: (rivalId) => {
        const rival = this.state.spirits.get(rivalId);
        if (rival && this.state.world) {
          // Find competing NPCs (simplified - get first few NPCs)
          const entities = this.state.world.query({ kind: 'npc' }).slice(0, 5);
          const npcSimStates = entities.map(e => simStateFromEntity(e) as any);
          this.rivalPanel.update(rival as any, npcSimStates);
          this.rivalPanel.show();
        }
      },
    });
    this.spiritHud.hide(); // Hidden until world gen

    // ── NEW: Rival Panel ───────────────────────────────────
    this.rivalPanel = createRivalPanel(this.container, {
      onClose: () => { /* panel handles hide internally */ },
      onTargetNpc: (npcId) => {
        this.state.selectedNpcId = npcId;
      },
    });

    // ── NEW: Minimap ──────────────────────────────────────
    this.minimap = createMinimapPanel(this.container, {
      onToggle: (visible) => {
        console.log('[minimap] visible:', visible);
      },
      onClickTile: (x, y) => {
        // Move camera to tile
        const cam = this.state.camera;
        cam.x = x * TILE_SIZE - (this.canvas.width / devicePixelRatio) / 2;
        cam.y = y * TILE_SIZE - (this.canvas.height / devicePixelRatio) / 2;
      },
    });

    // ── NEW: Divine Effects ────────────────────────────────
    this.divineEffects = new DivineEffects();
    this.divine = new DivineActionsController({ state: this.state, divineEffects: this.divineEffects });
    this.divine.register(this.dispatcher);

    this.dev = new DevModeController({
      container: this.container, state: this.state, scheduler: this.scheduler,
      getViewport: () => this.viewport(), getRenderDeps: () => this.renderDeps(),
    });

    this.renderer = new FrameRenderer({
      ctx: this.ctx, state: this.state,
      ui: { minimap: this.minimap, spiritHud: this.spiritHud, divineEffects: this.divineEffects,
            npcInfoPanel: this.npcInfoPanel, tooltip: this.tooltip, debugHud: this.debugHud },
      divine: this.divine, dev: this.dev, llmBackfill: this.llmBackfill,
      interaction: this.interaction,
      getRenderDeps: () => this.renderDeps(), getViewport: () => this.viewport(),
      renderMap: () => this.renderMap,
      isPaused: () => this.scheduler.getRate() === 0,
    });

    // LLM settings button
    this.llmSettingsBtn = document.createElement('button');
    this.llmSettingsBtn.textContent = '⚙ LLM';
    this.llmSettingsBtn.style.cssText = [
      'position:absolute', 'bottom:8px', 'left:8px',
      'background:rgba(10,10,20,0.75)', 'color:#9ea0aa', 'border:none',
      'cursor:pointer', 'z-index:10',
    ].join(';');
    this.llmSettingsBtn.addEventListener('click', () => {
      this.unifiedSettings.toggle();
    });
    container.appendChild(this.llmSettingsBtn);

    // OLD: this.settingsPanel = createSettingsPanel(container); // REPLACED by unifiedSettings
    this.placementModal = createDecorationPlacementModal(container);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.onTileClick(x, y),
      onCanvasClick: (sx, sy) => this.onCanvasClick(sx, sy),
      onTileRightClick: (x, y) => void this.onTileRightClick(x, y),
      onRightClick: (sx, sy) => void this.dev.handleRightClick(sx, sy),
      onTogglePause: () => this.togglePause(),
      onToggleLabels: () => { this.state.showLabels = !this.state.showLabels; },
      onTogglePoiMarkers: () => { this.state.showPoiMarkers = !this.state.showPoiMarkers; },
      onToggleDebug: () => {
        this.state.debug = !this.state.debug;
        this.debugHud.style.display = this.state.debug ? 'block' : 'none';
        // Sync with unified settings
        this.unifiedSettings.updateGameSetting('debug', this.state.debug);
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
      onToggleSettings: () => this.unifiedSettings.toggle(),
      onToggleMinimap: () => this.minimap?.toggle(),
      onShowTutorial: () => this.tutorial?.show('welcome'),
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
    this.pausedBanner.style.display = this.scheduler.getRate() === 0 ? 'block' : 'none';
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
    const ws = worldSeed || await WorldManager.loadDefault();
    const seed = Date.now();

    const { map, world } = await generateWithNoise(
      ws.size.width, ws.size.height, seed, ws,
      { onProgress: (msg) => console.log('[terrain]', msg) },
    );

    this.state.map = map;
    this.state.worldSeed = ws;
    this.state.world = world;
    this.state.visualMap = Autotiler.computeVisualMap(map);
    this.state.blobMap = computeBlobMap(map.tiles, map.width, map.height);
    await this.assets.loadAll();

    centerOn(
      this.state.camera,
      (map.width  * TILE_SIZE) / 2,
      (map.height * TILE_SIZE) / 2,
      this.canvas.width  / devicePixelRatio,
      this.canvas.height / devicePixelRatio,
    );

    // In iso mode the camera coordinate space is different - recentre
    if (readRenderMode() === 'iso') {
      const { centerOnTile } = await import('@/render/iso/iso-camera');
      centerOnTile(
        this.state.camera,
        Math.floor(map.width / 2),
        Math.floor(map.height / 2),
        this.canvas.width  / devicePixelRatio,
        this.canvas.height / devicePixelRatio,
      );
    }

    seedWorld({
      world: this.state.world!,
      log: this.state.eventLog,
      clock: this.state.clock,
      spirits: this.state.spirits,
      rng: this.state.rng,
      worldSeed: ws,
      map,
      oracle: identityOracle,
    });
    this.kickOffNpcSpritesheets();
    this.state.generatedDecorations = loadDecorations(ws.name);
    // Kick off image preloading; missing ids resolve to null and the renderer
    // falls back to placeholder squares until the load completes.
    void this.decorationImages.preload(this.state.generatedDecorations.map(d => d.assetId));
    
    // NEW: Hide main menu, show game UI
    this.mainMenu.hide();
    this.spiritHud.show();
    
    // Show tutorial on first visit
    if (!localStorage.getItem('small-gods-tutorial-seen')) {
      setTimeout(() => this.tutorial.show('welcome'), 500);
    }
    
    // Update World Inspector with new world data
    this.dev.updateWorldInspector();

    this.startLoop();
    return map;
  }

  private async onTileRightClick(tileX: number, tileY: number): Promise<void> {
    const map = this.state.map;
    if (!map) return;
    if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
    const tile = map.tiles[tileY]?.[tileX];
    if (!tile || !tile.walkable) return;

    // Check if this tile belongs to a POI
    let poiId: string | undefined;
    if (this.state.worldSeed) {
      for (const poi of this.state.worldSeed.pois) {
        if (poi.position && poi.position.x === tileX && poi.position.y === tileY) {
          poiId = poi.id;
          break;
        }
      }
    }

    if (poiId) {
      // Show POI overlay for Omen/Miracle
      this.interaction.poiOverlay = { poiId, tileX, tileY };
      return;
    }

    const result = await this.placementModal.open({ x: tileX, y: tileY });
    if (!result) return;
    const placement = { tileX, tileY, assetId: result.assetId };
    this.state.generatedDecorations = [...this.state.generatedDecorations, placement];
    if (this.state.worldSeed) {
      saveDecorations(this.state.worldSeed.name, this.state.generatedDecorations);
    }
    void this.decorationImages.load(result.assetId);
  }

  private kickOffNpcSpritesheets(): void {
    if (!this.state.world) return;
    for (const e of this.state.world.query({ kind: 'npc' })) {
      if (this.sheets.has(e.id)) continue;
      const p = npcProps(e);
      const spec = buildCharacterSpec(p.role, p.seed);
      getOrGenerateSheet(spec).then(canvas => {
        if (canvas) this.sheets.set(e.id, canvas);
      });
    }
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

  private onCanvasClick(sx: number, sy: number): boolean {
    // Clear POI overlay if clicking elsewhere
    this.interaction.poiOverlay = null;
    return this.dispatcher.tryDispatch(sx, sy, this.interaction.overlayHitAreas);
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map || !this.state.world) return;
    // Clear POI overlay on any left-click
    this.interaction.poiOverlay = null;

    const clicked = this.state.world.query({ kind: 'npc' })
      .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (clicked) {
      this.state.selectedNpcId = this.state.selectedNpcId === clicked.id ? null : clicked.id;
      if (this.state.pinnedNpcId && this.state.pinnedNpcId !== this.state.selectedNpcId) {
        this.state.pinnedNpcId = null;
      }
    } else if (!this.state.pinnedNpcId) {
      this.state.selectedNpcId = null;
    }
  }

  destroy(): void {
    this.stopLoop();
    this.cleanupControls?.();
    this.cleanupTokens?.();
    this.cleanupRenderToggle?.();
    this.resizeObserver.disconnect();
    this.pausedBanner.remove();
    this.debugHud.remove();
    this.npcInfoPanel.remove();
    this.tooltip.remove();
    this.llmSettingsBtn.remove();
    this.unifiedSettings.destroy();
    this.placementModal.destroy();
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


