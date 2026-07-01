// scripts/landform-preview.ts
// Spike: prove a NATURAL LANDFORM can be authored as a parametric mesh prop and
// rendered through the SAME self-lit compose→pack path as buildings — no img2img
// art, no heightfield. A sea arch is the test case: a real hole through rock,
// which a single-valued terrain heightfield physically cannot represent.
//   npx tsx scripts/landform-preview.ts
// PNGs land in .dev-grabs/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type Part, type StructureSpec, type StructureResult } from '../src/assetgen/compose';
import { mToTiles } from '../src/render/scale-contract';
import type { Vec3 } from '../src/assetgen/types';

const OUT = '.dev-grabs';

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

/** A weathered sea arch: a round rock ring (a real opening you can see the sea
 *  through) roughened by lumpy boulders at the abutments + crown so it reads as
 *  eroded stone rather than a clean masonry bridge. All existing prims. */
function seaArchSpec(seed = 1): StructureSpec {
  const span = mToTiles(13);     // 13 m clear arch — a dramatic headland gap
  const rise = mToTiles(8);
  const depth = mToTiles(6);     // chunky: a headland with a hole, not a thin gate
  const at: Vec3 = [0, 0, 0];
  const footR = mToTiles(4) / 2;
  const cy = depth / 2;
  const parts: Part[] = [
    { prim: 'arch', at, span, height: rise, thickness: depth, style: 'round', material: 'stone' },
    // weathered rock piers HUGGING the two feet (kept low + modest so they thicken
    // the legs into eroded stone without swallowing the opening)
    { prim: 'rock', center: [0.0, cy], baseZ: 0, radius: footR, seed: seed * 7 + 1, jitter: 0.55, mat: 'stone' },
    { prim: 'rock', center: [span, cy], baseZ: 0, radius: footR, seed: seed * 7 + 2, jitter: 0.55, mat: 'stone' },
    // eroded crown SITTING ON TOP of the spandrel (baseZ at the block top) to break
    // the clean rectangular silhouette into a natural rocky hump — never over the hole
    { prim: 'rock', center: [span * 0.58, cy * 0.92], baseZ: rise * 0.92, radius: mToTiles(8) / 2, seed: seed * 7 + 3, jitter: 0.62, mat: 'stone' },
    { prim: 'rock', center: [span * 0.30, cy * 1.1], baseZ: rise * 0.88, radius: mToTiles(6) / 2, seed: seed * 7 + 4, jitter: 0.62, mat: 'stone' },
  ];
  return { id: 'sea_arch', parts };
}

