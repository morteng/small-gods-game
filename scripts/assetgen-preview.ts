// scripts/assetgen-preview.ts
// Render sample structures to grey + normal PNGs for eyeballing.
// Run: npx tsx scripts/assetgen-preview.ts
//
// Buildings are rendered through the REAL Blueprint pipeline (synthesizeBlueprint →
// toGeometry), so doors/windows appear as carved openings + flush leaf prims — exactly
// what the game renders. Primitives + linear structures stay as hand-authored specs.
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureSpec } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '../src/blueprint/presets';

const OUT = 'tmp/assetgen-preview';
mkdirSync(OUT, { recursive: true });

// Building presets rendered through the Blueprint pipeline (carved openings).
const PRESETS = [
  'cottage', 'tavern', 'temple_small', 'farm_barn', 'tower',
  'castle_keep', 'shrine', 'guard_post', 'yurt', 'longhouse',
];

// Hand-authored primitive + linear samples (no building features).
const PRIMS: Record<string, StructureSpec> = {
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
  // Timber palisade with corner posts and a gap-gate in the middle.
  palisade_gate:  { size: 512, parts: [{ prim: 'linear',
                      run: { kind: 'palisade', path: [[0,0],[5,0]], height: 2.6, thickness: 1, material: 'timber', posts: true, gates: [{ t: 2.5, width: 1.2 }] } }] },
  // Crenellated stone rampart turning a corner (L).
  rampart_corner: { size: 512, parts: [{ prim: 'linear',
                      run: { kind: 'rampart', path: [[0,0],[4,0],[4,4]], height: 3.5, thickness: 2, material: 'stone', crenellated: true, gates: [] } }] },
};

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

const dataUri = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

/** Count the door-material leaf prims a spec carries (the carved-opening fillers). */
function doorLeaves(spec: StructureSpec): number {
  return spec.parts.filter(p => p.prim === 'box' && p.material === 'door').length;
}
function apertureCount(spec: StructureSpec): number {
  return spec.parts.reduce((n, p) => n + (('apertures' in p && p.apertures) ? p.apertures.length : 0), 0);
}

async function render(name: string, spec: StructureSpec, bundle: Record<string, { grey: string; normal: string }>) {
  spec.size ??= 512;
  const r = await composeStructure(spec);
  const grey = toPng(r.grey, r.size);
  const normal = toPng(r.normal, r.size);
  await writeFile(join(OUT, `${name}-grey.png`), grey);
  await writeFile(join(OUT, `${name}-normal.png`), normal);
  bundle[name] = { grey: dataUri(grey), normal: dataUri(normal) };
  console.log(`${name}: bbox ${JSON.stringify(r.bbox)} · apertures ${apertureCount(spec)} · door-leaves ${doorLeaves(spec)} · vents ${r.anchors.vents.length}`);
}

async function main() {
  const bundle: Record<string, { grey: string; normal: string }> = {};
  for (const name of PRESETS) {
    const rb = synthesizeBlueprint(name);
    if (!rb) { console.warn(`(skip ${name}: no preset)`); continue; }
    await render(name, toGeometry(rb), bundle);
  }
  for (const [name, spec] of Object.entries(PRIMS)) await render(name, spec, bundle);
  // Embedded bundle so gallery.html relights via WebGL textures without a server (file:// CORS).
  await writeFile(join(OUT, 'assets-gallery.js'), `window.GALLERY = ${JSON.stringify(bundle)};\n`);
  console.log(`Wrote grey+normal PNGs + assets-gallery.js for ${PRESETS.length + Object.keys(PRIMS).length} samples to ${OUT}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
