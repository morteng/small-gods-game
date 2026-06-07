# Assetgen manifold-3d Geometry Pivot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled assetgen geometry construction (`roof-unified.ts` + the solid math in `primitives.ts`/`building.ts`) with the robust `manifold-3d` WASM CSG kernel, eliminating the multi-wing roof-valley z-fighting stripe, while keeping the entire render pipeline (projection + z-buffer rasterizer + fit + compose).

**Architecture:** A lazy async singleton initialises the manifold WASM module once. Each `Part` primitive builds a closed `Manifold` solid; a building is `union(wing wall-boxes)` + `union(wing roof-prisms)` as two separate solids (walls/roof disjoint in z → each carries its own material, no provenance bookkeeping). The union of crossed roof prisms produces correct hips/valleys by construction. `manifoldToFacets()` walks the watertight mesh's `triVerts`/`vertProperties` into flat-normal `WorldFacet[]`, which feed the existing projection/rasterizer unchanged. `composeStructure` becomes async.

**Tech Stack:** TypeScript ESM, `manifold-3d@3.5.1` (WASM CSG), Vitest, Node-only asset-gen (browser/Vite wasm plumbing deferred).

---

## Background the implementer needs

- `manifold-3d` is already installed (`dependencies` in `package.json`, v3.5.1). Import path: `import Module from 'manifold-3d'` (default export). It is ESM, WASM-backed. In **Node/vitest the wasm file is located automatically** — no `locateFile` config needed.
- Init pattern:
  ```ts
  import Module from 'manifold-3d';
  const wasm = await Module();      // Promise<ManifoldToplevel>
  wasm.setup();                     // MUST call before using Manifold
  const { Manifold } = wasm;
  wasm.setCircularSegments(32);     // pin tessellation for determinism
  ```
- Key API (from `node_modules/manifold-3d/manifold-encapsulated-types.d.ts`):
  - `Manifold.cube(size?: Vec3|number, center?: boolean): Manifold` — default `center=false` → corner at origin, spans `[0,0,0]`→`size`.
  - `Manifold.cylinder(height, radiusLow, radiusHigh?, circularSegments?, center?): Manifold` — base at z=0, axis +z; `center=false`.
  - `Manifold.sphere(radius, circularSegments?): Manifold` — centred at origin.
  - `Manifold.extrude(polygons: Polygons, height, nDivisions?, twistDegrees?, scaleTop?, center?): Manifold` — `Polygons = SimplePolygon | SimplePolygon[]`, `SimplePolygon = Vec2[]`. 2D polygon in the XY plane swept along +Z by `height`.
  - instance: `.translate([x,y,z])`, `.rotate([xDeg,yDeg,zDeg])`, `.scale(v: Vec3|number)`, `.add(o)`, `.intersect(o)`, `.subtract(o)`.
  - static: `Manifold.union(a, b)` and `Manifold.union(manifolds: Manifold[])`.
  - `.getMesh(): Mesh` where `Mesh` has `numProp: number`, `vertProperties: Float32Array` (stride `numProp`; first 3 floats per vertex are x,y,z), `triVerts: Uint32Array` (3 vertex indices per triangle), getters `numTri`/`numVert`.
  - `.boundingBox(): Box` where `Box` has `.min: Vec3` and `.max: Vec3`. `.volume(): number`. `.genus(): number`. `.numTri(): number`.
- Existing types to reuse (do **not** change): `WorldFacet { pts: Vec3[]; normal: Vec3; albedo: RGB }` and `ScreenFacet` in `src/assetgen/types.ts`; `MATERIAL_RGB`, `Mat`, `Vec2`, `Vec3`, `RGB`. Existing render fns: `projectFacets` (already back-face-culls via `frontFacing` + emits per-vertex `depths`), `rasterize` (per-pixel z-buffer), `computeFit`, `opaqueBounds`.
- `projectFacets` culls back faces and the rasterizer z-buffers per pixel, so emitting **full closed watertight meshes** is correct — drop the old "only emit the 3 camera-facing faces" hack.
- Constants carried over: `STOREY = 2.1`. Roof pitch: `gable 1.5`, `hip 1.35` (rise = pitch × halfSpan).
- Determinism guard `tests/unit/no-random-in-sim.test.ts` does not cover assetgen; manifold ops are deterministic given pinned `setCircularSegments`. Do not introduce `Math.random`.

