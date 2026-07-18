import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  chipWorldTransforms,
  lerpPoses,
  renderClipLayers,
  renderPose,
  sampleClip,
  sampleClipLayers,
  type AnimTemplate,
  type Clip,
} from '@/render/paperdoll/rig';
import type { Raster } from '@/render/sprite-postprocess';

const T: AnimTemplate = {
  name: 'layer-test',
  cell: 8,
  chips: [
    { name: 'root', rect: { x: 0, y: 0, w: 8, h: 8 }, pivot: [4, 4], parent: -1, z: 0 },
    { name: 'arm', rect: { x: 5, y: 2, w: 2, h: 3 }, pivot: [5, 2], parent: 0, z: 1 },
    { name: 'leg', rect: { x: 3, y: 5, w: 2, h: 3 }, pivot: [3, 5], parent: 0, z: 1 },
  ],
};

const GAIT: Clip = {
  name: 'gait',
  frames: 2,
  tracks: {
    root: [
      { t: 0, deg: 0, dx: 0 },
      { t: 1, deg: 0, dx: -2 },
    ],
    leg: [
      { t: 0, deg: 0 },
      { t: 1, deg: 20 },
    ],
  },
};

const WAVE: Clip = {
  name: 'wave',
  frames: 2,
  tracks: {
    arm: [
      { t: 0, deg: 0 },
      { t: 1, deg: -90 },
    ],
    root: [
      { t: 0, deg: 0 },
      { t: 1, deg: 6 },
    ],
  },
};

describe('sampleClipLayers', () => {
  it('a single full-weight override layer equals sampleClip', () => {
    for (const t of [0, 0.4, 1]) {
      expect(sampleClipLayers(T, [{ clip: GAIT, t }])).toEqual(sampleClip(T, GAIT, t));
    }
  });

  it('masked override writes only its chips; the base keeps the rest', () => {
    const poses = sampleClipLayers(T, [
      { clip: GAIT, t: 1 },
      { clip: WAVE, t: 1, chips: ['arm'] },
    ]);
    expect(poses[1].deg).toBeCloseTo(-90); // wave owns the arm
    expect(poses[0].dx).toBeCloseTo(-2); // gait's root untouched (wave's root masked out)
    expect(poses[0].deg).toBe(0);
    expect(poses[2].deg).toBeCloseTo(20); // gait's leg untouched
  });

  it('additive stacks weight-scaled values on top of the base', () => {
    const poses = sampleClipLayers(T, [
      { clip: GAIT, t: 1 },
      { clip: WAVE, t: 1, mode: 'additive', weight: 0.5 },
    ]);
    expect(poses[0].deg).toBeCloseTo(3); // 0 + 0.5 × 6
    expect(poses[0].dx).toBeCloseTo(-2); // wave keys no root dx → adds 0
    expect(poses[1].deg).toBeCloseTo(-45); // 0 + 0.5 × -90
  });

  it('a weighted override IS a crossfade between the two stacks', () => {
    const a = sampleClip(T, GAIT, 1);
    const b = sampleClip(T, WAVE, 1);
    const mid = sampleClipLayers(T, [
      { clip: GAIT, t: 1 },
      { clip: WAVE, t: 1, weight: 0.5 },
    ]);
    expect(mid).toEqual(lerpPoses(a, b, 0.5));
    // Endpoints hit each clip exactly.
    expect(sampleClipLayers(T, [{ clip: GAIT, t: 1 }, { clip: WAVE, t: 1, weight: 0 }])).toEqual(a);
    expect(sampleClipLayers(T, [{ clip: GAIT, t: 1 }, { clip: WAVE, t: 1, weight: 1 }])).toEqual(b);
  });

  it('base-layer plants survive an additive overlay above them', () => {
    const SOLE: [number, number] = [4, 8];
    const planted: Clip = {
      ...GAIT,
      couple: [{ from: 'leg', prop: 'deg', to: 'leg', gain: 0 }],
      plant: [{ chip: 'leg', point: SOLE }],
    };
    const poses = sampleClipLayers(T, [
      { clip: planted, t: 1 },
      { clip: WAVE, t: 1, mode: 'additive', weight: 1, chips: ['arm', 'root'] },
    ]);
    // The overlay leaned the root, yet the sole point stays exactly at rest —
    // plants run once, on the MERGED pose.
    const world = chipWorldTransforms(T, poses);
    const [px, py] = applyAffine(world[2], SOLE[0], SOLE[1]);
    expect(px).toBeCloseTo(SOLE[0], 6);
    expect(py).toBeCloseTo(SOLE[1], 6);
    expect(poses[0].deg).toBeCloseTo(6); // the lean really happened
  });

  it('a layer only contributes plants for chips inside its own mask', () => {
    const planted: Clip = { ...WAVE, plant: [{ chip: 'leg', point: [4, 8] }] };
    const noPlant = sampleClipLayers(T, [
      { clip: GAIT, t: 1 },
      { clip: planted, t: 1, chips: ['arm'] }, // mask excludes leg → its plant is dropped
    ]);
    const withPlant = sampleClipLayers(T, [
      { clip: GAIT, t: 1 },
      { clip: planted, t: 1, chips: ['arm', 'leg'] },
    ]);
    expect(noPlant[2].dx).toBe(0); // no compensation ran
    expect(withPlant[2].dx).not.toBe(0); // plant ran on the merged pose
  });
});

