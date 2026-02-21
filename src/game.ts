import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { WFCEngine } from '@/wfc';
import { renderMap } from '@/render/renderer';
import { centerOn } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions, NpcInstance, NpcRole, RenderContext } from '@/core/types';
import { updateNpcs, FRAME_MS } from '@/render/npc-animator';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';
import { initNpcSim, tickAllNpcs, SIM_TICK_MS } from '@/sim/npc-sim';
import { drawNpcOverlay, type OverlayHitAreas } from '@/render/sim-overlay';
import { whisperNpc, computePowerRegen } from '@/sim/divine-actions';
import { drawPowerHud } from '@/render/hud';
import { Autotiler } from '@/map/autotiler';
import { computeBlobMap } from '@/map/blob-autotiler';
import { placeDecorations } from '@/map/decoration-placer';
import { getBuildingTemplate } from '@/map/building-templates';

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

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
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
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();
  private tileAtlas: HTMLImageElement | null = null;
  private terrainAtlas: HTMLImageElement | null = null;
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

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.onTileClick(x, y),
      onCanvasClick: (sx, sy) => this.onCanvasClick(sx, sy),
      onRedraw: () => {},
    });
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
  }

  async generateWorld(worldSeed?: WorldSeed, terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
    const ws = worldSeed || await WorldManager.loadDefault();
    const engine = new WFCEngine(ws.size.width, ws.size.height, {
      seed: Date.now(),
      terrainOptions: {
        forestDensity: terrainOptions?.forestDensity ?? 0.5,
        waterLevel:    terrainOptions?.waterLevel    ?? 0.35,
        villageCount:  terrainOptions?.villageCount  ?? 3,
      },
    });

    const map = await engine.generate(ws);
    this.state.map = map;
    this.state.worldSeed = ws;
    this.state.visualMap = Autotiler.computeVisualMap(map);
    this.state.blobMap = computeBlobMap(map.tiles, map.width, map.height);
    this.state.decorations = placeDecorations(map, map.seed);

    if (!this.tileAtlas) {
      this.tileAtlas = await this.loadImage('/sprites/tiles/kenney-town.png');
    }
    if (!this.terrainAtlas) {
      this.terrainAtlas = await this.loadImage('/sprites/terrain/lpc-terrain.png');
    }
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
    this.startLoop();
    return map;
  }

  /** Spawn NPCs from POI definitions */
  private spawnNpcs(ws: WorldSeed, map: GameMap): void {
    this.state.npcs = [];
    this.state.npcSim.clear();
    this.sheets.clear();

    for (const poi of ws.pois) {
      if (!poi.npcs?.length || !poi.position) continue;
      const { x: px, y: py } = poi.position;

      // Find buildings belonging to this POI for home assignment
      const poiBuildings = (map.buildings ?? []).filter(b => b.poiId === poi.id);

      for (let i = 0; i < poi.npcs.length; i++) {
        const npcDef = poi.npcs[i];
        const id = `${poi.id}-npc-${i}`;
        const seed = hashId(id);
        const role = npcDef.role as NpcRole;
        const safeRole: NpcRole = VALID_ROLES.includes(role) ? role : 'farmer';
        const name = npcDef.name || safeRole;

        // Find home building by role preference
        const homeBuilding = assignHomeBuilding(safeRole, poiBuildings, i);
        let tileX: number;
        let tileY: number;

        if (homeBuilding) {
          const template = getBuildingTemplate(homeBuilding.templateId);
          if (template) {
            // Place NPC at building's door cell
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

        const npc: NpcInstance = {
          id,
          name,
          role: safeRole,
          seed,
          tileX,
          tileY,
          direction: DIRECTIONS[seed % 4],
          frame: (seed % 8) + 1,
          frameTimer: seed % FRAME_MS,
          homeBuildingId: homeBuilding?.id,
          homePoiId: poi.id,
        };

        this.state.npcs.push(npc);

        const sim = initNpcSim(id, name, safeRole, seed);
        sim.homeBuildingId = homeBuilding?.id;
        sim.homePoiId = poi.id;
        this.state.npcSim.set(id, sim);

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

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();
    this.simTickAcc = 0;

    const loop = (now: number) => {
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      updateNpcs(this.state.npcs, deltaMs);
      this.simTickAcc += deltaMs;
      while (this.simTickAcc >= SIM_TICK_MS) {
        this.simTickAcc -= SIM_TICK_MS;
        tickAllNpcs(this.state.npcSim);
        this.state.playerPower += computePowerRegen(this.state.npcSim);
      }
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
      npcs: this.state.npcs,
      npcSheets: this.sheets,
      visualMap: this.state.visualMap,
      blobMap: this.state.blobMap ?? null,
      tileAtlas: this.tileAtlas,
      terrainAtlas: this.terrainAtlas,
      decorations: this.state.decorations,
      treeSheets: this.treeSheets,
    };
    renderMap(this.ctx, rc);

    // Gold flash when a whisper was just cast
    const flashAge = performance.now() - this.lastWhisperTime;
    if (flashAge < 300) {
      const alpha = 0.25 * (1 - flashAge / 300);
      this.ctx.fillStyle = `rgba(255, 215, 0, ${alpha.toFixed(3)})`;
      this.ctx.fillRect(0, 0, rc.canvasWidth, rc.canvasHeight);
    }

    if (this.state.selectedNpcId) {
      const npc = this.state.npcs.find(n => n.id === this.state.selectedNpcId);
      const sim = this.state.npcSim.get(this.state.selectedNpcId);
      if (npc && sim) {
        this.overlayHitAreas = drawNpcOverlay(
          this.ctx, npc, sim, this.state.camera,
          rc.canvasWidth, rc.canvasHeight,
          this.state.playerPower,
        );
      }
    } else {
      this.overlayHitAreas = [];
    }

    const regenPerSec = computePowerRegen(this.state.npcSim);
    drawPowerHud(this.ctx, this.state.playerPower, regenPerSec);
  }

  private onCanvasClick(sx: number, sy: number): boolean {
    for (const area of this.overlayHitAreas) {
      if (sx >= area.x && sx <= area.x + area.w && sy >= area.y && sy <= area.y + area.h) {
        if (area.action === 'whisper' && area.active) {
          const sim = this.state.npcSim.get(area.npcId);
          if (sim) {
            this.state.playerPower = whisperNpc(sim, this.state.playerPower);
            this.lastWhisperTime = performance.now();
          }
        }
        return true;
      }
    }
    return false;
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map) return;
    const clickedNpc = this.state.npcs.find(npc => npc.tileX === x && npc.tileY === y);
    if (clickedNpc) {
      this.state.selectedNpcId = this.state.selectedNpcId === clickedNpc.id ? null : clickedNpc.id;
    } else {
      this.state.selectedNpcId = null;
    }
  }

  destroy(): void {
    this.stopLoop();
    this.cleanupControls?.();
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
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