## File Structure

- **Create** `src/assetgen/geometry/manifold-runtime.ts` — lazy `getManifold()` singleton (the only async/WASM seam).
- **Create** `src/assetgen/geometry/solids.ts` — `Manifold` builders per primitive + `solidBuilding` + `manifoldToFacets`.
- **Modify** `src/assetgen/compose.ts` — `composeStructure` → async; `partFacets` → async via `solids.ts`.
- **Modify** `src/assetgen/geometry/building.ts` — keep `Wing`/`RoofKind` types + `occupancy`; **delete** `wallFacets`/`roofFacets`/`buildingFacets`/`cellRect`/`wingRect`/`cellStoreys` (now in `solids.ts`).
- **Modify** `src/assetgen/geometry/primitives.ts` — **delete** (the hand-rolled facet emitters are replaced by `solids.ts`). Remove the file and its imports.
- **Delete** `src/assetgen/geometry/roof-unified.ts`.
- **Modify** `scripts/assetgen-preview.ts` — `await composeStructure(...)`.
- **Modify/Create** tests: `tests/unit/assetgen-manifold-runtime.test.ts`, `tests/unit/assetgen-solids.test.ts`, update `tests/unit/assetgen-compose*.test.ts` and any test importing `primitives`/`roof-unified`/`building` facet fns to be async / use the new path.

---

### Task 1: manifold runtime singleton

**Files:**
- Create: `src/assetgen/geometry/manifold-runtime.ts`
- Test: `tests/unit/assetgen-manifold-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-manifold-runtime.test.ts
import { describe, it, expect } from 'vitest';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';

describe('getManifold', () => {
  it('initialises the wasm module and exposes Manifold', async () => {
    const m = await getManifold();
    expect(typeof m.Manifold.cube).toBe('function');
    const box = m.Manifold.cube([2, 3, 4]);
    const bb = box.boundingBox();
    expect(bb.min).toEqual([0, 0, 0]);
    expect(bb.max[0]).toBeCloseTo(2, 5);
    expect(bb.max[2]).toBeCloseTo(4, 5);
  });

  it('returns the same cached instance on repeated calls', async () => {
    const a = await getManifold();
    const b = await getManifold();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-manifold-runtime.test.ts`
Expected: FAIL — cannot find module `manifold-runtime`.

- [ ] **Step 3: Write the implementation**

```ts
// src/assetgen/geometry/manifold-runtime.ts
// Lazy singleton for the manifold-3d WASM CSG kernel. The ONE async/WASM seam in
// assetgen geometry. Node-side only for now (the Emscripten module locates
// manifold.wasm automatically); browser/Vite wasm-URL plumbing is a later slice.
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

/** Tessellation segments for cylinders/spheres — pinned so output is deterministic. */
export const CIRCULAR_SEGMENTS = 32;

let cached: Promise<ManifoldToplevel> | undefined;

/** Resolve the initialised manifold toplevel (cached after first call). */
export function getManifold(): Promise<ManifoldToplevel> {
  if (!cached) {
    cached = Module().then((wasm) => {
      wasm.setup();
      wasm.setCircularSegments(CIRCULAR_SEGMENTS);
      return wasm;
    });
  }
  return cached;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-manifold-runtime.test.ts`
Expected: PASS (2 tests). If `ManifoldToplevel` is not exported from the package root types, import it from `'manifold-3d/manifold-encapsulated-types.d.ts'` types or fall back to `Awaited<ReturnType<typeof Module>>`.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/manifold-runtime.ts tests/unit/assetgen-manifold-runtime.test.ts
git commit -m "feat(assetgen): manifold-3d runtime singleton"
```

---

### Task 2: manifoldToFacets — mesh → WorldFacet[]

**Files:**
- Create: `src/assetgen/geometry/solids.ts` (first export)
- Test: `tests/unit/assetgen-solids.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-solids.test.ts
import { describe, it, expect } from 'vitest';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import { manifoldToFacets } from '@/assetgen/geometry/solids';

