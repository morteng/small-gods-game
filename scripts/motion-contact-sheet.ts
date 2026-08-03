// scripts/motion-contact-sheet.ts
//
// Offline contact sheets for the IMPORTED mocap clips — the same bake the
// motion studio runs, written to PNG so the motion can be judged without a
// browser, in a diff, or in a message.
//
// Run:  npx tsx scripts/motion-contact-sheet.ts [clip…]
// Out:  tmp/motion/<clip>-<facing>-4x.png        the bake, big
//       tmp/motion/<clip>-<facing>-onscreen.png  the same at the in-game 32px
//       tmp/motion/<clip>-vs-lpc-<facing>.png    LPC's own row over the bake
//
// The comparison sheet exists because LPC ships a hand-pixeled walk cycle for
// every facing: free ground truth by a human artist, already licensed, already
// on disk. It is a DIFFERENT artist's cycle — the bar is "reads like a person
// walking", not "matches". The IoU printed alongside is instrumentation, not a
// gate, and it is what picks the phase alignment: the two cycles start at
// unrelated moments, so comparing frame 0 to frame 0 would indict the bake for
// something it did not do. Every candidate shift's score is printed so the
// chosen one can be second-guessed.
//
// Nothing here is reachable from the game. This is author-time tooling, like
// `paperdoll-bake.ts`, whose layer loading it deliberately mirrors.

