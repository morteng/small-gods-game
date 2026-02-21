import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { WFCEngine } from '@/wfc';
import { renderMap } from '@/render/renderer';
import { centerOn } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions, NpcInstance, NpcRole } from '@/core/types';
import { updateNpcs, FRAME_MS } from '@/render/npc-animator';
import { buildCharacterSpec, getOrGenerateSheet } from '@/render/lpc';

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
  /** Resolved spritesheets keyed by NPC id */
  private sheets = new Map<string, HTMLCanvasElement>();

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
    this.sheets.clear();

    for (const poi of ws.pois) {
      if (!poi.npcs?.length || !poi.position) continue;
      const { x: px, y: py } = poi.position;

      for (let i = 0; i < poi.npcs.length; i++) {
        const npcDef = poi.npcs[i];
        const id = `${poi.id}-npc-${i}`;
        const seed = hashId(id);
        const role = npcDef.role as NpcRole;
        const safeRole: NpcRole = VALID_ROLES.includes(role) ? role : 'farmer';

        // Place near POI; clamp to map bounds
        const tileX = Math.max(0, Math.min(map.width  - 1, px + (seed % 3) - 1));
        const tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));

        const npc: NpcInstance = {
          id,
          role: safeRole,
          seed,
          tileX,
          tileY,
          direction: DIRECTIONS[seed % 4],
          frame: (seed % 8) + 1,
          frameTimer: seed % FRAME_MS,
        };

        this.state.npcs.push(npc);

        // Kick off async spritesheet generation
        const spec = buildCharacterSpec(safeRole, seed);
        getOrGenerateSheet(spec).then(canvas => {
          if (canvas) this.sheets.set(id, canvas);
        });
      }
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.lastTime = performance.now();

    const loop = (now: number) => {
      const deltaMs = Math.min(now - this.lastTime, 100);
      this.lastTime = now;
      updateNpcs(this.state.npcs, deltaMs);
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
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    // Note: Task 8 will add npcs + sheets params; for now call without them
    renderMap(this.ctx, this.state.map, this.state.camera, w, h);
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map) return;
    const tile = this.state.map.tiles[y]?.[x];
    if (tile) console.log(`Tile (${x}, ${y}): ${tile.type}`);
  }

  destroy(): void {
    this.stopLoop();
    this.cleanupControls?.();
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}
