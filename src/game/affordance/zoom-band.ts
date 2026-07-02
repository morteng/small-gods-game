// src/game/affordance/zoom-band.ts
//
// P5 semantic-zoom: the pure band selector. Zoom = altitude of attention (spec §6).
// Two bands v1: `in` (per-NPC chrome — hover / inspector / whisper card) and `out`
// (the divine inbox as world-anchored alert pins). One pure function so the game,
// the runtime, and tests all agree.
//
// Threshold rationale (empirical, on the quantized zoom ladder). A tile is
// `TILE_SIZE = 32` world px; on screen it spans `32 × zoom` device-independent px.
// Per-NPC chrome stops being readable once a tile drops below ~16 px, so the
// boundary sits between the two ladder rungs that straddle that floor: 1/2 (0.5 →
// 16 px, still readable → `in`) and 1/3 (≈0.333 → ≈11 px → `out`). The switch is
// placed at ≈0.42 (the midpoint of those rungs) with a small hysteresis dead-zone
// [OUT_BELOW, IN_ABOVE] so a rung landing on the line can't flicker the band.

export type ZoomBand = 'in' | 'out';

/** At or above this zoom the band is always `in` (per-NPC chrome). */
export const ZOOM_BAND_IN_ABOVE = 0.45;
/** At or below this zoom the band is always `out` (aggregate alert pins). */
export const ZOOM_BAND_OUT_BELOW = 0.4;

/**
 * The attention band for a camera zoom. `prev` (the last committed band) holds
 * through the hysteresis dead-zone between the two thresholds so the boundary
 * rung can't oscillate; it defaults to `in` (the readable, safe default).
 */
export function zoomBand(zoom: number, prev: ZoomBand = 'in'): ZoomBand {
  if (zoom >= ZOOM_BAND_IN_ABOVE) return 'in';
  if (zoom <= ZOOM_BAND_OUT_BELOW) return 'out';
  return prev;
}
