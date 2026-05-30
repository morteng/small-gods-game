import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { selectRenderer, toggleRenderMode, readRenderMode, type RenderFn } from '@/render/select-renderer';
import { centerOn } from '@/render/camera';
import { attachControls, attachTimeKeys } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions, Entity, NpcSimState, NpcProperties, UndoAction, DevModeState, HitResult, Tile } from '@/core/types';
import { FRAME_MS } from '@/render/npc-animator';
import { drawNpcOverlay, drawPoiOverlay, type OverlayHitAreas } from '@/render/sim-overlay';
import { whisper, omen, dream, miracle, answerPrayer } from '@/sim/divine-actions';
import { buildNpcPrompt, type BuiltPrompt, type NpcPromptContext } from '@/llm/npc-prompt-builder';
import { applyLLMWriteback, type LLMResponse } from '@/llm/state-writeback';
import { LLMClient, MockLLMProvider } from "@/llm/llm-client";
import { createProvider, type ProviderConfig, loadProviderConfig } from '@/llm/provider-factory';
import type { SettlementEventType } from '@/core/types';
import { getRecentEventDescriptions } from '@/world/npc-helpers';
import { initNpcProps, getNpc, toRenderNpc, npcProps } from '@/world/npc-helpers';
import { OverlayDispatcher } from '@/ui/overlay-dispatcher';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { drawPowerHud } from '@/render/hud';
import { formatDebugHud } from '@/ui/debug-hud';
import { renderNpcInfoPanel } from '@/ui/npc-info-panel';
import { formatNpcTooltip } from '@/ui/npc-tooltip';
// NEW: Import unified settings and new UI components
import { createSettingsPanel as createUnifiedSettings, type SettingsHandle } from '@/ui/settings-unified';
import { createMainMenu, type MainMenuHandle } from '@/ui/main-menu';
import { createSpiritHud, type SpiritHudHandle } from '@/ui/spirit-hud';
import { createRivalPanel, type RivalPanelHandle } from '@/ui/rival-panel';
import { createMinimapPanel, type MinimapHandle } from '@/ui/minimap-panel';
import { createTutorial, type TutorialHandle } from '@/ui/tutorial';
import { DivineEffects } from '@/render/divine-effects';
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
import { SpiritSystem, POWER_REGEN_RATE } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { seedWorld } from '@/world/seed-world';
import { injectTokens } from '@/ui/inject-tokens';
import { mountChrome, mountPastVeil, type ChromeHandle } from '@/ui/chrome';
import { mountTimeChip, type TimeChipHandle } from '@/ui/panels/time-chip';
import { mountTimeBar, type TimeBarHandle } from '@/ui/panels/time-bar';
import { createDevMode, toggleDevMode } from '@/dev/DevMode';
import { hitTest } from '@/dev/hit-tester';
import { mountInspectorPanel, type InspectorPanelHandle } from '@/dev/InspectorPanel';
import { mountTimeDebugPanel, type TimeDebugPanelHandle } from '@/dev/TimeDebugPanel';
import { mountDebugOverlayPanel, type DebugOverlayPanelHandle } from '@/dev/DebugOverlayPanel';
import { mountWorldInspector, type WorldInspectorHandle } from '@/dev/WorldInspector';
import { createEntitySpawner, type EntitySpawnerHandle } from '@/dev/EntitySpawner';
import { mountMapEditorPanel, type MapEditorPanelHandle } from '@/dev/MapEditorPanel';
import { formatDevTooltip } from '@/dev/tooltip';
import { drawDebugOverlays, DEFAULT_DEBUG_OVERLAY_OPTIONS } from '@/render/debug-overlays';
import { buildRenderContext, type RenderContextDeps } from '@/game/render-context';

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
  private overlayHitAreas: OverlayHitAreas = [];
  private poiOverlay: { poiId: string; tileX: number; tileY: number } | null = null;
  private lastWhisperTime: number = -Infinity;
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
  private renderedNpcId: string | null = null;
  private renderedPinned: boolean = false;
  private lastInfoRefresh: number = 0;
  private hoverTile: { x: number; y: number } | null = null;
  private hoverScreen: { x: number; y: number } | null = null;
  private llmClient!: LLMClient;
  private fpsEma: number = 60;
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
  private devMode!: DevModeState;
  private inspectorPanel!: InspectorPanelHandle;
  private debugOverlayPanel!: DebugOverlayPanelHandle;
  private entitySpawner!: EntitySpawnerHandle;
  private timeDebugPanel!: TimeDebugPanelHandle;
  private mapEditorPanel!: MapEditorPanelHandle;
  private worldInspector!: WorldInspectorHandle;
  private llmSettingsBtn!: HTMLButtonElement;
  private devModeBtn!: HTMLButtonElement;
  private devModeCleanup: (() => void) | null = null;

  constructor(container: HTMLElement, _options: GameOptions = {}) {
    this.container = container;
    this.state = createState();

    this.dispatcher.register('whisper', (payload) => {
      const p = payload as { npcId: string };
      if (!this.state.world) return false;
      const e = getNpc(this.state.world, p.npcId);
      const player = this.state.spirits.get('player')!;
      if (e && whisper(player, e, this.state.eventLog)) {
        this.lastWhisperTime = performance.now();
        return true;
      }
      return false;
    });

    this.dispatcher.register('omen', (payload) => {
      const p = payload as { poiId: string };
      if (!this.state.world) return false;
      const player = this.state.spirits.get('player')!;
      return omen(player, p.poiId, this.state.world, this.state.eventLog);
    });

    this.dispatcher.register('dream', (payload) => {
      const p = payload as { npcId: string };
      if (!this.state.world) return false;
      const e = getNpc(this.state.world, p.npcId);
      const player = this.state.spirits.get('player')!;
      if (e && dream(player, e, this.state.eventLog)) {
        return true;
      }
      return false;
    });

    this.dispatcher.register('miracle', (payload) => {
      const p = payload as { poiId: string };
      if (!this.state.world) return false;
      const player = this.state.spirits.get('player')!;
      return miracle(player, p.poiId, this.state.world, this.state.eventLog);
    });

    this.dispatcher.register('answer_prayer', (payload) => {
      const p = payload as { npcId: string };
      if (!this.state.world) return false;
      const e = getNpc(this.state.world, p.npcId);
      const player = this.state.spirits.get('player')!;
      if (e && answerPrayer(player, e, this.state.eventLog)) {
        return true;
      }
      return false;
    });

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

    // ── Dev Mode Toggle Button ────────────────────────────
    this.devModeBtn = document.createElement('button');
    this.devModeBtn.type = 'button';
    this.devModeBtn.title = 'Toggle Dev Mode';
    this.devModeBtn.textContent = '🔧 Dev';
    this.devModeBtn.style.cssText = [
      'all:unset', 'position:absolute', 'bottom:8px', 'right:120px',
      'padding:5px 10px', 'background:rgba(10,10,20,0.75)', 'color:#9fd8ff',
      'border:1px solid rgba(255,255,255,0.15)', 'border-radius:4px',
      'font:11px sans-serif', 'cursor:pointer', 'z-index:10',
    ].join(';');
    this.devModeBtn.addEventListener('mouseenter', () => {
      this.devModeBtn.style.background = 'rgba(20,20,32,0.92)';
    });
    this.devModeBtn.addEventListener('mouseleave', () => {
      this.devModeBtn.style.background = 'rgba(10,10,20,0.75)';
    });
    this.devModeBtn.addEventListener('click', () => this.onToggleDevMode());
    container.appendChild(this.devModeBtn);

    // ── Dev Mode Panels ───────────────────────────────────
    this.inspectorPanel = mountInspectorPanel(this.container, {
      onDelete: () => this.deleteSelectedEntity(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
    });
    this.inspectorPanel.setOnChange((hit, key, value) => this.applyInspectorEdit(hit, key, value));
    this.debugOverlayPanel = mountDebugOverlayPanel(this.container);
    this.timeDebugPanel = mountTimeDebugPanel(this.container, {
      clock: this.state.clock,
      scheduler: this.scheduler,
      eventLog: this.state.eventLog,
    });
    this.entitySpawner = createEntitySpawner(this.container);

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
    this.mapEditorPanel = mountMapEditorPanel(this.container, {
      onPaintTile: (x, y, tileType) => this.paintTile(x, y, tileType),
    });

    // ── Dev Mode: World Inspector ──────────────────────
    this.worldInspector = mountWorldInspector(container);
    // Wire camera focus callback
    this.worldInspector.setCameraFocusCallback((x, y) => {
      const cam = this.state.camera;
      cam.x = x * TILE_SIZE - (this.canvas.width / devicePixelRatio) / 2;
      cam.y = y * TILE_SIZE - (this.canvas.height / devicePixelRatio) / 2;
    });

    // OLD: this.settingsPanel = createSettingsPanel(container); // REPLACED by unifiedSettings
    this.placementModal = createDecorationPlacementModal(container);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.onTileClick(x, y),
      onCanvasClick: (sx, sy) => this.onCanvasClick(sx, sy),
      onTileRightClick: (x, y) => void this.onTileRightClick(x, y),
      onRightClick: (sx, sy) => this.onRightClick(sx, sy),
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
        this.hoverTile = { x, y };
        this.hoverScreen = { x: sx, y: sy };
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

    // ── Dev Mode ──────────────────────────────────────────────
    this.devMode = createDevMode();
    this.attachDevKeyboardShortcuts();
  }


  private attachDevKeyboardShortcuts(): void {
    const handler = (e: KeyboardEvent) => {
      if (!this.devMode.enabled) return;
      // Ctrl+Shift+D toggles dev mode
      if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        this.onToggleDevMode();
        return;
      }
      // Ctrl+Shift+I: Toggle World Inspector
      if (e.ctrlKey && e.shiftKey && e.code === "KeyI") {
        e.preventDefault();
        if (this.worldInspector) {
          if (this.worldInspector.isVisible()) {
            this.worldInspector.hide();
          } else {
            this.worldInspector.show();
            // Update with current state
            this.worldInspector.update(
              this.state.world,
              this.state.map,
              this.state.spirits,
              this.state.generatedDecorations
            );
          }
        }
        return;
      }

      // Ctrl+Z: Undo
      if (e.ctrlKey && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        this.undo();
        return;
      }
      // Ctrl+Shift+Z or Ctrl+Y: Redo
      if ((e.ctrlKey && e.shiftKey && e.code === "KeyZ") || (e.ctrlKey && e.code === "KeyY")) {
        e.preventDefault();
        this.redo();
        return;
      }
      // Delete/Backspace: Delete selected entity
      if ((e.code === "Delete" || e.code === "Backspace") && this.devMode.selected) {
        e.preventDefault();
        this.deleteSelectedEntity();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    this.devModeCleanup = () => window.removeEventListener("keydown", handler);
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

  /** Toggle dev mode on/off */
  private onToggleDevMode(): void {
    const enabled = toggleDevMode(this.devMode);
    console.log(`[dev] mode ${enabled ? 'enabled' : 'disabled'}`);
    // Update button appearance
    if (enabled) {
      this.devModeBtn.style.background = 'rgba(255, 215, 0, 0.75)';
      this.devModeBtn.style.color = '#000';
      this.devModeBtn.textContent = '🔧 Dev ON';
      // Initialize debug overlay options if not set
      if (this.devMode.showBeliefHeatmap === undefined) {
        Object.assign(this.devMode, DEFAULT_DEBUG_OVERLAY_OPTIONS);
      }
    } else {
      this.devModeBtn.style.background = 'rgba(10,10,20,0.75)';
      this.devModeBtn.style.color = '#9fd8ff';
      this.devModeBtn.textContent = '🔧 Dev';
      this.devMode.selected = null;
      this.inspectorPanel.update(null, this.devMode);
      this.debugOverlayPanel.update(this.devMode);
    }
  }

  /** Handle right-click on canvas for dev mode hit-testing */
  private async onRightClick(sx: number, sy: number): Promise<void> {
    if (!this.devMode.enabled) return;
    if (!this.state.map || !this.state.world) return;

    const rc = buildRenderContext(this.renderDeps());

    const hit = hitTest(rc, sx, sy);

    if (hit.type === null) {
      // No entity under cursor - offer to spawn new entity
      const spawnOpts = await this.entitySpawner.open(hit.tileX, hit.tileY);
      if (spawnOpts) {
        this.spawnEntity(spawnOpts);
      }
      return;
    }

    this.devMode.selected = hit;
    this.inspectorPanel.update(hit, this.devMode);
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
      devMode: this.devMode,
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
    if (this.worldInspector) {
      this.worldInspector.update(
        this.state.world,
        this.state.map,
        this.state.spirits,
        this.state.generatedDecorations
      );
    }
    
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
      this.poiOverlay = { poiId, tileX, tileY };
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

  private updateNpcFrames(deltaMs: number): void {
    if (!this.state.world) return;
    for (const e of this.state.world.query({ kind: 'npc' })) {
      const p = e.properties as unknown as NpcProperties;
      p.frameTimer += deltaMs;
      if (p.frameTimer >= FRAME_MS) {
        p.frameTimer -= FRAME_MS;
        p.frame = (p.frame % 8) + 1;
      }
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();

    const loop = (now: number) => {
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      if (deltaMs > 0) {
        const instantFps = 1000 / deltaMs;
        this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
      }
      if (this.scheduler.getRate() > 0 && this.state.world && !this.timeline.isScrubbed) {
        this.updateNpcFrames(deltaMs);  // presentation animation - not a scheduled system
        this.scheduler.tick(deltaMs, {
          world: this.state.world,
          spirits: this.state.spirits,
          log: this.state.eventLog,
          clock: this.state.clock,
          rng: this.state.rng,
        });
        this.timeline.onAfterLiveTick();
      }
      this.applyFollowCamera();
      this.render(deltaMs);
      this.timeChip.refresh();
      this.refreshPauseBanner();
      this.timeBar?.refresh();
      this.updateTimeDebugPanel();
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

  render(deltaMs: number): void {
    if (!this.state.map) return;
    const rc = buildRenderContext(this.renderDeps());
    if (this.renderMap) this.renderMap(this.ctx, rc);

    // NEW: Update and render divine effects
    if (this.divineEffects) {
      this.divineEffects.update(deltaMs);
      this.divineEffects.render(this.ctx as any, this.state.camera, TILE_SIZE);
    }

    // NEW: Update minimap when visible
    if (this.minimap && this.minimap.isVisible() && this.state.map) {
      const npcs = this.state.world?.query({ kind: 'npc' }).map(toRenderNpc) ?? [];
      this.minimap.update(
        this.state.map,
        npcs,
        this.state.camera,
        rc.canvasWidth,
        rc.canvasHeight,
      );
    }

    // NEW: Update Spirit HUD
    if (this.spiritHud && this.spiritHud.isVisible() && this.state.world) {
      const player = this.state.spirits.get('player')!;
      const rivals = Array.from(this.state.spirits.entries())
        .filter(([id]) => id !== 'player')
        .map(([, spirit]) => spirit);
      
      let totalFollowers = 0;
      for (const npc of this.state.world.query({ kind: 'npc' })) {
        const p = npc.properties as unknown as NpcProperties;
        if ((p.beliefs['player']?.faith ?? 0) > 0.3) totalFollowers++;
      }
      
      this.spiritHud.update(player, rivals as any[], totalFollowers);
    }

    // Draw debug overlays if dev mode is enabled
    if (this.devMode.enabled) {
      const debugOpts = {
        showBeliefHeatmap: !!this.devMode.showBeliefHeatmap,
        showNeeds: !!this.devMode.showNeeds,
        showMood: !!this.devMode.showMood,
        showSocialConnections: !!this.devMode.showSocialConnections,
        beliefThreshold: this.devMode.beliefThreshold ?? 0.3,
        selectedSpiritId: this.devMode.selectedSpiritId ?? null,
      };
      drawDebugOverlays(this.ctx, this.state.camera, this.state.world!, rc.npcs, debugOpts);
      // Update the debug overlay panel
      this.debugOverlayPanel.update(this.devMode);
    }

    // Gold flash when a whisper was just cast
    const flashAge = performance.now() - this.lastWhisperTime;
    if (flashAge < 300) {
      const alpha = 0.25 * (1 - flashAge / 300);
      this.ctx.fillStyle = `rgba(255, 215, 0, ${alpha.toFixed(3)})`;
      this.ctx.fillRect(0, 0, rc.canvasWidth, rc.canvasHeight);
    }

    if (this.state.selectedNpcId && this.state.world) {
      const entity = getNpc(this.state.world, this.state.selectedNpcId);
      if (entity) {
        const npc = toRenderNpc(entity);
        const sim = simStateFromEntity(entity);
        const player = this.state.spirits.get('player')!;
        this.overlayHitAreas = drawNpcOverlay(
          this.ctx, npc, sim, this.state.camera,
          rc.canvasWidth, rc.canvasHeight,
          player.power,
        );

        // POI overlay (right-click on POI)
        if (this.poiOverlay && this.state.world) {
          const { poiId, tileX, tileY } = this.poiOverlay;
          const poiAreas = drawPoiOverlay(
            this.ctx, poiId, tileX, tileY, this.state.camera,
            rc.canvasWidth, rc.canvasHeight, player.power,
          );
          this.overlayHitAreas = [...this.overlayHitAreas, ...poiAreas];
        }

        const now = performance.now();
        const pinned = this.state.pinnedNpcId === sim.npcId;
        const switched = this.renderedNpcId !== sim.npcId;
        const pinChanged = this.renderedPinned !== pinned;
        if (switched || pinChanged || now - this.lastInfoRefresh > 500) {
          renderNpcInfoPanel(this.npcInfoPanel, sim, {
            pinned,
            power: player.power,
            onTogglePin: () => {
              this.state.pinnedNpcId = this.state.pinnedNpcId === sim.npcId ? null : sim.npcId;
              this.lastInfoRefresh = 0;
            },
            onWhisper: () => {
              if (whisper(player, entity, this.state.eventLog)) {
                this.lastWhisperTime = performance.now();
                // NEW: Trigger divine effect
                this.divineEffects.trigger('whisper', entity.x, entity.y);
              }
            },
            onDream: () => {
              dream(player, entity, this.state.eventLog);
              this.divineEffects.trigger('dream', entity.x, entity.y);
            },
            onAnswerPrayer: () => {
              answerPrayer(player, entity, this.state.eventLog);
            },
            onOmen: () => {
              const p = npcProps(entity);
              if (p.homePoiId) {
                omen(player, p.homePoiId, this.state.world!, this.state.eventLog);
                // NEW: Trigger omen effect at POI location
                const poi = this.state.worldSeed?.pois.find(poi => poi.id === p.homePoiId);
                if (poi?.position) {
                  this.divineEffects.trigger('omen', poi.position.x, poi.position.y);
                }
              }
            },
            onMiracle: () => {
              const p = npcProps(entity);
              if (p.homePoiId) {
                miracle(player, p.homePoiId, this.state.world!, this.state.eventLog);
                // NEW: Trigger miracle effect at POI location
                const poi = this.state.worldSeed?.pois.find(poi => poi.id === p.homePoiId);
                if (poi?.position) {
                  this.divineEffects.trigger('miracle', poi.position.x, poi.position.y);
                }
              }
            },
            onLlmBackfill: async () => {
              await this.triggerLlmBackfill(entity);
            },
          });
          this.renderedNpcId = sim.npcId;
          this.renderedPinned = pinned;
          this.lastInfoRefresh = now;
        }
        this.npcInfoPanel.style.display = 'block';
      }
    } else {
      this.overlayHitAreas = [];
      this.npcInfoPanel.style.display = 'none';
      this.renderedNpcId = null;
    }

    const player = this.state.spirits.get('player')!;
    // Per-second regen estimate for HUD
    let totalFaith = 0;
    if (this.state.world) {
      for (const e of this.state.world.query({ kind: 'npc' })) {
        const p = e.properties as unknown as NpcProperties;
        totalFaith += p.beliefs['player']?.faith ?? 0;
      }
    }
    const regenPerSec = totalFaith * POWER_REGEN_RATE;
    drawPowerHud(this.ctx, player.power, regenPerSec);

    this.updateTooltip();

    if (this.state.debug) {
      this.debugHud.textContent = formatDebugHud({
        fps: this.fpsEma,
        mouseTile: this.hoverTile,
        entityCount: this.state.world?.query({}).length ?? 0,
        npcCount: this.state.world?.query({ kind: 'npc' }).length ?? 0,
        paused: this.scheduler.getRate() === 0,
        zoom: this.state.camera.zoom,
      });
    }
  }

  private applyFollowCamera(): void {
    if (!this.state.followNpc || !this.state.selectedNpcId || !this.state.world) return;
    const e = getNpc(this.state.world, this.state.selectedNpcId);
    if (!e) { this.state.followNpc = false; return; }
    const cam = this.state.camera;
    const viewW = this.canvas.width  / devicePixelRatio / cam.zoom;
    const viewH = this.canvas.height / devicePixelRatio / cam.zoom;
    const targetX = (e.x + 0.5) * TILE_SIZE - viewW / 2;
    const targetY = (e.y + 0.5) * TILE_SIZE - viewH / 2;
    cam.x += (targetX - cam.x) * 0.15;
    cam.y += (targetY - cam.y) * 0.15;
  }

  private updateTooltip(): void {
    if (!this.hoverTile || !this.hoverScreen || !this.state.world) {
      this.tooltip.style.display = 'none';
      return;
    }

    // In dev mode: show tooltips for ALL objects (tiles, entities, NPCs, decorations)
    if (this.devMode.enabled) {
      const rc = buildRenderContext(this.renderDeps());

      const hit = hitTest(rc, this.hoverScreen.x, this.hoverScreen.y);
      if (hit.type === null) {
        this.tooltip.style.display = 'none';
        return;
      }
      this.tooltip.textContent = formatDevTooltip(hit);
      this.tooltip.style.left = `${this.hoverScreen.x}px`;
      this.tooltip.style.top  = `${this.hoverScreen.y}px`;
      this.tooltip.style.display = 'block';
      return;
    }

    // Normal mode: only show NPC tooltips
    const { x, y } = this.hoverTile;
    const hovered = this.state.world.query({ kind: 'npc' })
      .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
    if (!hovered || hovered.id === this.state.selectedNpcId) {
      this.tooltip.style.display = 'none';
      return;
    }
    const p = hovered.properties as unknown as NpcProperties;
    this.tooltip.textContent = formatNpcTooltip({ name: p.name, role: p.role, mood: p.mood });
    this.tooltip.style.left = `${this.hoverScreen.x}px`;
    this.tooltip.style.top  = `${this.hoverScreen.y}px`;
    this.tooltip.style.display = 'block';
  }

  private onCanvasClick(sx: number, sy: number): boolean {
    // Clear POI overlay if clicking elsewhere
    this.poiOverlay = null;
    return this.dispatcher.tryDispatch(sx, sy, this.overlayHitAreas);
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map || !this.state.world) return;
    // Clear POI overlay on any left-click
    this.poiOverlay = null;

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

  // ── Dev Mode: Entity Spawning & Undo/Redo ─────────────────────

  /** Spawn a new entity from spawner options */
  private spawnEntity(opts: { kind: string; x: number; y: number; properties?: Record<string, unknown> }): void {
    if (!this.state.world) return;

    const id = `dev_${Date.now().toString(36)}`;
    const entity: Entity = {
      id,
      kind: opts.kind,
      x: opts.x,
      y: opts.y,
      properties: opts.properties ?? {},
      tags: ['dev_spawned'],
    };

    // Deep copy state for undo
    const undoAction: UndoAction = {
      type: 'entity_create',
      target: { tileX: opts.x, tileY: opts.y, entityId: id },
      before: null,
      after: JSON.parse(JSON.stringify(entity)),
    };

    try {
      this.state.world.addEntity(entity);
      this.devMode.undoStack.push(undoAction);
      this.devMode.redoStack = []; // Clear redo stack on new action
      console.log(`[dev] Spawned ${opts.kind} at (${opts.x}, ${opts.y}), id=${id}`);
    } catch (err) {
      console.error('[dev] Failed to spawn entity:', err);
    }
  }

  /**
   * Apply an edit from the Inspector property grid to the underlying state.
   * Records an undo action, mutates the world/map/decoration, and refreshes
   * the panel. The RAF loop redraws the canvas on the next frame.
   */
  private applyInspectorEdit(hit: HitResult, key: string, value: unknown): void {
    if (hit.type === 'entity' || hit.type === 'npc') {
      const id = hit.type === 'entity' ? (hit.entity as Entity | undefined)?.id : hit.npc?.id;
      if (!id || !this.state.world) return;
      const entity = this.state.world.query({}).find(e => e.id === id);
      if (!entity) return;

      const before = JSON.parse(JSON.stringify(entity));
      if (key === 'x' || key === 'y') {
        this.state.world.updateEntity(id, { [key]: Number(value) });
      } else if (key === 'kind') {
        this.state.world.updateEntity(id, { kind: String(value) });
      } else if (key === 'properties' && value && typeof value === 'object') {
        this.state.world.updateEntity(id, { properties: value as Record<string, unknown> });
      } else {
        // NPC sim/identity fields live in the properties bag.
        this.state.world.setProperty(id, key, value);
      }
      const after = this.state.world.query({}).find(e => e.id === id);
      this.pushUndo({
        type: 'entity_update',
        target: { tileX: Math.floor(entity.x), tileY: Math.floor(entity.y), entityId: id },
        before,
        after: after ? JSON.parse(JSON.stringify(after)) : null,
      });
    } else if (hit.type === 'tile') {
      const map = this.state.map;
      const tile = map?.tiles[hit.tileY]?.[hit.tileX];
      if (!tile) return;
      const before = { ...tile };
      (tile as unknown as Record<string, unknown>)[key] = value;
      this.pushUndo({
        type: 'tile_update',
        target: { tileX: hit.tileX, tileY: hit.tileY },
        before,
        after: { ...tile },
      });
    } else if (hit.type === 'decoration' && hit.decoration) {
      (hit.decoration as unknown as Record<string, unknown>)[key] = value;
    } else {
      return;
    }

    // Refresh the panel so committed values are reflected.
    this.inspectorPanel.update(this.devMode.selected, this.devMode);
  }

  /** Push an undo action and clear the redo stack. */
  private pushUndo(action: UndoAction): void {
    this.devMode.undoStack.push(action);
    this.devMode.redoStack = [];
  }

  /** Delete the currently selected entity */
  private deleteSelectedEntity(): void {
    if (!this.devMode.selected || !this.state.world) return;
    const hit = this.devMode.selected;
    if (hit.type === null) return;

    let entityId: string | undefined;
    if (hit.type === 'entity') entityId = (hit.entity as Entity)?.id;
    else if (hit.type === 'npc') entityId = hit.npc?.id;
    else if (hit.type === 'decoration') entityId = (hit.decoration as any)?.id;

    if (!entityId) return;

    const entity = this.state.world.query({}).find(e => e.id === entityId);
    if (!entity) return;

    // Save for undo
    const undoAction: UndoAction = {
      type: 'entity_delete',
      target: { tileX: Math.floor(entity.x), tileY: Math.floor(entity.y), entityId },
      before: JSON.parse(JSON.stringify(entity)),
      after: null,
    };

    this.state.world.removeEntity(entityId);
    this.devMode.undoStack.push(undoAction);
    this.devMode.redoStack = [];
    this.devMode.selected = null;
    this.inspectorPanel.update(null, this.devMode);
    console.log(`[dev] Deleted entity ${entityId}`);
  }

  /** Undo the last action */
  private undo(): void {
    if (this.devMode.undoStack.length === 0) return;
    const action = this.devMode.undoStack.pop()!;

    if (action.type === 'entity_create' && action.after) {
      // Undo spawn = remove entity
      this.state.world?.removeEntity(action.target.entityId!);
    } else if (action.type === 'entity_delete' && action.before) {
      // Undo delete = re-add entity
      this.state.world?.addEntity(action.before as Entity);
    } else if (action.type === 'entity_update' && action.before) {
      // Undo edit = restore the pre-edit snapshot
      this.restoreEntitySnapshot(action.target.entityId!, action.before as Entity);
    } else if (action.type === 'tile_update' && action.before) {
      this.restoreTileSnapshot(action.target.tileX, action.target.tileY, action.before as Partial<Tile>);
    }

    this.devMode.redoStack.push(action);
    this.refreshInspectorAfterHistory();
    console.log(`[dev] Undo: ${action.type} ${action.target.entityId}`);
  }

  /** Redo the last undone action */
  private redo(): void {
    if (this.devMode.redoStack.length === 0) return;
    const action = this.devMode.redoStack.pop()!;
    
    if (action.type === 'entity_create' && action.after) {
      // Redo spawn = add entity back
      this.state.world?.addEntity(action.after as Entity);
    } else if (action.type === 'entity_delete' && action.before) {
      // Redo delete = remove entity again
      this.state.world?.removeEntity(action.target.entityId!);
    } else if (action.type === 'entity_update' && action.after) {
      // Redo edit = re-apply the post-edit snapshot
      this.restoreEntitySnapshot(action.target.entityId!, action.after as Entity);
    } else if (action.type === 'tile_update' && action.after) {
      this.restoreTileSnapshot(action.target.tileX, action.target.tileY, action.after as Partial<Tile>);
    }

    this.devMode.undoStack.push(action);
    this.refreshInspectorAfterHistory();
    console.log(`[dev] Redo: ${action.type} ${action.target.entityId}`);
  }

  /** Restore an entity's full field set from an undo/redo snapshot. */
  private restoreEntitySnapshot(id: string, snapshot: Entity): void {
    if (!this.state.world) return;
    this.state.world.updateEntity(id, {
      kind: snapshot.kind,
      x: snapshot.x,
      y: snapshot.y,
      properties: snapshot.properties,
      tags: snapshot.tags,
    });
  }

  /** Restore a tile's fields from an undo/redo snapshot. */
  private restoreTileSnapshot(tx: number, ty: number, snapshot: Partial<Tile>): void {
    const tile = this.state.map?.tiles[ty]?.[tx];
    if (!tile) return;
    Object.assign(tile, snapshot);
  }

  /** After undo/redo, keep the Inspector in sync if a selection is showing. */
  private refreshInspectorAfterHistory(): void {
    if (this.devMode.selected) {
      this.inspectorPanel.update(this.devMode.selected, this.devMode);
    }
  }

  /** Trigger LLM backfill for an NPC — generates narration from sim state */
  private async triggerLlmBackfill(npcEntity: Entity): Promise<void> {
    if (!this.state.world) return;
    
    const props = npcProps(npcEntity);
    const player = this.state.spirits.get('player');
    if (!player) return;

    // Build prompt from NPC state
    const context: NpcPromptContext = {
      npc: npcEntity,
      world: this.state.world,
      recentEvents: getRecentEventDescriptions(props),
      previousInteractions: [], // TODO: track these
      nearbyNpcNames: this.getNearbyNpcNames(npcEntity, 3),
      activeEvents: this.getActiveEventsForPoi(props.homePoiId),
      playerSpiritId: 'player',
    };

    const prompt = buildNpcPrompt(context);
    console.log('[LLM] Built prompt (estimated', prompt.estimatedTokens, 'tokens):', prompt.user.slice(0, 200));

    // Use mock provider for now (replace with real LLM later)
    const client = new LLMClient(new MockLLMProvider(100)); // 100ms mock delay
    try {
      const response = await client.generateNpcBackfill(prompt.system, prompt.user, {
        maxTokens: 200,
        temperature: 0.7,
      });

      console.log('[LLM] Response:', response.content, `(${response.latencyMs}ms)`);

      // Apply writeback to sim state
      const writeback = applyLLMWriteback(npcEntity, this.parseLLMJson(response.content), 'player', this.state.eventLog);

      // Show narration/dialogue in UI
      if (writeback.narration && writeback.dialogue) {
        this.llmDisplay.showBoth(props.name, writeback.dialogue, writeback.narration);
      } else if (writeback.dialogue) {
        this.llmDisplay.showDialogue(props.name, writeback.dialogue);
      } else if (writeback.narration) {
        this.llmDisplay.showNarration(writeback.narration);
      }

      // Refresh the NPC info panel to show updated state
      this.lastInfoRefresh = 0;
    } catch (err) {
      console.error('[LLM] Backfill failed:', err);
    }
  }

  /** Parse LLM response, handling JSON or plain text */
  private parseLLMJson(content: string): LLMResponse {
    try {
      return JSON.parse(content);
    } catch {
      // Not JSON — treat as narration
      return { narration: content };
    }
  }

  /** Get names of NPCs near the given NPC */
  private getNearbyNpcNames(npc: Entity, radius: number): string[] {
    if (!this.state.world) return [];
    const nearby = this.state.world.query({
      region: { x: Math.floor(npc.x) - radius, y: Math.floor(npc.y) - radius, w: radius * 2 + 1, h: radius * 2 + 1 },
      kind: 'npc',
    });
    return nearby.filter(e => e.id !== npc.id).map(e => npcProps(e).name);
  }

  /** Get active events for a POI */
  private getActiveEventsForPoi(poiId?: string): SettlementEventType[] {
    if (!poiId || !this.state.world) return [];
    const events = this.state.world.activeEvents.get(poiId);
    return events?.map(e => e.type) ?? [];
  }
  /*
  // Old popup method - replaced by llmDisplay
  private showNarrationPopup(text: string): void {
    const popup = document.createElement('div');
    popup.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
      'background:rgba(0,0,0,0.9)', 'color:#fff', 'padding:16px 24px',
      'border-radius:8px', 'font:14px sans-serif', 'max-width:400px',
      'z-index:1000', 'pointer-events:none', 'text-align:center',
    ].join(';');
    popup.textContent = text;
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 3000); // 3s timeout
  }
  */

  /** Paint a tile on the map (dev mode) */
  private paintTile(x: number, y: number, tileType: string): void {
    if (!this.state.map) {
      console.warn('[dev] No map loaded');
      return;
    }
    const map = this.state.map;
    if (y >= 0 && y < map.tiles.length && x >= 0 && x < map.tiles[0].length) {
      const tile = map.tiles[y][x];
      const oldType = tile.type;
      tile.type = tileType;
      // Update walkable based on common tile types
      tile.walkable = !['water', 'mountain'].includes(tileType);
      console.log(`[dev] Painted tile (${x}, ${y}): ${oldType} → ${tileType}`);
    } else {
      console.warn(`[dev] Tile (${x}, ${y}) out of bounds`);
    }
  }

  private updateTimeDebugPanel(): void {
    if (!this.devMode?.enabled) return;
    this.timeDebugPanel?.update(this.state.clock, this.scheduler, this.state.eventLog);
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
    this.devModeBtn.remove();
    this.unifiedSettings.destroy();
    this.placementModal.destroy();
    this.decorationImages.destroy();
    this.detachTimeKeys?.();
    this.timeBar?.dispose();
    this.timeChip.dispose();
    this.veil.dispose();
    this.chrome.dispose();
    this.inspectorPanel.destroy();
    this.canvas.remove();
  }
}

// =============================================================================
// Entity → legacy-shape adapter (keeps overlay/info-panel code working until
// those are refactored to read NpcProperties directly)
// =============================================================================

function simStateFromEntity(e: Entity): NpcSimState {
  const p = e.properties as unknown as NpcProperties;
  return {
    npcId: e.id, name: p.name, role: p.role, personality: p.personality,
    beliefs: p.beliefs, needs: p.needs, mood: p.mood,
    recentEvents: [],  // legacy field; recentEventIds is the new home
    relationships: p.relationships,
    whisperCooldown: p.whisperCooldown,
    homeBuildingId: p.homeBuildingId, homePoiId: p.homePoiId,
    activity: p.activity,
  };
}

