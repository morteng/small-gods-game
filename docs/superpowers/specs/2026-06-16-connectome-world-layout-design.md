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

## Historical grounding — Historic England HEAG210 *Medieval Settlements*

Read 2026-06-16 (the IHA by Paul Stamper; figures cited, © Historic England, not
vendored). It is authoritative archaeology and it **upgrades this epic from "one
nucleated-village grammar" to "a region-driven family of settlement forms."** The
concrete learnings:

### 1. Settlement form is *regionally determined* — the dispersion axis (new lever)

The single biggest finding. England splits into a **Central Province** where large
**nucleated** villages predominate, flanked by **Northern & Western** and
**South-eastern (Wealden)** provinces where **dispersed** hamlets + single farms are
the norm (Fig 1, the nucleations map). The driver is **soil + terrain**: light,
easily-worked arable soils + lowland → nucleation; heavy clay, woodland, and upland →
dispersal. The transition can be a **hard line on the map** (the Warwickshire
Felden/arable=villages vs Arden/woodland=hamlets divide).

→ **Design delta:** add a scalar **`dispersion`** affordance derived from terrain
(soil workability ⇐ slope + biome + woodland density) to `TerrainProbe`. The
settlement grammar **selects archetype + density from `dispersion`**, not uniformly.
This generalises "grammar by era+size+site" (§B) to add the **soil/province axis** —
the same world should yield compact villages on its lowland arable and scattered
farmsteads in its uplands/woods, with a crisp biome-boundary transition.

### 2. Roberts' village-form taxonomy (Fig 5) → the plan-form grammar

Fig 5 ("Village forms — principles of classification") is a clean morphological
taxonomy we can encode directly as **orthogonal grammar parameters**:

- **rows vs agglomerations** — linear (strung along a road/contour) vs clustered.
- **regular vs irregular** — *planned* (same-size plots, shared boundaries) vs
  *organic*. This maps onto chronology/lordship (§5 below): regular = seigneurial;
  irregular = older/community-grown.
- **sub-form** — row / grid / radial (each in regular and irregular variants).
- **green present/absent** — and note the **East-Anglian large-green** variant:
  extensive rough grazing with cottages around the *edge*, ≠ the small classic green.
- **single-focus vs polyfocal/composite** — clusters strung together (the "Duck End",
  Parva/Magna naming; Wollaston the type site). Multiple foci, each its own little
  row/cluster.

→ **Design delta:** the nucleated grammar (§B) becomes a parameterised family keyed
on these axes. S3 picks `(rows|agglom, regular|irregular, sub-form, green?, foci=N)`
from era + dispersion + site + seed.

### 3. Concrete templates from the plates

- **Planned double-row village (Yarwell, Fig 4):** same-size **tofts + crofts**
  fronting **one through-road** (often E–W), long croft strips running back to a
  **back lane**, **church + manor in larger compartments at the *end*** of the row,
  **open-field strips** filling the land beyond. This is the **post-1066 seigneurial**
  form and is the concrete spec for S3's regular branch + S4 toft/croft + S5 fields.
  (Our shipped S4 `extendBackLane` is exactly this back lane — historically validated.)
- **Organic terrain-following village (Wharram Percy, Fig 6/7):** **rows on the
  contour crests**, **church in the valley bottom**, plots following terrain rather
  than a grid — the older/irregular form. S3's irregular branch + terrain coupling.
- **Dispersed upland farmstead (Old Scale, Fig 10):** a single farmstead with
  **lynchets** (cultivation terraces) climbing the slope — grounds the dispersed
  archetype + slope-following strip fields (S5).

### 4. The settlement-type spectrum → world-scale connectome archetypes

Beyond "village," add these as selectable **world-scale Zone archetypes** (§A/§C):
**single farmstead → hamlet** (irregular farmstead cluster, esp. south-west) **→
village → polyfocal village → green-settlement**, plus specialist outliers:
**moated farmstead** (isolated farm in a water-filled moat; heavy soils, 13th–early
14th c., security in a lawless era — ties to the defensive-constructions epic as a
*moat* enclosure type), **monastic grange** (the largest outlying centre: workforce
chambers + barns + beast houses), **shieling** (seasonal upland grazing hut), and
**sheepcote/vaccary** (specialist stock production). The connectome chooses an
archetype per site from dispersion + era + resource affordance.

### 5. Chronology → era + lordship coupling (confirms Open-question 2)

- **9th–10th c. = peak village formation** in midland England → our early-medieval
  baseline *is* the nucleation era. Confirms: model early-med as **`medieval` +
  commoner wealth**, no new era bucket.
- **Planned/regular layouts are post-1066 *seigneurial*** (re-established under lordly
  control after the Harrying of the North). → add a **`planned`/lordship flag** that
  flips the grammar from irregular→regular; not a new era, an authority parameter.
- **Settlements are *fluid*** — created, deserted, expanding, contracting, and
  sometimes **shifting** (gradual relocation). Desertion drivers: 15th–16th c.
  **sheep-grazing conversion** (graziers depopulate, arable→pasture), **climatic
  downturn** (upland abandonment, e.g. Hound Tor 12th–13th c.), plague/famine/war.
  → feeds the settlement-growth/abandonment + D2 time-skip era-authoring loop (folded
  into that epic's grounding too).

### 6. Field & landscape facts (S5 + manor)

Open fields = **ridge-and-furrow** earthworks, **curvilinear strip→furlong→field**
boundaries, **lynchets** on slopes; with **common pasture, woodland, orchard**.
**Watermill** on a stream **some way away from the houses, road-connected** (windmills
rarer/later). Manorial specialist landscape: **fishponds, rabbit warrens, deer
parks** — manor-associated Zones for the lord. Toft = dwelling + barns/sheds in a
hedged/walled plot; croft = the long garden/paddock behind (exactly S4's two-part
plot).

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

- **W2 — Dispersion axis (HEAG210 §1).** `TerrainProbe.dispersion` derived from soil
  workability (slope + biome + woodland). The world solver scatters **single
  farmsteads / hamlets** on high-dispersion (upland/clay/wood) ground and **nucleated
  villages** on low-dispersion (lowland arable) ground, with a crisp biome-boundary
  transition. *This is what makes the world read as period-correct at the macro scale.*
- **S3 is now a plan-form *family* (HEAG210 §2–3),** not one grammar: parameterised by
  `(rows|agglomeration, regular|irregular, sub-form, green?, foci=N, planned-flag)`,
  selected from era + dispersion + lordship + site. Regular double-row = the seigneurial
  template; irregular contour-row = the organic one.

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
6. **Dispersion → archetype mapping** (HEAG210 §1) — a continuous `dispersion` scalar
   thresholded into farm/hamlet/village, or a discrete soil-province classification?
   (Recommend: continuous scalar from terrain, thresholds in the content pack.)
7. **Plan-form selection** (HEAG210 §2) — fully procedural from the taxonomy axes, or
   a small library of named templates (Yarwell-double-row, Wharram-contour-row,
   green-edge, polyfocal) the grammar instantiates and perturbs? (Recommend: named
   templates first, procedural perturbation later.)
