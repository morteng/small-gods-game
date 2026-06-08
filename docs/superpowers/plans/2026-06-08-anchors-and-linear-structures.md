# Anchors & Linear Structures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A world-space anchor/connectivity contract + functional linear structures (walls/fences/ramparts/palisades/barricades) as one path-owning ECS entity, with gates as passable gaps.

**Architecture:** New `src/world/anchors.ts` (typed connection points) and `src/world/barrier.ts` (path-owning run model + tile rasterization). Geometry via a new assetgen `linear` part (`src/assetgen/geometry/linear.ts`, reusing manifold solids). Placement indexes only blocking tiles as `obstacle` so A* routes through gate gaps unchanged. `Connection{type:'wall'}` is interpreted in `map-generator.ts`. Runtime draw via `src/render/iso/iso-barrier.ts`.

**Tech Stack:** TypeScript ESM, Vitest, manifold-3d (assetgen), existing entity registry + A* pathfinding.

Spec: `docs/superpowers/specs/2026-06-08-anchors-and-linear-structures-design.md`.

---

### Task 1: Anchor contract module

**Files:**
- Create: `src/world/anchors.ts`
- Test: `tests/unit/anchors.test.ts`

- [ ] **Step 1: Failing test** — `tests/unit/anchors.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { outwardFacing, buildingAnchors } from '@/world/anchors';

describe('anchors', () => {
  it('outwardFacing points away from the footprint for an edge cell', () => {
    // 3x3 footprint; door at the south edge (y=2) → faces +y (south, [0,1])
    expect(outwardFacing([1, 2], { w: 3, h: 3 })).toEqual([0, 1]);
    expect(outwardFacing([0, 1], { w: 3, h: 3 })).toEqual([-1, 0]); // west edge
  });

  it('buildingAnchors maps a descriptor door to a world tile + outward facing', () => {
    const desc = { footprint: { w: 3, h: 3 }, door: { x: 1, y: 2 }, vents: [{ x: 1, y: 1, height: 1, kind: 'chimney' as const }] };
    const a = buildingAnchors(desc, 10, 20);
    const door = a.find(an => an.kind === 'door')!;
    expect(door.x).toBeCloseTo(11.5); // originX + door.x + 0.5
    expect(door.y).toBeCloseTo(23);   // south edge: originY + door.y + 1
    expect(door.facing).toEqual([0, 1]);
    expect(a.some(an => an.kind === 'service')).toBe(false); // vents are not anchors here
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/anchors.test.ts`
- [ ] **Step 3: Implement** — `src/world/anchors.ts`

```ts
// src/world/anchors.ts
export type AnchorKind = 'door' | 'gate' | 'road' | 'wall_end' | 'water_edge' | 'frontage' | 'service';
export interface Anchor {
  kind: AnchorKind;
  x: number; y: number;          // world tile coords (fractional ok)
  facing: [number, number];      // outward unit vector
  width?: number;
  main?: boolean;
}

/** Outward unit vector for a footprint-relative cell: the nearest footprint edge it touches. */
export function outwardFacing([cx, cy]: [number, number], fp: { w: number; h: number }): [number, number] {
  const dN = cy, dS = fp.h - 1 - cy, dW = cx, dE = fp.w - 1 - cx;
  const m = Math.min(dN, dS, dW, dE);
  if (m === dS) return [0, 1];
  if (m === dE) return [1, 0];
  if (m === dN) return [0, -1];
  return [-1, 0];
}

interface DescriptorLike { footprint: { w: number; h: number }; door: { x: number; y: number } }

/** World-space door anchor(s) for a placed building (origin = footprint top-left in world tiles). */
export function buildingAnchors(desc: DescriptorLike, originX: number, originY: number): Anchor[] {
  const f = outwardFacing([desc.door.x, desc.door.y], desc.footprint);
  // threshold sits on the outward edge of the door cell
  const x = originX + desc.door.x + (f[0] > 0 ? 1 : f[0] < 0 ? 0 : 0.5);
  const y = originY + desc.door.y + (f[1] > 0 ? 1 : f[1] < 0 ? 0 : 0.5);
  return [{ kind: 'door', x, y, facing: f, main: true }];
}

/** Nearest anchor of a kind to a point, or undefined. */
export function nearestAnchor(anchors: Anchor[], kind: AnchorKind, x: number, y: number): Anchor | undefined {
  let best: Anchor | undefined, bd = Infinity;
  for (const a of anchors) {
    if (a.kind !== kind) continue;
    const d = (a.x - x) ** 2 + (a.y - y) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
```

