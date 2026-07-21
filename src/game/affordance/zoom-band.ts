// src/game/affordance/zoom-band.ts
//
// UI v2 W0/D1: the pure band selector. Zoom = altitude of attention (spec §"Design").
// Three bands: `world` (map — settlements only), `settlement` (buildings/settlement/
// npc), `soul` (per-NPC chrome — hover / inspector / whisper card). One pure function
// so the game, the runtime, and tests all agree.
//
// Threshold rationale (empirical, on the quantized zoom ladder). A tile is
// `TILE_SIZE = 32` world px; on screen it spans `32 × zoom` device-independent px.
//
// soul ↔ settlement (the proven v1 `in`/`out` pair): per-NPC chrome stops being
// readable once a tile drops below ~16 px, so the boundary sits between the two
// ladder rungs that straddle that floor: 1/2 (0.5 → 16 px, still readable → soul)
// and 1/3 (≈0.333 → ≈11 px → settlement). The switch sits at ≈0.42 (midpoint) with
// a small hysteresis dead-zone so a rung landing on the line can't flicker the band.
//
// settlement ↔ world: the dead-zone straddles the 1/8 (0.125) and 1/6 (≈0.167)
// ladder rungs — below 1/8 a settlement itself is unreadable clutter (map territory);
// at/above 0.15 there is enough screen room for settlement-level chrome.
//
// Each boundary is an INDEPENDENT hysteresis pair (own in/out thresholds), so the
// three-way band is computed as two cascaded two-way checks: first "is this soul",
// then (if not) "is this settlement vs world". `prev` (the last committed band)
// resolves each check's dead-zone the same way the v1 two-band selector did.

export type ZoomBand = 'world' | 'settlement' | 'soul';

// D10: thresholds pending empirical retune on live grabs (headless CI can't
// judge readability at a given zoom — this needs eyes on an actual running
// game). Do not hand-tune these without a live grab session.
/** At or above this zoom the band is always `soul` (per-NPC chrome). */
export const SOUL_IN_ABOVE = 0.45;
/** At or below this zoom the band drops out of `soul`. */
export const SOUL_OUT_BELOW = 0.4;
/** At or above this zoom the band is at least `settlement`. */
export const SETTLEMENT_IN_ABOVE = 0.15;
/** At or below this zoom the band drops to `world`. */
export const SETTLEMENT_OUT_BELOW = 0.125;

/**
 * The attention band for a camera zoom. `prev` (the last committed band) holds
 * through each boundary's hysteresis dead-zone so a rung landing on the line can't
 * oscillate the band; it defaults to `soul` (the readable, per-NPC-chrome default,
 * matching v1's `in` default).
 */
export function zoomBand(zoom: number, prev: ZoomBand = 'soul'): ZoomBand {
  // 1) soul vs not-soul, hysteresis around [SOUL_OUT_BELOW, SOUL_IN_ABOVE].
  const wasSoul = prev === 'soul';
  const inSoul = wasSoul ? zoom > SOUL_OUT_BELOW : zoom >= SOUL_IN_ABOVE;
  if (inSoul) return 'soul';

  // 2) settlement vs world, hysteresis around [SETTLEMENT_OUT_BELOW, SETTLEMENT_IN_ABOVE].
  // Falling out of `soul` this frame carries no settlement/world history, so it
  // resolves via the entry threshold (SETTLEMENT_IN_ABOVE) same as any other climb.
  const wasSettlement = prev === 'settlement';
  const inSettlement = wasSettlement ? zoom > SETTLEMENT_OUT_BELOW : zoom >= SETTLEMENT_IN_ABOVE;
  return inSettlement ? 'settlement' : 'world';
}

/** UI v2 D1: the in-band zoom a zoomed-out click/fly-to lands at, per focused-target
 *  kind. Renamed from v1's `ALERT_FLY_ZOOM` (same value) now that there are two. */
export const SOUL_FLY_ZOOM = 0.5;
/** W1 (world-band settlement labels) lands a settlement click/fly-to here; unused
 *  by W0 — wired when the world band grows settlement-label click-to-fly. */
export const SETTLEMENT_FLY_ZOOM = 0.25;
