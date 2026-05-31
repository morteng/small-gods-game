# TypeScript Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate Small Gods from global-scope JS script tags to TypeScript ES modules with a simple top-down renderer, embeddable in an iframe.

**Architecture:** Incremental file-by-file migration. Vite bundles a single entry point (`src/main.ts`) that replaces 20+ `<script>` tags. WFC engine, state, editor, and map generator are migrated as-is with types added. The isometric AI-rendered tile system is replaced by a ~200-line top-down colored-rectangle canvas renderer. A `Game` class wraps everything for iframe embedding.

**Tech Stack:** TypeScript, Vite, vitest, Canvas 2D API

---

### Task 1: Bootstrap Vite + TypeScript Entry Point

**Files:**
- Modify: `tsconfig.json`
- Modify: `vite.config.ts`
- Create: `src/main.ts`
- Create: `src/core/types.ts`
- Create: `index.html` (new root-level entry)

**Step 1: Update tsconfig.json for src/ directory**

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*.ts", "vite.config.ts"],
  "exclude": ["node_modules"]
}
```

**Step 2: Update vite.config.ts — new root, entry point**

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  server: { port: 3000 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
```

**Step 3: Create src/core/types.ts — core type definitions**

```ts
/** A single tile in the map grid */
export interface Tile {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  height?: number;
  bridgeDirection?: string;
}

/** Generated map data */
export interface GameMap {
  tiles: Tile[][];
  width: number;
  height: number;
  villages: Village[];
  seed: number;
  success: boolean;
  worldSeed: WorldSeed | null;
  stats: { iterations: number; backtracks: number };
}

/** Village/settlement on the map */
export interface Village {
  x: number;
  y: number;
  name?: string;
  type: string;
}

/** Point of Interest */
export interface POI {
  id: string;
  type: string;
  name?: string;
  description?: string;
  position?: { x: number; y: number };
  region?: { x_min: number; x_max: number; y_min: number; y_max: number };
  size?: 'small' | 'medium' | 'large';
  importance?: 'low' | 'medium' | 'high' | 'critical';
  npcs?: NPC[];
}

/** NPC definition */
export interface NPC {
  name: string;
  role: string;
  description?: string;
  personality?: string;
  knowledge?: string[];
}

/** Connection between POIs */
export interface Connection {
  from: string;
  to: string;
  type: 'road' | 'river' | 'wall';
  style?: 'dirt' | 'stone' | 'bridge';
  waypoints?: { x: number; y: number }[];
  width?: number;
  autoBridge?: boolean;
}

/** World seed — full world definition */
export interface WorldSeed {
  name: string;
  description?: string;
  size: { width: number; height: number };
  biome: string;
  visualTheme?: string;
  pois: POI[];
  connections: Connection[];
  constraints: string[];
  tileWeights?: Record<string, number>;
  lore?: { history?: string; factions?: string[]; quests?: string[] };
  roadEndpoints?: { direction: string; style?: string }[];
}

/** Camera state for pan/zoom */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

/** Tile definition from WFC system */
export interface TileDef {
  id: string;
  weight?: number;
  walkable: boolean;
  color: string;
  segColor?: string;
  category: string;
  baseType?: string;
  tree?: boolean;
}

/** Terrain generation options */
export interface TerrainOptions {
  forestDensity: number;
  waterLevel: number;
  villageCount: number;
}
```

**Step 4: Create src/main.ts — minimal entry point**

```ts
import './core/types';

const app = document.getElementById('app');
if (app) {
  app.textContent = 'Small Gods — loading...';
}

console.log('Small Gods TS entry point loaded');
```

**Step 5: Create index.html at project root**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Small Gods</title>
  <link rel="stylesheet" href="/public/css/base.css">
  <link rel="stylesheet" href="/public/css/layout.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**Step 6: Run dev server to verify**

Run: `npx vite --open`
Expected: Browser shows "Small Gods — loading..." text, console shows log message, no errors.

