// src/assetgen/geometry/flora/recipes.ts
// Named L-system recipes for the plant kinds we generate. Each recipe is data
// (axiom + rules + turtle knobs) — agent-/LLM-authorable, and the enum of names
// is the part type's capability catalogue. `buildFloraSkeleton` expands the
// L-system with a seeded RNG, runs the 3D turtle, then uniformly scales the
// skeleton to a target height (tile units) so botanical metrics drive size.
import type { Rng } from '@/core/rng';
import { expandLSystem, type Rules } from './lsystem';
import { runTurtle, type FloraSkeleton } from './turtle';
import { scale as vscale } from './vec3';

export interface FloraRecipe {
  axiom: string;
  rules: Rules;
  iterations: number;
  angleDeg: number;
  taper: number;
  stepFalloff: number;
  /** Leaf radius as a fraction of the (scaled) target height. 0 = leafless. */
  leafFrac: number;
  jitterDeg: number;
}

export type FloraRecipeName = 'oak' | 'pine' | 'willow' | 'shrub' | 'fern' | 'flower' | 'grass';
export const FLORA_RECIPE_NAMES: readonly FloraRecipeName[] =
  ['oak', 'pine', 'willow', 'shrub', 'fern', 'flower', 'grass'];

// Rules use single-char symbols; the turtle ignores non-command letters (A,B,X,…).
export const FLORA_RECIPES: Record<FloraRecipeName, FloraRecipe> = {
  // Broad deciduous: a trunk that forks into an upward-spreading crown.
  oak: {
    axiom: 'A',
    rules: { A: [{ to: 'F[&+B][&-B][^/B]FA', prob: 0.7 }, { to: 'F[+B][-B]FA', prob: 0.3 }], B: 'F[&+L][^-L]F[+L]B' },
    iterations: 4, angleDeg: 32, taper: 0.82, stepFalloff: 0.78, leafFrac: 0.14, jitterDeg: 10,
  },
  // Conical evergreen: straight leader with short whorled side branches.
  pine: {
    axiom: 'A',
    rules: { A: 'F[&+L][&-L][&/L][&\\L]A', B: 'FL' },
    iterations: 7, angleDeg: 58, taper: 0.9, stepFalloff: 0.7, leafFrac: 0.09, jitterDeg: 6,
  },
  // Weeping: forks high then drooping tips.
  willow: {
    axiom: 'A',
    rules: { A: 'F[+B][-B][&B]FA', B: 'F&&F[+L]&F[-L]&FL' },
    iterations: 4, angleDeg: 26, taper: 0.84, stepFalloff: 0.82, leafFrac: 0.1, jitterDeg: 12,
  },
  // Low multi-stemmed bush: many short branches from the base, leafy.
  shrub: {
    axiom: 'A',
    rules: { A: '[+B][-B][&B][^B][/B]', B: [{ to: 'F[+L][-L]FB', prob: 0.6 }, { to: 'F[&L]FL', prob: 0.4 }] },
    iterations: 4, angleDeg: 40, taper: 0.8, stepFalloff: 0.8, leafFrac: 0.16, jitterDeg: 14,
  },
  // Fern frond: a central rachis with opposed pinnae (classic L-system).
  fern: {
    axiom: 'X',
    rules: { X: 'F[+X][-X]FX', F: 'FF' },
    iterations: 4, angleDeg: 25, taper: 0.92, stepFalloff: 0.86, leafFrac: 0.05, jitterDeg: 6,
  },
  // Single flowering stalk: a stem topped by a leaf/petal whorl (the 'L').
  // leafFrac 0.22 (was 0.4): the whorl reads as a flower HEAD on a visible stem
  // rather than one balloon that swallowed the plant.
  flower: {
    axiom: 'F F F [+L][-L][&L][^L] L',
    rules: {},
    iterations: 0, angleDeg: 60, taper: 0.95, stepFalloff: 1, leafFrac: 0.22, jitterDeg: 0,
  },
  // Grass tussock: a fan of thin blades pitching outward from the base then curving
  // back up (& tips out, ^ recovers) — pure blades, no foliage blobs (leafFrac 0).
  // The / roll between bracketed blades spreads the fan around the clump; the one
  // stochastic rule varies blade count/length so no two tussocks read identical.
  grass: {
    axiom: '[&&B][/&&B][//&&B][///&&B][////&&B][/////&&B][///////&&B]',
    rules: { B: [{ to: 'F^F^F', prob: 0.55 }, { to: 'F^F^F^F', prob: 0.3 }, { to: 'F^F', prob: 0.15 }] },
    iterations: 1, angleDeg: 28, taper: 0.55, stepFalloff: 0.85, leafFrac: 0, jitterDeg: 16,
  },
};

export interface BuildFloraOpts {
  recipe: FloraRecipeName;
  /** Target overall height in tile units. */
  heightTiles: number;
  /** Base trunk/stem radius in tile units. */
  baseRadius: number;
  rng: Rng;
}

/** Expand + interpret a recipe, then scale the skeleton to `heightTiles`. Deterministic. */
export function buildFloraSkeleton(o: BuildFloraOpts): FloraSkeleton {
  const r = FLORA_RECIPES[o.recipe];
  const commands = expandLSystem(r.axiom, r.rules, r.iterations, o.rng);
  // leafFrac 0 = a genuinely LEAFLESS recipe (grass blades): the turtle must get
  // leafR 0 too, or every `]` pop still drops a leaf that the 0.04 floor below
  // would then inflate into foliage blobs.
  const raw = runTurtle(commands, {
    angleDeg: r.angleDeg, step: 1, radius: 1, taper: r.taper, stepFalloff: r.stepFalloff,
    leafR: r.leafFrac > 0 ? 1 : 0, jitterDeg: r.jitterDeg, rng: o.rng,
  });

  // Uniform scale so the tallest reached point equals heightTiles.
  let maxZ = 0;
  for (const l of raw.limbs) { maxZ = Math.max(maxZ, l.a[2], l.b[2]); }
  for (const lf of raw.leaves) { maxZ = Math.max(maxZ, lf.at[2]); }
  const sz = maxZ > 1e-6 ? o.heightTiles / maxZ : o.heightTiles;
  const leafR = Math.max(o.heightTiles * r.leafFrac, 0.04);

  return {
    limbs: raw.limbs.map(l => ({
      a: vscale(l.a, sz), b: vscale(l.b, sz),
      r0: o.baseRadius * l.r0, r1: o.baseRadius * l.r1,
    })),
    leaves: raw.leaves.map(lf => ({ at: vscale(lf.at, sz), r: leafR })),
  };
}
