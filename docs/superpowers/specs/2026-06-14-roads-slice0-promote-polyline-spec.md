# Roads Slice 0 — promote the polyline to a first-class road graph (spec)

**Date:** 2026-06-14 · **Status:** BUILT 2026-06-15 (branch `feat/roads-linear-features`) ·
**Parent:** [roads & linear features brainstorm](2026-06-14-roads-linear-features-connectome-design.md)
(research-backed; see brainstorm §11)

## Implementation notes (2026-06-15 — as built)

- **New `src/world/road-graph.ts`** (pure types + `buildRoadGraph` / `rasterizeRoadGraph`
  / `applyRoadMask`). `GameMap.roadGraph?` added; persists free via the existing
  `structuredClone(state.map)` in `save-file.ts` — no save-schema field needed.
- **`map-generator.ts`**: the inline `carveConnections` was DELETED; worldgen now calls
  `buildRoadGraph(...)` and stores the returned graph on `map.roadGraph`.
- **Faithfulness key finding:** `walkRoad`'s cost only distinguishes water vs non-water.
  Two carves flip water-ness for *later* segments — bridging (`water → bridge`, now
  cheap) and river-carving (`land → river`, now water). So a later segment's least-cost
  path depends on earlier carves. `buildRoadGraph` therefore **interleaves walk-and-carve
  per segment** (records each edge, then carves it) — identical to the old loop. The
  pure `rasterizeRoadGraph`+`applyRoadMask` replay edges in the same order and reproduce
  the carve on a fresh grid (proven by a byte-identical round-trip test).
- **Gate 1 resolved → keep edges whole, NO junction splitting** (lowest risk; full
  proximity-snap is Slice 4). Byte-identical worldgen output confirmed (no golden drift).
- **Gate 2 resolved → single `class:'road'`** for every edge; hierarchy tiering is Slice 4.
- **Scope nuance (deliberate):** Slice 0 captures *all* connection-derived linear features —
  seed-authored roads, **rivers** (`feature:'river'`), and walls — so the rasterizer wholly
  owns `carveConnections` and is byte-identical *by construction* (no second inline path).
  Hydrology-*generated* rivers remain Slice 2.
- **`WORLD_CONTENT_VERSION` bumped 8 → 9** (and its pin in `content-version.test.ts`).
  Tile output is byte-identical so the bump isn't strictly required yet, but there are no
  players' worlds to preserve, so we bump now to keep the autosave schema honest (saves
  carry `roadGraph` going forward) rather than deferring it to Slice 1.
- **Tests:** `tests/unit/road-graph.test.ts` (9) — edge-per-pair, style/waypoint nodes,
  bridge capture, river carve, empty-graph, pure rasterize, **byte-identical derived carve**,
  **forced-bridge round-trip**, JSON-persistence round-trip. Full suite gate: see below.

## Goal

Stop **discarding** the road polyline. Today both road producers compute a path
then rasterize-and-drop it into the tile grid:

- inter-POI: `walkRoad()` A* (`src/terrain/road-walker.ts`) → `map-generator.ts`
  carves `dirt_road`/`stone_road` tiles → the `{cells, bridgeCells}` is **dropped**.
- intra-settlement: `SettlementPlan.edges[].tiles` (`src/world/settlement-plan.ts`)
  persist as tiles, but the **edge graph** is not the render/sim source of truth.

