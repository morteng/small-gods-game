// src/world/boulder-deformation.ts
//
// Big riverbank boulders → mini settle-in pads (rivers R5 ground-blend, spec
// 2026-07-05-realistic-rivers-streams-design.md §R5 second half). The rock-bury crop
// (PR1, render-only) sinks the SPRITE below the surface line; on sloped ground the
// terrain still runs straight past the rock, so it reads dropped, not lodged. A tight
// level pad — the boulder's own footprint levelled a hand's-breadth INTO grade with a
// short feather — makes the ground meet the rock the same way settlement pads make it
// meet a wall (settlement-deformation.ts is the pattern; feather here is much tighter
// because a rock has no walls to ramp up to).
//
// Determinism & save-safety: pads must be a PURE function of `map` (the composed
// heightfield re-derives on load), but the boulders are entities. They are, however,
// themselves a pure function of (hydrology, seed) — so this builder RE-DERIVES the
// riparian scatter with exactly the generator's inputs (`map.riparianSeed`, the map's
// own declaration that the pass ran — see map-generator.ts). Two knowing divergences,
// both visually nil at a 0.08 m dip: the generator's registry id-collision guard can
// skip an entity we pad, and a bank boulder cleared under a building footprint keeps
// its pad (the building's own pad, priority 25, rules that ground anyway).
//
// Scope (deliberate):
// - DRY-land boulders only. The in-water riffle boulders sit on the river incision
//   (priority 40, which out-ranks any pad) and their contact line is under the drawn
//   water plane — a pad there is invisible where it isn't overridden.
// - Big boulders only (≥ ~1.5 m). Cobbles and small rocks read fine with the PR1 bury
//   crop alone; the heightfield stays quiet under them.
// - Riparian rocks only for now — biome-brush scree/rock populations would need their
//   own re-derivation and are deferred (noted in the rivers design doc §R5).

import type { GameMap, HydrologyResult } from '@/core/types';
import { WaterType } from '@/core/types';
import { discDeformation, type Deformation } from '@/world/terrain-deformation';
import { heightMetresAt } from '@/world/heightfield';
import { getHydrologyResult } from '@/world/hydrology-store';
import { buildRiparianEntities } from '@/world/riparian-scatter';


/** Only boulders at or above this entity scale get a pad. granite-boulder's mature
 *  height runs 1–3 m (flora-facts nominal ~2 m at scale 1), so 0.75 ≈ the spec's
 *  "≥ ~1.5 m" gate. Bank boulders scatter at scale 0.6–1.0. */
export const BOULDER_PAD_MIN_SCALE = 0.75;

/** Pad radius in tiles per unit of entity scale (1 tile = 2 m; a ~2 m rock stands on
 *  roughly a tile). The pad hugs the rock's base, not its shadow. */
const PAD_RADIUS_PER_SCALE = 0.5;
/** Taper back to untouched terrain — TIGHT (cf. settlement pads' 2.5): a rock lodges
 *  in a dimple, it doesn't command a ramped forecourt. */
const PAD_FEATHER_TILES = 0.75;
/** How far the ground under the rock settles below grade, in metres. Half a
 *  settlement foundation's 0.12 — felt as a seat line, not a pit. */
const SETTLE_DEPTH_M = 0.08;
/** Below EVERYTHING (discs 20, footprint-levels 22, settlement pads 25, roads 30,
 *  rivers 40): wherever engineered ground overlaps a rock, the engineering rules. */
const PAD_PRIORITY = 8;

/**
 * The map-free core (unit-testable against a synthetic hydrology raster): re-derive
 * the riparian scatter and emit one mini level pad per BIG boulder standing on DRY
 * ground. `groundHeightM` samples the BASE terrain height in metres at a tile —
 * reading base (not composed) keeps each pad a one-shot level with no self-reference,
 * same rule as settlement pads.
 */
export function boulderPadDeformationsFor(
  hydro: HydrologyResult,
  width: number,
  height: number,
  seed: number,
  groundHeightM: (tx: number, ty: number) => number,
): Deformation[] {
  const out: Deformation[] = [];
  for (const e of buildRiparianEntities(hydro, width, height, seed)) {
    if (e.kind !== 'granite-boulder') continue;
    const scale = (e.properties as { scale?: number } | undefined)?.scale ?? 1;
    if (scale < BOULDER_PAD_MIN_SCALE) continue;
    const tx = Math.floor(e.x), ty = Math.floor(e.y);
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
    if (hydro.waterType[ty * width + tx] !== WaterType.Dry) continue;
    out.push(discDeformation({
      id: `pad:boulder:${tx},${ty}`,
      source: 'boulder:pad',
      cx: e.x,
      cy: e.y,
      radius: PAD_RADIUS_PER_SCALE * scale,
      target: groundHeightM(tx, ty) - SETTLE_DEPTH_M,
      feather: PAD_FEATHER_TILES,
      priority: PAD_PRIORITY,
    }));
  }
  return out;
}

/**
 * Pure: a world → the mini settle pads its big dry-land riparian boulders imply.
 * Gated on `map.riparianSeed` — the generator's declaration that the scatter RAN and
 * with what identity. A map without it (test stubs, studio grounds, non-noise gen
 * paths) never placed riparian entities, so re-deriving them would invent pads under
 * nothing; those maps get none, by construction. Also empty when the map has no
 * fresh water (the scatter itself is empty).
 */
export function buildBoulderPadDeformations(map: GameMap): Deformation[] {
  if (map.riparianSeed === undefined || map.flatHeight) return [];
  return boulderPadDeformationsFor(
    getHydrologyResult(map), map.width, map.height, map.riparianSeed,
    (tx, ty) => heightMetresAt(map, tx, ty),
  );
}
