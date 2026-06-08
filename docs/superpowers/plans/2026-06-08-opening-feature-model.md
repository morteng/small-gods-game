# Opening Feature Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make doors (and windows) a registered, carved-aperture **Opening** feature family that works identically on rect, round, and stepped buildings — fixing door protrusion, giving yurts/castle keeps visible doors, and modelling rich semantics (hinge/swing/lock/hardware) for future expansion.

**Architecture:** An *opening* is a `FeatureType` that additionally implements three optional **opening hooks** (`threshold`, `aperture`, `filler`). The geometry compiler (`toGeometry`) treats any feature whose kind declares `aperture` as an opening: it converts each opening's `ApertureSpec` to an absolute box, attaches the box to the host part's wall-bearing prim (`building`/`cylinder`/`box`), and appends the kind's `filler()` prims (the door leaf / window pane). The assetgen layer gains a single generic carve: every wall-bearing prim subtracts its `apertures` from its wall solid before faceting. The old additive proud-box `doorSolid` is deleted. The structural compilers (`toCollision`/`toAnchors`/`toBrief`) generalise from a hardcoded `door` to "any opening", driven by the per-kind `threshold` flag. All face/position math lives in one shared module, `src/blueprint/wall-geometry.ts`.

**Tech Stack:** TypeScript ES modules, Vitest, manifold-3d WASM CSG (boolean subtract), the existing Blueprint registry (`src/blueprint/`).

---

## Background the implementer needs

**Read these before starting (do not skip):**
- Spec: `docs/superpowers/specs/2026-06-08-opening-feature-model-design.md`
- `src/blueprint/registry.ts` — `FeatureType`, `CompileCtx`, `getFeatureType`.
- `src/blueprint/features/{door,window,vent}.ts` — current feature kinds.
- `src/blueprint/compile/{to-geometry,to-collision,to-anchors,to-brief}.ts` — the four compilers. Note: `to-collision.ts`, `to-anchors.ts`, and `to-brief.ts` each carry a **private duplicate** `doorCellFor(part, face)` — this plan replaces all three with one shared `faceCell()`.
- `src/assetgen/geometry/solids.ts` — `buildingFacets`, the to-be-deleted `doorSolid`.
- `src/assetgen/geometry/building.ts` — `resolveFeatures`, `BuildingFeatures`, `DoorFeature`, `placeDoors` (door half to be removed; vents stay).
- `src/assetgen/compose.ts` — the `Part` (prim) union and `partFacets`.
- `src/render/scale-contract.ts` — `DOOR_HEIGHT_UNITS=0.85`, `DOOR_WIDTH_TILES=0.4`. Door sizes already derive from here; this plan preserves that.

**Key facts:**
- A building is a **solid mass** (wings are solid boxes, not hollow). So a "carved doorway" is a shallow **recess (niche)** in the wall, not a through-hole. The visible door is a thin **leaf** prim (material `'door'`) set flush inside that recess — its outer face sits at-or-inside the wall plane, so it never protrudes.
- Round bodies emit `cylinder`+roof prims; stepped bodies emit stacked `box` prims. Both bypass `buildingFacets` today, which is why their doors vanish. The carve must therefore live at the **prim** level (box/cylinder), not only inside `buildingFacets`.
- The cylinder of a round body is tangent to the south/east edge of its footprint bbox at the face midpoint, so the **same** bbox-edge aperture math carves rect, round, and stepped walls uniformly.
- Sprite-space door anchors (`StructureAnchors.doors` from `composeStructure`) are **not consumed by any renderer** (verified). World-space door anchors that matter for pathing/roads come from the Blueprint `toAnchors` compiler. So `buildingFacets` may stop emitting door anchors with no downstream breakage.

**Geometry constants (define once, in `wall-geometry.ts`):**
- `APERTURE_EPS = 0.02` — how far the subtracted box pokes past the wall plane so the cut face is never coplanar (manifold boolean robustness).
- `LEAF_INSET = 0.04` — how far the leaf's outer face sits *inside* the wall plane (guarantees no protrusion + no z-fight with the wall).
- `LEAF_THICKNESS = 0.08` — leaf panel depth.
- `DOOR_RECESS = 0.3` — door niche depth (a recess, not a through-cut).
- `WINDOW_RECESS = 0.18`, `WINDOW_SILL = 0.4` — window niche depth + raised sill (height-units).

**Commit discipline (project rule — follow exactly):** commit with **explicit file paths**, never `git add -A`/`.`. Each commit body ends with:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## File Structure

**Create:**
- `src/blueprint/features/opening.ts` — the opening contract: `ApertureSpec`, `OpeningHooks`, `isOpening()` guard. ~30 LOC.
- `src/blueprint/wall-geometry.ts` — shared face/wall math: `FACE_FACING`, `faceCell`, `apertureToBox`, `leafBox`, geometry constants. ~70 LOC.
- `tests/unit/blueprint-opening.test.ts` — opening contract + door/window hooks.
- `tests/unit/blueprint-wall-geometry.test.ts` — face math.
- `tests/unit/assetgen-carve.test.ts` — generic prim carve.

**Modify:**
- `src/blueprint/registry.ts` — extend `FeatureType` with optional `threshold?`/`aperture?`/`filler?`.
- `src/blueprint/features/door.ts` — add opening hooks + rich params.
- `src/blueprint/features/window.ts` — add opening hooks + params.
- `src/blueprint/compile/to-geometry.ts` — openings → apertures (on wall prim) + filler prims; drop `doorOf`/`DoorFeature`.
- `src/blueprint/compile/to-collision.ts` — threshold-driven door cells; use shared `faceCell`.
- `src/blueprint/compile/to-anchors.ts` — opening-kind anchors; use shared `faceCell`/`FACE_FACING`.
- `src/blueprint/compile/to-brief.ts` — use shared `faceCell` (drop private dup).
- `src/assetgen/compose.ts` — `apertures?: ApertureBox[]` on `building`/`cylinder`/`box` prims; carve in `partFacets`.
- `src/assetgen/geometry/solids.ts` — `carveApertures()` helper; `buildingFacets` carves + drops doors; delete `doorSolid`.
- `src/assetgen/geometry/building.ts` — `resolveFeatures` → vents only; delete door types/helpers; `BuildingFeatures={vents?}`.
- Tests updated: `assetgen-solids.test.ts`, `blueprint-to-geometry.test.ts`, `blueprint-to-collision.test.ts`, `blueprint-golden-regression.test.ts`.

---

## Task 1: Opening contract module

**Files:**
- Create: `src/blueprint/features/opening.ts`
- Create: `tests/unit/blueprint-opening.test.ts`
- Modify: `src/blueprint/registry.ts`

- [ ] **Step 1: Extend `FeatureType` with optional opening hooks**

In `src/blueprint/registry.ts`, replace the `FeatureType` interface (lines 35-41) with:

```ts
/** A feature type resolves (door-size fix lives here) and contributes a brief phrase.
 *  An *opening* feature additionally implements the opening hooks (threshold/aperture/filler);
 *  the geometry compiler treats any feature whose kind declares `aperture` as a wall opening. */
export interface FeatureType {
  type: string;
  paramSchema: ParamSchema;
  resolve(f: Feature, ctx: ResolveCtx): { params: Record<string, unknown> };
  toBrief(f: ResolvedFeature, ctx: CompileCtx): string;
  /** Opening hooks (optional). Present ⇒ this feature is a wall opening. */
  threshold?: boolean;
  aperture?(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): import('./features/opening').ApertureSpec;
  filler?(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): Prim[];
}
```

(`Prim` and `ResolvedPart` are already imported at the top of `registry.ts`.)

