// scripts/spike-biped-bake.ts
//
// SPIKE — procedurally-modelled 3D biped on a skeleton, posed into a walk cycle,
// baked to animation sprites through the SAME geometry→SpritePack pipeline that
// buildings and flora use (composeStructure). Proves the "bake voxel/parametric
// biped → 8-dir + animation-frame atlas" seam shared with the flora multi-view
// plan ([[project-flora-multiview-atlas]], [[project-generative-npc-system]]).
//
// How it maps onto the existing pipeline:
//   - The rig's BONES are flora `Limb`s (tapered capsule segments a→b, r0→r1) —
//     the exact same primitive trees use for branches.
//   - Each animation frame is a FK pose → a fresh `{ prim:'flora', limbs, leaves }`
//     part → `composeStructure(spec, undefined, { yaw })`.
//   - No `spec.size` ⇒ the `fixedFit` path ⇒ constant metric scale across every
//     frame/yaw (no "breathing"); we just crop to the returned opaque bbox and
//     bottom-centre into fixed cells.
//   - Pure-flora specs skip weathering and render as clean lit massing — same as
//     in-game buildings today (money freeze: no img2img skin here; that's the
//     later overlay).
//
// Run:  npx tsx scripts/spike-biped-bake.ts
// Out:  tmp/biped-spike/{walk-albedo.png, walk-normal.png}  (rows = 8 yaws, cols = 8 frames)

import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureSpec } from '../src/assetgen/compose';
import type { Limb, Leaf } from '../src/assetgen/geometry/flora/turtle';
import type { Vec3 } from '../src/assetgen/types';

const OUT = 'tmp/biped-spike';
mkdirSync(OUT, { recursive: true });

// ────────────────────────────────────────────────────────────────────────────
// Vector helpers (z-up world, +y = walk-forward, +x = character's right).
// ────────────────────────────────────────────────────────────────────────────
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** Rotate `v` about the X axis by `a` (fore-aft swing: +a tips a down-vector toward +y). */
const rotX = (v: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
};
/** Rotate `v` about the X axis around pivot `p` (used to lean the whole upper body). */
const rotXAbout = (v: Vec3, p: Vec3, a: number): Vec3 => add(rotX([v[0] - p[0], v[1] - p[1], v[2] - p[2]], a), p);

// ────────────────────────────────────────────────────────────────────────────
// Rig proportions — tile units (1 tile = 2 m). Total ~0.92 tile ≈ 1.85 m.
// ────────────────────────────────────────────────────────────────────────────
const FOOT_Z = 0.04, SHIN = 0.20, THIGH = 0.21, SPINE = 0.24, NECK = 0.10;
const HIP_HALF = 0.085, SHOULDER_HALF = 0.115, UPPER_ARM = 0.16, FORE_ARM = 0.15;
const HIP_Z = FOOT_Z + SHIN + THIGH;            // pelvis height when legs straight

// Walk-cycle amplitudes (radians).
const STRIDE = 0.50;   // hip fore-aft swing
const KNEE = 0.95;     // peak knee flex during the swing phase
const ARM = 0.40;      // shoulder counter-swing
const LEAN = 0.10;     // constant forward lean into the walk

/** Build the biped's bones (limbs) + blobs (leaves) for walk-cycle phase `p` ∈ [0,2π). */
function poseBiped(p: number): { limbs: Limb[]; leaves: Leaf[] } {
  const bob = 0.02 * (1 - Math.cos(2 * p)) * 0.5;            // pelvis dips at double-support
  const pelvis: Vec3 = [0, 0, HIP_Z - bob];
  const limbs: Limb[] = [];
  const leaves: Leaf[] = [];

  // ── Legs (side: +1 right, -1 left; left leads half a cycle out of phase). ──
  for (const side of [1, -1] as const) {
    const q = p + (side < 0 ? Math.PI : 0);
    const hip: Vec3 = add(pelvis, [side * HIP_HALF, 0, 0]);
    const hipSwing = STRIDE * Math.sin(q);
    const kneeFlex = KNEE * Math.max(0, Math.sin(q + 0.7));   // flex only while lifting/swinging
    const knee = add(hip, rotX([0, 0, -THIGH], hipSwing));
    const ankle = add(knee, rotX([0, 0, -SHIN], hipSwing - kneeFlex));
    limbs.push({ a: hip, b: knee, r0: 0.075, r1: 0.06 });    // thigh
    limbs.push({ a: knee, b: ankle, r0: 0.06, r1: 0.045 });  // shin
    leaves.push({ at: add(ankle, [0, 0.05, -0.02]), r: 0.055 }); // foot
  }
  // Pelvis mass.
  limbs.push({ a: add(pelvis, [-HIP_HALF, 0, 0]), b: add(pelvis, [HIP_HALF, 0, 0]), r0: 0.1, r1: 0.1 });

  // ── Upper body (built upright, then leaned forward about the pelvis). ──
  const chest0: Vec3 = add(pelvis, [0, 0, SPINE]);
  const neckTop0: Vec3 = add(chest0, [0, 0, NECK]);
  const lean = (v: Vec3) => rotXAbout(v, pelvis, LEAN);
  const chest = lean(chest0);
  const neckTop = lean(neckTop0);
  limbs.push({ a: pelvis, b: chest, r0: 0.13, r1: 0.115 });  // torso
  limbs.push({ a: chest, b: neckTop, r0: 0.05, r1: 0.045 }); // neck
  leaves.push({ at: add(neckTop, rotX([0, 0.01, 0.055], LEAN)), r: 0.09 }); // head (leaned forward)

  // Shoulder bar + arms (arms counter-swing vs the same-side leg).
  for (const side of [1, -1] as const) {
    const qLeg = p + (side < 0 ? Math.PI : 0);
    const shoulder = lean(add(chest0, [side * SHOULDER_HALF, 0, 0]));
    const armSwing = -ARM * Math.sin(qLeg);
    const elbow = add(shoulder, rotX([0, 0, -UPPER_ARM], armSwing));
    const wrist = add(elbow, rotX([0, 0, -FORE_ARM], armSwing * 0.6 + 0.2));
    limbs.push({ a: shoulder, b: elbow, r0: 0.052, r1: 0.044 });
    limbs.push({ a: elbow, b: wrist, r0: 0.044, r1: 0.038 });
    leaves.push({ at: wrist, r: 0.045 }); // hand
  }
  limbs.push({ a: lean(add(chest0, [-SHOULDER_HALF, 0, 0])), b: lean(add(chest0, [SHOULDER_HALF, 0, 0])), r0: 0.07, r1: 0.07 });

  return { limbs, leaves };
}

