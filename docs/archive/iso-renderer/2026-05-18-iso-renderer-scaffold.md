# Iso Renderer Scaffold (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the iso renderer scaffold — a flag-gated parallel renderer at `src/render/iso/` that mirrors the top-down renderer's pipeline shape, uses dimetric 2:1 projection at 128×64 tile size, and renders correctly with placeholder shapes (flat-color diamonds, extruded colored boxes, colored circles) while real art trickles in via later PRs.

**Architecture:** Mirror the existing top-down `renderer.ts` three-phase pipeline (terrain → Y-sorted entities → overlays) in a parallel module tree at `src/render/iso/`. Logical world data (square tile grid, sim, snapshots) is unchanged. `game.ts` selects renderer at construction via dynamic import based on a localStorage flag `smallgods.render.mode`. Dev-only until a later "flag-flip" PR exposes the setting in the UI.

**Tech Stack:** TypeScript, Canvas 2D, Vitest, existing `RenderContext` shape from `src/core/types.ts`, existing `TILE_COLORS` and `BUILDING_TEMPLATES`.

**Spec:** `docs/superpowers/specs/2026-05-18-iso-renderer-design.md`

**Scope (this PR):** Scaffold only. Placeholder visuals. Dev-only flag. No real iso art — that comes in PRs 2-5 of the spec, each with their own plan.

---

## File Structure

**Create:**
- `src/render/iso/iso-projection.ts` — `(tx,ty,z) ↔ screen` math, visible-tile cull
- `src/render/iso/iso-camera.ts` — camera factory + pan/zoom for iso world bounds
- `src/render/iso/iso-ysort.ts` — Y-sort bucket builder + sort key computation
- `src/render/iso/iso-terrain.ts` — diamond terrain pass (uses fallback `TILE_COLORS` until iso atlas exists)
- `src/render/iso/iso-sprites.ts` — fallback sprite draw (colored boxes for buildings, colored circles for NPCs, colored triangles for trees)
- `src/render/iso/iso-overlay.ts` — overlays pass (past-veil only in PR 1; sigils/heatmap deferred)
- `src/render/iso/iso-atlas.ts` — skeleton atlas loader (returns null for every lookup; PR 2-5 fill it in)
- `src/render/iso/iso-renderer.ts` — entrypoint; stitches the three phases together
- `src/render/iso/iso-constants.ts` — `ISO_TILE_W = 128`, `ISO_TILE_H = 64`
- `tests/unit/iso-projection.test.ts`
- `tests/unit/iso-camera.test.ts`
- `tests/unit/iso-ysort.test.ts`
- `tests/unit/iso-renderer.test.ts` (integration: render canned RenderContext to OffscreenCanvas, assert no throws + drawImage call count)

**Modify:**
- `src/game.ts` — read `smallgods.render.mode` from localStorage; dynamic import + mount the chosen renderer
- `src/ui/overlay-dispatcher.ts` — make pick math mode-aware (delegate to iso-projection inverse when in iso mode)

**Unchanged but verified by tests:**
- `src/render/renderer.ts` (top-down stays default)
- `src/core/types.ts` `RenderContext` shape

---

### Task 1: Constants + projection (forward direction)

**Files:**
- Create: `src/render/iso/iso-constants.ts`
- Create: `src/render/iso/iso-projection.ts`
- Test: `tests/unit/iso-projection.test.ts`

- [ ] **Step 1: Write failing tests for `worldToScreen`**

```ts
// tests/unit/iso-projection.test.ts
import { describe, it, expect } from 'vitest';
import { worldToScreen } from '@/render/iso/iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';

describe('iso-projection: worldToScreen', () => {
  it('origin tile (0,0,0) maps to (originX, originY)', () => {
    const { sx, sy } = worldToScreen(0, 0, 0, 1000, 500);
    expect(sx).toBe(1000);
    expect(sy).toBe(500);
  });

  it('east tile (1,0,0) shifts +W/2 right and +H/2 down', () => {
    const { sx, sy } = worldToScreen(1, 0, 0, 0, 0);
    expect(sx).toBe(ISO_TILE_W / 2);
    expect(sy).toBe(ISO_TILE_H / 2);
  });

  it('south tile (0,1,0) shifts -W/2 left and +H/2 down', () => {
    const { sx, sy } = worldToScreen(0, 1, 0, 0, 0);
    expect(sx).toBe(-ISO_TILE_W / 2);
    expect(sy).toBe(ISO_TILE_H / 2);
  });

  it('z subtracts from sy (height lifts sprite up)', () => {
    const { sy } = worldToScreen(0, 0, 32, 0, 0);
    expect(sy).toBe(-32);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run tests/unit/iso-projection.test.ts`
Expected: FAIL — module `@/render/iso/iso-projection` not found.

- [ ] **Step 3: Implement constants**

```ts
// src/render/iso/iso-constants.ts
export const ISO_TILE_W = 128;
export const ISO_TILE_H = 64;
```

- [ ] **Step 4: Implement `worldToScreen`**

```ts
// src/render/iso/iso-projection.ts
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';

export function worldToScreen(
  tx: number, ty: number, z: number,
  originX: number, originY: number,
): { sx: number; sy: number } {
  return {
    sx: (tx - ty) * (ISO_TILE_W / 2) + originX,
    sy: (tx + ty) * (ISO_TILE_H / 2) - z + originY,
  };
}
```

- [ ] **Step 5: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-projection.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add src/render/iso/iso-constants.ts src/render/iso/iso-projection.ts tests/unit/iso-projection.test.ts
git commit -m "feat(iso): worldToScreen projection (dimetric 2:1, 128x64)"
```

---

### Task 2: Projection inverse (tile picking)

**Files:**
- Modify: `src/render/iso/iso-projection.ts`
- Test: `tests/unit/iso-projection.test.ts` (extend)

- [ ] **Step 1: Write failing tests for `screenToTile`**

```ts
// append to tests/unit/iso-projection.test.ts
import { screenToTile, worldToScreen } from '@/render/iso/iso-projection';

