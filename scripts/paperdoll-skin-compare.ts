// scripts/paperdoll-skin-compare.ts
//
// Skinning spike evaluation: bake selected clips three ways — legacy rigid
// chips, contour-aware skinned joints (blend band), and skinned + snapped to
// the SOURCE palette — and stack the variants as labeled rows per frame so
// the joint creases can be compared directly.
//
// Run:  npx tsx scripts/paperdoll-skin-compare.ts
// Out:  tmp/paperdoll/skin-compare-<clip>-{6x,onscreen}.png

import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { bakeClip } from '@/render/paperdoll/rig';
import { collectOutlinePalette, collectSourcePalette, reinkOutline, snapToSourcePalette } from '@/render/paperdoll/palette-snap';
import {
  CLIP_PRAY_BOW,
  CLIP_PRAY_RAISE,
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import type { Raster } from '@/render/sprite-postprocess';

const OUT = 'tmp/paperdoll';
mkdirSync(OUT, { recursive: true });
const CELL = LPC_HUMANOID_SOUTH.cell;
const BAND = 3;

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
      if (hit > s * s * 0.35) out.set([r / hit, g / hit, b / hit, 255], (y * to + x) * 4);
    }
  }
  return { data: out, w: to, h: to };
}

/** Rows of frame-strips stacked vertically (integer scale, gutters). */
function grid(rows: readonly (readonly Raster[])[], scale: number): PNG {
  const cw = rows[0][0].w;
  const gap = 2;
  const W = (cw * scale + gap) * rows[0].length + gap;
  const H = (cw * scale + gap) * rows.length + gap;
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) png.data.set([22, 22, 30, 255], i * 4);
  rows.forEach((frames, ri) => {
    const oy = gap + ri * (cw * scale + gap);
    frames.forEach((f, fi) => {
      const ox = gap + fi * (cw * scale + gap);
      for (let y = 0; y < cw * scale; y++) {
        for (let x = 0; x < cw * scale; x++) {
          const si = (((y / scale) | 0) * f.w + ((x / scale) | 0)) * 4;
          if (f.data[si + 3] === 0) continue;
          png.data.set([f.data[si], f.data[si + 1], f.data[si + 2], 255], ((oy + y) * W + ox + x) * 4);
        }
      }
    });
  });
  return png;
}

async function main() {
  const layers = await Promise.all(
    DEFAULT_HUMANOID_LAYERS.map(async (spec) => ({
      raster: await loadLayerCell(spec.path),
      assign: spec.assign,
    })),
  );
  const rasters = layers.map((l) => l.raster);
  const palette = collectSourcePalette(rasters);
  const outline = collectOutlinePalette(rasters);
  console.log(`source palette: ${palette.rgb.length} colors (${outline.rgb.length} outline inks)`);

  for (const clip of [CLIP_PRAY_BOW, CLIP_PRAY_RAISE]) {
    const rigid = bakeClip(LPC_HUMANOID_SOUTH, layers, clip);
    const skinned = bakeClip(LPC_HUMANOID_SOUTH, layers, clip, { skin: { band: BAND } });
    const snapped = skinned.map((f) => snapToSourcePalette(f, palette));
    const inked = snapped.map((f) => reinkOutline(f, outline));
    // row order: rigid / skinned / skinned+snap / skinned+snap+ink
    await writeFile(
      `${OUT}/skin-compare-${clip.name}-6x.png`,
      PNG.sync.write(grid([rigid, skinned, snapped, inked], 6)),
    );
    await writeFile(
      `${OUT}/skin-compare-${clip.name}-onscreen.png`,
      PNG.sync.write(grid([rigid, skinned, snapped, inked].map((r) => r.map((f) => downscale(f, 32))), 4)),
    );
    console.log(`${clip.name}: rows rigid/skinned(band ${BAND})/snap/snap+ink → ${OUT}/skin-compare-${clip.name}-{6x,onscreen}.png`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
