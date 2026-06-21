// src/assetgen/geometry/flora/generators.ts
// The flora skeleton dispatcher. Three generators feed the SAME FloraSkeleton →
// mesh.ts → compose.ts pipeline; this module picks one and maps a species'
// crown-shape hint onto that generator's parameters, then uniformly scales the
// raw skeleton to a target height (tile units) so botanical metrics drive size.
//
//   'lsystem'  — turtle L-system recipes (recipes.ts). Small plants: fern, flower,
//                grass, herb. Cheap, stylised, keeps the existing six recipes.
//   'proctree' — recursive branch model (proctree.ts). Broadleaf trees + shrubs +
//                weeping forms. Crown-shape tunes clump/drop/climb → distinct
//                oak / beech / birch / willow silhouettes (the headline win).
//   'spacecol' — space colonization (space-colonization.ts). Conifers, where an
//                envelope (conical / columnar) gives the cleanest cone silhouette.
//
// Determinism: every generator runs off the supplied seeded sfc32 Rng.
import type { Rng } from '@/core/rng';
import type { FloraSkeleton } from './turtle';
import { buildFloraSkeleton, type FloraRecipeName } from './recipes';
import { growProctree, type ProctreeParams } from './proctree';
import { growSpaceColonization, type SpaceColParams, type Envelope } from './space-colonization';
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

/** Crown-shape → space-colonization parameters (conifer cones / columns). */
function spaceColPreset(crown: CrownSilhouette): Partial<SpaceColParams> {
  const envelope: Envelope =
    crown === 'columnar' ? 'columnar'
    : crown === 'spreading' ? 'spreading'
    : crown === 'irregular' ? 'irregular'
    : crown === 'conical' ? 'conical'
    : 'rounded';
  switch (envelope) {
    // Conifers: many SMALL clumps over a dense skeleton → a needled cone, not a few lumps.
    case 'conical':
      return { envelope, trunkFrac: 0.12, crownWidth: 0.32, foliageRadius: 0.085, attractors: 320, step: 0.05 };
    case 'columnar':
      return { envelope, trunkFrac: 0.1, crownWidth: 0.2, foliageRadius: 0.085, attractors: 300, step: 0.048 };
    case 'spreading':
      return { envelope, trunkFrac: 0.4, crownWidth: 0.5, foliageRadius: 0.12, attractors: 260 };
    default:
      return { envelope, trunkFrac: 0.38, crownWidth: 0.42, foliageRadius: 0.12, attractors: 260 };
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
