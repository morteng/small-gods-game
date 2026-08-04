// scripts/lib/rig-bake-node.ts
//
// Node-safe loading for the vendored LPC wardrobe sheets — pngjs reading
// straight off `public/`, no `fetch`, no dev server, no DOM. This is the piece
// `scripts/motion-contact-sheet.ts` solved first (offline contact sheets for
// the imported mocap clips); `scripts/seed-npc-art.ts` (G1) needs the IDENTICAL
// facing → template/row pairing to bake the same rig frames it then hands to
// img2img, so the two scripts share this module instead of keeping two copies
// that could drift — a re-export would not cut that edge (house rule), so both
// import this file directly.
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { AnimTemplate } from '@/render/paperdoll/rig';
import { DEFAULT_HUMANOID_LAYERS, HUMANOID_SOURCE, LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { HUMANOID_SOURCE_NORTH, LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { HUMANOID_WEST_SOURCE, LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import type { Raster } from '@/render/sprite-postprocess';

/** LPC cell size shared by every facing's template. */
export const RIG_CELL = LPC_HUMANOID_SOUTH.cell;

/** Authored viewing angles the humanoid rig bakes offline. East is never
 *  baked — mirror `left`'s finished frames instead, the rule the runtime bake
 *  (`src/render/lpc/rig-rows.ts`) and the studio's `facing.ts` both already
 *  follow, so a third bake pass here would just be spending render time (and,
 *  for `seed-npc-art.ts`, money) on pixels a flip already produces for free. */
export const RIG_FACINGS = ['down', 'up', 'left'] as const;
export type RigFacing = (typeof RIG_FACINGS)[number];

/**
 * Template + the vendored sheet row its rest cell is cut from, per facing —
 * the same pairing `rig-rows.ts`'s runtime bake makes for the live game. That
 * table (`RIG_FACING_BAKES`) is private and wired to row-strip/mirror/stamp
 * concerns neither offline script has, so the template+row pair is restated
 * here rather than imported — it is the whole of what these two scripts need.
 */
export const RIG: Readonly<Record<RigFacing, { template: AnimTemplate; row: number }>> = {
  down: { template: LPC_HUMANOID_SOUTH, row: HUMANOID_SOURCE.row },
  up: { template: LPC_HUMANOID_NORTH, row: HUMANOID_SOURCE_NORTH.row },
  left: { template: LPC_HUMANOID_WEST, row: HUMANOID_WEST_SOURCE.row },
};

/** Read + decode a vendored PNG straight off disk. No `fetch`: these are
 *  author-time Node scripts with no dev server guaranteed to be running, the
 *  same reason `seed-building-art.ts` decodes Buffers with pngjs instead of
 *  going through the browser sprite codec. */
export async function loadSheet(publicPath: string): Promise<Raster> {
  const png = PNG.sync.read(await readFile(`public/${publicPath}`));
  return { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
}

/** One `cell`-sized cell out of a full sheet (default: the shared LPC cell). */
export function cellAt(sheet: Raster, col: number, row: number, cell: number = RIG_CELL): Raster {
  const data = new Uint8ClampedArray(cell * cell * 4);
  for (let y = 0; y < cell; y++) {
    const si = ((row * cell + y) * sheet.w + col * cell) * 4;
    data.set(sheet.data.subarray(si, si + cell * 4), y * cell * 4);
  }
  return { data, w: cell, h: cell };
}

/** Every sheet the default wardrobe stack is made of, decoded off disk in
 *  layer order — both scripts bake this exact stack. */
export async function loadDefaultWardrobeSheets(): Promise<Raster[]> {
  return Promise.all(DEFAULT_HUMANOID_LAYERS.map((s) => loadSheet(s.path)));
}
