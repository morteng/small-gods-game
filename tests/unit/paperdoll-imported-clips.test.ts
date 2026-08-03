// @vitest-environment node
/**
 * The imported clips as BAKED PIXELS, not as pose data.
 *
 * `motion-import-determinism.test.ts` pins the other end of this pipe: that
 * re-running the importer reproduces the checked-in `Clip` modules byte for
 * byte. That says the numbers are stable. It says nothing about what those
 * numbers do once `bakeClip` turns them into frames, and everything downstream
 * — the studio bench, the runtime rig rows — consumes the frames.
 *
 * So this suite bakes every landed clip on every authored facing and hashes the
 * result. A hash moving means the rendered motion changed: a keyframe, a chip
 * rect, a pivot, the sampler, the rasteriser. Any of those is a real change
 * worth reading a diff over, and none of them are visible in the clip modules.
 *
 * The layers are synthetic on purpose. Baking against the vendored LPC sheets
 * would need a DOM and a fetch, and would fold "did the art change" into "did
 * the motion change" — two failures with one hash between them. A coordinate
 * ramp instead makes every chip's transform legible in the output bytes: the
 * pixel at (x,y) carries x and y, so a chip that rotates by a degree writes
 * different values, and a chip that does not move cannot hide behind flat fill.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { bakeClip, type AnimTemplate, type Clip, type PoseLayer } from '@/render/paperdoll/rig';
import { fragmentation } from '@/render/paperdoll/clip-measure';
import {
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { HUMANOID_WEST_SOURCE, LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
import { IMPORTED_CLIPS, IMPORTED_CLIP_META } from '@/render/paperdoll/clips';
import type { Raster } from '@/render/sprite-postprocess';

const FACINGS = ['down', 'up', 'left'] as const;
type Facing = (typeof FACINGS)[number];

const TEMPLATES: Record<Facing, AnimTemplate> = {
  down: LPC_HUMANOID_SOUTH,
  up: LPC_HUMANOID_NORTH,
  left: LPC_HUMANOID_WEST,
};

function djb2hex(buf: Uint8ClampedArray): string {
  let h = 5381;
  for (let i = 0; i < buf.length; i++) h = ((h << 5) + h + buf[i]) | 0;
  return (h >>> 0).toString(16);
}

/** A cell whose every pixel states its own coordinate — see the header. */
function coordinateRamp(cell: number): Raster {
  const data = new Uint8ClampedArray(cell * cell * 4);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      data.set([(x * 4) & 255, (y * 4) & 255, 128, 255], (y * cell + x) * 4);
    }
  }
  return { data, w: cell, h: cell };
}

const layersFor = (t: AnimTemplate): PoseLayer[] => [{ raster: coordinateRamp(t.cell) }];

/** One hash over every frame of a bake, so a change anywhere in the clip shows. */
function bakeHash(t: AnimTemplate, clip: Clip): string {
  const frames = bakeClip(t, layersFor(t), clip);
  const joined = new Uint8ClampedArray(frames.reduce((n, f) => n + f.data.length, 0));
  let at = 0;
  for (const f of frames) {
    joined.set(f.data, at);
    at += f.data.length;
  }
  return djb2hex(joined);
}

const CLIP_IDS = Object.keys(IMPORTED_CLIPS).sort();
const cases = CLIP_IDS.flatMap((id) => FACINGS.map((facing) => ({ id, facing })));

/**
 * UPDATE DELIBERATELY. A moved hash is not noise — re-run the studio bench
 * (`?studio=motion`) and look at the clip before pasting a new value here.
 */
const GOLDEN: Record<string, string> = {
  'walk/down': '2574d270',
  'walk/up': 'f2fe3cd6',
  'walk/left': '1a75c1d5',
  'walk-brisk/down': '29fc9372',
  'walk-brisk/up': 'aeadade1',
  'walk-brisk/left': '2a106379',
  'wave/down': '454e7057',
  'wave/up': '56521bcf',
  'wave/left': '687e7abb',
};

describe('imported clips — the bake, not just the keyframes', () => {
  it.each(cases)('$id/$facing bakes to its pinned bytes', ({ id, facing }) => {
    const hash = bakeHash(TEMPLATES[facing], IMPORTED_CLIPS[id][facing]);
    expect(`${id}/${facing} = ${hash}`).toBe(`${id}/${facing} = ${GOLDEN[`${id}/${facing}`]}`);
  });

  it.each(cases)('$id/$facing bakes the same twice', ({ id, facing }) => {
    // Determinism of the BAKE, separate from the pin above: a hash that matched
    // the file but wandered between runs would be a cache or an iteration order,
    // and the pin alone cannot tell those apart from a correct one.
    const t = TEMPLATES[facing];
    expect(bakeHash(t, IMPORTED_CLIPS[id][facing])).toBe(bakeHash(t, IMPORTED_CLIPS[id][facing]));
  });

  it.each(cases)('$id/$facing puts pixels in every frame', ({ id, facing }) => {
    // A clip whose chips all rotate off the cell bakes to transparent frames and
    // still hashes stably. Cheap to assert, and the failure it catches is total.
    const t = TEMPLATES[facing];
    for (const f of bakeClip(t, layersFor(t), IMPORTED_CLIPS[id][facing])) {
      let opaque = 0;
      for (let i = 3; i < f.data.length; i += 4) if (f.data[i] > 0) opaque++;
      expect(opaque).toBeGreaterThan(200);
    }
  });

  it.each(cases)('$id/$facing bakes exactly the frames it declares', ({ id, facing }) => {
    const clip = IMPORTED_CLIPS[id][facing];
    expect(clip.frames).toBeGreaterThan(0);
    expect(bakeClip(TEMPLATES[facing], layersFor(TEMPLATES[facing]), clip)).toHaveLength(clip.frames);
  });
});

