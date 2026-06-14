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
 * cottage/longhouse/yurt geometry shifts.
 */
export const ART_RECIPE_VERSION = 'v9';

/**
 * Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 * An autosave stamped with a different value is discarded on load → a fresh
 * world is generated. Distinct from SAVE_VERSION (which guards the save *schema*).
 */
export const WORLD_CONTENT_VERSION = 9;   // roads Slice 0: GameMap.roadGraph persisted (inter-POI polylines + bridges; tile carve derived from it)
