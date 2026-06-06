/**
 * Canonical lighting — ONE source of truth for sun direction across the whole
 * project, so generated art and renderer-drawn shadows always agree.
 *
 * Decision (2026-06-06): sun is **upper-left**. Generated sprites bake FORM
 * shading lit from the upper-left (kept transparent, no baked cast shadow).
 *
 * Renderer-drawn shadows are OFF for now (user, 2026-06-07): nothing draws a
 * programmatic contact/cast shadow. Sun direction still governs generated-art
 * lighting so every sprite is lit consistently.
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