import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { bakeClip, type AnimTemplate } from '@/render/paperdoll/rig';
import { DEFAULT_HUMANOID_LAYERS, HUMANOID_SOURCE, LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { HUMANOID_SOURCE_NORTH, LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { HUMANOID_WEST_SOURCE, LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import { IMPORTED_CLIPS, IMPORTED_CLIP_META } from '@/render/paperdoll/clips';
import { LPC_ANIMATIONS, LPC_DIR_OFFSET } from '@/core/npc-animation';
import { fragmentation, worstFragmentation } from '@/render/paperdoll/clip-measure';
import { collectOutlinePalette, collectSourcePalette, reinkOutline, snapToSourcePalette } from '@/render/paperdoll/palette-snap';
import type { Raster } from '@/render/sprite-postprocess';

const OUT = 'tmp/motion';
const CELL = LPC_HUMANOID_SOUTH.cell;
const FACINGS = ['down', 'up', 'left'] as const;
type Facing = (typeof FACINGS)[number];

/** Template + the sheet row its chip rects were authored against, per facing. */
const RIG: Record<Facing, { template: AnimTemplate; row: number }> = {
  down: { template: LPC_HUMANOID_SOUTH, row: HUMANOID_SOURCE.row },
  up: { template: LPC_HUMANOID_NORTH, row: HUMANOID_SOURCE_NORTH.row },
  left: { template: LPC_HUMANOID_WEST, row: HUMANOID_WEST_SOURCE.row },
};

async function loadSheet(publicPath: string): Promise<Raster> {
  const png = PNG.sync.read(await readFile(`public/${publicPath}`));
  return { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
}

/** One CELL-sized cell out of a sheet. */
function cellAt(sheet: Raster, col: number, row: number): Raster {
  const data = new Uint8ClampedArray(CELL * CELL * 4);
  for (let y = 0; y < CELL; y++) {
    const si = ((row * CELL + y) * sheet.w + col * CELL) * 4;
    data.set(sheet.data.subarray(si, si + CELL * 4), y * CELL * 4);
  }
  return { data, w: CELL, h: CELL };
}

/** Alpha-over composite of one cell across the whole wardrobe stack. */
function compositeCell(sheets: readonly Raster[], col: number, row: number): Raster {
  const out = new Uint8ClampedArray(CELL * CELL * 4);
  for (const sheet of sheets) {
    const src = cellAt(sheet, col, row);
    for (let i = 0; i < CELL * CELL; i++) {
      const a = src.data[i * 4 + 3];
      if (a === 0) continue;
      const da = out[i * 4 + 3];
      if (a === 255 || da === 0) {
        out.set(src.data.subarray(i * 4, i * 4 + 4), i * 4);
      } else {
        const na = a + (da * (255 - a)) / 255;
        for (let c = 0; c < 3; c++) {
          out[i * 4 + c] = (src.data[i * 4 + c] * a + (out[i * 4 + c] * da * (255 - a)) / 255) / na;
        }
        out[i * 4 + 3] = na;
      }
    }
  }
  return { data: out, w: CELL, h: CELL };
}

/** Coverage-weighted box downscale — the in-game size, same rule as the studio. */
function downscale(f: Raster, to: number): Raster {
  const s = f.w / to;
  const out = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hit = 0;
      for (let yy = 0; yy < s; yy++) {
        for (let xx = 0; xx < s; xx++) {
          const si = ((y * s + yy) * f.w + (x * s + xx)) * 4;
          if (f.data[si + 3] > 0) {
            r += f.data[si];
            g += f.data[si + 1];
            b += f.data[si + 2];
            hit++;
          }
        }
      }
      if (hit > s * s * 0.35) out.set([r / hit, g / hit, b / hit, 255], (y * to + x) * 4);
    }
  }
  return { data: out, w: to, h: to };
}

/**
 * Rows of frames, each row an independent strip; integer scale, 2px gutters.
 *
 * Rows may hold DIFFERENT cell sizes — the 32px on-screen strip sits under the
 * 64px bake — so each row is laid out on its own pitch and only the band height
 * is shared. Iterating the shared height instead would run past the small
 * raster's end, and an out-of-bounds read on a typed array is `undefined`, not
 * a throw: the alpha test passes and the sheet fills with black rectangles that
 * look like a broken bake rather than a broken sheet. (It did, once.)
 */
function sheetOf(rows: readonly (readonly Raster[])[], scale: number): PNG {
  const gap = 2;
  const band = Math.max(...rows.map((r) => r[0].w * scale));
  const W = Math.max(...rows.map((r) => (r[0].w * scale + gap) * r.length)) + gap;
  const H = (band + gap) * rows.length + gap;
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) png.data.set([22, 22, 30, 255], i * 4);
  rows.forEach((row, ri) => {
    const oy = gap + ri * (band + gap);
    const cw = row[0].w * scale;
    row.forEach((f, fi) => {
      const ox = gap + fi * (cw + gap);
      for (let y = 0; y < cw; y++) {
        for (let x = 0; x < cw; x++) {
          const si = (((y / scale) | 0) * f.w + ((x / scale) | 0)) * 4;
          if (f.data[si + 3] === 0) continue;
          png.data.set([f.data[si], f.data[si + 1], f.data[si + 2], 255], ((oy + y) * W + ox + x) * 4);
        }
      }
    });
  });
  return png;
}

/** Silhouette intersection-over-union — the building pipeline's own measure. */
function silhouetteIoU(a: Raster, b: Raster): number {
  let inter = 0;
  let union = 0;
  for (let i = 3; i < a.data.length; i += 4) {
    const pa = a.data[i] > 0;
    const pb = b.data[i] > 0;
    if (pa && pb) inter++;
    if (pa || pb) union++;
  }
  return union === 0 ? 1 : inter / union;
}

/** Per-clip accumulator for the cross-facing sheet and the worst-frame crop below. */
interface ClipBake {
  facing: Facing;
  raw: Raster[];
  baked: Raster[];
  broken: number; // strayPx + holePx summed over the clip — picks the worst facing
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const ids = Object.keys(IMPORTED_CLIPS).filter((id) => only.length === 0 || only.includes(id));

  const sheets = await Promise.all(DEFAULT_HUMANOID_LAYERS.map((s) => loadSheet(s.path)));
  const walk = LPC_ANIMATIONS.walk;
  const perClip = new Map<string, ClipBake[]>();

  for (const facing of FACINGS) {
    const { template, row } = RIG[facing];
    // Per-facing wardrobe: each layer's rest cell comes from THAT facing's row,
    // because the chip rects were measured against it. Reusing the south cell
    // would rotate south pixels under a west skeleton and look like a rig bug.
    const layers = sheets.map((sheet, i) => ({
      raster: cellAt(sheet, HUMANOID_SOURCE.col, row),
      assign: DEFAULT_HUMANOID_LAYERS[i].assign,
    }));
    const palette = collectSourcePalette(layers.map((l) => l.raster));
    const outline = collectOutlinePalette(layers.map((l) => l.raster));
    const ink = (f: Raster): Raster => reinkOutline(snapToSourcePalette(f, palette), outline);

    // LPC's own hand-pixeled cycle for this facing.
    //
    // The row is the DIRECTION and nothing else. `LPC_ANIMATIONS.walk.rowBase`
    // is 8 because it addresses the composited UNIVERSAL sheet, and these are
    // the per-animation source sheets (`…/male/walk.png`), four rows tall. Add
    // the two and every read lands past the bottom edge, silently returning
    // transparent — which reads as "the bake matches nothing" rather than as a
    // bad lookup. Columns are shared between the two layouts, so `firstCol` /
    // `lastCol` are still right.
    const lpc: Raster[] = [];
    for (let c = walk.firstCol; c <= walk.lastCol; c++) lpc.push(compositeCell(sheets, c, LPC_DIR_OFFSET[facing]));

    for (const id of ids) {
      const clip = IMPORTED_CLIPS[id][facing];
      const raw = bakeClip(template, layers, clip);
      const baked = raw.map(ink);
      await writeFile(`${OUT}/${id}-${facing}-4x.png`, PNG.sync.write(sheetOf([baked], 4)));
      await writeFile(
        `${OUT}/${id}-${facing}-onscreen.png`,
        PNG.sync.write(sheetOf([baked.map((f) => downscale(f, 32))], 4)),
      );

      // Interior health, beside the silhouette score below. These are different
      // questions and the IoU cannot answer this one: a leg torn into fragments
      // still fills roughly the right outline. Printed for EVERY clip, including
      // the gestures that get no reference row.
      //
      // Measured on the RAW bake, before `ink`. `reinkOutline` sprinkles single
      // outline pixels that read as detached components, and they swamp the
      // count: the south walk scores 48 stray inked against 0 raw. Those specks
      // are the ink pass being itself, not a limb coming off, and folding them
      // in would make the number blind to the thing it exists to catch.
      const broken = raw.reduce(
        (a, f) => {
          const g = fragmentation(f);
          return { stray: a.stray + g.strayPx, hole: a.hole + g.holePx };
        },
        { stray: 0, hole: 0 },
      );
      const w = worstFragmentation(raw);
      console.log(
        `${id}/${facing}: ${broken.stray} stray px, ${broken.hole} hole px over ${baked.length} frames` +
          ` (worst f${w.frame}: ${w.parts} parts, ${w.strayPx}+${w.holePx})`,
      );
      const list = perClip.get(id) ?? [];
      list.push({ facing, raw, baked, broken: broken.stray + broken.hole });
      perClip.set(id, list);

      if (IMPORTED_CLIP_META[id].groundSpeedPxPerSec === 0) continue;

      // A looped clip repeats its first pose last; drop it so the cycles are
      // the same length and the shift search compares like with like.
      const cyc = IMPORTED_CLIP_META[id].loop ? baked.slice(0, -1) : baked;
      const n = Math.min(cyc.length, lpc.length);
      const scores = Array.from({ length: n }, (_, s) =>
        Array.from({ length: n }, (_, i) => silhouetteIoU(lpc[i], cyc[(i + s) % cyc.length])).reduce((x, y) => x + y, 0) / n);
      const best = scores.indexOf(Math.max(...scores));
      const aligned = Array.from({ length: n }, (_, i) => cyc[(i + best) % cyc.length]);
      await writeFile(
        `${OUT}/${id}-vs-lpc-${facing}.png`,
        PNG.sync.write(sheetOf([lpc.slice(0, n), aligned, aligned.map((f) => downscale(f, 32))], 4)),
      );
      console.log(
        `${id}/${facing}: phase shift +${best} → mean IoU ${scores[best].toFixed(3)}` +
          ` (all shifts: ${scores.map((s) => s.toFixed(2)).join(' ')})`,
      );
    }
  }
  // Cross-facing sheet + a 9x crop of the worst frames — for the HUMAN, not a
  // gate. `-4x` above is one facing at a time; a limb tearing at a joint is a
  // few px wide and a 4x strip hides it (measured, not a guess: it fooled a
  // whole report once). 9x on just the worst frames is what makes it legible
  // without producing an unreadably huge full-clip sheet.
  for (const [id, facings] of perClip) {
    await writeFile(
      `${OUT}/${id}-sheet.png`,
      PNG.sync.write(sheetOf(facings.map((f) => f.baked), 4)),
    );

    // Whichever facing scored worst (stray + hole, summed over the clip) is
    // the one worth zooming into — the other facings' worst frames are not
    // interesting if that facing's own worst frame is clean.
    const worstFacing = facings.reduce((a, b) => (b.broken > a.broken ? b : a));
    const ranked = worstFacing.raw
      .map((frame, i) => ({ i, g: fragmentation(frame) }))
      .sort((a, b) => b.g.strayPx + b.g.holePx - (a.g.strayPx + a.g.holePx))
      .slice(0, 3)
      .sort((a, b) => a.i - b.i); // back to clip order once the worst 3 are picked
    await writeFile(
      `${OUT}/${id}-worst-9x.png`,
      PNG.sync.write(sheetOf([ranked.map((r) => worstFacing.raw[r.i])], 9)),
    );
    console.log(
      `${id}: worst facing ${worstFacing.facing} (${worstFacing.broken} broken px) — ` +
        `9x crop frames ${ranked.map((r) => r.i).join(', ')}`,
    );
  }

  console.log(`\nwrote ${OUT}/ — top row is LPC's own artist, middle the bake, bottom the bake at 32px.`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