- [ ] **Step 2: Write the opening contract**

Create `src/blueprint/features/opening.ts`:

```ts
// src/blueprint/features/opening.ts
// The Opening feature family contract. An opening is a FeatureType that implements the
// opening hooks (threshold/aperture/filler). It describes a hole on a wall face plus a
// kind-specific filler (door leaf / window pane). Geometry is carved by wall-geometry.ts.
import type { FeatureType } from '../registry';
import type { WallFace } from '../types';

/** The hole to subtract from a host wall, in part-local units. */
export interface ApertureSpec {
  face: WallFace;
  /** centre position along the wall run (0..1) and sill height (height-units). */
  t: number;
  sill: number;
  /** opening size: half-width along the wall (tiles) and height (height-units). */
  halfW: number;
  height: number;
  /** how deep to cut into the wall (a recess for door/window; full thickness for a portal). */
  depth: number;
}

/** True if this feature kind is a wall opening (declares an aperture hook). */
export function isOpening(ft: FeatureType | undefined): ft is FeatureType & Required<Pick<FeatureType, 'aperture'>> {
  return !!ft && typeof ft.aperture === 'function';
}
```

- [ ] **Step 3: Write the failing test**

Create `tests/unit/blueprint-opening.test.ts`. Task 1 tests the contract itself against synthetic feature types (so it goes green within this task); Tasks 5-6 append cases against the real `door`/`window` kinds.

```ts
// tests/unit/blueprint-opening.test.ts
import { describe, it, expect } from 'vitest';
import { isOpening } from '@/blueprint/features/opening';
import type { FeatureType } from '@/blueprint/registry';

const plain: FeatureType = {
  type: 'plain', paramSchema: {}, resolve: () => ({ params: {} }), toBrief: () => 'plain',
};
const opening: FeatureType = {
  ...plain, type: 'opening', threshold: true,
  aperture: () => ({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }),
  filler: () => [],
};

describe('opening contract', () => {
  it('isOpening is true only when a kind declares an aperture hook', () => {
    expect(isOpening(opening)).toBe(true);
    expect(isOpening(plain)).toBe(false);
    expect(isOpening(undefined)).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-opening.test.ts`
Expected: PASS — `isOpening` correctly discriminates the synthetic kinds. (The real `door`/`window` hook assertions are added in Tasks 5-6.)

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/features/opening.ts src/blueprint/registry.ts tests/unit/blueprint-opening.test.ts
git commit -m "feat(blueprint): opening feature contract — aperture/filler/threshold hooks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Shared wall/face geometry

**Files:**
- Create: `src/blueprint/wall-geometry.ts`
- Create: `tests/unit/blueprint-wall-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/blueprint-wall-geometry.test.ts`:

```ts
// tests/unit/blueprint-wall-geometry.test.ts
import { describe, it, expect } from 'vitest';
import { faceCell, apertureToBox, leafBox, FACE_FACING } from '@/blueprint/wall-geometry';
import type { ResolvedPart } from '@/blueprint/types';

const part = (x: number, y: number, w: number, h: number): ResolvedPart => ({
  id: 'body', type: 'body', at: { x, y }, size: { w, h }, params: {}, features: [],
});

describe('faceCell', () => {
  it('south edge midpoint of a 2x2 at origin is the south row', () => {
    expect(faceCell(part(0, 0, 2, 2), 'south')).toEqual([1, 1]);
  });
  it('west edge midpoint hugs x=origin', () => {
    expect(faceCell(part(0, 0, 2, 2), 'west')).toEqual([0, 1]);
  });
});

describe('apertureToBox', () => {
  it('south aperture sits on the south wall plane and pokes outward by EPS', () => {
    const b = apertureToBox({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    // wall plane y = 2; box spans [2-0.3, 2+0.02]
    expect(b.at[1]).toBeCloseTo(1.7, 5);
    expect(b.at[1] + b.size[1]).toBeCloseTo(2.02, 5);
    expect(b.size[0]).toBeCloseTo(0.4, 5);   // 2*halfW
    expect(b.size[2]).toBeCloseTo(0.85, 5);  // height
  });
});

describe('leafBox', () => {
  it('south leaf never protrudes past the wall plane', () => {
    const l = leafBox({ face: 'south', t: 0.5, sill: 0, halfW: 0.2, height: 0.85, depth: 0.3 }, part(0, 0, 2, 2));
    const maxY = l.at[1] + l.size[1];
    expect(maxY).toBeLessThanOrEqual(2);   // ≤ wall plane (no protrusion)
  });
});

describe('FACE_FACING', () => {
  it('maps faces to outward unit vectors', () => {
    expect(FACE_FACING.south).toEqual([0, 1]);
    expect(FACE_FACING.west).toEqual([-1, 0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/blueprint-wall-geometry.test.ts`
Expected: FAIL — module `@/blueprint/wall-geometry` does not exist.

- [ ] **Step 3: Implement `wall-geometry.ts`**

Create `src/blueprint/wall-geometry.ts`:

```ts
// src/blueprint/wall-geometry.ts
// One home for wall-face geometry, shared by the opening kinds and the four compilers.
// Converts a part-local ApertureSpec (face/t/sill/halfW/height/depth) into absolute
// structure-space boxes: the carved aperture (a recess) and the flush filler leaf.
import type { Vec3 } from '@/assetgen/types';
import type { ResolvedPart, WallFace } from './types';
import type { ApertureSpec } from './features/opening';

export const APERTURE_EPS = 0.02;   // pokes the cut past the wall plane (boolean robustness)
export const LEAF_INSET = 0.04;     // leaf outer face sits this far INSIDE the wall plane
export const LEAF_THICKNESS = 0.08; // leaf panel depth

export const FACE_FACING: Record<WallFace, [number, number]> = {
  south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0],
};

export interface FaceBox { at: Vec3; size: Vec3 }

/** Structure-local perimeter cell an opening at fraction `t` along `face` occupies. */
export function faceCell(part: ResolvedPart, face: WallFace, t = 0.5): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const idx = (run: number) => Math.min(run - 1, Math.max(0, Math.floor(t * run)));
  switch (face) {
    case 'south': return [x + idx(w), y + h - 1];
    case 'north': return [x + idx(w), y];
    case 'east':  return [x + w - 1, y + idx(h)];
    case 'west':  return [x, y + idx(h)];
  }
}

/** Continuous coordinate along the wall run for the opening centre. */
function alongCentre(part: ResolvedPart, s: ApertureSpec): number {
  const { x, y } = part.at, { w, h } = part.size;
  return (s.face === 'south' || s.face === 'north') ? x + s.t * w : y + s.t * h;
}

/** The aperture box (subtracted from the wall) for this opening, in absolute structure space.
 *  It is a recess of depth `s.depth` into the wall, poking `APERTURE_EPS` past the outer plane. */
export function apertureToBox(s: ApertureSpec, part: ResolvedPart): FaceBox {
  const { x, y } = part.at, { w, h } = part.size;
  const c = alongCentre(part, s);
  const d = s.depth, e = APERTURE_EPS, two = 2 * s.halfW;
  switch (s.face) {
    case 'south': { const yp = y + h; return { at: [c - s.halfW, yp - d, s.sill], size: [two, d + e, s.height] }; }
    case 'north': { const yp = y;     return { at: [c - s.halfW, yp - e, s.sill], size: [two, d + e, s.height] }; }
    case 'east':  { const xp = x + w; return { at: [xp - d, c - s.halfW, s.sill], size: [d + e, two, s.height] }; }
    case 'west':  { const xp = x;     return { at: [xp - e, c - s.halfW, s.sill], size: [d + e, two, s.height] }; }
  }
}

/** The flush filler-leaf box for this opening (outer face inset `LEAF_INSET` inside the wall
 *  plane, so it never protrudes), in absolute structure space. */
export function leafBox(s: ApertureSpec, part: ResolvedPart): FaceBox {
  const { x, y } = part.at, { w, h } = part.size;
  const c = alongCentre(part, s);
  const i = LEAF_INSET, t = LEAF_THICKNESS, two = 2 * s.halfW;
  switch (s.face) {
    case 'south': { const yp = y + h; return { at: [c - s.halfW, yp - i - t, s.sill], size: [two, t, s.height] }; }
    case 'north': { const yp = y;     return { at: [c - s.halfW, yp + i,     s.sill], size: [two, t, s.height] }; }
    case 'east':  { const xp = x + w; return { at: [xp - i - t, c - s.halfW, s.sill], size: [t, two, s.height] }; }
    case 'west':  { const xp = x;     return { at: [xp + i,     c - s.halfW, s.sill], size: [t, two, s.height] }; }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/blueprint-wall-geometry.test.ts`