function h01(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** An OVERHANGING cliff face — a rock wall whose brow leans out PAST its base over
 *  the water (an undercut the heightfield can't do). A corbel stack of slabs each
 *  creeping seaward (+y) as it rises, roughened by crags. */
function cliffFaceSpec(seed = 1): StructureSpec {
  const w = mToTiles(11);        // width along the shore
  const baseD = mToTiles(4);     // base depth (kept slim so crags read past the box)
  const H = mToTiles(14);        // total height
  const slabs = 3;               // fewer, bolder corbel steps
  const overhang = mToTiles(6);  // how far the brow juts past the base
  const parts: Part[] = [];
  // Structural core: a short corbel stack gives the true undercut; kept narrow so the
  // rock crags below cloak it into a natural face.
  for (let i = 0; i < slabs; i++) {
    const t = i / (slabs - 1);
    const z = (H / slabs) * i;
    const shift = overhang * (t * t);
    const d = baseD + mToTiles(2) * t;
    parts.push({ prim: 'box', at: [w * 0.12, shift, z], size: [w * 0.76, d, H / slabs + 0.4], material: 'stone' });
  }
  // Cragging: MANY big noise-boulders CLOAK the whole box into rock — spread across
  // the full width, depth AND top, each nudged seaward with height so the overhang
  // reads as rock leaning over the water, not a bare slab.
  for (let i = 0; i < 20; i++) {
    const rz = H * (0.04 + 0.92 * h01(seed * 13 + i, 1));
    const t = rz / H;
    const lean = overhang * (t * t);                          // the face's seaward creep at this height
    const rx = w * (0.02 + 0.96 * h01(seed * 13 + i, 2));
    // cover the full depth of the (leaning) body, front to back
    const ry = lean * h01(seed * 13 + i, 5) + (baseD + mToTiles(1)) * h01(seed * 13 + i, 4) - mToTiles(0.5);
    const rr = mToTiles(4 + 3.5 * h01(seed * 13 + i, 3)) / 2;
    parts.push({ prim: 'rock', center: [rx, ry], baseZ: rz, radius: rr, seed: seed * 13 + i, jitter: 0.62, mat: 'stone' });
  }
  return { id: 'cliff_face', parts };
}

/** A CAVE MOUTH — a rock hillock with a dark arched recess bored into its seaward
 *  face (partway in, not through: a cave, not a tunnel). The heightfield can't hollow
 *  ground; this is a mesh. Crags cloak the box but leave the mouth clear. */
function caveMouthSpec(seed = 1): StructureSpec {
  const w = mToTiles(13), d = mToTiles(10), H = mToTiles(9);
  const mouthW = mToTiles(5.5), mouthH = mToTiles(5), recess = mToTiles(7);
  // Carve the +y face (the camera-facing FRONT, like a building's south door): the
  // aperture box spans from (d − recess) to just past d, so a dark hollow recesses
  // in from the front but stops short of the back → a cave, not a tunnel.
  const parts: Part[] = [
    { prim: 'box', at: [0, 0, 0], size: [w, d, H], material: 'stone',
      apertures: [{ at: [w / 2 - mouthW / 2, d - recess, 0], size: [mouthW, recess + 0.2, mouthH], arch: { axis: 'x', style: 'round', rise: mToTiles(2.4) } }] },
  ];
  // Crag cloak — cloak the box into a rock hill, but keep the FRONT-CENTRE mouth clear.
  for (let i = 0; i < 16; i++) {
    const rx = w * (0.04 + 0.92 * h01(seed * 17 + i, 2));
    const ry = d * (0.02 + 0.9 * h01(seed * 17 + i, 4));    // spread front-to-back
    const rz = H * (0.05 + 0.9 * h01(seed * 17 + i, 1));
    const nearMouth = Math.abs(rx - w / 2) < mouthW * 0.75 && ry > d - recess * 1.05 && rz < mouthH * 1.15;
    if (nearMouth) continue;                                 // don't wall up the cave
    const rr = mToTiles(4 + 3 * h01(seed * 17 + i, 3)) / 2;
    parts.push({ prim: 'rock', center: [rx, ry], baseZ: rz, radius: rr, seed: seed * 17 + i, jitter: 0.6, mat: 'stone' });
  }
  return { id: 'cave_mouth', parts };
}

/** A HOODOO / balanced rock — a slender rock pedestal capped by a far wider boulder
 *  that overhangs it on every side (a mushroom rock). The overhang is the point: a
 *  heightfield can't pinch a column narrower than its cap. Dots rocky highlands. */
function hoodooSpec(seed = 1): StructureSpec {
  const H = mToTiles(11);
  const parts: Part[] = [];
  // slender weathered pedestal (a tapering stack of small rocks on a thin cylinder)
  parts.push({ prim: 'cylinder', center: [0, 0], baseZ: 0, radius: mToTiles(1.6), height: H * 0.66, material: 'stone' });
  for (let i = 0; i < 3; i++) {
    const z = (H * 0.6 / 3) * i;
    parts.push({ prim: 'rock', center: [0, 0], baseZ: z, radius: mToTiles(2.2 - 0.2 * i) / 2, seed: seed * 19 + i, jitter: 0.4, mat: 'stone' });
  }
  // the wide overhanging cap — much broader than the neck, so it juts out all round
  parts.push({ prim: 'rock', center: [0, 0], baseZ: H * 0.62, radius: mToTiles(5) / 2, seed: seed * 19 + 8, jitter: 0.55, mat: 'stone' });
  parts.push({ prim: 'rock', center: [mToTiles(0.6), mToTiles(0.4)], baseZ: H * 0.82, radius: mToTiles(3.4) / 2, seed: seed * 19 + 9, jitter: 0.55, mat: 'stone' });
  return { id: 'hoodoo', parts };
}

async function dump(name: string, spec: StructureSpec) {
  const r: StructureResult = await composeStructure(spec, undefined, undefined);
  writeFileSync(join(OUT, `${name}-grey.png`), toPng(r.grey, r.size));
  console.log(`${name} → .dev-grabs/${name}-grey.png (${r.size}px), parts=${spec.parts.length}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await dump('sea-arch', seaArchSpec(1));
  await dump('cliff-face', cliffFaceSpec(1));
  await dump('cave-mouth', caveMouthSpec(1));
  await dump('hoodoo', hoodooSpec(1));
}

main();
