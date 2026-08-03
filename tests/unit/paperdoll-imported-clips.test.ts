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
import { bakeClip, type AnimTemplate, type Clip, type PoseLayer } from '@/render/paperdoll/rig';
import { LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';
import { LPC_HUMANOID_NORTH } from '@/render/paperdoll/lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from '@/render/paperdoll/lpc-humanoid-west';
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
  'walk/left': '6f6db8b',
  'walk-brisk/down': '29fc9372',
  'walk-brisk/up': 'aeadade1',
  'walk-brisk/left': '896961c8',
  'wave/down': '454e7057',
  'wave/up': '56521bcf',
  'wave/left': '5ee6a39b',
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