**Step 7: Commit**

```bash
git add src/main.ts src/core/types.ts index.html tsconfig.json vite.config.ts
git commit -m "feat: bootstrap TS entry point with Vite"
```

---

### Task 2: Migrate WFC Engine to TypeScript Modules

**Files:**
- Create: `src/wfc/cell.ts`
- Create: `src/wfc/tile.ts`
- Create: `src/wfc/grid.ts`
- Create: `src/wfc/propagator.ts`
- Create: `src/wfc/solver.ts`
- Create: `src/wfc/engine.ts`
- Create: `src/wfc/index.ts`
- Test: `tests/unit/wfc.test.ts` (rewrite to import from new modules)

The WFC code is well-structured — this is mostly adding `export`, `import`, and type annotations to existing code. Remove the `if (typeof module !== 'undefined')` CJS/browser dual-export blocks.

**Step 1: Create src/wfc/tile.ts**

Copy `src/wfc/Tile.js` content. Changes:
- Remove `SEG_COLORS` (AI rendering artifact — keep only `color` on tile defs)
- Remove `segColor` from all tile definitions
- Add `export` to `BASE_TILES`, `ROAD_VARIANTS`, etc., `TILES`, `ADJACENCY`, `DIRECTIONS`, `TileSet`
- Add types to `TileSet` methods
- Remove the CJS/browser export block at bottom
- Import `TileDef` from `@/core/types`

**Step 2: Create src/wfc/cell.ts**

Copy `src/wfc/Cell.js` content. Changes:
- `export class Cell`
- Add types to constructor params and methods
- Remove CJS/browser export block

**Step 3: Create src/wfc/grid.ts**

Copy `src/wfc/Grid.js` content. Changes:
- `import { Cell } from './cell'` and `import { TileSet } from './tile'`
- Remove the `static get CellClass()` browser/node detection — just use `Cell` directly
- `export class Grid`
- Add types
- Remove CJS/browser export block

**Step 4: Create src/wfc/propagator.ts**

Copy `src/wfc/Propagator.js` content. Changes:
- Import `Grid`, `TileSet`
- `export class Propagator`
- Add types
- Remove CJS/browser export block

**Step 5: Create src/wfc/solver.ts**

Copy `src/wfc/Solver.js` content. Changes:
- Import `Grid`, `Propagator`
- `export class Solver`
- Add types
- Remove CJS/browser export block

**Step 6: Create src/wfc/engine.ts**

Copy `src/wfc/WFCEngine.js` content. Changes:
- Import `TileSet`, `Grid`, `Propagator`, `Solver`, `TILES`
- Remove the `static get TileSetClass()` etc. — use imports directly
- `export class WFCEngine`
- `export const TERRAIN_WEIGHTS = { ... }`
- Import types from `@/core/types`
- Remove CJS/browser export block

**Step 7: Create src/wfc/index.ts**

```ts
export { Cell } from './cell';
export { TileSet, TILES, ADJACENCY, DIRECTIONS, BASE_TILES } from './tile';
export { Grid } from './grid';
export { Propagator } from './propagator';
export { Solver } from './solver';
export { WFCEngine, TERRAIN_WEIGHTS } from './engine';
```

**Step 8: Rewrite tests to import from new modules**

Rewrite `tests/unit/wfc.test.ts` to:
- `import { Cell, Grid, TileSet, Propagator, Solver, WFCEngine } from '../../src/wfc'`
- Remove the duplicated test implementations (TestCell, TestGrid, etc.)
- Keep the same test cases, just use real imports
- Update vitest config `include` to also cover `src/**/*.ts`

**Step 9: Run tests**

Run: `npx vitest run`
Expected: All WFC tests pass using the real TS modules.

**Step 10: Commit**

```bash
git add src/wfc/ tests/unit/wfc.test.ts
git commit -m "feat: migrate WFC engine to TypeScript modules"
```

---

