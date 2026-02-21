# LPC Sprites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace color-placeholder terrain tiles and building boxes with real LPC pixel art loaded from per-group terrain sheets and per-building sprite files.

**Architecture:** Individual PNG per terrain group in `public/sprites/terrain/{group}.png`; individual PNG per building in `public/sprites/buildings/{templateId}.png`. RenderContext carries `terrainSheets: Map<string, HTMLImageElement>` and `buildingSprites: Map<string, HTMLImageElement>`. Renderer looks up by key, falls back to Kenney/colored-box if file missing.

**Tech Stack:** TypeScript, Canvas 2D, Vite dev server, Vitest

---

### Task 1: Simplify terrain-atlas.ts + add test

The current file exports `getTerrainAtlasCoords(terrainGroup, blobIndex)` which needs a combined atlas with row offsets. We're replacing it with a simpler `getTerrainSpriteCoords(blobIndex)` that just returns the column/row within a per-terrain-group sheet.

**Files:**
- Modify: `src/render/terrain-atlas.ts`
- Create: `tests/unit/terrain-atlas.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/terrain-atlas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getTerrainSpriteCoords } from '@/render/terrain-atlas';

describe('getTerrainSpriteCoords', () => {
  it('maps blobIndex 0 to col 0, row 0', () => {
    expect(getTerrainSpriteCoords(0)).toEqual({ col: 0, row: 0 });
  });

  it('maps blobIndex 5 to col 5, row 0 (last in first row)', () => {
    expect(getTerrainSpriteCoords(5)).toEqual({ col: 5, row: 0 });
  });

  it('maps blobIndex 6 to col 0, row 1 (wraps to next row)', () => {
    expect(getTerrainSpriteCoords(6)).toEqual({ col: 0, row: 1 });
  });

  it('maps blobIndex 46 to col 4, row 7 (last valid blob index)', () => {
    expect(getTerrainSpriteCoords(46)).toEqual({ col: 4, row: 7 });
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd /Users/Morten/mcpui/small-gods-game && npm test -- terrain-atlas 2>&1 | tail -20
```
Expected: FAIL — `getTerrainSpriteCoords` not exported

**Step 3: Rewrite terrain-atlas.ts**

Replace the entire file content with:

```typescript
/**
 * Terrain Atlas — maps blobIndex to (col, row) within a per-group terrain sheet.
 *
 * Each terrain group has its own PNG at public/sprites/terrain/{group}.png.
 * Sheet format (LPC blob autotile standard):
 *   6 columns × 8 rows of 32×32 tiles = 192×256 px
 *   blobIndex 0–46 → col = idx % 6, row = floor(idx / 6)
 *
 * Adding a new terrain type:
 *   1. Drop public/sprites/terrain/{group}.png (192×256, 6×8 tiles)
 *   2. Add the group name to TERRAIN_GROUPS in src/map/blob-autotiler.ts
 *   No renderer changes needed.
 */

/** Tile size in the LPC terrain sheets (32×32 px) */
export const LPC_TILE_SIZE = 32;

/**
 * Returns the (col, row) position of a blob variant within a terrain group sheet.
 * The sheet must be 6 columns wide; rows continue until all 47 variants fit.
 */
export function getTerrainSpriteCoords(blobIndex: number): { col: number; row: number } {
  return {
    col: blobIndex % 6,
    row: Math.floor(blobIndex / 6),
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
npm test -- terrain-atlas 2>&1 | tail -10
```
Expected: 4 tests pass

**Step 5: Commit**

```bash
git add src/render/terrain-atlas.ts tests/unit/terrain-atlas.test.ts
git commit -m "refactor: simplify terrain-atlas to per-group sheet coords"
```

---

### Task 2: Update RenderContext types

Replace `terrainAtlas: HTMLImageElement | null` with `terrainSheets: Map<string, HTMLImageElement>` and add `buildingSprites: Map<string, HTMLImageElement>`.

**Files:**
- Modify: `src/core/types.ts` (lines 141–154)

**Step 1: Edit RenderContext in types.ts**

Find this block (around line 141):
```typescript
export interface RenderContext {
  map: GameMap;
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
  npcs: NpcInstance[];
  npcSheets: Map<string, HTMLCanvasElement>;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  tileAtlas: HTMLImageElement | null;
  terrainAtlas: HTMLImageElement | null;
  decorations: DecorationInstance[];
  treeSheets: Map<string, HTMLImageElement>;
}
```

