# Connectome-driven world layout: map size, oceans/islands, period-correct villages (brainstorm)

**Date:** 2026-06-16 · **Status:** brainstorm (user-directed) · **Builds on:**
[worldbuilding fact DB + building connectome](2026-06-14-worldbuilding-fact-database-design.md),
[roads / linear features (TerrainProbe)](2026-06-14-roads-linear-features-connectome-design.md),
[settlement growth placement (SITE_RULES)](2026-06-13-settlement-growth-placement-design.md),
[building validity + situation](2026-06-16-building-validity-and-situation-design.md),
[shared terrain deformation channel](2026-06-15-shared-terrain-deformation-channel-spec.md),
[shrine procession connectome](2026-06-16-shrine-procession-connectome-design.md)

## What the user asked (2026-06-16)

> 1. "we need larger terrain. my thought is that the world connectome _also_
>    defines the map size. so map size is always large enough to contain the
>    specified pois and biomes."
> 2. "think about having an ocean. so if we want we can set coastal biomes and
>    custom terrain features and the map becomes an island. after all, all lands
>    are islands… we should also be able to define small islands off the coasts."
> 3. "how do we get to more sophisticated, period-correct layouts? we need a manor
>    house :)"
> 4. (reference dump) Early-medieval villages: 30–500 people, collective defense.
>    **Homesteads (tofts & crofts):** dwelling + small barns inside a wall/hedge
>    (toft), long garden/paddock behind (croft). **Village center:** church, manor
>    house, or green. **Manor house** = seat of local government / the lord.
>    **Parish church** = focal point. **Roads** develop organically from footpaths
>    → winding streets that break the wind (some planned grids / single main
>    street). **Communal assets:** well/pump, central green, grain mill by a stream.
>    **Construction:** timber frame, wattle-and-daub, thatch; box framing on stone
>    footings; sunken-floor; three-bay house (service / hall-with-hearth / private).
>    **Open-field system:** 2–3 great fields in long narrow strips, common pasture/
>    woodland/orchard; family plots fenced with woven gates.

One coherent theme: **the connectome is the source of truth at *two* scales, and
the grid + terrain + village layout are *derived* from it.** Today that's inverted.

## Code reality (what's there today)

- **Map size is authored, not derived.** `public/data/worlds/default.json` hard-codes
  `size: { width: 128, height: 96 }`; every POI carries an absolute `position`.
  `generateWithNoise(width, height, seed, worldSeed)` (`src/map/map-generator.ts`)
  takes the size as a parameter. Nothing computes size from content.
- **Terrain is unbounded noise — no ocean frame.** `src/terrain/terrain-generator.ts`
  (`generateTerrainFields` → `classifyBiomes` → `sampleTiles`) fills the whole grid
  from fractal noise; biome list has no `ocean`/`coast`; map edges are just more land.
  `WATER_TYPES` exists (lake/river) but there is no sea or coastline mask.
- **Era axis is 5 buckets** `primordial|ancient|classical|medieval|current`
  (`src/core/era.ts`) — no `early_medieval`; early-medieval *character* = `medieval`
  + commoner wealth + period tech (the data-driven smoke/opening/validity rules).
- **Settlement layout is a burgage/market pattern, not a nucleated village.**
  `src/world/settlement-plan.ts` builds a road graph + market + **burgage lots** +
  golden-spiral **wards** + civics; `src/world/building-placer.ts` places buildings
  on frontage slots (door faces road), then `src/world/enclosure.ts` rings each lot
  (croft hedge) + the settlement (palisade/town wall). There is **no village center
  anchor** (church/manor/green placed first), **no toft+croft two-part homestead**,
  **no open-field strip system** (fields are only a wear-mask ground), and **roads
  are graph/grid**, not organic footpath-derived lanes.