### Task 3: Migrate Core Utilities (noise, constants, schema)

**Files:**
- Create: `src/core/noise.ts`
- Create: `src/core/constants.ts`
- Create: `src/core/schema.ts`
- Test: `tests/unit/noise.test.ts`

**Step 1: Create src/core/noise.ts**

```ts
export class Random {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

export function noise(x: number, y: number, seed: number): number {
  const r = new Random(seed + x * 374761393 + y * 668265263);
  return r.next();
}

export function smoothNoise(x: number, y: number, seed: number, scale = 4): number {
  const xi = Math.floor(x / scale), yi = Math.floor(y / scale);
  const xf = (x / scale) - xi, yf = (y / scale) - yi;
  const n00 = noise(xi, yi, seed), n10 = noise(xi + 1, yi, seed);
  const n01 = noise(xi, yi + 1, seed), n11 = noise(xi + 1, yi + 1, seed);
  return (n00 * (1 - xf) + n10 * xf) * (1 - yf) + (n01 * (1 - xf) + n11 * xf) * yf;
}

export function fractalNoise(x: number, y: number, seed: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < 4; i++) {
    v += smoothNoise(x * f, y * f, seed + i * 1000, 4) * a;
    m += a; a *= 0.5; f *= 2;
  }
  return v / m;
}
```

**Step 2: Create src/core/constants.ts**

Extract game constants (tile sizes, colors for top-down rendering, pricing). No AI-related constants.

```ts
/** Top-down tile size in pixels */
export const TILE_SIZE = 16;

/** Background color */
export const BG_COLOR = '#1a1a2e';

/** Tile colors for top-down rendering (keyed by base tile type) */
export const TILE_COLORS: Record<string, string> = {
  grass: '#66BB6A',
  water: '#42A5F5',
  deep_water: '#1565C0',
  shallow_water: '#64B5F6',
  road: '#9E9E9E',
  dirt_road: '#A1887F',
  stone_road: '#78909C',
  river: '#2196F3',
  dirt: '#A1887F',
  forest: '#2E7D32',
  dense_forest: '#1B5E20',
  pine_forest: '#33691E',
  dead_forest: '#5D4037',
  hill: '#8D6E63',
  hills: '#8D6E63',
  mountain: '#6D4C41',
  peak: '#4E342E',
  rocky: '#795548',
  cliffs: '#5D4037',
  beach: '#D4B896',
  sand: '#C8B560',
  lot: '#C4A484',
  bridge: '#8B7355',
  building_wood: '#A1887F',
  building_stone: '#78909C',
  castle_wall: '#546E7A',
  castle_tower: '#37474F',
  ruins: '#8D6E63',
  farm_field: '#AED581',
  orchard: '#7CB342',
  market: '#FFB74D',
  dock: '#8D6E63',
  well: '#90A4AE',
  meadow: '#81C784',
  glen: '#A5D6A7',
  scrubland: '#9E9D24',
  marsh: '#6D7B3E',
  swamp: '#4E6B3D',
  bog: '#5D6B3A',
};

/** POI icon colors and shapes for top-down rendering */
export const POI_ICONS: Record<string, { color: string; shape: 'circle' | 'triangle' | 'square' | 'diamond' }> = {
  village: { color: '#FFB74D', shape: 'circle' },
  city: { color: '#FF9800', shape: 'square' },
  castle: { color: '#78909C', shape: 'diamond' },
  forest: { color: '#2E7D32', shape: 'triangle' },
  lake: { color: '#42A5F5', shape: 'circle' },
  mountain: { color: '#6D4C41', shape: 'triangle' },
  farm: { color: '#AED581', shape: 'square' },
  port: { color: '#4FC3F7', shape: 'diamond' },
  ruins: { color: '#8D6E63', shape: 'diamond' },
  temple: { color: '#CE93D8', shape: 'triangle' },
  mine: { color: '#A1887F', shape: 'square' },
  tavern: { color: '#FFB74D', shape: 'square' },
  tower: { color: '#90A4AE', shape: 'triangle' },
  bridge: { color: '#8D6E63', shape: 'diamond' },
  crossroads: { color: '#9E9E9E', shape: 'circle' },
};

/** Cost tracking */
export const PRICES = { PAINT: 0.015, NPC: 0.003, ZOOM: 0.05 } as const;
```

