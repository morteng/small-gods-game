// src/world/settlement-deformation.ts
//
// Buildings → terrain CARVE (gentle foundation pads). Like roads and rivers, a building
// is "a thing to the terrain": its footprint levels the ground beneath it to a foundation
// height, so the building sits FLUSH on a slope instead of floating on the downhill corner
// / half-burying on the uphill one — and it settles a hand's-breadth INTO grade with a
// wide outward feather, so the ground ramps UP to the walls rather than stepping. The
// building reads as BUILT THERE, not dropped onto the surface. Each building still levels
// only its OWN footprint (+ feather), so the settlement follows the broader landform (no
// whole-town terracing).
//
// Coverage is every placed building footprint the map can name PURELY: built burgage lots,
// AND civic precincts (well/graveyard/mill — the reserved rects on `plan.civics`, minus the
// tended village green, which stays flush open ground). Entity-only ancillaries (crossing
// tolls, site auxiliaries/fixtures) carry no save-safe footprint on `map` (BuildingInstance
// has no dimensions), so they are skipped — the wear pass (settlement-wear.ts), which runs
// with the live World, is where those get their ground treatment.
//
// Determinism & save-safety: pads derive from `map.settlementPlans` (lots + civic rects are
// persisted verbatim on the map, like roadGraph), NOT from live World entities — so the
// composed heightfield stays a PURE function of `map` and re-derives identically on load.
// Only BUILT lots (a `buildingId` is set) pad; the world store key folds the built-lot
// count so live growth invalidates the carve.

import type { GameMap } from '@/core/types';
import { footprintLevelDeformation, type Deformation } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';

/** Taper from the levelled pad back to untouched terrain, in tiles — wide enough (~2 tiles
 *  beyond the footprint edge) that the surrounding grade RAMPS up to the walls instead of
 *  stepping, so a building on relief reads seated rather than perched. */
const PAD_FEATHER_TILES = 2.5;
/** How far a foundation settles BELOW the mean grade under it, in metres (a hand's-breadth).
 *  The whole footprint drops by this, so the feathered ground ramps up to the walls — the
 *  "dug in" read that makes a building look built there, not dropped. Small on purpose: at
 *  ~20 px/m vertical it is a couple of pixels, felt more than seen. */
const SETTLE_DEPTH_M = 0.12;
/** Pads level BELOW roads (30) and rivers (40) so a road/river through a settlement still
 *  rules its own corridor, but ABOVE the lake/settlement-precinct defaults. */
const PAD_PRIORITY = 25;

/** One settle-in pad over an arbitrary footprint cell set: levels to the mean BASE height
 *  under the footprint MINUS the settle depth (metres), with the wide outward feather.
 *  Reading BASE (not composed) keeps the pad a one-shot level with no self-reference. */
function padFor(map: GameMap, id: string, cells: { x: number; y: number }[]): Deformation | null {
  if (cells.length === 0) return null;
  const W = map.width;
  let sum = 0;
  const flat: number[] = [];
  for (const t of cells) {
    sum += heightMetresAt(map, t.x, t.y);
    flat.push(t.y * W + t.x);
  }
  return footprintLevelDeformation({
    id,
    source: 'settlement:pad',
    cells: flat,
    gridWidth: W,
    target: sum / cells.length - SETTLE_DEPTH_M,
    feather: PAD_FEATHER_TILES,
    priority: PAD_PRIORITY,
  });
}

/**
 * Pure: a world → the foundation-pad deformations its placed buildings imply — one settle-in
 * `level` pad per built burgage lot and per civic precinct (bar the green). Empty when the
 * world has no settlement plans.
 */
export function buildSettlementPadDeformations(map: GameMap): Deformation[] {
  const plans = map.settlementPlans;
  if (!plans || plans.length === 0) return [];
  const out: Deformation[] = [];
  for (const plan of plans) {
    for (const lot of plan.lots) {
      if (!lot.buildingId || lot.tiles.length === 0) continue;
      const pad = padFor(map, `pad:${lot.id}`, lot.tiles);
      if (pad) out.push(pad);
    }
    // Civic precincts (well / graveyard / mill and any agent-registered structural civic) sit
    // OFF the burgage lots, so nothing padded them before — a well or mill floated on its raw
    // slope. Level each reserved rect too. The village green is deliberately EXCLUDED: it is
    // tended flat common that must read against the worn lanes, not a settled foundation.
    for (const c of plan.civics) {
      if (c.type === 'green') continue;
      const cells: { x: number; y: number }[] = [];
      for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) cells.push({ x: c.x + dx, y: c.y + dy });
      const pad = padFor(map, `pad:civic:${c.type}:${c.x},${c.y}`, cells);
      if (pad) out.push(pad);
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