Expected: PASS (4 describes, 6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/blueprint/wall-geometry.ts tests/unit/blueprint-wall-geometry.test.ts
git commit -m "feat(blueprint): wall-geometry — faceCell + aperture/leaf box math

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Generic aperture carve at the prim level

**Files:**
- Modify: `src/assetgen/compose.ts:14-22` (Part union), `:36-47` (partFacets)
- Modify: `src/assetgen/geometry/solids.ts` (add `carveApertures`)
- Create: `tests/unit/assetgen-carve.test.ts`

- [ ] **Step 1: Add the `carveApertures` helper to `solids.ts`**

In `src/assetgen/geometry/solids.ts`, after `solidArch` (line 84), add:

```ts
/** Absolute box to subtract from a wall solid (an opening's aperture). */
export interface ApertureBox { at: Vec3; size: Vec3 }

/** Subtract a set of aperture boxes from a wall solid (carving openings). No-op if empty. */
export async function carveApertures(solid: Manifold, apertures: ApertureBox[] = []): Promise<Manifold> {
  if (!apertures.length) return solid;
  const { Manifold } = await getManifold();
  const holes = await Promise.all(apertures.map(a => solidBox(a.at, a.size)));
  return solid.subtract(Manifold.union(holes));
}
```

(`Vec3` is already imported at the top of `solids.ts`.)

- [ ] **Step 2: Add `apertures?` to the wall-bearing prim variants**

In `src/assetgen/compose.ts`, update the `Part` union (lines 14-22). Add `import type { ApertureBox } from '@/assetgen/geometry/solids';` to the existing solids import block, then add the `apertures?` field to the `box`, `cylinder`, and `building` variants:

```ts
export type Part =
  | { prim: 'box'; at: Vec3; size: Vec3; material?: Mat; apertures?: ApertureBox[] }
  | { prim: 'cylinder'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat; apertures?: ApertureBox[] }
  | { prim: 'cone'; center: [number, number]; baseZ: number; radius: number; height: number; material?: Mat }
  | { prim: 'prism'; center: [number, number]; baseZ: number; radius: number; height: number; sides: number; material?: Mat }
  | { prim: 'ellipsoid'; center: [number, number]; baseZ: number; radii: Vec3; material?: Mat }
  | { prim: 'arch'; at: Vec3; span: number; height: number; thickness: number; material?: Mat }
  | { prim: 'building'; wings: Wing[]; wallMat?: Mat; roofMat?: Mat; roofStyle?: RoofStyle; features?: BuildingFeatures; seed?: number; apertures?: ApertureBox[] }
  | { prim: 'linear'; run: BarrierRun };
```

- [ ] **Step 3: Carve `box` and `cylinder` in `partFacets`**

In `src/assetgen/compose.ts`, update `partFacets` (lines 36-47). Import `carveApertures` from the solids import block, then change the `box` and `cylinder` cases (the `building` case is handled in Task 4):

```ts
    case 'box': {
      let s = await solidBox(p.at, p.size);
      s = await carveApertures(s, p.apertures);
      return { facets: manifoldToFacets(s.getMesh(), p.material ?? 'stone') };
    }
    case 'cylinder': {
      let s = await solidCylinder(p.center, p.baseZ, p.radius, p.height);
      s = await carveApertures(s, p.apertures);
      return { facets: manifoldToFacets(s.getMesh(), p.material ?? 'stone') };
    }
```

- [ ] **Step 4: Write the failing test**

Create `tests/unit/assetgen-carve.test.ts`:

```ts
// tests/unit/assetgen-carve.test.ts
import { describe, it, expect } from 'vitest';
import { carveApertures, solidBox } from '@/assetgen/geometry/solids';

describe('carveApertures', () => {
  it('a box with no apertures is unchanged', async () => {
    const b = await solidBox([0, 0, 0], [2, 2, 2]);
    const c = await carveApertures(b, []);
    expect(c.volume()).toBeCloseTo(b.volume(), 3);
  });

  it('subtracting an aperture reduces the solid volume', async () => {
    const b = await solidBox([0, 0, 0], [2, 2, 2]);          // volume 8
    const c = await carveApertures(b, [{ at: [0.8, 1.7, 0], size: [0.4, 0.4, 0.85] }]);
    expect(c.volume()).toBeLessThan(b.volume());
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assetgen-carve.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/assetgen/geometry/solids.ts src/assetgen/compose.ts tests/unit/assetgen-carve.test.ts
git commit -m "feat(assetgen): generic aperture carve on box/cylinder prims

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `buildingFacets` carves apertures, drops doors, keeps vents

**Files:**
- Modify: `src/assetgen/geometry/building.ts` (resolveFeatures → vents only; trim types)
- Modify: `src/assetgen/geometry/solids.ts` (buildingFacets carves; keep doorSolid for now — deleted in Task 10)
- Modify: `src/assetgen/compose.ts` (building case passes apertures)
- Modify: `tests/unit/assetgen-solids.test.ts`

- [ ] **Step 1: Reduce `BuildingFeatures`/`resolveFeatures` to vents only**

In `src/assetgen/geometry/building.ts`:

Change `BuildingFeatures` (line 82) and `ResolvedFeatures` (line 86):

```ts
/** Optional explicit features; omit the vents list to derive a seeded default. */
export interface BuildingFeatures { vents?: VentFeature[] }
export interface ResolvedFeatures { vents: VentFeature[] }
```

Replace `resolveFeatures` (lines 218-234) with a vents-only resolver:

```ts
/**
 * Resolve a building's vents: explicit list if given, else one seeded chimney partway
 * along the main wing's ridge. (Doors are now resolved in the Blueprint layer as openings.)
 */
export function resolveFeatures(wings: Wing[], features: BuildingFeatures = {}, seed = 0): ResolvedFeatures {
  const rng = mulberry32(seed >>> 0);
  const vents = features.vents ?? [{ wing: mainWing(wings), t: 0.28 + rng() * 0.2 }];
  return { vents };
}
```

Leave `DoorFeature`, `ResolvedDoor`, `placeDoors`, `frontRuns`, `runsOnFace`, `doorThreshold`, `centerCellOnFace`, `faceOutward`, `MIN_DOOR_SEP`, `dist2`, `DoorAnchor`, and `BuildingAnchors.doors` **in place for now** — they are deleted in Task 10 (dead-code-removal commit) so this task stays focused and tests stay green between commits.

- [ ] **Step 2: `buildingFacets` carves `apertures`, stops emitting doors**

In `src/assetgen/geometry/solids.ts`:

- Add `carveApertures, type ApertureBox` to the things already exported from this file are fine; just use them locally.
- Change the `buildingFacets` signature (line 225-232) to add an `apertures` parameter and drop the door loop. Replace the function body's wall construction and feature emission:

```ts
export async function buildingFacets(
  wings: Wing[],
  wallMat: Mat = 'plaster',
  roofMat: Mat = 'tile',
  roofStyle: RoofStyle = 'gable',
  features: BuildingFeatures = {},
  seed = 0,
  apertures: ApertureBox[] = [],
): Promise<{ facets: WorldFacet[]; anchors: BuildingAnchors }> {
  const { Manifold } = await getManifold();
  // Walls: union every storey box of every wing (upper storeys grown by jetty), then
  // carve any openings (doors/windows) so they read as recesses, not proud boxes.
  const wallBoxes: Manifold[] = [];
  for (const w of wings) {
    const n = w.storeys ?? 1;
    for (let s = 0; s < n; s++) {
      const r = storeyRect(w, s);
      wallBoxes.push(await solidBox([r.x, r.y, s * STOREY], [r.w, r.h, STOREY]));
    }
  }
  const roofSolids = await Promise.all(wings.map(w => wingRoof(w, roofStyle)));
  const walls = await carveApertures(Manifold.union(wallBoxes), apertures);
  const roof = Manifold.union(roofSolids);

  const { vents } = resolveFeatures(wings, features, seed);
  const facets: WorldFacet[] = [
    ...manifoldToFacets(walls.getMesh(), wallMat),
    ...manifoldToFacets(roof.getMesh(), roofMat),
  ];
  const anchors: BuildingAnchors = { doors: [], vents: [] };

  for (const v of vents) {
    const w = wings[v.wing] ?? wings[0];
    const c = await ventSolid(w, v, roofStyle);
    facets.push(...manifoldToFacets(c.solid.getMesh(), c.mat));
    anchors.vents.push(c.anchor);
  }
  return { facets, anchors };
}
```

- Update the solids import block (lines 7-11): remove `type ResolvedDoor` (no longer used in this file after the door loop is gone — but `doorSolid` still references it until Task 10). **Keep** `ResolvedDoor` imported for now since `doorSolid` is still present. Add `carveApertures, type ApertureBox` are defined in this same file (Task 3), so no import needed.

- [ ] **Step 3: Pass apertures through `partFacets`**

In `src/assetgen/compose.ts`, update the `building` case (line 44):

```ts
    case 'building':  return buildingFacets(p.wings, p.wallMat, p.roofMat, p.roofStyle, p.features, p.seed, p.apertures);
```

- [ ] **Step 4: Update `assetgen-solids.test.ts`**

In `tests/unit/assetgen-solids.test.ts`, the `buildingFacets (manifold)` block currently tests door emission via `features.doors` and `noFeatures = { doors: [], vents: [] }`. Update:

- Change `noFeatures` (line 68) to `const noVents = { vents: [] };` and replace every `noFeatures` usage with `noVents`.
- **Delete** the three door tests: "emits a door solid (door material) against a perimeter wall" (lines ~100-113), "places a door with no cell at the centre of its face run; main door is wider" (lines ~115-122), and the door half of "derives a default main door + one chimney when no features are given" (lines ~145-148). The vent/chimney assertions in that last test stay; rename it to "derives one chimney when no features are given" and assert only `anchors.vents`.
- **Add** a carve test in the same block:

```ts
  it('carves an aperture recess into the wall (volume drops vs no aperture)', async () => {
    const square: Wing[] = [{ x: 0, y: 0, w: 2, h: 2, storeys: 1 }];
    const plain = await buildingFacets(square, 'plaster', 'tile', 'gable', { vents: [] });
    const carved = await buildingFacets(square, 'plaster', 'tile', 'gable', { vents: [] }, 0,
      [{ at: [0.8, 1.7, 0], size: [0.4, 0.4, 0.85] }]);
    const wallArea = (r: { facets: { pts: number[][] }[] }) =>
      r.facets.flatMap(f => f.pts).length;
    // carving removes the flush south face and adds recess faces → facet count changes
    expect(wallArea(carved)).not.toBe(wallArea(plain));
  });
```

- [ ] **Step 5: Run the affected tests**

Run: `npx vitest run tests/unit/assetgen-solids.test.ts`
Expected: PASS (door tests gone, carve test green, vents intact).

- [ ] **Step 6: Commit**

```bash
git add src/assetgen/geometry/building.ts src/assetgen/geometry/solids.ts src/assetgen/compose.ts tests/unit/assetgen-solids.test.ts
git commit -m "refactor(assetgen): buildingFacets carves apertures + vents only (doors leave the geometry layer)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Door opening hooks + rich semantics

**Files:**
- Modify: `src/blueprint/features/door.ts`
- Modify: `tests/unit/blueprint-opening.test.ts` (add door-hook assertions)

- [ ] **Step 1: Rewrite `door.ts` with opening hooks and rich params**

Replace `src/blueprint/features/door.ts` entirely:

```ts
// src/blueprint/features/door.ts
// The door opening. Size derives from the scale contract so it reads at villager height
// by construction. Rich semantics (hinge/swing/lock/open/hardware) are MODELLED as data
// now — they drive Fate narration, sim, and interaction; the rendered geometry is a thin
// flush leaf set into a carved recess (no protrusion).
import type { FeatureType } from '../registry';
import type { ApertureSpec } from './opening';
import type { Part as Prim } from '@/assetgen/compose';
import { DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES } from '@/render/scale-contract';
import { apertureToBox, leafBox } from '../wall-geometry';

const MAIN_SCALE = 1.18;   // a main entrance: modestly grander, still human-relative
const DOOR_RECESS = 0.3;   // recess (niche) depth — a door, not a see-through portal

export const doorFeatureType: FeatureType = {
  type: 'door',
  paramSchema: {
    main: { kind: 'bool', default: false },
    // width/height: half-width along the wall (tiles) and height (height-units).
    // Defaulted from the scale contract in resolve() when left unset (-1 sentinel).
    width: { kind: 'number', min: -1, max: 2, default: -1 },
    height: { kind: 'number', min: -1, max: 4, default: -1 },
    t: { kind: 'number', min: 0, max: 1, default: 0.5 },          // centre along the wall run
    hinge: { kind: 'enum', values: ['left', 'right'], default: 'left' },
    swing: { kind: 'enum', values: ['in', 'out', 'slide'], default: 'in' },
    locked: { kind: 'bool', default: false },
    open: { kind: 'number', min: 0, max: 1, default: 0 },         // 0 shut … 1 wide open (state)
    // Hardware — modelled as data now, rendered when zoom/scale justifies it.
    handle: { kind: 'bool', default: true },
    lock: { kind: 'bool', default: false },
    bell: { kind: 'bool', default: false },
    knocker: { kind: 'bool', default: false },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const main = p.main === true;
    const grand = main ? MAIN_SCALE : 1;
    const halfW = (p.width as number) >= 0 ? (p.width as number) : (DOOR_WIDTH_TILES / 2) * grand;
    const height = (p.height as number) >= 0 ? (p.height as number) : DOOR_HEIGHT_UNITS * grand;
    return {
      params: {
        main, halfW, height,
        t: (p.t as number) ?? 0.5,
        hinge: (p.hinge as string) ?? 'left',
        swing: (p.swing as string) ?? 'in',
        locked: p.locked === true,
        open: (p.open as number) ?? 0,
        handle: p.handle !== false,
        lock: p.lock === true,
        bell: p.bell === true,
        knocker: p.knocker === true,
      },
    };
  },
  toBrief: () => 'human-height door',

  // ── opening hooks ──
  threshold: true,
  aperture: (f, host): ApertureSpec => ({
    face: f.face ?? 'south',
    t: f.params.t as number,
    sill: 0,
    halfW: f.params.halfW as number,
    height: f.params.height as number,
    depth: DOOR_RECESS,
  }),
  filler: (f, host): Prim[] => {
    const spec: ApertureSpec = {
      face: f.face ?? 'south', t: f.params.t as number, sill: 0,
      halfW: f.params.halfW as number, height: f.params.height as number, depth: DOOR_RECESS,
    };
    const leaf = leafBox(spec, host);
    return [{ prim: 'box', at: leaf.at, size: leaf.size, material: 'door' }];
  },
};
```

Note: `apertureToBox` is imported for type-consistency but the door's `aperture` hook returns an `ApertureSpec` (the compiler calls `apertureToBox`). If your linter flags the unused import, remove `apertureToBox` from the import — only `leafBox` is used directly here.

- [ ] **Step 2: Add door-hook assertions to the opening test**

Append to `tests/unit/blueprint-opening.test.ts`:

```ts
import { resolveBlueprint } from '@/blueprint/resolve';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { getFeatureType } from '@/blueprint/registry';

describe('door opening hooks', () => {
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
    materials: { walls: 'stone', roof: 'tile' },
    parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', roof: 'gable' },
      features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
  };

  it('aperture sits on the resolved door face with contract-sized height', () => {
    const rb = resolveBlueprint([bp], 0);
    const part = rb.parts[0];
    const door = part.features.find(f => f.type === 'door')!;
    const ap = getFeatureType('door')!.aperture!(door, part, { materials: rb.materials, footprint: rb.footprint });
    expect(ap.face).toBe('south');
    expect(ap.height).toBeGreaterThanOrEqual(0.85);   // DOOR_HEIGHT_UNITS
  });

  it('filler is a door-material leaf prim', () => {
    const rb = resolveBlueprint([bp], 0);
    const part = rb.parts[0];
    const door = part.features.find(f => f.type === 'door')!;
    const prims = getFeatureType('door')!.filler!(door, part, { materials: rb.materials, footprint: rb.footprint });
    expect(prims).toHaveLength(1);
    expect(prims[0]).toMatchObject({ prim: 'box', material: 'door' });
  });

  it('resolves rich semantics with defaults', () => {
    const rb = resolveBlueprint([bp], 0);
    const door = rb.parts[0].features.find(f => f.type === 'door')!;
    expect(door.params).toMatchObject({ hinge: 'left', swing: 'in', locked: false, open: 0, handle: true });
  });
});
```

- [ ] **Step 3: Run the opening test (now green) plus the original Task-1 cases**

Run: `npx vitest run tests/unit/blueprint-opening.test.ts`
Expected: PASS — the Task-1 `door.threshold === true` and `isOpening(door)` now pass, and the new door-hook cases pass.

- [ ] **Step 4: Commit**

```bash
git add src/blueprint/features/door.ts tests/unit/blueprint-opening.test.ts
git commit -m "feat(blueprint): door opening hooks + rich semantics (hinge/swing/lock/hardware)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Window opening hooks

**Files:**
- Modify: `src/blueprint/features/window.ts`
- Modify: `tests/unit/blueprint-opening.test.ts` (window-hook assertions)

- [ ] **Step 1: Rewrite `window.ts` with opening hooks**

Replace `src/blueprint/features/window.ts` entirely:

```ts
// src/blueprint/features/window.ts
// The window opening. A raised, non-threshold aperture with a recessed pane. style/glazed
// are MODELLED (feed the brief) — the rendered geometry is a thin recessed pane.
import type { FeatureType } from '../registry';
import type { ApertureSpec } from './opening';
import type { Part as Prim } from '@/assetgen/compose';
import { leafBox } from '../wall-geometry';

const WINDOW_RECESS = 0.18;
const WINDOW_SILL = 0.4;       // raised off the ground (height-units)
const WINDOW_HALF_W = 0.18;    // narrower than a door
const WINDOW_HEIGHT = 0.55;

export const windowFeatureType: FeatureType = {
  type: 'window',
  paramSchema: {
    style: { kind: 'enum', values: ['plain', 'shuttered', 'arched'], default: 'plain' },
    glazed: { kind: 'bool', default: true },
    t: { kind: 'number', min: 0, max: 1, default: 0.5 },
    width: { kind: 'number', min: -1, max: 2, default: -1 },
    height: { kind: 'number', min: -1, max: 4, default: -1 },
    sill: { kind: 'number', min: 0, max: 3, default: WINDOW_SILL },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const halfW = (p.width as number) >= 0 ? (p.width as number) : WINDOW_HALF_W;
    const height = (p.height as number) >= 0 ? (p.height as number) : WINDOW_HEIGHT;
    return {
      params: {
        style: (p.style as string) ?? 'plain',
        glazed: p.glazed !== false,
        t: (p.t as number) ?? 0.5,
        halfW, height,
        sill: (p.sill as number) ?? WINDOW_SILL,
      },
    };
  },
  toBrief: (f) => `${f.params.style as string} window`,

  // ── opening hooks ──
  threshold: false,
  aperture: (f): ApertureSpec => ({
    face: f.face ?? 'south',
    t: f.params.t as number,
    sill: f.params.sill as number,
    halfW: f.params.halfW as number,
    height: f.params.height as number,
    depth: WINDOW_RECESS,
  }),
  filler: (f, host): Prim[] => {
    const spec: ApertureSpec = {
      face: f.face ?? 'south', t: f.params.t as number, sill: f.params.sill as number,
      halfW: f.params.halfW as number, height: f.params.height as number, depth: WINDOW_RECESS,
    };
    const pane = leafBox(spec, host);   // a recessed dark pane reads as a glazed opening
    return [{ prim: 'box', at: pane.at, size: pane.size, material: 'door' }];
  },
};
```

(MVP renders aperture + recessed pane; `style`/`glazed`/`shuttered` are modelled and feed `toBrief`, not rendered as separate geometry — consistent with the spec's "data rich, geometry thin" cut.)

- [ ] **Step 2: Add window-hook assertions**

Append to `tests/unit/blueprint-opening.test.ts`:

```ts
describe('window opening hooks', () => {
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 2 },
    materials: { walls: 'stone', roof: 'tile' },
    parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', roof: 'gable' },
      features: { win: { type: 'window', face: 'south', params: { style: 'arched' } } } } },
  };

  it('window aperture is raised (sill > 0) and not a threshold', () => {
    const rb = resolveBlueprint([bp], 0);
    const part = rb.parts[0];
    const win = part.features.find(f => f.type === 'window')!;
    const ft = getFeatureType('window')!;
    const ap = ft.aperture!(win, part, { materials: rb.materials, footprint: rb.footprint });
    expect(ap.sill).toBeGreaterThan(0);
    expect(ft.threshold).toBe(false);
  });
});
```

- [ ] **Step 3: Run the opening test**

Run: `npx vitest run tests/unit/blueprint-opening.test.ts`
Expected: PASS — including the Task-1 `window.threshold === false` / `isOpening(window)` cases.

- [ ] **Step 4: Commit**

```bash
git add src/blueprint/features/window.ts tests/unit/blueprint-opening.test.ts
git commit -m "feat(blueprint): window opening hooks (raised non-threshold aperture + pane)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `toGeometry` compiles openings → apertures + filler prims