**Step 3: Create src/core/schema.ts**

Migrate `src/worldseed/Schema.js` to TypeScript:
- Import types from `@/core/types`
- Export all constants and functions
- Remove `generatePaintingPrompt` and `generateDMKnowledge` (AI-specific, will re-add when needed)
- Remove CJS/browser export block

**Step 4: Write noise test**

```ts
// tests/unit/noise.test.ts
import { describe, it, expect } from 'vitest';
import { Random, noise, fractalNoise } from '../../src/core/noise';

describe('Random', () => {
  it('produces deterministic output from same seed', () => {
    const a = new Random(42);
    const b = new Random(42);
    expect(a.next()).toBe(b.next());
    expect(a.next()).toBe(b.next());
  });

  it('produces different output from different seeds', () => {
    const a = new Random(42);
    const b = new Random(99);
    expect(a.next()).not.toBe(b.next());
  });

  it('int() returns value in range', () => {
    const r = new Random(42);
    for (let i = 0; i < 100; i++) {
      const v = r.int(0, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

describe('noise', () => {
  it('is deterministic for same inputs', () => {
    expect(noise(5, 10, 42)).toBe(noise(5, 10, 42));
  });

  it('returns values between 0 and 1', () => {
    for (let i = 0; i < 50; i++) {
      const v = noise(i, i * 3, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('fractalNoise', () => {
  it('returns values between 0 and 1', () => {
    for (let i = 0; i < 20; i++) {
      const v = fractalNoise(i, i, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
```

**Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests pass (noise + WFC).

**Step 6: Commit**

```bash
git add src/core/noise.ts src/core/constants.ts src/core/schema.ts tests/unit/noise.test.ts
git commit -m "feat: migrate noise, constants, and schema to TS"
```

---

### Task 4: Migrate Map Infrastructure (autotiler, map-generator, chunk-manager, world-manager)

**Files:**
- Create: `src/map/autotiler.ts`
- Create: `src/map/map-generator.ts`
- Create: `src/map/chunk-manager.ts`
- Create: `src/map/world-manager.ts`

**Step 1: Create src/map/autotiler.ts**

Migrate `public/js/autotiler.js`:
- Convert singleton object to exported object with typed methods
- Replace `window.WFC?.TILES` references with import from `@/wfc`
- Add type annotations to all methods
- Remove `window.Autotiler = Autotiler`

**Step 2: Create src/map/map-generator.ts**

Migrate `public/js/map-generator.js`:
- Import `WFCEngine` from `@/wfc`
- Import `Random, fractalNoise` from `@/core/noise`
- Import types from `@/core/types`
- Export `generateMap()` and `generateWithWFC()` functions
- Remove all DOM references (`setStatus`, `document.getElementById`) — these functions should be pure, accepting options and returning a `GameMap`

**Step 3: Create src/map/chunk-manager.ts**

Migrate `public/js/ChunkManager.js`:
- `export class ChunkManager`
- Import `WFCEngine` from `@/wfc`
- Import `TILES` from `@/wfc` to replace `window.WFC?.TILES`
- Add types
- Remove `window.ChunkManager = ChunkManager`

**Step 4: Create src/map/world-manager.ts**

Migrate `public/js/WorldManager.js`:
- Convert object literal to `export const WorldManager = { ... }`
- Import `WorldSeed` type
- Remove `window.WorldManager = WorldManager`
- The `downloadAsFile` method uses `document.createElement('a')` — keep but note it needs a DOM (fine for browser, skip in tests)

