import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { WFCEngine } from '@/wfc';
import { renderMap } from '@/render/renderer';
import { centerOn } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { WorldManager } from '@/map/world-manager';
import type { GameMap, WorldSeed, TerrainOptions } from '@/core/types';

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
  private cleanupControls: (() => void) | null = null;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, _options: GameOptions = {}) {
    this.container = container;
    this.state = createState();

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Resize canvas to match container
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    // Attach input controls
    this.cleanupControls = attachControls(this.canvas, this.state.camera, {
      onTileClick: (x, y) => this.onTileClick(x, y),
      onRedraw: () => this.render(),
    });
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.ctx.scale(devicePixelRatio, devicePixelRatio);
    this.render();
  }

  async generateWorld(worldSeed?: WorldSeed, terrainOptions?: Partial<TerrainOptions>): Promise<GameMap> {
    const ws = worldSeed || await WorldManager.loadDefault();
    const engine = new WFCEngine(ws.size.width, ws.size.height, {
      seed: Date.now(),
      terrainOptions: {
        forestDensity: terrainOptions?.forestDensity ?? 0.5,
        waterLevel: terrainOptions?.waterLevel ?? 0.35,
        villageCount: terrainOptions?.villageCount ?? 3,
      },
    });

    const map = await engine.generate(ws);
    this.state.map = map;
    this.state.worldSeed = ws;

    // Center camera on map
    centerOn(
      this.state.camera,
      (map.width * TILE_SIZE) / 2,
      (map.height * TILE_SIZE) / 2,
      this.canvas.width / devicePixelRatio,
      this.canvas.height / devicePixelRatio
    );

    this.render();
    return map;
  }

  render(): void {
    if (!this.state.map) return;
    const w = this.canvas.width / devicePixelRatio;
    const h = this.canvas.height / devicePixelRatio;
    renderMap(this.ctx, this.state.map, this.state.camera, w, h);
  }

  private onTileClick(x: number, y: number): void {
    if (!this.state.map) return;
    const tile = this.state.map.tiles[y]?.[x];
    if (tile) {
      console.log(`Tile (${x}, ${y}): ${tile.type}`);
    }
  }

  destroy(): void {
    this.cleanupControls?.();
    this.resizeObserver.disconnect();
    this.canvas.remove();
  }
}
