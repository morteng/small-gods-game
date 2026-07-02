// scripts/building-preview.ts
// Render any building preset to a PNG offline — deterministic, browserless, ~1s, immune to
// system load. The fast path for verifying GEOMETRY (massing, openings, the interior cutaway:
// rooms / funnel / rood screen) without the loaded-renderer grab dance (dev server → new world
// → select → async warm → CDP grab, which is flaky under load). Reserve the in-game grab for
// what only it shows (lighting, the reveal interaction, terrain interplay, draw-cache).
//
// Run:
//   npx tsx scripts/building-preview.ts parish-church manor          # closed sprites
//   npx tsx scripts/building-preview.ts parish-church --cutaway      # roof-off interior view
//   npx tsx scripts/building-preview.ts cottage --both               # closed + cutaway pair
//   npx tsx scripts/building-preview.ts --list                       # list known presets
// PNGs land in .dev-grabs/ (gitignored). Default map is `grey` (massing reads clearest);
// pass --albedo / --normal / --material to dump those instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { composeStructure, type StructureResult } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint, BUILDING_BLUEPRINTS } from '../src/blueprint/presets/index';
import { cutawayOf } from '../src/blueprint/cutaway';
import type { Orientation } from '../src/blueprint/orientation';

const OUT = '.dev-grabs';
const MAPS = { grey: 'grey', albedo: 'grey', normal: 'normal', material: 'material' } as const;

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

function pick(r: StructureResult, map: keyof typeof MAPS): Uint8ClampedArray {
  return map === 'normal' ? r.normal : map === 'material' ? r.material : r.grey;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    console.log(Object.keys(BUILDING_BLUEPRINTS).sort().join('\n'));
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const presets = argv.filter((a) => !a.startsWith('--'));
  if (!presets.length) {
    console.error('usage: building-preview.ts <preset…> [--cutaway|--both] [--albedo|--normal|--material] [--list]');
    process.exit(1);
  }
  const map = (['albedo', 'normal', 'material'] as const).find((m) => flags.has(`--${m}`)) ?? 'grey';
  const wantClosed = !flags.has('--cutaway') || flags.has('--both');
  const wantCutaway = flags.has('--cutaway') || flags.has('--both');
  // --orient=N (single) or --orient=all (the four placement orientations 0..3). Drives
  // rb.orientation; toGeometry maps it to spec.yaw, which we thread to composeStructure —
  // the same path the runtime parametric source uses.
  const orientArg = argv.find((a) => a.startsWith('--orient'))?.split('=')[1];
  const orientations: Orientation[] = orientArg === 'all'
    ? [0, 1, 2, 3]
    : orientArg != null ? [Math.max(0, Math.min(3, Number(orientArg) | 0)) as Orientation] : [0];
  // --surface: run the analytic Material+Finish surface engine (the RUNTIME building look —
  // coursed masonry, washes/finishes, micro-relief) instead of the flat grey-reference albedo.
  const surface = flags.has('--surface');
  const compose = (rb: ReturnType<typeof synthesizeBlueprint>) => {
    const spec = toGeometry(rb!);
    return composeStructure(spec, undefined, {
      ...(spec.yaw ? { yaw: spec.yaw } : {}),
      ...(surface ? { surfaceTexture: true } : {}),
    });
  };

  mkdirSync(OUT, { recursive: true });
  for (const preset of presets) {
    const base = synthesizeBlueprint(preset, [], 1);
    if (!base) { console.error(`unknown preset: ${preset}`); continue; }
    for (const o of orientations) {
      const rb = o ? { ...base, orientation: o } : base;
      const suffix = o ? `-o${o}` : '';
      if (wantClosed) {
        const r = await compose(rb);
        writeFileSync(join(OUT, `${preset}${suffix}-${map}.png`), toPng(pick(r, map), r.size));
        console.log(`${preset}${suffix} closed → .dev-grabs/${preset}${suffix}-${map}.png (${r.size}px)`);
      }
      if (wantCutaway) {
        const r = await compose(o ? { ...cutawayOf(base), orientation: o } : cutawayOf(base));
        writeFileSync(join(OUT, `${preset}${suffix}-cutaway-${map}.png`), toPng(pick(r, map), r.size));
        console.log(`${preset}${suffix} cutaway → .dev-grabs/${preset}${suffix}-cutaway-${map}.png (${r.size}px)`);
      }
    }
  }
}

main();
