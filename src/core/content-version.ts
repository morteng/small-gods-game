// src/core/content-version.ts
// Single source of truth for the two manually-bumped cache-busting versions.
// Bump a constant when you make a change you want reflected in-game without the
// player having to clear storage or hit "New World".

/**
 * Bump when building/asset GENERATION changes (geometry, metric scale, blueprint
 * output). A baked sprite whose `recipeVersion` differs from this is treated as
 * STALE and skipped, so the live parametric generator renders instead.
 * Regenerate the base library at the new version to let baked art win again.
 * History: 'v2' retired the 'v1' baked art left metrically wrong by the
 * metric-scale standardization; 'v3' was the chroma-key sprite pipeline
 * (magenta-background img2img + keyed alpha); 'v4' changes the CACHED FORMAT —
 * the stored blob is now the processed sprite (keyed + registered to the
 * geometry mask + quantized, at final resolution) rather than the raw LLM PNG,
 * with validation gating what gets persisted at all; 'v5' is the adaptive
 * pipeline — negotiation-band registration, detail-inviting prompts, relaxed
 * IoU gate, and the rebuilt castle_keep + window features on tall presets;
 * 'v6' is the medieval detail pass — material-driven eaves/verges, half-hip
 * (gablet) roofs, dormers, ridge louvres, slimmer multi-chimneys, per-type
 * window programmes, rectangular plans (see
 * docs/reference/medieval-building-reference.md); 'v7' deepens the eaves —
 * material overhangs grown to real medieval depths (thatch 60 cm … slate
 * 20 cm) with sprocketed-eave drop capping so door heads stay clear;
 * 'v8' is the roof-slab remodel — roofs are individual sloped boards with real
 * thickness (projecting eaves AND verges read as boards, not a solid wedge) plus
 * recessed gable-end tympana, and masonry/metal ridge stacks are offset BESIDE
 * the ridge beam (timber smoke-louvres still straddle it) so chimneys no longer
 * pierce the structural ridge;
 * 'v9' — connectome Slice 1: a building's smoke vent is now DERIVED from its hearth
 * (early-medieval commoner dwellings — cottage/longhouse/yurt — get a period-correct
 * ridge louver, NOT a chimney; vents stripped from their presets and re-derived), so
 * cottage/longhouse/yurt geometry shifts;
 * 'v10' — generative openings: doors + windows are now DERIVED from the room graph
 * (exterior portals ⇒ doors, needs-light zones ⇒ windows, distributed by wall length +
 * era glazing) for presets tagged 'gen-openings' (cottage/shrine/guard_post/watermill/
 * temple_small migrated to fact-seeds), so their fenestration shifts.
 * 'v11' — procedural weathering: building/prop albedo is aged in `composeStructure`
 * (dirt pooling low, grime in AO crevices, vertical rain-streaks, rust blooming on
 * metal) via `src/assetgen/render/weathering.ts`; pure flora/rock left pristine.
 * 'v12' — lit windows: window panes are a new 'glass' material (dark cool albedo by
 * day) carrying a warm emissive, so the renderer glows them at night (emissive ×
 * nightFactor). Shifts the grey/material/emissive of any preset with windows.
 * 'v13' — real flora generators: trees/shrubs now grow recursive proctree branch
 * skeletons (broadleaf/weeping) or space-colonization crowns (conifer cones) keyed
 * on a per-species crownShape, replacing the six L-system recipes that collapsed all
 * species to ~3 silhouettes. Shifts the geometry of every `branch_plant` (plant) sprite.
 * 'v14' — layered-connectome Layer 1 (STRUCTURE): a building's frameType is now selected
 * from its wall material + era/region and GATES its form — a solid/cruck/stave wall can no
 * longer jetty (only a box-frame does), and storeys are capped to what the frame bears. So
 * any building whose authored massing exceeded its frame shifts (e.g. the stone manor's
 * cross-wing loses its timber-frame jetty). See the layered-connectome-expression spec.
 * 'v15' — layered-connectome Layer 2a (FORM): a `gen-form` body's vertical massing
 * (plan/levels/jetty/storeyM) is now DERIVED from the program + structure rather than
 * hand-listed — a box-frame dwelling stacks a jettied upper storey, a cruck one stays a
 * single low range. Migrated the dwelling family (cottage/tavern/townhouse); the cottage's
 * derived form matches its authored one, the box-frame inns/townhouses take the frame's
 * full jetty. Footprint held (placement unchanged). Shifts the box-frame dwellings' geometry.
 * 'v16' — layered-connectome Layer 3a (FABRIC): STRUCTURE now gates fabric. (1) The frame's
 * fenestration policy drives derived openings — a mass wall takes few, widely-spaced lights,
 * a box frame's panels glaze generously — so any `gen-openings` body's window count/spacing
 * shifts to the frame's rhythm (the cruck cottage loses a window; mass-wall buildings grow
 * austere). (2) A masonry wall-chimney requires a flue-capable frame: a cruck/stave build
 * can never grow a stone stack and keeps its ridge smokehole however late/rich. Footprint
 * held (placement unchanged). See the layered-connectome-expression spec.
 * 'v17' — layered-connectome Layer 2b (FORM footprint variety): a `gen-form` body's plan
 * LENGTH is now sized to a bay count picked from the program's `sizeBays` range by the
 * per-instance seed (a cottage is 1–2 bays, a tavern 2–3), CLAMPED to the authored footprint
 * so the lot — and placement — is unchanged. Two cottages on a street now read as a short
 * single-bay cot and a longer two-bay one rather than clones. The name-derived default
 * cottage resolves to a shorter single-bay body, so its geometry shifts (see
 * assetgen-golden). Pairs with the placer threading a per-instance seed (a WORLD bump, since
 * the generative catalogue→geometry bridge grows the FOOTPRINT itself per instance).
 * 'v18' — layered-connectome Layer 3b (bay-aware openings): a `gen-openings` body's WINDOWS now
 * snap to the structural bay CENTRES — the frame's `bayModule` (metres/bay) divides the wall run
 * into panels and a window lights one panel each (skipping the door's bay), instead of the old
 * fixed fractional slots. So fenestration sits where a real timber-frame/masonry wall carries it
 * (panels between posts/piers). Window COUNT is unchanged (still structure-gated by spacing/
 * maxPerFace) — only positions move, so footprint/placement hold. Shifts the pane positions of
 * any structure-annotated `gen-openings` body. See the layered-connectome-expression spec.
 * 'v19' — layered-connectome Layer 3b (undercroft/cellar): a buildingType that declares
 * `undercroft` (the burgage townhouse), built on a masonry-capable frame (mass-wall/box-frame)
 * and stacking ≥2 storeys, now renders its GROUND storey as a STONE base course carrying the
 * (timber) upper — `buildingFacets` splits the wall solid at the base-course height with a
 * Manifold boolean (stone band + wall-material upper). Only undercroft bodies change; every
 * other building's wall is byte-identical (the single-material path is the original code).
 * See the layered-connectome-expression spec.
 * 'v20' — E3 shrine-procession slice 1 (retire temple_small): the hand-tuned `temple_small`
 * preset is gone — a temple now EXPRESSES from its church-axial programme through the fold
 * (generative bridge → FORM → FABRIC), so its geometry is derived not pinned. The generative
 * bridge gains a SACRED-AXIAL footprint rule (a temple/shrine cella is DEEPER than wide, the
 * nave fronting the door with a pediment; an axial barn stays wide). Temples now vary their
 * footprint per instance. See the shrine-procession spec.
 * 'v21' — E3 axis-mundi spire: a WORSHIP building (temple/church/shrine — not a barn, told
 * apart by its single entrance vs the barn's opposed cart doors) now crowns its ridge with a
 * stone STEEPLE — a new `spire` ridge-feature kind (a slender shaft + a pointed conical cap),
 * derived in connectomeToBlueprint. Shifts the geometry of every worship building; dwellings/
 * barns are unchanged. See the shrine-procession spec.
 * 'v22' — E3 threshold stoup (Law 1): a new `stoup` prop (a stone pedestal + bored basin,
 * composed from raw prims — no new part renderer) — the holy-water cleansing basin co-placed
 * at a sacred precinct's border. Additive (a new prop recipe; existing baked art unaffected).
 */
