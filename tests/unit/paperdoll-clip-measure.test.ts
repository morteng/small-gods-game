import { describe, expect, it } from 'vitest';
import {
  chipPointTrack,
  cycleFrameAtPhase,
  cycleLength,
  frameCompare,
  skate,
  trackRangeDeg,
} from '@/render/paperdoll/clip-measure';
import type { AnimTemplate, Clip } from '@/render/paperdoll/rig';
import type { Raster } from '@/render/sprite-postprocess';

/** A `size`×`size` raster with an opaque `w`×`h` block at (x,y) in one colour. */
const block = (
  size: number,
  x: number, y: number, w: number, h: number,
  rgb: readonly [number, number, number] = [200, 100, 50],
): Raster => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      const i = (py * size + px) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { data, w: size, h: size };
};

describe('frameCompare', () => {
  it('scores a shape against itself as a perfect match', () => {
    const a = block(8, 2, 2, 4, 4);
    expect(frameCompare(a, a)).toEqual({ iou: 1, colorDelta: 0, overlapPx: 16 });
  });

  it('scores disjoint shapes as zero overlap, with no colour claim', () => {
    const a = block(8, 0, 0, 3, 3);
    const b = block(8, 5, 5, 3, 3);
    const c = frameCompare(a, b);
    expect(c.iou).toBe(0);
    expect(c.overlapPx).toBe(0);
    // Not "maximally different" — there is no shared pixel to have an opinion
    // about, and pretending otherwise would just re-measure the IoU.
    expect(c.colorDelta).toBe(0);
  });

  it('gives a hand-computed value for a known partial overlap', () => {
    // 4×4 at (0,0) and 4×4 at (2,2): a 2×2 intersection, 16+16−4 = 28 union.
    const a = block(8, 0, 0, 4, 4, [100, 100, 100]);
    const b = block(8, 2, 2, 4, 4, [100, 100, 130]);
    const c = frameCompare(a, b);
    expect(c.overlapPx).toBe(4);
    expect(c.iou).toBeCloseTo(4 / 28, 10);
    expect(c.colorDelta).toBeCloseTo(30, 10); // pure blue-channel gap
  });

  it('refuses mismatched dimensions rather than scoring garbage', () => {
    expect(() => frameCompare(block(8, 0, 0, 2, 2), block(4, 0, 0, 2, 2))).toThrow(/dimension mismatch/);
  });
});

describe('phase locking', () => {
  it('counts a looping bake\'s repeated last frame once', () => {
    // The imported walk bakes 9 frames whose 9th repeats the 1st; LPC's own
    // walk row is 8 cells. Counted honestly, both cycles are eight poses.
    expect(cycleLength(9, true)).toBe(8);
    expect(cycleLength(9, false)).toBe(9);
    expect(cycleLength(1, true)).toBe(1);
  });

  it('maps a phase onto a cycle of any length, wrapping at t=1', () => {
    expect(cycleFrameAtPhase(8, 0)).toBe(0);
    expect(cycleFrameAtPhase(8, 0.5)).toBe(4);
    expect(cycleFrameAtPhase(8, 0.99)).toBe(7);
    expect(cycleFrameAtPhase(8, 1)).toBe(0);
    // An 8-cell row and a 9-frame bake agree pose-for-pose, which is the whole
    // reason the lane locks on phase instead of index.
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((f) => cycleFrameAtPhase(8, f / 8)))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });
});

