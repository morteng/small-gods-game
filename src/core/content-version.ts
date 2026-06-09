// src/core/content-version.ts
// Single source of truth for the two manually-bumped cache-busting versions.
// Bump a constant when you make a change you want reflected in-game without the
// player having to clear storage or hit "New World".

/**
 * Bump when building/asset GENERATION changes (geometry, metric scale, blueprint
 * output). A baked sprite whose `recipeVersion` differs from this is treated as
 * STALE and skipped, so the live parametric generator renders instead.
 * Regenerate the PixelLab base library at the new version to let baked art win
 * again. Started at 'v2' to retire the 'v1' baked art left metrically wrong by
 * the metric-scale standardization. Bumped to 'v3' for the chroma-key sprite
 * pipeline (magenta-background img2img + keyed alpha + stored normal/anchors),
 * which invalidates every v2 runtime-generated sprite so they regenerate cleanly.
 */
export const ART_RECIPE_VERSION = 'v3';

/**
 * Bump when WORLDGEN / preset output changes (footprints, placement, heights).
 * An autosave stamped with a different value is discarded on load → a fresh
 * world is generated. Distinct from SAVE_VERSION (which guards the save *schema*).
 */
export const WORLD_CONTENT_VERSION = 1;
