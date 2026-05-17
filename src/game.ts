import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { renderMap } from '@/render/renderer';
import { centerOn } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions, NpcRole, RenderContext, Entity, NpcSimState, NpcProperties } from '@/core/types';
import { FRAME_MS } from '@/render/npc-animator';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { tickAllNpcEntities, SIM_TICK_MS } from '@/sim/npc-sim';
import { drawNpcOverlay, type OverlayHitAreas } from '@/render/sim-overlay';
import { whisper } from '@/sim/whisper';
import { initNpcProps, getNpc, toRenderNpc } from '@/world/npc-helpers';
import { drawPowerHud } from '@/render/hud';
import { formatDebugHud } from '@/ui/debug-hud';
import { renderNpcInfoPanel } from '@/ui/npc-info-panel';
import { formatNpcTooltip } from '@/ui/npc-tooltip';
import { createSettingsPanel, type SettingsPanelHandle } from '@/ui/settings-panel';
import {
  createDecorationPlacementModal,
  type DecorationPlacementModalHandle,
} from '@/ui/decoration-placement-modal';
import { loadDecorations, saveDecorations } from '@/services/decoration-store';
import { DecorationImageCache } from '@/render/decoration-image-cache';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { getBuildingTemplate, BUILDING_TEMPLATES } from '@/map/building-templates';
import { generateWithNoise } from '@/map/map-generator';

export interface GameOptions {
  width?: number;
  height?: number;
  seed?: number;
}

