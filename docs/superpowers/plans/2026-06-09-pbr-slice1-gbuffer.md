# PBR Slice 1 — G-buffer Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and cache a full co-registered PBR map set (albedo + normal + depth + AO +
roughness/metallic + emissive) for building sprites, sourced from the parametric 3D model — the
asset foundation the lit renderer (later slices) consumes.

**Architecture:** The geometry rasterizer (`src/assetgen/render/rasterize.ts`) is already a mini
G-buffer (it emits albedo/normal and keeps a per-pixel z-buffer). We thread the `Mat` enum
through facets, add rasterize modes for the missing channels, bake screen-space AO, and persist
the pack as separate co-registered RGBA blobs in the existing IndexedDB cache. Albedo stays the
only network call. Per the epic spec
([2026-06-09-pbr-sprite-stack-design.md](../specs/2026-06-09-pbr-sprite-stack-design.md)).

**Tech Stack:** TypeScript, Vitest, the existing `manifold-3d` Node-or-browser geometry path,
`composeStructure` (async), the `GeneratedBuildingArtSource` peek/warm cache.

**Map pack (separate blobs, all co-registered, same `size`):**
- `albedo` RGBA — LLM chroma-key (already produced).
- `normal` RGB — `rasterize('normal')` (already produced).
- `material` RGBA — **R=depth, G=AO, B=roughness, A=metallic** (new).
- `emissive` RGB — per-`Mat` emissive color; all-black today, window-glow added in Slice 5 (new).

**Scope note:** Emissive in this slice is the per-`Mat` table only (currently all zero — no
emissive materials yet); the window/hearth glow mask is Slice 5, where it is consumed. The pack
*shape* is final here so later slices don't reshape the cache.

---

### Task 1: Thread `Mat` through facets

**Files:**
- Modify: `src/assetgen/types.ts` (`WorldFacet`, `ScreenFacet`)
- Modify: `src/assetgen/geometry/solids.ts:28` (`manifoldToFacets`)
- Modify: `src/assetgen/render/projection.ts:38` (`projectFacets`)
- Modify: `src/assetgen/geometry/linear.ts` (`linearFacets` — set `mat` on its facets)
- Test: `tests/unit/facet-material.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/facet-material.test.ts
import { describe, it, expect } from 'vitest';
import { solidBox } from '@/assetgen/geometry/solids';
import { manifoldToFacets } from '@/assetgen/geometry/solids';

describe('facets carry their material', () => {
  it('manifoldToFacets stamps the Mat on every facet', async () => {
    const s = await solidBox([0, 0, 0], [1, 1, 1]);
    const facets = manifoldToFacets(s.getMesh(), 'thatch');
    expect(facets.length).toBeGreaterThan(0);
    expect(facets.every(f => f.mat === 'thatch')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/facet-material.test.ts`
Expected: FAIL — `f.mat` is undefined / type error.

- [ ] **Step 3: Add `mat` to the facet types**

In `src/assetgen/types.ts`, extend both interfaces (keep all existing fields):

```ts
/** A flat-shaded polygon in WORLD space (tile-local x,y; z up), pre-projection. */
export interface WorldFacet { pts: Vec3[]; normal: Vec3; albedo: RGB; mat: Mat }

/** A projected, depth-keyed polygon ready to rasterise. */
export interface ScreenFacet { pts: Pt[]; normal: Vec3; albedo: RGB; depth: number; depths?: number[]; mat: Mat }
```

- [ ] **Step 4: Stamp `mat` in `manifoldToFacets`**

In `src/assetgen/geometry/solids.ts:28`, the function already receives `material: Mat`. Add it to
every pushed facet:

```ts
out.push({ pts: [a, b, d], normal: n, albedo: shadeRGB(c, brightness(n)), mat: material });
```

(Apply to each `out.push(...)` in that function — there may be more than one triangle push.)

- [ ] **Step 5: Carry `mat` through projection**

In `src/assetgen/render/projection.ts:45`:

```ts
out.push({ pts, normal: f.normal, albedo: f.albedo, depth, depths, mat: f.mat });
```

- [ ] **Step 6: Set `mat` on linear (barrier) facets**