describe('iso-projection: screenToTile (inverse)', () => {
  it('inverts worldToScreen on the foot of the tile', () => {
    for (const [tx, ty] of [[0, 0], [3, 7], [15, 2], [9, 9]]) {
      const { sx, sy } = worldToScreen(tx, ty, 0, 1000, 500);
      const tile = screenToTile(sx, sy, 1000, 500);
      expect(tile).toEqual({ tx, ty });
    }
  });

  it('picks the same tile for any point inside its diamond footprint', () => {
    // diamond around (5,5) covers a region — test a few interior points
    const { sx: cx, sy: cy } = worldToScreen(5, 5, 0, 0, 0);
    expect(screenToTile(cx, cy, 0, 0)).toEqual({ tx: 5, ty: 5 });
    expect(screenToTile(cx + 10, cy, 0, 0)).toEqual({ tx: 5, ty: 5 });
    expect(screenToTile(cx - 10, cy, 0, 0)).toEqual({ tx: 5, ty: 5 });
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run tests/unit/iso-projection.test.ts`
Expected: FAIL — `screenToTile` is not exported.

- [ ] **Step 3: Implement `screenToTile`**

```ts
// append to src/render/iso/iso-projection.ts
export function screenToTile(
  sx: number, sy: number,
  originX: number, originY: number,
): { tx: number; ty: number } {
  const fx = (sx - originX) / (ISO_TILE_W / 2);
  const fy = (sy - originY) / (ISO_TILE_H / 2);
  return {
    tx: Math.floor((fx + fy) / 2),
    ty: Math.floor((fy - fx) / 2),
  };
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-projection.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-projection.ts tests/unit/iso-projection.test.ts
git commit -m "feat(iso): screenToTile inverse projection for picking"
```

---

### Task 3: Visible-tile cull

**Files:**
- Modify: `src/render/iso/iso-projection.ts`
- Test: `tests/unit/iso-projection.test.ts` (extend)

- [ ] **Step 1: Write failing tests for `visibleTileBounds`**

```ts
// append to tests/unit/iso-projection.test.ts
import { visibleTileBounds } from '@/render/iso/iso-projection';

describe('iso-projection: visibleTileBounds', () => {
  it('returns a bounding tile range covering the viewport corners', () => {
    // viewport 800×600 centered at world (0,0) → diamond covers some tile range
    const b = visibleTileBounds({ originX: 400, originY: 300 }, 800, 600);
    expect(b.minTx).toBeLessThan(0);
    expect(b.maxTx).toBeGreaterThan(0);
    expect(b.minTy).toBeLessThan(0);
    expect(b.maxTy).toBeGreaterThan(0);
  });

  it('clamps to provided map bounds when given', () => {
    const b = visibleTileBounds({ originX: 400, originY: 300 }, 800, 600, { mapW: 128, mapH: 96 });
    expect(b.minTx).toBeGreaterThanOrEqual(0);
    expect(b.minTy).toBeGreaterThanOrEqual(0);
    expect(b.maxTx).toBeLessThan(128);
    expect(b.maxTy).toBeLessThan(96);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run tests/unit/iso-projection.test.ts`
Expected: FAIL — `visibleTileBounds` is not exported.

- [ ] **Step 3: Implement `visibleTileBounds`**

```ts
// append to src/render/iso/iso-projection.ts
export interface IsoOrigin { originX: number; originY: number }
export interface TileBounds { minTx: number; maxTx: number; minTy: number; maxTy: number }

export function visibleTileBounds(
  origin: IsoOrigin,
  canvasWidth: number,
  canvasHeight: number,
  clamp?: { mapW: number; mapH: number },
): TileBounds {
  // Inverse-project the four canvas corners → take min/max tile coords.
  const corners: Array<{ tx: number; ty: number }> = [
    screenToTile(0, 0, origin.originX, origin.originY),
    screenToTile(canvasWidth, 0, origin.originX, origin.originY),
    screenToTile(0, canvasHeight, origin.originX, origin.originY),
    screenToTile(canvasWidth, canvasHeight, origin.originX, origin.originY),
  ];
  let minTx = corners[0].tx, maxTx = corners[0].tx;
  let minTy = corners[0].ty, maxTy = corners[0].ty;
  for (const c of corners) {
    if (c.tx < minTx) minTx = c.tx;
    if (c.tx > maxTx) maxTx = c.tx;
    if (c.ty < minTy) minTy = c.ty;
    if (c.ty > maxTy) maxTy = c.ty;
  }
  // Pad by 1 to cover tiles whose anchor is just off-screen but whose
  // diamond still overlaps the viewport.
  minTx -= 1; minTy -= 1; maxTx += 1; maxTy += 1;
  if (clamp) {
    minTx = Math.max(0, minTx);
    minTy = Math.max(0, minTy);
    maxTx = Math.min(clamp.mapW - 1, maxTx);
    maxTy = Math.min(clamp.mapH - 1, maxTy);
  }
  return { minTx, maxTx, minTy, maxTy };
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-projection.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-projection.ts tests/unit/iso-projection.test.ts
git commit -m "feat(iso): visibleTileBounds cull for viewport"
```

---

### Task 4: Iso camera factory

**Files:**
- Create: `src/render/iso/iso-camera.ts`
- Test: `tests/unit/iso-camera.test.ts`

The iso camera reuses the existing `Camera` type (`{ x, y, zoom, dragging, lastX, lastY }`) so `ui/controls.ts` pan/zoom handlers work unchanged. This module just provides factories and an iso-tuned zoom range (0.5×–4×) plus a "center on tile" helper that knows about iso projection.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/iso-camera.test.ts
import { describe, it, expect } from 'vitest';
import { createIsoCamera, centerOnTile, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from '@/render/iso/iso-camera';
import { worldToScreen } from '@/render/iso/iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';

describe('iso-camera', () => {
  it('createIsoCamera returns default-position camera at zoom 1', () => {
    const c = createIsoCamera();
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.zoom).toBe(1);
    expect(c.dragging).toBe(false);
  });

  it('exposes iso zoom range constants', () => {
    expect(ISO_ZOOM_MIN).toBe(0.5);
    expect(ISO_ZOOM_MAX).toBe(4);
  });

  it('centerOnTile sets camera so the tile renders at viewport center', () => {
    const c = createIsoCamera();
    centerOnTile(c, 10, 10, 800, 600);
    // After centering, worldToScreen(10,10,0, -c.x, -c.y) should land at (400, 300).
    const { sx, sy } = worldToScreen(10, 10, 0, -c.x, -c.y);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(300);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run tests/unit/iso-camera.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement iso-camera**

```ts
// src/render/iso/iso-camera.ts
import type { Camera } from '@/core/types';
import { worldToScreen } from './iso-projection';

export const ISO_ZOOM_MIN = 0.5;
export const ISO_ZOOM_MAX = 4;

export function createIsoCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };
}

export function centerOnTile(
  camera: Camera,
  tx: number, ty: number,
  viewWidth: number, viewHeight: number,
): void {
  const { sx, sy } = worldToScreen(tx, ty, 0, 0, 0);
  camera.x = sx - viewWidth / (2 * camera.zoom);
  camera.y = sy - viewHeight / (2 * camera.zoom);
}

export function clampIsoZoom(z: number): number {
  return Math.max(ISO_ZOOM_MIN, Math.min(ISO_ZOOM_MAX, z));
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-camera.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-camera.ts tests/unit/iso-camera.test.ts
git commit -m "feat(iso): iso-camera factory with iso zoom range and centerOnTile"
```

---

### Task 5: Y-sort bucket — single-tile entities

**Files:**
- Create: `src/render/iso/iso-ysort.ts`
- Test: `tests/unit/iso-ysort.test.ts`

The Y-sort module collects entities into a single bucket keyed by `(tx + ty, z, kindPriority)`. PR 1 handles single-tile entities (NPCs, trees, decorations). Multi-tile buildings come in the next task.

- [ ] **Step 1: Write failing tests**

```ts
// tests/unit/iso-ysort.test.ts
import { describe, it, expect } from 'vitest';
import { buildYSortBucket, type YSortEntry } from '@/render/iso/iso-ysort';

describe('iso-ysort: single-tile entities', () => {
  it('sorts by (tx+ty) ascending (back-to-front paint order)', () => {
    const entries: YSortEntry[] = [
      { id: 'a', kind: 'npc', tx: 5, ty: 5, z: 0, kindPriority: 0 },
      { id: 'b', kind: 'npc', tx: 1, ty: 1, z: 0, kindPriority: 0 },
      { id: 'c', kind: 'npc', tx: 9, ty: 0, z: 0, kindPriority: 0 },
    ];
    const sorted = buildYSortBucket(entries);
    expect(sorted.map(e => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks ties with z then kindPriority', () => {
    const entries: YSortEntry[] = [
      { id: 'low',  kind: 'npc',  tx: 3, ty: 3, z: 0, kindPriority: 1 },
      { id: 'high', kind: 'tree', tx: 3, ty: 3, z: 50, kindPriority: 0 },
      { id: 'same', kind: 'deco', tx: 3, ty: 3, z: 0, kindPriority: 0 },
    ];
    const sorted = buildYSortBucket(entries);
    // same z=0: kindPriority 0 (deco) before 1 (npc); then z=50 (tree) last
    expect(sorted.map(e => e.id)).toEqual(['same', 'low', 'high']);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run tests/unit/iso-ysort.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildYSortBucket` for single-tile entries**

```ts
// src/render/iso/iso-ysort.ts
export type IsoEntityKind = 'npc' | 'tree' | 'deco' | 'building' | 'road' | 'river';

export interface YSortEntry {
  id: string;
  kind: IsoEntityKind;
  tx: number;
  ty: number;
  z: number;
  kindPriority: number;
  // For multi-tile entities, set sortTx/sortTy to the back-most footprint tile
  // (handled in Task 6). For single-tile, omit them and tx/ty are used.
  sortTx?: number;
  sortTy?: number;
}

export function buildYSortBucket(entries: YSortEntry[]): YSortEntry[] {
  const sorted = [...entries];
  sorted.sort((a, b) => {
    const aKey = (a.sortTx ?? a.tx) + (a.sortTy ?? a.ty);
    const bKey = (b.sortTx ?? b.tx) + (b.sortTy ?? b.ty);
    if (aKey !== bKey) return aKey - bKey;
    if (a.z !== b.z) return a.z - b.z;
    return a.kindPriority - b.kindPriority;
  });
  return sorted;
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-ysort.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-ysort.ts tests/unit/iso-ysort.test.ts
git commit -m "feat(iso): Y-sort bucket for single-tile entities"
```

---

### Task 6: Y-sort bucket — multi-tile buildings

**Files:**
- Modify: `src/render/iso/iso-ysort.ts`
- Test: `tests/unit/iso-ysort.test.ts` (extend)

Multi-tile buildings sort by their *back-most* footprint tile so single-tile things in front of them paint over correctly. A building occupies cells `[(tx, ty), (tx+w-1, ty+h-1)]`; back-most cell has the highest `tx + ty` within the footprint (i.e. `(tx+w-1, ty+h-1)`).

Wait — that's wrong. The back-most tile in iso paint order has the *lowest* `tx + ty`, not the highest. The footprint corner closest to the camera (front) has the highest `tx + ty`; the corner furthest from camera (back) has the lowest. We want the building to paint *before* (i.e. earlier than) entities in front of it, so we sort the building by the *front-most* footprint corner — the corner with the highest `tx + ty`. The building paints, then anything with a larger `(tx + ty)` paints on top.

- [ ] **Step 1: Write failing tests**

```ts
// append to tests/unit/iso-ysort.test.ts
import { buildingSortKey } from '@/render/iso/iso-ysort';

describe('iso-ysort: multi-tile buildings', () => {
  it('buildingSortKey returns front-most footprint tile (max tx+ty corner)', () => {
    const key = buildingSortKey({ tx: 3, ty: 3, footprintW: 2, footprintH: 2 });
    expect(key).toEqual({ sortTx: 4, sortTy: 4 });
  });

  it('NPC at (tx+ty) just past the building front-most cell paints AFTER the building', () => {
    const entries: YSortEntry[] = [
      { id: 'house', kind: 'building', tx: 3, ty: 3, sortTx: 4, sortTy: 4, z: 0, kindPriority: 5 },
      { id: 'npc-in-front', kind: 'npc', tx: 5, ty: 4, z: 0, kindPriority: 0 },
      { id: 'npc-behind',   kind: 'npc', tx: 3, ty: 2, z: 0, kindPriority: 0 },
    ];
    const sorted = buildYSortBucket(entries);
    expect(sorted.map(e => e.id)).toEqual(['npc-behind', 'house', 'npc-in-front']);
  });
});
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `npx vitest run tests/unit/iso-ysort.test.ts`
Expected: FAIL — `buildingSortKey` not exported.

- [ ] **Step 3: Implement `buildingSortKey`**

```ts
// append to src/render/iso/iso-ysort.ts
export interface BuildingFootprint {
  tx: number;
  ty: number;
  footprintW: number;
  footprintH: number;
}

/** Front-most footprint corner: the tile with the highest tx+ty inside
 *  the building's bounding rect. */
export function buildingSortKey(b: BuildingFootprint): { sortTx: number; sortTy: number } {
  return {
    sortTx: b.tx + b.footprintW - 1,
    sortTy: b.ty + b.footprintH - 1,
  };
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-ysort.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-ysort.ts tests/unit/iso-ysort.test.ts
git commit -m "feat(iso): buildingSortKey for multi-tile footprint sort"
```

---

### Task 7: Iso atlas skeleton

**Files:**
- Create: `src/render/iso/iso-atlas.ts`

The atlas module is a placeholder for now. Every lookup returns `null`, so the renderer falls back to flat-color shapes. PR 2-5 populate this module with real atlas data.

- [ ] **Step 1: Implement skeleton (no tests yet — trivial)**

```ts
// src/render/iso/iso-atlas.ts

/** PR 1: every lookup returns null. PR 2+ populates this with real atlas data
 *  loaded from public/sprites/iso/. */

export interface IsoTerrainSprite {
  img: HTMLImageElement;
  sx: number; sy: number; sw: number; sh: number;
}

export interface IsoSpriteSheet {
  img: HTMLImageElement;
  frameW: number; frameH: number;
}

export interface IsoAtlas {
  getTerrain(terrainType: string, blobVariant: number): IsoTerrainSprite | null;
  getBuilding(templateId: string): IsoTerrainSprite | null;
  getCharacter(characterClass: string): IsoSpriteSheet | null;
  getTree(variant: string): IsoTerrainSprite | null;
}

export function createNullAtlas(): IsoAtlas {
  return {
    getTerrain: () => null,
    getBuilding: () => null,
    getCharacter: () => null,
    getTree: () => null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/render/iso/iso-atlas.ts
git commit -m "feat(iso): null atlas skeleton (PR 2+ fills it in)"
```

---

### Task 8: Iso terrain pass with fallback diamond stamps

**Files:**
- Create: `src/render/iso/iso-terrain.ts`
- Test: `tests/unit/iso-terrain.test.ts`

Iterate visible tiles in iso paint order. For each tile, draw a colored diamond using `TILE_COLORS` from `src/core/constants.ts` as fallback. When the atlas eventually returns a real sprite, draw that instead. PR 1 ships the fallback path.

- [ ] **Step 1: Write failing test (call-shape, not pixel)**

```ts
// tests/unit/iso-terrain.test.ts
import { describe, it, expect, vi } from 'vitest';
import { drawIsoTerrain } from '@/render/iso/iso-terrain';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import type { GameMap } from '@/core/types';

function makeMap(w: number, h: number, fill = 'grass'): GameMap {
  const tiles: string[][] = [];
  for (let y = 0; y < h; y++) {
    tiles.push(Array(w).fill(fill));
  }
  return { width: w, height: h, tiles, pois: [], buildings: [] } as unknown as GameMap;
}

describe('iso-terrain: fallback path', () => {
  it('fills one diamond per visible tile using path+fill', () => {
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const map = makeMap(3, 3);
    drawIsoTerrain(ctx, {
      map,
      atlas: createNullAtlas(),
      bounds: { minTx: 0, maxTx: 2, minTy: 0, maxTy: 2 },
      originX: 0, originY: 0,
    });
    // 9 tiles × 1 fill each
    expect((ctx.fill as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(9);
    expect((ctx.beginPath as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(9);
  });
});
```

- [ ] **Step 2: Run tests; verify fail**

Run: `npx vitest run tests/unit/iso-terrain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `drawIsoTerrain`**

```ts
// src/render/iso/iso-terrain.ts
import type { GameMap } from '@/core/types';
import { TILE_COLORS } from '@/core/constants';
import { worldToScreen } from './iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import type { IsoAtlas } from './iso-atlas';
import type { TileBounds } from './iso-projection';

export interface IsoTerrainArgs {
  map: GameMap;
  atlas: IsoAtlas;
  bounds: TileBounds;
  originX: number;
  originY: number;
}

export function drawIsoTerrain(ctx: CanvasRenderingContext2D, args: IsoTerrainArgs): void {
  const { map, atlas, bounds, originX, originY } = args;
  // Iterate anti-diagonals: outer i = tx+ty, inner walks the diagonal
  const iMin = bounds.minTx + bounds.minTy;
  const iMax = bounds.maxTx + bounds.maxTy;
  for (let i = iMin; i <= iMax; i++) {
    // For this anti-diagonal, tx ranges over max(minTx, i - maxTy) .. min(maxTx, i - minTy)
    const txLo = Math.max(bounds.minTx, i - bounds.maxTy);
    const txHi = Math.min(bounds.maxTx, i - bounds.minTy);
    for (let tx = txLo; tx <= txHi; tx++) {
      const ty = i - tx;
      const tileType = map.tiles[ty]?.[tx];
      if (!tileType) continue;
      const sprite = atlas.getTerrain(tileType, 0);
      const { sx, sy } = worldToScreen(tx, ty, 0, originX, originY);
      if (sprite) {
        // Real sprite path (PR 2+) — anchor is diamond center, so offset by half W/H.
        ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh,
                      sx - ISO_TILE_W / 2, sy - ISO_TILE_H / 2, ISO_TILE_W, ISO_TILE_H);
      } else {
        // Fallback: colored diamond.
        ctx.fillStyle = TILE_COLORS[tileType] ?? '#444';
        ctx.beginPath();
        ctx.moveTo(sx, sy - ISO_TILE_H / 2);
        ctx.lineTo(sx + ISO_TILE_W / 2, sy);
        ctx.lineTo(sx, sy + ISO_TILE_H / 2);
        ctx.lineTo(sx - ISO_TILE_W / 2, sy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-terrain.test.ts`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-terrain.ts tests/unit/iso-terrain.test.ts
git commit -m "feat(iso): iso terrain pass with diamond fallback stamps"
```

---

### Task 9: Iso sprites with fallback shapes

**Files:**
- Create: `src/render/iso/iso-sprites.ts`
- Test: covered by integration test in Task 11 — no separate unit test (fallback shapes are too trivial to warrant tests in isolation)

NPC fallback: colored circle with iso shadow ellipse below. Building fallback: extruded colored box (rhombus base + two side faces + flat top). Tree fallback: colored triangle on diamond base. Real sprite path delegates to atlas.

- [ ] **Step 1: Implement `iso-sprites.ts`**

```ts
// src/render/iso/iso-sprites.ts
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import { worldToScreen } from './iso-projection';
import type { IsoAtlas } from './iso-atlas';
import type { NpcInstance, BuildingInstance } from '@/core/types';

export interface IsoDrawCtx {
  ctx: CanvasRenderingContext2D;
  atlas: IsoAtlas;
  originX: number;
  originY: number;
}

const NPC_COLOR_BY_ROLE: Record<string, string> = {
  villager: '#d4a574',
  priest:   '#cdb5ff',
  default:  '#e0e0e0',
};

export function drawIsoNpc(dc: IsoDrawCtx, npc: NpcInstance): void {
  const { sx, sy } = worldToScreen(npc.tileX, npc.tileY, 0, dc.originX, dc.originY);
  const sheet = dc.atlas.getCharacter(npc.role);
  if (sheet) {
    // Real-sprite path — PR 4 implements full sheet lookup with direction + frame.
    // PR 1 only ever exercises the fallback path because atlas returns null.
    return;
  }
  // Fallback: shadow ellipse + colored circle.
  const ctx = dc.ctx;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, ISO_TILE_W / 4, ISO_TILE_H / 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = NPC_COLOR_BY_ROLE[npc.role] ?? NPC_COLOR_BY_ROLE.default;
  ctx.beginPath();
  ctx.arc(sx, sy - 16, 12, 0, Math.PI * 2);
  ctx.fill();
}

export function drawIsoBuilding(dc: IsoDrawCtx, b: BuildingInstance, footprintW: number, footprintH: number): void {
  const sprite = dc.atlas.getBuilding(b.templateId);
  if (sprite) return;
  // Fallback: extruded box. Base diamond covers footprint; lift top by 40px.
  const ctx = dc.ctx;
  const baseHeight = 40;
  const frontX = b.tx + footprintW - 1;
  const frontY = b.ty + footprintH - 1;
  const backX  = b.tx;
  const backY  = b.ty;
  const front = worldToScreen(frontX, frontY, 0, dc.originX, dc.originY);
  const back  = worldToScreen(backX,  backY,  0, dc.originX, dc.originY);
  const east  = worldToScreen(frontX, backY,  0, dc.originX, dc.originY);
  const west  = worldToScreen(backX,  frontY, 0, dc.originX, dc.originY);
  // Base diamond
  ctx.fillStyle = '#7a5a3f';
  ctx.beginPath();
  ctx.moveTo(back.sx, back.sy);
  ctx.lineTo(east.sx, east.sy);
  ctx.lineTo(front.sx, front.sy);
  ctx.lineTo(west.sx, west.sy);
  ctx.closePath();
  ctx.fill();
  // Top face (lifted)
  ctx.fillStyle = '#a07a55';
  ctx.beginPath();
  ctx.moveTo(back.sx, back.sy - baseHeight);
  ctx.lineTo(east.sx, east.sy - baseHeight);
  ctx.lineTo(front.sx, front.sy - baseHeight);
  ctx.lineTo(west.sx, west.sy - baseHeight);
  ctx.closePath();
  ctx.fill();
  // East face
  ctx.fillStyle = '#5d4530';
  ctx.beginPath();
  ctx.moveTo(east.sx, east.sy);
  ctx.lineTo(front.sx, front.sy);
  ctx.lineTo(front.sx, front.sy - baseHeight);
  ctx.lineTo(east.sx, east.sy - baseHeight);
  ctx.closePath();
  ctx.fill();
  // West face
  ctx.fillStyle = '#4a3624';
  ctx.beginPath();
  ctx.moveTo(west.sx, west.sy);
  ctx.lineTo(front.sx, front.sy);
  ctx.lineTo(front.sx, front.sy - baseHeight);
  ctx.lineTo(west.sx, west.sy - baseHeight);
  ctx.closePath();
  ctx.fill();
}

export function drawIsoTree(dc: IsoDrawCtx, tx: number, ty: number, color: string): void {
  const sprite = dc.atlas.getTree(color);
  if (sprite) return;
  const { sx, sy } = worldToScreen(tx, ty, 0, dc.originX, dc.originY);
  const ctx = dc.ctx;
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, ISO_TILE_W / 5, ISO_TILE_H / 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Triangle canopy
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 48);
  ctx.lineTo(sx + 16, sy - 4);
  ctx.lineTo(sx - 16, sy - 4);
  ctx.closePath();
  ctx.fill();
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/render/iso/iso-sprites.ts
git commit -m "feat(iso): iso-sprites with fallback shapes for NPC/building/tree"
```

---

### Task 10: Overlay pass (past-veil only)

**Files:**
- Create: `src/render/iso/iso-overlay.ts`

PR 1 implements only the past-veil (full-screen tint when timeline is scrubbed). Sim heatmap, sigils, selection ring are deferred to PR 6 of the spec.

- [ ] **Step 1: Implement `iso-overlay.ts`**

```ts
// src/render/iso/iso-overlay.ts
import type { RenderContext } from '@/core/types';

export function drawIsoOverlays(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  // Past-veil — same semantic as top-down: a desaturating tint when scrubbed.
  // The actual "is scrubbed" signal is driven by the chrome layer, not the
  // renderer, so this is a no-op in PR 1. PR 6 wires the signal in.
  void ctx; void rc;
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/render/iso/iso-overlay.ts
git commit -m "feat(iso): iso-overlay stub (past-veil + sim overlays in PR 6)"
```

---

### Task 11: Iso renderer entrypoint + integration test

**Files:**
- Create: `src/render/iso/iso-renderer.ts`
- Test: `tests/unit/iso-renderer.test.ts`

Stitches the three phases. Same signature as `src/render/renderer.ts`'s `renderMap`. Atlas is constructed once via `createNullAtlas()` for PR 1.

- [ ] **Step 1: Write failing integration test**

```ts
// tests/unit/iso-renderer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderMap } from '@/render/iso/iso-renderer';
import type { RenderContext, GameMap, NpcInstance } from '@/core/types';
import { createIsoCamera } from '@/render/iso/iso-camera';

function makeMap(w: number, h: number, fill = 'grass'): GameMap {
  const tiles: string[][] = [];
  for (let y = 0; y < h; y++) tiles.push(Array(w).fill(fill));
  return { width: w, height: h, tiles, pois: [], buildings: [] } as unknown as GameMap;
}

function makeMockCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), fill: vi.fn(), drawImage: vi.fn(),
    ellipse: vi.fn(), arc: vi.fn(),
    fillStyle: '', strokeStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('iso-renderer: integration', () => {
  it('renders without throwing on a populated RenderContext', () => {
    const ctx = makeMockCtx();
    const rc: RenderContext = {
      map: makeMap(8, 6),
      camera: createIsoCamera(),
      canvasWidth: 800,
      canvasHeight: 600,
      npcs: [
        { id: 'n1', name: 'Alice', role: 'villager', seed: 1, tileX: 2, tileY: 2,
          direction: 'south', frame: 0, frameTimer: 0 } as NpcInstance,
      ],
      npcSheets: new Map(),
      visualMap: null,
      blobMap: null,
      tileAtlas: null,
      terrainSheets: new Map(),
      buildingSprites: new Map(),
      treeSheets: new Map(),
      world: { entities: new Map(), query: () => [] } as any,
    };
    expect(() => renderMap(ctx, rc)).not.toThrow();
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests; verify fail**

Run: `npx vitest run tests/unit/iso-renderer.test.ts`
Expected: FAIL — `@/render/iso/iso-renderer` not found.

- [ ] **Step 3: Implement `iso-renderer.ts`**

```ts
// src/render/iso/iso-renderer.ts
import type { RenderContext } from '@/core/types';
import { drawIsoTerrain } from './iso-terrain';
import { drawIsoNpc, drawIsoBuilding, drawIsoTree } from './iso-sprites';
import { drawIsoOverlays } from './iso-overlay';
import { createNullAtlas } from './iso-atlas';
import { visibleTileBounds } from './iso-projection';
import { buildYSortBucket, buildingSortKey, type YSortEntry } from './iso-ysort';

const BG_COLOR = '#1a1a24';
const KIND_PRIORITY: Record<string, number> = {
  river: 0, road: 1, deco: 2, tree: 3, building: 4, npc: 5,
};

const atlas = createNullAtlas();

export function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { camera, canvasWidth, canvasHeight, map } = rc;
  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  // Camera transform
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Origin = (0,0) in world-space; canvas centering is handled by camera offset.
  const originX = 0;
  const originY = 0;

  const bounds = visibleTileBounds(
    { originX: -camera.x, originY: -camera.y },
    canvasWidth / camera.zoom,
    canvasHeight / camera.zoom,
    { mapW: map.width, mapH: map.height },
  );

  // Phase 1: terrain
  drawIsoTerrain(ctx, { map, atlas, bounds, originX, originY });

  // Phase 2: Y-sorted entities (buildings, NPCs, trees in PR 1; decorations later)
  const entries: YSortEntry[] = [];
  for (const b of (map as any).buildings ?? []) {
    const key = buildingSortKey({
      tx: b.tx, ty: b.ty,
      footprintW: b.footprintW ?? 1, footprintH: b.footprintH ?? 1,
    });
    entries.push({
      id: b.id, kind: 'building',
      tx: b.tx, ty: b.ty, z: 0,
      sortTx: key.sortTx, sortTy: key.sortTy,
      kindPriority: KIND_PRIORITY.building,
    });
  }
  for (const n of rc.npcs) {
    entries.push({
      id: n.id, kind: 'npc',
      tx: n.tileX, ty: n.tileY, z: 0,
      kindPriority: KIND_PRIORITY.npc,
    });
  }

  const sorted = buildYSortBucket(entries);
  for (const e of sorted) {
    if (e.kind === 'building') {
      const b = (map as any).buildings.find((x: any) => x.id === e.id);
      if (b) drawIsoBuilding({ ctx, atlas, originX, originY }, b, b.footprintW ?? 1, b.footprintH ?? 1);
    } else if (e.kind === 'npc') {
      const n = rc.npcs.find(x => x.id === e.id);
      if (n) drawIsoNpc({ ctx, atlas, originX, originY }, n);
    } else if (e.kind === 'tree') {
      drawIsoTree({ ctx, atlas, originX, originY }, e.tx, e.ty, '#3a7a3a');
    }
  }

  ctx.restore();

  // Phase 3: overlays (in screen space)
  drawIsoOverlays(ctx, rc);
}
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx vitest run tests/unit/iso-renderer.test.ts`
Expected: PASS (1/1).

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-renderer.ts tests/unit/iso-renderer.test.ts
git commit -m "feat(iso): iso-renderer entrypoint (terrain + Y-sort + overlay stub)"
```

---

### Task 12: Wire iso renderer into game.ts via localStorage flag

**Files:**
- Modify: `src/game.ts:3` (import) and `src/game.ts:405` (render call site)

Dynamic import so iso code is excluded from the topdown bundle when the flag is off.

- [ ] **Step 1: Read current import + render call site**

Run: `grep -n "renderMap\|from '@/render/renderer'" src/game.ts`
Note the existing static import on line 3 and call site on line 405 (or whatever current line numbers are).

- [ ] **Step 2: Add helper module that resolves the renderer**

Create: `src/render/select-renderer.ts`

```ts
// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';

const LS_KEY = 'smallgods.render.mode';

export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

export async function selectRenderer(): Promise<RenderFn> {
  let mode: 'topdown' | 'iso' = 'topdown';
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'iso') mode = 'iso';
  } catch {
    // localStorage may be unavailable (e.g. iframe with storage disabled);
    // fall through to topdown default.
  }
  if (mode === 'iso') {
    const mod = await import('@/render/iso/iso-renderer');
    return mod.renderMap;
  }
  const mod = await import('@/render/renderer');
  return mod.renderMap;
}
```

- [ ] **Step 3: Modify `game.ts` to use the selector**

Replace the static import on line 3:

```ts
// OLD:
// import { renderMap } from '@/render/renderer';
// NEW:
import { selectRenderer, type RenderFn } from '@/render/select-renderer';
```

Add a field on the `Game` class:

```ts
private renderMap: RenderFn | null = null;
```

In the `Game` constructor (or wherever async init happens — find the `async init` / `await` block), await the selector before the first render:

```ts
this.renderMap = await selectRenderer();
```

At the render call site (around line 405):

```ts
// OLD:
// renderMap(this.ctx, rc);
// NEW:
if (this.renderMap) this.renderMap(this.ctx, rc);
```

- [ ] **Step 4: TypeScript check + existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, no regressions. All existing tests still green.

- [ ] **Step 5: Manual smoke — topdown default**

```bash
npm run dev
```
Visit `http://localhost:5173`. Verify game renders as top-down (default flag).

- [ ] **Step 6: Manual smoke — iso flag**

In browser devtools console:

```js
localStorage.setItem('smallgods.render.mode', 'iso');
location.reload();
```

Verify: terrain renders as colored diamonds, NPCs as colored circles with shadow, buildings as extruded colored boxes. Game runs without console errors. Camera pan/zoom work.

- [ ] **Step 7: Commit**

```bash
git add src/render/select-renderer.ts src/game.ts
git commit -m "feat(game): select renderer via localStorage flag (smallgods.render.mode)"
```

---

### Task 13: Camera state per-mode namespacing

**Files:**
- Modify: `src/game.ts` camera persistence (search for `localStorage` and `camera`)
- Modify: `src/render/select-renderer.ts` (export the mode it picked)

If `game.ts` persists camera state to localStorage today, switch the key to be mode-suffixed so a mode switch doesn't apply a topdown camera to iso. If it does NOT persist camera state, this task is a no-op — verify and skip.

- [ ] **Step 1: Check whether camera state is persisted**

Run: `grep -n "localStorage" src/game.ts src/render/camera.ts src/ui/controls.ts`

If no result mentions a camera key: this task is a no-op. Mark all steps complete and move to Task 14.

- [ ] **Step 2 (if persisted): Identify the key, namespace it per mode**

Modify the persistence key from e.g. `smallgods.camera` to `smallgods.camera.${mode}`. Read the mode the selector picked (export it from `select-renderer.ts`).

```ts
// src/render/select-renderer.ts — add:
export function readRenderMode(): 'topdown' | 'iso' {
  try {
    return localStorage.getItem('smallgods.render.mode') === 'iso' ? 'iso' : 'topdown';
  } catch {
    return 'topdown';
  }
}
```

Use `readRenderMode()` everywhere `game.ts` reads/writes the camera localStorage key.

- [ ] **Step 3: Manual smoke**

Pan/zoom in topdown, reload, verify state restores. Switch flag to iso, reload, verify camera starts at iso default (not topdown state). Switch back to topdown — original state restores.

- [ ] **Step 4: Commit**

```bash
git add src/render/select-renderer.ts src/game.ts
git commit -m "feat(game): per-mode camera localStorage key namespacing"
```

---

### Task 14: Picking in iso mode

**Files:**
- Modify: `src/ui/overlay-dispatcher.ts`
- Test: `tests/unit/overlay-dispatcher.test.ts` (extend if it exists, otherwise create)

Picking today translates `(screenX, screenY)` → `(tileX, tileY)` using top-down math (`screenToWorld` in `src/render/camera.ts`). In iso mode it must use `screenToTile` from `iso-projection.ts` instead.

- [ ] **Step 1: Read current pick path**

Run: `grep -n "screenToWorld\|pick\|onCanvasClick\|tryDispatch" src/ui/overlay-dispatcher.ts src/game.ts | head -20`

Identify where the click → tile conversion happens.

- [ ] **Step 2: Introduce a mode-aware pick function**

Create or update: `src/ui/pick-tile.ts`

```ts
// src/ui/pick-tile.ts
import type { Camera } from '@/core/types';
import { TILE_SIZE } from '@/core/constants';
import { screenToWorld } from '@/render/camera';
import { screenToTile as isoScreenToTile } from '@/render/iso/iso-projection';
import { readRenderMode } from '@/render/select-renderer';

export function pickTile(camera: Camera, sx: number, sy: number): { tx: number; ty: number } {
  if (readRenderMode() === 'iso') {
    // Convert screen → world-canvas → world coords using camera transform.
    const worldSx = sx / camera.zoom + camera.x;
    const worldSy = sy / camera.zoom + camera.y;
    const { tx, ty } = isoScreenToTile(worldSx, worldSy, 0, 0);
    return { tx, ty };
  }
  const { wx, wy } = screenToWorld(camera, sx, sy, TILE_SIZE);
  return { tx: wx, ty: wy };
}
```

- [ ] **Step 3: Replace existing pick call sites with `pickTile`**

In `src/ui/overlay-dispatcher.ts` (and `src/game.ts` if it has its own pick logic), swap the inline `screenToWorld` call for `pickTile(camera, sx, sy)`.

- [ ] **Step 4: Add picking unit test**

```ts
// tests/unit/pick-tile.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { pickTile } from '@/ui/pick-tile';
import { createCamera } from '@/render/camera';

describe('pickTile: mode dispatch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses topdown math when flag absent', () => {
    const cam = createCamera();
    cam.zoom = 1;
    const { tx, ty } = pickTile(cam, 64, 96);
    // TILE_SIZE = 32 → (64/32, 96/32) = (2, 3)
    expect(tx).toBe(2);
    expect(ty).toBe(3);
  });

  it('uses iso math when flag is "iso"', () => {
    localStorage.setItem('smallgods.render.mode', 'iso');
    const cam = createCamera();
    cam.zoom = 1;
    cam.x = 0; cam.y = 0;
    // Iso: clicking at (0,0) screen with origin at (0,0) → tile (0,0)
    expect(pickTile(cam, 0, 0)).toEqual({ tx: 0, ty: 0 });
    localStorage.removeItem('smallgods.render.mode');
  });
});
```

- [ ] **Step 5: Run tests + TypeScript check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — all existing + new tests green.

- [ ] **Step 6: Manual smoke**

With iso flag on, click an NPC in dev. Verify the click registers on the correct tile (NPC overlay/info should respond).

- [ ] **Step 7: Commit**

```bash
git add src/ui/pick-tile.ts src/ui/overlay-dispatcher.ts src/game.ts tests/unit/pick-tile.test.ts
git commit -m "feat(iso): mode-aware tile picking via pickTile helper"
```

---

### Task 15: Build + full test pass + PR

**Files:** none (verification + PR)

- [ ] **Step 1: TypeScript + build + test**

Run: `npm run build && npx vitest run`
Expected: build clean, all tests pass. Note the test count delta vs. baseline (`576 → 576 + N` where N ≈ 15–20).

- [ ] **Step 2: Manual smoke checklist**

In a fresh browser tab:

1. Default load → top-down renders as today.
2. `localStorage.setItem('smallgods.render.mode', 'iso'); location.reload();`
3. Map renders as colored diamonds, NPCs as circles with shadows, buildings as colored extruded boxes.
4. Camera pan (drag) works.
5. Camera zoom (scroll) works. (Iso-specific clamp 0.5×–4× is not wired in PR 1; the shared topdown clamp 0.25×–8× is in effect. Fix in a follow-up.)
6. Clicking on an NPC selects it (NPC info panel responds).
7. No console errors over 30s of play.
8. Flip back: `localStorage.removeItem('smallgods.render.mode'); location.reload();` → top-down restored.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feat/iso-renderer-scaffold
gh pr create --title "feat(iso): scaffold parallel iso renderer (dev-only flag)" --body "$(cat <<'EOF'
## Summary
- New `src/render/iso/` parallel renderer at dimetric 2:1, 128×64 tile size
- Flag-gated via `localStorage` key `smallgods.render.mode` (default `topdown`)
- Placeholder visuals (colored diamonds / boxes / circles); real iso art lands in subsequent PRs
- Logical world, sim, snapshots, save format all unchanged

Spec: `docs/superpowers/specs/2026-05-18-iso-renderer-design.md`
Plan: `docs/superpowers/plans/2026-05-18-iso-renderer-scaffold.md`

## Test plan
- [ ] `npm run build` clean
- [ ] `npx vitest run` — all tests pass (baseline + new iso tests)
- [ ] Default load renders as top-down (regression)
- [ ] With `smallgods.render.mode=iso`, map renders as colored diamonds + colored shapes
- [ ] Camera pan + zoom work in iso mode
- [ ] Picking selects correct tile in iso mode
- [ ] Flag toggle requires reload; both modes render cleanly after switch

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Note: branch name `feat/iso-renderer-scaffold` differs from the design-doc branch `feat/iso-renderer-design`. Create the scaffold branch off `main` — or rebase off `feat/iso-renderer-design` if that has merged — before running the PR command.)

---

## Self-review notes

- Spec coverage: every locked decision in the spec's "Architectural decisions" table is exercised by a task in this plan (projection, camera, ysort, fallback, flag, picking).
- Asset-pipeline tasks (PixelLab `generateIsoAsset`, atlas directory structure, character sheet hashing) are explicitly out of this plan — they belong to PR 2-5 plans written separately.
- Overlay treatments (past-veil signal wiring, sim heatmap, sigils, selection ring) are stubbed to no-op in Task 10 and finished in the PR 6 plan.
- Test count target: baseline 576 + ~15–20 new tests in this PR.
