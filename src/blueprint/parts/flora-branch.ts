// src/blueprint/parts/flora-branch.ts
// L-system-driven flora parts: `branch_plant` (real branching trees/shrubs/ferns/
// flowers) and `rock` (noise-displaced boulder). Both emit the new flora/rock
// assetgen prims so they flow through the SAME generate→sprite pipeline as
// buildings (PBR-lit, cast shadows). Geometry is deterministic per species: the
// resolve pass bakes the blueprint seed into params, so the L-system RNG is fixed
// and every instance of a kind shares one cached sprite (like the blob `tree`).
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import { createRng } from '@/core/rng';
import { mToTiles } from '@/render/scale-contract';
import { FLORA_RECIPE_NAMES, type FloraRecipeName } from '@/assetgen/geometry/flora/recipes';
import {
  buildFlora, FLORA_GENERATORS, CROWN_SILHOUETTES,
  type FloraGenerator, type CrownSilhouette,
} from '@/assetgen/geometry/flora/generators';
// Game-feel stylization scale for flora. Metric truth (heightM/sizeM) drives briefs
// and any sim; only the rendered geometry shrinks so trees read as charming props,
// not a forester's survey. (Was in the retired blob `parts/flora.ts`.)
export const TREE_GAME_SCALE = 0.34;

const footprintCells = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
  return cells;
};

const BRIEF: Record<FloraRecipeName, string> = {
  oak: 'a broad branching oak with a spreading leafy crown',
  pine: 'a tall conical pine with whorled evergreen branches',
  willow: 'a weeping willow with drooping leafy branches',
  shrub: 'a low multi-stemmed leafy shrub',
  fern: 'a feathery fern frond',
  flower: 'a single flowering stalk topped with petals',
};

/** A branching plant grown from a named L-system recipe. `heightM` sets size;
 *  `trunkR` the base limb radius (metres); `seed` (filled from the blueprint seed)
 *  fixes the otherwise-stochastic branching so the species sprite is stable. */
export const branchPlantPartType: PartType = {
  type: 'branch_plant',
  paramSchema: {
    generator: { kind: 'enum', values: FLORA_GENERATORS, default: 'proctree' },
    recipe: { kind: 'enum', values: FLORA_RECIPE_NAMES, default: 'oak' },
    crownShape: { kind: 'enum', values: CROWN_SILHOUETTES, default: 'rounded' },
    heightM: { kind: 'number', min: 0.2, max: 40, default: 10 },
    trunkR: { kind: 'number', min: 0.02, max: 0.5, default: 0.16 },
    seed: { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      generator: 'proctree', recipe: 'oak', crownShape: 'rounded', heightM: 10, trunkR: 0.16,
      ...(part.params ?? {}),
      // Bake the blueprint seed in so toPrims (which has no ctx.seed) is deterministic.
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const generator = p.params.generator as FloraGenerator;
    const recipe = p.params.recipe as FloraRecipeName;
    const crownShape = p.params.crownShape as CrownSilhouette;
    const k = TREE_GAME_SCALE;
    const heightTiles = mToTiles((p.params.heightM as number) * k);
    const baseRadius = (p.params.trunkR as number) * k;
    const rng = createRng((p.params.seed as number) >>> 0);
    const skel = buildFlora({ generator, recipe, crownShape, heightTiles, baseRadius, rng });
    // Offset the skeleton (built at origin) to the part's footprint centre.
    const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
    const limbs = skel.limbs.map(l => ({ a: [l.a[0] + cx, l.a[1] + cy, l.a[2]] as [number, number, number], b: [l.b[0] + cx, l.b[1] + cy, l.b[2]] as [number, number, number], r0: l.r0, r1: l.r1 }));
    const leaves = skel.leaves.map(lf => ({ at: [lf.at[0] + cx, lf.at[1] + cy, lf.at[2]] as [number, number, number], r: lf.r }));
    return [{ prim: 'flora', limbs, leaves }];
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: (p) => BRIEF[(p.params.recipe as FloraRecipeName) ?? 'oak'],
};

/** A boulder/rock: a noise-displaced spheroid of stone. `sizeM` = diameter (metres). */
export const rockPartType: PartType = {
  type: 'rock',
  paramSchema: {
    sizeM: { kind: 'number', min: 0.2, max: 8, default: 1.5 },
    jitter: { kind: 'number', min: 0, max: 0.7, default: 0.35 },
    seed: { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      sizeM: 1.5, jitter: 0.35,
      ...(part.params ?? {}),
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const radius = mToTiles((p.params.sizeM as number) * TREE_GAME_SCALE) / 2;
    const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
    return [{ prim: 'rock', center: [cx, cy], baseZ: 0, radius, seed: (p.params.seed as number) >>> 0, jitter: p.params.jitter as number, mat: 'stone' }];
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: () => 'a weathered grey boulder',
};