export const ART_RECIPE_VERSION = 'v22';

/**
 * Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 * An autosave stamped with a different value is discarded on load → a fresh
 * world is generated. Distinct from SAVE_VERSION (which guards the save *schema*).
 */
export const WORLD_CONTENT_VERSION = 56;  // VERDANT MEADOWS: now that the tile-pick noise is uniformised (v54) and weights are real fractions, `TemperateGrassland` adds a `meadow` (lush light-green) variant WITHOUT starving `hills` — {grass .5, meadow .2, hills .18, dirt .07, scrubland .05}. The Vale's pastures finally read lush (meadow ~5% of land, hills preserved ~6%, grass still dominant ~24%). Tile output changes ⇒ discard older autosaves. See prior notes below.
//                                          (prev 55) VARIED COASTS: the shoreline band is no longer a uniform sandy `Beach` — it sub-types by how steeply the land meets the sea (waterline slopeM): a flat strand stays `Beach` (sand), a tilted one becomes `RockyShore` (rocky/shingle), a steep face a `Cliff` (rock/mountain). Emergent from terrain steepness, applied to EVERY coast (slopeM defaults to 0 → legacy callers still get Beach). Demo island: ~82% beach / ~12% rocky / ~6% cliff; mountainous coasts read as continuous cliff. Coastal tile output changes ⇒ discard older autosaves. See prior notes below.
//                                          (prev 54) TILE-VARIANT WEIGHTS HONOURED: the tile-selection noise (`fbm` octaves:3, ≈Gaussian μ0.5 σ0.085) is now uniformised (Gaussian-CDF remap) before the BIOME_TILES CDF walk, so the weights act as real area fractions instead of starving every band after the first (e.g. forest `glen` clearings 0.01%→~2%, ocean `shallow_water` reaches its 0.4 share, hills/rocky/dirt/scrubland appear at intended density). Monotonic remap ⇒ tile variants still cluster into patches. Every biome's variant MIX shifts (incl. shallow/deep water split) ⇒ discard older autosaves. See prior notes below.
//                                          (prev 53) WALL GATE FIX: the settlement ring bbox now encloses each building's full VISUAL extent (not just its lot tiles), so the curtain sits clear OUTSIDE buildings. Perimeter buildings no longer poke past the line and force a building-wide opening — gates dropped from 10-12 tiles (giant holes) to ~3.8 tiles (real road/water gates). Ring position/gates change ⇒ discard older autosaves. See prior notes below.
//                                          (prev 52) TOWN-WALL THICKNESS: stone town curtain 4 m→2 m (thicknessTiles 2→1) — a typical medieval town wall, not Constantinople-grade. Tall+thin reads as a proper wall; the earthen rampart stays broad. Barrier footprint/foundation carve changes ⇒ discard older autosaves. See prior notes below.
//                                          (prev 51) IRRIGATION REACH: bump the ditch route budget 10→18 tiles (~36 m, a believable canal run) so moderately-near farms connect to water, not just bankside ones (riverside-farm worlds now water ~50-65% of fields; inland-farm worlds stay rain-fed). Ditch tile output changes ⇒ discard older autosaves. See prior notes below.
//                                          (prev 50) IRRIGATION (G7): each farm_field patch within reach of water gets an `irrigation_ditch` conveyance dug across the open soil to the nearest stream/lake, and its served fields are flagged `irrigated`. New tile type + tile output changes ⇒ discard older autosaves. See prior notes below.
//                                          (prev 49) VERDANT VALE REBALANCE: default world `mountainRelief` 95→55. The "massif" tuning + the absolute-metre biome switch had blanketed ~60% of the island's land in mountain/rock; 55 restores a verdant, varied demo island (~7–19% highland, concentrated at the Cloudwall) with the snow-capped peaks still dramatic. Tile output changes ⇒ discard older (rocky) autosaves. See prior notes below.
//                                          (prev 48) FARM FIELDS: farm buildings (barn/stable) now till a patch of `farm_field` tiles on the open soil beyond them — the live noise worldgen had none (farm_field was WFC-only). Walkable ground, so placement/roads unaffected, but tile output changes ⇒ discard older autosaves. See prior notes below.
//                                          (prev 46) RIVER WIDTH TAPER: the painted river raster + the render water mask now stamp at the per-vertex channel width (W ∝ √Q, `reachHalfWidths`) the carve already used — thin spring → broad mouth, stepping up at confluences — instead of a flat per-class halfWidth. River tile footprint changes (walkability/placement) ⇒ discard older autosaves. See prior notes below.
//                                          (prev 45) RIVER DENSITY TUNE: fewer rivers. Base flow threshold 500→560 + headwater taper fraction 0.22→0.40 (shorter wispy headwaters) + `buildWaterNetwork` now uses the same area-scaled+density threshold as the raster (was a fixed 500), so carve widths shrink consistently. New `WorldStyle.riverDensity` knob (default 1 = neutral) scales the threshold INVERSELY through `generateHydrology`/`buildWaterNetwork`. River raster + carved channels change ⇒ discard older autosaves. See prior notes below.
//                                          (prev 44) WALL FOUNDATIONS: worldgen now persists committed barriers on `map.barrierRuns`, and walls/palisades/ramparts carve a stepped `level` footing into the terrain (one gentle brush per ~4-tile span toward the local mean base height) so a curtain crossing a slope sits flush instead of floating. Composed heightfield changes where walls cross grades ⇒ discard older autosaves. See prior notes below.
//                                          (prev 43) ROOMIER WORLD: default island POIs scaled ~1.2× apart (positions + regions + connection waypoints in default.json) and `targetCornerD` lowered 0.7→0.66 so settlements seat centrally with land/coast around them — the cramped central valley spreads out and the island reads a little larger. Tile layout + POI origins + road graph shift ⇒ discard older autosaves. See prior notes below.
//                                          (prev 42) WIDE RIVER RASTER: the river tile raster is widened from the 1-cell D8 centreline to the full connectome channel band (the same disc swath the render mask + carve use), BEFORE settlements + roads site. Buildings no longer land in the visible river and roads bridge the full channel instead of carving dirt across painted water. Tile layout, settlement origins and the road graph all shift ⇒ discard older autosaves. See prior notes below.
//                                          (prev 41) 4-WAY BUILDING ORIENTATION: fill dwellings now rotate (blueprint `orientation` 0..3) to front whichever road their slot faces — placement draws from frontage slots on ALL sides (not just the canonical door side), so settlement layouts (origins, which buildings front which street, the rng stream) shift everywhere. Buildings persist their orientation in the resolved blueprint ⇒ discard older autosaves. See prior notes below.
// 40 = E3 THRESHOLD STOUP: temples/shrines now co-place a holy-water STOUP (cleansing fixture) at their site via the `requires:['cleansing']` token → `stoup` fixtureType → `stoup` prop (E2 fixture co-placement). A new entity at every worship POI ⇒ discard older autosaves. See prior notes below.
// 39 = TEMPLE RETIRED → GENERATIVE (E3 slice 1): temple_small loses its hand preset and expresses via the fold — a deep stone cella (sacred-axial footprint rule) whose footprint VARIES per instance instead of a frozen 3×4 box. Shifts temple geometry/footprint in every temple/shrine POI ⇒ discard older autosaves. See prior notes below.
// 38 = L3b UNDERCROFT + TOWNHOUSE ROSTER: cities now plat burgage TOWNHOUSES (jettied box-frame upper over a stone undercroft base course, L3b) alongside their trades — the city `buildings` roster gains `townhouse` ×3, so which buildings appear shifts. (Pairs with ART v19, the undercroft geometry.) ⇒ discard older autosaves. See prior notes below.
// 37 = FOCI-VILLAGE FILL FIX: the fill spiral (`findPlacement`) is now occupancy-aware — it skips road/civic/claimed cells and returns the first genuinely free spot, instead of returning a road cell (dirt_road/stone_road are BUILDABLE_TERRAIN) that the caller then rejected. A road-dense foci village (church+manor) used to exhaust its placement attempts and stay nearly empty; now it fills its open ground (Oakshire 4→11 buildings with its full roster — manor + smithy/bakehouse/tavern). Shifts every settlement's building layout ⇒ discard older autosaves. See prior notes below.
// 36 = VILLAGE DENSITY: village base buildingCount 3-8→5-10 so a village reads as a real cluster (manor + trades plat even at medium size; a large village bustles ~9-18 yet stays under a large city) instead of a 2-3-building hamlet. Shifts every village's building set ⇒ discard older autosaves. See prior notes below.
// 35 = SETTLEMENT SIZE SCALING: a POI's authored `size` now scales its building count (small 0.7 / medium 1.0 / large 1.8 / huge 2.6) + radius (√scale), so a large village finally musters enough buildings to clear the manor focus rung (focusMin 6) AND round-robin its way to the trades (smithy/tavern/bakehouse) — the E4 roster buildings that previously never landed. Shifts which/how-many buildings every SIZED settlement plats (size-less POIs, e.g. test paths, unchanged). Denser settlements surfaced a latent C1 barrier leak (a slab poking under a building silhouette) — fixed by unifying the settlement-ring gating onto the croft rings' robust slab-midpoint sampling AND filtering `reconcileBarriersWithBuildings` against the building VISUAL extent (not just solid cells), so INV4 holds by construction. ⇒ discard older autosaves. See prior notes below.
// 34 = L2b PER-INSTANCE BUILDING VARIETY: the placer now threads a deterministic per-instance seed (worldSeed ^ poi ^ call-order) into every building synthesis, so each placed instance varies — the generative catalogue→geometry bridge grows its FOOTPRINT from the seed (smithy/inn/bakehouse/brewhouse/granary/dovecote/tithe-barn differ between instances) and gen-form bodies vary their plan length within their lot. Placement stays valid (occupancy-grid reserves whatever footprint results; spatial invariants hold) but differs from v33 ⇒ discard older autosaves. See prior notes below.
// 33 = VERDANT VALE MASSIF: craggy mountain peaks (ridge-noise corrugation in the POI peak), larger mountain influence radius (12→18) + colder cap, a treeline that culls vegetation off bare high ground, Verdant Vale's enlarged/outward-moved mountain region (grows the island), AND a volcano right-sizing — Emberpeak's summit dropped 0.96→0.80 so a cinder cone no longer towers like (or out-snows) the alpine Cloudwall, plus a temperature-gated altitude snowline so only COLD high ground crowns white (a hot desert cone stays bare) — all shift worldgen elevation/biome/entity output ⇒ discard older autosaves. See prior notes below.
// ---- prior WCV notes (kept for history) ----
// 32 = E4 ROSTER SWEEP: villages now plat a smithy + communal bakehouse; towns add an inn, smith, baker and brewer. These catalogue buildingTypes had no pinned geometry preset — they render via the new generative catalogue→fold bridge — so the village/city fill rosters change, shifting which buildings appear (round-robin order) ⇒ worldgen output changes, discard older autosaves. (31 = manor premises stable+well; 30 = site FIXTURES — wells co-placed; 29 = site expansion E2 auxiliaries; 28 = site-fitness live-wiring; 27 = barrier gates over visual extent C1; 26 = diagonal bridges; 25 = riverside levee #24; 24 = parallel-road merge; 23 = entrance stoops; 22 = river density area-scaling; 21 = aqueduct arcade G6 polish; 20 = emergent aqueducts G6 on piers; 19 = stairs CONNECT G3d.)
