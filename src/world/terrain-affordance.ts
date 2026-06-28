// src/world/terrain-affordance.ts
//
// The READ bridge between the world heightfield and terrain-aware siting. The
// `TerrainProbe` returned by `makeTerrainProbe(map)` reports, for any tile, the
// affordances the ground naturally supplies — derived purely from the read-only
// `heightMetresAt` field, so it is seed-deterministic and mutates nothing.
//
// It reads `baseSeedHeight` only (the `⊕ deformations` half is a later, SHARED slice —
// see heightfield.ts). Lives in `src/world` because it reads world terrain; the
// connectome consumes it through `ExpandCtx.terrain` and never imports world code.
//
// TWO families of affordances live on one probe (building-validity epic S4 — the
// terrain affordance/tag layer):
//
//   ── Defensive (the original earthworks protocol, `blueprint/connectome/earthworks.ts`) ──
//   height          — LOCAL prominence (m above the surrounding ground, not sea level):
//                     "how much natural mound this knoll already gives".
//   commanding      — fraction of directions this tile looks DOWN on (view / fields of fire).
//   steepFlanks     — fraction of directions that fall away steeply (natural protection).
//   water           — proximity to water (a wet moat for free).
//   approachControl — how funnelled the approach is (few gentle ways up = easier to hold).
//
//   ── Intrinsic terrain tags (S4 — consumed by sun orientation S3 + view/prominence S5) ──
//   elevation       — ABSOLUTE height in metres, sea level = 0 (above positive, below negative).
//   slope           — steepness 0..1 (0 flat, 1 ≈ a 45° grade); the build-difficulty signal.
//   flatness        — 1 − slope; the "flat enough to build on" signal.
//   aspectX, aspectY — DOWNHILL unit vector (which way the ground falls away). A south-facing
//                     slope has aspect pointing south → couples to the sun arc for orientation.
//                     (0,0) on flat ground, where aspect is undefined.
//
// Adding the intrinsic tags is purely additive: `readAffordance` (earthworks) pulls only
// the defensive keys, so the defensive siting output is byte-identical.
import type { GameMap } from '@/core/types';
import { heightMetresAt } from '@/world/heightfield';
import type { TerrainProbe } from '@/blueprint/connectome';

/** Sample radius (tiles) for the neighbourhood the affordances are measured over. */
const SAMPLE_R = 4;
/** A flank is "steep" when the ground drops more than this many metres over SAMPLE_R. */
const STEEP_DROP_M = 4;
/** Water is sensed within this radius (tiles). */
const WATER_R = 6;
/** The grade (metres of rise per tile) that reads as `slope = 1`. A tile is 2 m across,
 *  so 2 m/tile ≈ a 45° slope — past that, building is impractical. */
const SLOPE_FULL_M_PER_TILE = 2;
/** Below this gradient magnitude (m/tile) the ground is effectively flat → no aspect. */
const ASPECT_EPS = 1e-4;

// Eight compass directions (unit steps), scaled by SAMPLE_R for the neighbourhood ring.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A read-only height field at continuous tile coords (metres, sea level = 0). */
export type HeightSampler = (tx: number, ty: number) => number;

/**
 * Compute the full affordance record (defensive + intrinsic tags) for a tile from a
 * height sampler. Pure: same sampler + tile → same affordances. Factored out of
 * {@link makeTerrainProbe} so the tags are unit-testable with a synthetic terrain
 * (a ramp, a cone) instead of a seeded worldgen field.
 */
export function terrainAffordanceAt(
  sample: HeightSampler,
  tx: number,
  ty: number,
): Record<string, number> {
  const here = sample(tx, ty);

  let sum = 0;
  let lower = 0; // directions we look down on
  let steep = 0; // directions that fall away steeply
  for (const [dx, dy] of DIRS) {
    const nh = sample(tx + dx * SAMPLE_R, ty + dy * SAMPLE_R);
    sum += nh;
    const drop = here - nh;
    if (drop > 0) lower++;
    if (drop > STEEP_DROP_M) steep++;
  }
  const meanNeighbour = sum / DIRS.length;

  // Local prominence — how much this tile rises above its surroundings (≥0).
  const prominence = Math.max(0, here - meanNeighbour);
  const commanding = lower / DIRS.length;
  const steepFlanks = steep / DIRS.length;
  // A funnelled approach: most flanks steep but not a sheer island — the gentle
  // ways up are few. Peaks at ~one or two gentle directions.
  const gentle = DIRS.length - steep;
  const approachControl = gentle > 0 ? clamp01(steep / DIRS.length) : 0;

  // Water proximity: nearest direction with below-sea-level ground inside WATER_R.
  let water = 0;
  for (const [dx, dy] of DIRS) {
    for (let r = 1; r <= WATER_R; r++) {
      if (sample(tx + dx * r, ty + dy * r) < 0) {
        water = Math.max(water, 1 - (r - 1) / WATER_R);
        break;
      }
    }
  }

  // ── Intrinsic tags — slope/aspect from a central-difference gradient ───────────────
  // Cardinal samples at SAMPLE_R give a smoothed gradient (m per tile). Downhill aspect
  // = the negative gradient; slope = its magnitude normalised against a 45° grade.
  const gx = (sample(tx + SAMPLE_R, ty) - sample(tx - SAMPLE_R, ty)) / (2 * SAMPLE_R);
  const gy = (sample(tx, ty + SAMPLE_R) - sample(tx, ty - SAMPLE_R)) / (2 * SAMPLE_R);
  const gradMag = Math.hypot(gx, gy);
  const slope = clamp01(gradMag / SLOPE_FULL_M_PER_TILE);
  const flatness = 1 - slope;
  const aspectX = gradMag > ASPECT_EPS ? -gx / gradMag : 0;
  const aspectY = gradMag > ASPECT_EPS ? -gy / gradMag : 0;

  return {
    height: prominence,
    commanding,
    steepFlanks,
    water,
    approachControl,
    elevation: here,
    slope,
    flatness,
    aspectX,
    aspectY,
  };
}

/**
 * Build a read-only terrain probe over a world map. The returned probe is pure: same
 * map + tile → same affordances. Out-of-bounds samples are edge-clamped by
 * `heightMetresAt`, so coastal/edge sites degrade gracefully rather than throwing.
 */
export function makeTerrainProbe(map: GameMap): TerrainProbe {
  const sample: HeightSampler = (tx, ty) => heightMetresAt(map, tx, ty);
  return {
    affordanceAt: (tx: number, ty: number) => terrainAffordanceAt(sample, tx, ty),
  };
}