- [ ] **Step 4: Pass** — `npx vitest run tests/unit/anchors.test.ts` → PASS
- [ ] **Step 5: Commit** — `git add src/world/anchors.ts tests/unit/anchors.test.ts && git commit -m "feat(world): world-space anchor/connectivity contract"`

---

### Task 2: Retrofit building placement to store anchors

**Files:**
- Modify: `src/world/building-placer.ts` (where a building entity is created from a descriptor — locate the entity-construction site)
- Test: `tests/unit/building-anchors.test.ts`

- [ ] **Step 1: Failing test** — assert a building entity created by the placer carries `properties.anchors` with a `door` anchor in world coords. (Mirror an existing building-placer test's setup; query the created entity and check `entity.properties.anchors`.)
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — at the building entity construction, set `properties.anchors = buildingAnchors(descriptor, originX, originY)`. Origin = the world tile of the footprint's top-left used at placement. Additive only; no other behaviour changes.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(world): buildings emit world-space door anchors"`

---

### Task 3: Barrier data model + tile rasterization

**Files:**
- Create: `src/world/barrier.ts`
- Test: `tests/unit/barrier.test.ts`

- [ ] **Step 1: Failing test** — `tests/unit/barrier.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { barrierFootprintTiles, type BarrierRun } from '@/world/barrier';

const run = (over: Partial<BarrierRun> = {}): BarrierRun => ({
  kind: 'wall', path: [[0, 0], [4, 0]], height: 3, thickness: 1, material: 'stone', gates: [], ...over,
});

describe('barrierFootprintTiles', () => {
  it('rasterizes a straight horizontal run into contiguous blocking cells', () => {
    const { blocking, gate } = barrierFootprintTiles(run());
    expect(gate).toHaveLength(0);
    expect(blocking).toEqual(expect.arrayContaining([[0, 0], [1, 0], [2, 0], [3, 0]]));
  });

  it('excludes gate-span cells from blocking and reports them as gate cells', () => {
    const { blocking, gate } = barrierFootprintTiles(run({ gates: [{ t: 2, width: 1 }] }));
    // the gate at distance t=2 carves out the cell around x=2
    expect(blocking.some(([x]) => x === 2)).toBe(false);
    expect(gate.some(([x]) => x === 2)).toBe(true);
  });

  it('rasterizes a diagonal run', () => {
    const { blocking } = barrierFootprintTiles(run({ path: [[0, 0], [3, 3]] }));
    expect(blocking).toEqual(expect.arrayContaining([[0, 0], [1, 1], [2, 2]]));
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `src/world/barrier.ts`

```ts
// src/world/barrier.ts
export type BarrierKind = 'wall' | 'fence' | 'palisade' | 'rampart' | 'barricade';
export interface BarrierGate { t: number; width: number }   // t = tiles along the path
export interface BarrierRun {
  kind: BarrierKind;
  path: [number, number][];
  height: number; thickness: number; material: string;
  crenellated?: boolean; posts?: boolean;
  gates: BarrierGate[];
}

export const BARRIER_DEFAULTS: Record<BarrierKind, Omit<BarrierRun, 'kind' | 'path' | 'gates'>> = {
  wall:      { height: 3.0, thickness: 1, material: 'stone',  crenellated: false },
  rampart:   { height: 3.5, thickness: 2, material: 'stone',  crenellated: true },
  palisade:  { height: 2.6, thickness: 1, material: 'timber', posts: true },
  fence:     { height: 1.1, thickness: 1, material: 'timber', posts: true },
  barricade: { height: 1.4, thickness: 1, material: 'timber' },
};

/** Cumulative segment lengths, so a path distance `t` maps to a world point. */
function pointAt(path: [number, number][], t: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return [ax + (bx - ax) * u, ay + (by - ay) * u]; }
    acc += len;
  }
  return path[path.length - 1];
}
function pathLength(path: [number, number][]): number {
  let s = 0; for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i-1][0], path[i][1] - path[i-1][1]);
  return s;
}

