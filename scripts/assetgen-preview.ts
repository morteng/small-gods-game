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
  // ── medieval typology: each exercises a different slice of the parametric surface ──
  // Stone-walled thatched cottage — seeded default main door + ridge chimney.
  cottage:        { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3 }] as Wing[],
                      wallMat: 'plaster', roofMat: 'thatch', seed: 11 }] },
  // Jettied Tudor townhouse — oversailing 1st floor, hip roof, twin ridge chimneys, grand door.
  jettied_house:  { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3, storeys:2, jetty:0.4 }] as Wing[],
                      wallMat: 'plaster', roofMat: 'tile', roofStyle: 'hip',
                      features: { doors: [{ face:'south', main:true }], vents: [{ wing:0, t:0.3 }, { wing:0, t:0.7 }] } }] },
  // Longhouse with the ridge along its LONG (E–W) axis — the default orientation.
  longhouse_ew:   { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:4,h:2 }] as Wing[],
                      wallMat: 'timber', roofMat: 'thatch',
                      features: { doors: [{ face:'south', main:true }], vents: [{ wing:0, t:0.28 }] } }] },
  // The same longhouse turned 90° — a long N–S footprint (orientation = the footprint's long axis).
  longhouse_ns:   { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:2,h:4 }] as Wing[],
                      wallMat: 'timber', roofMat: 'thatch',
                      features: { doors: [{ face:'east', main:true }], vents: [{ wing:0, t:0.3 }] } }] },
  // Lateral-stack cottage — the big exterior brick chimney climbing the gable-end wall.
  lateral_stack:  { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:3 }] as Wing[],
                      wallMat: 'plaster', roofMat: 'thatch',
                      features: { doors: [{ face:'south', main:true }], vents: [{ wing:0, t:0.5, placement:'wall', face:'east', height:1.2 }] } }] },
  // Open hall house — one tall storey, central smoke-hole (no chimney).
  hall_house:     { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:3,h:4, storeys:1 }] as Wing[],
                      wallMat: 'timber', roofMat: 'thatch',
                      features: { doors: [{ face:'south', main:true }], vents: [{ wing:0, t:0.5, kind:'smokehole' }] } }] },
  // Stone tower / pele — three storeys, pyramidal cap, single door, no smoke.
  tower:          { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:2,h:2, storeys:3, roof:'pyramidal' }] as Wing[],
                      wallMat: 'stone', roofMat: 'tile',
                      features: { doors: [{ face:'south', main:true }], vents: [] } }] },
  // L-plan manor — a MAIN door centred on the south range + a secondary east door.
  manor_l:        { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:0,w:4,h:2 }, { x:0,y:0,w:2,h:4 }] as Wing[],
                      wallMat: 'stone', roofMat: 'tile',
                      features: { doors: [{ face:'south', main:true }, { face:'east' }], vents: [{ wing:0, t:0.3 }] } }] },
  // Cross-plan chapel — grand door on the transept gable, no chimney (clean valleys).
  cross_chapel:   { size: 512, parts: [{ prim: 'building', wings: [{ x:0,y:1,w:4,h:2 }, { x:1,y:0,w:2,h:4 }] as Wing[],
                      wallMat: 'stone', roofMat: 'tile',
                      features: { doors: [{ cell:[1,3], face:'south', main:true }], vents: [] } }] },

  // ── linear structures (walls / fences / ramparts / palisades) ──
  // Timber palisade with corner posts and a gap-gate in the middle.
  palisade_gate:  { size: 512, parts: [{ prim: 'linear',
                      run: { kind: 'palisade', path: [[0,0],[5,0]], height: 2.6, thickness: 1, material: 'timber', posts: true, gates: [{ t: 2.5, width: 1.2 }] } }] },
  // Crenellated stone rampart turning a corner (L) — battlemented merlons + clean mitred join.
  rampart_corner: { size: 512, parts: [{ prim: 'linear',
                      run: { kind: 'rampart', path: [[0,0],[4,0],[4,4]], height: 3.5, thickness: 2, material: 'stone', crenellated: true, gates: [] } }] },
};

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

const dataUri = (png: Buffer): string => `data:image/png;base64,${png.toString('base64')}`;

async function main() {
  const bundle: Record<string, { grey: string; normal: string }> = {};
  for (const [name, spec] of Object.entries(SAMPLES)) {
    const r = await composeStructure(spec);
    const grey = toPng(r.grey, r.size);
    const normal = toPng(r.normal, r.size);
    await writeFile(join(OUT, `${name}-grey.png`), grey);
    await writeFile(join(OUT, `${name}-normal.png`), normal);
    bundle[name] = { grey: dataUri(grey), normal: dataUri(normal) };
    const a = r.anchors;
    const main = a.doors.find(d => d.main);
    const door = main ? `main(${main.x.toFixed(2)},${main.y.toFixed(2)})` : a.doors.length ? `${a.doors.length} doors` : 'none';
    console.log(`${name}: bbox ${JSON.stringify(r.bbox)} · ${door}+${a.doors.length - (main ? 1 : 0)} · vents ${a.vents.length}`);
  }
  // Embedded bundle so gallery.html relights via WebGL textures without a server (file:// CORS).
  await writeFile(join(OUT, 'assets-gallery.js'), `window.GALLERY = ${JSON.stringify(bundle)};\n`);
  console.log(`Wrote grey+normal PNGs + assets-gallery.js for ${Object.keys(SAMPLES).length} samples to ${OUT}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
