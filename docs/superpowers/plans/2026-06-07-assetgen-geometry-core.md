# Asset-Gen Geometry Core (Track G, Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, headless, browser-safe geometry core of the reference-geometry system — primitives → world facets → 2:1 dimetric projection → depth-sorted rasterization → aligned grey + normal RGBA buffers + bbox/meta — replacing the throwaway spike's core.

**Architecture:** A geometry pass emits flat-shaded `WorldFacet`s (world-space polygon + outward normal + material albedo). `projectFacets` maps them to screen space, back-face-culls, and keys each by view-depth. `rasterize` paints them painter's-order into an RGBA buffer twice — once with albedo (grey reference), once with the screen-space normal encoding (normal map) — guaranteeing pixel-perfect alignment. `computeFit` does a two-pass measure-then-fit so every structure fills the same frame fraction. No `three`, no `gl`, no `pngjs`, no canvas in `src/` — output is raw `Uint8ClampedArray`; a Node-only dev script encodes PNGs for visual QA.

**Tech Stack:** TypeScript (ES modules, `@/` → `src/`), Vitest, `pngjs` (dev script only). Reuses `src/core/rng.ts` later (Slice 3 scatter); none needed here.

**Scope (this slice):** primitives `box`, `extrudeNgon` (+ `cylinder`/`prism`/`cone`), `ellipsoid`, `arch`; projection; rasterizer; fit; `composeStructure` over plain primitive parts; determinism guard; a dev preview script. **Out of scope (later slices):** extrusion footprints + straight-skeleton roofs (Slice 2), macros + scatter + full anchor taxonomy (Slice 3), gen/pixelize/AssetLibrary pipeline (Slice 4), agent tools (Slice 5).

**Reference:** `docs/superpowers/specs/2026-06-07-llm-composable-reference-geometry-design.md` (§4 data model, §6 geometry core, §7 rendering, §10 testing).

---

### Task 1: Types + material palette

**Files:**
- Create: `src/assetgen/types.ts`
- Test: `tests/unit/assetgen-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-types.test.ts
import { describe, it, expect } from 'vitest';
import { MATERIAL_RGB } from '@/assetgen/types';

describe('assetgen types', () => {
  it('exposes a base RGB for every material', () => {
    for (const m of ['stone','timber','plaster','thatch','tile','foliage','bark','earth','metal'] as const) {
      const c = MATERIAL_RGB[m];
      expect(c).toHaveLength(3);
      for (const ch of c) { expect(ch).toBeGreaterThanOrEqual(0); expect(ch).toBeLessThanOrEqual(255); }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-types.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/types.ts
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type RGB = [number, number, number];
export interface Pt { x: number; y: number }

export type Mat =
  | 'stone' | 'timber' | 'plaster' | 'thatch' | 'tile'
  | 'foliage' | 'bark' | 'earth' | 'metal';

/** Base grey-reference albedo per material (the generative palette overrides later). */
export const MATERIAL_RGB: Record<Mat, RGB> = {
  stone:   [150, 150, 158],
  timber:  [120, 96, 64],
  plaster: [196, 188, 174],
  thatch:  [150, 128, 82],
  tile:    [120, 108, 96],
  foliage: [86, 124, 70],
  bark:    [92, 72, 52],
  earth:   [120, 100, 78],
  metal:   [140, 144, 150],
};

/** A flat-shaded polygon in WORLD space (tile-local x,y; z up), pre-projection. */
export interface WorldFacet { pts: Vec3[]; normal: Vec3; albedo: RGB }

/** A projected, depth-keyed polygon ready to rasterise. */
export interface ScreenFacet { pts: Pt[]; normal: Vec3; albedo: RGB; depth: number }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/types.ts tests/unit/assetgen-types.test.ts
git commit -m "feat(assetgen): structure geometry types + material palette"
```

---

### Task 2: Projection (2:1 dimetric basis, normal encoding, back-face cull)