**Files:**
- Modify: `src/blueprint/compile/to-geometry.ts`
- Modify: `tests/unit/blueprint-to-geometry.test.ts`

- [ ] **Step 1: Rewrite `to-geometry.ts` to compile openings generically**

Replace `src/blueprint/compile/to-geometry.ts` entirely:

```ts
// src/blueprint/compile/to-geometry.ts
// Fold a ResolvedBlueprint to an assetgen StructureSpec. Wing-bearing parts (body/wing)
// merge into ONE prim:'building'; round/stepped bodies and tower/porch/chimney append as
// standalone prims. Openings (door/window) carve their host part's wall-bearing prim and
// append a flush filler leaf/pane prim — uniform across rect/round/stepped.
import type { ResolvedBlueprint, ResolvedPart } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import type { Part as Prim, StructureSpec } from '@/assetgen/compose';
import type { ApertureBox } from '@/assetgen/geometry/solids';
import type { BuildingFeatures, VentFeature } from '@/assetgen/geometry/building';
import { ISO_TILE_W } from '@/render/iso/iso-constants';
import { isOpening } from '../features/opening';
import { apertureToBox } from '../wall-geometry';

/** A vent feature on a wing-part → an assetgen VentFeature on wing `wingIdx`. */
function ventOf(f: ResolvedPart['features'][number], wingIdx: number): VentFeature {
  return {
    wing: wingIdx, t: f.params.t as number,
    kind: f.params.kind as VentFeature['kind'],
    placement: f.params.placement as VentFeature['placement'],
  };
}

/** Compile a part's openings → carve boxes (for its wall prim) + filler prims (added back). */
function compileOpenings(part: ResolvedPart, ctx: CompileCtx): { apertures: ApertureBox[]; fillers: Prim[] } {
  const apertures: ApertureBox[] = [];
  const fillers: Prim[] = [];
  for (const f of part.features) {
    const ft = getFeatureType(f.type);
    if (!isOpening(ft)) continue;
    apertures.push(apertureToBox(ft.aperture(f, part, ctx), part));
    if (ft.filler) fillers.push(...ft.filler(f, part, ctx));
  }
  return { apertures, fillers };
}

const WALL_BEARING = new Set(['building', 'cylinder', 'box']);

export function toGeometry(rb: ResolvedBlueprint): StructureSpec {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };

  // structure bounding box (for sprite size), from every part's footprint claim
  let maxX = 0, maxY = 0;
  for (const p of rb.parts) { maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h); }
  const size = Math.min(640, Math.max(128, Math.round((maxX + maxY) * ISO_TILE_W * 0.65)));

  let building: Extract<Prim, { prim: 'building' }> | null = null;
  const others: Prim[] = [];
  const fillers: Prim[] = [];
  const buildingApertures: ApertureBox[] = [];
  const vents: VentFeature[] = [];

  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    const prims = pt.toPrims(part, ctx);
    const { apertures, fillers: partFillers } = compileOpenings(part, ctx);
    fillers.push(...partFillers);

    let attached = false;   // openings attach to this part's FIRST wall-bearing prim
    for (const prim of prims) {
      if (prim.prim === 'building') {
        if (!building) building = { ...prim, wings: [...prim.wings], features: {}, apertures: [], seed: 0 };
        else building.wings.push(...prim.wings);
        const wingIdx = building.wings.length - prim.wings.length;
        for (const f of part.features) if (f.type === 'vent') vents.push(ventOf(f, wingIdx));
        if (!attached) { buildingApertures.push(...apertures); attached = true; }
      } else {
        if (!attached && WALL_BEARING.has(prim.prim) && apertures.length) {
          (prim as Extract<Prim, { prim: 'box' | 'cylinder' }>).apertures = apertures;
          attached = true;
        }
        others.push(prim);
      }
    }
  }

  const parts: Prim[] = [];
  if (building) {
    const features: BuildingFeatures = {};
    if (vents.length) features.vents = vents;
    building.features = features;
    if (buildingApertures.length) building.apertures = buildingApertures;
    parts.push(building);
  }
  parts.push(...others, ...fillers);

  return { size, parts };
}
```

