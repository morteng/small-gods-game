# Asset-Gen Buildings (Track G, Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rectilinear building massing to the asset-gen geometry core — extruded walls over a wing-rectangle footprint plus parametric gable / hip / pyramidal / flat roofs — emitted as world-space `WorldFacet`s that flow through Slice 1's projection + dual-rasterizer, replacing the spike's screen-space box-union buildings.

**Architecture:** A building footprint is a set of **wings** (axis-aligned rectangles in tile coordinates). `wallFacets` walks the occupied cells and emits exterior wall quads (interior/shared walls culled) + top caps in world space; `roofFacets` puts a per-wing gable/hip/pyramidal/flat roof on each wing, **with closed gable ends** (fixing the spike's open-silhouette notch). Back-face culling + depth sorting (Slice 1) merge overlapping wings visually without CSG. A new `building` part wires this into `composeStructure`.

**Tech Stack:** TypeScript, Vitest. **No new runtime dependency** — the `straight-skeleton` npm package is deferred (async-WASM init + undocumented roof-height; our footprints are rectilinear). See the spec §6 revision note.

**Scope (this slice):** `src/assetgen/geometry/building.ts` (wings → walls + roofs), the `building` part in `compose.ts`, five reference buildings (cottage, tavern, longhouse, l_house, cross_chapel) as wing specs, tests, preview. **Out of scope:** doors / chimneys / seeded feature placement + the full anchor taxonomy (Slice 3); macros + scatter (Slice 3); gen/pixelize/AssetLibrary (Slice 4); agent tools (Slice 5); non-rectilinear/diagonal footprints (future escalation).

**Reference:** spec `docs/superpowers/specs/2026-06-07-llm-composable-reference-geometry-design.md` (§4, §6 revision, §7); Slice 1 modules in `src/assetgen/`; the spike's validated geometry in `scripts/openrouter-probe.ts:206-288` (screen-space original being ported to world-space here).

---

### Task 1: Building module scaffold — wings, occupancy, inset rectangles

**Files:**
- Create: `src/assetgen/geometry/building.ts`
- Test: `tests/unit/assetgen-building.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-building.test.ts
import { describe, it, expect } from 'vitest';
import { occupancy, cellRect, wingRect, type Wing } from '@/assetgen/geometry/building';

describe('building footprint helpers', () => {
  it('occupancy collects every cell of every wing', () => {
    const occ = occupancy([{ x: 0, y: 0, w: 2, h: 1 }]);
    expect([...occ].sort()).toEqual(['0,0', '1,0']);
  });

  it('cellRect insets exterior sides but keeps shared sides flush', () => {
    const occ = occupancy([{ x: 0, y: 0, w: 2, h: 1 }]); // cells (0,0)(1,0)
    const left = cellRect(occ, 0, 0);
    expect(left.x0).toBeCloseTo(0.32);  // west is exterior → inset
    expect(left.x1).toBeCloseTo(1);     // east borders (1,0) → flush
  });

  it('wingRect insets only where the wing meets open space', () => {
    const occ = occupancy([{ x: 0, y: 0, w: 1, h: 1 }]);
    const r = wingRect(occ, { x: 0, y: 0, w: 1, h: 1 });
    expect(r.x0).toBeCloseTo(0.32);
    expect(r.x1).toBeCloseTo(0.68);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/geometry/building`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/geometry/building.ts
import type { Vec3, Mat, RGB, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';

export type RoofKind = 'gable' | 'hip' | 'pyramidal' | 'flat';
export interface Wing { x: number; y: number; w: number; h: number; storeys?: number; roof?: RoofKind }

const STOREY = 2.1;                                  // cube-units of height per storey
const INSET = 0.32;                                  // exterior-side footprint inset (tiles)
const PITCH: Record<RoofKind, number> = { gable: 1.5, hip: 1.35, pyramidal: 1.7, flat: 0 };

const shade = (c: RGB, f: number): RGB => [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];

export function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x+w.w; i++) for (let j = w.y; j < w.y+w.h; j++) s.add(i+','+j);
  return s;
}
const has = (occ: Set<string>, i: number, j: number): boolean => occ.has(i+','+j);

