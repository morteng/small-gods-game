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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const spec = seaArchSpec(1);
  const r: StructureResult = await composeStructure(spec, undefined, undefined);
  writeFileSync(join(OUT, 'sea-arch-grey.png'), toPng(r.grey, r.size));
  writeFileSync(join(OUT, 'sea-arch-normal.png'), toPng(r.normal, r.size));
  console.log(`sea_arch → .dev-grabs/sea-arch-grey.png + -normal.png (${r.size}px), parts=${spec.parts.length}`);
}

main();