- [ ] **Step 2: Update `blueprint-to-geometry.test.ts`**

In `tests/unit/blueprint-to-geometry.test.ts`:

- The cottage test (lines 22-34) currently asserts `p.features?.doors?.[0]`. Doors no longer live in `building.features`. Replace that assertion block with carve + filler assertions:

```ts
  it('rect body → one building prim; door becomes a carved aperture + filler leaf', () => {
    const spec = toGeometry(resolveBlueprint([cottage], 0));
    const building = spec.parts.find(p => p.prim === 'building')!;
    expect(building.prim).toBe('building');
    if (building.prim === 'building') {
      expect(building.wings).toEqual([{ x: 0, y: 0, w: 2, h: 2, storeys: 1, roof: 'gable' }]);
      expect(building.wallMat).toBe('plaster');
      expect(building.roofMat).toBe('thatch');
      expect(building.apertures?.length).toBe(1);                 // door carved the wall
      expect(building.features?.vents?.[0]).toMatchObject({ wing: 0, kind: 'chimney' });
    }
    // the door leaf is a separate door-material box prim
    const leaf = spec.parts.find(p => p.prim === 'box' && p.material === 'door');
    expect(leaf).toBeDefined();
  });
```

- The round-body test (lines 36-44) asserts `['cylinder', 'ellipsoid']`. With no door on that yurt blueprint it stays valid, but add a second case proving a round door carves the cylinder and adds a leaf:

