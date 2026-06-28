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
 */
export const ART_RECIPE_VERSION = 'v16';

/**
 * Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 * An autosave stamped with a different value is discarded on load → a fresh
 * world is generated. Distinct from SAVE_VERSION (which guards the save *schema*).
 */
export const WORLD_CONTENT_VERSION = 28;  // SITE-FITNESS LIVE-WIRING: the building placer now consults the terrain affordance layer (prominence/sun/shelter/flatness, building-validity S3–S5) when ordering frontage slots and siting focus buildings — a prominent building (church/manor) drifts onto the sunlit eminence, a dwelling onto sheltered level ground, so building POSITIONS shift ⇒ discard older autosaves. (27 = barrier gates over visual extent C1; 26 = diagonal bridges; 25 = riverside levee #24; 24 = parallel-road merge; 23 = entrance stoops; 22 = river density area-scaling; 21 = aqueduct arcade G6 polish; 20 = emergent aqueducts G6 on piers; 19 = stairs CONNECT G3d.)