- **No manor house or parish church type.** Building presets
  (`src/blueprint/presets/index.ts`) have cottage/longhouse/tavern/townhouse/tower/
  castle_keep/watermill/farm_barn/market_stall/guard_post/temple_small/shrine/yurt —
  but no `manor_house` (lord's hall) and no `church` distinct from temple/shrine.
- **Deconfliction is now netted.** As of this session, a spatial-invariant
  integration test (`tests/integration/settlement-spatial-invariants.test.ts`)
  asserts no barrier/road sits on a building's solid cells, and roads route around
  buildings. This is the regression net that lets the layout grammar be rewritten
  aggressively. **But deconfliction is still post-hoc filtering, not a shared claim
  layer** — the epic should promote it to an occupancy authority.

## The design — one pattern at two scales

Both asks are the same shape: **a semantic graph → a *solved* spatial layout, with
the grid/terrain derived.** Build one layout-solver discipline and apply it twice.

### A. World-scale layout solver (asks 1 + 2)

`WorldConnectome` (POIs with desired biomes + adjacencies + connections) →
**solve** → `{ mapSize, poiPositions, biomeRegions, coastline }`. The grid is output.

1. **Positions become solvable, size becomes derived.** POI `position` becomes
   optional; when absent, a solver places POIs honoring biome membership +
   connection lengths (force-directed or constraint layout). `mapSize =
   bbox(all POI regions ∪ biome regions) + margin`, snapped up. Authored absolute
   positions still work (the solver is a no-op when everything is pinned) — so
   `default.json` keeps working while new worlds can be content-defined and larger.
2. **Ocean frame + coastline.** New biomes `ocean` + `coast`; an **island mask** in
   `terrain-generator.ts` (radial / signed-distance falloff, or a coastline spline)
   forces the grid border to `ocean` and shapes the landmass. "All lands are islands"
   = the default mask is a single landmass sized to hold the POIs. **Offshore
   islands** = extra mask blobs seeded from the connectome. Coastal POIs (port,
   `lakeside_dock`) snap to the coastline; `TerrainProbe` gains a `coastDistance`
   affordance so siting can prefer/avoid the shore.
3. **Custom terrain features** (the user's "custom terrain features") ride the same
   shared deformation channel + biome region brushes already in the repo.

### B. Settlement-scale layout grammar (asks 3 + 4) — period-keyed

A settlement is a connectome too. Replace the single burgage placer with a grammar
**selected by era + size + site**, exactly like the building openings/smoke rules:

- **early-medieval nucleated village** (the user's reference):
  1. **Center first.** Place the *focus* — parish **church** and/or **manor house**
     and/or **village green** — at the most prominent/central site (TerrainProbe).
     The center is the layout's root anchor; everything else grows from it.
  2. **Toft + croft homesteads.** A homestead = a **toft** (dwelling + small barn in
     a walled/hedged enclosure) fronting a lane, with a **long croft** (garden/
     paddock) behind it. This generalizes today's lot+croft-hedge into a *two-part*
     plot with a depth gradient (toft near lane, croft tail behind).
  3. **Organic winding lanes.** Lanes derived from footpaths between center and
     tofts (least-cost walks that bend with terrain + "break the wind"), not a grid.
     A `planned` flag keeps the grid/single-street option for later periods.
  4. **Open-field system.** 2–3 great fields beyond the tofts, subdivided into long
     narrow **strips**; common pasture/woodland/orchard fill the remainder. Fields
     are a real ground+boundary layer (strip furlongs + headlands), not a wear-mask.
  5. **Communal assets.** Well/green already partly exist; add the **grain mill**
     siting rule (by a stream — the existing watermill + nearWater rule), and the
     green as a civic open space.
- **high-medieval town** → the current burgage/market-street grammar (kept).

New connectome/building types: `manor_house` (lord's hall — and a rich new model to
build), `church` (parish focal point, distinct from temple/shrine), `village_green`
(civic open space), `open_field`/`strip_field` (ground + boundary layer), `toft`
(the walled homestead enclosure as a first-class plot).

### C. The unifying primitive — an occupancy / claim layer

Both solvers, and the deconfliction work already shipped, want **one spatial
authority**: every producer (lanes, tofts, crofts, fields, green, walls, civic,
vegetation) **claims** cells from a shared occupancy grid and **consults** it before
writing. This replaces the current post-hoc filtering (place-then-reconcile) with
deconfliction *by construction*, and is the same "affordance graph" the notes have
gestured at. The spatial-invariant net guards the transition.

## Slices (proposed)

- **W0 — World-layout seam.** Make `mapSize` derivable: `deriveMapSize(connectome)`
  + optional POI positions; authored worlds unchanged (solver no-op when pinned).
  Larger default island size. *Net:* size ⊇ all POI/biome bbox + margin.
- **W1 — Ocean & coastline.** `ocean`/`coast` biomes + island mask + offshore
  islands; coastal POIs snap to shore; `TerrainProbe.coastDistance`.
- **S1 — Occupancy claim layer.** Promote deconfliction to a shared claim grid;
  port roads/buildings/barriers onto it (net stays green, filtering retired).
- **S2 — Manor house + parish church + green (types).** New connectome building
  types + studio presets. *Standalone visible win; can land early, before S3.*
- **S3 — Nucleated village grammar.** Center-first anchoring (church/manor/green),
  era-keyed selection; tofts cluster around the center; winding lanes.
- **S4 — Toft + croft homestead.** Two-part plot (walled toft + long croft tail);
  generalizes lot + croft hedge.
- **S5 — Open-field system.** Strip furlongs + headlands + common pasture/woodland
  as a real ground+boundary layer radiating from the village.

S2 is decoupled (just new types) and is the recommended early win. W0/W1 are the
world layer; S1 is the architectural keystone the rest of the settlement slices ride.

## Open questions

1. **POI layout solver vs. pinned positions** — do we want full auto-layout, or
   keep authored positions and only *derive size* first (W0 minimal)? (Recommend:
   derive size first; auto-layout later.)
2. **`early_medieval` era** — keep modelling early-med as `medieval` + commoner
   wealth (current, works), or add a real era bucket (bigger: catalogue gates +
   golden + `ART_RECIPE_VERSION` + reseed)? (Recommend: stay on `medieval`+wealth.)
3. **Strip fields as entities vs. ground layer** — furlongs as a tagged ground/
   boundary layer (cheap) vs. plot entities (queryable, heavier). (Recommend:
   ground+boundary layer first.)
4. **Manor vs. castle** — is `manor_house` a new humble lord's hall (early-med) and
   `castle_keep` the fortified later form, with the grammar choosing by era?
5. **Occupancy layer scope** — settlement-local grid vs. world-wide claim authority.