Slice 0 introduces a **world road graph** as the source of truth for inter-POI
roads, with the tile carving **derived** from it (the brainstorm's "vector is truth,
grid is a derived mask" — minimal first step). **No visual change**; this is the
de-risking refactor every later slice builds on.

Per the research (brainstorm §11): hierarchy lives as **type labels on graph
nodes/edges**, and a **waypoint** node rank is first-class. Slice 0 lands those
types so later slices (routing, rendering, hydrology) have a stable shape to fill.

## Non-goals (later slices)

- **Rendering** roads as ribbons (Slice 1 — fills `RenderGraph.edges()`, still empty here).
- **Rivers / hydrology** drainage graph (Slice 2).
- **WFC pre-collapse** / bidirectional tile constraints (Slice 3 — the experimental one).
- **POI connectivity topology** selection (MST/Steiner/growth) + full proximity-snap
  junction re-meshing (Slice 4). Slice 0 captures the road network worldgen *already*
  produces; it does not change which POIs connect or reroute anything.
- **Bridges as blueprints**, fords, z/walkZ (Slice 5).
- **Connectome Portal unification** — absorbing settlement `RoadEdge`s + world-scale
  Portal semantics (Slice 6). Slice 0 leaves `settlement-plan.ts` untouched.
- Heightfield carving / grade-cut (depends on Slice 5's z work).

## Design

### New module `src/world/road-graph.ts` (pure: POIs + paths in, graph + mask out)

```ts
type RoadClass = 'highway' | 'road' | 'track' | 'path';   // hierarchy = type label (§11.2)
type RoadNodeKind = 'poi' | 'junction' | 'waypoint' | 'end';

interface RoadNode { id: string; x: number; y: number; kind: RoadNodeKind;
                     poiRef?: string; }            // poiRef set when kind==='poi'
interface RoadEdge { id: string; a: string; b: string;   // node ids
                     polyline: { x: number; y: number }[];   // the SOURCE OF TRUTH
                     class: RoadClass;
                     bridgeCells?: number[]; }     // grid indices, from walkRoad
interface RoadGraph { nodes: RoadNode[]; edges: RoadEdge[]; }
```

- **Builder** `buildRoadGraph(pois, tiles, fields, rng): RoadGraph` — wraps the
  existing inter-POI connection pass. Where `map-generator` currently calls
  `walkRoad` to connect a POI pair, capture the result as a `RoadEdge` (polyline =
  `path.cells`, `bridgeCells` = `path.bridgeCells`) between two `kind:'poi'` nodes.
  `class` from POI importance (default `'road'`; Slice 4 introduces real
  highway/track tiering — Slice 0 may stamp a single class).
- **Junctions (minimal):** where two edges' polylines **share a tile**, insert one
  `kind:'junction'` node at that tile and split both edges (the research's
  proximity-snap, radius 0 = exact shared-tile in Slice 0). Full radius-based
  snapping + re-meshing is Slice 4. If this proves to perturb tile output, defer
  junction-splitting to Slice 4 and keep Slice 0 edges whole (decision gate below).
- **Waypoints:** the type exists and the builder may down-sample long polylines into
  a few waypoint control nodes, but Slice 0 is not required to populate them — it
  just must not preclude them. (Catmull-Rom through waypoints is Slice 1's concern.)

### Derived tile mask — invert the dependency

```ts
rasterizeRoadGraph(graph: RoadGraph, width, height): RoadMask
// RoadMask: which tiles are road (+ class) + which are bridges — a pure projection.
```

`map-generator` carves road tiles **from the mask** instead of inline during
`walkRoad`. The carving rules (tile types, bridge tiles, autotile hookup) are
unchanged — only their **input** changes (graph → mask → carve, vs path → carve).
Target: **byte-identical worldgen tile output** (the mask reproduces today's tiles
exactly). If exact reproduction forces awkward ordering, the fallback is "tiles may
differ; no map goldens block it" (as S1 accepted) — but byte-identical is the goal
and the strongest de-risk.

### Persistence + reconcile (determinism)

- Add `roadGraph?: RoadGraph` to `GameMap` (mirrors `settlementPlans`); include in
  `SaveFile.map`. The graph is the persisted truth; the mask is **always re-derived**,
  never stored.
- On load / after `restoreSnapshot`, re-run `rasterizeRoadGraph` to reproduce road
  tiles (mirrors `reconcileSettlementTiles`). Sim/replay only ever read the mask.
- Determinism: `roadGraph = f(seed, POIs)`; `mask = pure f(roadGraph)`. No
  `Math.random` (guard: `no-random-in-sim.test.ts` if any of this lands under `src/sim`;
  road-graph is `src/world`, but keep `rng`-threaded for parity).

### Render seam — unchanged

`RenderGraph.edges(region)` stays empty in Slice 0 (the `RenderEdge` shape already
exists). Slice 1 fills it from `roadGraph`. No `src/render/**` change here.

## Decision gates (resolve during implementation)

1. **Byte-identical tiles vs accepted drift.** Prefer byte-identical (worldgen +
   map goldens unchanged). If junction-splitting or graph-ordering perturbs tiles,
   either (a) defer junctions to Slice 4 and keep edges whole, or (b) accept drift
   and re-pin goldens with a note. Decide by running the suite, not by guessing.
2. **One class vs early tiering.** Slice 0 may stamp every edge `class:'road'` and
   leave real highway/track tiering to Slice 4, OR derive a coarse class from POI
   importance now. Lean: single class now (less surface), unless trivial.

## Acceptance

- New `src/world/road-graph.ts` + unit tests: graph builder produces one edge per
  connected POI pair; `bridgeCells` preserved; `rasterizeRoadGraph` is a pure
  function (same graph → same mask); round-trip persist→reconcile reproduces the mask.
- `GameMap.roadGraph` persisted + reconciled on load (round-trip test).
- **Worldgen tile output unchanged** (goldens green) OR re-pinned with rationale per
  gate 1.
- No `src/render/**` change; `RenderGraph.edges()` still empty.
- **Full `npm test` green on the roads branch before merge** (per the multi-checkout
  convergence hazard — this is the gate that catches a content-version/golden slip;
  do NOT merge on a partial run).

## Process / branch hygiene

- Build on a **dedicated branch `feat/roads-linear-features` off `main`** (not on the
  defensive-constructions checkout). Slice 0 touches `src/world/road-graph.ts` (new),
  `src/map/map-generator.ts`, `src/core/types.ts` (`GameMap`), save schema — disjoint
  from the DC/connectome lanes, but run the full suite before merging to main.
- Bump `WORLD_CONTENT_VERSION` if the save schema gains `roadGraph` (it does).