**Files:**
- Create: `src/assetgen/render/projection.ts`
- Test: `tests/unit/assetgen-projection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-projection.test.ts
import { describe, it, expect } from 'vitest';
import { project, normalRGB, frontFacing, projectFacets, viewDepth } from '@/assetgen/render/projection';
import type { WorldFacet } from '@/assetgen/types';

describe('projection', () => {
  it('projects the origin to the screen origin', () => {
    const p = project([0,0,0], { scale: 10, ox: 100, oy: 50 });
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it('moving +x and +y in tile space separates / lowers on screen', () => {
    const s = { scale: 10, ox: 0, oy: 0 };
    expect(project([1,0,0], s).x).toBeGreaterThan(project([0,1,0], s).x); // +x is screen-right of +y
    expect(project([1,1,0], s).y).toBeGreaterThan(project([0,0,0], s).y); // depth lowers on screen
    expect(project([0,0,1], s).y).toBeLessThan(project([0,0,0], s).y);    // height raises on screen
  });

  it('encodes the up-normal with a high green (screen-up) channel', () => {
    const top = normalRGB([0,0,1]);
    expect(top[1]).toBeGreaterThan(200); // G = screen-up dominant for a roof/top face
  });

  it('culls back-facing facets and keeps front-facing ones', () => {
    expect(frontFacing([1,0,0])).toBe(true);
    expect(frontFacing([-1,0,0])).toBe(false);
    const facets: WorldFacet[] = [
      { pts: [[0,0,0],[1,0,0],[1,0,1]], normal: [0,-1,0], albedo: [1,1,1] }, // back face
      { pts: [[0,0,0],[1,0,0],[1,0,1]], normal: [0,1,0],  albedo: [1,1,1] }, // front face
    ];
    expect(projectFacets(facets, { scale: 1, ox: 0, oy: 0 })).toHaveLength(1);
  });

  it('keys depth by mean view-depth (nearer = larger)', () => {
    expect(viewDepth([1,1,1])).toBeGreaterThan(viewDepth([0,0,0]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-projection.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/render/projection`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/render/projection.ts
import type { Vec3, Pt, RGB, WorldFacet, ScreenFacet } from '@/assetgen/types';

const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]) || 1;
export const normalize = (v: Vec3): Vec3 => { const l = len(v); return [v[0]/l, v[1]/l, v[2]/l]; };
export const dot = (a: Vec3, b: Vec3): number => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];

/** 2:1 dimetric screen basis (camera at (1,1,1)): R=screen-right, DOWN=screen-y, VIEW=toward-camera. */
export const RIGHT: Vec3 = [0.7071, -0.7071, 0];
export const DOWN:  Vec3 = [0.4082, 0.4082, -0.8165];
export const VIEW:  Vec3 = [0.5774, 0.5774, 0.5774];

/** Pack a world normal into a screen-space normal-map RGB (R=right, G=up=-screen-y, B=toward-cam). */
export function normalRGB(n: Vec3): RGB {
  const u = normalize(n);
  const sx = dot(u, RIGHT), sy = dot(u, DOWN), sz = dot(u, VIEW);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round((v*0.5+0.5)*255)));
  return [c(sx), c(-sy), c(sz)];
}

/** A facet is visible iff its outward normal faces the camera. */
export const frontFacing = (n: Vec3): boolean => dot(normalize(n), VIEW) > 1e-3;

export interface ProjScale { scale: number; ox: number; oy: number }

/** World (tile x,y; z up) → screen pixel under the 2:1 dimetric view. */
export function project(p: Vec3, s: ProjScale): Pt {
  return {
    x: (p[0] - p[1]) * s.scale + s.ox,
    y: (p[0] + p[1]) * (s.scale * 0.5) - p[2] * s.scale + s.oy,
  };
}

/** Depth along the view axis; larger = nearer the camera. */
export const viewDepth = (p: Vec3): number => dot(p, VIEW);