Replace with:
```typescript
export interface RenderContext {
  map: GameMap;
  camera: Camera;
  canvasWidth: number;
  canvasHeight: number;
  npcs: NpcInstance[];
  npcSheets: Map<string, HTMLCanvasElement>;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  tileAtlas: HTMLImageElement | null;
  terrainSheets: Map<string, HTMLImageElement>;   // one per terrain group
  buildingSprites: Map<string, HTMLImageElement>; // one per building templateId
  decorations: DecorationInstance[];
  treeSheets: Map<string, HTMLImageElement>;
}
```

**Step 2: Verify TypeScript catches the breakage**

```bash
npm run build 2>&1 | grep "error TS" | head -20
```
Expected: errors in `renderer.ts` and `game.ts` referencing `terrainAtlas` — that's correct, we'll fix those next.

**Step 3: Commit the type change**

```bash
git add src/core/types.ts
git commit -m "refactor: RenderContext terrainAtlas→terrainSheets + add buildingSprites"
```

---

### Task 3: Update renderer.ts — terrain drawing

Update `drawTerrain()` to use `rc.terrainSheets` and update the import.

**Files:**
- Modify: `src/render/renderer.ts`

**Step 1: Update import at top of renderer.ts**

Find:
```typescript
import { getTerrainAtlasCoords } from '@/render/terrain-atlas';
```
Replace with:
```typescript
import { getTerrainSpriteCoords, LPC_TILE_SIZE } from '@/render/terrain-atlas';
```

**Step 2: Update the LPC terrain block in drawTerrain()**

Find this block (around line 49–60):
```typescript
      // --- LPC terrain atlas (blob autotiled) ---
      if (rc.blobMap && rc.terrainAtlas) {
        const blob = rc.blobMap[y]?.[x];
        if (blob) {
          const coords = getTerrainAtlasCoords(blob.terrainGroup, blob.blobIndex);
          if (coords) {
            ctx.drawImage(rc.terrainAtlas, coords.sx, coords.sy, coords.sw, coords.sh, px, py, TILE_SIZE, TILE_SIZE);
            drawRoadOverlay(ctx, rc, x, y, px, py);
            continue;
          }
        }
      }
```

Replace with:
```typescript
      // --- LPC terrain sheets (blob autotiled, one PNG per terrain group) ---
      if (rc.blobMap && rc.terrainSheets.size > 0) {
        const blob = rc.blobMap[y]?.[x];
        const sheet = blob ? rc.terrainSheets.get(blob.terrainGroup) : undefined;
        if (blob && sheet) {
          const { col, row } = getTerrainSpriteCoords(blob.blobIndex);
          ctx.drawImage(sheet, col * LPC_TILE_SIZE, row * LPC_TILE_SIZE, LPC_TILE_SIZE, LPC_TILE_SIZE,
                        px, py, TILE_SIZE, TILE_SIZE);
          drawRoadOverlay(ctx, rc, x, y, px, py);
          continue;
        }
      }
```

**Step 3: Verify build — only game.ts errors should remain**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```
Expected: only `game.ts` errors about `terrainAtlas`

**Step 4: Commit**

```bash
git add src/render/renderer.ts
git commit -m "refactor: renderer drawTerrain uses terrainSheets map"
```

---

### Task 4: Update renderer.ts — building sprites

Update the buildings section in `drawYSortedEntities()` to draw sprite PNGs when available, with the existing colored-box as fallback.

**Files:**
- Modify: `src/render/renderer.ts` (buildings loop, approx lines 193–222)

**Step 1: Replace the buildings loop**

Find this entire block (the buildings loop in drawYSortedEntities):
```typescript
  // Buildings
  for (const building of (map.buildings ?? [])) {
    const template = getBuildingTemplate(building.templateId);
    if (!template) continue;
    const bx = building.tileX * TILE_SIZE;
    const by = building.tileY * TILE_SIZE;
    const bw = template.footprint.w * TILE_SIZE;
    const bh = template.footprint.h * TILE_SIZE;
    if (bx + bw < camLeft || bx > camRight || by + bh < camTop || by > camBottom) continue;

    const color = BUILDING_COLORS[template.category] ?? '#A1887F';
    const sortY = (building.tileY + template.footprint.h) * TILE_SIZE;
    const name = template.name;
    const zoom = camera.zoom;
    entities.push({
      sortY,
      draw: (c) => {
        c.fillStyle = color;
        c.fillRect(bx, by, bw, bh);
        c.strokeStyle = 'rgba(0,0,0,0.4)';
        c.lineWidth = 1;
        c.strokeRect(bx, by, bw, bh);
        if (zoom >= 0.5) {
          c.fillStyle = '#fff';
          c.font = `${Math.max(6, 9 / zoom)}px sans-serif`;
          c.textAlign = 'center';
          c.fillText(name, bx + bw / 2, by + bh / 2 + 3);
        }
      },
    });
  }