function specFor(p: number): StructureSpec {
  const { limbs, leaves } = poseBiped(p);
  // Uniform pale "clay homunculus" massing — barkMat = limbs, foliageMat = blobs.
  return { id: 'spike_biped', parts: [{ prim: 'flora', limbs, leaves, barkMat: 'plaster', foliageMat: 'plaster' }] };
}

// ────────────────────────────────────────────────────────────────────────────
// Bake: 8 frames × 8 yaws, both albedo (grey) and normal maps.
// ────────────────────────────────────────────────────────────────────────────
const FRAMES = 8, YAWS = 8;
type Baked = { grey: Uint8ClampedArray; normal: Uint8ClampedArray; size: number; bx: number; by: number; bw: number; bh: number };

async function bakeAll(): Promise<Baked[][]> {
  const rows: Baked[][] = [];
  for (let y = 0; y < YAWS; y++) {
    const yaw = (y / YAWS) * Math.PI * 2;
    const row: Baked[] = [];
    for (let f = 0; f < FRAMES; f++) {
      const p = (f / FRAMES) * Math.PI * 2;
      const r = await composeStructure(specFor(p), undefined, { yaw });
      row.push({ grey: r.grey, normal: r.normal, size: r.size, bx: r.bbox.x, by: r.bbox.y, bw: r.bbox.w, bh: r.bbox.h });
    }
    rows.push(row);
    process.stdout.write(`  yaw ${y + 1}/${YAWS} baked\n`);
  }
  return rows;
}

/** Composite each cell's opaque bbox, bottom-centred, into one contact sheet. */
function sheet(rows: Baked[][], pick: (b: Baked) => Uint8ClampedArray, bg: [number, number, number, number]): PNG {
  const maxW = Math.max(...rows.flat().map(b => b.bw));
  const maxH = Math.max(...rows.flat().map(b => b.bh));
  const pad = 6;
  const cw = maxW + pad * 2, ch = maxH + pad * 2;
  const W = cw * FRAMES, H = ch * YAWS;
  const out = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    out.data[i * 4] = bg[0]; out.data[i * 4 + 1] = bg[1]; out.data[i * 4 + 2] = bg[2]; out.data[i * 4 + 3] = bg[3];
  }
  rows.forEach((row, ry) => row.forEach((b, cx) => {
    const src = pick(b);
    const offX = cx * cw + pad + Math.floor((maxW - b.bw) / 2);   // h-centre
    const offY = ry * ch + pad + (maxH - b.bh);                   // bottom-anchor
    for (let yy = 0; yy < b.bh; yy++) for (let xx = 0; xx < b.bw; xx++) {
      const si = ((b.by + yy) * b.size + (b.bx + xx)) * 4;
      if (src[si + 3] === 0) continue;
      const di = ((offY + yy) * W + (offX + xx)) * 4;
      out.data[di] = src[si]; out.data[di + 1] = src[si + 1]; out.data[di + 2] = src[si + 2]; out.data[di + 3] = 255;
    }
  }));
  return out;
}

async function main() {
  console.log('Baking procedural biped walk cycle (8 frames × 8 yaws) through composeStructure…');
  const rows = await bakeAll();
  const albedo = sheet(rows, b => b.grey, [24, 24, 30, 255]);
  const normal = sheet(rows, b => b.normal, [128, 128, 255, 255]);
  await writeFile(join(OUT, 'walk-albedo.png'), PNG.sync.write(albedo));
  await writeFile(join(OUT, 'walk-normal.png'), PNG.sync.write(normal));
  const s = rows[0][0];
  console.log(`\nDone. Sample cell bbox: ${s.bw}×${s.bh}px (canvas ${s.size}px, fixedFit metric scale).`);
  console.log(`  ${join(OUT, 'walk-albedo.png')}`);
  console.log(`  ${join(OUT, 'walk-normal.png')}`);
  console.log('Rows = 8 yaw directions, columns = 8 walk-cycle frames.');
}

main().catch(e => { console.error(e); process.exit(1); });