/** Rasterize the polyline at `thickness` into tile cells, split blocking vs gate-gap. */
export function barrierFootprintTiles(run: BarrierRun): { blocking: [number, number][]; gate: [number, number][] } {
  const cells = new Map<string, [number, number]>();
  const gateCells = new Set<string>();
  const r = Math.max(0, (run.thickness - 1) / 2);
  // mark gate cells first
  for (const g of run.gates) {
    const half = g.width / 2;
    for (let t = Math.max(0, g.t - half); t <= g.t + half; t += 0.34) {
      const [px, py] = pointAt(run.path, t);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) gateCells.add(`${Math.round(px) + dx},${Math.round(py) + dy}`);
    }
  }
  // walk the whole path
  const total = pathLength(run.path);
  for (let t = 0; t <= total; t += 0.34) {
    const [px, py] = pointAt(run.path, t);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const cx = Math.round(px) + dx, cy = Math.round(py) + dy, k = `${cx},${cy}`;
      if (!gateCells.has(k)) cells.set(k, [cx, cy]);
    }
  }
  const gate = [...gateCells].map(k => k.split(',').map(Number) as [number, number]);
  return { blocking: [...cells.values()], gate };
}
```

- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(world): BarrierRun model + polyline footprint rasterization"`

---

### Task 4: assetgen `linear` geometry

**Files:**
- Create: `src/assetgen/geometry/linear.ts`
- Modify: `src/assetgen/geometry/solids.ts` (add `linearFacets`), `src/assetgen/compose.ts` (add `{ prim: 'linear' }` Part)
- Test: `tests/unit/assetgen-linear.test.ts`

- [ ] **Step 1: Failing test** — assert `linearFacets` for a straight run with one gate: emits facets, exposes `wall_end` ×2 anchors + `gate` ×1; a crenellated run reaches a higher max-z than a plain one; a gated run has lower wall volume than an ungated one (the gap was subtracted).

```ts
import { describe, it, expect } from 'vitest';
import { linearFacets } from '@/assetgen/geometry/linear';
import type { BarrierRun } from '@/world/barrier';

const base: BarrierRun = { kind: 'wall', path: [[0,0],[4,0]], height: 3, thickness: 1, material: 'stone', gates: [] };

describe('linearFacets', () => {
  it('emits facets + wall_end anchors at both ends', async () => {
    const { facets, anchors } = await linearFacets(base);
    expect(facets.length).toBeGreaterThan(0);
    expect(anchors.wallEnds).toHaveLength(2);
  });
  it('a gate adds a gate anchor and removes wall material there', async () => {
    const solid = await linearFacets({ ...base, gates: [{ t: 2, width: 1 }] });
    expect(solid.anchors.gates).toHaveLength(1);
    expect(solid.volume).toBeLessThan((await linearFacets(base)).volume);
  });
  it('crenellation raises the roofline', async () => {
    const plain = await linearFacets(base);
    const cren = await linearFacets({ ...base, crenellated: true });
    const maxZ = (r: { facets: { pts: number[][] }[] }) => Math.max(...r.facets.flatMap(f => f.pts.map(p => p[2])));
    expect(maxZ(cren)).toBeGreaterThanOrEqual(maxZ(plain));
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `linearFacets(run)`: build a box per segment (length×thickness×height) rotated to the segment's world angle via manifold `rotate`, union them; for each gate `subtract` a `width×(thickness+ε)×(height+ε)` box at `pointAt(path,t)`; if `crenellated`, union merlon boxes stepped along the top; if `posts`, union corner posts. Return `{ facets: manifoldToFacets(mesh,'stone'-mapped-material), anchors: { wallEnds: [...], gates: [...] }, volume }`. Map `run.material` string → assetgen `Mat` with a neutral fallback (a small `MATERIAL_BY_NAME` lookup; default `'stone'`). Add `{ prim: 'linear'; run: BarrierRun }` to `compose.ts` `Part` and route `partFacets` → `linearFacets`, flowing its anchors through the existing normalize path (treat `wallEnds`/`gates` as additional normalized anchor lists on `StructureAnchors`, or fold into `vents`/`doors` — keep a dedicated `walls`/`gates` list).
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(assetgen): linear structure geometry (segments, gates, crenellation, posts)"`

---

### Task 5: placeBarrier + ECS indexing + gate passability

**Files:**
- Create: `src/world/place-barrier.ts`
- Test: `tests/unit/place-barrier.test.ts` (integration with World + pathfinding)

- [ ] **Step 1: Failing test** — build a small World, `placeBarrier` a straight wall with a gate across a corridor; assert (a) an entity `kind:'wall_run'` exists tagged `obstacle`; (b) `registry.getAtTile` returns it on blocking cells but NOT on the gate cell; (c) A* from one side to the other returns a path that passes through the gate cell, and A* with the gate removed (full wall) returns no path.

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { placeBarrier } from '@/world/place-barrier';
import { findPath } from '@/sim/pathfinding';
import { makeRng } from '@/core/rng';
// ...build a walkable test grid, place a wall y=2 across x=0..4 with a gate at x=2...
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `placeBarrier(world, run, rng)`: create entity `{ kind: `${run.kind}_run`, x: centroid.x, y: centroid.y, tags: ['barrier','obstacle','settlement'], properties: { barrier: run, anchors } }`; `anchors` = `wall_end` at each path end (facing outward along the path) + `gate` at each gate centre (facing perpendicular). Compute `barrierFootprintTiles`, and index ONLY `blocking` cells on the registry tile index (use the same per-tile indexing buildings use; gate cells are not indexed). Return the entity id. Verify A* (which checks the `obstacle` tag via the tile index) routes through the unindexed gate cell.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(world): placeBarrier — functional barriers with passable gates"`

