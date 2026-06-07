/** Render floor-guide PNGs for a few presets to tmp/floor-guide/ for inspection. */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';
import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { PixfluxCompiler } from '@/assetgen/compilers/pixflux-compiler';
import { buildFloorGuide } from '@/assetgen/floor-guide';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp/floor-guide');
await mkdir(OUT, { recursive: true });
const compiler = new PixfluxCompiler();
const presets = process.argv.slice(2).length ? process.argv.slice(2)
  : ['cottage', 'longhouse', 'tavern', 'castle_keep'];

for (const name of presets) {
  const d = synthesizeFromPreset(name);
  if (!d) { console.log('skip', name); continue; }
  const opts = compiler.compile(buildingBrief(d, 0));
  const g = buildFloorGuide(opts.width, opts.height, d.footprint.w, d.footprint.h);
  const png = new PNG({ width: g.width, height: g.height });
  png.data = Buffer.from(g.data.buffer);
  const buf = PNG.sync.write(png);
  const file = `${name}-${g.width}x${g.height}-fp${d.footprint.w}x${d.footprint.h}.png`;
  await writeFile(join(OUT, file), buf);
  console.log('wrote', file);
}
void BUILDING_PRESETS;
