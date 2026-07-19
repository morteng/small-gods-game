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

/** Resolve the effective flora/rock generator seed. `validateParams` fills the schema
 *  default (0) whenever the caller passed none, so a 0 here means "unset" ⇒ derive from
 *  the blueprint seed (`ctxSeed`); any explicit non-zero seed is honoured verbatim.
 *  (Fixes the latent bug where every flora instance was pinned to createRng(0).) */
const floraSeed = (paramSeed: number | undefined, ctxSeed: number): number =>
  (paramSeed && paramSeed !== 0) ? (paramSeed >>> 0) : (ctxSeed >>> 0);

const footprintCells = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
  return cells;
};

type Limb = { a: [number, number, number]; b: [number, number, number]; r0: number; r1: number };

/** How far a bare crown's terminal limbs grow past their leafy length (fraction of
 *  each tip limb's own length) — reads as fine winter twigs, not a pruned stump. */
const BARE_TIP_EXTEND = 0.22;

/** Extend TERMINAL limbs (no child limb starts at their b end) for the bare crown.
 *  Tips are found by hashing quantized endpoints — O(n), deterministic. */
function extendBareTips(limbs: Limb[]): Limb[] {
  const q = (v: [number, number, number]): string =>
    `${Math.round(v[0] * 512)},${Math.round(v[1] * 512)},${Math.round(v[2] * 512)}`;
  const starts = new Set(limbs.map(l => q(l.a)));
  return limbs.map(l => {
    if (starts.has(q(l.b))) return l;
    const b: [number, number, number] = [
      l.b[0] + (l.b[0] - l.a[0]) * BARE_TIP_EXTEND,
      l.b[1] + (l.b[1] - l.a[1]) * BARE_TIP_EXTEND,
      l.b[2] + (l.b[2] - l.a[2]) * BARE_TIP_EXTEND,
    ];
    return { ...l, b };
  });
}

const BRIEF: Record<FloraRecipeName, string> = {
  oak: 'a broad branching oak with a spreading leafy crown',
  pine: 'a tall conical pine with whorled evergreen branches',
  willow: 'a weeping willow with drooping leafy branches',
  shrub: 'a low multi-stemmed leafy shrub',
  fern: 'a feathery fern frond',
  flower: 'a single flowering stalk topped with petals',
  grass: 'a dense tussock of arching grass blades',
};

/** Readability boost for GROUND-COVER recipes: sub-metre herbs/ferns/grass shrunk by
 *  TREE_GAME_SCALE render only a few pixels — invisible at gameplay zoom. Boosting
 *  the small forms (and only the rendered geometry — metric truth stays botanical)
 *  keeps trees charming-prop scale while flowers and tussocks actually read. */