**Step 5: Run tests**

Run: `npx vitest run`
Expected: All existing tests still pass. (New modules not directly tested yet — their consumers will exercise them.)

**Step 6: Commit**

```bash
git add src/map/
git commit -m "feat: migrate autotiler, map-generator, chunk-manager, world-manager to TS"
```

---

### Task 5: Build Top-Down Renderer

**Files:**
- Create: `src/render/camera.ts`
- Create: `src/render/renderer.ts`
- Create: `src/render/minimap.ts`
- Test: `tests/unit/camera.test.ts`

This is NEW code, not a migration. The old isometric renderer (~2,800 lines) is replaced.

**Step 1: Create src/render/camera.ts**

```ts
import type { Camera } from '@/core/types';

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
}

export function screenToWorld(camera: Camera, sx: number, sy: number, tileSize: number): { wx: number; wy: number } {
  const wx = (sx / camera.zoom + camera.x) / tileSize;
  const wy = (sy / camera.zoom + camera.y) / tileSize;
  return { wx: Math.floor(wx), wy: Math.floor(wy) };
}

export function worldToScreen(camera: Camera, wx: number, wy: number, tileSize: number): { sx: number; sy: number } {
  const sx = (wx * tileSize - camera.x) * camera.zoom;
  const sy = (wy * tileSize - camera.y) * camera.zoom;
  return { sx, sy };
}

export function pan(camera: Camera, dx: number, dy: number): void {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
}

export function zoomAt(camera: Camera, factor: number, cx: number, cy: number): void {
  const worldX = cx / camera.zoom + camera.x;
  const worldY = cy / camera.zoom + camera.y;
  camera.zoom = Math.max(0.25, Math.min(8, camera.zoom * factor));
  camera.x = worldX - cx / camera.zoom;
  camera.y = worldY - cy / camera.zoom;
}

export function centerOn(camera: Camera, worldX: number, worldY: number, viewWidth: number, viewHeight: number): void {
  camera.x = worldX - (viewWidth / camera.zoom) / 2;
  camera.y = worldY - (viewHeight / camera.zoom) / 2;
}
```

**Step 2: Create src/render/renderer.ts**

```ts
import type { GameMap, Camera } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS } from '@/core/constants';

/** Render the map to a canvas context */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number
): void {
  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Determine visible tile range
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endX = Math.min(map.width, Math.ceil((camera.x + canvasWidth / camera.zoom) / TILE_SIZE) + 1);
  const endY = Math.min(map.height, Math.ceil((camera.y + canvasHeight / camera.zoom) / TILE_SIZE) + 1);

  // Draw tiles
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      ctx.fillStyle = TILE_COLORS[tile.type] || '#FF00FF';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Draw grid lines at high zoom
  if (camera.zoom >= 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5 / camera.zoom;
    for (let y = startY; y <= endY; y++) {
      ctx.beginPath();
      ctx.moveTo(startX * TILE_SIZE, y * TILE_SIZE);
      ctx.lineTo(endX * TILE_SIZE, y * TILE_SIZE);
      ctx.stroke();
    }
    for (let x = startX; x <= endX; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, startY * TILE_SIZE);
      ctx.lineTo(x * TILE_SIZE, endY * TILE_SIZE);
      ctx.stroke();
    }
  }

  // Draw POI markers
  if (map.worldSeed?.pois) {
    for (const poi of map.worldSeed.pois) {
      if (!poi.position) continue;
      const icon = POI_ICONS[poi.type] || POI_ICONS.village;
      const px = (poi.position.x + 0.5) * TILE_SIZE;
      const py = (poi.position.y + 0.5) * TILE_SIZE;
      const r = TILE_SIZE * 0.8;

      ctx.fillStyle = icon.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (icon.shape === 'circle') {
        ctx.arc(px, py, r, 0, Math.PI * 2);
      } else if (icon.shape === 'triangle') {
        ctx.moveTo(px, py - r);
        ctx.lineTo(px - r, py + r * 0.6);
        ctx.lineTo(px + r, py + r * 0.6);
        ctx.closePath();
      } else if (icon.shape === 'square') {
        ctx.rect(px - r * 0.7, py - r * 0.7, r * 1.4, r * 1.4);
      } else { // diamond
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r, py);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label
      if (poi.name && camera.zoom >= 0.5) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(poi.name, px, py + r + 10 / camera.zoom);
      }
    }
  }

  // Draw village markers (from WFC generation)
  for (const v of map.villages) {
    if (!v.name) continue;
    const px = (v.x + 0.5) * TILE_SIZE;
    const py = (v.y + 0.5) * TILE_SIZE;
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(v.name, px, py - TILE_SIZE);
  }

  ctx.restore();
}
```