In `src/assetgen/geometry/linear.ts`, wherever it constructs `WorldFacet`s, add `mat`. Walls/gates
are masonry → use `'stone'` (or the run's material if one exists). Grep for `albedo:` in that file
and add `mat: 'stone'` (or the appropriate `Mat`) to each facet literal so the type checks.

- [ ] **Step 7: Run the test + tsc**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/facet-material.test.ts && npx tsc --noEmit`
Expected: PASS + clean tsc (this surfaces every facet-literal that now needs `mat`).

- [ ] **Step 8: Commit**

```bash
git add src/assetgen/types.ts src/assetgen/geometry/solids.ts src/assetgen/render/projection.ts \
        src/assetgen/geometry/linear.ts tests/unit/facet-material.test.ts
git commit -m "feat(assetgen): thread Mat through world/screen facets"
```

---

### Task 2: Per-material PBR table

**Files:**
- Create: `src/assetgen/material-pbr.ts`
- Test: `tests/unit/material-pbr.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/material-pbr.test.ts
import { describe, it, expect } from 'vitest';
import { MATERIAL_PBR, materialPbr } from '@/assetgen/material-pbr';
import { MATERIAL_RGB } from '@/assetgen/types';

describe('material PBR table', () => {
  it('covers every Mat', () => {
    for (const m of Object.keys(MATERIAL_RGB)) {
      expect(MATERIAL_PBR[m as keyof typeof MATERIAL_RGB]).toBeDefined();
    }
  });
  it('metal is metallic and smoother than thatch', () => {
    expect(materialPbr('metal').metallic).toBe(1);
    expect(materialPbr('metal').roughness).toBeLessThan(materialPbr('thatch').roughness);
  });
  it('emissive defaults to black (no emissive materials yet)', () => {
    expect(materialPbr('thatch').emissive).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (module missing).

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/material-pbr.test.ts` → FAIL.

- [ ] **Step 3: Implement the table**

```ts
// src/assetgen/material-pbr.ts
// Per-material PBR constants (metallic-roughness workflow), stylized for a medieval
// settlement. roughness/metallic in 0..1; emissive RGB 0..255 (all black for now —
// window/hearth glow is painted from anchors in a later slice, not a material property).
import type { Mat, RGB } from '@/assetgen/types';

export interface MaterialPbr { roughness: number; metallic: number; emissive: RGB }

export const MATERIAL_PBR: Record<Mat, MaterialPbr> = {
  stone:   { roughness: 0.85, metallic: 0, emissive: [0, 0, 0] },
  timber:  { roughness: 0.70, metallic: 0, emissive: [0, 0, 0] },
  plaster: { roughness: 0.90, metallic: 0, emissive: [0, 0, 0] },
  thatch:  { roughness: 0.95, metallic: 0, emissive: [0, 0, 0] },
  tile:    { roughness: 0.50, metallic: 0, emissive: [0, 0, 0] },
  foliage: { roughness: 0.85, metallic: 0, emissive: [0, 0, 0] },
  bark:    { roughness: 0.90, metallic: 0, emissive: [0, 0, 0] },
  earth:   { roughness: 1.00, metallic: 0, emissive: [0, 0, 0] },
  metal:   { roughness: 0.35, metallic: 1, emissive: [0, 0, 0] },
  door:    { roughness: 0.70, metallic: 0, emissive: [0, 0, 0] },
  brick:   { roughness: 0.85, metallic: 0, emissive: [0, 0, 0] },
};

export function materialPbr(m: Mat): MaterialPbr { return MATERIAL_PBR[m]; }
```

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/material-pbr.ts tests/unit/material-pbr.test.ts
git commit -m "feat(assetgen): per-material PBR (roughness/metallic/emissive) table"
```

---

### Task 3: Rasterize the material channels (depth + ORM + emissive)

**Files:**
- Modify: `src/assetgen/render/rasterize.ts`
- Test: `tests/unit/rasterize-pbr.test.ts`

The current `rasterize(facets, size, mode)` z-tests with a `zbuf` it discards. We add a richer
entry point that returns the **albedo, normal, material (depth+AO placeholder+rough+metal),
emissive** buffers in one pass set, reusing the same fill. Depth is normalised across the opaque
range. AO is filled by Task 5 (left at 255 = unoccluded here).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/rasterize-pbr.test.ts
import { describe, it, expect } from 'vitest';
import { rasterizeMaps } from '@/assetgen/render/rasterize';
import type { ScreenFacet } from '@/assetgen/types';

// One big front-facing quad at constant depth, material 'metal'.
function quad(): ScreenFacet {
  return {
    pts: [{ x: 1, y: 1 }, { x: 30, y: 1 }, { x: 30, y: 30 }, { x: 1, y: 30 }],
    normal: [0.5774, 0.5774, 0.5774], albedo: [140, 144, 150], depth: 1,
    depths: [1, 1, 1, 1], mat: 'metal',
  };
}

describe('rasterizeMaps', () => {
  it('emits albedo + material channels for covered pixels', () => {
    const size = 32;
    const m = rasterizeMaps([quad()], size);
    // sample a covered pixel (~ x=15,y=15)
    const i = (15 * size + 15) * 4;
    expect(m.albedo[i + 3]).toBe(255);            // opaque
    expect(m.material[i + 2]).toBeGreaterThan(0); // roughness (B) written
    expect(m.material[i + 3]).toBe(255);          // metallic (A) = metal → 255
  });

  it('leaves uncovered pixels transparent', () => {
    const m = rasterizeMaps([quad()], 32);
    expect(m.albedo[3]).toBe(0); // pixel (0,0) outside the quad
  });
});
```

- [ ] **Step 2: Run it, verify it fails** (no `rasterizeMaps`).

- [ ] **Step 3: Implement `rasterizeMaps`**

Add to `src/assetgen/render/rasterize.ts` (keep the existing `rasterize` export for callers/tests
that still use it; `rasterizeMaps` is the new multi-target path). Reuse `depthPlane`. The fill
writes all targets at the winning fragment:

```ts
import { normalRGB } from '@/assetgen/render/projection';
import { materialPbr } from '@/assetgen/material-pbr';

export interface RasterMaps {
  albedo: Uint8ClampedArray;   // RGBA
  normal: Uint8ClampedArray;   // RGB(A)
  material: Uint8ClampedArray; // R=depth(filled later-normalised), G=AO(255 here), B=roughness, A=metallic
  emissive: Uint8ClampedArray; // RGB(A)
  depthRaw: Float32Array;      // view-depth per pixel (−Inf where empty) for AO + normalisation
  size: number;
}

export function rasterizeMaps(facets: ScreenFacet[], size: number): RasterMaps {
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const material = new Uint8ClampedArray(n * 4);
  const emissive = new Uint8ClampedArray(n * 4);
  const zbuf = new Float32Array(n); zbuf.fill(-Infinity);

  for (const f of facets) {
    const nrm = normalRGB(f.normal);
    const pbr = materialPbr(f.mat);
    const plane = f.depths ? depthPlane(f.pts, f.depths) : null;
    const [A, B, C] = plane ?? [0, 0, f.depth];
    let minY = Infinity, maxY = -Infinity;
    for (const p of f.pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(size - 1, Math.floor(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0, j = f.pts.length - 1; i < f.pts.length; j = i++) {
        const a = f.pts[i], b = f.pts[j];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
      }
      xs.sort((m, q) => m - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(size - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) {
          const d = A * x + B * y + C;
          const zi = y * size + x;
          if (d < zbuf[zi]) continue;
          zbuf[zi] = d;
          const o = zi * 4;
          albedo[o] = f.albedo[0]; albedo[o + 1] = f.albedo[1]; albedo[o + 2] = f.albedo[2]; albedo[o + 3] = 255;
          normal[o] = nrm[0]; normal[o + 1] = nrm[1]; normal[o + 2] = nrm[2]; normal[o + 3] = 255;
          material[o] = 0;                               // depth: normalised in a post-pass
          material[o + 1] = 255;                         // AO: filled by Task 5
          material[o + 2] = Math.round(pbr.roughness * 255);
          material[o + 3] = Math.round(pbr.metallic * 255);
          emissive[o] = pbr.emissive[0]; emissive[o + 1] = pbr.emissive[1]; emissive[o + 2] = pbr.emissive[2]; emissive[o + 3] = 255;
        }
      }
    }
  }
  return { albedo, normal, material, emissive, depthRaw: zbuf, size };
}

/** Normalise raw view-depth into material.R (0=far, 255=near) across the opaque range. */
export function writeNormalisedDepth(maps: RasterMaps): void {
  let lo = Infinity, hi = -Infinity;
  const z = maps.depthRaw;
  for (let i = 0; i < z.length; i++) { if (z[i] === -Infinity) continue; if (z[i] < lo) lo = z[i]; if (z[i] > hi) hi = z[i]; }
  const span = (hi - lo) || 1;
  for (let i = 0; i < z.length; i++) {
    if (z[i] === -Infinity) continue;
    maps.material[i * 4] = Math.round(((z[i] - lo) / span) * 255);
  }
}
```

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/render/rasterize.ts tests/unit/rasterize-pbr.test.ts
git commit -m "feat(assetgen): rasterizeMaps — albedo/normal/material/emissive + depth"
```

---

### Task 4: Screen-space ambient occlusion

**Files:**
- Create: `src/assetgen/render/ao.ts`
- Test: `tests/unit/ao.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ao.test.ts
import { describe, it, expect } from 'vitest';
import { computeAO } from '@/assetgen/render/ao';

// A 5x5 depth field with a tall near ridge down the middle; flanks should darken.
describe('computeAO', () => {
  it('darkens pixels beside a nearer occluder, leaves flat areas open', () => {
    const size = 5;
    const depth = new Float32Array(size * size).fill(0);
    for (let y = 0; y < size; y++) depth[y * size + 2] = 5; // near ridge at column 2
    const occluded = new Float32Array(size * size); // mark which are real
    occluded.fill(1);
    const ao = computeAO(depth, occluded, size, 1, 1.5);
    const beside = ao[2 * size + 1]; // next to ridge
    const farFlat = ao[2 * size + 4]; // corner, away from ridge
    expect(beside).toBeLessThan(farFlat);
    expect(farFlat).toBeGreaterThan(200); // mostly open
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement a simple depth-difference AO**

```ts
// src/assetgen/render/ao.ts
// Cheap screen-space AO baked once at generation time. For each opaque pixel, sample a
// small neighbourhood; neighbours that are NEARER the camera (higher depth) occlude it.
// Returns an AO buffer (0=fully occluded .. 255=open). Pure + deterministic.
export function computeAO(
  depth: Float32Array, opaque: Float32Array, size: number,
  radius = 2, strength = 1.0,
): Uint8ClampedArray {
  const ao = new Uint8ClampedArray(size * size).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (!opaque[i]) continue;
    const d = depth[i];
    let occ = 0, samples = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const j = ny * size + nx;
      if (!opaque[j]) continue;
      samples++;
      if (depth[j] > d) occ += Math.min(1, (depth[j] - d)); // nearer neighbour occludes
    }
    if (samples > 0) {
      const f = Math.max(0, 1 - (occ / samples) * strength);
      ao[i] = Math.round(f * 255);
    }
  }
  return ao;
}
```

- [ ] **Step 4: Run the test** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/render/ao.ts tests/unit/ao.test.ts
git commit -m "feat(assetgen): screen-space AO bake from depth"
```

---

### Task 5: `composeStructure` returns the full map pack

**Files:**
- Modify: `src/assetgen/compose.ts`
- Test: `tests/unit/compose-pbr.test.ts` (`@vitest-environment node`)

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
// tests/unit/compose-pbr.test.ts
import { describe, it, expect } from 'vitest';
import { composeStructure } from '@/assetgen/compose';

describe('composeStructure PBR maps', () => {
  it('returns albedo + normal + material + emissive of equal length', async () => {
    const r = await composeStructure({ parts: [{ prim: 'box', at: [0, 0, 0], size: [2, 2, 2], material: 'stone' }] });
    const px = r.size * r.size * 4;
    expect(r.grey.length).toBe(px);
    expect(r.normal.length).toBe(px);
    expect(r.material.length).toBe(px);
    expect(r.emissive.length).toBe(px);
    // material.A (metallic) is 0 for stone somewhere opaque
    const opaque = [...Array(r.size * r.size).keys()].find(i => r.grey[i * 4 + 3] === 255)!;
    expect(r.material[opaque * 4 + 3]).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Wire `rasterizeMaps` + AO into compose**

In `src/assetgen/compose.ts`, replace the two `rasterize(screen, size, 'albedo'|'normal')` calls
with the multi-target path, then bake depth + AO. Extend `StructureResult` with the new buffers
(keep `grey`/`normal` names so existing callers keep working — `grey` = `maps.albedo`):

```ts
import { rasterizeMaps, writeNormalisedDepth } from '@/assetgen/render/rasterize';
import { computeAO } from '@/assetgen/render/ao';
// ...
export interface StructureResult {
  grey: Uint8ClampedArray; normal: Uint8ClampedArray;
  material: Uint8ClampedArray; emissive: Uint8ClampedArray;
  size: number; meta: StructureMeta; bbox: BBox; anchors: StructureAnchors;
}
// inside composeStructure, after `const screen = projectFacets(facets, fit);`:
  const maps = rasterizeMaps(screen, size);
  writeNormalisedDepth(maps);
  // opaque mask + AO into material.G
  const opaque = new Float32Array(size * size);
  for (let i = 0; i < opaque.length; i++) opaque[i] = maps.albedo[i * 4 + 3] === 255 ? 1 : 0;
  const ao = computeAO(maps.depthRaw, opaque, size);
  for (let i = 0; i < ao.length; i++) if (opaque[i]) maps.material[i * 4 + 1] = ao[i];
  const grey = maps.albedo;
  const normal = maps.normal;
  const bbox = opaqueBounds(grey, size);
```

Then return `{ grey, normal, material: maps.material, emissive: maps.emissive, size, meta, bbox, anchors }`.

- [ ] **Step 4: Run the test + full assetgen tests + tsc**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/compose-pbr.test.ts && npx tsc --noEmit`
Expected: PASS + clean (existing `composeStructure` callers use `grey`/`normal`/`size`, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/compose.ts tests/unit/compose-pbr.test.ts
git commit -m "feat(assetgen): composeStructure returns full PBR map pack"
```

---

### Task 6: Preview every map (visual verification)

**Files:**
- Modify: `scripts/assetgen-preview.ts`

- [ ] **Step 1: Dump all four maps per sample**

In `scripts/assetgen-preview.ts` `render()`, after `const r = await composeStructure(spec);`, also
write `material` and `emissive` PNGs alongside grey + normal:

```ts
await writeFile(join(OUT, `${name}-material.png`), toPng(r.material, r.size));
await writeFile(join(OUT, `${name}-emissive.png`), toPng(r.emissive, r.size));
```

- [ ] **Step 2: Run the preview generator for the cottage**

Run: `npx tsx scripts/assetgen-preview.ts` (or the project's documented preview command).
Expected: `cottage-grey.png`, `cottage-normal.png`, `cottage-material.png`, `cottage-emissive.png`
written.

- [ ] **Step 3: Eyeball (Read the PNGs)**

Verify: `material` R-channel shows a depth gradient (roof apex brightest/nearest), G-channel
darkens in eaves/valleys (AO), B reads as mid-grey roughness; `emissive` is black. A visual render
catches geometry bugs no assertion does.

- [ ] **Step 4: Commit**

```bash
git add scripts/assetgen-preview.ts
git commit -m "chore(assetgen): preview material + emissive maps"
```

---

### Task 7: Cache stores the full pack

**Files:**
- Modify: `src/render/generated-art-cache.ts`
- Test: `tests/unit/generated-art-cache.test.ts` (extend)

- [ ] **Step 1: Extend the round-trip test**

```ts
it('round-trips the full PBR pack', async () => {
  const mk = (b: number) => new Blob([new Uint8Array([b])], { type: 'image/png' });
  await writeGeneratedArt('k2', mk(1), {
    model: 'm', prompt: 'p', targetWidth: 256,
    normal: mk(2), material: mk(3), emissive: mk(4), anchors: '{"doors":[]}',
  });
  const got = await readGeneratedArt('k2');
  expect(await got!.material!.arrayBuffer()).toEqual(await mk(3).arrayBuffer());
  expect(got!.anchors).toBe('{"doors":[]}');
});
```

- [ ] **Step 2: Run it, verify it fails** (no `material` on the record/return).

- [ ] **Step 3: Add `material`/`emissive` to record, write meta, and read return**

In `src/render/generated-art-cache.ts`: add `material?: Blob; emissive?: Blob;` to
`GeneratedArtRecord` and `GeneratedArt`; thread them through `writeGeneratedArt`'s `meta` and the
`put({...})`, and through `readGeneratedArt`'s resolve object. (Mirror the existing `normal`
handling exactly.)

- [ ] **Step 4: Run the cache tests** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/generated-art-cache.ts tests/unit/generated-art-cache.test.ts
git commit -m "feat(render): cache the full PBR map pack (material + emissive)"
```

---

### Task 8: `GeneratedBuildingArtSource` produces + caches the pack

**Files:**
- Modify: `src/render/generated-building-art-source.ts`
- Modify: `src/render/blob-to-building-sprite.ts` (add a normal/material/emissive crop+scale helper)
- Test: `tests/unit/generated-building-art-source.test.ts` (extend; keep existing 6 green)

The source already runs `composeStructure` (via the default `initDataUri` seam) and chroma-keys the
albedo. Refactor so a single `composeStructure(toGeometry(rb))` result feeds: the grey init (LLM),
and the companion maps. Crop each companion map to the **grey `bbox`** and scale to the albedo
sprite's output dimensions so the pack is co-registered, then `cachePut` all blobs + anchors JSON.

- [ ] **Step 1: Add a map→sprite-blob helper**

In `src/render/blob-to-building-sprite.ts`, add (browser-only; returns `null` in jsdom):

```ts
/** Crop an RGBA map buffer to `bbox` and scale to (outW,outH) → PNG Blob. null in jsdom. */
export async function mapToSpriteBlob(
  buf: Uint8ClampedArray, size: number, bbox: { x: number; y: number; w: number; h: number },
  outW: number, outH: number,
): Promise<Blob | null> {
  const src = makeCanvas(size, size); const sctx = src?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!src || !sctx) return null;
  sctx.putImageData(new ImageData(buf, size, size), 0, 0);
  const out = makeCanvas(outW, outH); const octx = out?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!out || !octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(src as CanvasImageSource, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, outW, outH);
  return await canvasToBlob(out);
}
```

(Add a small `canvasToBlob` helper using `OffscreenCanvas.convertToBlob` or `<canvas>.toBlob`,
mirroring the existing canvas-backend guards. Export `makeCanvas` or move the helper into the same
module.)

- [ ] **Step 2: Write/extend the source test**

Add a test asserting that on a cache MISS the source calls `cachePut` with `material` + `emissive`
+ `anchors` populated (inject a `produce` seam returning fake buffers so no manifold/canvas is
needed in jsdom — mirror how the existing tests inject `initDataUri`/`decode`). Keep the existing 6
tests passing (update `makeSource` defaults so new default seams that would call
`composeStructure` are overridden to no-ops/fakes in tests).

- [ ] **Step 3: Run it, verify the new assertion fails.**

- [ ] **Step 4: Implement pack production in `run()`**

Refactor `GeneratedBuildingArtSource.run()` to (a) obtain the full structure once, (b) generate +
chroma-key + crop the albedo (existing), (c) build `material`/`emissive`/`normal` sprite blobs via
`mapToSpriteBlob(buf, size, greyBBox, outW, outH)`, (d) `cachePut(key, albedoBlob, { model, prompt,
targetWidth, normal, material, emissive, anchors: JSON.stringify(anchors) })`. Keep peek returning
the albedo `SpriteCanvas` for the current renderer; companion blobs are stored for later slices.
Preserve the over-budget / disabled / failure → cache-null behaviour exactly.

- [ ] **Step 5: Run the source tests + tsc**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/generated-building-art-source.test.ts && npx tsc --noEmit`
Expected: all PASS, clean tsc.

- [ ] **Step 6: Commit**

```bash
git add src/render/generated-building-art-source.ts src/render/blob-to-building-sprite.ts \
        tests/unit/generated-building-art-source.test.ts
git commit -m "feat(render): generate + cache the full PBR pack per building"
```

---

### Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `TMPDIR=$PWD/.tmp npx vitest run`
Expected: all green (no regressions; new tests included).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: tsc clean + Vite build succeeds + `manifold.wasm` emitted.

- [ ] **Step 3: In-game eyeball**

With the dev server on :3000, New World → focus a cottage; confirm the chroma-keyed albedo still
renders (no regression — lighting is a later slice) and that generation populates the cache pack
(check `small-gods-generated-art` records carry `material`/`emissive` via `__debug` or devtools).

- [ ] **Step 4: Clean up + final commit (if any verification fixes)**

```bash
rm -rf .tmp
git add -- <only files you changed>
git commit -m "test(assetgen): PBR G-buffer slice verified"
```

---

## Self-review

- **Spec coverage:** Slice 1 of the epic = "G-buffer generation" — produces + stores
  albedo/normal/depth/AO/roughness/metallic/emissive for the cottage, verified by preview PNGs.
  Emissive window-glow is explicitly deferred to Slice 5 (scope note); the pack *shape* is final.
- **Placeholders:** none — code shown for every new module; integration edits reference exact
  files/line anchors.
- **Type consistency:** `Mat` threaded through `WorldFacet`/`ScreenFacet`/`manifoldToFacets`/
  `projectFacets`/`linearFacets`; `RasterMaps`/`StructureResult`/`GeneratedArtRecord`/`GeneratedArt`
  field names are consistent across tasks; `grey`=albedo kept so existing `composeStructure`
  callers don't break.