const RECIPE_PRESENT_BOOST: Record<FloraRecipeName, number> = {
  oak: 1, pine: 1, willow: 1, shrub: 1.2, fern: 1.7, flower: 1.8, grass: 1.7,
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
    /** Flower-head tint, packed 0xRRGGBB (0 = none) — recolours the leaf whorl. */
    petalTint: { kind: 'number', min: 0, max: 0xffffff, default: 0 },
    /** 1 = BARE crown (alpine/winter): same skeleton, leaves dropped, twig tips
     *  extended a touch. Selected by the render layer's snow-mask variant. */
    bare: { kind: 'number', min: 0, max: 1, default: 0 },
    seed: { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      generator: 'proctree', recipe: 'oak', crownShape: 'rounded', heightM: 10, trunkR: 0.16, petalTint: 0, bare: 0,
      ...(part.params ?? {}),
      // Bake the blueprint seed in so toPrims (which has no ctx.seed) is deterministic.
      // A 0 param-seed is the schema-default SENTINEL (validateParams fills it before we
      // see it, which used to defeat the `?? ctx.seed` fallback and pin every instance to
      // seed 0) — so 0 ⇒ derive from the blueprint seed, letting per-variant seeds vary
      // the silhouette. An explicit non-zero seed still wins.
      seed: floraSeed(part.params?.seed as number | undefined, ctx.seed),
    },
  }),
  toPrims(p): Prim[] {
    const generator = p.params.generator as FloraGenerator;
    const recipe = p.params.recipe as FloraRecipeName;
    const crownShape = p.params.crownShape as CrownSilhouette;
    const k = TREE_GAME_SCALE * (RECIPE_PRESENT_BOOST[recipe] ?? 1);
    const heightTiles = mToTiles((p.params.heightM as number) * k);
    const baseRadius = (p.params.trunkR as number) * k;
    const rng = createRng((p.params.seed as number) >>> 0);
    const skel = buildFlora({ generator, recipe, crownShape, heightTiles, baseRadius, rng });
    const bare = ((p.params.bare as number) ?? 0) > 0;
    // Offset the skeleton (built at origin) to the part's footprint centre.
    const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
    let limbs = skel.limbs.map(l => ({ a: [l.a[0] + cx, l.a[1] + cy, l.a[2]] as [number, number, number], b: [l.b[0] + cx, l.b[1] + cy, l.b[2]] as [number, number, number], r0: l.r0, r1: l.r1 }));
    // BARE crown (alpine/winter variant): same skeleton, leaves dropped; terminal
    // limbs extended a touch so the crown reads as fine twigs, not a pruned stump.
    if (bare) limbs = extendBareTips(limbs);
    const leaves = bare ? [] : skel.leaves.map(lf => ({ at: [lf.at[0] + cx, lf.at[1] + cy, lf.at[2]] as [number, number, number], r: lf.r }));
    // Ground-cover forms have green STEMS, not bark-brown trunks: grass limbs ARE
    // the blades, and a fern's rachis / a flower's stalk is herbaceous. A petalTint
    // (herbs) recolours the head whorl so a poppy reads red, a daisy white.
    const herbaceous = recipe === 'grass' || recipe === 'fern' || recipe === 'flower';
    const tintNum = (p.params.petalTint as number) >>> 0;
    const foliageTint = tintNum > 0
      ? [(tintNum >> 16) & 0xff, (tintNum >> 8) & 0xff, tintNum & 0xff] as [number, number, number]
      : undefined;
    // Crown-radial normal target (ez-tree "lush" trick — see flora/mesh.ts): the crown
    // origin the foliage facets re-aim their normals toward so the clump-field shades as
    // ONE rounded volume. Conifer cones shade around the trunk AXIS at each facet's
    // height; weeping crowns drape from an APEX at the crown top; every other crown is a
    // point volume at the leaf centroid.
    let crownCenter: [number, number, number] | undefined;
    let crownMode: 'point' | 'axis' | 'apex' | undefined;
    if (leaves.length > 0) {
      if (crownShape === 'conical') {
        crownMode = 'axis';
        crownCenter = [cx, cy, 0];
      } else if (crownShape === 'weeping') {
        crownMode = 'apex';
        let topZ = -Infinity;
        for (const lf of leaves) if (lf.at[2] > topZ) topZ = lf.at[2];
        crownCenter = [cx, cy, topZ];
      } else {
        crownMode = 'point';
        let sx = 0, sy = 0, sz = 0;
        for (const lf of leaves) { sx += lf.at[0]; sy += lf.at[1]; sz += lf.at[2]; }
        crownCenter = [sx / leaves.length, sy / leaves.length, sz / leaves.length];
      }
    }
    return [{
      prim: 'flora', limbs, leaves,
      ...(herbaceous ? { barkMat: 'foliage' as const } : {}),
      ...(foliageTint ? { foliageTint } : {}),
      ...(crownCenter ? { crownCenter, crownMode } : {}),
    }];
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: (p) => BRIEF[(p.params.recipe as FloraRecipeName) ?? 'oak'],
};

/** Rocks read as landscape anchors, not stylized props — shrink them less than trees
 *  (TREE_GAME_SCALE 0.34 turned a 2.5 m boulder into a sub-metre pebble). */
export const ROCK_GAME_SCALE = 0.55;

/** ±fraction the seeded variant perturbs a rock's sizeM — the flora variants come out
 *  at genuinely different NATIVE sprite sizes (pixel-perfect rule: several native sizes
 *  beat one fractionally-scaled blit). */
const ROCK_SIZE_JITTER = 0.2;

/** Native-size factor for a rock seed. Seed 0 (the variant-0 / legacy sentinel) is
 *  EXACTLY 1 — variant 0 stays byte-identical. Non-zero seeds draw from their OWN rng
 *  stream (xor-spread) so the cluster-arrangement rng sequence is untouched. */
export function rockSizeFactor(seed: number): number {
  if ((seed >>> 0) === 0) return 1;
  const rng = createRng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  return 1 - ROCK_SIZE_JITTER + rng.next() * 2 * ROCK_SIZE_JITTER;
}

/** A boulder/rock: noise-displaced spheroid(s) of stone. `sizeM` = diameter (metres);
 *  `aspect` stretches vertically (a standing stone / monolith); `cluster` scatters
 *  N sub-boulders of varied size around the footprint centre (a rock pile). */