**Step 3: Create src/render/minimap.ts**

```ts
import type { GameMap, Camera } from '@/core/types';
import { TILE_COLORS, BG_COLOR } from '@/core/constants';

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  minimapWidth: number,
  minimapHeight: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  const scaleX = minimapWidth / map.width;
  const scaleY = minimapHeight / map.height;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (minimapWidth - map.width * scale) / 2;
  const offsetY = (minimapHeight - map.height * scale) / 2;

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, minimapWidth, minimapHeight);

  // Tiles (1 pixel per tile at small scale)
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      ctx.fillStyle = TILE_COLORS[tile.type] || '#333';
      ctx.fillRect(
        offsetX + x * scale,
        offsetY + y * scale,
        Math.max(1, scale),
        Math.max(1, scale)
      );
    }
  }

  // Viewport indicator
  const tileSize = 16; // TILE_SIZE
  const vpX = offsetX + (camera.x / tileSize) * scale;
  const vpY = offsetY + (camera.y / tileSize) * scale;
  const vpW = (canvasWidth / camera.zoom / tileSize) * scale;
  const vpH = (canvasHeight / camera.zoom / tileSize) * scale;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
}
```

**Step 4: Write camera test**

```ts
// tests/unit/camera.test.ts
import { describe, it, expect } from 'vitest';
import { createCamera, screenToWorld, pan, zoomAt, centerOn } from '../../src/render/camera';

describe('Camera', () => {
  it('creates default camera at origin', () => {
    const cam = createCamera();
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.zoom).toBe(1);
  });

  it('screenToWorld converts at zoom 1', () => {
    const cam = createCamera();
    const { wx, wy } = screenToWorld(cam, 32, 48, 16);
    expect(wx).toBe(2);
    expect(wy).toBe(3);
  });

  it('pan moves camera', () => {
    const cam = createCamera();
    pan(cam, 100, 50);
    expect(cam.x).toBe(-100);
    expect(cam.y).toBe(-50);
  });

  it('zoomAt clamps to range', () => {
    const cam = createCamera();
    zoomAt(cam, 100, 0, 0); // extreme zoom
    expect(cam.zoom).toBe(8); // max
    zoomAt(cam, 0.001, 0, 0);
    expect(cam.zoom).toBe(0.25); // min
  });

  it('centerOn positions camera', () => {
    const cam = createCamera();
    centerOn(cam, 100, 100, 800, 600);
    expect(cam.x).toBe(100 - 400);
    expect(cam.y).toBe(100 - 300);
  });
});
```

**Step 5: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/render/ tests/unit/camera.test.ts
git commit -m "feat: top-down renderer with camera, minimap"
```

---

### Task 6: Build Game Class and Wire Everything Together

**Files:**
- Create: `src/game.ts`
- Create: `src/core/state.ts`
- Modify: `src/main.ts`
- Modify: `index.html`
- Create: `src/ui/controls.ts`

**Step 1: Create src/core/state.ts**

```ts
import type { GameMap, Camera, WorldSeed } from '@/core/types';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  debug: boolean;
}

