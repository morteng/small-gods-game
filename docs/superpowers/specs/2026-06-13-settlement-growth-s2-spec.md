# Settlement growth S2 — lots, wards & named districts (spec)

**Date:** 2026-06-13 · **Status:** spec · **Slice of:** [settlement growth design](2026-06-13-settlement-growth-placement-design.md) · **Builds on:** S1 (`2026-06-13-settlement-plan-s1-spec.md`)

## Goal

Give the settlement plan its persistent medieval morphology: **burgage lots**
as the unit buildings claim (regular street spacing, yards behind), **wards**
as named entities for LLM prompts ("North Market"), the **market as a widened
main street** at the founding node, and the **wear-mask ground** so the
natural biome pokes through between back lots instead of hard-edged discs.

## Non-goals (later slices)

- Live growth during play / plan serialization into snapshots (S3).
- Mills/bridges/wells/graveyard constraint catalogue (S4).
- `grow_settlement` Fate capability + ward mutation in era-authoring (S5).
- NPC prompt-builder wiring of ward names (rides with a Track-2 touch; S2
  just makes the data exist on the plan).

## A. Burgage lots (`settlement-plan.ts`)

```ts
interface Lot {
  id: string;            // `lot:${roadX},${roadY}:${sx},${sy}` — first frontage tile + side
  edge: number;          // index into plan.edges
  side: [number, number];
  frontage: { x: number; y: number }[];  // 2–3 consecutive road tiles
  depth: number;         // 3–5 tiles back from the street
  tiles: { x: number; y: number }[];     // frontage × depth strip (excludes the road)
  buildingId?: string;   // claimed by the executor
}
```

- `subdivideLots(plan, tiles, seed)` walks each edge's tile run per side,
  grouping consecutive road tiles into lots. **Width and depth are keyed on
  `noise(firstRoadTile, seed)`** — order-independent, so lazily-reached lots
  (S3 growth, time-skip) subdivide identically regardless of when.
- Lot tiles must be in-bounds, non-water, off-road; tiles failing the check
  are dropped from the lot (a lot shrinks at water rather than vanishing).
- Lots on opposite sides of the same street never overlap by construction;
  lots at junctions may contest tiles — first edge (lowest index) wins, the
  later lot drops the contested tiles.

**Executor change (`building-placer.ts`):** slot claiming becomes lot
claiming. A building claims the best lot (same centre/edge affinity ordering,
via the lot's first-frontage slot) whose frontage is wide enough for the
footprint's along-road extent and whose tiles contain the footprint. One
building per lot (`buildingId` set) — regular spacing + back yards for free.
Footprints that fit NO lot (keep, barn 4×2) fall back to S1 slot alignment,
then the spiral.

## B. Wards (`settlement-plan.ts`)

```ts
interface Ward {
  id: string;
  name: string;          // "North Market", "Fisher Quarter", "Gate Row"
  type: 'market' | 'harbour' | 'temple' | 'gate' | 'residential' | 'craft';
  seed: { x: number; y: number };
  tiles: { x: number; y: number }[];
}
```

- `assignWards(plan, radius, tiles, seed)`: golden-spiral seed points
  (`r_i = radius·√(i/N)`, `θ_i = i·2.39996`, N ≈ max(3, ⌊radius·0.8⌋)) —
  dense centre → small central wards, the strongest medieval read. Per-tile
  nearest-seed over the non-water settlement disc.
- Type from a location rating: contains/nearest the founding node → `market`;
  has water within 2 tiles → `harbour`; contains a road `end` node →
  `gate`; otherwise alternate `residential`/`craft` by seeded pick.
- Name = compass bearing of the ward seed from the centre + a type-noun
  table ("Market", "Fisher Quarter", "Gate Row", "Crafts", "Rows"…), with
  the bearing dropped for the central ward ("The Market"). Names unique per
  settlement (dedupe with bearing, then ordinal).

`SettlementPlan` gains `lots: Lot[]`, `wards: Ward[]`, `market: {x,y}[]`.
`SettlementResult.plan` already flows to the caller; `map-generator` stamps
ward names onto the village record (`Village.wards?`) so prompts can reach
them later without re-deriving.

## C. Market = widened main street

At the founding node, widen the through street: the ±1-perpendicular
neighbours of the through-road tiles within ~2 tiles of the founding node
become road tiles (`plan.market`), carved with the settlement's road type.
Frontage beside the widened section is prime — `market_stall`/`tavern`
centre affinity already lands them there.

## D. Wear-mask ground (`src/world/settlement-wear.ts`, new)

`applySettlementWear(plan, tiles, world, seed, radius)` — called by
map-generator AFTER road tiles are applied, per settlement with a road plan:

1. Multi-source BFS from all road + market tiles, decay `wear = 1 − d/4`.
2. Per-tile threshold with seeded dither: `noise(x,y,seed)·0.3 − 0.15`
   jitters the cutoffs so edges are organic, never disc-shaped.
   - `wear > 0.62+j` and tile is soft ground (grass/scrubland/hills/glen/
     sacred_grove) → `dirt` (trampled), walkable.
   - `wear > 0.32+j` → cull vegetation entities on the tile (trees/bushes).
   - below → untouched biome pokes through between back lots.
3. Never touches water, roads, building footprints (`walkable === false`),
   or `farm_field` (fields ARE replaced ground, the near-full-wear case).

`terrainFill`/`clearForest` on `ZoneRule` are **dead config today** (defined,
never consumed) — delete them rather than port them.

## E. Versions & guards

- `WORLD_CONTENT_VERSION` → 4 (layouts change: lots, market widening, wear).
- All randomness through `Random`/`noise(x,y,seed)` — no `Math.random`
  (sim guard applies to worldgen-by-convention).

## Tests (`tests/unit/settlement-plan-s2.test.ts`)

- Lots: deterministic; coordinate-keyed (same lot dims regardless of walk
  order); no overlaps; tiles off-road/non-water; one building per lot after
  placement; buildings sit inside their claimed lot.
- Wards: non-water disc fully assigned; founding tile's ward is `market`;
  names unique; harbour ward exists when water is in radius; deterministic.
- Market: widened tiles adjacent to the through street near the founding
  node; absent for `roadLayout: 'none'`.
- Wear: trampled dirt beside roads; untouched ground at the disc edge;
  water/footprints/roads never mutated; vegetation culled in mid-wear;
  deterministic for fixed seed.
- Content version: 4.