describe('trackRangeDeg', () => {
  it('measures peak-to-peak keyed rotation, and 0 for an unkeyed chip', () => {
    const clip: Clip = {
      name: 'swing',
      frames: 4,
      tracks: { leg: [{ t: 0, deg: -12 }, { t: 0.5, deg: 20 }, { t: 1, deg: -12 }] },
    };
    expect(trackRangeDeg(clip, 'leg')).toBe(32);
    expect(trackRangeDeg(clip, 'arm')).toBe(0);
  });

  it('sees the frontal projection flatten a leg swing the profile keeps', () => {
    // Not a defect: a walk captured toward the camera has almost no in-plane
    // leg travel, so the frontal facing legitimately keys single digits.
    const frontal: Clip = { name: 'w', frames: 4, tracks: { leg: [{ t: 0, deg: -4 }, { t: 1, deg: 5 }] } };
    const profile: Clip = { name: 'w', frames: 4, tracks: { leg: [{ t: 0, deg: -30 }, { t: 1, deg: 32 }] } };
    expect(trackRangeDeg(frontal, 'leg')).toBeLessThan(trackRangeDeg(profile, 'leg') / 5);
  });
});

// ── skate ────────────────────────────────────────────────────────────────────

/** Two chips: a root that translates, and a leaf the sole point rides. */
const TEMPLATE: AnimTemplate = {
  name: 'test',
  cell: 64,
  chips: [
    { name: 'trunk', rect: { x: 0, y: 0, w: 64, h: 64 }, pivot: [32, 32], parent: -1, z: 0 },
    { name: 'leg', rect: { x: 28, y: 40, w: 8, h: 20 }, pivot: [32, 44], parent: 0, z: 1 },
  ],
};
const SOLE: [number, number] = [32, 60];

const track = (clip: Clip): [number, number][] => chipPointTrack(TEMPLATE, clip, 'leg', SOLE);

describe('skate', () => {
  it('reports ~0 for a foot that genuinely never moves', () => {
    // The leg swings; the trunk counter-translates nothing, but the sole sits
    // ON the pivot's vertical, so a pure plant is expressed as an unkeyed leg.
    const planted: Clip = { name: 'planted', frames: 5, tracks: { trunk: [{ t: 0, deg: 0 }, { t: 1, deg: 0 }] } };
    const r = skate(track(planted));
    expect(r.worst).toBeCloseTo(0, 10);
    expect(r.jitter).toBeCloseTo(0, 10);
    expect(r.rawSpread).toBeCloseTo(0, 10);
  });

  it('detrends a constant slide to ~0 while the raw spread keeps it', () => {
    // An in-place locomotion bake slides its stance sole one stride per cycle
    // BY DESIGN. Scoring that as error would condemn a correct bake, so the
    // number that matters is what is left once the slide is removed.
    const sliding: Clip = {
      name: 'sliding',
      frames: 9,
      tracks: { trunk: [{ t: 0, deg: 0, dx: 0 }, { t: 1, deg: 0, dx: 40 }] },
    };
    const pts = track(sliding);
    const r = skate(pts);
    expect(r.rawSpread).toBeCloseTo(40, 6);
    expect(r.slidePerFrame[0]).toBeCloseTo(5, 6);
    // Smoothstep easing means the slide is not perfectly linear, so a little
    // residual is honest — but it is a fraction of the 40px it came out of.
    expect(r.worst).toBeLessThan(4);
    expect(r.jitter).toBeLessThan(r.rawSpread / 5);
  });

  it('a linear slide detrends to exactly zero', () => {
    const pts: [number, number][] = [0, 1, 2, 3, 4].map((f) => [f * 7, 0]);
    const r = skate(pts);
    expect(r.rawSpread).toBeCloseTo(28, 10);
    expect(r.worst).toBeCloseTo(0, 10);
    expect(r.slidePerFrame).toEqual([7, 0]);
  });

  it('names the worst frame of a slide with one bad step in it', () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [20, 0], [34, 0], [40, 0]];
    const r = skate(pts);
    expect(r.worstFrame).toBe(3); // the 14px step among 10px ones
    expect(r.worst).toBeGreaterThan(2);
    expect(r.perFrame).toHaveLength(5);
  });

  it('survives an empty track (a chip the template does not own)', () => {
    expect(chipPointTrack(TEMPLATE, { name: 'x', frames: 4, tracks: {} }, 'nope', SOLE)).toEqual([]);
    expect(skate([]).worst).toBe(0);
  });
});
