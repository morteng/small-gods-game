// src/world/terrain-affordance.ts
//
// The READ bridge between the world heightfield and the connectome's siting front
// end (blueprint/connectome/earthworks.ts). `makeTerrainProbe(map)` returns a
// `TerrainProbe` whose `affordanceAt(tx,ty)` reports the DEFENSIVE affordances a tile
// naturally supplies — derived purely from the read-only `heightMetresAt` field, so it
// is seed-deterministic and mutates nothing.
//
// It reads `baseSeedHeight` only (the `⊕ deformations` half is a later, SHARED slice —
// see heightfield.ts). Lives in `src/world` because it reads world terrain; the
// connectome consumes it through `ExpandCtx.terrain` and never imports world code.
//
// The affordances (all normalised 0..1 except `height`, in metres of local prominence)
// are the engine affordance protocol `earthworks.ts` reads:
//   height          — LOCAL prominence (m above the surrounding ground, not sea level):
//                     "how much natural mound this knoll already gives".
//   commanding      — fraction of directions this tile looks DOWN on (view / fields of fire).
//   steepFlanks     — fraction of directions that fall away steeply (natural protection).
//   water           — proximity to water (a wet moat for free).
//   approachControl — how funnelled the approach is (few gentle ways up = easier to hold).
import type { GameMap } from '@/core/types';
import { heightMetresAt } from '@/world/heightfield';
import type { TerrainProbe } from '@/blueprint/connectome';

/** Sample radius (tiles) for the neighbourhood the affordances are measured over. */
const SAMPLE_R = 4;
/** A flank is "steep" when the ground drops more than this many metres over SAMPLE_R. */
const STEEP_DROP_M = 4;
/** Water is sensed within this radius (tiles). */
const WATER_R = 6;

// Eight compass directions (unit steps), scaled by SAMPLE_R for the neighbourhood ring.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Build a read-only terrain probe over a world map. The returned probe is pure: same
 * map + tile → same affordances. Out-of-bounds samples are edge-clamped by
 * `heightMetresAt`, so coastal/edge sites degrade gracefully rather than throwing.
 */
export function makeTerrainProbe(map: GameMap): TerrainProbe {
  return {
    affordanceAt(tx: number, ty: number): Record<string, number> {
      const here = heightMetresAt(map, tx, ty);

      let sum = 0;
      let lower = 0; // directions we look down on
      let steep = 0; // directions that fall away steeply
      for (const [dx, dy] of DIRS) {
        const nh = heightMetresAt(map, tx + dx * SAMPLE_R, ty + dy * SAMPLE_R);
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
          if (heightMetresAt(map, tx + dx * r, ty + dy * r) < 0) {
            water = Math.max(water, 1 - (r - 1) / WATER_R);
            break;
          }
        }
      }

      return { height: prominence, commanding, steepFlanks, water, approachControl };
    },
  };
}
