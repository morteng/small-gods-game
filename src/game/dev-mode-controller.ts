import type { GameState } from '@/core/state';
import type { HitResult, Entity, UndoAction, DevModeState, RenderContext } from '@/core/types';
import type { Scheduler } from '@/core/scheduler';
import type { Viewport } from './viewport';
import type { RenderContextDeps } from './render-context';
import { createDevMode, toggleDevMode } from '@/dev/DevMode';
import { hitTest } from '@/dev/hit-tester';
import { mountInspector, type InspectorHandle } from '@/dev/inspector/Inspector';
import { mountTimeDebugPanel, type TimeDebugPanelHandle } from '@/dev/TimeDebugPanel';
import { mountDebugOverlayPanel, type DebugOverlayPanelHandle } from '@/dev/DebugOverlayPanel';
import { createEntitySpawner, type EntitySpawnerHandle } from '@/dev/EntitySpawner';
import { mountMapEditorPanel, type MapEditorPanelHandle } from '@/dev/MapEditorPanel';
import { DEFAULT_DEBUG_OVERLAY_OPTIONS, drawDebugOverlays } from '@/render/debug-overlays';
import { buildRenderContext } from './render-context';
import { applyUndo, applyRedo } from './dev-mode-history';
import { focusCameraOnTile } from '@/render/focus-camera';
import {
  drawSelectionOutline, drawHoverOutline, resolveOutlineRect, sameRect,
  fillTileRect, buildingFootprintAt,
} from '@/render/selection-outline';
import { selectionFromHit } from '@/dev/inspector/selection';
import { drawBiomeLayer, drawPoiLayer } from '@/render/map-layers';
import { createDockManager, type DockManager } from '@/dev/dock-manager';
import { DEV_UI_Z } from '@/dev/FloatingPanel';
import { mountDevToolbar, type DevToolbarHandle } from '@/dev/dev-toolbar';
import { mountCreatePanel, type CreatePanelHandle } from '@/dev/CreatePanel';
import { createRenderBenchPanel, type RenderBenchHandle } from '@/dev/RenderBenchPanel';
import type { CommandQueue } from '@/sim/command/command-queue';
import type { LLMClient } from '@/llm/llm-client';


export interface DevModeControllerDeps {
  container: HTMLElement;
  state: GameState;
  scheduler: Scheduler;
  getViewport: () => Viewport;
  getRenderDeps: () => RenderContextDeps;
  commandQueue: CommandQueue;
  getLlmCapable: () => LLMClient | null;
}

export class DevModeController {
  devMode: DevModeState = createDevMode();
  private btn!: HTMLButtonElement;
  private inspector!: InspectorHandle;
  private debugOverlay!: DebugOverlayPanelHandle;
  private timeDebug!: TimeDebugPanelHandle;
  private spawner!: EntitySpawnerHandle;
  private mapEditor!: MapEditorPanelHandle;
  private createPanel!: CreatePanelHandle;
  private renderBench!: RenderBenchHandle;
  private dock!: DockManager;
  private toolbar!: DevToolbarHandle;
  private detachKeys: (() => void) | null = null;

