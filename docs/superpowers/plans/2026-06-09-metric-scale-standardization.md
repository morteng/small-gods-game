# Metric Scale Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author every visible entity class (buildings, NPCs, vegetation, boulders, terrain, walls) in real metres through one `PX_PER_METRE`, snap to integer pixels, so the world has truthful relative sizes.

**Architecture:** `src/render/scale-contract.ts` becomes the single metric source of truth (authored metres → derived pixels/cube-units). The blueprint geometry is pinned to "1 cube-unit = 1 tile = 2 m"; the building generator renders at a fixed `PX_PER_METRE` scale (not fit-to-canvas); billboards (NPC/veg/boulder) size from a metric `NATURE_HEIGHT_M` table via nearest-integer source-scale.

**Tech Stack:** TypeScript, Vitest, manifold-3d (WASM CSG), Canvas 2D iso renderer.

**Reference spec:** `docs/superpowers/specs/2026-06-09-metric-scale-standardization-design.md`

**Key calibration (at `PX_PER_METRE = 32`, `METRES_PER_TILE = 2`):**

| Thing | metres | px | cube-units |
|---|---|---|---|
| Human visible | 1.7 | 54 | — |
| Door height | 2.0 | 64 | 1.00 |
| Door width | 0.9 | 29 | 0.45 |
| Storey | 2.7 | 86 | 1.35 |
| Boulder | 1.2 | 38 | — |
| Oak | 15 | 480 | — |

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/render/scale-contract.ts` | Metric source of truth | Rewrite (Slice 1) |
| `src/assetgen/geometry/building.ts` | `STOREY` cube-units | Import from scale-contract (Slice 2) |
| `src/blueprint/features/door.ts` | Door size | Metric-derived (Slice 2) |
| `src/blueprint/parts/body.ts` | Massing, round-body, `heightPerLevel` param | Metric + drop dead param (Slice 2) |
| `src/blueprint/parts/structural.ts` | tower/porch/chimney heights | Inherit new `STOREY` (Slice 2, no edit) |
| `src/blueprint/compile/to-brief.ts` | brief `heightUnits` | Drop `heightPerLevel` (Slice 2) |
| `src/blueprint/presets/index.ts` | 12 presets | Drop `heightPerLevel`, add metric `storeyM` (Slice 2) |
| `src/assetgen/render/fit.ts` | projection fit | Add `fixedFit` (Slice 3) |
| `src/assetgen/compose.ts` | structure compose | Buildings use fixed scale (Slice 3) |
| `src/render/iso/iso-sprites.ts` | NPC + vegetation billboards | Metric sizing (Slices 4, 5) |
| `src/world/brushes/vegetation-placer.ts` | per-instance variety | `scale` = ±variety, not absolute (Slice 5) |
| `src/render/iso/iso-barrier.ts` (+ barrier authoring) | wall height | Author metres (Slice 6) |
| `src/render/iso/iso-constants.ts` | tile px + metre label | Doc comment (Slice 6) |
| `tests/unit/scale-contract-metric.test.ts` | conversions + calibration | Create (Slice 1) |
| `tests/unit/nature-height-coverage.test.ts` | every nature kind has a metric height | Create (Slice 5) |
| `tests/unit/no-relative-scale.test.ts` | guard: no reintroduced relative constants | Create (Slice 6) |

---

## SLICE 1 — Metric core

### Task 1.1: Rewrite `scale-contract.ts` as the metric source of truth

**Files:**
- Modify: `src/render/scale-contract.ts`
- Test: `tests/unit/scale-contract-metric.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scale-contract-metric.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  METRES_PER_TILE, PX_PER_METRE, HEIGHT_UNIT_PX,
  mToPx, mToTiles, snapPx,
  HUMAN_HEIGHT_M, DOOR_HEIGHT_M, DOOR_WIDTH_M, STOREY_M,
  HUMAN_PX, DOOR_HEIGHT_TILES, DOOR_WIDTH_TILES, STOREY_TILES,
  NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M,
} from '@/render/scale-contract';