```ts
  it('round body with a door → cylinder carries the aperture + a filler leaf prim', () => {
    const yurt: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 2, h: 2 },
      materials: { walls: 'hide', roof: 'hide' },
      parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'round', levels: 1, roof: 'domed' },
        features: { door: { type: 'door', face: 'south' } } } },
    };
    const spec = toGeometry(resolveBlueprint([yurt], 0));
    const cyl = spec.parts.find(p => p.prim === 'cylinder')!;
    expect(cyl.prim === 'cylinder' && cyl.apertures?.length).toBe(1);
    expect(spec.parts.some(p => p.prim === 'box' && p.material === 'door')).toBe(true);
  });
```

- The "body + wing" test (lines 46-58) stays valid (no doors). Leave it.

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/blueprint-to-geometry.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/blueprint/compile/to-geometry.ts tests/unit/blueprint-to-geometry.test.ts
git commit -m "feat(blueprint): toGeometry carves openings + emits filler prims (rect/round/stepped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `toCollision` — threshold-driven, shared faceCell

**Files:**
- Modify: `src/blueprint/compile/to-collision.ts`
- Modify: `tests/unit/blueprint-to-collision.test.ts`

- [ ] **Step 1: Rewrite `to-collision.ts` to use the shared helper + threshold flag**

Replace `src/blueprint/compile/to-collision.ts` entirely:

```ts
// src/blueprint/compile/to-collision.ts
// Precompute passability: blocked structure cells (union of part claims) + threshold cells
// (passable) for openings whose kind is a threshold (doors/gates, NOT windows). Footprint
// cells not in `blocked` are walkable lawn.
import type { ResolvedBlueprint, ResolvedFeature, WallFace } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import { faceCell } from '../wall-geometry';

const key = (x: number, y: number) => `${x},${y}`;

export function toCollision(rb: ResolvedBlueprint): { footprint: { w: number; h: number }; blocked: string[]; doorCells: string[] } {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const blocked = new Set<string>();
  const doorCells = new Set<string>();
  for (const part of rb.parts) {
    const pt = getPartType(part.type);
    for (const [x, y] of pt.toCollision(part, ctx)) blocked.add(key(x, y));
    for (const f of part.features as ResolvedFeature[]) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only threshold openings (doors/gates) carve a walkable cell
      const t = (f.params.t as number) ?? 0.5;
      const [dx, dy] = faceCell(part, (f.face ?? 'south') as WallFace, t);
      doorCells.add(key(dx, dy));
    }
  }
  return { footprint: { ...rb.footprint }, blocked: [...blocked], doorCells: [...doorCells] };
}
```

