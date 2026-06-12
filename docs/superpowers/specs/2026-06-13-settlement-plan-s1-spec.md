# Settlement growth S1 — plan/execute placement with road frontage (spec)

**Date:** 2026-06-13 · **Status:** approved for implementation ("ok do it") ·
**Parent:** [settlement growth brainstorm](2026-06-13-settlement-growth-placement-design.md)

## Goal

Refactor worldgen settlement layout from "scatter near the road with random
offsets" into an explicit **plan → execute** split, so that:

1. Buildings claim **frontage slots** along road edges and their **doors face
   the road** (door cell adjacent to a road tile, facing it).
2. Per-type **site rules** are enforced — docks REQUIRE water adjacency
   (today's `adjacencyRequirement` is silently ignored), taverns/temples
   prefer the centre, barns prefer the edge.
3. The **road graph survives** as a data structure (`SettlementPlan`) the
   future growth slices (S2 live growth, S3 constraints) can extend.

Same visual class of output otherwise. Worldgen layouts will differ from
current seeds (rng consumption changes) — acceptable; no layout goldens exist.

## Non-goals (later slices)

- Live/iterative growth during play (S2/S3).
- New constraint catalogue beyond water/centre/edge (S4: mills, bridges, wells).
- Door-face patching or multi-view facing art — S1 picks the SIDE of the road
  that matches the preset's existing door face.
- Serialization of the plan into saves (needed only when growth goes live).

## Design

New module `src/world/settlement-plan.ts` (pure: tiles + rng in, data out):

```ts
interface RoadNode { id; x; y; kind: 'founding'|'junction'|'end' }
interface RoadEdge { a; b; tiles: {x,y}[]; kind: 'through'|'lane' }
interface FrontageSlot {
  roadX; roadY;              // the road tile this slot fronts
  side: [number, number];    // unit vector road → building side
  edge: number;              // index into plan.edges
  dist: number;              // tile distance from the founding node
}
interface SettlementPlan { center; nodes; edges; slots }

planSettlement(center, zoneRule, tiles, connectedDirections, rng): SettlementPlan
```

- Road graph from the zone rule's layout: `linear` = one through edge;
  `branching` = through + 2 perpendicular branch lanes at the midpoint
  junction; `grid` (city — currently falls through to linear, now real) =
  through + one parallel lane each side at offset 3 + 2 cross connectors.
  Road tiles never on water (existing rule).
- Slots: every road tile contributes its two perpendicular neighbours as
  candidate slots, ordered centre-out (`dist`).

Site rules (`SITE_RULES: Record<presetName, SiteRule>`):

```ts
interface SiteRule { nearWater?: number; affinity?: 'center'|'edge' }
// dock: { nearWater: 2 }  tavern/temple_small/shrine: { affinity: 'center' }
// farm_barn/longhouse: { affinity: 'edge' }
```

Execution (rewrite inside `placeSettlement`, public contract unchanged plus
optional `plan` on the result):

1. For each roster preset: synthesize the blueprint, get the main door's
   local cell (`toCollision(rb).doorCells[0]`) and facing
   (`toAnchors(rb,0,0)` main anchor).
2. Iterate slots whose `side === −facing` (door will look at the road),
   ordered by site-rule affinity (centre-affine ascending `dist`, edge-affine
   descending) with a small seeded jitter; place the footprint so the door
   cell lands ON the slot's building-side neighbour tile of `roadX,roadY`.
3. Fit check = terrain + occupancy (existing helpers) + footprint does not
   cover any road tile + hard `nearWater` if ruled.
4. No slot fits → fall back to today's spiral `findPlacement` (now WITH
   `nearWater` from the site rule, fixing the dock hole).
5. Door path carving shrinks: the door is adjacent to a road by construction
   (fallback placements keep the short Bresenham connector).

## Acceptance

- Unit: graph shape per layout; no road tiles on water; slot sides
  perpendicular; deterministic (same seed ⇒ identical plan).
- Unit: placed buildings' door cells are adjacent to a road tile and the
  door faces it (for slot placements); docks within 2 tiles of water or
  absent; no footprint/road overlap; entities deterministic per seed.
- Whole suite green; in-game eyeball: village reads as a street with doors
  on it, not a scatter.
