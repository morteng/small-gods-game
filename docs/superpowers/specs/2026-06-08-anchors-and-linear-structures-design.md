# Anchors & Linear Structures — Design

> **Status:** approved design (2026-06-08). First slice of the **Parametric POI / Settlement Generation** epic.
> **Next:** implementation plan → subagent-driven execution.

## Epic framing (the layered architecture)

A god-game settlement is a hierarchy in which **every level shares one output contract: `params → geometry + footprint + anchors`.**

```
Settlement blueprint        terrain-aware: roads, zones, walls, bridges
  └─ Compound blueprints    tavern + sheds + yard + gate; market + stalls
       └─ Structures        building | wall-run | bridge | stall | well
            └─ params → geometry + footprint + anchors
```

The unifying primitive is the **typed anchor**: a connection point exposed in world coordinates. Connectivity across the whole hierarchy is anchor-matching — a road attaches to a `door`/`gate`, a wall joins at a `wall_end`, a bridge spans two `water_edge`s. The param objects ARE the LLM (Fate) control surface: an agent can specify loosely ("walled river-market town, ~40 buildings") or drill all the way down to one tavern's lateral chimney. Generation is a **deterministic, seeded ECS pass** matching the project's `Math.random`-free sim discipline, and is **lazy/hierarchical** (refine a compound when the player attends it).

Tracks (each independently playable, its own spec→plan→build):
- **G1 — Structures + anchor contract** *(this doc covers its first half)*: generalize the contract; add **linear structures** (walls/fences/ramparts/palisades/barricades). Bridges (spanning) follow.
- **G2 — Compound blueprints**: relational layout grammar (tavern + sheds + fence + gate).
- **G3 — Terrain-aware settlement**: road graph, zoning, bridges at river crossings, perimeter ramparts.
- **G4 — Castles & set-pieces**: bespoke blueprints, not the generic grammar.

This document specifies **G1's first slice: the anchor/connectivity contract + functional linear structures.**

## Goals & scope

**In scope (this slice):**
1. A world-space **anchor/connectivity contract** shared by buildings and linear structures.
2. **Linear structures** as one path-owning ECS entity: walls, fences, palisades, ramparts, barricades.
3. **Generated geometry** for linear structures via the existing assetgen/manifold pipeline (a new `linear` part).
4. **Functional barriers**: footprint indexed as `obstacle`, **gates are passable gaps**, A* routes through gates only.
5. **Interpret `WorldSeed Connection{type:'wall'}`** as authored wall runs (the dormant metadata starts working).
6. **In-game rendering** of barrier runs (parametric iso segment draw).
7. Deterministic (seeded), tested, with a visual preview sample.

**Out of scope (later slices/tracks):** bridges, compounds, settlement layout, terrain-aware road graphs, castle set-pieces, baking high-fidelity assetgen sprites per run at runtime, gate doors as animated objects.

**Success criterion:** in a live test world, a wall run with a gate renders, blocks pathfinding everywhere except the gate, and an NPC routes through the gate; a `Connection{type:'wall'}` in a seed produces such a run.

## Success criteria / non-goals

- Determinism: identical `(params, seed)` ⇒ identical geometry + placement. No `Math.random()` in generation.
- The anchor contract is reused by buildings (retrofit) and linear structures (new) — not a one-off.
- No pathfinding-core changes: gates work purely by which tiles the barrier indexes as `obstacle`.
- Non-goal: interior walkability, multi-storey, animated gates, LOS/visibility blocking (future).

## Architecture & components

### 1. Anchor/connectivity contract — `src/world/anchors.ts` (new)

```ts
export type AnchorKind = 'door' | 'gate' | 'road' | 'wall_end' | 'water_edge' | 'frontage' | 'service';
export interface Anchor {
  kind: AnchorKind;
  x: number; y: number;        // WORLD tile coords (fractional ok)
  facing: [number, number];    // outward UNIT vector (no Dir8 enum exists; a vector composes with geometry/matching)
  width?: number;              // opening width in tiles (door/gate)
  main?: boolean;
}
```
(`facing` is a unit vector, not a `Dir8` — the codebase only has a 4-way `Direction` for NPCs; a vector is what anchor-matching and the iso draw actually need.)