```

Replace with:
```typescript
  // Buildings
  for (const building of (map.buildings ?? [])) {
    const template = getBuildingTemplate(building.templateId);
    if (!template) continue;
    const bx = building.tileX * TILE_SIZE;
    const by = building.tileY * TILE_SIZE;
    const bw = template.footprint.w * TILE_SIZE;
    const bh = template.footprint.h * TILE_SIZE;
    if (bx + bw < camLeft || bx > camRight || by + bh < camTop || by > camBottom) continue;

    const sortY = (building.tileY + template.footprint.h) * TILE_SIZE;
    const sprite = rc.buildingSprites.get(building.templateId);

    if (sprite) {
      // LPC sprite: draw at spriteOffset from tile origin, at spriteSize pixels
      const dx = bx + template.spriteOffset.x;
      const dy = by + template.spriteOffset.y;
      const sw = template.spriteSize.w;
      const sh = template.spriteSize.h;
      entities.push({
        sortY,
        draw: (c) => { c.drawImage(sprite, 0, 0, sw, sh, dx, dy, sw, sh); },
      });
    } else {
      // Fallback: colored rectangle with name label
      const color = BUILDING_COLORS[template.category] ?? '#A1887F';
      const name = template.name;
      const zoom = camera.zoom;
      entities.push({
        sortY,
        draw: (c) => {
          c.fillStyle = color;
          c.fillRect(bx, by, bw, bh);
          c.strokeStyle = 'rgba(0,0,0,0.4)';
          c.lineWidth = 1;
          c.strokeRect(bx, by, bw, bh);
          if (zoom >= 0.5) {
            c.fillStyle = '#fff';
            c.font = `${Math.max(6, 9 / zoom)}px sans-serif`;
            c.textAlign = 'center';
            c.fillText(name, bx + bw / 2, by + bh / 2 + 3);
          }
        },
      });
    }
  }
```

**Step 2: Verify only game.ts errors remain**

```bash
npm run build 2>&1 | grep "error TS" | head -10
```

**Step 3: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat: building renderer uses sprite PNG when available, box fallback"
```

---

### Task 5: Update game.ts — asset loading

Replace `terrainAtlas` with `terrainSheets` and add `buildingSprites`. Add two loading methods.

**Files:**
- Modify: `src/game.ts`

**Step 1: Replace the private field declarations**

Find:
```typescript
  private terrainAtlas: HTMLImageElement | null = null;
```
Replace with:
```typescript
  private terrainSheets = new Map<string, HTMLImageElement>();
  private buildingSprites = new Map<string, HTMLImageElement>();
```

**Step 2: Replace the loadImage calls in generateWorld()**

Find:
```typescript
    if (!this.terrainAtlas) {
      this.terrainAtlas = await this.loadImage('/sprites/terrain/lpc-terrain.png');
    }
```
Replace with:
```typescript
    await this.loadTerrainSheets();
    await this.loadBuildingSprites();
```

**Step 3: Add two private loading methods** (place after `loadTreeSheets()`)

```typescript
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
```

**Step 4: Update the render() method's RenderContext construction**

Find:
```typescript
      terrainAtlas: this.terrainAtlas,
```
Replace with:
```typescript
      terrainSheets: this.terrainSheets,
      buildingSprites: this.buildingSprites,
```

**Step 5: Verify build is clean**

```bash
npm run build 2>&1 | grep "error TS"
```
Expected: no errors

**Step 6: Run all tests**

```bash
npm test 2>&1 | tail -10
```
Expected: 192 tests pass (191 existing + 4 new terrain-atlas tests)

**Step 7: Commit**

```bash
git add src/game.ts
git commit -m "feat: game loads terrain sheets + building sprites from /sprites/"
```

---

### Task 6: Create docs/ASSETS_SETUP.md

Create a clear download guide that doubles as the canonical asset registry.

**Files:**
- Create: `docs/ASSETS_SETUP.md`

**Step 1: Create the file**

