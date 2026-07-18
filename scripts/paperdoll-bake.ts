// scripts/paperdoll-bake.ts
//
// Offline paper-doll bake — drives src/render/paperdoll/ (the same core the
// motion studio uses) over the vendored LPC layers, PER LAYER: each layer is
// sliced and rotated independently by the shared FK transforms, then painted
// chip-z-outer / layer-order-inner. Rotating raw layers (clean alpha edges)
// instead of the flattened composite kills the baked-in inter-layer shadow
// smear the first composed-slice spike showed on the forearms.
//
// Run:  npx tsx scripts/paperdoll-bake.ts
// Out:  tmp/paperdoll/<clip>-{6x,onscreen,quant6x}.png   (one strip per clip)

import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { bakeClip } from '@/render/paperdoll/rig';
import {
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_CLIPS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import { quantizePaletteOklab, type Raster } from '@/render/sprite-postprocess';

const OUT = 'tmp/paperdoll';
mkdirSync(OUT, { recursive: true });
const CELL = LPC_HUMANOID_SOUTH.cell;

/** Extract the template's source cell (idle stand, south row) from one layer sheet. */
async function loadLayerCell(publicPath: string): Promise<Raster> {
  const png = PNG.sync.read(await readFile(`public/${publicPath}`));
  const sx = HUMANOID_SOURCE.col * CELL;
  const sy = HUMANOID_SOURCE.row * CELL;
  const data = new Uint8ClampedArray(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const si = ((sy + y) * png.width + (sx + x)) * 4;
      data.set(png.data.subarray(si, si + 4), (y * CELL + x) * 4);
    }
  }
  return { data, w: CELL, h: CELL };
}

/** Lay frames out as a horizontal strip (integer scale, dark bg, 2px gutters). */
function strip(frames: readonly Raster[], scale: number): PNG {
  const cw = frames[0].w;
  const gap = 2;
  const W = (cw * scale + gap) * frames.length + gap;
  const H = cw * scale + gap * 2;
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) png.data.set([22, 22, 30, 255], i * 4);
  frames.forEach((f, fi) => {
    const ox = gap + fi * (cw * scale + gap);
    for (let y = 0; y < cw * scale; y++) {
      for (let x = 0; x < cw * scale; x++) {
        const si = ((y / scale | 0) * f.w + (x / scale | 0)) * 4;
        if (f.data[si + 3] === 0) continue;
        png.data.set([f.data[si], f.data[si + 1], f.data[si + 2], 255], ((gap + y) * W + ox + x) * 4);
      }
    }
  });
  return png;
}

/** Coverage-weighted box downscale (64 → 32 on-screen size). */
function downscale(f: Raster, to: number): Raster {
  const s = f.w / to;
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0, g = 0, b = 0, hit = 0;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) {
          const si = ((y * s + yy) * f.w + (x * s + xx)) * 4;
          if (f.data[si + 3] > 0) { r += f.data[si]; g += f.data[si + 1]; b += f.data[si + 2]; hit++; }
        }
      }
      if (hit > s * s * 0.35) {
        out.set([r / hit, g / hit, b / hit, 255], (y * to + x) * 4);
      }
    }
  }
  return { data: out, w: to, h: to };
}

async function main() {
  const layers = await Promise.all(
    DEFAULT_HUMANOID_LAYERS.map(async (spec) => ({
      raster: await loadLayerCell(spec.path),
      assign: spec.assign,
    })),
  );
  for (const clip of HUMANOID_CLIPS) {
    const frames = bakeClip(LPC_HUMANOID_SOUTH, layers, clip);
    await writeFile(`${OUT}/${clip.name}-6x.png`, PNG.sync.write(strip(frames, 6)));
    await writeFile(
      `${OUT}/${clip.name}-onscreen.png`,
      PNG.sync.write(strip(frames.map((f) => downscale(f, 32)), 4)),
    );
    const quant = frames.map((f) => quantizePaletteOklab(f, 32, { dither: 'bayer4' }));
    await writeFile(`${OUT}/${clip.name}-quant6x.png`, PNG.sync.write(strip(quant, 6)));
    console.log(`${clip.name}: ${frames.length} frames → ${OUT}/${clip.name}-{6x,onscreen,quant6x}.png`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