describe('scale-contract: metric core', () => {
  it('master anchors', () => {
    expect(METRES_PER_TILE).toBe(2);
    expect(HEIGHT_UNIT_PX).toBe(64);
    expect(PX_PER_METRE).toBe(32);            // 64 / 2
  });
  it('conversions', () => {
    expect(mToPx(2)).toBe(64);
    expect(mToTiles(2)).toBe(1);
    expect(snapPx(31.6)).toBe(32);
  });
  it('authored metres', () => {
    expect(HUMAN_HEIGHT_M).toBe(1.7);
    expect(DOOR_HEIGHT_M).toBe(2.0);
    expect(DOOR_WIDTH_M).toBe(0.9);
    expect(STOREY_M).toBe(2.7);
  });
  it('derived pixels / cube-units', () => {
    expect(HUMAN_PX).toBe(54);                // round(1.7*32)
    expect(DOOR_HEIGHT_TILES).toBe(1);        // 2.0/2
    expect(DOOR_WIDTH_TILES).toBeCloseTo(0.45);
    expect(STOREY_TILES).toBeCloseTo(1.35);
  });
  it('nature table', () => {
    expect(NATURE_HEIGHT_M.oak_tree).toBe(15);
    expect(NATURE_HEIGHT_M.boulder).toBe(1.2);
    expect(DEFAULT_NATURE_HEIGHT_M).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scale-contract-metric.test.ts`
Expected: FAIL — `METRES_PER_TILE`, `mToPx`, etc. are not exported yet.

- [ ] **Step 3: Rewrite the module**

Replace the entire contents of `src/render/scale-contract.ts` with:

```ts
// Single source of truth for world scale. Every entity class derives its size from
// REAL METRES through one PX_PER_METRE. Author in metres; pixels & geometry cube-units
// are derived. Snap to integer pixels at the end (1:1 pixel-perfect rule).
// Master anchor: one ground tile = METRES_PER_TILE metres.
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

/** Vertical pixels per one tile-depth of world height (one cube-unit). */
export const HEIGHT_UNIT_PX = ISO_TILE_H;                  // 64

// ── Master anchors ──
export const METRES_PER_TILE = 2;                          // one ground tile = 2 m
export const PX_PER_METRE    = HEIGHT_UNIT_PX / METRES_PER_TILE;  // 64 / 2 = 32

// ── Conversions ──
export const mToPx    = (m: number): number => m * PX_PER_METRE;
export const mToTiles = (m: number): number => m / METRES_PER_TILE;
/** 1:1 rule: blit/derive only at whole pixels. */
export const snapPx   = (px: number): number => Math.round(px);

// ── Authored real-world dimensions (metres) ──
export const HUMAN_HEIGHT_M = 1.7;     // visible LPC body
export const DOOR_HEIGHT_M  = 2.0;
export const DOOR_WIDTH_M   = 0.9;
export const STOREY_M       = 2.7;     // interior storey height

/**
 * Real-world heights (metres) of natural entities, keyed by entity kind id.
 * The one place a human or LLM agent reads "how big is an oak". Every
 * `category: 'vegetation'` and `category: 'terrain-feature'` kind must appear
 * here (enforced by tests/unit/nature-height-coverage.test.ts).
 */
export const NATURE_HEIGHT_M: Record<string, number> = {
  // trees
  oak_tree: 15, pine_tree: 18, birch_tree: 12, dead_tree: 8,
  orange_tree: 6, pale_tree: 10, brown_tree: 11,
  // rocks / geology
  boulder: 1.2, rock_pile: 0.7, pebbles: 0.2, ore_vein: 0.8,
};
/** Fallback for any nature kind missing from the table (logged once at use). */
export const DEFAULT_NATURE_HEIGHT_M = 1.0;

// ── Derived pixels / cube-units (kept for back-compat call sites) ──
export const HUMAN_PX          = snapPx(mToPx(HUMAN_HEIGHT_M));   // 54
export const DOOR_HEIGHT_TILES = mToTiles(DOOR_HEIGHT_M);         // 1.0
export const DOOR_WIDTH_TILES  = mToTiles(DOOR_WIDTH_M);          // 0.45
export const STOREY_TILES      = mToTiles(STOREY_M);              // 1.35

// ── Transition aliases (deleted in Slice 6 once all callers move off them) ──
/** @deprecated use DOOR_HEIGHT_TILES */
export const DOOR_HEIGHT_UNITS = DOOR_HEIGHT_TILES;
/** @deprecated use mToTiles(HUMAN_HEIGHT_M) */
export const HUMAN_HEIGHT_UNITS = mToTiles(HUMAN_HEIGHT_M);

export { ISO_TILE_W, ISO_TILE_H };
```

> **Why aliases:** `door.ts`/`body.ts` still import `DOOR_HEIGHT_UNITS` until Slice 2. Keeping the names (now metric-derived) lets every slice compile & pass independently. Slice 6 deletes them.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scale-contract-metric.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the existing suites that touch scale, confirm still green**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts tests/unit/blueprint-door-feature.test.ts`
Expected: PASS. (Door/body now resolve with `DOOR_HEIGHT_UNITS = 1.0` instead of 0.85 — if any test hard-codes 0.85, update it to `1.0` in this step and note it.)

- [ ] **Step 6: Commit**

```bash
git add src/render/scale-contract.ts tests/unit/scale-contract-metric.test.ts
git commit -m "feat(metric): scale-contract becomes the metric source of truth"
```

---

## SLICE 2 — Geometry cube-unit = tile = 2 m

### Task 2.1: Pin `STOREY` to the metric storey

**Files:**
- Modify: `src/assetgen/geometry/building.ts:24`
- Test: `tests/unit/blueprint-body-part.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/blueprint-body-part.test.ts` inside `describe('body part — toPrims')`:

```ts
it('stepped boxes are one metric storey (1.35 cube-units) tall', async () => {
  const { STOREY } = await import('@/assetgen/geometry/building');
  expect(STOREY).toBeCloseTo(1.35);          // mToTiles(2.7)
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts -t "metric storey"`
Expected: FAIL — `STOREY` is still `2.1`.

- [ ] **Step 3: Implement**

In `src/assetgen/geometry/building.ts`, replace line 24:

```ts
export const STOREY = 2.1;                           // cube-units of height per storey
```

with:

```ts
import { STOREY_TILES } from '@/render/scale-contract';
/** Cube-units of height per storey. One cube-unit = one tile = METRES_PER_TILE m. */
export const STOREY = STOREY_TILES;                  // 1.35  (= 2.7 m / 2 m-per-tile)
```

Put the `import` with the other imports at the top of the file (above the `export type RoofKind` line).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts -t "metric storey"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/building.ts tests/unit/blueprint-body-part.test.ts
git commit -m "feat(metric): STOREY = metric storey (1.35 cube-units / 2.7 m)"
```

### Task 2.2: Door size from metric cube-units

**Files:**
- Modify: `src/blueprint/features/door.ts:10,47-48`
- Test: `tests/unit/blueprint-door-feature.test.ts` (existing — verify, extend if absent)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/blueprint-door-feature.test.ts` (create the file if it does not exist, mirroring the import style of `blueprint-body-part.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { doorFeatureType } from '@/blueprint/features/door';

describe('door feature — metric size', () => {
  it('default door is one metric door-height tall (1.0 cube-unit) and 0.45 wide half=0.225', () => {
    const r = doorFeatureType.resolve!({ type: 'door', face: 'south', params: {} } as never);
    expect(r.params!.height).toBeCloseTo(1.0);    // DOOR_HEIGHT_TILES
    expect(r.params!.halfW).toBeCloseTo(0.225);   // (DOOR_WIDTH_TILES 0.45)/2
  });
});
```

- [ ] **Step 2: Run to verify it fails (or already passes via Slice-1 alias)**

Run: `npx vitest run tests/unit/blueprint-door-feature.test.ts -t "metric size"`
Expected: with the Slice-1 alias, `height` already resolves to `1.0` (PASS for height) but width is `0.40/2 = 0.20` → FAIL on `halfW` (alias kept `DOOR_WIDTH_TILES` name but value is now 0.45, so it may already be 0.225 — if so, this step documents the green state). Run it and record the actual.

- [ ] **Step 3: Implement (explicit metric imports)**

In `src/blueprint/features/door.ts`, replace line 10:

```ts
import { DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES } from '@/render/scale-contract';
```

with:

```ts
import { DOOR_HEIGHT_TILES, DOOR_WIDTH_TILES } from '@/render/scale-contract';
```

and replace line 48:

```ts
    const height = (p.height as number) >= 0 ? (p.height as number) : DOOR_HEIGHT_UNITS * grand;
```

with:

```ts
    const height = (p.height as number) >= 0 ? (p.height as number) : DOOR_HEIGHT_TILES * grand;
```

(Line 47 stays: `DOOR_WIDTH_TILES` is now the metric-derived 0.45.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/blueprint-door-feature.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/features/door.ts tests/unit/blueprint-door-feature.test.ts
git commit -m "feat(metric): door size from metric cube-units"
```

### Task 2.3: Round-body anchors on metric door height

**Files:**
- Modify: `src/blueprint/parts/body.ts:9,63,74`
- Test: `tests/unit/blueprint-body-part.test.ts` (existing dome tests must stay green)

- [ ] **Step 1: Implement (rename import to the metric constant)**

In `src/blueprint/parts/body.ts`, replace line 9:

```ts
import { DOOR_HEIGHT_UNITS } from '@/render/scale-contract';
```

with:

```ts
import { DOOR_HEIGHT_TILES } from '@/render/scale-contract';
```

Replace line 63:

```ts
  const wallH = Math.max(1, p.params.levels as number) * DOOR_HEIGHT_UNITS * 1.15;
```

with:

```ts
  const wallH = Math.max(1, p.params.levels as number) * DOOR_HEIGHT_TILES * 1.15;
```

Replace line 74:

```ts
    const domeRz = Math.min(r, DOOR_HEIGHT_UNITS * 1.5);
```

with:

```ts
    const domeRz = Math.min(r, DOOR_HEIGHT_TILES * 1.5);
```

- [ ] **Step 2: Run the body tests**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts`
Expected: PASS — the dome-embed and toono tests are ratio-based (centre snaps to wall top; bore present), so the door value shift (0.85→1.0) doesn't break them. If a test asserts an absolute `wallH`/`domeRz` number, update it to the new value (`DOOR_HEIGHT_TILES`-based) and note it.

- [ ] **Step 3: Commit**

```bash
git add src/blueprint/parts/body.ts tests/unit/blueprint-body-part.test.ts
git commit -m "feat(metric): round-body wall/dome anchored to metric door height"
```

### Task 2.4: Delete the dead `heightPerLevel` param; brief uses metric storey

**Files:**
- Modify: `src/blueprint/parts/body.ts:105` (remove schema entry)
- Modify: `src/blueprint/compile/to-brief.ts:43-46`
- Test: `tests/unit/blueprint-to-brief.test.ts` (existing — verify) or extend `blueprint-body-part.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/blueprint-body-part.test.ts`:

```ts
it('body param schema no longer carries heightPerLevel (dead param removed)', () => {
  expect(bodyPartType.paramSchema.heightPerLevel).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts -t "dead param removed"`
Expected: FAIL — `heightPerLevel` is still in the schema.

- [ ] **Step 3: Implement**

In `src/blueprint/parts/body.ts`, delete the schema line 105:

```ts
    heightPerLevel: { kind: 'number', min: 0.1, max: 4, default: 1 },
```

and add, in its place, an optional metric per-storey override (preserves the intent presets used `heightPerLevel` for):

```ts
    storeyM: { kind: 'number', min: 0.5, max: 12, default: -1 },  // -1 = use the standard metric storey
```

In `src/blueprint/compile/to-brief.ts`, replace lines 43-46:

```ts
  const levels = Math.max(1, (body?.params.levels as number) ?? 1);
  const heightPerLevel = Math.max(0.1, (body?.params.heightPerLevel as number) ?? 1);
  const roofKind = (body?.params.roof as string) ?? 'gable';
  const heightUnits = levels * heightPerLevel + roofRise(roofKind as never, rb.footprint);
```

with:

```ts
  const levels = Math.max(1, (body?.params.levels as number) ?? 1);
  const storeyM = (body?.params.storeyM as number) ?? -1;
  const storeyTiles = storeyM > 0 ? mToTiles(storeyM) : STOREY_TILES;
  const roofKind = (body?.params.roof as string) ?? 'gable';
  const heightUnits = levels * storeyTiles + roofRise(roofKind as never, rb.footprint);
```

Add the import at the top of `to-brief.ts` (with the other imports):

```ts
import { STOREY_TILES, mToTiles } from '@/render/scale-contract';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/blueprint-body-part.test.ts -t "dead param removed"`
Run: `npx vitest run tests/unit/ -t "brief"` (confirm brief tests green; update any that asserted an old `heightUnits` number to the metric value and note it)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/parts/body.ts src/blueprint/compile/to-brief.ts tests/unit/blueprint-body-part.test.ts
git commit -m "feat(metric): drop dead heightPerLevel param; brief height uses metric storey"
```

### Task 2.5: Migrate presets off `heightPerLevel`

**Files:**
- Modify: `src/blueprint/presets/index.ts` (all `heightPerLevel:` occurrences)
- Test: `tests/unit/blueprint-presets.test.ts` (existing — verify resolve still works)

- [ ] **Step 1: Implement — replace each `heightPerLevel: N` per preset**

Apply these exact edits in `src/blueprint/presets/index.ts`. The rule: a "normal" storey drops the key entirely; a non-default value becomes an explicit metric `storeyM` (metres = old `heightPerLevel` × `STOREY_M` 2.7, rounded to a sensible real number).

- cottage (line 17): remove `heightPerLevel: 1,` → `params: { plan: 'rect', levels: 1, levelInset: 0, roof: 'gable' }`
- temple_small (line 37): `heightPerLevel: 1.5` → `storeyM: 4`   (taller cella: 1.5×2.7≈4 m)
- farm_barn (line 42): `heightPerLevel: 1.2` → `storeyM: 3.2`
- tower (line 47): `heightPerLevel: 1` → remove the key
- castle_keep (line 52): `heightPerLevel: 0.7` → `storeyM: 1.9`  (squat tiers)
- dock (line 57): `heightPerLevel: 0.2` → `storeyM: 0.5`  (a low deck)
- guard_post (line 67): `heightPerLevel: 1.2` → `storeyM: 3.2`
- yurt (line 72): `heightPerLevel: 0.9` → remove the key (round body ignores storey; height is door-anchored)
- longhouse (line 77): `heightPerLevel: 1.2` → `storeyM: 3.2`

- [ ] **Step 2: Run the preset + golden suites**

Run: `npx vitest run tests/unit/blueprint-presets.test.ts`
Expected: PASS (presets resolve; unknown `heightPerLevel` is simply gone, `storeyM` validates against the new schema).

- [ ] **Step 3: Commit**

```bash
git add src/blueprint/presets/index.ts
git commit -m "feat(metric): migrate presets off heightPerLevel to metric storeyM"
```

---

## SLICE 3 — Building generator at fixed metric scale

### Task 3.1: Add a fixed-scale fit

**Files:**
- Modify: `src/assetgen/render/fit.ts` (add `fixedFit`)
- Test: `tests/unit/assetgen-fixed-fit.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/assetgen-fixed-fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fixedFit } from '@/assetgen/render/fit';
import type { WorldFacet } from '@/assetgen/types';
import { ISO_TILE_W } from '@/render/scale-contract';

// One unit square facet from (0,0,0) to (1,1,0).
const sq: WorldFacet = {
  pts: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]],
  normal: [0,0,1], albedo: [1,1,1],
} as unknown as WorldFacet;

describe('fixedFit', () => {
  it('projects at PX_PER_METRE-consistent scale = ISO_TILE_W/2', () => {
    const { fit } = fixedFit([sq], 4);
    expect(fit.scale).toBe(ISO_TILE_W / 2);          // 64
  });
  it('sizes the canvas to projected content + padding (never negative offsets clipping)', () => {
    const { size, fit } = fixedFit([sq], 4);
    expect(size).toBeGreaterThan(0);
    // every projected point lands inside [0,size]
    for (const p of sq.pts) {
      const x = (p[0]-p[1])*fit.scale + fit.ox;
      const y = (p[0]+p[1])*(fit.scale*0.5) - p[2]*fit.scale + fit.oy;
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(size);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(size);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/assetgen-fixed-fit.test.ts`
Expected: FAIL — `fixedFit` not exported.

- [ ] **Step 3: Implement — append to `src/assetgen/render/fit.ts`**

Add the import at the top (below the existing imports):

```ts
import { ISO_TILE_W } from '@/render/scale-contract';
```

Append:

```ts
/**
 * Fixed metric scale: project at exactly `ISO_TILE_W/2` screen-px per world cube-unit
 * (so the sprite's footprint overlays the in-world iso tiles 1:1, and one cube-unit of
 * height = HEIGHT_UNIT_PX px). The canvas is sized to the projected content + padding,
 * so tall buildings yield taller sprites — building heights stay mutually metric, never
 * squashed to fill a fixed box (unlike `computeFit`).
 */
export function fixedFit(facets: WorldFacet[], pad = 4): { fit: ProjScale; size: number } {
  const scale = ISO_TILE_W / 2;                   // 64 — matches worldToScreen
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of facets) for (const p of f.pts) {
    const x = (p[0] - p[1]) * scale;
    const y = (p[0] + p[1]) * (scale * 0.5) - p[2] * scale;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return { fit: { scale, ox: pad, oy: pad }, size: 2 * pad };
  const w = Math.ceil(maxX - minX), h = Math.ceil(maxY - minY);
  const size = Math.max(w, h) + 2 * pad;
  // Centre content inside the square canvas.
  const ox = pad + (size - 2 * pad - w) / 2 - minX;
  const oy = pad + (size - 2 * pad - h) / 2 - minY;
  return { fit: { scale, ox, oy }, size };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/assetgen-fixed-fit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/render/fit.ts tests/unit/assetgen-fixed-fit.test.ts
git commit -m "feat(metric): fixedFit — fixed-scale building projection (no fit-to-box)"
```

### Task 3.2: `composeStructure` renders buildings at fixed scale

**Files:**
- Modify: `src/assetgen/compose.ts:13,66-74`
- Test: `tests/unit/assetgen-compose.test.ts` (existing — verify a two-building height-ratio invariant)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/assetgen-compose-metric.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeStructure } from '@/assetgen/compose';
import { opaqueBounds } from '@/assetgen/render/fit';

// Two same-footprint boxes of different height must render at the SAME px-per-unit:
// the 2-unit box's opaque height ≈ 2× the 1-unit box's (fixed scale, not fit-to-box).
describe('composeStructure: fixed metric scale', () => {
  it('taller building → proportionally taller sprite', async () => {
    const a = await composeStructure({ parts: [{ prim: 'box', at: [0,0,0], size: [2,2,1] }] });
    const b = await composeStructure({ parts: [{ prim: 'box', at: [0,0,0], size: [2,2,2] }] });
    const ha = opaqueBounds(a.grey, a.size).h;
    const hb = opaqueBounds(b.grey, b.size).h;
    expect(hb).toBeGreaterThan(ha * 1.3);   // clearly taller, not squashed equal
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/assetgen-compose-metric.test.ts`
Expected: FAIL — `computeFit` squashes both to fill the canvas, so `hb ≈ ha`.

- [ ] **Step 3: Implement**

In `src/assetgen/compose.ts`, change the import on line 13:

```ts
import { computeFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';
```

to:

```ts
import { computeFit, fixedFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';
```

Replace the body of `composeStructure` lines 66-74:

```ts
export async function composeStructure(spec: StructureSpec): Promise<StructureResult> {
  const size = spec.size ?? 1024;
  const parts = await Promise.all(spec.parts.map(partFacets));
  const facets = parts.flatMap(p => p.facets);
  const fit = computeFit(facets, size);
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);
```

with:

```ts
export async function composeStructure(spec: StructureSpec): Promise<StructureResult> {
  const parts = await Promise.all(spec.parts.map(partFacets));
  const facets = parts.flatMap(p => p.facets);
  // Buildings render at a fixed metric scale (content-sized canvas) so heights stay
  // mutually proportional. An explicit spec.size opts back into legacy fit-to-box.
  let fit, size: number;
  if (spec.size) { size = spec.size; fit = computeFit(facets, size); }
  else { const f = fixedFit(facets); fit = f.fit; size = f.size; }
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);
```

> Callers that pass `spec.size` (legacy reference previews) are unaffected; the runtime building source passes no `size`, so it gets the metric path. Confirm in Step 4.

- [ ] **Step 4: Run to verify it passes + nothing regressed**

Run: `npx vitest run tests/unit/assetgen-compose-metric.test.ts`
Run: `npx vitest run tests/unit/ -t "compose"` and `npx vitest run tests/unit/ -t "parametric"` (building source / golden)
Expected: target test PASS. Building golden-regression snapshots will change (heights now metric) — regenerate them in Task 3.3.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/compose.ts tests/unit/assetgen-compose-metric.test.ts
git commit -m "feat(metric): composeStructure renders buildings at fixed metric scale"
```

### Task 3.3: Refresh building golden snapshots + visual preview

**Files:**
- Modify: building golden snapshot fixtures (whatever `tests/**` golden the build pipeline uses)
- Modify (none): `scripts/assetgen-preview.ts` (run only)

- [ ] **Step 1: Identify the golden test**

Run: `rg -l "toMatchSnapshot|golden|__snapshots__" tests | rg -i "build|parametric|compose"`
Expected: lists the building golden spec(s).

- [ ] **Step 2: Regenerate snapshots intentionally**

Run: `npx vitest run <the golden spec path> -u`
Expected: snapshots updated. Inspect the diff — heights should shrink/normalize (storeys now 1.35 not 2.1), proportions consistent across buildings.

- [ ] **Step 3: Visual eyeball**

Run: `npx tsx scripts/assetgen-preview.ts`
Open `tmp/assetgen-preview/gallery.html`. Verify: buildings of the same footprint but different storeys differ in height proportionally; a door reads at ~human height; nothing is squashed or clipped.

- [ ] **Step 4: Commit**

```bash
git add tests
git commit -m "test(metric): refresh building golden snapshots for fixed metric scale"
```

---

## SLICE 4 — NPC billboard

### Task 4.1: `BILLBOARD_H_PX` from the metric human

**Files:**
- Modify: `src/render/iso/iso-sprites.ts:31`
- Test: `tests/unit/iso-sprites-metric.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/iso-sprites-metric.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BILLBOARD_H_PX } from '@/render/iso/iso-sprites';
import { HUMAN_PX } from '@/render/scale-contract';

describe('NPC billboard is metric', () => {
  it('billboard height tracks the metric human visible height', () => {
    // The LPC frame includes transparent headroom; the visible body is HUMAN_PX,
    // and the billboard frame is sized so the body lands at human height.
    expect(BILLBOARD_H_PX).toBe(HUMAN_PX);   // 54
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/iso-sprites-metric.test.ts`
Expected: FAIL — `BILLBOARD_H_PX` is the hard-coded `64`.

- [ ] **Step 3: Implement**

In `src/render/iso/iso-sprites.ts`, add to the imports (line 1 area):

```ts
import { HUMAN_PX } from '@/render/scale-contract';
```

Replace line 31:

```ts
export const BILLBOARD_H_PX = 64;
```

with:

```ts
/** Billboard z-height for an NPC = the metric human visible height (snapped px). */
export const BILLBOARD_H_PX = HUMAN_PX;     // 54
```

- [ ] **Step 4: Run to verify it passes + overlay still aligns**

Run: `npx vitest run tests/unit/iso-sprites-metric.test.ts`
Run: `npx vitest run tests/unit/ -t "overlay"` (sim-overlay imports `BILLBOARD_H_PX` for head markers — confirm green)
Expected: PASS. The prayer/head glyph in `sim-overlay.ts` auto-tracks since it imports the constant.

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-sprites.ts tests/unit/iso-sprites-metric.test.ts
git commit -m "feat(metric): NPC billboard height from metric human"
```

---

## SLICE 5 — Vegetation & boulder billboards

### Task 5.1: Nature-height coverage guard

**Files:**
- Test: `tests/unit/nature-height-coverage.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nature-height-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NATURE_HEIGHT_M } from '@/render/scale-contract';
import { ENTITY_KINDS } from '@/world/entity-kinds';

// Every vegetation / terrain-feature kind must have an authored metric height,
// so nothing silently falls back to the 1 m default.
describe('NATURE_HEIGHT_M coverage', () => {
  it('covers every vegetation and terrain-feature kind', () => {
    const missing: string[] = [];
    for (const [id, def] of ENTITY_KINDS) {
      if (def.category === 'vegetation' || def.category === 'terrain-feature') {
        if (!(id in NATURE_HEIGHT_M)) missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });
});
```

> Verify the registry export name first: `rg -n "export const ENTITY_KINDS|export function.*[Kk]ind" src/world/entity-kinds.ts`. If the catalog is exported under a different name (e.g. a `Map` named `KINDS`), adjust the import and iteration accordingly in this step.

- [ ] **Step 2: Run to verify it fails or passes**

Run: `npx vitest run tests/unit/nature-height-coverage.test.ts`
Expected: FAIL if any kind is missing (e.g. ground-cover ferns/shrubs not in the Slice-1 table). The failure message lists exactly which.

- [ ] **Step 3: Fill the gaps in `NATURE_HEIGHT_M`**

For each `id` the test lists as missing, add an authored metric height to `NATURE_HEIGHT_M` in `src/render/scale-contract.ts` (ground cover 0.3–0.6 m, shrubs ~1.5 m, saplings ~3 m, etc., per the kind's real nature). Re-run until the list is empty.

- [ ] **Step 4: Commit**

```bash
git add src/render/scale-contract.ts tests/unit/nature-height-coverage.test.ts
git commit -m "test(metric): every nature kind has an authored metric height"
```

### Task 5.2: Vegetation/boulder billboards size from metric height

**Files:**
- Modify: `src/render/iso/iso-sprites.ts:91-155` (`drawIsoVegetation`)
- Test: `tests/unit/iso-vegetation-size.test.ts` (create — pure size helper)

- [ ] **Step 1: Extract a pure size helper + test it**

Add to `src/render/iso/iso-sprites.ts` (above `drawIsoVegetation`):

```ts
import { NATURE_HEIGHT_M, DEFAULT_NATURE_HEIGHT_M, mToPx } from '@/render/scale-contract';
import { TREE_SPRITE_SRC } from '@/render/tree-sheets';

/**
 * Billboard target height (px) and the nearest INTEGER source-scale class for a
 * nature kind, given a per-instance variety multiplier (~0.85..1.15). Integer scale
 * keeps the blit pixel-crisp (1:1 rule). `variety` defaults to 1.
 * NOTE: source art is TREE_SPRITE_SRC px; a truthful tall tree is a large integer
 * upscale (blocky) until art is re-authored at native sizes (period/style track).
 */
export function natureBillboard(kind: string, variety = 1): { targetPx: number; srcScale: number } {
  const m = (NATURE_HEIGHT_M[kind] ?? DEFAULT_NATURE_HEIGHT_M) * variety;
  const targetPx = mToPx(m);
  const srcScale = Math.max(1, Math.round(targetPx / TREE_SPRITE_SRC));
  return { targetPx, srcScale };
}
```

Create `tests/unit/iso-vegetation-size.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { natureBillboard } from '@/render/iso/iso-sprites';
import { mToPx } from '@/render/scale-contract';

describe('natureBillboard', () => {
  it('oak is much taller than a boulder (truthful proportions)', () => {
    expect(natureBillboard('oak_tree').targetPx).toBeCloseTo(mToPx(15));   // 480
    expect(natureBillboard('boulder').targetPx).toBeCloseTo(mToPx(1.2));   // 38
    expect(natureBillboard('oak_tree').targetPx)
      .toBeGreaterThan(natureBillboard('boulder').targetPx * 8);
  });
  it('source-scale is always a positive integer', () => {
    const s = natureBillboard('oak_tree').srcScale;
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(1);
  });
  it('unknown kind falls back to default height', () => {
    expect(natureBillboard('made_up').targetPx).toBeCloseTo(mToPx(1.0));
  });
});
```

- [ ] **Step 2: Run to verify it fails then passes**

Run: `npx vitest run tests/unit/iso-vegetation-size.test.ts`
Expected: PASS once the helper compiles (FAIL first if helper absent).

- [ ] **Step 3: Wire the helper into `drawIsoVegetation`**

In `src/render/iso/iso-sprites.ts`, replace the sheet-blit and placeholder sizing in `drawIsoVegetation`. Replace lines 98-130 region:

```ts
  const scale = (e.properties?.scale as number) ?? Math.max(def.yOffsetForSort ?? 0.5, 0.5);
  ...
  const px = scale >= 1 ? 2 : 1;
  const treeW = TREE_SPRITE_SRC * px;
  const treeH = TREE_SPRITE_SRC * px;
  ...
  const isTree = def.defaultTags.includes('tree');
  const canopyR = 10 + scale * 22;
  const trunkH = isTree ? 16 + scale * 24 : 0;
```

so the metric height drives both the sheet blit and the drawn fallback. The new logic:

```ts
  // `scale` is now a per-instance VARIETY multiplier (~0.85..1.15), not an absolute size.
  const variety = (e.properties?.scale as number) ?? 1;
  const { targetPx, srcScale } = natureBillboard(e.kind, variety);
  ...
  // (sheet path) blit the source at an integer scale class:
  const treeW = TREE_SPRITE_SRC * srcScale;
  const treeH = TREE_SPRITE_SRC * srcScale;
  ...
  // (placeholder path) derive canopy/trunk from the same metric target:
  const isTree = def.defaultTags.includes('tree');
  const canopyR = isTree ? targetPx * 0.35 : targetPx * 0.5;
  const trunkH = isTree ? targetPx * 0.55 : 0;
```

Keep the existing `ctx.translate(Math.round(sx), Math.round(sy))`, `imageSmoothingEnabled = false`, column pick, and draw calls; only the width/height/`canopyR`/`trunkH` sources change. Remove the now-unused local `px` and the old `scale`-based formulas.

- [ ] **Step 4: Run the iso render suites**

Run: `npx vitest run tests/unit/ -t "vegetation"` and `npx vitest run tests/unit/iso-vegetation-size.test.ts`
Expected: PASS. Update any test asserting the old `canopyR`/2× pixel-class numbers to the metric values and note it.

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/iso-sprites.ts tests/unit/iso-vegetation-size.test.ts
git commit -m "feat(metric): vegetation/boulder billboards size from metric height"
```

### Task 5.3: Brush `scale` becomes a ±variety multiplier

**Files:**
- Modify: `src/world/brushes/vegetation-placer.ts:130` (undergrowth) — already a multiplier; documents intent
- Modify: brush callers that pass `scaleRange` (e.g. `src/world/brushes/forest.ts`, `pine-forest.ts`, `dense-forest.ts`, `scrubland.ts`, `hills.ts`) and `quarry.ts` for boulders
- Test: covered by 5.2 (the renderer reads `scale` as variety)

- [ ] **Step 1: Audit current `scaleRange` values**

Run: `rg -n "scaleRange" src/world/brushes`
Expected: lists each brush's range (today absolute, e.g. `[0.8, 1.2]`).

- [ ] **Step 2: Normalise ranges to variety bands**

For each brush, set `scaleRange` to a tight variety band centred on 1 — e.g. `[0.85, 1.15]` for trees, `[0.8, 1.2]` for boulders — so per-instance size varies ±15-20% around the kind's metric height. Where a brush deliberately placed "smaller" sub-kinds via scale (e.g. undergrowth `0.6`), keep that as a deliberate sub-1 multiplier (a small fern). Edit each file's `scaleRange:` accordingly.

- [ ] **Step 3: Run the brush/worldgen suites**

Run: `npx vitest run tests/unit/ -t "brush"` and `npx vitest run tests/unit/ -t "vegetation"`
Expected: PASS (placement is deterministic; only the stored `scale` band changed).

- [ ] **Step 4: Commit**

```bash
git add src/world/brushes
git commit -m "feat(metric): brush scale is a per-instance variety multiplier"
```

---

## SLICE 6 — Walls, terrain label, guard, verification

### Task 6.1: Author wall heights in metres

**Files:**
- Modify: the barrier-creation site that sets `run.height` (find it)
- Test: `tests/unit/iso-barrier.test.ts` or barrier model test (existing)

- [ ] **Step 1: Find where `run.height` is authored**

Run: `rg -n "height" src/world/barrier.ts src/world/*barrier* | rg -i "height"`
Expected: the default/constructed wall `height` (cube-units).

- [ ] **Step 2: Express the default in metres**

At that site, import `mToTiles` from `@/render/scale-contract` and set the default wall height from a metric constant, e.g. a 3 m rampart: `height: mToTiles(3)` (= 1.5 cube-units). `iso-barrier.ts` line 86 (`riseZ = run.height * HEIGHT_UNIT_PX`) is already metric-consistent (1 cube-unit → 64 px → 2 m → 32 px/m) and needs no change.

- [ ] **Step 3: Run the barrier suite**

Run: `npx vitest run tests/unit/ -t "barrier"`
Expected: PASS (update any asserted absolute height to the metric value and note it).

- [ ] **Step 4: Commit**

```bash
git add src/world tests
git commit -m "feat(metric): wall heights authored in metres"
```

### Task 6.2: Terrain metre label + delete transition aliases + guard

**Files:**
- Modify: `src/render/iso/iso-constants.ts` (doc comment)
- Modify: `src/render/scale-contract.ts` (remove the two deprecated aliases)
- Test: `tests/unit/no-relative-scale.test.ts` (create)

- [ ] **Step 1: Write the failing guard test**

Create `tests/unit/no-relative-scale.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as sc from '@/render/scale-contract';

describe('no relative-scale regressions', () => {
  it('deprecated relative-scale constants are gone', () => {
    expect((sc as Record<string, unknown>).DOOR_HEIGHT_UNITS).toBeUndefined();
    expect((sc as Record<string, unknown>).HUMAN_HEIGHT_UNITS).toBeUndefined();
  });
  it('scale-contract source defines the metric anchors', () => {
    const src = readFileSync('src/render/scale-contract.ts', 'utf8');
    expect(src).toMatch(/PX_PER_METRE/);
    expect(src).toMatch(/METRES_PER_TILE/);
  });
  it('no src file reintroduces a *_UNITS relative-scale constant', () => {
    const hits = execSync(
      "git grep -nE 'DOOR_HEIGHT_UNITS|HUMAN_HEIGHT_UNITS' -- 'src/*' || true",
      { encoding: 'utf8' },
    ).trim();
    expect(hits).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/no-relative-scale.test.ts`
Expected: FAIL — the aliases still exist in `scale-contract.ts`.

- [ ] **Step 3: Implement**

In `src/render/scale-contract.ts`, delete the transition-alias block:

```ts
// ── Transition aliases (deleted in Slice 6 once all callers move off them) ──
/** @deprecated use DOOR_HEIGHT_TILES */
export const DOOR_HEIGHT_UNITS = DOOR_HEIGHT_TILES;
/** @deprecated use mToTiles(HUMAN_HEIGHT_M) */
export const HUMAN_HEIGHT_UNITS = mToTiles(HUMAN_HEIGHT_M);
```

In `src/render/iso/iso-constants.ts`, add a doc comment above the exports:

```ts
// One ground tile spans METRES_PER_TILE (2 m) of world; see scale-contract.ts.
// The iso diamond is fixed at 128×64 px — terrain pixel size does not change with metric.
```

- [ ] **Step 4: Run the guard + a full typecheck**

Run: `npx vitest run tests/unit/no-relative-scale.test.ts`
Run: `npm run build`
Expected: guard PASS; build clean (no dangling import of the deleted aliases — if the build flags one, repoint it to the metric constant and re-run).

- [ ] **Step 5: Commit**

```bash
git add src/render/scale-contract.ts src/render/iso/iso-constants.ts tests/unit/no-relative-scale.test.ts
git commit -m "feat(metric): drop transition aliases; add terrain metre label + guard"
```

### Task 6.3: Full verification + in-game eyeball

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all green (≈1605+ tests). Fix any stragglers asserting pre-metric numbers.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean, manifold.wasm emitted.

- [ ] **Step 3: Preview render**

Run: `npx tsx scripts/assetgen-preview.ts` → open `tmp/assetgen-preview/gallery.html`.
Expected: buildings metric-consistent; doors at human height.

- [ ] **Step 4: In-game eyeball**

Run: `npm run dev` → open `http://localhost:3000` → **New World** (IndexedDB autosave restores the old world, so a reset is needed to see new sizes).
Verify against the truthful-look intent: an NPC reads ~1.7 m beside a ~6 m yurt; oaks tower (blocky upscales expected — note for the art track); boulders are knee-to-waist height; storeys look ~2.7 m, not 4 m.

- [ ] **Step 5: Commit any final test fixups**

```bash
git add tests
git commit -m "test(metric): final suite fixups for metric sizing"
```

---

## Self-review notes (spec coverage)

- §1 metric core → Slice 1 ✓
- §2 geometry cube-unit + dead `heightPerLevel` → Slice 2 ✓
- §3 building fixed-scale gen → Slice 3 ✓
- §4 NPC billboard → Slice 4 ✓; vegetation/boulder → Slice 5 ✓
- §5 terrain label + walls + tests (conversion, calibration, guard, coverage, golden) → Slices 5–6 ✓
- Known limitation (blocky tall trees) surfaced in Task 5.2 helper doc + eyeball step ✓
- Type consistency: `mToPx`/`mToTiles`/`snapPx`, `DOOR_HEIGHT_TILES`/`STOREY_TILES`/`STOREY_M`, `natureBillboard`, `fixedFit` names used consistently across tasks ✓
- Risk gating: fixed-scale building (Slice 3) gated by golden refresh + preview before later slices ✓