export function cellStoreys(wings: Wing[], i: number, j: number): number {
  let m = 1;
  for (const w of wings) if (i>=w.x && i<w.x+w.w && j>=w.y && j<w.y+w.h) m = Math.max(m, w.storeys ?? 1);
  return m;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Ground rectangle of one cell; inset only on EXTERIOR sides (shared sides stay flush). */
export function cellRect(occ: Set<string>, i: number, j: number): Rect {
  return {
    x0: i     + (has(occ, i-1, j) ? 0 : INSET),
    x1: i + 1 - (has(occ, i+1, j) ? 0 : INSET),
    y0: j     + (has(occ, i, j-1) ? 0 : INSET),
    y1: j + 1 - (has(occ, i, j+1) ? 0 : INSET),
  };
}

/** Ground rectangle of a whole wing; inset only where the wing borders open space. */
export function wingRect(occ: Set<string>, w: Wing): Rect {
  const colShared = (ci: number) => { for (let j=w.y; j<w.y+w.h; j++) if (has(occ, ci, j)) return true; return false; };
  const rowShared = (rj: number) => { for (let i=w.x; i<w.x+w.w; i++) if (has(occ, i, rj)) return true; return false; };
  return {
    x0: w.x       + (colShared(w.x - 1)     ? 0 : INSET),
    x1: w.x + w.w - (colShared(w.x + w.w)   ? 0 : INSET),
    y0: w.y       + (rowShared(w.y - 1)     ? 0 : INSET),
    y1: w.y + w.h - (rowShared(w.y + w.h)   ? 0 : INSET),
  };
}

// (wallFacets / roofFacets / buildingFacets land in the following tasks.)
export { STOREY, INSET, PITCH, shade, has };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/building.ts tests/unit/assetgen-building.test.ts
git commit -m "feat(assetgen): building footprint helpers (wings, occupancy, inset rects)"
```

---

### Task 2: Wall facets (exterior walls + top caps, shared walls culled)

**Files:**
- Modify: `src/assetgen/geometry/building.ts`
- Test: `tests/unit/assetgen-building.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-building.test.ts
import { wallFacets } from '@/assetgen/geometry/building';
import { frontFacing } from '@/assetgen/render/projection';

describe('wall facets', () => {
  it('a single cell emits 4 walls + 1 top cap', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 1, h: 1 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    expect(f).toHaveLength(5);
    expect(f.filter(x => x.normal[2] === 1)).toHaveLength(1); // one top cap
  });

  it('culls the shared interior wall between two abutting cells', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 2, h: 1 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    // 2 cells: each has 3 exterior walls (shared side dropped) + 1 top = 4; total 8
    expect(f).toHaveLength(8);
  });

  it('raises walls to storey height', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 1, h: 1, storeys: 2 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    const maxZ = Math.max(...f.flatMap(x => x.pts.map(p => p[2])));
    expect(maxZ).toBeCloseTo(2 * 2.1);
  });

  it('keeps at least one camera-facing wall after projection cull', () => {
    const wings: Wing[] = [{ x: 0, y: 0, w: 1, h: 1 }];
    const f = wallFacets(wings, occupancy(wings), 'plaster');
    expect(f.filter(x => frontFacing(x.normal)).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: FAIL — `wallFacets` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/assetgen/geometry/building.ts (before the final `export { ... }` line; keep one export block)

/** Per-cell exterior walls (all four sides; shared sides culled) + a top cap. World space. */
export function wallFacets(wings: Wing[], occ: Set<string>, wallMat: Mat): WorldFacet[] {
  const c = MATERIAL_RGB[wallMat];
  const out: WorldFacet[] = [];
  for (const k of occ) {
    const [i, j] = k.split(',').map(Number);
    const r = cellRect(occ, i, j);
    const b = cellStoreys(wings, i, j) * STOREY;
    if (!has(occ, i, j-1)) out.push({ pts: [[r.x0,r.y0,0],[r.x1,r.y0,0],[r.x1,r.y0,b],[r.x0,r.y0,b]], normal: [0,-1,0], albedo: shade(c, 0.5) });  // north (culled at view)
    if (!has(occ, i, j+1)) out.push({ pts: [[r.x0,r.y1,0],[r.x1,r.y1,0],[r.x1,r.y1,b],[r.x0,r.y1,b]], normal: [0,1,0],  albedo: shade(c, 0.62) }); // south
    if (!has(occ, i-1, j)) out.push({ pts: [[r.x0,r.y0,0],[r.x0,r.y1,0],[r.x0,r.y1,b],[r.x0,r.y0,b]], normal: [-1,0,0], albedo: shade(c, 0.5) });  // west (culled)
    if (!has(occ, i+1, j)) out.push({ pts: [[r.x1,r.y0,0],[r.x1,r.y1,0],[r.x1,r.y1,b],[r.x1,r.y0,b]], normal: [1,0,0],  albedo: shade(c, 0.82) }); // east
    out.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b],[r.x1,r.y1,b],[r.x0,r.y1,b]], normal: [0,0,1], albedo: shade(c, 0.95) }); // top cap
  }
  return out;
}
```

> The Slice-1 rasterizer fills by scanline (winding-agnostic) and back-face-culls by the *provided* `normal`, so the north/west walls (normals `[0,-1,0]`/`[-1,0,0]`) are dropped at `projectFacets`, leaving the camera-facing south/east walls + top. Interior walls are never emitted (the `has(...)` guard), so nothing sits inside the mass.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: PASS (footprint + wall blocks).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/building.ts tests/unit/assetgen-building.test.ts
git commit -m "feat(assetgen): building wall facets (exterior walls + top caps)"
```

