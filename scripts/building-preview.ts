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
import { renderBlueprintMontage } from '../src/assetgen/blueprint-montage';
import { lintBlueprint, summarizeLint } from '../src/blueprint/lint';
import { formatCatalogue } from '../src/blueprint/describe-registry';
import { ensureBuildingTypesRegistered } from '../src/blueprint/register-buildings';

const OUT = '.dev-grabs';
const MAPS = { grey: 'grey', albedo: 'grey', normal: 'normal', material: 'material' } as const;

function toPng(buf: Uint8ClampedArray, size: number): Buffer {
  const png = new PNG({ width: size, height: size });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

/** Rectangular PNG (the montage sheet is W×H, not square). */
function toPngWH(buf: Uint8ClampedArray, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}

/** Print a lint report for a resolved blueprint. */
function printLint(preset: string, rb: Parameters<typeof lintBlueprint>[0]): void {
  const lints = lintBlueprint(rb);
  console.log(`${preset} lint: ${summarizeLint(lints)}`);
  for (const l of lints) {
    const tag = l.severity === 'error' ? 'ERR ' : l.severity === 'warn' ? 'warn' : 'note';
    console.log(`    [${tag}] ${l.code}: ${l.message}`);
  }
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
  // --catalogue: the machine-readable authoring capability catalogue (part/feature knobs,
  // ranges, defaults, docs) — what an LLM reads before authoring a blueprint.
  if (argv.includes('--catalogue') || argv.includes('--catalog')) {
    ensureBuildingTypesRegistered();
    console.log(formatCatalogue());
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const presets = argv.filter((a) => !a.startsWith('--'));
  if (!presets.length) {
    console.error('usage: building-preview.ts <preset…> [--lint] [--views] [--cutaway|--both] [--albedo|--normal|--material] [--orient=N|all] [--surface]\n       building-preview.ts --list | --catalogue');
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
  // --views: a labelled multi-yaw montage (the visual-critique sheet). --lint: the
  // deterministic report. Either one is its own mode; both imply skipping the default
  // per-orientation closed/cutaway dump.
  const wantViews = flags.has('--views');
  const wantLint = flags.has('--lint');
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

    if (wantViews || wantLint) {
      if (wantViews) {
        const m = await renderBlueprintMontage(base);
        const file = join(OUT, `${preset}-views.png`);
        writeFileSync(file, toPngWH(m.rgba, m.width, m.height));
        console.log(`${preset} montage → .dev-grabs/${preset}-views.png (${m.width}×${m.height}, ${m.yaws.length} yaws)`);
        console.log('  marks:');
        for (const e of m.legend) console.log(`    ${e.mark} = ${e.id} (${e.type})`);
      }
      if (wantLint) printLint(preset, base);
      continue;   // views/lint are their own modes; skip the default orient dump
    }

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