describe('manifoldToFacets', () => {
  it('emits one flat-shaded facet per mesh triangle of a closed cube', async () => {
    const { Manifold } = await getManifold();
    const mesh = Manifold.cube([1, 1, 1]).getMesh();
    const facets = manifoldToFacets(mesh, 'stone');
    expect(facets.length).toBe(mesh.numTri);          // 12 tris for a cube
    // every facet has a 3-vertex polygon, a unit-ish normal, and an RGB albedo
    for (const f of facets) {
      expect(f.pts.length).toBe(3);
      const len = Math.hypot(...f.normal);
      expect(len).toBeGreaterThan(0.5);
      expect(f.albedo).toHaveLength(3);
    }
  });

  it('shades the top face (normal +z) brighter than a side face', async () => {
    const { Manifold } = await getManifold();
    const facets = manifoldToFacets(Manifold.cube([1, 1, 1]).getMesh(), 'plaster');
    const top = facets.find(f => f.normal[2] > 0.9)!;
    const side = facets.find(f => Math.abs(f.normal[2]) < 0.1)!;
    expect(top.albedo[0]).toBeGreaterThan(side.albedo[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts`
Expected: FAIL — cannot find module `solids`.

- [ ] **Step 3: Write the implementation**

```ts
// src/assetgen/geometry/solids.ts
import type { Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Mesh } from 'manifold-3d';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (u: Vec3, v: Vec3): Vec3 =>
  [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
const shadeRGB = (c: RGB, f: number): RGB =>
  [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];

/** Slope shade for the GREY reference: top brightest, +x brighter than +y, undersides dim. */
function brightness(n: Vec3): number {
  const u = norm(n);
  // top-down key light from +x/+y/up; clamps to a readable grey range.
  const k = u[0]*0.30 + u[1]*0.18 + u[2]*0.85;
  return Math.max(0.42, Math.min(1, 0.6 + 0.4 * k));
}

/** Convert a watertight manifold Mesh into flat-normal world facets, one per triangle. */
export function manifoldToFacets(mesh: Mesh, material: Mat): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const { numProp, vertProperties: vp, triVerts: tv } = mesh;
  const pos = (i: number): Vec3 => [vp[i*numProp], vp[i*numProp+1], vp[i*numProp+2]];
  const out: WorldFacet[] = [];
  for (let t = 0; t < tv.length; t += 3) {
    const a = pos(tv[t]), b = pos(tv[t+1]), d = pos(tv[t+2]);
    const n = cross(sub(b, a), sub(d, a));         // outward (manifold winding is CCW-outward)
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) continue; // skip degenerate
    out.push({ pts: [a, b, d], normal: n, albedo: shadeRGB(c, brightness(n)) });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/solids.ts tests/unit/assetgen-solids.test.ts
git commit -m "feat(assetgen): manifoldToFacets mesh→WorldFacet emitter"
```

---

### Task 3: primitive solids (box/cylinder/cone/prism/ellipsoid/arch)

**Files:**
- Modify: `src/assetgen/geometry/solids.ts`
- Test: `tests/unit/assetgen-solids.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-solids.test.ts
import { solidBox, solidCylinder, solidCone, solidArch } from '@/assetgen/geometry/solids';

describe('primitive solids', () => {
  it('solidBox spans at→at+size', async () => {
    const m = await solidBox([1, 2, 0], [2, 2, 3]);
    const bb = m.boundingBox();
    expect(bb.min).toEqual([1, 2, 0]);
    expect(bb.max[0]).toBeCloseTo(3, 5);
    expect(bb.max[2]).toBeCloseTo(3, 5);
  });

  it('solidCylinder sits on baseZ with the right radius and height', async () => {
    const m = await solidCylinder([0, 0], 1, 0.5, 2);
    const bb = m.boundingBox();
    expect(bb.min[2]).toBeCloseTo(1, 5);
    expect(bb.max[2]).toBeCloseTo(3, 5);
    expect(bb.max[0]).toBeCloseTo(0.5, 2);
  });

  it('solidCone tapers to a point (volume < equivalent cylinder)', async () => {
    const cone = await solidCone([0, 0], 0, 1, 2);
    const cyl = await solidCylinder([0, 0], 0, 1, 2);
    expect(cone.volume()).toBeLessThan(cyl.volume());
    expect(cone.volume()).toBeGreaterThan(0);
  });

  it('solidArch is a single connected post-and-lintel solid', async () => {
    const m = await solidArch([0, 0, 0], 2, 2, 0.4);
    expect(m.volume()).toBeGreaterThan(0);
    const bb = m.boundingBox();
    expect(bb.max[0]).toBeCloseTo(2, 2);        // spans the full span in +x
    expect(bb.max[2]).toBeCloseTo(2.4, 2);      // height + lintel thickness
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts`
Expected: FAIL — `solidBox` etc. not exported.

- [ ] **Step 3: Write the implementation (append to solids.ts)**

```ts
// append to src/assetgen/geometry/solids.ts
import type { Vec2 } from '@/assetgen/types';
import { getManifold } from '@/assetgen/geometry/manifold-runtime';
import type { Manifold } from 'manifold-3d';

/** Axis-aligned box: min corner `at`, extent `size`. */
export async function solidBox(at: Vec3, size: Vec3): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cube(size).translate(at);
}

/** Vertical cylinder, base centred at (cx,cy,baseZ). */
export async function solidCylinder(center: Vec2, baseZ: number, radius: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radius, radius).translate([center[0], center[1], baseZ]);
}

/** Cone (radiusTop=0) or frustum, base centred at (cx,cy,baseZ). */
export async function solidCone(center: Vec2, radiusTop: number, radiusBase: number, height: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radiusBase, radiusTop).translate([center[0], center[1], 0]).translate([0, 0, 0]);
  // NB: baseZ handled by caller via .translate if needed; see solidConeAt below.
}

/** Regular n-gon prism (n sides), base centred at (cx,cy,baseZ). */
export async function solidPrism(center: Vec2, baseZ: number, radius: number, height: number, sides: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.cylinder(height, radius, radius, sides).translate([center[0], center[1], baseZ]);
}

/** Ellipsoid centred at (cx,cy,baseZ+rz), radii [rx,ry,rz]. */
export async function solidEllipsoid(center: Vec2, baseZ: number, radii: Vec3): Promise<Manifold> {
  const { Manifold } = await getManifold();
  return Manifold.sphere(1).scale(radii).translate([center[0], center[1], baseZ + radii[2]]);
}

/** Post-and-lintel arch (two uprights + a spanning beam) as one unioned solid, spanning +x. */
export async function solidArch(at: Vec3, span: number, height: number, thickness: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const t = thickness;
  const left  = Manifold.cube([t, t, height]).translate([at[0], at[1], at[2]]);
  const right = Manifold.cube([t, t, height]).translate([at[0] + span - t, at[1], at[2]]);
  const beam  = Manifold.cube([span, t, t]).translate([at[0], at[1], at[2] + height]);
  return Manifold.union([left, right, beam]);
}
```

> Note for the implementer: fix `solidCone` to honour `baseZ` like the others (add a `baseZ` param matching `solidCylinder`'s signature: `solidCone(center, baseZ, radiusTop, radiusBase, height)` and `.translate([cx,cy,baseZ])`). The stub above is intentionally minimal; make its signature consistent with `solidCylinder` and update the test's `solidCone([0,0], 0, 0, 1, 2)` call accordingly. Pick the signature, make it consistent, keep the test meaningful (cone volume < cylinder volume).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts`
Expected: PASS. Adjust `solidCone` signature/test together until green.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/solids.ts tests/unit/assetgen-solids.test.ts
git commit -m "feat(assetgen): manifold primitive solid builders"
```

---

### Task 4: building solids — wall union + roof prism union (kills the stripe)

**Files:**
- Modify: `src/assetgen/geometry/solids.ts`
- Modify: `src/assetgen/geometry/building.ts` (keep `Wing`/`RoofKind`/`STOREY`/`occupancy`; export them; remove facet fns in Task 6)
- Test: `tests/unit/assetgen-solids.test.ts` (append)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-solids.test.ts
import { buildingFacets } from '@/assetgen/geometry/solids';
import type { Wing } from '@/assetgen/geometry/building';

describe('buildingFacets (manifold)', () => {
  const cross: Wing[] = [
    { x: 0, y: 1, w: 4, h: 2 },   // nave (long axis x)
    { x: 1, y: 0, w: 2, h: 4 },   // transept (long axis y)
  ];

  it('emits facets for a multi-wing footprint without throwing', async () => {
    const facets = await buildingFacets(cross, 'plaster', 'tile', 'gable');
    expect(facets.length).toBeGreaterThan(0);
  });

  it('roof reaches above the wall top (a ridge exists)', async () => {
    const facets = await buildingFacets(cross, 'plaster', 'tile', 'gable');
    const maxZ = Math.max(...facets.flatMap(f => f.pts.map(p => p[2])));
    expect(maxZ).toBeGreaterThan(2.1);   // STOREY = 2.1 wall top
  });

  it('hip roof of a single square wing peaks at one apex', async () => {
    const square: Wing[] = [{ x: 0, y: 0, w: 2, h: 2 }];
    const facets = await buildingFacets(square, 'plaster', 'tile', 'hip');
    const top = Math.max(...facets.flatMap(f => f.pts.map(p => p[2])));
    const apexPts = facets.flatMap(f => f.pts).filter(p => Math.abs(p[2] - top) < 1e-6);
    // hip apex is a single (x,y) point shared by the top tris
    const xs = new Set(apexPts.map(p => p[0].toFixed(3)));
    const ys = new Set(apexPts.map(p => p[1].toFixed(3)));
    expect(xs.size).toBe(1);
    expect(ys.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts -t buildingFacets`
Expected: FAIL — `buildingFacets` not exported from `solids`.

- [ ] **Step 3: Write the implementation (append to solids.ts)**

```ts
// append to src/assetgen/geometry/solids.ts
import { STOREY, type Wing, type RoofStyle } from '@/assetgen/geometry/building';

const GABLE_PITCH = 1.5, HIP_PITCH = 1.35;

/** A gable-roof prism over one wing rect, ridge along the wing's LONG axis. */
async function wingGablePrism(w: Wing, ridgeAxis: 'x' | 'y', pitch: number): Promise<Manifold> {
  const { Manifold } = await getManifold();
  const b = (w.storeys ?? 1) * STOREY;
  // 2D triangle profile (u across span, v up), extruded along the ridge length, then oriented.
  if (ridgeAxis === 'x') {
    const rise = pitch * (w.h / 2);
    const profile = [[0, 0], [w.h, 0], [w.h / 2, rise]] as [number, number][];
    // extrude sweeps the XY profile along +Z by length w.w → prism axis = Z. Reorient axis Z→X.
    return Manifold.extrude(profile, w.w)
      .rotate([0, 90, 0])            // map prism axis to +x  (TUNE against the test if needed)
      .translate([w.x, w.y, b]);     // profile origin → wing min corner at wall top
  } else {
    const rise = pitch * (w.w / 2);
    const profile = [[0, 0], [w.w, 0], [w.w / 2, rise]] as [number, number][];
    return Manifold.extrude(profile, w.h)
      .rotate([0, 90, 0])
      .rotate([0, 0, 90])            // map prism axis to +y  (TUNE against the test if needed)
      .translate([w.x, w.y, b]);
  }
}

/** One wing's roof solid: gable (single prism, long axis) or hip (two perpendicular prisms intersected). */
async function wingRoof(w: Wing, style: RoofStyle): Promise<Manifold> {
  const longAxis: 'x' | 'y' = w.w >= w.h ? 'x' : 'y';
  if (style === 'gable') return wingGablePrism(w, longAxis, GABLE_PITCH);
  // hip = gable-along-x ∩ gable-along-y → proper hipped ends (a pyramid over a square)
  const px = await wingGablePrism(w, 'x', HIP_PITCH);
  const py = await wingGablePrism(w, 'y', HIP_PITCH);
  return px.intersect(py);
}

/**
 * Full building massing as flat-normal facets.
 * Walls and roof are built as TWO separate unioned solids (disjoint in z), each carrying
 * its own material — no per-triangle provenance needed. The union of crossed roof prisms
 * yields correct hips/valleys by construction (this replaces the hand-rolled height field).
 */
export async function buildingFacets(
  wings: Wing[], wallMat: Mat = 'plaster', roofMat: Mat = 'tile', roofStyle: RoofStyle = 'gable',
): Promise<WorldFacet[]> {
  const { Manifold } = await getManifold();
  const wallSolids = await Promise.all(
    wings.map(w => solidBox([w.x, w.y, 0], [w.w, w.h, (w.storeys ?? 1) * STOREY])),
  );
  const roofSolids = await Promise.all(wings.map(w => wingRoof(w, roofStyle)));
  const walls = Manifold.union(wallSolids);
  const roof = Manifold.union(roofSolids);
  return [
    ...manifoldToFacets(walls.getMesh(), wallMat),
    ...manifoldToFacets(roof.getMesh(), roofMat),
  ];
}
```

Also add to `src/assetgen/geometry/building.ts` (it currently has `RoofKind`; add the two-value render style):

```ts
// in src/assetgen/geometry/building.ts — keep Wing, STOREY, occupancy; add:
export type RoofStyle = 'gable' | 'hip';
```

(If `RoofStyle` is already imported from `roof-unified.ts` elsewhere, repoint those imports to `building.ts`; `roof-unified.ts` is deleted in Task 6.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts -t buildingFacets`
Expected: PASS. **The `.rotate(...)` calls in `wingGablePrism` are the one thing to TUNE:** run the test, inspect the failing axis/bbox, and adjust the Euler rotation (and any post-rotate translate offset) until the gable ridge runs along the correct world axis and the roof sits on the wall top at the wing's footprint. The test asserts the invariants (roof above wall top; hip → single apex column); make them pass. Add a temporary bbox `console.log(roof.boundingBox())` while tuning, remove before commit.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/solids.ts src/assetgen/geometry/building.ts tests/unit/assetgen-solids.test.ts
git commit -m "feat(assetgen): building solids via manifold union (fixes roof-valley stripe)"
```

---

### Task 5: compose.ts → async, wired to solids.ts

**Files:**
- Modify: `src/assetgen/compose.ts`
- Test: update existing `tests/unit/assetgen-compose*.test.ts`

- [ ] **Step 1: Update the compose test to await (write the failing expectation)**

Find the existing compose test(s) (e.g. `tests/unit/assetgen-compose.test.ts`). Convert each `composeStructure(spec)` call to `await composeStructure(spec)` and mark the test `async`. Add one new assertion proving the manifold path runs:

```ts
it('composes a primitive box spec into aligned grey+normal buffers', async () => {
  const res = await composeStructure({ size: 128, parts: [{ prim: 'box', at: [0,0,0], size: [1,1,1] }] });
  expect(res.size).toBe(128);
  // grey and normal share the exact same opaque mask (alignment invariant)
  let greyOpaque = 0, normalOpaque = 0, mismatch = 0;
  for (let i = 3; i < res.grey.length; i += 4) {
    const g = res.grey[i] > 0, n = res.normal[i] > 0;
    if (g) greyOpaque++; if (n) normalOpaque++; if (g !== n) mismatch++;
  }
  expect(greyOpaque).toBeGreaterThan(0);
  expect(mismatch).toBe(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-compose.test.ts`
Expected: FAIL — `composeStructure` returns a `Promise` (or the old sync signature mismatches).

- [ ] **Step 3: Rewrite compose.ts**

```ts
// src/assetgen/compose.ts
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import {
  solidBox, solidCylinder, solidCone, solidPrism, solidEllipsoid, solidArch,
  manifoldToFacets, buildingFacets,
} from '@/assetgen/geometry/solids';
import type { Wing, RoofStyle } from '@/assetgen/geometry/building';
import { projectFacets } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';
import { computeFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';

export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; material?: Mat }
  | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat; roofStyle?: RoofStyle };

export interface StructureSpec { id?: string; size?: number; parts: Part[] }
export interface StructureMeta { bbox: BBox }
export interface StructureResult { grey: Uint8ClampedArray; normal: Uint8ClampedArray; size: number; meta: StructureMeta; bbox: BBox }

/** Build one part's solid and return its facets. */
async function partFacets(p: Part): Promise<WorldFacet[]> {
  switch (p.prim) {
    case 'box':       return manifoldToFacets((await solidBox(p.at, p.size)).getMesh(), p.material ?? 'stone');
    case 'cylinder':  return manifoldToFacets((await solidCylinder(p.center, p.baseZ, p.radius, p.height)).getMesh(), p.material ?? 'stone');
    case 'cone':      return manifoldToFacets((await solidCone(p.center, p.baseZ, 0, p.radius, p.height)).getMesh(), p.material ?? 'foliage');
    case 'prism':     return manifoldToFacets((await solidPrism(p.center, p.baseZ, p.radius, p.height, p.sides)).getMesh(), p.material ?? 'stone');
    case 'ellipsoid': return manifoldToFacets((await solidEllipsoid(p.center, p.baseZ, p.radii)).getMesh(), p.material ?? 'foliage');
    case 'arch':      return manifoldToFacets((await solidArch(p.at, p.span, p.height, p.thickness)).getMesh(), p.material ?? 'stone');
    case 'building':  return buildingFacets(p.wings, p.wallMat, p.roofMat, p.roofStyle);
  }
}

/** Compose a structure spec into aligned grey + normal RGBA buffers (+ bbox/meta). Deterministic. */
export async function composeStructure(spec: StructureSpec): Promise<StructureResult> {
  const size = spec.size ?? 1024;
  const facetGroups = await Promise.all(spec.parts.map(partFacets));
  const facets = facetGroups.flat();
  const fit = computeFit(facets, size);
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);
  return { grey, normal, size, meta: { bbox }, bbox };
}
```

> Match the `cone`/`solidCone` signature you settled on in Task 3 (the `0` radiusTop arg above assumes `solidCone(center, baseZ, radiusTop, radiusBase, height)`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/assetgen-compose.test.ts`
Expected: PASS, including the alignment invariant.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/compose.ts tests/unit/assetgen-compose.test.ts
git commit -m "feat(assetgen): composeStructure async over manifold solids"
```

---

### Task 6: delete hand-rolled geometry; green the whole suite

**Files:**
- Delete: `src/assetgen/geometry/roof-unified.ts`, `src/assetgen/geometry/primitives.ts`
- Modify: `src/assetgen/geometry/building.ts` (remove `wallFacets`/`roofFacets`/`buildingFacets`/`cellRect`/`wingRect`/`cellStoreys`/`has`/`shade`/`INSET`/`PITCH`/`RoofKind` if now unused; keep `Wing`, `STOREY`, `occupancy`, `RoofStyle`)
- Modify: `scripts/assetgen-preview.ts` (await compose)
- Modify/Delete: any test importing the deleted facet fns (`tests/unit/assetgen-building*.test.ts`, `assetgen-primitives*.test.ts`, `assetgen-roof*.test.ts`)

- [ ] **Step 1: Delete the dead files and prune building.ts**

```bash
git rm src/assetgen/geometry/roof-unified.ts src/assetgen/geometry/primitives.ts
```

In `building.ts`, delete every export that the codebase no longer imports. Keep only: `Wing`, `RoofKind` (only if still referenced — otherwise delete), `STOREY`, `occupancy`, `RoofStyle`. Verify nothing else imports the removed symbols:

```bash
grep -rnE "from '@/assetgen/geometry/(primitives|roof-unified)'" src scripts tests
grep -rnE "wallFacets|roofFacets|cellRect|wingRect|cellStoreys" src scripts tests
```

- [ ] **Step 2: Update the preview script**

In `scripts/assetgen-preview.ts`, change each `const res = composeStructure(spec)` to `const res = await composeStructure(spec)` and ensure the enclosing function is `async` (wrap the sample loop in `for (const s of samples) { const res = await composeStructure(s.spec); ... }` inside an `async function main()` that is `await`ed / `.catch`ed at the bottom).

- [ ] **Step 3: Delete or rewrite orphaned tests**

Any test that imported `primitives`/`roof-unified` or building facet fns: delete the file if it only tested deleted internals, or rewrite its intent against `solids.ts`. Search:

```bash
grep -rlnE "assetgen/geometry/(primitives|roof-unified)|wallFacets|roofFacets" tests
```

- [ ] **Step 4: Full assetgen suite + tsc + the bundle guard**

Run:
```bash
npx tsc --noEmit
npx vitest run tests/unit/assetgen-*.test.ts
npx vitest run tests/unit/no-three-in-bundle.test.ts
```
Expected: tsc clean; all assetgen tests pass; no-three guard still green (manifold is not three).

- [ ] **Step 5: Commit**

```bash
git add -A src/assetgen scripts/assetgen-preview.ts tests
git commit -m "refactor(assetgen): delete hand-rolled geometry; manifold is the construction path"
```

---

### Task 7: visual confirmation — the stripe is gone

**Files:**
- Use: `scripts/assetgen-preview.ts`, `tmp/assetgen-preview/gallery.html`

- [ ] **Step 1: Regenerate previews**

Run: `npx tsx scripts/assetgen-preview.ts`
Expected: writes grey+normal PNGs for all samples (hut, trilithon, tree, boulder, cottage, tavern, longhouse, l_house, cross_chapel) to `tmp/assetgen-preview/`.

- [ ] **Step 2: Inspect the multi-wing roofs**

Open `tmp/assetgen-preview/cross_chapel-normal.png` and `l_house-normal.png` (and the gallery HTML). Confirm: the central valley of the cross/L is a **clean intersecting hip/valley with no striped triangle**, gable mode included. The roof reads as one continuous watertight surface.

- [ ] **Step 3: Report**

Summarise the before/after for the user (stripe eliminated; single watertight roof; which samples were checked). No commit needed (tmp/ is throwaway). Note any sample whose proportions need follow-up tuning (separate from the stripe fix).

---

## Self-Review notes

- **Spec coverage:** Revision 2 of the design spec (manifold construction, CPU baker kept, two-solid wall/roof split, async compose, Node-only scope) maps to Tasks 1–7.
- **Async ripple:** `composeStructure` is now async — every caller (`scripts/assetgen-preview.ts`, all compose tests) is updated in Tasks 5–6.
- **Type consistency:** `RoofStyle = 'gable' | 'hip'` lives in `building.ts` and is imported by `solids.ts` + `compose.ts`. `solidCone`'s final signature must match its `compose.ts` call site (flagged in Tasks 3 & 5).
- **Known tuning point:** the `wingGablePrism` `.rotate()` Euler angles are the only non-mechanical step — pinned by the Task 4 invariants (roof above wall top; hip → single apex). This is legitimate TDD inner-loop tuning, not a placeholder.
- **Bundle safety:** assetgen stays out of the game bundle graph (only scripts + tests import it); `no-three-in-bundle` guard re-run in Task 6. Browser/Vite wasm-URL plumbing is explicitly out of scope.
```