- Stored on `entity.properties.anchors: Anchor[]`.
- Helpers: `buildingAnchors(descriptor, originX, originY): Anchor[]` (maps the descriptor's `door {x,y}` + `vents[]` to world anchors with outward `facing` derived from which footprint edge the cell sits on); `nearestAnchor(anchors, kind, x, y)`; `outwardFacing(cell, footprint)`.
- **Buildings retrofit:** at building placement, compute and store `properties.anchors` via `buildingAnchors`. (Door/vents already exist on the descriptor; this is additive, no behaviour change.)

This contract is the shared seam; linear structures and every future layer emit/consume `Anchor[]`.

### 2. Linear structure data model — `src/world/barrier.ts` (new)

```ts
export type BarrierKind = 'wall' | 'fence' | 'palisade' | 'rampart' | 'barricade';
export interface BarrierGate { t: number; width: number }   // t = distance along the path, in tiles
export interface BarrierRun {
  kind: BarrierKind;
  path: [number, number][];     // polyline corner points, tile coords (>= 2 points)
  height: number;               // height-units
  thickness: number;            // tiles (default per kind)
  material: string;             // open registry ('stone'/'timber'/'earth'/…); assetgen + iso map to a colour, neutral fallback (no world→assetgen type coupling)
  crenellated?: boolean;        // ramparts / castle walls
  posts?: boolean;              // fence/palisade posts at corners
  gates: BarrierGate[];
}
export const BARRIER_DEFAULTS: Record<BarrierKind, { height; thickness; material; crenellated?; posts? }>;
export function barrierFootprintTiles(run: BarrierRun): { blocking: [number,number][]; gate: [number,number][] };
```

- `barrierFootprintTiles` rasterizes the polyline at `thickness` into tile cells, split into **blocking** vs **gate-gap** cells (a cell within a gate's span along the path is a gate cell).
- One ECS entity: `kind: '<barrierKind>_run'` (e.g. `wall_run`), `properties.barrier: BarrierRun`, `properties.anchors: Anchor[]` (a `wall_end` at each path endpoint + a `gate` at each gate centre), `x,y` = path centroid, `tags: ['barrier','obstacle','settlement']`.

### 3. Geometry — assetgen `linear` part

- `src/assetgen/geometry/linear.ts` (types kept minimal; geometry in `solids.ts`): `linearFacets(run): Promise<{ facets: WorldFacet[]; anchors: BuildingAnchors-like }>`.
  - Per path segment: a box solid `length × thickness × height`, rotated to the segment angle (manifold `rotate`), unioned.
  - **Gate** = boolean-subtract a `width × thickness × (height+ε)` box at the gate centre → clean opening.
  - **Crenellated**: union a row of merlon boxes spaced along the top edge.
  - **Posts**: corner boxes (taller/own material) when `posts`.
  - Anchors: `wall_end` at each endpoint (facing outward along the path), `gate` at each gate centre (facing perpendicular).
- `compose.ts`: new `Part` variant `{ prim: 'linear'; run: BarrierRun }` → `partFacets` calls `linearFacets`; anchors flow through the existing normalize path.
- Reuses `solidBox`, manifold union/subtract, projection/raster/fit — appears in the preview gallery.

### 4. ECS + collision + gates

- Placement helper `placeBarrier(world, run, rng): EntityId` — creates the entity, computes `barrierFootprintTiles`, and **indexes only the `blocking` cells** on the registry tile index (gate cells left clear). Stores anchors.
- A* (`src/sim/pathfinding.ts`) already blocks on `obstacle`-tagged entities found via the tile index; because gate cells aren't indexed, they're walkable. **No pathfinding change.**
- `wireGateToRoad(gate: Anchor, tiles): void` — cut a Bresenham door-path from the gate to the nearest road tile (reuse `building-placer`'s carve). Demonstrated in the test world.

### 5. `Connection{type:'wall'}` interpretation

- `src/map/map-generator.ts` already runs `carveConnections(tiles, connections, pois, fields)` (line ~284) for roads/rivers but ignores `type:'wall'`. Add a sibling pass that turns each `type:'wall'` connection into a `BarrierRun` (path = connection endpoints, straight polyline for now; terrain-following deferred to G3) and emits it via `placeBarrier`. Entity emission may need threading `world`/registry into this stage (today it returns tiles); the plan resolves the exact seam.

### 6. Rendering

- In-game **parametric iso segment draw** for `*_run` entities — a new `src/render/iso/iso-barrier.ts` alongside the existing `iso-building.ts`, registered in `iso-renderer.ts` and keyed off `entity.kind` ending `_run` (or the `barrier` tag). Draw each path segment as an iso wall quad of `height`, with crenellation notches and gate gaps. Drawable in a live test world without baking sprites.
- The high-fidelity assetgen sprite path (§3) remains available from the same `BarrierRun` for author-time / the future normal-lit renderer — not used at runtime in this slice.

### 7. Determinism & testing

- All placement uses the passed seeded `rng`; manifold geometry is deterministic (pinned segments).
- Tests:
  - `anchors`: `buildingAnchors` maps a descriptor door to the correct world tile + outward facing.
  - `barrier`: `barrierFootprintTiles` rasterizes a diagonal polyline; gate cells excluded from blocking.
  - `linear geometry`: `linearFacets` emits a gate opening (a hole) and `wall_end`/`gate` anchors; crenellation raises max-z.
  - **gate passability**: in a test world, A* routes through the gate and is blocked across the rest of the run.
  - `Connection{wall}` → a `wall_run` entity with the expected path.
  - preview sample (palisade-with-gate, crenellated rampart corner) for visual confirmation.

## Data flow

```
WorldSeed.connections[type=wall]  ─┐
LLM/blueprint params              ─┼─► BarrierRun ─► placeBarrier(world,rng)
authoring/test fixtures           ─┘                   │  ├─ entity (kind:'*_run', properties.barrier+anchors)
                                                        │  ├─ index BLOCKING footprint tiles as obstacle
                                                        │  └─ gate cells left walkable
                            assetgen compose ◄── linearFacets(run)  (author-time sprite / preview)
                            iso renderer     ◄── parametric segment draw (runtime)
                            A* pathfinding   ◄── obstacle tile index (gates pass through)
```

## Risks & mitigations

- **Diagonal-segment geometry** (rotated boxes / mitred corners): keep corners simple (overlapping unioned boxes; manifold union resolves the joint) — same trick that fixed the roof valley.
- **Gate-cell rasterization off-by-one** (gap too wide/narrow): unit-test the blocking/gate split on a known polyline.
- **Scope creep into compounds/settlement**: this slice stops at single runs + the contract + `Connection{wall}`. Compounds are G2.

## Open follow-ups (explicitly deferred)

Bridges (spanning structures), terrain-following wall paths, gate doors as objects, LOS/visibility blocking, baking runtime sprites, compound/settlement layers.