/** Project + back-face-cull + key each facet by mean view-depth. */
export function projectFacets(facets: WorldFacet[], s: ProjScale): ScreenFacet[] {
  const out: ScreenFacet[] = [];
  for (const f of facets) {
    if (!frontFacing(f.normal)) continue;
    const pts = f.pts.map(p => project(p, s));
    const depth = f.pts.reduce((a, p) => a + viewDepth(p), 0) / f.pts.length;
    out.push({ pts, normal: f.normal, albedo: f.albedo, depth });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-projection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/render/projection.ts tests/unit/assetgen-projection.test.ts
git commit -m "feat(assetgen): 2:1 dimetric projection, normal encoding, back-face cull"
```

---

### Task 3: Box primitive

**Files:**
- Create: `src/assetgen/geometry/primitives.ts`
- Test: `tests/unit/assetgen-primitives.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-primitives.test.ts
import { describe, it, expect } from 'vitest';
import { box } from '@/assetgen/geometry/primitives';

describe('box primitive', () => {
  it('emits exactly the 3 camera-facing faces (top, +x, +y)', () => {
    const f = box([0,0,0], [1,1,1], 'stone');
    expect(f).toHaveLength(3);
    const normals = f.map(x => x.normal);
    expect(normals).toContainEqual([0,0,1]);
    expect(normals).toContainEqual([1,0,0]);
    expect(normals).toContainEqual([0,1,0]);
  });

  it('shades the top brightest and the +y wall darkest', () => {
    const f = box([0,0,0], [2,2,3], 'stone');
    const top = f.find(x => x.normal[2] === 1)!.albedo[0];
    const fx  = f.find(x => x.normal[0] === 1)!.albedo[0];
    const fy  = f.find(x => x.normal[1] === 1)!.albedo[0];
    expect(top).toBeGreaterThan(fx);
    expect(fx).toBeGreaterThan(fy);
  });

  it('places faces at the given min-corner and size', () => {
    const f = box([2,3,0], [1,1,4], 'stone');
    const top = f.find(x => x.normal[2] === 1)!;
    for (const p of top.pts) expect(p[2]).toBe(4); // top at base+height
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-primitives.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/geometry/primitives`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/geometry/primitives.ts
import type { Vec2, Vec3, RGB, Mat, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';

const shade = (c: RGB, f: number): RGB => [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];
// Per-face shading so the grey reference reads as 3-D form (carried from the spike).
const TOP = 1.0, FACE_X = 0.82, FACE_Y = 0.62;

/** Axis-aligned box. `at` = min (x,y) corner at base; z = base height; `size` = [sx,sy,sz]. */
export function box(at: Vec3, size: Vec3, material: Mat = 'stone'): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const [x0, y0, z0] = at, x1 = x0+size[0], y1 = y0+size[1], z1 = z0+size[2];
  return [
    { pts: [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]], normal: [0,0,1], albedo: shade(c, TOP) },    // top +z
    { pts: [[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]], normal: [1,0,0], albedo: shade(c, FACE_X) },  // +x wall
    { pts: [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], normal: [0,1,0], albedo: shade(c, FACE_Y) },  // +y wall
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-primitives.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/primitives.ts tests/unit/assetgen-primitives.test.ts
git commit -m "feat(assetgen): box primitive (3 camera-facing faces, shaded)"
```

---

### Task 4: Extruded n-gon + cylinder / prism / cone

**Files:**
- Modify: `src/assetgen/geometry/primitives.ts`
- Test: `tests/unit/assetgen-primitives.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-primitives.test.ts
import { extrudeNgon, cylinder, prism, cone } from '@/assetgen/geometry/primitives';
import { frontFacing } from '@/assetgen/render/projection';

describe('extruded solids', () => {
  it('cylinder emits one quad per side plus a top cap', () => {
    const f = cylinder([0,0], 0, 1, 2, 'stone', 12);
    expect(f).toHaveLength(12 + 1);
    expect(f.some(x => x.normal[0] === 0 && x.normal[1] === 0 && x.normal[2] === 1)).toBe(true); // top cap
  });

  it('cone tapers to an apex (triangles, no top cap)', () => {
    const f = cone([0,0], 0, 1, 2, 'foliage', 8);
    expect(f).toHaveLength(8);                          // 8 triangular faces, no cap
    for (const face of f) expect(face.pts).toHaveLength(3);
  });

  it('prism honours its side count', () => {
    expect(prism([0,0], 0, 1, 1, 6, 'stone')).toHaveLength(6 + 1);
  });

  it('every side has at least one camera-facing facet (front + back split)', () => {
    const f = extrudeNgon([0,0], 0, 1, 1, 2, 16, 'stone');
    expect(f.some(x => frontFacing(x.normal))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-primitives.test.ts`
Expected: FAIL — `extrudeNgon`/`cylinder`/`prism`/`cone` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/assetgen/geometry/primitives.ts

/** Regular n-gon extruded from base radius r0 to top radius r1 (cone if r1=0), centred at (cx,cy). */
export function extrudeNgon(
  center: Vec2, baseZ: number, r0: number, r1: number, height: number, sides: number,
  material: Mat = 'stone', rot = 0,
): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const [cx, cy] = center, zt = baseZ + height;
  const ring = (r: number, z: number): Vec3[] => Array.from({ length: sides }, (_, k) => {
    const a = rot + (k / sides) * Math.PI * 2;
    return [cx + Math.cos(a)*r, cy + Math.sin(a)*r, z] as Vec3;
  });
  const lo = ring(r0, baseZ), hi = ring(r1, zt);
  const tilt = (r0 - r1) / (height || 1);
  const out: WorldFacet[] = [];
  for (let k = 0; k < sides; k++) {
    const n = (k + 1) % sides;
    const mid = rot + ((k + 0.5) / sides) * Math.PI * 2;
    const nrm: Vec3 = [Math.cos(mid), Math.sin(mid), tilt];
    const f = 0.6 + 0.22 * ((Math.cos(mid)*0.7071 + Math.sin(mid)*0.7071) + 1) / 2;
    if (r1 === 0) out.push({ pts: [lo[k], lo[n], hi[k]], normal: nrm, albedo: shade(c, f) }); // cone tri (hi[k]=apex)
    else out.push({ pts: [lo[k], lo[n], hi[n], hi[k]], normal: nrm, albedo: shade(c, f) });   // side quad
  }
  if (r1 > 0) out.push({ pts: hi, normal: [0,0,1], albedo: shade(c, TOP) }); // top cap
  return out;
}

export const cylinder = (center: Vec2, baseZ: number, radius: number, height: number, material: Mat = 'stone', sides = 18): WorldFacet[] =>
  extrudeNgon(center, baseZ, radius, radius, height, sides, material);
export const prism = (center: Vec2, baseZ: number, radius: number, height: number, sides: number, material: Mat = 'stone', rot = 0): WorldFacet[] =>
  extrudeNgon(center, baseZ, radius, radius, height, sides, material, rot);
export const cone = (center: Vec2, baseZ: number, radius: number, height: number, material: Mat = 'foliage', sides = 18): WorldFacet[] =>
  extrudeNgon(center, baseZ, radius, 0, height, sides, material);
```

> Note: when `r1 === 0` all `hi[k]` collapse to the apex `(cx,cy,zt)`, so `hi[k]` is the apex vertex of each triangle.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-primitives.test.ts`
Expected: PASS (box + extruded solids blocks).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/primitives.ts tests/unit/assetgen-primitives.test.ts
git commit -m "feat(assetgen): extrudeNgon + cylinder/prism/cone"
```

---

### Task 5: Ellipsoid + arch

**Files:**
- Modify: `src/assetgen/geometry/primitives.ts`
- Test: `tests/unit/assetgen-primitives.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/assetgen-primitives.test.ts
import { ellipsoid, arch } from '@/assetgen/geometry/primitives';
import { normalize } from '@/assetgen/render/projection';

describe('ellipsoid + arch', () => {
  it('ellipsoid tessellates into segU*segV quads with finite normals', () => {
    const f = ellipsoid([0,0], 0, [1,1,1], 'foliage', 12, 8);
    expect(f).toHaveLength(12 * 8);
    for (const face of f) {
      const n = normalize(face.normal);
      expect(Number.isFinite(n[0] + n[1] + n[2])).toBe(true);
    }
  });

  it('arch is two uprights + a lintel (3 boxes => 9 facets)', () => {
    const f = arch([0,0,0], 3, 4, 0.5, 'stone');
    expect(f).toHaveLength(9); // each box = 3 visible facets
    const maxZ = Math.max(...f.flatMap(x => x.pts.map(p => p[2])));
    expect(maxZ).toBeCloseTo(4 + 0.5); // lintel sits atop the posts
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-primitives.test.ts`
Expected: FAIL — `ellipsoid`/`arch` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/assetgen/geometry/primitives.ts
import { box as _box } from '@/assetgen/geometry/primitives'; // (already in-file; no self-import needed)

/** Ellipsoid centred at (cx, cy, baseZ+rz), radii [rx,ry,rz]; lat/long tessellation. */
export function ellipsoid(center: Vec2, baseZ: number, radii: Vec3, material: Mat = 'foliage', segU = 12, segV = 8): WorldFacet[] {
  const c = MATERIAL_RGB[material];
  const [cx, cy] = center, [rx, ry, rz] = radii, cz = baseZ + rz;
  const P = (u: number, v: number): Vec3 => {
    const th = u * Math.PI * 2, ph = v * Math.PI - Math.PI / 2;
    return [cx + Math.cos(ph)*Math.cos(th)*rx, cy + Math.cos(ph)*Math.sin(th)*ry, cz + Math.sin(ph)*rz];
  };
  const norm = (p: Vec3): Vec3 => [(p[0]-cx)/(rx*rx), (p[1]-cy)/(ry*ry), (p[2]-cz)/(rz*rz)];
  const out: WorldFacet[] = [];
  for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
    const a = P(i/segU, j/segV), b = P((i+1)/segU, j/segV), e = P((i+1)/segU, (j+1)/segV), d = P(i/segU, (j+1)/segV);
    const nrm = norm([(a[0]+e[0])/2, (a[1]+e[1])/2, (a[2]+e[2])/2]);
    const up = (normalize(nrm)[2] + 1) / 2;
    out.push({ pts: [a, b, e, d], normal: nrm, albedo: shade(c, 0.7 + 0.3*up) });
  }
  return out;
}

/** Post-and-lintel arch (gate / trilithon): two uprights + a top beam spanning +x. */
export function arch(at: Vec3, span: number, height: number, thickness: number, material: Mat = 'stone'): WorldFacet[] {
  const [x, y, z] = at, t = thickness;
  return [
    ...box([x, y, z], [t, t, height], material),               // left post
    ...box([x + span - t, y, z], [t, t, height], material),    // right post
    ...box([x, y, z + height], [span, t, t], material),        // lintel
  ];
}
```

> Remove the stray `import { box as _box }` line above — `box`, `shade`, `MATERIAL_RGB`, `normalize` are needed: `box`/`shade`/`MATERIAL_RGB` are already in this file; add `import { normalize } from '@/assetgen/render/projection';` to the file's import header instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-primitives.test.ts`
Expected: PASS (all primitive blocks).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/geometry/primitives.ts tests/unit/assetgen-primitives.test.ts
git commit -m "feat(assetgen): ellipsoid + arch (trilithon) primitives"
```

---

### Task 6: Rasterizer (depth-sorted scanline fill, albedo + normal modes)

**Files:**
- Create: `src/assetgen/render/rasterize.ts`
- Test: `tests/unit/assetgen-rasterize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-rasterize.test.ts
import { describe, it, expect } from 'vitest';
import { rasterize } from '@/assetgen/render/rasterize';
import { normalRGB } from '@/assetgen/render/projection';
import type { ScreenFacet } from '@/assetgen/types';

const quad = (x0:number,y0:number,x1:number,y1:number): { x:number;y:number }[] =>
  [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];

describe('rasterize', () => {
  it('fills a facet opaque and leaves the rest transparent', () => {
    const f: ScreenFacet[] = [{ pts: quad(2,2,6,6), normal: [0,0,1], albedo: [10,20,30], depth: 0 }];
    const d = rasterize(f, 8, 'albedo');
    expect(d[(3*8+3)*4+3]).toBe(255);           // inside → opaque
    expect([d[(3*8+3)*4], d[(3*8+3)*4+1], d[(3*8+3)*4+2]]).toEqual([10,20,30]);
    expect(d[(0*8+0)*4+3]).toBe(0);             // corner → transparent
  });

  it('normal mode writes the encoded normal, not the albedo', () => {
    const f: ScreenFacet[] = [{ pts: quad(0,0,8,8), normal: [0,0,1], albedo: [10,20,30], depth: 0 }];
    const d = rasterize(f, 8, 'normal');
    const want = normalRGB([0,0,1]);
    expect([d[(4*8+4)*4], d[(4*8+4)*4+1], d[(4*8+4)*4+2]]).toEqual(want);
  });

  it('draws nearer facets over farther ones (painter order by depth)', () => {
    const f: ScreenFacet[] = [
      { pts: quad(0,0,8,8), normal: [0,0,1], albedo: [1,1,1], depth: -1 }, // far
      { pts: quad(0,0,8,8), normal: [0,0,1], albedo: [9,9,9], depth:  1 }, // near
    ];
    const d = rasterize(f, 8, 'albedo');
    expect(d[(4*8+4)*4]).toBe(9); // near wins
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-rasterize.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/render/rasterize`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/render/rasterize.ts
import type { ScreenFacet, RGB, Pt } from '@/assetgen/types';
import { normalRGB } from '@/assetgen/render/projection';

/** Scanline-fill a convex polygon (RGBA, opaque) into `data`. */
function fillPoly(data: Uint8ClampedArray, W: number, H: number, pts: Pt[], rgb: RGB): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(H - 1, Math.floor(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) { const o = (y*W + x)*4; data[o]=rgb[0]; data[o+1]=rgb[1]; data[o+2]=rgb[2]; data[o+3]=255; }
    }
  }
}

/** Painter's-order rasterise (far→near) into an RGBA buffer. */
export function rasterize(facets: ScreenFacet[], size: number, mode: 'albedo' | 'normal'): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const sorted = [...facets].sort((a, b) => a.depth - b.depth);
  for (const f of sorted) fillPoly(data, size, size, f.pts, mode === 'albedo' ? f.albedo : normalRGB(f.normal));
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-rasterize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/render/rasterize.ts tests/unit/assetgen-rasterize.test.ts
git commit -m "feat(assetgen): depth-sorted scanline rasterizer (albedo + normal)"
```

---

### Task 7: Fit (opaque bounds + two-pass fit-and-centre)

**Files:**
- Create: `src/assetgen/render/fit.ts`
- Test: `tests/unit/assetgen-fit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-fit.test.ts
import { describe, it, expect } from 'vitest';
import { opaqueBounds, computeFit } from '@/assetgen/render/fit';
import { box } from '@/assetgen/geometry/primitives';
import { projectFacets } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';

describe('fit', () => {
  it('opaqueBounds returns the alpha>0 box', () => {
    const d = new Uint8ClampedArray(8*8*4);
    const set = (x:number,y:number) => { d[(y*8+x)*4+3] = 255; };
    set(2,3); set(5,6);
    expect(opaqueBounds(d, 8)).toEqual({ x:2, y:3, w:4, h:4 });
  });

  it('fits a box to ~fillFrac of the frame, centred', () => {
    const SIZE = 256, FILL = 0.88;
    const facets = box([0,0,0], [2,2,3], 'stone');
    const fit = computeFit(facets, SIZE, FILL);
    const grey = rasterize(projectFacets(facets, fit), SIZE, 'albedo');
    const b = opaqueBounds(grey, SIZE);
    const maxDim = Math.max(b.w, b.h);
    expect(maxDim).toBeGreaterThan(FILL * SIZE * 0.9);   // fills most of the frame
    expect(maxDim).toBeLessThanOrEqual(SIZE);
    expect(b.x + b.w/2).toBeGreaterThan(SIZE*0.35);       // roughly centred
    expect(b.x + b.w/2).toBeLessThan(SIZE*0.65);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-fit.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/render/fit`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/render/fit.ts
import type { WorldFacet } from '@/assetgen/types';
import { project, type ProjScale } from '@/assetgen/render/projection';

export interface BBox { x: number; y: number; w: number; h: number }

/** Opaque (alpha>0) bounding box of an RGBA buffer. */
export function opaqueBounds(data: Uint8ClampedArray, size: number): BBox {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (data[(y*size + x)*4 + 3] > 0) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
  }
  return maxX < 0 ? { x:0, y:0, w:0, h:0 } : { x:minX, y:minY, w:maxX-minX+1, h:maxY-minY+1 };
}

/** Two-pass: measure the projected extent at unit scale, then scale to fill `fillFrac` and centre. */
export function computeFit(facets: WorldFacet[], size: number, fillFrac = 0.88): ProjScale {
  const unit: ProjScale = { scale: 1, ox: 0, oy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of facets) for (const p of f.pts) {
    const s = project(p, unit);
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
  }
  const w = (maxX - minX) || 1, h = (maxY - minY) || 1;
  const scale = (fillFrac * size) / Math.max(w, h);
  const ox = size/2 - ((minX + maxX) / 2) * scale;
  const oy = size/2 - ((minY + maxY) / 2) * scale;
  return { scale, ox, oy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-fit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/render/fit.ts tests/unit/assetgen-fit.test.ts
git commit -m "feat(assetgen): opaque bounds + two-pass fit-and-centre"
```

---

### Task 8: composeStructure (primitive parts → aligned grey + normal + meta)

**Files:**
- Create: `src/assetgen/compose.ts`
- Test: `tests/unit/assetgen-compose.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-compose.test.ts
import { describe, it, expect } from 'vitest';
import { composeStructure, type StructureSpec } from '@/assetgen/compose';

describe('composeStructure', () => {
  const spec: StructureSpec = {
    size: 256,
    parts: [
      { prim: 'box', at: [0,0,0], size: [2,2,2], material: 'stone' },
      { prim: 'cone', center: [1,1], baseZ: 2, radius: 1.2, height: 2, material: 'thatch', sides: 12 },
    ],
  };

  it('returns grey + normal buffers of the requested size', () => {
    const r = composeStructure(spec);
    expect(r.size).toBe(256);
    expect(r.grey).toHaveLength(256*256*4);
    expect(r.normal).toHaveLength(256*256*4);
  });

  it('grey and normal share the exact same opaque mask (pixel-aligned)', () => {
    const r = composeStructure(spec);
    let mismatches = 0;
    for (let i = 3; i < r.grey.length; i += 4) {
      if ((r.grey[i] > 0) !== (r.normal[i] > 0)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('reports a non-empty bbox inside the frame', () => {
    const r = composeStructure(spec);
    expect(r.bbox.w).toBeGreaterThan(0);
    expect(r.bbox.h).toBeGreaterThan(0);
    expect(r.bbox.x + r.bbox.w).toBeLessThanOrEqual(256);
    expect(r.bbox.y + r.bbox.h).toBeLessThanOrEqual(256);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assetgen-compose.test.ts`
Expected: FAIL — cannot resolve `@/assetgen/compose`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/assetgen/compose.ts
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import { box, cylinder, prism, cone, ellipsoid, arch } from '@/assetgen/geometry/primitives';
import { projectFacets } from '@/assetgen/render/projection';
import { rasterize } from '@/assetgen/render/rasterize';
import { computeFit, opaqueBounds, type BBox } from '@/assetgen/render/fit';

/** v1 primitive parts only — extrusion+roof, macros and scatter arrive in later slices. */
export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; sides?: number }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; sides?: number }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat; rot?: number }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; material?: Mat };

export interface StructureSpec { id?: string; size?: number; parts: Part[] }
export interface StructureMeta { bbox: BBox }
export interface StructureResult { grey: Uint8ClampedArray; normal: Uint8ClampedArray; size: number; meta: StructureMeta; bbox: BBox }

function partFacets(p: Part): WorldFacet[] {
  switch (p.prim) {
    case 'box':       return box(p.at, p.size, p.material);
    case 'cylinder':  return cylinder(p.center, p.baseZ, p.radius, p.height, p.material, p.sides);
    case 'cone':      return cone(p.center, p.baseZ, p.radius, p.height, p.material, p.sides);
    case 'prism':     return prism(p.center, p.baseZ, p.radius, p.height, p.sides, p.material, p.rot);
    case 'ellipsoid': return ellipsoid(p.center, p.baseZ, p.radii, p.material);
    case 'arch':      return arch(p.at, p.span, p.height, p.thickness, p.material);
  }
}

/** Compose a structure spec into aligned grey + normal RGBA buffers (+ bbox/meta). Pure & deterministic. */
export function composeStructure(spec: StructureSpec): StructureResult {
  const size = spec.size ?? 1024;
  const facets = spec.parts.flatMap(partFacets);
  const fit = computeFit(facets, size);
  const screen = projectFacets(facets, fit);
  const grey = rasterize(screen, size, 'albedo');
  const normal = rasterize(screen, size, 'normal');
  const bbox = opaqueBounds(grey, size);
  return { grey, normal, size, meta: { bbox }, bbox };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-compose.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/compose.ts tests/unit/assetgen-compose.test.ts
git commit -m "feat(assetgen): composeStructure — primitive parts to aligned grey+normal"
```

---

### Task 9: Determinism guard (no Math.random in src/assetgen)

**Files:**
- Test: `tests/unit/assetgen-no-random.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/assetgen-no-random.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function listTs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) listTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('assetgen determinism guard', () => {
  it('no Math.random() in src/assetgen — seed all jitter via createRng', () => {
    const offenders = listTs('src/assetgen').filter(f => /Math\.random\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/unit/assetgen-no-random.test.ts`
Expected: PASS immediately (no `Math.random` written yet). This guard locks the invariant for Slice 3's scatter. If it fails, the listed file must switch to `createRng` from `@/core/rng`.

- [ ] **Step 3: (no code change needed)** — the guard is the deliverable.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/assetgen-no-random.test.ts
git commit -m "test(assetgen): guard against Math.random in src/assetgen"
```

---

### Task 10: Node-only dev preview script (visual QA — not in the bundle)

**Files:**
- Create: `scripts/assetgen-preview.ts`

- [ ] **Step 1: Write the script** (no unit test — it is a dev tool; `pngjs` is a devDependency and must never be imported from `src/`)

```ts
// scripts/assetgen-preview.ts
// Render a sample structure to grey + normal PNGs for eyeballing.
// Run: npx tsx scripts/assetgen-preview.ts
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureSpec } from '../src/assetgen/compose';

const OUT = 'tmp/assetgen-preview';
mkdirSync(OUT, { recursive: true });

const SAMPLES: Record<string, StructureSpec> = {
  hut: { size: 512, parts: [
    { prim: 'box', at: [0,0,0], size: [2.4,2.4,2.2], material: 'plaster' },
    { prim: 'cone', center: [1.2,1.2], baseZ: 2.2, radius: 1.7, height: 1.8, material: 'thatch', sides: 16 },
  ]},
  trilithon: { size: 512, parts: [
    { prim: 'arch', at: [0,0,0], span: 2.4, height: 3.0, thickness: 0.55, material: 'stone' },
  ]},
  tree: { size: 512, parts: [
    { prim: 'cylinder', center: [1,1], baseZ: 0, radius: 0.22, height: 1.4, material: 'bark', sides: 8 },
    { prim: 'ellipsoid', center: [1,1], baseZ: 1.2, radii: [1.1,1.1,1.3], material: 'foliage' },
  ]},
  boulder: { size: 512, parts: [
    { prim: 'ellipsoid', center: [1,1], baseZ: 0, radii: [1.2,0.9,0.8], material: 'stone' },
  ]},
};

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

for (const [name, spec] of Object.entries(SAMPLES)) {
  const r = composeStructure(spec);
  await writeFile(join(OUT, `${name}-grey.png`), toPng(r.grey, r.size));
  await writeFile(join(OUT, `${name}-normal.png`), toPng(r.normal, r.size));
  console.log(`${name}: bbox ${JSON.stringify(r.bbox)}`);
}
console.log(`Wrote grey+normal PNGs for ${Object.keys(SAMPLES).length} samples to ${OUT}/`);
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/assetgen-preview.ts`
Expected: prints a bbox line per sample and writes `tmp/assetgen-preview/{hut,trilithon,tree,boulder}-{grey,normal}.png`. Open them to confirm the hut reads as a walled box under a conical roof, the trilithon as two posts + a lintel, the tree as a trunk + canopy, the boulder as a rounded mass — each with a clean per-face normal map.

- [ ] **Step 3: Run the full assetgen suite + typecheck**

Run: `npx vitest run tests/unit/assetgen-*.test.ts && npx tsc --noEmit`
Expected: all assetgen tests PASS; no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/assetgen-preview.ts
git commit -m "chore(assetgen): node-only dev preview script (grey+normal PNG QA)"
```

---

## Self-Review

**Spec coverage (Slice 1 scope):**
- §4 data model (primitive `Part`s, `StructureSpec/Result`) → Tasks 1, 8. ✓ (extrusion/macro/scatter parts intentionally deferred to Slices 2–3.)
- §6 geometry core — primitives basis (box/prism/cylinder/ellipsoid/cone/arch) → Tasks 3–5. ✓ Straight-skeleton roofs deferred to Slice 2 (stated). ✓
- §7 projection + dual-rasterize + two-pass fit → Tasks 2, 6, 7. ✓
- §10 determinism guard + alignment test + bbox → Tasks 9, 8. ✓ (Macro golden tests + skeleton-roof tests belong to Slices 2–3.)
- Browser-safety (no three/gl/pngjs in `src/`) → enforced: `src/assetgen` returns raw RGBA; `pngjs` only in `scripts/assetgen-preview.ts`. ✓

**Placeholder scan:** No TBD/TODO. One inline correction is called out explicitly in Task 5 Step 3 (drop the stray `import { box as _box }`, add `import { normalize } ...` to the file header) — the engineer has the exact fix. ✓

**Type consistency:** `WorldFacet`/`ScreenFacet`/`Mat`/`RGB`/`Vec3`/`Pt` defined in Task 1 and used verbatim throughout. `ProjScale` defined in Task 2, consumed by Tasks 6–8. `Part`/`StructureSpec`/`StructureResult` defined in Task 8 match the spec §4 shapes. `box(at,size,material)`, `cylinder(center,baseZ,radius,height,material,sides)`, `cone(...)`, `prism(...,sides,material,rot)`, `ellipsoid(center,baseZ,radii,material)`, `arch(at,span,height,thickness,material)` signatures are consistent between Tasks 3–5 and their call sites in Task 8's `partFacets`. ✓

**Note for the implementer:** `src/assetgen/geometry/primitives.ts` imports `normalize` from `@/assetgen/render/projection` (used by `ellipsoid`), so projection (Task 2) must land before Task 5 — it does. The cone branch of `extrudeNgon` relies on `hi[k]` collapsing to the apex when `r1 === 0`; that is by construction (ring radius 0).
