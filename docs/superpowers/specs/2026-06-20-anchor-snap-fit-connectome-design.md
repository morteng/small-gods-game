# Anchor Snap-Fit Connectome — Design

**Status:** building (2026-06-20). Branch `feat/anchor-snap-connectome`.
**Relates:** [[project-skirt-and-affordance-graph]], [[project-spatial-coordination-epic]],
[[project-unified-world-connectome]], [[project-roads-linear-features]].

## Thesis

Every connection between world features today is a **bespoke alignment routine**: door-on-road
lives in `building-placer.ts`, bridge-on-bank in `detect-crossings.ts`, gate-on-wall in
`barrier.ts`. They all compute the same thing — "a point with an outward direction on feature A
should meet a compatible point on feature B, facings opposed, within reach, on free ground."

Promote that to **one primitive and one rule set**. Every producer emits typed **anchors**
(point + outward tangent + kind/tags); a pure **matcher** pairs compatible anchors into
**links**; the link set is a derived layer on `GameMap`, an input to the road approach geometry,
and the resolution target for authoring/Fate verbs.

This is the same idea as the [roads article](https://sandboxspirit.com/blog/simple-geometry-of-roads/):
*control info is profiles (point + tangent); geometry is the derived result.* An anchor **is** a
profile. The article's line→arc fillet is exactly how a road should arrive at an anchor tangentially.

## The Anchor (extends `src/world/anchors.ts`)

```
Anchor {
  kind: 'door'|'gate'|'road'|'wall_end'|'water_edge'|'frontage'|'service'|'bank'
  x, y: number            // world tile coords (fractional ok)
  facing: [number,number] // outward unit vector (perpendicular to the feature edge)
  width?: number          // opening / deck width in tiles
  main?: boolean          // principal vs auxiliary
  id?: string             // stable, deterministic (owner-derived)
  ownerId?: string        // emitting feature: building entity id, road edge id, …
  tags?: string[]         // free, e.g. 'approach', 'street', 'fortified'
}
```

Additive only — all new fields optional, existing `buildingAnchors`/`toAnchors`/`nearestAnchor`
keep working byte-identically.

## Snap rules (`src/world/anchor-rules.ts`)

A **rule** says which kinds attract, the max gap, and the facing relationship required:

```
SnapRule { a: AnchorKind; b: AnchorKind; maxGap: number; facing: 'oppose'|'toward'|'any'; relation }
```

`facing` modes: `oppose` ⇒ `dot(fa,fb) < -COS_TOL` (two doorways meeting); `toward` ⇒ the source
anchor's facing points at the partner (used for X→road, whose own normal is ambiguous — so road
anchors needn't carry a meaningful facing); `any` ⇒ no facing constraint. `b: 'road'` is special:
the partner is matched against the road **polylines**, snapping to the nearest point on the curve
(a road is a curve, not a point — this is the honest door-on-road test). Default table:

| a | b | maxGap (tiles) | facing | relation |
|---|---|---|---|---|
| door | road | 1.6 | toward | connects |
| frontage | road | 1.6 | toward | connects |
| gate | road | 2.0 | toward | connects |
| service | road | 2.2 | toward | serves |
| wall_end | wall_end | 1.0 | any | connects |

Bank anchors are emitted (overlay/resolver) but paired at the crossing source, not rediscovered by
the matcher. Rules are data so Fate / future families can extend the table.

## The matcher (`matchAnchors`)

Pure, deterministic. Given `Anchor[]` + `SnapRule[]` (+ optional `OccupancyGrid` to reject links
whose midpoint is blocked by an unrelated occupant):

1. For each rule, gather candidate (a,b) pairs of the rule's kinds.
2. Keep pairs within `maxGap` and (if required) facing-opposed.
3. Score by gap (smaller = better), tie-break by `(ownerId, id)` lexicographic — **stable, no
   `Math.random`, no iteration-order dependence**.
4. Greedy-assign best-first; each anchor links at most once per relation kind (a door snaps to one
   road, not five). Emit `AnchorLink { a, b, relation, gap }`.

Determinism is a hard requirement (`tests/unit/no-random-in-sim.test.ts` guards `src/sim`; this
lives in `src/world` but follows the same discipline and is covered by a same-seed test).

## Emission & wiring

- **Buildings** already emit door/gate anchors (`blueprintEntity` → `entity.properties.anchors`).
  Add a `frontage` anchor on the door-side footprint edge for buildings whose door faces a lane.
- **Roads** (`road-graph.ts`): each `RoadEdge` endpoint becomes a `road` anchor; `facing` = the
  unit tangent of the first/last polyline segment. `ownerId` = edge id.
- **Barriers** (`barrier.ts`): each `BarrierGate` becomes a `gate` anchor at `pointAt(path, g.t)`,
  facing = path normal; run endpoints become `wall_end` anchors.
- **Crossings** (`detect-crossings.ts`): the two `banks` become `bank` anchors facing inward.

`collectAnchors(map, world)` gathers all of them; `map.anchors` + `map.anchorLinks` are new
optional `GameMap` fields, populated in `map-generator.ts` after roads/crossings. **Data only —
no geometry/tile mutation, so worldgen output and golden hashes are unchanged.**

## Fillet approach (`src/world/anchor-fillet.ts`) — the article's contribution

Pure `fillet(p0, t0, p1, t1)` → polyline: a straight run off `p0` along `t0`, a single tangent
arc, arriving at `p1` along `t1` (two-line fillet with one tangent point fixed). S-curve fallback:
insert a Hermite midpoint at t=0.5 and solve two sub-fillets. Used to smooth a road's **approach
segment** so it meets a matched anchor tangentially. Applied opt-in at ribbon-build time (render
only) — keeps the serialized cell polyline (and determinism) intact; visual change ships behind
review per the pixel-perfect / eyeball-approval preference.

## Authoring resolver (`src/world/anchor-snap-resolver.ts`) — Stage 4

`resolveAttach(world, sourceId, targetId, rules)` finds the best compatible anchor pair between two
features and returns the `Relation` to add to the `WorldNode` connectome (`connect`). The seam Fate
/ the command bus call so "attach a stall to the bridge deck" resolves to coordinates by matching,
not hand-computed placement. Pure + tested; live command-registry wiring is a follow-up.

## Staging

1. Enrich `Anchor`; emitters; `collectAnchors`; wire `map.anchors`. (data)
2. `anchor-rules.ts` + `matchAnchors`; wire `map.anchorLinks`; replace door-on-road read with a
   matcher consult where safe. (data)
3. `anchor-fillet.ts` geometry + tests; opt-in ribbon application. (geometry)
4. `anchor-snap-resolver.ts` + tests. (authoring seam)
5. Overlay draws anchors + links; full suite + tsc.

## Non-goals / guard-rails

- No uniform point cloud — anchors only at genuine connection sites (the `AnchorKind` enum fences
  them).
- No worldgen determinism break — links are derived, geometry untouched in stages 1–2.
- No silent visual change — fillet application is opt-in and flagged for review.