export function createState(): GameState {
  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    debug: false,
  };
}
```

**Step 2: Create src/ui/controls.ts**

Mouse/keyboard handlers that operate on GameState + Camera. All use `addEventListener`, no inline handlers.

```ts
import type { Camera } from '@/core/types';
import { pan, zoomAt, screenToWorld } from '@/render/camera';
import { TILE_SIZE } from '@/core/constants';

export interface ControlsCallbacks {
  onTileClick?: (x: number, y: number) => void;
  onRedraw: () => void;
}

export function attachControls(canvas: HTMLCanvasElement, camera: Camera, callbacks: ControlsCallbacks): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onMouseDown(e: MouseEvent) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    pan(camera, dx, dy);
    callbacks.onRedraw();
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging) return;
    dragging = false;
    // If barely moved, treat as click
    const dx = Math.abs(e.clientX - lastX);
    const dy = Math.abs(e.clientY - lastY);
    if (dx < 3 && dy < 3 && callbacks.onTileClick) {
      const rect = canvas.getBoundingClientRect();
      const { wx, wy } = screenToWorld(camera, e.clientX - rect.left, e.clientY - rect.top, TILE_SIZE);
      callbacks.onTileClick(wx, wy);
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(camera, factor, e.clientX - rect.left, e.clientY - rect.top);
    callbacks.onRedraw();
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', () => { dragging = false; });
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Return cleanup function
  return () => {
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}
```

**Step 3: Create src/game.ts**

```ts
import { createState, type GameState } from '@/core/state';
import { TILE_SIZE } from '@/core/constants';
import { WFCEngine } from '@/wfc';
import { renderMap } from '@/render/renderer';
import { renderMinimap } from '@/render/minimap';
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

  constructor(container: HTMLElement, options: GameOptions = {}) {
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
```

**Step 4: Update src/main.ts**

```ts
import { Game } from './game';

const container = document.getElementById('app');
if (container) {
  const game = new Game(container);
  game.generateWorld().then(() => {
    console.log('World generated');
  });

  // Expose for debugging
  (window as any).__game = game;
}
```

**Step 5: Update index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Small Gods</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; }
    #app { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**Step 6: Run dev server and verify**

Run: `npx vite`
Expected: Browser shows a top-down colored-rectangle map generated by WFC. Pan with drag, zoom with scroll wheel. Tile click logs to console.

**Step 7: Commit**

```bash
git add src/game.ts src/core/state.ts src/ui/controls.ts src/main.ts index.html
git commit -m "feat: Game class with top-down renderer and WFC generation"
```

---

### Task 7: Add Iframe Embed API

**Files:**
- Create: `src/embed/api.ts`
- Create: `src/embed/mount.ts`

**Step 1: Create src/embed/mount.ts**

```ts
import { Game, type GameOptions } from '@/game';

/**
 * Mount the game into any DOM element.
 * Returns a handle for controlling the game.
 */
export function mount(container: HTMLElement | string, options?: GameOptions): Game {
  const el = typeof container === 'string' ? document.getElementById(container) : container;
  if (!el) throw new Error(`Container not found: ${container}`);
  return new Game(el, options);
}
```

**Step 2: Create src/embed/api.ts**

PostMessage API for iframe host communication.

```ts
import { Game } from '@/game';

export interface EmbedMessage {
  type: string;
  payload?: any;
}

export function listenForHost(game: Game): () => void {
  function onMessage(event: MessageEvent<EmbedMessage>) {
    const { type, payload } = event.data || {};
    switch (type) {
      case 'generate':
        game.generateWorld(payload?.worldSeed, payload?.terrainOptions);
        break;
      case 'getState':
        window.parent.postMessage({ type: 'state', payload: { /* game state summary */ } }, '*');
        break;
    }
  }

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
```

**Step 3: Commit**

```bash
git add src/embed/
git commit -m "feat: iframe embed mount + postMessage API"
```

---

### Task 8: Delete Old Files and Clean Up

**Files:**
- Delete: all files listed in the design doc "What Gets Deleted" section
- Delete: `public/js/` directory (all old JS)
- Delete: `public/index.html` (replaced by root index.html)
- Delete: `src/wfc/*.js` (replaced by src/wfc/*.ts)
- Delete: `src/worldseed/` (replaced by src/core/schema.ts)
- Modify: `package.json` — remove `canvas` dependency, clean scripts
- Modify: `.gitignore`
- Update: `vitest.config.ts` — point to new src/ paths

**Step 1: Delete old JS files**

```bash
rm -rf public/js/
rm -rf public/data/decorations/
rm -f public/tiles.html
rm -f public/index.html
rm -f server.cjs
rm -rf src/wfc/*.js
rm -rf src/worldseed/
rm -rf src/tilegen/
rm -rf scripts/generate-*.cjs scripts/render-*.cjs scripts/test-*.cjs scripts/import-*.cjs scripts/tile-gen-prototype.cjs
rm -rf tiles/
rm -rf roadTiles_nova/
rm -rf prototypes/
rm -rf test-renders/
rm -f generate-test-images.js
```

**Step 2: Update package.json**

Remove `canvas` from dependencies (was only needed for server-side tile rendering). Update scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
  }
}
```

**Step 3: Update vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
  },
});
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass with new paths.

**Step 5: Run build**

Run: `npx vite build`
Expected: Clean build to `dist/`, no errors.

**Step 6: Run dev server**

Run: `npx vite`
Expected: Game loads, generates map, pan/zoom works.

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete old JS, AI rendering, server — clean TS-only codebase"
```

---

### Task 9: Update Tests and Final Verification

**Files:**
- Modify: `tests/unit/wfc.test.ts` — verify against real TS imports
- Delete: `tests/unit/chunk-manager.test.js` — rewrite as `.test.ts`
- Create: `tests/unit/chunk-manager.test.ts`
- Create: `tests/unit/autotiler.test.ts`

**Step 1: Rewrite chunk-manager test**

Import `ChunkManager` from `@/map/chunk-manager`. Keep same test cases but use real imports instead of duplicated test implementations.

**Step 2: Write autotiler test**

```ts
import { describe, it, expect } from 'vitest';
import { Autotiler } from '../../src/map/autotiler';

describe('Autotiler', () => {
  it('returns road_ns for N+S road neighbors', () => {
    const variant = Autotiler.getVisualVariant('road', { n: 'road', e: 'grass', s: 'road', w: 'grass' });
    expect(variant).toMatch(/road_/);
  });

  it('returns grass for isolated grass tile', () => {
    const variant = Autotiler.getVisualVariant('grass', { n: 'grass', e: 'grass', s: 'grass', w: 'grass' });
    expect(variant).toBe('grass');
  });

  it('returns shore variant when adjacent to water', () => {
    const variant = Autotiler.getVisualVariant('grass', { n: 'water', e: 'grass', s: 'grass', w: 'grass' });
    expect(variant).toMatch(/shore/);
  });
});
```

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 4: Run build and verify**

Run: `npx vite build && npx vite preview`
Expected: Production build works, game is playable.

**Step 5: Final commit**

```bash
git add -A
git commit -m "test: update all tests for TS module imports"
```

---

### Task 10: Update Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/IMPLEMENTATION.md`

**Step 1: Update CLAUDE.md**

Remove all AI rendering sections, server.cjs references, tile generation documentation. Update file locations table to reflect new `src/` structure. Add note about iframe embedding.

**Step 2: Update IMPLEMENTATION.md**

Mark Phases 1-6 as complete with note that map system was simplified from isometric+AI to top-down placeholder. Update Phase 7+ to reflect that the codebase is now TS modules.

**Step 3: Commit**

```bash
git add CLAUDE.md docs/IMPLEMENTATION.md
git commit -m "docs: update for TS migration and simplified renderer"
```
