// scripts/barrier-preview.ts
// The look → measure → refine loop for WALLS AND TOWERS — the barrier half of the reference
// library, and the analogue of `building-preview.ts` for geometry that isn't a building preset.
//
// Why it exists: the reference loop only spoke "building preset", so tower and wall geometry could
// only ever be checked by eye, on an 8-minute all-or-nothing render of the whole barrier battery.
// Both reported tower defects (corner merlons, drum proportions) are ASSEMBLY defects — a tower
// against a curtain — and they are also plain NUMBERS, which `--metrics` prints for free.
//
//   npx tsx scripts/barrier-preview.ts --list                       # the scenes
//   npx tsx scripts/barrier-preview.ts wall-drum-corner             # compose one joint → PNG (LIT)
//   npx tsx scripts/barrier-preview.ts wall-drum-corner --flat      # unlit massing (silhouette only)
//   npx tsx scripts/barrier-preview.ts wall-drum-corner --views     # + a yaw 0/90/180/270 strip
//   npx tsx scripts/barrier-preview.ts --metrics                    # numbers only, no render (FREE, instant)
//   npx tsx scripts/barrier-preview.ts wall-square-gate --tti       # PRINT the reference prompt (FREE)
//   OPENROUTER_API_KEY=… … --tti --go                               # GENERATE a reference (~$0.01, SPENDS)
//
// PNGs land in .dev-grabs/ (gitignored); generated references in reference-library/tti/<slug>/.
// NOTE: compose has one fixed 2:1 iso projector — `--views` is a turntable (yaw), not an
// orthographic elevation. Read proportions off `--metrics`, not off the picture.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureResult } from '../src/assetgen/compose';
import { litRgba } from '../src/assetgen/lit-preview';
import { barrierSubjects, barrierSubject } from '../src/assetgen/reference-subject';
import { towerSpec } from '../src/assetgen/geometry/tower-spec';
import { toothRun, toothRunMetrics, parapetHeight, MERLON_PERIOD_TILES } from '../src/assetgen/geometry/battlement';
import { METRES_PER_TILE } from '../src/render/scale-contract';
import { generateTti, REF, TTI_MODEL, apiKey } from './tti-generate';

const OUT = '.dev-grabs';
/** Per-view canvas for `--views` (px) — every yaw composes into this same box. */
const VIEW_CELL = 640;

function toPng(buf: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

/** Lay several square renders side by side into one strip. Every view MUST already be the same
 *  canvas (see `VIEW_CELL`): a rotated scene's bounds differ per yaw, so composing each view at
 *  its natural size and blitting them with one stride sheared views 2..n into diagonal garbage
 *  that still looked like masonry — a preview that lies. Mismatches now throw instead. */
function strip(views: StructureResult[], pixels: (v: StructureResult) => Uint8ClampedArray): { buf: Uint8ClampedArray; w: number; h: number } {
  const s = views[0].size, w = s * views.length;
  const odd = views.find((v) => v.size !== s);
  if (odd) throw new Error(`strip(): view sizes differ (${s} vs ${odd.size}) — pin spec.size`);
  const buf = new Uint8ClampedArray(w * s * 4);
  views.forEach((v, i) => {
    const src0 = pixels(v);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const src = (y * s + x) * 4, dst = (y * w + i * s + x) * 4;
        buf[dst] = src0[src]; buf[dst + 1] = src0[src + 1];
        buf[dst + 2] = src0[src + 2]; buf[dst + 3] = src0[src + 3];
      }
    }
  });
  return { buf, w, h: s };
}

const m = (tiles: number): string => `${(tiles * METRES_PER_TILE).toFixed(2)} m`;

/**
 * The numeric report: everything about a tower crown that can be wrong WITHOUT looking at it.
 * Runs in milliseconds and needs no compose, so it is the first thing to read after a change.
 */