/** Simple string hash → stable integer */
function hashId(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const VALID_ROLES: readonly NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

export class Game {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private cleanupControls: (() => void) | null = null;
  private resizeObserver: ResizeObserver;
  private rafId: number | null = null;
  private lastTime: number = 0;
  private simTickAcc: number = 0;
  private overlayHitAreas: OverlayHitAreas = [];
  private lastWhisperTime: number = -Infinity;
  private pausedBanner: HTMLDivElement;
  private debugHud: HTMLDivElement;
  private npcInfoPanel: HTMLDivElement;
  private renderedNpcId: string | null = null;
  private renderedPinned: boolean = false;
  private lastInfoRefresh: number = 0;
  private hoverTile: { x: number; y: number } | null = null;
  private hoverScreen: { x: number; y: number } | null = null;
  private fpsEma: number = 60;
  private tooltip: HTMLDivElement;
  private settingsPanel: SettingsPanelHandle;
  private settingsBtn: HTMLButtonElement;
  private placementModal: DecorationPlacementModalHandle;
  private decorationImages = new DecorationImageCache();
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();
  private tileAtlas: HTMLImageElement | null = null;
  private terrainSheets = new Map<string, HTMLImageElement>();
  private buildingSprites = new Map<string, HTMLImageElement>();
  private treeSheets = new Map<string, HTMLImageElement>();

  constructor(container: HTMLElement, _options: GameOptions = {}) {
    this.container = container;
    this.state = createState();

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

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

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = [
      'position:absolute', 'padding:3px 8px',
      'background:rgba(10,10,20,0.85)', 'color:#fff',
      'font:11px sans-serif', 'border-radius:3px',
      'pointer-events:none', 'display:none', 'z-index:11',
      'white-space:nowrap', 'transform:translate(12px, 12px)',
    ].join(';');
    container.appendChild(this.tooltip);

    this.settingsBtn = document.createElement('button');
    this.settingsBtn.type = 'button';
    this.settingsBtn.title = 'PixelLab settings (K)';
    this.settingsBtn.textContent = '⚙ API key';
    this.settingsBtn.style.cssText = [
      'all:unset', 'position:absolute', 'bottom:8px', 'right:8px',
      'padding:5px 10px', 'background:rgba(10,10,20,0.75)', 'color:#9fd8ff',
      'border:1px solid rgba(255,255,255,0.15)', 'border-radius:4px',
      'font:11px sans-serif', 'cursor:pointer', 'z-index:10',
    ].join(';');
    this.settingsBtn.addEventListener('mouseenter', () => {
      this.settingsBtn.style.background = 'rgba(20,20,32,0.92)';
    });
    this.settingsBtn.addEventListener('mouseleave', () => {
      this.settingsBtn.style.background = 'rgba(10,10,20,0.75)';
    });
    this.settingsBtn.addEventListener('click', () => this.settingsPanel.toggle());
    container.appendChild(this.settingsBtn);

    this.settingsPanel = createSettingsPanel(container);
    this.placementModal = createDecorationPlacementModal(container);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.onTileClick(x, y),
      onCanvasClick: (sx, sy) => this.onCanvasClick(sx, sy),
      onTileRightClick: (x, y) => void this.onTileRightClick(x, y),
      onTogglePause: () => this.togglePause(),
      onToggleLabels: () => { this.state.showLabels = !this.state.showLabels; },
      onTogglePoiMarkers: () => { this.state.showPoiMarkers = !this.state.showPoiMarkers; },
      onToggleDebug: () => {
        this.state.debug = !this.state.debug;
        this.debugHud.style.display = this.state.debug ? 'block' : 'none';
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
      onToggleSettings: () => this.settingsPanel.toggle(),
      onRedraw: () => {},
    });
  }

  private togglePause(): void {
    this.state.paused = !this.state.paused;
    this.pausedBanner.style.display = this.state.paused ? 'block' : 'none';
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  async generateWorld(worldSeed?: WorldSeed, _terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
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
    if (!this.tileAtlas) {
      this.tileAtlas = await this.loadImage('/sprites/tiles/kenney-town.png');
    }
    await this.loadTerrainSheets();
    await this.loadBuildingSprites();
    if (this.treeSheets.size === 0) {
      await this.loadTreeSheets();
    }

    centerOn(
      this.state.camera,
      (map.width  * TILE_SIZE) / 2,
      (map.height * TILE_SIZE) / 2,
      this.canvas.width  / devicePixelRatio,
      this.canvas.height / devicePixelRatio,
    );

    this.spawnNpcs(ws, map);
    this.state.generatedDecorations = loadDecorations(ws.name);
    // Kick off image preloading; missing ids resolve to null and the renderer
    // falls back to placeholder squares until the load completes.
    void this.decorationImages.preload(this.state.generatedDecorations.map(d => d.assetId));
    this.startLoop();
    return map;
  }

  private async onTileRightClick(tileX: number, tileY: number): Promise<void> {
    const map = this.state.map;
    if (!map) return;
    if (tileX < 0 || tileY < 0 || tileX >= map.width || tileY >= map.height) return;
    const tile = map.tiles[tileY]?.[tileX];
    if (!tile || !tile.walkable) return;

    const result = await this.placementModal.open({ x: tileX, y: tileY });
    if (!result) return;
    const placement = { tileX, tileY, assetId: result.assetId };
    this.state.generatedDecorations = [...this.state.generatedDecorations, placement];
    if (this.state.worldSeed) {
      saveDecorations(this.state.worldSeed.name, this.state.generatedDecorations);
    }
    void this.decorationImages.load(result.assetId);
  }

  /** Spawn NPCs from POI definitions */
  private spawnNpcs(ws: WorldSeed, map: GameMap): void {
    if (!this.state.world) return;
    // Remove any existing npc entities (game restart)
    for (const e of this.state.world.query({ kind: 'npc' })) {
      this.state.world.removeEntity(e.id);
    }
    this.sheets.clear();

    for (const poi of ws.pois) {
      if (!poi.npcs?.length || !poi.position) continue;
      const { x: px, y: py } = poi.position;
      const poiBuildings = (map.buildings ?? []).filter(b => b.poiId === poi.id);

      for (let i = 0; i < poi.npcs.length; i++) {
        const npcDef = poi.npcs[i];
        const id = `${poi.id}-npc-${i}`;
        const seed = hashId(id);
        const role = npcDef.role as NpcRole;
        const safeRole: NpcRole = VALID_ROLES.includes(role) ? role : 'farmer';
        const name = npcDef.name || safeRole;
        const homeBuilding = assignHomeBuilding(safeRole, poiBuildings, i);

        let tileX: number;
        let tileY: number;
        if (homeBuilding) {
          const template = getBuildingTemplate(homeBuilding.templateId);
          if (template) {
            tileX = homeBuilding.tileX + template.doorCell.x;
            tileY = homeBuilding.tileY + template.doorCell.y;
          } else {
            tileX = Math.max(0, Math.min(map.width  - 1, px + (seed % 3) - 1));
            tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));
          }
        } else {
          tileX = Math.max(0, Math.min(map.width  - 1, px + (seed % 3) - 1));
          tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));
        }

        const props = initNpcProps(name, safeRole, seed);
        props.homeBuildingId = homeBuilding?.id;
        props.homePoiId = poi.id;

        this.state.world.addEntity({
          id, kind: 'npc', x: tileX, y: tileY,
          properties: props as unknown as Record<string, unknown>,
        });
        this.state.eventLog.append({ type: 'npc_spawn', npcId: id, role: safeRole, poiId: poi.id });

        // Kick off async spritesheet generation
        const spec = buildCharacterSpec(safeRole, seed);
        getOrGenerateSheet(spec).then(canvas => {
          if (canvas) this.sheets.set(id, canvas);
        });
      }
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  private loadTreeSheets(): Promise<void> {
    const variants = ['green', 'orange', 'dead', 'pale', 'brown'];
    const promises = variants.map(v => new Promise<void>(resolve => {
      const img = new Image();
      img.onload = () => { this.treeSheets.set(v, img); resolve(); };
      img.onerror = () => resolve(); // skip missing silently
      img.src = `/sprites/trees/trees-${v}.png`;
    }));
    return Promise.all(promises).then(() => {});
  }

  private async loadTerrainSheets(): Promise<void> {
    const groups = ['grass', 'water', 'dirt', 'sand', 'stone', 'rocky'];
    await Promise.all(groups.map(async (g) => {
      if (!this.terrainSheets.has(g)) {
        const img = await this.loadImage(`/sprites/terrain/${g}.png`);
        if (img) this.terrainSheets.set(g, img);
      }
    }));
  }

  private async loadBuildingSprites(): Promise<void> {
    await Promise.all(BUILDING_TEMPLATES.map(async (tpl) => {
      if (!this.buildingSprites.has(tpl.id)) {
        const img = await this.loadImage(`/sprites/buildings/${tpl.id}.png`);
        if (img) this.buildingSprites.set(tpl.id, img);
      }
    }));
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
    this.simTickAcc = 0;

    const loop = (now: number) => {
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      if (deltaMs > 0) {
        const instantFps = 1000 / deltaMs;
        this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
      }
      if (!this.state.paused && this.state.world) {
        this.updateNpcFrames(deltaMs);
        if (this.state.map) tickNpcMovementEntities(this.state.world, this.state.map, deltaMs);
        this.simTickAcc += deltaMs;
        while (this.simTickAcc >= SIM_TICK_MS) {
          this.simTickAcc -= SIM_TICK_MS;
          tickAllNpcEntities(this.state.world);
          // Per-spirit power regen (inlined; Task 4.3 moves to SpiritSystem)
          const player = this.state.spirits.get('player')!;
          let total = 0;
          for (const e of this.state.world.query({ kind: 'npc' })) {
            const p = e.properties as unknown as NpcProperties;
            total += p.beliefs['player']?.faith ?? 0;
          }
          player.power += total * 0.02;
        }
      }
      this.applyFollowCamera();
      this.render();
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

  render(): void {
    if (!this.state.map) return;
    const rc: RenderContext = {
      map: this.state.map,
      camera: this.state.camera,
      canvasWidth: this.canvas.width / devicePixelRatio,
      canvasHeight: this.canvas.height / devicePixelRatio,
      npcs: this.state.world ? this.state.world.query({ kind: 'npc' }).map(toRenderNpc) : [],
      npcSheets: this.sheets,
      visualMap: this.state.visualMap,
      blobMap: this.state.blobMap ?? null,
      tileAtlas: this.tileAtlas,
      terrainSheets: this.terrainSheets,
      buildingSprites: this.buildingSprites,
      treeSheets: this.treeSheets,
      world: this.state.world!,
      showLabels: this.state.showLabels,
      showPoiMarkers: this.state.showPoiMarkers,
      generatedDecorations: this.state.generatedDecorations,
      resolveDecorationImage: (id: string) => this.decorationImages.get(id),
    };
    renderMap(this.ctx, rc);

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
        const now = performance.now();
        const pinned = this.state.pinnedNpcId === sim.npcId;
        const switched = this.renderedNpcId !== sim.npcId;
        const pinChanged = this.renderedPinned !== pinned;
        if (switched || pinChanged || now - this.lastInfoRefresh > 500) {
          renderNpcInfoPanel(this.npcInfoPanel, sim, {
            pinned,
            onTogglePin: () => {
              this.state.pinnedNpcId = this.state.pinnedNpcId === sim.npcId ? null : sim.npcId;
              this.lastInfoRefresh = 0;
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
    const regenPerSec = totalFaith * 0.02;
    drawPowerHud(this.ctx, player.power, regenPerSec);

    this.updateTooltip();

    if (this.state.debug) {
      this.debugHud.textContent = formatDebugHud({
        fps: this.fpsEma,
        mouseTile: this.hoverTile,
        entityCount: this.state.world?.query({}).length ?? 0,
        npcCount: this.state.world?.query({ kind: 'npc' }).length ?? 0,
        paused: this.state.paused,
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
    for (const area of this.overlayHitAreas) {
      if (sx >= area.x && sx <= area.x + area.w && sy >= area.y && sy <= area.y + area.h) {
        if (area.action === 'whisper' && area.active && this.state.world) {
          const e = getNpc(this.state.world, area.npcId);
          const player = this.state.spirits.get('player')!;
          if (e && whisper(player, e, this.state.eventLog)) {
            this.lastWhisperTime = performance.now();
          }
        }
        return true;
      }
    }
    return false;
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map || !this.state.world) return;
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
    this.resizeObserver.disconnect();
    this.pausedBanner.remove();
    this.debugHud.remove();
    this.npcInfoPanel.remove();
    this.tooltip.remove();
    this.settingsBtn.remove();
    this.settingsPanel.destroy();
    this.placementModal.destroy();
    this.decorationImages.destroy();
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
    whisperCooldown: p.whisperCooldown,
    homeBuildingId: p.homeBuildingId, homePoiId: p.homePoiId,
  };
}

// =============================================================================
// NPC home assignment helpers (Phase E)
// =============================================================================

import type { BuildingInstance } from '@/core/types';

/** Role → preferred building template category */
const ROLE_PREFERRED_CATEGORY: Record<string, string> = {
  priest:   'religious',
  farmer:   'farm',
  merchant: 'commercial',
  soldier:  'military',
  noble:    'residential',
  elder:    'residential',
  child:    'residential',
  beggar:   'residential',
};

function assignHomeBuilding(
  role: string,
  buildings: BuildingInstance[],
  index: number,
): BuildingInstance | undefined {
  if (!buildings.length) return undefined;
  const preferred = ROLE_PREFERRED_CATEGORY[role];
  // Try preferred category first
  if (preferred) {
    const match = buildings.find(b => {
      const t = getBuildingTemplate(b.templateId);
      return t?.category === preferred;
    });
    if (match) return match;
  }
  // Fall back to round-robin assignment
  return buildings[index % buildings.length];
}