export const rockPartType: PartType = {
  type: 'rock',
  paramSchema: {
    sizeM: { kind: 'number', min: 0.2, max: 8, default: 1.5 },
    jitter: { kind: 'number', min: 0, max: 0.7, default: 0.35 },
    aspect: { kind: 'number', min: 0.4, max: 4, default: 1 },
    cluster: { kind: 'number', min: 1, max: 6, default: 1 },
    // Plane-cut faceting (see rockFacets): large knapped facets instead of a noise
    // lump. Defaulted ON — the smooth-ball look was the user-rejected one.
    cuts: { kind: 'number', min: 0, max: 12, default: 6 },
    // >1 = a craggy OUTCROP: stacked shrinking cut-slabs + foot stones, not a pile.
    shelves: { kind: 'number', min: 1, max: 6, default: 1 },
    seed: { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      sizeM: 1.5, jitter: 0.35, aspect: 1, cluster: 1, cuts: 6, shelves: 1,
      ...(part.params ?? {}),
      // 0 = schema-default sentinel ⇒ derive from the blueprint seed (same latent-bug
      // fix as branch_plant), so rock variants actually vary their arrangement.
      seed: floraSeed(part.params?.seed as number | undefined, ctx.seed),
    },
  }),
  toPrims(p): Prim[] {
    const seed = (p.params.seed as number) >>> 0;
    // The variant seed perturbs sizeM ±20% (rockSizeFactor) so the seeded variants are
    // genuinely different native sizes; seed 0 (variant 0) is exactly today's size.
    const radius = mToTiles((p.params.sizeM as number) * ROCK_GAME_SCALE * rockSizeFactor(seed)) / 2;
    const jitter = p.params.jitter as number;
    const aspect = (p.params.aspect as number) ?? 1;
    const cluster = Math.max(1, Math.round((p.params.cluster as number) ?? 1));
    const cuts = Math.max(0, Math.round((p.params.cuts as number) ?? 6));
    const shelves = Math.max(1, Math.round((p.params.shelves as number) ?? 1));
    const cx = p.at.x + p.size.w / 2, cy = p.at.y + p.size.h / 2;
    if (shelves > 1) {
      // Outcrop: stacked shrinking cut-slabs with per-shelf drift + squat variation
      // (reference rock-outcrop-strata-2: a tapering ASYMMETRIC pinnacle — the drift
      // and per-shelf cuts are what keep it from reading as coursed masonry), plus a
      // couple of fist-stones spilled at the foot. Own rng stream — the cluster
      // arrangement stream below stays byte-identical.
      const rng = createRng((seed ^ 0x0c8a95e1) >>> 0);
      const prims: Prim[] = [];
      let z = 0;
      for (let i = 0; i < shelves; i++) {
        const t = i / (shelves - 1);
        const rr = radius * (1 - 0.58 * t) * (0.92 + rng.next() * 0.16);
        const ang = rng.next() * Math.PI * 2;
        const off = i === 0 ? 0 : radius * 0.30 * rng.next();
        // Squat shelves low, a stretched broken tip on top — the pinnacle silhouette.
        const squat = (0.8 + rng.next() * 0.5) * (i === shelves - 1 ? 1.5 : 1);
        prims.push({
          prim: 'rock', center: [cx + Math.cos(ang) * off, cy + Math.sin(ang) * off],
          baseZ: z, radius: rr, seed: (seed + i * 104729) >>> 0, jitter, aspect: squat, cuts, mat: 'stone',
        });
        z += rr * 2 * 0.7 * squat * 0.62; // next shelf sinks ~38% into this one
      }
      for (let i = 0; i < 2; i++) {
        const ang = rng.next() * Math.PI * 2;
        const d = radius * (0.95 + rng.next() * 0.45);
        prims.push({
          prim: 'rock', center: [cx + Math.cos(ang) * d, cy + Math.sin(ang) * d],
          baseZ: 0, radius: radius * (0.20 + rng.next() * 0.1), seed: (seed + 7 + i * 15485863) >>> 0,
          jitter, aspect: 0.8, cuts: 4, mat: 'stone',
        });
      }
      return prims;
    }
    if (cluster === 1) {
      return [{ prim: 'rock', center: [cx, cy], baseZ: 0, radius, seed, jitter, aspect, cuts, mat: 'stone' }];
    }
    // A pile: the largest stone near centre, smaller ones leaning around it. The
    // seeded rng keeps the arrangement stable per kind (one cached sprite).
    const rng = createRng(seed);
    const prims: Prim[] = [];
    for (let i = 0; i < cluster; i++) {
      const f = i === 0 ? 1 : 0.45 + rng.next() * 0.35;           // lead stone full-size
      const r = radius * f;
      const ang = rng.next() * Math.PI * 2;
      const d = i === 0 ? 0 : radius * (0.7 + rng.next() * 0.6);  // shoulder distance
      prims.push({
        prim: 'rock',
        center: [cx + Math.cos(ang) * d, cy + Math.sin(ang) * d],
        baseZ: 0, radius: r, seed: (seed + i * 7919) >>> 0, jitter, aspect, mat: 'stone',
      });
    }
    return prims;
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: (p) => ((p.params.cluster as number) > 1 ? 'a low pile of weathered grey stones'
    : (p.params.aspect as number) > 1.6 ? 'a tall weathered standing stone' : 'a weathered grey boulder'),
};