function printMetrics(): void {
  console.log('TOWER PROPORTIONS  (curtain height × thickness → tower)\n');
  console.log('  form    curtain      tower H     footprint   aspect  teeth     rise over wall');
  for (const [h, th] of [[1.5, 1], [3, 1], [3, 2], [3.5, 2], [4, 3]] as const) {
    for (const round of [true, false] as const) {
      const t = towerSpec({ curtainHeight: h, curtainThickness: th, material: 'stone', round });
      const topZ = Math.max(...t.parts.map((p) => (p.prim === 'box' ? p.at[2] + p.size[2]
        : p.prim === 'cylinder' || p.prim === 'column' ? (p.baseZ ?? 0) + p.height : 0)));
      const aspect = topZ / t.side;
      const flag = aspect < 1.8 - 1e-6 ? '  ← reads as a bulge, not a tower' : '';
      // Tooth height is the wall's own parapet rule — printed so a tower/curtain drift shows up
      // as a number instead of as "the merlons look stubby" three renders later.
      console.log(`  ${round ? 'drum  ' : 'square'}  ${m(h).padEnd(8)}×${String(th).padEnd(3)} `
        + `${m(topZ).padEnd(10)} ${m(t.side).padEnd(11)} ${aspect.toFixed(2).padEnd(7)} `
        + `${m(parapetHeight(h)).padEnd(9)} ${m(topZ - h)}${flag}`);
    }
  }

  console.log('\nPARAPET TOOTH RUNS  (a run must be symmetric: lead gap == trail gap)\n');
  console.log('  span        teeth  pitch     lead gap  trail gap  symmetry');
  for (const span of [2.35, 3.05, 4.0, 5.7, 9.3, 12.0]) {
    const r = toothRunMetrics(toothRun(0, span), 0, span);
    const bad = Math.abs(r.leadGap - r.trailGap) > 1e-6 || r.symmetryResidual > 1e-6;
    console.log(`  ${m(span).padEnd(11)} ${String(r.count).padEnd(6)} ${m(r.pitch).padEnd(9)} `
      + `${m(r.leadGap).padEnd(9)} ${m(r.trailGap).padEnd(10)} ${bad ? 'ASYMMETRIC' : 'ok'}`);
  }
  console.log(`\n  (target pitch ${m(MERLON_PERIOD_TILES)}; a run shorter than half a pitch carries no tooth)`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (f: string): boolean => argv.includes(`--${f}`);
  const slug = argv.find((a) => !a.startsWith('--'));

  if (flag('list')) {
    console.log('barrier scenes:');
    for (const s of barrierSubjects()) console.log(`  ${s.slug.padEnd(20)} ${s.summary}`);
    return;
  }
  if (flag('metrics') || (!slug && argv.length === 0)) { printMetrics(); return; }

  if (!slug) { console.error('usage: barrier-preview.ts <scene> [--views] [--metrics] [--tti [--go]] | --list'); process.exit(1); }
  const subject = barrierSubject(slug);
  if (!subject) {
    console.error(`unknown scene "${slug}" — try --list`);
    process.exit(1);
  }

  if (flag('tti')) {
    const prompt = subject.ttiPrompt();
    console.log(`\n── TTI prompt for ${subject.slug} ─────────────────────────────\n${prompt}\n`);
    if (!flag('go')) { console.log('(print only — pass --go to GENERATE, which SPENDS ~$0.01)'); return; }
    if (!apiKey) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }
    const dir = join(REF, subject.slug);
    mkdirSync(dir, { recursive: true });
    const png = await generateTti(prompt);
    writeFileSync(join(dir, 'model-tti.png'), png);
    writeFileSync(join(dir, 'prompt.txt'), prompt);
    console.log(`reference → ${join(dir, 'model-tti.png')} (${TTI_MODEL})`);
  }

  const spec = await subject.massing();
  mkdirSync(OUT, { recursive: true });
  // LIT by default: compose emits a normal + material buffer beside the albedo and the game
  // shades them, so an unlit `grey` dump is not "neutral" — it is a render with the form removed.
  // Flat massing stays one flag away for silhouette-only reads.
  const pixels = flag('flat')
    ? (v: StructureResult): Uint8ClampedArray => v.grey
    : (v: StructureResult): Uint8ClampedArray => litRgba(v);
  const how = flag('flat') ? 'flat' : 'lit';
  if (flag('views')) {
    // Quarter turns by default, NOT 0/45/90/135: a curtain only carries its parapet on the
    // OUTWARD face, so a strip that never passes 180° shows one side of every wall and invites
    // "the merlons are missing" readings of walls being viewed from inside. `--yaws=a,b,…` (deg)
    // overrides.
    const yawArg = argv.find((a) => a.startsWith('--yaws='))?.slice(7);
    const degs = yawArg ? yawArg.split(',').map(Number).filter((n) => Number.isFinite(n)) : [0, 90, 180, 270];
    const yaws = degs.map((d) => (d * Math.PI) / 180);
    const views = [];
    // Pin the canvas so every yaw fits the SAME box — a scene is wider on the diagonal than
    // square-on, and letting each view size itself is what sheared the strip.
    for (const yaw of yaws) views.push(await composeStructure({ ...spec, size: VIEW_CELL }, undefined, { surfaceTexture: true, yaw }));
    const { buf, w, h } = strip(views, pixels);
    const file = join(OUT, `${subject.slug}-views.png`);
    writeFileSync(file, toPng(buf, w, h));
    console.log(`${subject.slug} → ${file} (${w}×${h}, ${how}, yaw ${degs.join('/')}°)`);
  } else {
    const r = await composeStructure(spec, undefined, { surfaceTexture: true });
    const file = join(OUT, `${subject.slug}.png`);
    writeFileSync(file, toPng(pixels(r), r.size, r.size));
    console.log(`${subject.slug} → ${file} (${r.size}×${r.size}, ${how})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
