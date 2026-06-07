// scripts/assetgen-preview.ts
// Render a sample structure to grey + normal PNGs for eyeballing.
// Run: npx tsx scripts/assetgen-preview.ts
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureSpec } from '../src/assetgen/compose';
import type { Wing } from '../src/assetgen/geometry/building';

const OUT = 'tmp/assetgen-preview';
mkdirSync(OUT, { recursive: true });

const SAMPLES: Record<string, StructureSpec> = {
  hut: { size: 512, parts: [
    { prim: 'box', at: [0,0,0], size: [2.4,2.4,2.2], material: 'plaster' },
    { prim: 'cone', center: [1.2,1.2], baseZ: 2.2, radius: 1.7, height: 1.8, material: 'thatch', sides: 16 },
  ]},
  trilithon: { size: 512, parts: [
    { prim: 'arch', at: [0,0,0], span: 2.4, height: 3.0, thickness: 0.55, material: 'stone' },
  ]},
  tree: { size: 512, parts: [
    { prim: 'cylinder', center: [1,1], baseZ: 0, radius: 0.22, height: 1.4, material: 'bark', sides: 8 },
    { prim: 'ellipsoid', center: [1,1], baseZ: 1.2, radii: [1.1,1.1,1.3], material: 'foliage' },
  ]},
  boulder: { size: 512, parts: [
    { prim: 'ellipsoid', center: [1,1], baseZ: 0, radii: [1.2,0.9,0.8], material: 'stone' },
  ]},
  cottage:      { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3, roof:'gable' }] as Wing[] }] },
  tavern:       { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3, storeys:2, roof:'hip' }] as Wing[] }] },
  longhouse:    { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:4,h:2, roof:'gable' }] as Wing[] }] },
  l_house:      { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:4,h:2, roof:'gable' }, { x:0,y:0,w:2,h:4, roof:'gable' }] as Wing[] }] },
  cross_chapel: { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:1,w:4,h:2, roof:'gable' }, { x:1,y:0,w:2,h:4, roof:'gable' }] as Wing[] }] },
};

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

async function main() {
  for (const [name, spec] of Object.entries(SAMPLES)) {
    const r = await composeStructure(spec);
    await writeFile(join(OUT, `${name}-grey.png`), toPng(r.grey, r.size));
    await writeFile(join(OUT, `${name}-normal.png`), toPng(r.normal, r.size));
    console.log(`${name}: bbox ${JSON.stringify(r.bbox)}`);
  }
  console.log(`Wrote grey+normal PNGs for ${Object.keys(SAMPLES).length} samples to ${OUT}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
