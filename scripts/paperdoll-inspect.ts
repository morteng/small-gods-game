// scripts/paperdoll-inspect.ts
// Template authoring aid: render the composed reference cell enlarged with an
// 8px grid PLUS the current humanoid template's chip rects (colored outlines)
// and pivots (crosses), so slice boundaries are tuned against real pixels.
// Run:  npx tsx scripts/paperdoll-inspect.ts
// Out:  tmp/paperdoll/template-overlay.png

import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import {
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';

mkdirSync('tmp/paperdoll', { recursive: true });
const CELL = LPC_HUMANOID_SOUTH.cell;
const SCALE = 10;

const CHIP_COLORS: [number, number, number][] = [
  [120, 120, 120], // trunk (root)
  [255, 220, 60], // head
  [80, 180, 255], // armL_up
  [60, 120, 255], // armL_fore
  [255, 130, 80], // armR_up
  [255, 70, 40], // armR_fore
  [80, 220, 120], // legL_up
  [40, 160, 80], // legL_fore
  [200, 120, 255], // legR_up
  [150, 64, 220], // legR_fore
];

async function main() {
  // composite the source cell from all layers
  const cell = new Uint8ClampedArray(CELL * CELL * 4);
  for (const { path } of DEFAULT_HUMANOID_LAYERS) {
    const png = PNG.sync.read(await readFile(`public/${path}`));
    const sx = HUMANOID_SOURCE.col * CELL;
    const sy = HUMANOID_SOURCE.row * CELL;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const si = ((sy + y) * png.width + (sx + x)) * 4;
        const a = png.data[si + 3];
        if (a === 0) continue;
        const di = (y * CELL + x) * 4;
        const sa = a / 255;
        const da = cell[di + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++)
          cell[di + c] = oa === 0 ? 0 : Math.round((png.data[si + c] * sa + cell[di + c] * da * (1 - sa)) / oa);
        cell[di + 3] = Math.round(oa * 255);
      }
    }
  }

  const W = CELL * SCALE;
  const out = new PNG({ width: W, height: W });
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const sx = (x / SCALE) | 0;
      const sy = (y / SCALE) | 0;
      const si = (sy * CELL + sx) * 4;
      const di = (y * W + x) * 4;
      const bg = ((sx + sy) & 1) ? 40 : 30;
      if (cell[si + 3] === 0) out.data.set([bg, bg, bg + 6, 255], di);
      else out.data.set([cell[si], cell[si + 1], cell[si + 2], 255], di);
      if (x % (8 * SCALE) === 0 || y % (8 * SCALE) === 0) out.data.set([50, 90, 50, 255], di);
    }
  }

  // chip rect outlines + pivot crosses (skip the full-cell root outline)
  LPC_HUMANOID_SOUTH.chips.forEach((ch, i) => {
    const col = CHIP_COLORS[i] ?? [255, 255, 255];
    const put = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= W || py >= W) return;
      out.data.set([col[0], col[1], col[2], 255], (py * W + px) * 4);
    };
    if (i > 0) {
      const { x, y, w: rw, h: rh } = ch.rect;
      for (let px = x * SCALE; px <= (x + rw) * SCALE; px++) {
        put(px, y * SCALE);
        put(px, (y + rh) * SCALE);
      }
      for (let py = y * SCALE; py <= (y + rh) * SCALE; py++) {
        put(x * SCALE, py);
        put((x + rw) * SCALE, py);
      }
    }
    const [jx, jy] = ch.pivot;
    for (let d = -4; d <= 4; d++) {
      put(jx * SCALE + d, jy * SCALE);
      put(jx * SCALE, jy * SCALE + d);
    }
  });

  await writeFile('tmp/paperdoll/template-overlay.png', PNG.sync.write(out));
  console.log('wrote tmp/paperdoll/template-overlay.png');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
