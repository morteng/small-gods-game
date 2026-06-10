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

const MAP_KEYS = ['grey', 'normal', 'material', 'emissive'] as const;
type MapKey = typeof MAP_KEYS[number];
interface Sample { name: string; size: number; maps: Record<MapKey, Uint8ClampedArray> }

async function render(
  name: string, spec: StructureSpec,
  bundle: Record<string, Record<MapKey, string>>, samples: Sample[],
) {
  // No size override: presets (size unset) render at their TRUE fixed-metric size, so the
  // gallery shows honest relative scale (a 4-storey keep dwarfs a 1-storey cottage).
  // Hand-authored PRIMS still carry their own explicit size.
  const r = await composeStructure(spec);
  const maps: Record<MapKey, Uint8ClampedArray> = { grey: r.grey, normal: r.normal, material: r.material, emissive: r.emissive };
  const uris = {} as Record<MapKey, string>;
  for (const k of MAP_KEYS) {
    const png = toPng(maps[k], r.size);
    await writeFile(join(OUT, `${name}-${k}.png`), png);
    uris[k] = dataUri(png);
  }
  bundle[name] = uris;
  samples.push({ name, size: r.size, maps });
  console.log(`${name}: bbox ${JSON.stringify(r.bbox)} · apertures ${apertureCount(spec)} · door-leaves ${doorLeaves(spec)} · vents ${r.anchors.vents.length}`);
}

/** One row per sample, one column per map — a single eyeball-everything PNG. */
function contactSheet(samples: Sample[]): Buffer {
  const PAD = 8;
  const cell = Math.max(...samples.map(s => s.size));
  const W = PAD + MAP_KEYS.length * (cell + PAD);
  const H = PAD + samples.length * (cell + PAD);
  const sheet = new Uint8ClampedArray(W * H * 4);
  // dark backdrop so transparent + emissive-black regions read
  for (let i = 0; i < W * H; i++) sheet.set([24, 24, 28, 255], i * 4);
  samples.forEach((s, row) => {
    MAP_KEYS.forEach((k, col) => {
      const ox = PAD + col * (cell + PAD) + ((cell - s.size) >> 1);
      const oy = PAD + row * (cell + PAD) + ((cell - s.size) >> 1);
      // material packs data in alpha (metallic) — show it wherever the SPRITE
      // is opaque (grey's alpha), forced opaque, or the column reads as blank.
      const src = s.maps[k];
      const cover = k === 'grey' || k === 'normal' ? src : s.maps.grey;
      for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) {
        const si = (y * s.size + x) * 4;
        if (cover[si + 3] === 0) continue;
        const di = ((oy + y) * W + ox + x) * 4;
        sheet[di] = src[si]; sheet[di + 1] = src[si + 1]; sheet[di + 2] = src[si + 2]; sheet[di + 3] = 255;
      }
    });
  });
  const png = new PNG({ width: W, height: H });
  png.data = Buffer.from(sheet.buffer, sheet.byteOffset, sheet.byteLength);
  return PNG.sync.write(png);
}

async function main() {
  const bundle: Record<string, Record<MapKey, string>> = {};
  const samples: Sample[] = [];
  for (const name of PRESETS) {
    const rb = synthesizeBlueprint(name);
    if (!rb) { console.warn(`(skip ${name}: no preset)`); continue; }
    await render(name, toGeometry(rb), bundle, samples);
  }
  for (const [name, spec] of Object.entries(PRIMS)) await render(name, spec, bundle, samples);
  // Embedded bundle so gallery.html relights via WebGL textures without a server (file:// CORS).
  await writeFile(join(OUT, 'assets-gallery.js'), `window.GALLERY = ${JSON.stringify(bundle)};\n`);
  await writeFile(join(OUT, 'contact-sheet.png'), contactSheet(samples));
  console.log(`Wrote ${MAP_KEYS.join('/')} PNGs + contact-sheet.png + assets-gallery.js for ${samples.length} samples to ${OUT}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
