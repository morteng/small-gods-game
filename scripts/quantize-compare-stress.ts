/**
 * Supplementary stress pass for the Oklab quantizer eyeball: the tavern
 * reference PNG is already palette-quantized to 64 colours by the seeding
 * pipeline, so re-quantizing at N=64 (quantize-compare.ts) is nearly a
 * no-op. This drives both quantizers down to a much tighter budget (16
 * colours) so real merge/dither decisions are forced and visible.
 *
 *   npx tsx scripts/quantize-compare-stress.ts
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { type Raster, quantizePalette, quantizePaletteOklab } from '@/render/sprite-postprocess';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public/asset-library/building-sprites/v30_black-forest-labs_flux.2-klein-4b_4x3_c9eyrw.png');
const OUT = join(ROOT, '.dev-grabs/quantize-compare');
const N = 16;

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
const oldQ = quantizePalette(src, N);
const newNone = quantizePaletteOklab(src, N, { dither: 'none' });
const newBayer = quantizePaletteOklab(src, N, { dither: 'bayer4' });
await writeRaster(join(OUT, `stress${N}-old.png`), oldQ);
await writeRaster(join(OUT, `stress${N}-new-none.png`), newNone);
await writeRaster(join(OUT, `stress${N}-new-bayer4.png`), newBayer);
console.log(`wrote stress${N} triptych -> ${OUT}`);