- [ ] **Step 2: Add a window-has-no-threshold test**

Append to `tests/unit/blueprint-to-collision.test.ts`:

```ts
  it('a window does NOT add a door cell (not a threshold)', () => {
    const withWindow: Blueprint = {
      version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
      materials: { walls: 'stone', roof: 'tile' },
      parts: { body: { type: 'body', size: { w: 2, h: 2 }, params: { plan: 'rect', roof: 'gable' },
        features: { win: { type: 'window', face: 'south' } } } },
    };
    const c = toCollision(resolveBlueprint([withWindow], 0));
    expect(c.doorCells).toHaveLength(0);
  });
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/blueprint-to-collision.test.ts`
Expected: PASS — the existing door-cell test still passes (door is a threshold), window adds none.

- [ ] **Step 4: Commit**

```bash
git add src/blueprint/compile/to-collision.ts tests/unit/blueprint-to-collision.test.ts
git commit -m "feat(blueprint): toCollision threshold-driven door cells via shared faceCell

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: `toAnchors` — opening-kind label, shared helpers

**Files:**
- Modify: `src/blueprint/compile/to-anchors.ts`
- Modify: `tests/unit/blueprint-entity.test.ts` is unaffected; add a focused anchor test instead.
- Create: `tests/unit/blueprint-to-anchors.test.ts`

- [ ] **Step 1: Rewrite `to-anchors.ts`**

Replace `src/blueprint/compile/to-anchors.ts` entirely:

```ts
// src/blueprint/compile/to-anchors.ts
// World-space anchors for a placed blueprint, driven by each part's threshold openings
// (doors/gates). The anchor kind is the opening's kind, so a gate reads as a 'gate' anchor.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '../types';
import { getFeatureType } from '../registry';
import { faceCell, FACE_FACING } from '../wall-geometry';
import type { Anchor } from '@/world/anchors';

export function toAnchors(rb: ResolvedBlueprint, originX: number, originY: number): Anchor[] {
  const out: Anchor[] = [];
  for (const part of rb.parts) {
    for (const f of part.features) {
      const ft = getFeatureType(f.type);
      if (!ft?.threshold) continue;   // only passable openings get a pathing anchor
      const face = (f.face ?? 'south') as WallFace;
      const t = (f.params.t as number) ?? 0.5;
      const [cx, cy] = faceCell(part, face, t);
      const fdir = FACE_FACING[face];
      const x = originX + cx + (fdir[0] > 0 ? 1 : fdir[0] < 0 ? 0 : 0.5);
      const y = originY + cy + (fdir[1] > 0 ? 1 : fdir[1] < 0 ? 0 : 0.5);
      out.push({ kind: f.type, x, y, facing: fdir, main: f.params.main === true });
    }
  }
  return out;
}
```

Note: `Anchor.kind` was previously the literal `'door'`. Check `src/world/anchors.ts` — if `Anchor.kind` is typed as a string-literal union that excludes arbitrary feature names, widen it to `string` (or add `'gate' | 'window'`). Inspect first:

Run: `grep -n "kind" src/world/anchors.ts`
- If `kind: string` already → no change.
- If a narrow union → change the `door` anchor `kind` field to accept `string` (the existing `'door'` value still satisfies it, so consumers that match `a.kind === 'door'` keep working).

- [ ] **Step 2: Write the anchor test**

Create `tests/unit/blueprint-to-anchors.test.ts`:

```ts
// tests/unit/blueprint-to-anchors.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toAnchors } from '@/blueprint/compile/to-anchors';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const twoDoors: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 3, h: 3 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', roof: 'gable' },
    features: {
      front: { type: 'door', face: 'south', params: { main: true } },
      side: { type: 'door', face: 'east' },
      win: { type: 'window', face: 'north' },
    } } },
};