  constructor(private deps: DevModeControllerDeps) {
    const container = this.deps.container;

    // ── Dev Mode Toggle Button ────────────────────────────
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.title = 'Toggle Dev Mode';
    this.btn.textContent = '🔧 Dev';
    this.btn.style.cssText = [
      'all:unset', 'position:absolute', 'bottom:8px', 'right:120px',
      'padding:5px 10px', 'background:rgba(10,10,20,0.75)', 'color:#9fd8ff',
      'border:1px solid rgba(255,255,255,0.15)', 'border-radius:4px',
      'font:11px sans-serif', 'cursor:pointer', 'z-index:10',
    ].join(';');
    this.btn.addEventListener('mouseenter', () => {
      this.btn.style.background = 'rgba(20,20,32,0.92)';
    });
    this.btn.addEventListener('mouseleave', () => {
      this.btn.style.background = 'rgba(10,10,20,0.75)';
    });
    this.btn.addEventListener('click', () => this.toggle());
    container.appendChild(this.btn);

    // ── Dock Manager (must exist before panels mount) ─────
    this.dock = createDockManager({ container });

    // ── Dev Mode Panels ───────────────────────────────────
    this.inspector = mountInspector({
      container,
      getState: () => this.deps.state,
      getDevMode: () => this.devMode,
      onEdit: (hit, key, value) => this.applyInspectorEdit(hit, key, value),
      onDelete: () => this.deleteSelected(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onFocusCamera: (x, y) => {
        const vp = this.deps.getViewport();
        focusCameraOnTile(this.deps.state.camera, x, y, vp.width, vp.height);
      },
      dock: this.dock,
    });
    this.debugOverlay = mountDebugOverlayPanel(container, { dock: this.dock });
    this.timeDebug = mountTimeDebugPanel(container, {
      clock: this.deps.state.clock,
      scheduler: this.deps.scheduler,
      eventLog: this.deps.state.eventLog,
      dock: this.dock,
    });
    this.spawner = createEntitySpawner(container);
    this.mapEditor = mountMapEditorPanel(container, {
      onPaintTile: (x, y, tileType) => this.paintTile(x, y, tileType),
      dock: this.dock,
    });
    this.createPanel = mountCreatePanel({
      container,
      getState: () => this.deps.state,
      queue: this.deps.commandQueue,
      getLlmCapable: this.deps.getLlmCapable,
      dock: this.dock,
    });

    this.renderBench = createRenderBenchPanel({
      container,
      onFocusKind: (kind, zoom) => {
        const e = this.deps.state.world?.query({ kind })[0];
        if (!e) return false;
        const vp = this.deps.getViewport();
        this.deps.state.camera.zoom = zoom;
        focusCameraOnTile(this.deps.state.camera, e.x, e.y, vp.width, vp.height);
        return true;
      },
      dock: this.dock,
    });

    // Restore any persisted dock layout now that all panels are registered.
    this.dock.restore();

    // Lift the dev toggle button into its dedicated band so it never renders
    // under game UI. (FloatingPanel applies the band to each panel itself; the
    // toolbar applies its own. The entity-spawner is a separate full-screen
    // modal that owns z 1000.)
    this.btn.style.zIndex = String(DEV_UI_Z);

    // ── Dev Toolbar (after panels + restore) ──────────────
    this.toolbar = mountDevToolbar(container, [
      { id: 'inspector', label: '🔍 Inspector', isActive: () => this.inspector.isVisible(), onClick: () => this.inspector.toggle() },
      { id: 'time', label: '⏱ Time', isActive: () => this.timeDebug.isVisible(), onClick: () => this.timeDebug.toggle() },
      { id: 'map', label: '🗺️ Map', isActive: () => this.mapEditor.isVisible(), onClick: () => this.mapEditor.toggle() },
      { id: 'overlay', label: '🎨 Overlay', isActive: () => this.debugOverlay.isVisible(), onClick: () => this.debugOverlay.toggle() },
      { id: 'create', label: '✨ Create', isActive: () => this.createPanel.isVisible(), onClick: () => this.createPanel.toggle() },
      { id: 'bench', label: '🏚 Bench', isActive: () => this.renderBench.isVisible(), onClick: () => this.renderBench.toggle() },
      { id: 'undo', label: '↩ Undo', onClick: () => this.undo() },
      { id: 'redo', label: '↪ Redo', onClick: () => this.redo() },
    ]);

    this.attachKeyboard();
  }

  isEnabled(): boolean { return this.devMode.enabled; }

  /** Toggle dev mode on/off */
  toggle(): void {
    const enabled = toggleDevMode(this.devMode);
    console.log(`[dev] mode ${enabled ? 'enabled' : 'disabled'}`);
    // Update button appearance
    if (enabled) {
      this.btn.style.background = 'rgba(255, 215, 0, 0.75)';
      this.btn.style.color = '#000';
      this.btn.textContent = '🔧 Dev ON';
      // Initialize debug overlay options if not set
      if (this.devMode.showBeliefHeatmap === undefined) {
        Object.assign(this.devMode, DEFAULT_DEBUG_OVERLAY_OPTIONS);
      }
      // Reopen panels that were open last time (default to inspector if none were).
      this.toolbar.show();
      const anyOpen = ['inspector', 'time', 'map', 'overlay', 'create'].some(id => this.dock.isOpen(id));
      if (this.dock.isOpen('inspector') || !anyOpen) { this.inspector.show(); this.inspector.update(); }
      if (this.dock.isOpen('time')) this.timeDebug.show();
      if (this.dock.isOpen('map')) this.mapEditor.show();
      if (this.dock.isOpen('overlay')) this.debugOverlay.show();
      if (this.dock.isOpen('create')) this.createPanel.show();
      this.toolbar.refresh();
    } else {
      this.btn.style.background = 'rgba(10,10,20,0.75)';
      this.btn.style.color = '#9fd8ff';
      this.btn.textContent = '🔧 Dev';
      this.toolbar.hide();
      this.inspector.select(null);
      this.inspector.hide();
      this.timeDebug.hide();
      this.mapEditor.hide();
      this.debugOverlay.hide();
      this.createPanel.hide();
      this.renderBench.hide();
      this.devMode.selected = null;
      this.debugOverlay.update(this.devMode);
    }
  }

  private attachKeyboard(): void {
    const handler = (e: KeyboardEvent) => {
      if (!this.devMode.enabled) return;
      // Ctrl+Shift+D toggles dev mode
      if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        this.toggle();
        return;
      }
      // (Inspector is opened by enabling dev mode / the toolbar button — no
      //  keyboard shortcut. Render-mode toggle is now the '◈ Iso' toolbar button.)

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
        this.deleteSelected();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    this.detachKeys = () => window.removeEventListener("keydown", handler);
  }

  /** Handle right-click on canvas for dev mode hit-testing */
  async handleRightClick(sx: number, sy: number): Promise<void> {
    if (!this.devMode.enabled) return;
    if (!this.deps.state.map || !this.deps.state.world) return;

    const rc = buildRenderContext(this.deps.getRenderDeps());

    const hit = hitTest(rc, sx, sy);

    if (hit.type === null) {
      // No entity under cursor - offer to spawn new entity
      const spawnOpts = await this.spawner.open(hit.tileX, hit.tileY);
      if (spawnOpts) {
        this.spawnEntity(spawnOpts);
      }
      return;
    }

    this.devMode.selected = hit;
    this.inspector.selectHit(hit);
  }

  /** Spawn a new entity from spawner options */
  private spawnEntity(opts: { kind: string; x: number; y: number; properties?: Record<string, unknown> }): void {
    if (!this.deps.state.world) return;

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
      this.deps.state.world.addEntity(entity);
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
  applyInspectorEdit(hit: HitResult, key: string, value: unknown): void {
    if (hit.type === 'entity' || hit.type === 'npc') {
      const id = hit.type === 'entity' ? (hit.entity as Entity | undefined)?.id : hit.npc?.id;
      const world = this.deps.state.world;
      if (!id || !world) return;
      const entity = world.query({}).find(e => e.id === id);
      if (!entity) return;

      const before = JSON.parse(JSON.stringify(entity));
      if (key === 'x' || key === 'y') {
        world.updateEntity(id, { [key]: Number(value) });
      } else if (key === 'kind') {
        world.updateEntity(id, { kind: String(value) });
      } else if (key === 'properties' && value && typeof value === 'object') {
        world.updateEntity(id, { properties: value as Record<string, unknown> });
      } else {
        // NPC sim/identity fields live in the properties bag.
        world.setProperty(id, key, value);
      }
      const after = world.query({}).find(e => e.id === id);
      this.pushUndo({
        type: 'entity_update',
        target: { tileX: Math.floor(entity.x), tileY: Math.floor(entity.y), entityId: id },
        before,
        after: after ? JSON.parse(JSON.stringify(after)) : null,
      });
    } else if (hit.type === 'tile') {
      const map = this.deps.state.map;
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
    this.inspector.update();
  }

  /** Push an undo action and clear the redo stack. */
  private pushUndo(action: UndoAction): void {
    this.devMode.undoStack.push(action);
    this.devMode.redoStack = [];
  }

  /** Delete the currently selected entity */
  private deleteSelected(): void {
    const world = this.deps.state.world;
    if (!this.devMode.selected || !world) return;
    const hit = this.devMode.selected;
    if (hit.type === null) return;

    let entityId: string | undefined;
    if (hit.type === 'entity') entityId = (hit.entity as Entity)?.id;
    else if (hit.type === 'npc') entityId = hit.npc?.id;
    else if (hit.type === 'decoration') entityId = (hit.decoration as any)?.id;

    if (!entityId) return;

    const entity = world.query({}).find(e => e.id === entityId);
    if (!entity) return;

    // Save for undo
    const undoAction: UndoAction = {
      type: 'entity_delete',
      target: { tileX: Math.floor(entity.x), tileY: Math.floor(entity.y), entityId },
      before: JSON.parse(JSON.stringify(entity)),
      after: null,
    };

    world.removeEntity(entityId);
    this.devMode.undoStack.push(undoAction);
    this.devMode.redoStack = [];
    this.devMode.selected = null;
    this.inspector.select(null);
    console.log(`[dev] Deleted entity ${entityId}`);
  }

  /** Undo the last action */
  undo(): void {
    if (this.devMode.undoStack.length === 0) return;
    const action = this.devMode.undoStack.pop()!;
    applyUndo(action, this.deps.state.world, this.deps.state.map);
    this.devMode.redoStack.push(action);
    this.refreshInspectorAfterHistory();
  }

  /** Redo the last undone action */
  redo(): void {
    if (this.devMode.redoStack.length === 0) return;
    const action = this.devMode.redoStack.pop()!;
    applyRedo(action, this.deps.state.world, this.deps.state.map);
    this.devMode.undoStack.push(action);
    this.refreshInspectorAfterHistory();
  }

  /** After undo/redo, keep the Inspector in sync if a selection is showing. */
  private refreshInspectorAfterHistory(): void {
    this.inspector.update();
  }

  /** Paint a tile on the map (dev mode) */
  private paintTile(x: number, y: number, tileType: string): void {
    if (!this.deps.state.map) {
      console.warn('[dev] No map loaded');
      return;
    }
    const map = this.deps.state.map;
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

  /** Called each frame (from render/FrameRenderer) when dev mode is on. */
  drawOverlays(ctx: CanvasRenderingContext2D, rc: RenderContext, hoverHit?: HitResult | null): void {
    if (!this.devMode.enabled) return;
    const debugOpts = {
      showBeliefHeatmap: !!this.devMode.showBeliefHeatmap,
      showNeeds: !!this.devMode.showNeeds,
      showMood: !!this.devMode.showMood,
      showSocialConnections: !!this.devMode.showSocialConnections,
      beliefThreshold: this.devMode.beliefThreshold ?? 0.3,
      selectedSpiritId: this.devMode.selectedSpiritId ?? null,
    };
    drawDebugOverlays(ctx, this.deps.state.camera, this.deps.state.world!, rc.npcs, debugOpts);

    const s = this.deps.state;

    // Map info layers (rendering-only).
    if (this.devMode.showBiomeLayer) {
      drawBiomeLayer(ctx, s.biomeMap, s.camera);
    }
    if (this.devMode.showPoiLayer) {
      drawPoiLayer(ctx, s.worldSeed?.pois, s.camera);
    }
    const owDeps = {
      world: s.world, decorations: s.generatedDecorations ?? [], spirits: s.spirits, seed: s.worldSeed,
    };
    const selection = this.inspector.getSelection();
    const selRect = resolveOutlineRect(selection, owDeps);

    // Hover preview. A building (resolved from ANY tile of its footprint, not
    // just the indexed origin) gets its occupied tiles washed + outlined so you
    // can see exactly which tiles it sits on; anything else gets the faint
    // single-target outline. Skipped when it would duplicate the selection.
    if (hoverHit) {
      const bldgRect = buildingFootprintAt(owDeps.world, hoverHit.tileX, hoverHit.tileY);
      if (bldgRect) {
        if (!sameRect(bldgRect, selRect)) {
          fillTileRect(ctx, bldgRect, s.camera);
          drawHoverOutline(ctx, bldgRect, s.camera);
        }
      } else if (hoverHit.type) {
        const hoverRect = resolveOutlineRect(selectionFromHit(hoverHit), owDeps);
        if (hoverRect && !sameRect(hoverRect, selRect)) {
          drawHoverOutline(ctx, hoverRect, s.camera);
        }
      }
    }

    // Glowing outline around the current selection (canvas- or tree-picked).
    drawSelectionOutline(ctx, selection, s.camera, owDeps, performance.now());

    this.debugOverlay.update(this.devMode);
  }

  updateTimeDebug(): void {
    if (!this.devMode.enabled) return;
    this.timeDebug.update(this.deps.state.clock, this.deps.scheduler, this.deps.state.eventLog);
  }

  updateInspector(): void {
    if (this.inspector.isVisible()) this.inspector.update();
  }

  /** Hit-test passthrough so the tooltip code can stay in Game without importing hitTest. */
  hitTest(sx: number, sy: number) { return hitTest(buildRenderContext(this.deps.getRenderDeps()), sx, sy); }

  destroy(): void {
    this.detachKeys?.();
    this.btn.remove();
    this.toolbar.destroy();
    this.dock.destroy();
    this.inspector.destroy();
    this.debugOverlay.destroy?.();
    this.timeDebug.destroy?.();
    this.spawner.destroy?.();
    this.mapEditor.destroy?.();
    this.createPanel.destroy();
    this.renderBench.destroy();
  }
}
