// src/world/settlement-deformation.ts
//
// Buildings → terrain CARVE (gentle foundation pads). Like roads and rivers, a building
// is "a thing to the terrain": its footprint (the burgage lot it occupies) levels the
// ground beneath it to a foundation height, so the building sits FLUSH on a slope instead
// of floating on the downhill corner / half-burying on the uphill one. This is the
// conservative form — each building levels ONLY its own footprint with a soft feather, so
// the settlement still follows the broader landform (no whole-town terracing).
//
// Determinism & save-safety: pads derive from `map.settlementPlans` (the burgage lots are
// persisted verbatim on the map, like roadGraph), NOT from live World entities — so the
// composed heightfield stays a PURE function of `map` and re-derives identically on load.
// Only BUILT lots (a `buildingId` is set) pad; the world store key folds the built-lot
// count so live growth invalidates the carve.

import type { GameMap } from '@/core/types';
import { footprintLevelDeformation, type Deformation } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';

/** Taper from the levelled pad back to untouched terrain, in tiles. */
const PAD_FEATHER_TILES = 1.5;
/** Pads level BELOW roads (30) and rivers (40) so a road/river through a settlement still
 *  rules its own corridor, but ABOVE the lake/settlement-precinct defaults. */
const PAD_PRIORITY = 25;

/**
 * Pure: a world → the foundation-pad deformations its built burgage lots imply (one
 * `level` pad per built lot, target = the mean BASE height under the footprint so there is
 * no feedback with the composed field). Empty when the world has no settlement plans.
 */
export function buildSettlementPadDeformations(map: GameMap): Deformation[] {
  const plans = map.settlementPlans;
  if (!plans || plans.length === 0) return [];
  const W = map.width;
  const out: Deformation[] = [];
  for (const plan of plans) {
    for (const lot of plan.lots) {
      if (!lot.buildingId || lot.tiles.length === 0) continue;
      // Foundation height = the mean base elevation under the footprint (metres). Reading
      // BASE (not composed) keeps the pad a one-shot level with no self-reference.
      let sum = 0;
      const cells: number[] = [];
      for (const t of lot.tiles) {
        sum += heightMetresAt(map, t.x, t.y);
        cells.push(t.y * W + t.x);
      }
      out.push(
        footprintLevelDeformation({
          id: `pad:${lot.id}`,
          source: 'settlement:pad',
          cells,
          gridWidth: W,
          target: sum / lot.tiles.length,
          feather: PAD_FEATHER_TILES,
          priority: PAD_PRIORITY,
        }),
      );
    }
  }
  return out;
}

/** Count of built burgage lots across the world — a cheap signature for the deformation
 *  cache key so foundation pads invalidate when live growth fills a lot. */
export function settlementBuildCount(map: GameMap): number {
  const plans = map.settlementPlans;
  if (!plans) return 0;
  let n = 0;
  for (const plan of plans) for (const lot of plan.lots) if (lot.buildingId) n++;
  return n;
}