---

### Task 3: Roof facets (gable / hip / pyramidal / flat, closed gable ends)

**Files:**
- Modify: `src/assetgen/geometry/building.ts`
- Test: `tests/unit/assetgen-building.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-building.test.ts
import { roofFacets } from '@/assetgen/geometry/building';

describe('roof facets', () => {
  const occ1 = occupancy([{ x: 0, y: 0, w: 3, h: 2 }]);

  it('gable roof = 2 slopes + 2 closed ends, with a ridge', () => {
    const { facets, meta } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'gable' }, 'tile');
    expect(facets).toHaveLength(4);             // 2 slopes + 2 gable ends (no open notch)
    expect(meta.ridge).toBeDefined();
    expect(meta.apex).toBeUndefined();
  });

  it('gable ridge runs along the longer axis', () => {
    const { meta } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'gable' }, 'tile');
    const [a, b] = meta.ridge!;
    expect(Math.abs(a[0] - b[0])).toBeGreaterThan(Math.abs(a[1] - b[1])); // spans x (the long axis)
  });

  it('hip roof = 4 triangles meeting an apex', () => {
    const { facets, meta } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'hip' }, 'tile');
    expect(facets).toHaveLength(4);
    for (const f of facets) expect(f.pts).toHaveLength(3);
    expect(meta.apex).toBeDefined();
  });

  it('flat roof emits no roof facets (cell tops cover it)', () => {
    const { facets } = roofFacets(occ1, { x: 0, y: 0, w: 3, h: 2, roof: 'flat' }, 'tile');
    expect(facets).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: FAIL — `roofFacets` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/assetgen/geometry/building.ts

export interface RoofMeta { ridge?: [Vec3, Vec3]; apex?: Vec3 }

/** One wing's roof in world space. Gable ends are closed (no open silhouette notch). */
export function roofFacets(occ: Set<string>, w: Wing, roofMat: Mat): { facets: WorldFacet[]; meta: RoofMeta } {
  const kind = w.roof ?? 'gable';
  const c = MATERIAL_RGB[roofMat];
  const r = wingRect(occ, w);
  const b = (w.storeys ?? 1) * STOREY;
  const shortSpan = Math.max(0.5, Math.min(w.w, w.h) - 2 * INSET);
  const rise = PITCH[kind] * (shortSpan / 2);
  const top = b + rise;
  const facets: WorldFacet[] = [];
  const meta: RoofMeta = {};
  if (kind === 'flat') return { facets, meta };

  if (kind === 'gable') {
    if (w.w >= w.h) {                                   // ridge along x (long axis)
      const ym = (r.y0 + r.y1) / 2;
      const ra: Vec3 = [r.x0, ym, top], rb: Vec3 = [r.x1, ym, top];
      facets.push({ pts: [[r.x0,r.y1,b],[r.x1,r.y1,b], rb, ra], normal: [0, PITCH.gable, 1],  albedo: shade(c, 0.84) }); // south slope
      facets.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b], rb, ra], normal: [0, -PITCH.gable, 1], albedo: shade(c, 1.0) });  // north slope
      facets.push({ pts: [[r.x1,r.y0,b],[r.x1,r.y1,b], rb],     normal: [1, 0, 0],            albedo: shade(c, 0.8) });  // east gable end
      facets.push({ pts: [[r.x0,r.y0,b],[r.x0,r.y1,b], ra],     normal: [-1, 0, 0],           albedo: shade(c, 0.6) });  // west gable end
      meta.ridge = [ra, rb];
    } else {                                            // ridge along y
      const xm = (r.x0 + r.x1) / 2;
      const ra: Vec3 = [xm, r.y0, top], rb: Vec3 = [xm, r.y1, top];
      facets.push({ pts: [[r.x1,r.y0,b],[r.x1,r.y1,b], rb, ra], normal: [PITCH.gable, 0, 1],  albedo: shade(c, 0.84) }); // east slope
      facets.push({ pts: [[r.x0,r.y0,b],[r.x0,r.y1,b], rb, ra], normal: [-PITCH.gable, 0, 1], albedo: shade(c, 1.0) });  // west slope
      facets.push({ pts: [[r.x0,r.y1,b],[r.x1,r.y1,b], rb],     normal: [0, 1, 0],            albedo: shade(c, 0.62) }); // south gable end
      facets.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b], ra],     normal: [0, -1, 0],           albedo: shade(c, 0.5) });  // north gable end
      meta.ridge = [ra, rb];
    }
  } else {                                              // hip | pyramidal — apex
    const ap: Vec3 = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, top];
    facets.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b], ap], normal: [0, -1, 1], albedo: shade(c, 1.0) });  // north
    facets.push({ pts: [[r.x1,r.y0,b],[r.x1,r.y1,b], ap], normal: [1, 0, 1],  albedo: shade(c, 0.82) }); // east
    facets.push({ pts: [[r.x0,r.y1,b],[r.x1,r.y1,b], ap], normal: [0, 1, 1],  albedo: shade(c, 0.7) });  // south
    facets.push({ pts: [[r.x0,r.y0,b],[r.x0,r.y1,b], ap], normal: [-1, 0, 1], albedo: shade(c, 0.6) });  // west
    meta.apex = ap;
  }
  return { facets, meta };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: PASS (footprint + wall + roof blocks).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/building.ts tests/unit/assetgen-building.test.ts
git commit -m "feat(assetgen): parametric roofs (gable/hip/pyramidal/flat, closed ends)"
```

