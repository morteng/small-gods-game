/**
 * Eyeball harness for the new Oklab k-means quantizer vs the existing sRGB
 * bucket quantizer (both additive/unwired — see sprite-postprocess.ts).
 *
 *   npx tsx scripts/quantize-compare.ts
 *
 * Loads the tavern sprite, runs old `quantizePalette` and new
 * `quantizePaletteOklab` (dither none + bayer4) at the pipeline's real
 * QUANT_COLORS, and writes all three PNGs (plus the original) to
 * .dev-grabs/quantize-compare/ for a visual side-by-side.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { type Raster, quantizePalette, quantizePaletteOklab } from '@/render/sprite-postprocess';
import { QUANT_COLORS } from '@/render/generated-building-art-source';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public/asset-library/building-sprites/v30_black-forest-labs_flux.2-klein-4b_4x3_c9eyrw.png');
const OUT = join(ROOT, '.dev-grabs/quantize-compare');

async function loadRaster(path: string): Promise<Raster> {
  const buf = await readFile(path);
  const png = PNG.sync.read(buf);
  return { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
}

async function writeRaster(path: string, r: Raster): Promise<void> {
  const png = new PNG({ width: r.w, height: r.h });
  png.data = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  await writeFile(path, PNG.sync.write(png));
}

await mkdir(OUT, { recursive: true });
const src = await loadRaster(SRC);
console.log(`loaded ${src.w}x${src.h}, QUANT_COLORS=${QUANT_COLORS}`);

const tStart = Date.now();
const oldQuant = quantizePalette(src, QUANT_COLORS);
console.log(`old sRGB-bucket quantize: ${Date.now() - tStart}ms`);

const t1 = Date.now();
const newNone = quantizePaletteOklab(src, QUANT_COLORS, { dither: 'none' });
console.log(`new Oklab k-means (no dither): ${Date.now() - t1}ms`);

const t2 = Date.now();
const newBayer = quantizePaletteOklab(src, QUANT_COLORS, { dither: 'bayer4' });
console.log(`new Oklab k-means (bayer4): ${Date.now() - t2}ms`);

await writeRaster(join(OUT, 'original.png'), src);
await writeRaster(join(OUT, 'old-srgb-bucket.png'), oldQuant);
await writeRaster(join(OUT, 'new-oklab-none.png'), newNone);
await writeRaster(join(OUT, 'new-oklab-bayer4.png'), newBayer);

function uniqueColors(r: Raster): number {
  const s = new Set<number>();
  for (let i = 0; i < r.w * r.h; i++) {
    if (r.data[i * 4 + 3] < 8) continue;
    s.add((r.data[i * 4] << 16) | (r.data[i * 4 + 1] << 8) | r.data[i * 4 + 2]);
  }
  return s.size;
}
console.log(`unique colours — original: ${uniqueColors(src)}, old: ${uniqueColors(oldQuant)}, ` +
  `new-none: ${uniqueColors(newNone)}, new-bayer4: ${uniqueColors(newBayer)}`);
console.log(`\nwrote 4 PNGs -> ${OUT}`);