```markdown
# Art Assets Setup

All art assets use CC-BY-SA 3.0/4.0 from OpenGameArt.org (bluecarrot16).
Download once and place in the correct paths. The game gracefully falls back
to Kenney tiles / colored boxes for any missing files.

---

## Terrain Sheets

**Source:** https://opengameart.org/content/lpc-terrains
**Author:** bluecarrot16 | **License:** CC-BY-SA 3.0/4.0

Each terrain sheet: 192×256 px (6 cols × 8 rows of 32×32 tiles, 47 blob variants).

| File | Terrain Group | Notes |
|------|--------------|-------|
| `public/sprites/terrain/grass.png` | grass | Primary ground |
| `public/sprites/terrain/water.png` | water | Lakes, rivers |
| `public/sprites/terrain/dirt.png`  | dirt  | Paths, earth |
| `public/sprites/terrain/sand.png`  | sand  | Beaches, desert |
| `public/sprites/terrain/stone.png` | stone | Stone roads, castle floors |
| `public/sprites/terrain/rocky.png` | rocky | Mountains, quarry |

**To add a new terrain type:**
1. Drop `public/sprites/terrain/{group}.png` (192×256 px, 6×8 blob tiles)
2. Add one entry to `TERRAIN_GROUPS` in `src/map/blob-autotiler.ts`
3. No renderer changes needed.

---

## Building Sprites

**Source:** https://opengameart.org/content/lpc-thatched-roof-cottage
**Author:** bluecarrot16 | **License:** CC-BY-SA 3.0

Each building is a pre-composed LPC oblique 3/4-view PNG.
Size must match `spriteSize` in `src/map/building-templates.ts`.

| File | Template ID | Sprite Size | Category |
|------|------------|-------------|----------|
| `public/sprites/buildings/cottage.png`      | cottage      | 96×128 px  | residential |
| `public/sprites/buildings/temple_small.png` | temple_small | 128×160 px | religious |
| `public/sprites/buildings/farm_barn.png`    | farm_barn    | 96×96 px   | farm |
| `public/sprites/buildings/market_stall.png` | market_stall | 64×80 px   | commercial |
| `public/sprites/buildings/tavern.png`       | tavern       | 96×128 px  | commercial |
| `public/sprites/buildings/tower.png`        | tower        | 64×160 px  | military |
| `public/sprites/buildings/castle_keep.png`  | castle_keep  | 128×192 px | military |
| `public/sprites/buildings/dock.png`         | dock         | 64×96 px   | special |

**To add a new building type:**
1. Drop `public/sprites/buildings/{templateId}.png`
2. Add one entry to `BUILDING_TEMPLATES` in `src/map/building-templates.ts`
3. No renderer changes needed.

---

## Tree Sprites (already installed)

**Source:** LPC Base Assets | **License:** CC-BY-SA 3.0

| File | Variant |
|------|---------|
| `public/sprites/trees/trees-green.png`  | green  |
| `public/sprites/trees/trees-orange.png` | orange |
| `public/sprites/trees/trees-dead.png`   | dead   |
| `public/sprites/trees/trees-pale.png`   | pale   |
| `public/sprites/trees/trees-brown.png`  | brown  |

**To add a new tree variant:**
1. Drop `public/sprites/trees/trees-{variant}.png`
2. Add variant name to the `variants` array in `game.ts loadTreeSheets()`

---

## Fallback Behavior

If any file is missing, the game falls back gracefully:
- Terrain sheet missing → Kenney Tiny Town tile → TILE_COLORS flat color
- Building sprite missing → colored rectangle with building name label
- Tree variant missing → that variant silently skipped

---

## Attribution

All CC-BY-SA assets require attribution in distributed builds.
See `CREDITS.md` for full credit chains.
```

**Step 2: Commit**

```bash
git add docs/ASSETS_SETUP.md
git commit -m "docs: ASSETS_SETUP.md — terrain sheets, building sprites, tree variants"
```

---

## Verification

After all tasks complete, run dev server and confirm:

```bash
npm run dev
```

1. Without any LPC files: game renders exactly as before (Kenney tiles + colored boxes — fallback works)
2. After dropping `public/sprites/terrain/grass.png`: grass tiles show LPC terrain sprites
3. After dropping `public/sprites/buildings/cottage.png`: cottage buildings show LPC sprite
4. `npm test` → 192 tests pass
5. `npm run build` → TypeScript clean, no errors