---

### Task 4: buildingFacets + `building` part in composeStructure

**Files:**
- Modify: `src/assetgen/geometry/building.ts`
- Modify: `src/assetgen/compose.ts`
- Test: `tests/unit/assetgen-building.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-building.test.ts
import { buildingFacets } from '@/assetgen/geometry/building';
import { composeStructure, type StructureSpec } from '@/assetgen/compose';

const BUILDINGS: Record<string, Wing[]> = {
  cottage:      [{ x: 0, y: 0, w: 3, h: 3, roof: 'gable' }],
  tavern:       [{ x: 0, y: 0, w: 3, h: 3, storeys: 2, roof: 'hip' }],
  longhouse:    [{ x: 0, y: 0, w: 4, h: 2, roof: 'gable' }],
  l_house:      [{ x: 0, y: 0, w: 4, h: 2, roof: 'gable' }, { x: 0, y: 0, w: 2, h: 4, roof: 'gable' }],
  cross_chapel: [{ x: 0, y: 1, w: 4, h: 2, roof: 'gable' }, { x: 1, y: 0, w: 2, h: 4, roof: 'gable' }],
};

describe('buildingFacets + building part', () => {
  it('buildingFacets combines walls + a roof per wing', () => {
    const f = buildingFacets(BUILDINGS.cottage);
    expect(f.length).toBeGreaterThan(5); // walls (9 cells worth) + 4 roof facets
  });

  it('every reference building composes to aligned grey + normal with a real bbox', () => {
    for (const [name, wings] of Object.entries(BUILDINGS)) {
      const spec: StructureSpec = { size: 256, parts: [{ prim: 'building', wings }] };
      const r = composeStructure(spec);
      let mismatches = 0;
      for (let i = 3; i < r.grey.length; i += 4) if ((r.grey[i] > 0) !== (r.normal[i] > 0)) mismatches++;
      expect(mismatches, `${name} grey/normal mask aligned`).toBe(0);
      expect(r.bbox.w, `${name} has width`).toBeGreaterThan(0);
      expect(r.bbox.h, `${name} has height`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: FAIL — `buildingFacets` not exported / `building` part not handled.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/assetgen/geometry/building.ts

/** Full building massing: exterior walls + a roof per wing. World-space facets. */
export function buildingFacets(wings: Wing[], wallMat: Mat = 'plaster', roofMat: Mat = 'tile'): WorldFacet[] {
  const occ = occupancy(wings);
  const out = wallFacets(wings, occ, wallMat);
  for (const w of wings) out.push(...roofFacets(occ, w, roofMat).facets);
  return out;
}
```

```ts
// src/assetgen/compose.ts — add the import and the part variant + dispatch.

// 1) extend the imports at the top:
import { buildingFacets, type Wing } from '@/assetgen/geometry/building';
import type { Mat } from '@/assetgen/types';

// 2) add to the `Part` union:
//   | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat }

// 3) add to the `partFacets` switch:
//   case 'building': return buildingFacets(p.wings, p.wallMat, p.roofMat);
```