describe('imported clips — a looping clip must not pop at the wrap', () => {
  it.each(CLIP_IDS.map((id) => ({ id })))('$id: first and last frame agree iff it loops', ({ id }) => {
    // The meta claims loop closure from POSE equality. This checks the claim
    // where a player would actually notice it — in the pixels. A one-shot is
    // required to differ, so that "loops" never becomes a label nothing tests.
    const looping = IMPORTED_CLIP_META[id].loop;
    for (const facing of FACINGS) {
      const t = TEMPLATES[facing];
      const frames = bakeClip(t, layersFor(t), IMPORTED_CLIPS[id][facing]);
      const first = djb2hex(frames[0].data);
      const last = djb2hex(frames[frames.length - 1].data);
      if (looping) expect(`${id}/${facing}: ${last}`).toBe(`${id}/${facing}: ${first}`);
      else expect(last).not.toBe(first);
    }
  });
});

/**
 * The tearing guard, against the REAL wardrobe.
 *
 * Everything above bakes a coordinate ramp: a full-cell opaque source, chosen so
 * a transform is legible in the bytes. That is exactly the wrong source for this
 * question — with no transparency anywhere, no chip can ever come apart, and
 * `fragmentation` would read zero forever.
 *
 * So this block loads the vendored LPC cells the way `motion-contact-sheet.ts`
 * does. What it pins is the failure that shipped undetected through M1 and M2:
 * the profile leg chips were rected tight to the limb, and a 61° swing carried
 * pixels out of the sampling window until shins detached and feet floated. Every
 * numeric gate in the suite stayed green — the angles were right, the loop
 * closed, the decimation was inside tolerance, the bytes were reproducible — and
 * silhouette IoU scored 0.78 because the damage is INSIDE the outline.
 */
describe('imported clips — the profile leg must not come apart', () => {
  const CELL = LPC_HUMANOID_WEST.cell;

  const cellAt = (sheet: Raster, col: number, row: number): Raster => {
    const data = new Uint8ClampedArray(CELL * CELL * 4);
    for (let y = 0; y < CELL; y++) {
      const si = ((row * CELL + y) * sheet.w + col * CELL) * 4;
      data.set(sheet.data.subarray(si, si + CELL * 4), y * CELL * 4);
    }
    return { data, w: CELL, h: CELL };
  };

  const westLayers = (): PoseLayer[] =>
    DEFAULT_HUMANOID_LAYERS.map((spec) => {
      const png = PNG.sync.read(readFileSync(`public/${spec.path}`));
      const sheet: Raster = { data: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
      return { raster: cellAt(sheet, HUMANOID_SOURCE.col, HUMANOID_WEST_SOURCE.row), assign: spec.assign };
    });

  /**
   * Budgets, not exact counts — summed over the whole clip, so the frame count
   * is part of the scale (the wave is 33 frames against the walks' 9).
   *
   * Landed (margin 1, band 3) vs the pre-M4 tight rects with no skinning:
   *
   *   walk        0 stray /  10 hole   was  37 / 119
   *   walk-brisk 20        /  20        was  24 /  91
   *   wave        0        /  71        was 132 /  76
   *
   * The wave is the honest asterisk: its strays vanish, but its holes barely
   * move, because they are not the leg — they are the gesture's own arm chips,
   * and this change was aimed at the leg. Its budget is set to catch a real
   * regression, not to imply the wave came out clean.
   *
   * When one fires, LOOK at the clip (`scripts/motion-contact-sheet.ts`, or the
   * studio's reference lane) before touching the number. A budget raised to
   * match a regression is worse than no budget at all.
   */
  const BUDGET: Record<string, { stray: number; hole: number }> = {
    walk: { stray: 5, hole: 25 },
    'walk-brisk': { stray: 30, hole: 35 },
    wave: { stray: 10, hole: 90 },
  };

  it.each(CLIP_IDS.map((id) => ({ id })))('$id west stays in one piece', ({ id }) => {
    const frames = bakeClip(LPC_HUMANOID_WEST, westLayers(), IMPORTED_CLIPS[id].left);
    let stray = 0;
    let hole = 0;
    for (const f of frames) {
      const g = fragmentation(f);
      stray += g.strayPx;
      hole += g.holePx;
    }
    expect({ id, stray: stray <= BUDGET[id].stray, hole: hole <= BUDGET[id].hole }).toEqual({
      id,
      stray: true,
      hole: true,
    });
  });

  it('the margin and the band are both load-bearing', () => {
    // Removing either one alone is enough to bring the tearing back, so neither
    // can be quietly dropped as "the other one handles it".
    const layers = westLayers();
    const tight = {
      ...LPC_HUMANOID_WEST,
      chips: LPC_HUMANOID_WEST.chips.map((c) =>
        c.name.startsWith('leg')
          ? { ...c, rect: { ...c.rect, x: c.rect.x + 1, w: c.rect.w - 2 } }
          : c,
      ),
    };
    const strayOf = (t: typeof LPC_HUMANOID_WEST, opts = {}): number =>
      bakeClip(t, layers, IMPORTED_CLIPS.walk.left, opts).reduce(
        (n, f) => n + fragmentation(f).strayPx,
        0,
      );
    const landed = strayOf(LPC_HUMANOID_WEST);
    expect(strayOf(tight)).toBeGreaterThan(landed);
    expect(strayOf({ ...LPC_HUMANOID_WEST, skinBand: undefined })).toBeGreaterThan(landed);
  });
});
