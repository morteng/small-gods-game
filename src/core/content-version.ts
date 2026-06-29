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
 */
export const ART_RECIPE_VERSION = 'v17';

/**
 * Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 * An autosave stamped with a different value is discarded on load → a fresh
 * world is generated. Distinct from SAVE_VERSION (which guards the save *schema*).
 */
export const WORLD_CONTENT_VERSION = 35;  // SETTLEMENT SIZE SCALING: a POI's authored `size` now scales its building count (small 0.7 / medium 1.0 / large 1.8 / huge 2.6) + radius (√scale), so a large village finally musters enough buildings to clear the manor focus rung (focusMin 6) AND round-robin its way to the trades (smithy/tavern/bakehouse) — the E4 roster buildings that previously never landed. Shifts which/how-many buildings every SIZED settlement plats (size-less POIs, e.g. test paths, unchanged). Denser settlements surfaced a latent C1 barrier leak (a slab poking under a building silhouette) — fixed by unifying the settlement-ring gating onto the croft rings' robust slab-midpoint sampling AND filtering `reconcileBarriersWithBuildings` against the building VISUAL extent (not just solid cells), so INV4 holds by construction. ⇒ discard older autosaves. See prior notes below.
// 34 = L2b PER-INSTANCE BUILDING VARIETY: the placer now threads a deterministic per-instance seed (worldSeed ^ poi ^ call-order) into every building synthesis, so each placed instance varies — the generative catalogue→geometry bridge grows its FOOTPRINT from the seed (smithy/inn/bakehouse/brewhouse/granary/dovecote/tithe-barn differ between instances) and gen-form bodies vary their plan length within their lot. Placement stays valid (occupancy-grid reserves whatever footprint results; spatial invariants hold) but differs from v33 ⇒ discard older autosaves. See prior notes below.
// 33 = VERDANT VALE MASSIF: craggy mountain peaks (ridge-noise corrugation in the POI peak), larger mountain influence radius (12→18) + colder cap, a treeline that culls vegetation off bare high ground, Verdant Vale's enlarged/outward-moved mountain region (grows the island), AND a volcano right-sizing — Emberpeak's summit dropped 0.96→0.80 so a cinder cone no longer towers like (or out-snows) the alpine Cloudwall, plus a temperature-gated altitude snowline so only COLD high ground crowns white (a hot desert cone stays bare) — all shift worldgen elevation/biome/entity output ⇒ discard older autosaves. See prior notes below.
// ---- prior WCV notes (kept for history) ----
// 32 = E4 ROSTER SWEEP: villages now plat a smithy + communal bakehouse; towns add an inn, smith, baker and brewer. These catalogue buildingTypes had no pinned geometry preset — they render via the new generative catalogue→fold bridge — so the village/city fill rosters change, shifting which buildings appear (round-robin order) ⇒ worldgen output changes, discard older autosaves. (31 = manor premises stable+well; 30 = site FIXTURES — wells co-placed; 29 = site expansion E2 auxiliaries; 28 = site-fitness live-wiring; 27 = barrier gates over visual extent C1; 26 = diagonal bridges; 25 = riverside levee #24; 24 = parallel-road merge; 23 = entrance stoops; 22 = river density area-scaling; 21 = aqueduct arcade G6 polish; 20 = emergent aqueducts G6 on piers; 19 = stairs CONNECT G3d.)
