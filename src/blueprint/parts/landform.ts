// src/blueprint/parts/landform.ts
// NATURAL LANDFORM parts — parametric mesh props for terrain features a single-
// valued heightfield physically cannot represent (a hole through rock, an
// overhang). They emit the SAME assetgen prims as buildings (`arch` + `rock`), so
// they flow through the generate→SpritePack pipeline self-lit, with no img2img art
// and no heightfield. `sea_arch` is the first: a weathered coastal rock arch.
import type { PartType } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import type { Vec3 } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';

const footprintCells = (p: { at: { x: number; y: number }; size: { w: number; h: number } }): Array<[number, number]> => {
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
  return cells;
};

/** Deterministic [0,1) hash of two ints (no Math.random — geometry must be stable). */
function h01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * A weathered sea arch: a round rock ring (a real opening you can see the sea
 * through — impossible in a heightfield) roughened by lumpy boulders at the
 * abutments and an eroded crown ON TOP of the spandrel, so it reads as natural
 * eroded stone rather than a clean masonry bridge. All prims already exist
 * (`arch` style:'round' + noise-displaced `rock`); this just composes them.
 */
export const seaArchPartType: PartType = {
  type: 'sea_arch',
  paramSchema: {
    spanM:  { kind: 'number', min: 4, max: 24, default: 13 },   // clear opening width
    riseM:  { kind: 'number', min: 2, max: 16, default: 8 },    // crown height above springing
    depthM: { kind: 'number', min: 2, max: 14, default: 6 },    // headland thickness (a mass, not a gate)
    seed:   { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      spanM: 13, riseM: 8, depthM: 6,
      ...(part.params ?? {}),
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const seed = (p.params.seed as number) >>> 0;
    const span = mToTiles(p.params.spanM as number);
    const rise = mToTiles(p.params.riseM as number);
    const depth = mToTiles(p.params.depthM as number);
    const footR = mToTiles(4) / 2;
    const cy = depth / 2;
    const at: Vec3 = [0, 0, 0];
    return [
      { prim: 'arch', at, span, height: rise, thickness: depth, style: 'round', material: 'stone' },
      // weathered rock piers hugging the two feet (thicken the legs into eroded stone)
      { prim: 'rock', center: [0.0, cy],        baseZ: 0,           radius: footR,           seed: seed * 7 + 1, jitter: 0.55, mat: 'stone' },
      { prim: 'rock', center: [span, cy],       baseZ: 0,           radius: footR,           seed: seed * 7 + 2, jitter: 0.55, mat: 'stone' },
      // eroded crown SITTING ON TOP of the spandrel — breaks the rectangular
      // silhouette into a natural rocky hump, never over the opening
      { prim: 'rock', center: [span * 0.58, cy * 0.92], baseZ: rise * 0.92, radius: mToTiles(8) / 2, seed: seed * 7 + 3, jitter: 0.62, mat: 'stone' },
      { prim: 'rock', center: [span * 0.30, cy * 1.1],  baseZ: rise * 0.88, radius: mToTiles(6) / 2, seed: seed * 7 + 4, jitter: 0.62, mat: 'stone' },
    ];
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: () => 'a weathered sea arch, a rock ring the surf has bored through',
};

/**
 * An OVERHANGING cliff face — a rock wall whose brow leans out PAST its base over
 * the water (an undercut the single-valued heightfield cannot represent). A short
 * corbel stack of slabs, each creeping seaward as it rises, cloaked in noise-boulder
 * crags so it reads as a natural looming rock face, not a stepped box.
 */
export const cliffFacePartType: PartType = {
  type: 'cliff_face',
  paramSchema: {
    widthM:    { kind: 'number', min: 4, max: 24, default: 11 },   // width along the shore
    heightM:   { kind: 'number', min: 4, max: 26, default: 14 },   // total height
    overhangM: { kind: 'number', min: 0, max: 12, default: 6 },    // how far the brow juts past the base
    seed:      { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      widthM: 11, heightM: 14, overhangM: 6,
      ...(part.params ?? {}),
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const seed = (p.params.seed as number) >>> 0;
    const w = mToTiles(p.params.widthM as number);
    const H = mToTiles(p.params.heightM as number);
    const overhang = mToTiles(p.params.overhangM as number);
    const baseD = mToTiles(4);
    const slabs = 3;
    const parts: Prim[] = [];
    // Structural core: a short corbel stack gives the true undercut (each slab creeps
    // seaward in +y as it rises), kept narrow so the crags below cloak it into rock.
    for (let i = 0; i < slabs; i++) {
      const t = i / (slabs - 1);
      const z = (H / slabs) * i;
      const shift = overhang * (t * t);                 // accelerating creep → real undercut up top
      const d = baseD + mToTiles(2) * t;
      parts.push({ prim: 'box', at: [w * 0.12, shift, z], size: [w * 0.76, d, H / slabs + 0.4], material: 'stone' });
    }
    // Cragging: many big noise-boulders cloak the whole mass into rock, spread across
    // the full width/depth/top and nudged seaward with height so the overhang reads.
    for (let i = 0; i < 20; i++) {
      const rz = H * (0.04 + 0.92 * h01(seed * 13 + i, 1));
      const t = rz / H;
      const lean = overhang * (t * t);
      const rx = w * (0.02 + 0.96 * h01(seed * 13 + i, 2));
      const ry = lean * h01(seed * 13 + i, 5) + (baseD + mToTiles(1)) * h01(seed * 13 + i, 4) - mToTiles(0.5);
      const rr = mToTiles(4 + 3.5 * h01(seed * 13 + i, 3)) / 2;
      parts.push({ prim: 'rock', center: [rx, ry], baseZ: rz, radius: rr, seed: seed * 13 + i, jitter: 0.62, mat: 'stone' });
    }
    return parts;
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: () => 'an overhanging cliff face, rock leaning out over the surf',
};

/**
 * A CAVE MOUTH — a rock hillock with a dark arched recess bored into its
 * camera-facing (+y) front, partway in but not through: a cave, not a tunnel. The
 * heightfield can't hollow ground; this is a mesh. The recess sits in shadow in the
 * lit scene, reading as a dark cave entrance. Crags cloak the box but leave the mouth.
 */
export const caveMouthPartType: PartType = {
  type: 'cave_mouth',
  paramSchema: {
    widthM:  { kind: 'number', min: 6, max: 26, default: 13 },
    depthM:  { kind: 'number', min: 5, max: 20, default: 10 },
    heightM: { kind: 'number', min: 4, max: 18, default: 9 },
    seed:    { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      widthM: 13, depthM: 10, heightM: 9,
      ...(part.params ?? {}),
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const seed = (p.params.seed as number) >>> 0;
    const w = mToTiles(p.params.widthM as number);
    const d = mToTiles(p.params.depthM as number);
    const H = mToTiles(p.params.heightM as number);
    const mouthW = Math.min(mToTiles(5.5), w * 0.45);
    const mouthH = Math.min(mToTiles(5), H * 0.6);
    const recess = Math.min(mToTiles(7), d * 0.7);
    const parts: Prim[] = [
      { prim: 'box', at: [0, 0, 0], size: [w, d, H], material: 'stone',
        apertures: [{ at: [w / 2 - mouthW / 2, d - recess, 0], size: [mouthW, recess + 0.2, mouthH], arch: { axis: 'x', style: 'round', rise: mToTiles(2.4) } }] },
    ];
    for (let i = 0; i < 16; i++) {
      const rx = w * (0.04 + 0.92 * h01(seed * 17 + i, 2));
      const ry = d * (0.02 + 0.9 * h01(seed * 17 + i, 4));
      const rz = H * (0.05 + 0.9 * h01(seed * 17 + i, 1));
      const nearMouth = Math.abs(rx - w / 2) < mouthW * 0.75 && ry > d - recess * 1.05 && rz < mouthH * 1.15;
      if (nearMouth) continue;                               // keep the cave open
      const rr = mToTiles(4 + 3 * h01(seed * 17 + i, 3)) / 2;
      parts.push({ prim: 'rock', center: [rx, ry], baseZ: rz, radius: rr, seed: seed * 17 + i, jitter: 0.6, mat: 'stone' });
    }
    return parts;
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: () => 'a cave mouth, a dark hollow bored into the rock',
};

/**
 * A HOODOO / balanced rock — a slender weathered pedestal capped by a far wider
 * boulder that overhangs it on every side (a mushroom rock). The overhang is the
 * point: a heightfield can't pinch a column narrower than its cap. Dots rocky
 * highlands. A thin cylinder neck roughened by rocks + a broad crag cap.
 */
export const hoodooPartType: PartType = {
  type: 'hoodoo',
  paramSchema: {
    heightM: { kind: 'number', min: 4, max: 18, default: 11 },
    capM:    { kind: 'number', min: 2, max: 10, default: 5 },   // cap diameter (the overhang)
    seed:    { kind: 'number', default: 0 },
  },
  resolve: (part, ctx) => ({
    params: {
      heightM: 11, capM: 5,
      ...(part.params ?? {}),
      seed: (part.params?.seed as number | undefined) ?? (ctx.seed >>> 0),
    },
  }),
  toPrims(p): Prim[] {
    const seed = (p.params.seed as number) >>> 0;
    const H = mToTiles(p.params.heightM as number);
    const cap = mToTiles(p.params.capM as number);
    const neckR = mToTiles(1.4);
    const parts: Prim[] = [
      { prim: 'cylinder', center: [0, 0], baseZ: 0, radius: neckR, height: H * 0.66, material: 'stone' },
    ];
    // rough the neck: rocks a touch WIDER than the cylinder so they break its surface
    for (let i = 0; i < 3; i++) {
      const z = (H * 0.6 / 3) * i;
      parts.push({ prim: 'rock', center: [0, 0], baseZ: z, radius: mToTiles(3.4 - 0.4 * i) / 2, seed: seed * 19 + i, jitter: 0.45, mat: 'stone' });
    }
    // the wide overhanging cap — much broader than the neck, jutting out all round
    parts.push({ prim: 'rock', center: [0, 0], baseZ: H * 0.62, radius: cap / 2, seed: seed * 19 + 8, jitter: 0.55, mat: 'stone' });
    parts.push({ prim: 'rock', center: [mToTiles(0.6), mToTiles(0.4)], baseZ: H * 0.82, radius: cap * 0.68 / 2, seed: seed * 19 + 9, jitter: 0.55, mat: 'stone' });
    return parts;
  },
  toCollision: (p) => footprintCells(p),
  toAnchors: () => [],
  toBrief: () => 'a hoodoo, a balanced rock on a slender weathered pedestal',
};