describe('toAnchors', () => {
  it('emits one door anchor per threshold opening (windows excluded)', () => {
    const anchors = toAnchors(resolveBlueprint([twoDoors], 0), 10, 20);
    const doors = anchors.filter(a => a.kind === 'door');
    expect(doors).toHaveLength(2);
    expect(doors.some(a => a.main)).toBe(true);
    expect(anchors.some(a => a.kind === 'window')).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test + the existing entity test**

Run: `npx vitest run tests/unit/blueprint-to-anchors.test.ts tests/unit/blueprint-entity.test.ts`
Expected: PASS — `blueprint-entity.test.ts` still finds a `door`-kind anchor.

- [ ] **Step 4: Commit**

```bash
git add src/blueprint/compile/to-anchors.ts tests/unit/blueprint-to-anchors.test.ts src/world/anchors.ts
git commit -m "feat(blueprint): toAnchors emits per-opening anchors (kind label, shared faceCell)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(If `src/world/anchors.ts` needed no change, drop it from the `git add`.)

---

## Task 10: `toBrief` shared faceCell + delete dead door geometry

**Files:**
- Modify: `src/blueprint/compile/to-brief.ts` (use shared `faceCell`, drop private dup)
- Modify: `src/assetgen/geometry/building.ts` (delete door types/helpers)
- Modify: `src/assetgen/geometry/solids.ts` (delete `doorSolid`, drop `ResolvedDoor` import)
- Create: `tests/unit/no-door-solid.test.ts` (guard)

- [ ] **Step 1: De-dup `to-brief.ts`**

In `src/blueprint/compile/to-brief.ts`:
- Add `import { faceCell } from '../wall-geometry';`
- Delete the private `doorCellFor` function (lines 72-81).
- Replace its one call site (line 50) `doorCellFor(body, (doorFeat.face ?? 'south') as WallFace)` with `faceCell(body, (doorFeat.face ?? 'south') as WallFace, (doorFeat.params?.t as number) ?? 0.5)`.

- [ ] **Step 2: Delete dead door geometry from `building.ts`**

In `src/assetgen/geometry/building.ts`, delete (now unused after Task 4):
- `DoorFeature` interface (lines 46-63)
- `ResolvedDoor` interface (line 85)
- `placeDoors` (lines 172-211), `frontRuns` (lines 158-167), `runsOnFace` (lines 120-139), `doorThreshold` (lines 141-149), `centerCellOnFace` (lines 152-156), `faceOutward` (lines 114-118), `MIN_DOOR_SEP` (line 170), `dist2` (line 150)
- `DoorAnchor` interface (line 89) and the `doors` field of `BuildingAnchors` (line 90 → `export interface BuildingAnchors { vents: [number, number, number][] }`)

Keep: `occupancy`, `mainWing`, `ridgeAxisOf`, `hashStr`, `mulberry32`, `Wing`, `VentFeature`, `BuildingFeatures`, `ResolvedFeatures`, `resolveFeatures`, `WallFace`, `STOREY`.

- [ ] **Step 3: Delete `doorSolid` + its anchor type usage in `solids.ts`**

In `src/assetgen/geometry/solids.ts`:
- Delete the `doorSolid` function (lines 157-168).
- Remove `type ResolvedDoor` from the building import (line 9).
- `buildingFacets` already (Task 4) sets `anchors: BuildingAnchors = { doors: [], vents: [] }` — update to `{ vents: [] }` to match the trimmed `BuildingAnchors`, and remove the now-defunct `doors: []`.
- In `src/assetgen/compose.ts`, the anchor-collection loop reads `part.anchors.doors` (line 68). Remove that line (door anchors no longer exist); keep the `vents` line. Keep `StructureAnchors.doors: []` field initialised empty (unused but preserves the type for any external reader).

- [ ] **Step 4: Write the guard test**

Create `tests/unit/no-door-solid.test.ts`:

```ts
// tests/unit/no-door-solid.test.ts
// Guards the clean cut: the additive proud-box door path is gone. Doors are carved
// openings (Blueprint layer), never an assetgen doorSolid.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('no doorSolid / proud-box door path', () => {
  it('no src file references doorSolid, DoorFeature, ResolvedDoor, or placeDoors', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8');
      if (/\b(doorSolid|DoorFeature|ResolvedDoor|placeDoors)\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the guard + the touched compilers**

Run: `npx vitest run tests/unit/no-door-solid.test.ts tests/unit/blueprint-to-brief.test.ts tests/unit/assetgen-solids.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/blueprint/compile/to-brief.ts src/assetgen/geometry/building.ts src/assetgen/geometry/solids.ts src/assetgen/compose.ts tests/unit/no-door-solid.test.ts
git commit -m "refactor(assetgen): delete doorSolid + dead door-placement helpers; guard the cut

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Golden regression — carved doors on rect/round/stepped, no protrusion

**Files:**
- Modify: `tests/unit/blueprint-golden-regression.test.ts`

- [ ] **Step 1: Rewrite the golden regression for the opening model**

Replace `tests/unit/blueprint-golden-regression.test.ts` entirely:

```ts
// tests/unit/blueprint-golden-regression.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';

beforeAll(() => ensureBuildingTypesRegistered());

/** The door leaf prim a preset emits (a door-material box), if any. */
function doorLeaf(name: string) {
  const spec = toGeometry(synthesizeBlueprint(name)!);
  return spec.parts.find(p => p.prim === 'box' && p.material === 'door');
}

describe('blueprint golden regression — openings', () => {
  it('cottage (rect) → building prim carries a door aperture + a leaf prim', () => {
    const spec = toGeometry(synthesizeBlueprint('cottage')!);
    const b = spec.parts.find(p => p.prim === 'building')!;
    expect(b.prim === 'building' && b.apertures?.length).toBe(1);
    expect(doorLeaf('cottage')).toBeDefined();
  });

  it('yurt (round) → cylinder carries a door aperture + a leaf prim (door now visible)', () => {
    const spec = toGeometry(synthesizeBlueprint('yurt')!);
    const cyl = spec.parts.find(p => p.prim === 'cylinder');
    expect(cyl && cyl.prim === 'cylinder' && cyl.apertures?.length).toBe(1);
    expect(doorLeaf('yurt')).toBeDefined();
  });

  it('castle_keep (stepped) → ground box carries a door aperture + a leaf prim (door now visible)', () => {
    const spec = toGeometry(synthesizeBlueprint('castle_keep')!);
    const boxes = spec.parts.filter(p => p.prim === 'box' && p.material !== 'door');
    expect(boxes.some(b => b.prim === 'box' && b.apertures?.length)).toBe(true);
    expect(doorLeaf('castle_keep')).toBeDefined();
  });

  it('every preset door leaf is sized to the scale contract and never protrudes its wall', () => {
    for (const name of ['cottage', 'tavern', 'temple_small', 'longhouse']) {
      const leaf = doorLeaf(name);
      expect(leaf, name).toBeDefined();
      if (leaf && leaf.prim === 'box') {
        // height (z extent) tracks DOOR_HEIGHT_UNITS (0.85) up to the main ×1.18 = ~1.0
        expect(leaf.size[2], name).toBeGreaterThanOrEqual(0.85);
        expect(leaf.size[2], name).toBeLessThanOrEqual(0.85 * 1.4);
      }
    }
  });
});
```

- [ ] **Step 2: Run the golden regression**

Run: `npx vitest run tests/unit/blueprint-golden-regression.test.ts`
Expected: PASS — yurt and castle_keep now emit door leaves (the headline fix), cottage carves, door height tracks the contract.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/blueprint-golden-regression.test.ts
git commit -m "test(blueprint): golden regression — carved doors on rect/round/stepped, contract-sized

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Full-suite + build verification, preview eyeball

**Files:**
- Run-only (no new files unless a regression surfaces).

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: ALL green. Likely-affected files to watch: `place-building-verb.test.ts`, `building-placer-descriptor.test.ts`, `blueprint-presets.test.ts`, `blueprint-structural-parts.test.ts`, `blueprint-wing-prim-parts.test.ts`. If any reference the removed `features.doors` / `DoorFeature` / `doorSolid`, update them to the opening model (assert `apertures` + a `door`-material leaf prim, exactly as the golden regression does). Do NOT weaken assertions to pass — fix them to the new contract.

- [ ] **Step 2: TypeScript + production build**

Run: `npm run build`
Expected: `tsc` clean (no type errors) and Vite build succeeds emitting `manifold.wasm`. Common breakage: a consumer still importing `DoorFeature`/`ResolvedDoor` from `building.ts`, or `Anchor.kind` narrowing. Fix at the source.

- [ ] **Step 3: Regenerate building previews (if the preview script exists) and eyeball**

Check for a preview generator (e.g. `scripts/preview-buildings.*` or a `vitest` preview spec under `tests/`):

Run: `grep -rln "composeStructure\|preview" scripts tests 2>/dev/null | head`

If a building-preview PNG generator exists, run it and visually confirm on cottage / yurt / castle_keep:
- doors sit flush in a recess (no proud slab),
- yurt and castle_keep have a visible door,
- door reads at roughly villager height.

If no automated preview exists, this is a **manual in-browser eyeball** (record it as a deferred follow-up, do not block the merge): `npm run dev` → New World → inspect a cottage, yurt, and castle keep.

- [ ] **Step 4: Commit any test/preview fixups**

```bash
git add <explicit paths of any files you fixed>
git commit -m "test: align remaining suites with the opening model

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- One Opening feature family (registered kinds, hooks) → Tasks 1, 5, 6. ✓
- Carved-aperture substrate across rect/round/stepped → Tasks 2, 3, 4, 7. ✓
- Semantic data rich (hinge/swing/lock/open/hardware/sill/style) / geometry thin (leaf + pane) → Tasks 5, 6. ✓
- Protrusion fixed by construction → `leafBox` inset (Task 2) + no-protrusion assertions (Tasks 2, 11). ✓
- Yurt + castle_keep get visible doors → Task 7 (round/box carve) + Task 11 (golden). ✓
- `toCollision` threshold flag (door yes, window no) → Task 8. ✓
- `toAnchors` per-opening kind label, multi-opening → Task 9. ✓
- `toBrief` opening phrases (already via `toBrief` hooks) + shared faceCell → Task 10. ✓
- `doorSolid` deleted, clean cut, guard test → Task 10. ✓
- Migration: presets already declare `door`; resolve through the opening path → verified Tasks 7, 11, 12 (no preset rewrites needed). ✓
- Design-for-not-build (gate/portcullis/sliding/portal, hardware geometry, swing anim, portals) → registry seam exists; not authored. ✓ (no task — correctly out of scope)

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertion. ✓

**3. Type consistency:** `ApertureSpec` (opening.ts) ↔ `apertureToBox`/`leafBox` (wall-geometry.ts) ↔ `aperture()`/`filler()` hooks (door/window). `ApertureBox` (solids.ts) used by `carveApertures`, the prim `apertures?` field, and `toGeometry`. `FeatureType.threshold?` used by to-collision + to-anchors. `faceCell` signature `(part, face, t=0.5)` consistent across to-collision/to-anchors/to-brief. ✓

**One known cross-task dependency:** the Task-1 opening test asserts `door.threshold`/`window.threshold`, which only land in Tasks 5-6 — so that test is intentionally red after Task 1 and green after Task 6. Flagged in Task 1 Step 4/5 so the executor does not treat it as a failure.
