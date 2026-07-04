/**
 * Canonical lighting — ONE source of truth for sun direction across the whole
 * project, so generated art and renderer-drawn shadows always agree.
 *
 * Decision (2026-06-06): sun is **upper-left**. Generated sprites bake FORM
 * shading lit from the upper-left (kept transparent, no baked cast shadow).
 *
 * Renderer-drawn shadows shipped: `gpu-scene.ts` runs a projected cast-shadow
 * pass (stencil-union — each entity silhouette draws once per pixel via a
 * dedicated stencil target, so overlapping shadows don't double-darken) and
 * `DEFAULT_LIGHTING.shadowMode` (`render/lighting-state.ts`) defaults to
 * `'geometry'`. Sun direction governs both that pass and generated-art
 * lighting so every sprite and shadow agree.
 *
 * Consumed by:
 *   - src/assetgen/compilers/pixflux-compiler.ts  → SUN_PROMPT in the prompt
 *   - src/assetgen/view-registry.ts               → recipe.lightDirection
 */

/** The single canonical sun direction. */
export const SUN_DIRECTION = 'top-left' as const;
export type SunDirection = typeof SUN_DIRECTION;

/** Prompt fragment injected into every generated-art request. */
export const SUN_PROMPT = 'lit from the upper-left, soft top-left lighting';