Apply those three edits to `compose.ts`. The resulting `Part` union and switch must include the `building` case; `Mat` is already used indirectly — import it explicitly as shown.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-building.test.ts`
Expected: PASS (all building blocks, including the 5-building loop).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/building.ts src/assetgen/compose.ts tests/unit/assetgen-building.test.ts
git commit -m "feat(assetgen): buildingFacets + building part (5 reference buildings)"
```

---

### Task 5: Preview the buildings + full slice verification

**Files:**
- Modify: `scripts/assetgen-preview.ts`

- [ ] **Step 1: Add the reference buildings to the preview script**

Edit `scripts/assetgen-preview.ts`: add a `building` import-free entry to the `SAMPLES` map (the `composeStructure` part shape is enough — no new import needed since parts are plain data). Insert these entries into the `SAMPLES` object:

```ts
  cottage:      { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3, roof:'gable' }] }] },
  tavern:       { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3, storeys:2, roof:'hip' }] }] },
  longhouse:    { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:4,h:2, roof:'gable' }] }] },
  l_house:      { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:4,h:2, roof:'gable' }, { x:0,y:0,w:2,h:4, roof:'gable' }] }] },
  cross_chapel: { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:1,w:4,h:2, roof:'gable' }, { x:1,y:0,w:2,h:4, roof:'gable' }] }] },
```

> If TypeScript complains that the inline `roof` string is a plain `string`, add `as const` to each wings array (e.g. `wings: [{ x:0,y:0,w:3,h:3, roof:'gable' }] as const`) or annotate the SAMPLES map value type. The simplest fix: `import type { Wing } from '../src/assetgen/geometry/building';` and type each entry's `wings` as `Wing[]`.

- [ ] **Step 2: Run the preview**

Run: `npx tsx scripts/assetgen-preview.ts`
Expected: writes `{cottage,tavern,longhouse,l_house,cross_chapel}-{grey,normal}.png` (plus the Slice-1 samples) to `tmp/assetgen-preview/` and prints a bbox line per sample. Open them: each should read as a proper massing — cottage a gable cottage, tavern a two-storey hipped block, longhouse a long gable hall, l_house a clean L, cross_chapel a cruciform church — **with closed gable ends** (no triangular notch in the silhouette) and a clean per-face normal map.

- [ ] **Step 3: Run the full assetgen suite + typecheck**

Run: `npx vitest run tests/unit/assetgen-*.test.ts && npx tsc --noEmit`
Expected: all assetgen tests PASS (Slice 1 + Slice 2); `tsc` exits 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/assetgen-preview.ts
git commit -m "chore(assetgen): preview the five reference buildings"
```

---

## Self-Review

**Spec coverage (Slice 2 scope):**
- §4 `extrusion`/building part → realized as the rectilinear `building` part (Task 4), per the §6 revision. ✓
- §6 revision (rectilinear roofs in world space, no `straight-skeleton` dep, closed gable ends) → Tasks 2–3. ✓
- §7 world-space facets through Slice-1 projection + dual-rasterize + alignment → Task 4's alignment test. ✓
- The five reference buildings compose → Task 4. (cottage/tavern/longhouse/l_house/cross_chapel; t_hall omitted as redundant with l_house/cross_chapel for coverage — note for Slice 3 macros.) ✓

**Placeholder scan:** No TBD/TODO. Task 4's `compose.ts` edit is described as three concrete edits with the exact union member and switch case; Task 5 gives the exact `SAMPLES` entries and the `as const`/`Wing[]` fix. ✓

**Type consistency:** `Wing`/`RoofKind`/`Rect`/`RoofMeta` defined in Tasks 1–3 and consumed in Task 4. `wallFacets(wings, occ, wallMat)`, `roofFacets(occ, w, roofMat)`, `buildingFacets(wings, wallMat?, roofMat?)` signatures match between definition and call sites. The `building` part shape `{ prim:'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat }` matches `partFacets`'s `buildingFacets(p.wings, p.wallMat, p.roofMat)`. `Vec3`/`Mat`/`WorldFacet`/`RGB` reused from Slice 1's `types.ts`. ✓

**Note for the implementer:** Task 1 ends `building.ts` with `export { STOREY, INSET, PITCH, shade, has };` for internal reuse; Tasks 2–4 *append* functions that use those bindings directly (they are in module scope) — do **not** re-declare them. Keep a single trailing `export { ... }` (or convert the consts to inline `export const` and drop the block) so there are no duplicate exports. The `building.ts` → `projection.ts` ordering is satisfied (building.ts imports nothing from projection; alignment is verified only through `composeStructure`).
