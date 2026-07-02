// src/assetgen/geometry/flora/generators.ts
// The flora skeleton dispatcher. Three generators feed the SAME FloraSkeleton →
// mesh.ts → compose.ts pipeline; this module picks one and maps a species'
// crown-shape hint onto that generator's parameters, then uniformly scales the
// raw skeleton to a target height (tile units) so botanical metrics drive size.
//
//   'lsystem'  — turtle L-system recipes (recipes.ts). Small plants: fern, flower,
//                grass, herb. Cheap, stylised, keeps the existing six recipes.
//   'proctree' — recursive branch model (proctree.ts). Shrubs (low many-stemmed
//                bushes, no crown envelope to speak of).
//   'spacecol' — space colonization (space-colonization.ts). ALL trees: the crown
//                envelope (dome / cone / column / weeping curtain) is the authority
//                and a coverage pass closes the silhouette (canopy-first, WP-H).
//
// Determinism: every generator runs off the supplied seeded sfc32 Rng.
import type { Rng } from '@/core/rng';
import type { FloraSkeleton } from './turtle';
import { buildFloraSkeleton, type FloraRecipeName } from './recipes';
import { growProctree, type ProctreeParams } from './proctree';
import { growSpaceColonization, type SpaceColParams } from './space-colonization';
import { scale as vscale } from './vec3';

export type FloraGenerator = 'lsystem' | 'proctree' | 'spacecol';
export const FLORA_GENERATORS: readonly FloraGenerator[] = ['lsystem', 'proctree', 'spacecol'];

/** Crown silhouettes (mirrors flora-species `CrownShape`) the generators tune to. */
export type CrownSilhouette =
  | 'rounded' | 'spreading' | 'conical' | 'columnar' | 'weeping' | 'irregular'
  | 'tufted' | 'none';
export const CROWN_SILHOUETTES: readonly CrownSilhouette[] =
  ['rounded', 'spreading', 'conical', 'columnar', 'weeping', 'irregular', 'tufted', 'none'];

export interface BuildFloraOpts {
  generator: FloraGenerator;
  /** L-system family (lsystem) + leaf/form hint for the other generators. */
  recipe: FloraRecipeName;
  /** Crown silhouette — the per-species shape lever. */
  crownShape: CrownSilhouette;
  /** Target overall height in tile units. */
  heightTiles: number;
  /** Base trunk/stem radius in tile units. */
  baseRadius: number;
  rng: Rng;
}

/** Uniformly scale a raw skeleton so its tallest point hits `heightTiles`, and map
 *  its unit-normalised limb radii onto the metric `baseRadius`. Foliage radii scale
 *  with position so crowns stay proportional. Matches `buildFloraSkeleton`'s output. */
function fit(raw: FloraSkeleton, heightTiles: number, baseRadius: number): FloraSkeleton {
  let maxZ = 0;
  for (const l of raw.limbs) maxZ = Math.max(maxZ, l.a[2], l.b[2]);
  for (const lf of raw.leaves) maxZ = Math.max(maxZ, lf.at[2]);
  const sz = maxZ > 1e-6 ? heightTiles / maxZ : heightTiles;
  return {
    limbs: raw.limbs.map((l) => ({
      a: vscale(l.a, sz), b: vscale(l.b, sz),
      r0: baseRadius * l.r0, r1: baseRadius * l.r1,
    })),
    leaves: raw.leaves.map((lf) => ({ at: vscale(lf.at, sz), r: lf.r * sz })),
  };
}