---

### Task 6: wireGateToRoad helper

**Files:**
- Create: `src/world/wire-gate.ts` (or co-locate in `place-barrier.ts`)
- Test: `tests/unit/wire-gate.test.ts`

- [ ] **Step 1: Failing test** — given a tile grid with a road tile and a gate anchor, `wireGateToRoad` carves a contiguous road/path of tiles from the gate to the nearest road cell.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — find nearest road tile to the gate anchor; Bresenham a door-path (reuse the carve logic from `building-placer`, extracting a shared helper if needed) setting intermediate tiles to a path/dirt-road type.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(world): wire a barrier gate to the nearest road"`

---

### Task 7: Interpret `Connection{type:'wall'}`

**Files:**
- Modify: `src/map/map-generator.ts` (sibling to `carveConnections`), thread `world`/registry to the stage as needed
- Test: `tests/unit/wall-connection.test.ts`

- [ ] **Step 1: Failing test** — a `WorldSeed` with a `connections: [{ from, to, type: 'wall' }]` produces, after generation, a `wall_run` entity whose `path` matches the two endpoints.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — add `placeWallConnections(connections, pois, world, rng)` called where `carveConnections` runs; for each `type:'wall'` connection, build a `BarrierRun` (`kind:'wall'`, `path = [fromPoint, toPoint]`, defaults from `BARRIER_DEFAULTS`, no gates by default) and `placeBarrier`. Straight polyline only (terrain-following deferred).
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(worldgen): interpret Connection{type:'wall'} as wall runs"`

---

### Task 8: iso renderer for barriers

**Files:**
- Create: `src/render/iso/iso-barrier.ts`
- Modify: `src/render/iso/iso-renderer.ts` (dispatch `*_run` / `barrier`-tagged entities)
- Test: `tests/unit/iso-barrier.test.ts` (smoke: draw to a stub ctx without throwing; correct number of segment draws)

- [ ] **Step 1: Failing test** — calling the barrier draw with a 2-segment run on a mock CanvasRenderingContext2D issues fill calls and does not throw; a gate span leaves a gap (fewer wall quads than an ungated run of the same length).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `drawIsoBarrier(ctx, entity, camera)`: for each path segment, draw an iso wall quad of `height` (project tile→screen with the existing iso transform), skip gate spans, draw crenellation notches when `crenellated`, posts at corners when `posts`. Material string → colour via a small map with neutral fallback. Register in `iso-renderer.ts` keyed off `kind.endsWith('_run')` or the `barrier` tag.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(render): iso draw for linear barrier runs"`

---

### Task 9: preview sample + visual confirmation

**Files:**
- Modify: `scripts/assetgen-preview.ts` (add `linear` samples)

- [ ] **Step 1:** add samples — `palisade_gate` (`{ prim:'linear', run: { kind:'palisade', path:[[0,0],[5,0]], height:2.6, thickness:1, material:'timber', posts:true, gates:[{t:2.5,width:1.2}] } }`) and `rampart_corner` (`{ kind:'rampart', path:[[0,0],[4,0],[4,4]], height:3.5, thickness:2, material:'stone', crenellated:true, gates:[] }`).
- [ ] **Step 2:** run `npx tsx scripts/assetgen-preview.ts`; confirm the renders show a gated palisade and a crenellated L-corner rampart (clean mitred corner, gate gap).
- [ ] **Step 3: Commit** — `git commit -m "chore(assetgen): linear structure preview samples"`

---

## Self-review notes

- Types consistent across tasks: `BarrierRun` (Task 3) is consumed by `linearFacets` (4), `placeBarrier` (5), `iso-barrier` (8), preview (9). `Anchor` (1) is emitted by buildings (2) and barriers (5).
- Determinism: every placement takes the seeded `rng`; manifold geometry is deterministic.
- No pathfinding-core change — gates work purely via which tiles get the `obstacle` index (Task 5).
- Gate rasterization (Task 3) and gate geometry (Task 4) are tested independently before integration (Task 5).