describe('renderClipLayers', () => {
  const cell = (fill: [number, number, number]): Raster => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 64; i++) data.set([...fill, 255], i * 4);
    return { data, w: 8, h: 8 };
  };

  it('single layer stack renders identically to renderPose(sampleClip)', () => {
    const layer = cell([200, 100, 50]);
    const a = renderClipLayers(T, [layer], [{ clip: GAIT, t: 0.5 }], { supersample: 2 });
    const b = renderPose(T, [layer], sampleClip(T, GAIT, 0.5), { supersample: 2 });
    expect(a.data).toEqual(b.data);
  });

  it('anchored stamps from an overlay layer paste at the composed pose', () => {
    // Overlay swings the arm 180° about its pivot and carries a 1×1 green stamp
    // anchored to it; the paste must land at the rotated position.
    const stamped: Clip = {
      name: 'stamp',
      frames: 2,
      tracks: { arm: [{ t: 0, deg: 0 }, { t: 1, deg: 180 }] },
      stamps: [
        {
          t: 0,
          refs: [
            { self: true, crop: { x: 0, y: 0, w: 1, h: 1 }, dest: [5, 4], anchor: 'arm' },
          ],
        },
      ],
    };
    const layer = cell([200, 100, 50]);
    layer.data.set([0, 255, 0, 255], 0); // donor pixel at (0,0) is green
    const frame = renderClipLayers(T, [layer], [
      { clip: GAIT, t: 0 },
      { clip: stamped, t: 1, chips: ['arm'] },
    ], { supersample: 2 });
    // dest center (5.5, 4.5) rotated 180° about pivot (5,2) → (4.5, -0.5) →
    // paste rounds to (4, -1): y clips off-cell, so assert via the un-clipped
    // variant at 90°: (5.5,4.5) → 90° cw about (5,2) → (2.5, 2.5) → paste (2,2).
    const stamped90: Clip = {
      ...stamped,
      tracks: { arm: [{ t: 0, deg: 0 }, { t: 1, deg: 90 }] },
    };
    const f90 = renderClipLayers(T, [layer], [
      { clip: GAIT, t: 0 },
      { clip: stamped90, t: 1, chips: ['arm'] },
    ], { supersample: 2 });
    const px = (f: Raster, x: number, y: number): number[] => [...f.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
    expect(px(f90, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(frame.w).toBe(8); // 180° case just renders without throwing
  });
});