/** Crown-shape → proctree parameters. Broadleaf branching; drop drives weeping. */
function proctreePreset(crown: CrownSilhouette, recipe: FloraRecipeName): Partial<ProctreeParams> {
  // Foliage is many SMALL clumps (not a few big balls) so the canopy reads as leafy
  // texture and the branches show through; size/count are tuned per crown below.
  const base: Partial<ProctreeParams> = {
    levels: 4, branchFactor: 3, segmentsPerBranch: 2, trunkLength: 1,
    lengthFalloff: 0.78, taper: 0.9, radiusFalloff: 0.68,
    clumpMin: 0.45, clumpMax: 0.95, drop: 0.12, climb: 0.28, sweep: 0,
    twist: 0.7, jitter: 0.14, foliageRadius: 0.14, foliageBunch: 5, foliageThreshold: 1,
  };
  let pr = base;
  switch (crown) {
    case 'spreading':
      pr = { ...base, clumpMin: 0.6, clumpMax: 1.15, climb: 0.12, drop: 0.2, foliageRadius: 0.15, foliageBunch: 5 };
      break;
    case 'columnar':
      pr = { ...base, levels: 5, branchFactor: 2, clumpMin: 0.12, clumpMax: 0.42, climb: 0.6, drop: 0.02, foliageRadius: 0.1, foliageBunch: 4 };
      break;
    case 'weeping':
      pr = { ...base, branchFactor: 3, clumpMin: 0.2, clumpMax: 0.55, climb: 0.05, drop: 0.85, lengthFalloff: 0.82, foliageRadius: 0.09, foliageBunch: 4 };
      break;
    case 'irregular':
      pr = { ...base, jitter: 0.28, twist: 1.0, clumpMin: 0.5, clumpMax: 1.2, climb: 0.2, drop: 0.16, foliageRadius: 0.13, foliageBunch: 5 };
      break;
    case 'conical':
      pr = { ...base, branchFactor: 3, clumpMin: 0.5, clumpMax: 0.85, climb: 0.1, drop: 0.3, foliageRadius: 0.12 };
      break;
    case 'rounded':
    default:
      break; // base is a rounded broadleaf crown
  }
  // A shrub is a low, many-stemmed bush: shorter trunk, busier, more upright stems.
  if (recipe === 'shrub') {
    pr = { ...pr, levels: 3, branchFactor: 4, trunkLength: 0.45, clumpMin: 0.6, clumpMax: 1.25, climb: 0.4, drop: 0.05, foliageRadius: 0.12, foliageBunch: 4 };
  }
  return pr;
}

/** Crown-shape → space-colonization parameters — the canopy-first per-species
 *  tuning. `trunkFrac` is the bare-trunk fraction (pine HIGH, oak LOW); foliage is
 *  fewer/LARGER blobs + a coverage pass (see space-colonization.ts). */
function spaceColPreset(crown: CrownSilhouette): Partial<SpaceColParams> {
  switch (crown) {
    // Conifer cone: tall bare trunk (pine HIGH), a NARROW cone taller than wide —
    // small clumps that shrink with the cone toward the tip.
    case 'conical':
      return { envelope: 'conical', trunkFrac: 0.45, crownWidth: 0.24, foliageRadius: 0.07, attractors: 300, step: 0.045, coverage: 90, pipeExp: 2.6 };
    // Columnar broadleaf (birch): narrow tall crown over a slender visible trunk.
    case 'columnar':
      return { envelope: 'columnar', trunkFrac: 0.28, crownWidth: 0.2, foliageRadius: 0.09, attractors: 220, step: 0.05, coverage: 70, pipeExp: 2.6 };
    // Spreading oak: broad dense dome over a SHORT-but-visible stout trunk.
    case 'spreading':
      return { envelope: 'spreading', trunkFrac: 0.3, crownWidth: 0.46, foliageRadius: 0.13, attractors: 220, step: 0.055, coverage: 90, pipeExp: 2.7 };
    // Weeping willow: umbrella dome + a dense fine skirt of thin strands (the
    // strand blob is SMALL — the curtain reads from many overlapping strands).
    case 'weeping':
      return { envelope: 'weeping', trunkFrac: 0.32, crownWidth: 0.42, foliageRadius: 0.105, attractors: 120, step: 0.055, coverage: 75, curtainBottom: 0.08, curtainBlobR: 0.034, pipeExp: 2.6 };
    // Irregular (hazel/yew): lumpy dome with a hint of stem below.
    case 'irregular':
      return { envelope: 'irregular', trunkFrac: 0.18, crownWidth: 0.42, foliageRadius: 0.12, attractors: 200, step: 0.055, coverage: 80 };
    // Rounded broadleaf (beech/ash): full dome over a modest bare trunk.
    default:
      return { envelope: 'rounded', trunkFrac: 0.26, crownWidth: 0.42, foliageRadius: 0.13, attractors: 200, step: 0.055, coverage: 80, pipeExp: 2.6 };
  }
}

/** Build a flora skeleton with the chosen generator, fitted to `heightTiles`. */
export function buildFlora(o: BuildFloraOpts): FloraSkeleton {
  switch (o.generator) {
    case 'proctree':
      return fit(growProctree(proctreePreset(o.crownShape, o.recipe), o.rng), o.heightTiles, o.baseRadius);
    case 'spacecol':
      return fit(growSpaceColonization(spaceColPreset(o.crownShape), o.rng), o.heightTiles, o.baseRadius);
    case 'lsystem':
    default:
      return buildFloraSkeleton({ recipe: o.recipe, heightTiles: o.heightTiles, baseRadius: o.baseRadius, rng: o.rng });
  }
}
