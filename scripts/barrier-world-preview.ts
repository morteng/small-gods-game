// scripts/barrier-world-preview.ts
// Verify WORLD PLACEMENT of the chunked, lit barrier renderer offline — no browser/bus.
// Each barrier run is split into chunks (the SAME chunkBarrierRun the runtime uses), each
// composed to a sprite, then composited onto one canvas at the EXACT screen position the
// runtime would draw it (worldToScreen(refX,refY) mapped onto the chunk's normalised
// wallEnds[0] anchor). If a multi-chunk run reads as ONE seamless wall — chunks abutting with
// no gap/overlap, a corner meeting cleanly — the registration math is correct.
//
//   npx tsx scripts/barrier-world-preview.ts          # straight / L-corner / ring
// PNGs land in .dev-grabs/ (gitignored).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure } from '../src/assetgen/compose';
import { runElements } from '../src/render/parametric-barrier-source';
import { worldToScreen } from '../src/render/iso/iso-projection';
import { BARRIER_DEFAULTS, type BarrierRun } from '../src/world/barrier';

const OUT = '.dev-grabs';

interface Placed { grey: Uint8ClampedArray; cw: number; ch: number; ox: number; oy: number } // ox/oy = screen px of crop top-left

async function placeRun(run: BarrierRun): Promise<Placed[]> {
  const out: Placed[] = [];
  for (const el of runElements(run)) {
    const r = await composeStructure(el.spec(), undefined, { surfaceTexture: true });
    const bb = { x: Math.round(r.bbox.x), y: Math.round(r.bbox.y), w: Math.max(1, Math.round(r.bbox.w)), h: Math.max(1, Math.round(r.bbox.h)) };
    const a = el.anchor(r) ?? { x: 0.5, y: 1 };
    // Crop the chunk's grey to its opaque bbox.
    const crop = new Uint8ClampedArray(bb.w * bb.h * 4);
    for (let y = 0; y < bb.h; y++) {
      for (let x = 0; x < bb.w; x++) {
        const s = ((bb.y + y) * r.size + (bb.x + x)) * 4;
        const d = (y * bb.w + x) * 4;
        crop[d] = r.grey[s]; crop[d + 1] = r.grey[s + 1]; crop[d + 2] = r.grey[s + 2]; crop[d + 3] = r.grey[s + 3];
      }
    }
    const sc = worldToScreen(el.refX, el.refY, 0, 0, 0);
    out.push({ grey: crop, cw: bb.w, ch: bb.h, ox: sc.sx - a.x * bb.w, oy: sc.sy - a.y * bb.h });
  }
  return out;
}

/** Composite placed crops (painter's order = input order) into one PNG, auto-fit with margin. */
function composite(placed: Placed[], name: string): void {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.ox); minY = Math.min(minY, p.oy);
    maxX = Math.max(maxX, p.ox + p.cw); maxY = Math.max(maxY, p.oy + p.ch);
  }
  const M = 16;
  const W = Math.ceil(maxX - minX) + 2 * M, H = Math.ceil(maxY - minY) + 2 * M;
  const png = new PNG({ width: W, height: H });
  png.data.fill(0);
  // Sort by screen-y of the foot so nearer chunks draw over farther (rough y-sort).
  const order = [...placed].sort((a, b) => (a.oy + a.ch) - (b.oy + b.ch));
  for (const p of order) {
    const baseX = Math.round(p.ox - minX + M), baseY = Math.round(p.oy - minY + M);
    for (let y = 0; y < p.ch; y++) {
      for (let x = 0; x < p.cw; x++) {
        const s = (y * p.cw + x) * 4;
        if (p.grey[s + 3] === 0) continue;
        const dx = baseX + x, dy = baseY + y;
        if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
        const d = (dy * W + dx) * 4;
        png.data[d] = p.grey[s]; png.data[d + 1] = p.grey[s + 1]; png.data[d + 2] = p.grey[s + 2]; png.data[d + 3] = 255;
      }
    }
  }
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, PNG.sync.write(png));
  console.log(`${name} → ${file} (${W}×${H}, ${placed.length} chunks)`);
}

async function main(): Promise<void> {
  const wall = { ...BARRIER_DEFAULTS.wall, crenellated: true, thickness: 2, height: 3 };
  // Straight 12-tile crenellated wall (3 chunks) — must read continuous.
  composite(await placeRun({ kind: 'wall', path: [[0, 0], [12, 0]], ...wall, gates: [] }), 'place-straight');
  // Straight wall with a centred arched gate — the arch crown must sit BELOW the parapet, with
  // masonry + merlons spanning over it (a real gateway), flanked by twin towers.
  composite(await placeRun({ kind: 'wall', path: [[0, 0], [12, 0]], ...wall, gates: [{ t: 6, width: 2.5 }] }), 'place-gate');
  // Unobstructed arch: a plain (uncrenellated → no towers/merlons) masonry wall, single gate.
  composite(await placeRun({ kind: 'wall', path: [[0, 0], [8, 0]], material: 'stone', height: 3, thickness: 1, crenellated: false, gates: [{ t: 4, width: 2.5 }] }), 'place-gate-plain');
  // L-corner — two legs meeting at a right angle; chunks must meet cleanly at the bend.
  composite(await placeRun({ kind: 'wall', path: [[0, 0], [10, 0], [10, 10]], ...wall, gates: [] }), 'place-corner');
  // Rectangular town-wall ring with a gate on the south edge.
  composite(await placeRun({ kind: 'wall', path: [[0, 0], [14, 0], [14, 10], [0, 10], [0, 0]], ...wall, gates: [{ t: 7, width: 3 }] }), 'place-ring');
}

main().catch((e) => { console.error(e); process.exit(1); });
