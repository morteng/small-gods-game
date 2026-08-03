// Bake parity: the strip the RUNTIME assembles must be the offline `bakeClip`'s
// bytes, frame for frame. The rig's header contract is "same inputs → same
// bytes"; this is that contract made visible across the runtime seam, so a
// future optimisation inside the strip builder cannot quietly re-pose anything.
import { beforeAll, describe, it, expect } from 'vitest';
import { bakeClip, type PoseLayer } from '@/render/paperdoll/rig';
import { CLIP_PRAY_RAISE, HUMANOID_SOURCE, LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { HUMANOID_SOURCE_NORTH, LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { sliceSourceCell } from '@/render/paperdoll/humanoid-loader';
import type { Raster } from '@/render/sprite-postprocess';
import { LPC_ANIMATIONS, LPC_DIR_OFFSET, STANDARD_SHEET_ROWS } from '@/core/npc-animation';
import {
  bakeRigStripRows,
  pingPongOrder,
  RIG_BAKE_SUPERSAMPLE,
  RIG_CELL,
  RIG_ROW_CLIPS,
} from '@/render/lpc/rig-rows';

/** A synthetic 3-row LPC sheet: every cell filled with a row/col-dependent
 *  pattern, so a wrongly-sliced facing is a different picture, not a subtlety. */
function fakeSheet(tint: number): Raster {
  const w = RIG_CELL;
  const h = RIG_CELL * 3;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // A solid torso-ish block per row band, offset by the band index.
      const band = Math.floor(y / RIG_CELL);
      const inside = x > 14 + band && x < 50 - band && y % RIG_CELL > 10 && y % RIG_CELL < 62;
      const i = (y * w + x) * 4;
      if (!inside) continue;
      data[i] = (x * 4 + tint) & 0xff;
      data[i + 1] = (y * 3 + tint) & 0xff;
      data[i + 2] = (band * 60 + tint) & 0xff;
      data[i + 3] = 255;
    }
  }
  return { data, w, h };
}

const bytes = (r: Raster): string => Buffer.from(r.data.buffer, r.data.byteOffset, r.data.length).toString('base64');

// No yielding in tests — the pacing is a frame-budget concern, not a behaviour.
const noYield = () => Promise.resolve();

// A strip is supersampled raster math over every frame of every clip — seconds,
// not milliseconds, and slower still on a loaded machine. Bake it ONCE for the
// whole file and give the timeout room, rather than shipping a test that is
// green only when the box is quiet.
describe('runtime rig-row bake', { timeout: 60_000 }, () => {
  const sheets = [fakeSheet(0), fakeSheet(90)];
  const layers: PoseLayer[] = sheets.map((s, i) => ({
    raster: sliceSourceCell(s, HUMANOID_SOURCE.row, HUMANOID_SOURCE.col, RIG_CELL),
    assign: i === 1 ? 'head' : undefined,
  }));

  let rows: Awaited<ReturnType<typeof bakeRigStripRows>>;
  beforeAll(async () => { rows = await bakeRigStripRows(sheets, layers, noYield); });

  it('the south row is bakeClip’s bytes, laid out as a ping-pong', () => {
    const spec = LPC_ANIMATIONS['pray-raise'];
    const south = rows.find(
      (r) => r.row === spec.rowBase - STANDARD_SHEET_ROWS + LPC_DIR_OFFSET.down,
    );
    expect(south).toBeDefined();

    const expected = bakeClip(LPC_HUMANOID_SOUTH, layers, CLIP_PRAY_RAISE, {
      supersample: RIG_BAKE_SUPERSAMPLE,
    });
    const order = pingPongOrder(CLIP_PRAY_RAISE.frames);
    expect(south!.frames.length).toBe(order.length);
    expect(south!.frames.map(bytes)).toEqual(order.map((f) => bytes(expected[f])));
  });

  it('the north row bakes the north template with the stamps stripped', () => {
    const spec = LPC_ANIMATIONS['pray-raise'];
    const north = rows.find(
      (r) => r.row === spec.rowBase - STANDARD_SHEET_ROWS + LPC_DIR_OFFSET.up,
    )!;

    // North slices its OWN sheet row and drops stamps (south's palm donors are
    // south-row crops; its face clones mean nothing from behind).
    const northLayers: PoseLayer[] = sheets.map((s, i) => ({
      raster: sliceSourceCell(s, HUMANOID_SOURCE_NORTH.row, HUMANOID_SOURCE_NORTH.col, RIG_CELL),
      assign: layers[i].assign,
    }));
    const expected = bakeClip(
      LPC_HUMANOID_NORTH,
      northLayers,
      { ...CLIP_PRAY_RAISE, stamps: undefined },
      { supersample: RIG_BAKE_SUPERSAMPLE },
    );
    const order = pingPongOrder(CLIP_PRAY_RAISE.frames);
    expect(north.frames.map(bytes)).toEqual(order.map((f) => bytes(expected[f])));
  });

  it('bakes south + north for every clip and leaves the profile facings empty', () => {
    expect(rows.length).toBe(RIG_ROW_CLIPS.length * 2);
    for (const { anim } of RIG_ROW_CLIPS) {
      const base = LPC_ANIMATIONS[anim].rowBase - STANDARD_SHEET_ROWS;
      const got = rows.filter((r) => r.row >= base && r.row < base + 4).map((r) => r.row).sort();
      // West is authored against a different chip vocabulary and east mirrors
      // west, so neither has a devotional clip to bake — they fall back instead.
      expect(got).toEqual([base + LPC_DIR_OFFSET.up, base + LPC_DIR_OFFSET.down].sort());
    }
  });

  it('is deterministic — a second bake of the same wardrobe is byte-identical', async () => {
    const again = await bakeRigStripRows(sheets, layers, noYield);
    expect(again.map((r) => r.frames.map(bytes))).toEqual(rows.map((r) => r.frames.map(bytes)));
  });

  it('yields after every frame, not once per clip — a chunk is one frame', async () => {
    let yields = 0;
    await bakeRigStripRows(sheets, layers, () => { yields++; return Promise.resolve(); });
    const frames = RIG_ROW_CLIPS.reduce((n, { clip }) => n + clip.frames, 0);
    expect(yields).toBe(frames * 2); // × south + north
  });
});
