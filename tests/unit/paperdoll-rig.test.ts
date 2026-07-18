import { describe, expect, it } from 'vitest';
import {
  applyAffine,
  bakeClip,
  chipWorldTransforms,
  invertAffine,
  mulAffine,
  renderPose,
  rootChipRaster,
  sampleClip,
  sampleTrack,
  type Affine,
  type AnimTemplate,
  type ChipPose,
} from '@/render/paperdoll/rig';
import {
  CLIP_PRAY_BOW,
  CLIP_PRAY_RAISE,
  DEFAULT_HUMANOID_LAYERS,
  LPC_HUMANOID_SOUTH,
} from '@/render/paperdoll/lpc-humanoid';
import type { Raster } from '@/render/sprite-postprocess';

// ── tiny fixture template: 8px cell, root + one arm + one forearm ────────────
const T: AnimTemplate = {
  name: 'test',
  cell: 8,
  chips: [
    { name: 'root', rect: { x: 0, y: 0, w: 8, h: 8 }, pivot: [4, 4], parent: -1, z: 0 },
    { name: 'arm', rect: { x: 5, y: 2, w: 3, h: 3 }, pivot: [5, 2], parent: 0, z: 1 },
    { name: 'fore', rect: { x: 5, y: 5, w: 3, h: 3 }, pivot: [6, 5], parent: 1, z: 2 },
  ],
};

const P = (deg = 0, dx = 0, dy = 0): ChipPose => ({ deg, dx, dy });

function solidCell(n: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) data.set(rgba, i * 4);
  return { data, w: n, h: n };
}

describe('affine math', () => {
  it('invertAffine round-trips', () => {
    const m: Affine = [0.6, -0.8, 3, 0.8, 0.6, -2];
    const inv = invertAffine(m);
    const [x, y] = applyAffine(inv, ...applyAffine(m, 5, 7));
    expect(x).toBeCloseTo(5, 10);
    expect(y).toBeCloseTo(7, 10);
  });

  it('mulAffine composes like nested application', () => {
    const A: Affine = [0, -1, 2, 1, 0, 1];
    const B: Affine = [1, 0, -3, 0, 1, 4];
    const viaMul = applyAffine(mulAffine(A, B), 2, 3);
    const nested = applyAffine(A, ...applyAffine(B, 2, 3));
    expect(viaMul[0]).toBeCloseTo(nested[0], 10);
    expect(viaMul[1]).toBeCloseTo(nested[1], 10);
  });
});

describe('sampleTrack', () => {
  const track = [
    { t: 0, deg: 0, dy: 0 },
    { t: 1, deg: 90, dy: -4 },
  ];

  it('clamps to endpoints and hits them exactly', () => {
    expect(sampleTrack(track, -1).deg).toBe(0);
    expect(sampleTrack(track, 0).deg).toBe(0);
    expect(sampleTrack(track, 1).deg).toBe(90);
    expect(sampleTrack(track, 2).deg).toBe(90);
    expect(sampleTrack(track, 1).dy).toBe(-4);
  });

  it('smoothsteps between keys (midpoint = mean, eased quarters)', () => {
    expect(sampleTrack(track, 0.5).deg).toBeCloseTo(45, 10);
    expect(sampleTrack(track, 0.5).dy).toBeCloseTo(-2, 10);
    expect(sampleTrack(track, 0.25).deg).toBeLessThan(22.5); // ease-in undercuts linear
    expect(sampleTrack(track, 0.75).deg).toBeGreaterThan(67.5); // ease-out overshoots linear
  });

  it('missing track = identity pose', () => {
    expect(sampleTrack(undefined, 0.5)).toEqual({ deg: 0, dx: 0, dy: 0 });
  });
});

describe('FK hierarchy', () => {
  it('rotation pivot is a fixed point of its own chip transform', () => {
    const world = chipWorldTransforms(T, [P(), P(33), P()]);
    const [px, py] = applyAffine(world[1], 5, 2);
    expect(px).toBeCloseTo(5, 10);
    expect(py).toBeCloseTo(2, 10);
  });

  it('child inherits parent rotation', () => {
    // Parent arm rotates 90° about (5,2); child's pivot (6,5) must move with it.
    const world = chipWorldTransforms(T, [P(), P(90), P()]);
    // y-down 90° CW about (5,2): (6,5) → (5 - (5-2), 2 + (6-5)) = (2, 3)
    const [cx, cy] = applyAffine(world[2], 6, 5);
    expect(cx).toBeCloseTo(2, 10);
    expect(cy).toBeCloseTo(3, 10);
  });

  it('translation offsets after rotation and propagates to children', () => {
    // Arm translated (0, +2) with no rotation: its pivot AND its child move down 2.
    const world = chipWorldTransforms(T, [P(), P(0, 0, 2), P()]);
    expect(applyAffine(world[1], 5, 2)[1]).toBeCloseTo(4, 10);
    expect(applyAffine(world[2], 6, 5)[1]).toBeCloseTo(7, 10);
  });
});

describe('rootChipRaster', () => {
  it('clears every non-root chip rect', () => {
    const cell = solidCell(8, [200, 100, 50, 255]);
    const root = rootChipRaster(T, cell);
    expect(root[(2 * 8 + 5) * 4 + 3]).toBe(0); // inside arm rect
    expect(root[(5 * 8 + 6) * 4 + 3]).toBe(0); // inside fore rect
    expect(root[(0 * 8 + 0) * 4 + 3]).toBe(255); // untouched root pixel
    expect(cell.data[(2 * 8 + 5) * 4 + 3]).toBe(255); // input not mutated
  });
});

describe('renderPose', () => {
  const REST = [P(), P(), P()];

  it('identity pose preserves opaque pixels exactly', () => {
    const cell = solidCell(8, [10, 200, 30, 255]);
    const out = renderPose(T, [cell], REST);
    for (let i = 0; i < 8 * 8; i++) {
      expect(out.data[i * 4]).toBe(10);
      expect(out.data[i * 4 + 1]).toBe(200);
      expect(out.data[i * 4 + 2]).toBe(30);
      expect(out.data[i * 4 + 3]).toBe(255);
    }
  });

  it('is deterministic', () => {
    const cell = solidCell(8, [90, 60, 120, 255]);
    const a = renderPose(T, [cell], [P(), P(45), P(-30)]);
    const b = renderPose(T, [cell], [P(), P(45), P(-30)]);
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data));
  });

  it('rotating a limb vacates its old rect in the root layer', () => {
    // A cell opaque ONLY inside the arm rect: after 90° the arm's pixels move,
    // and the root (cleared) contributes nothing — old arm area must be empty.
    const n = 8;
    const data = new Uint8ClampedArray(n * n * 4);
    const armRect = T.chips[1].rect;
    for (let y = armRect.y; y < armRect.y + armRect.h; y++)
      for (let x = armRect.x; x < armRect.x + armRect.w; x++)
        data.set([255, 0, 0, 255], (y * n + x) * 4);
    const out = renderPose(T, [{ data, w: n, h: n }], [P(), P(90), P()]);
    // far corner of the original arm rect (7,4) is >2px from the pivot's new
    // footprint — must now be transparent.
    expect(out.data[(4 * n + 7) * 4 + 3]).toBe(0);
    // and the arm reappears somewhere: total coverage is preserved-ish (>0).
    let covered = 0;
    for (let i = 0; i < n * n; i++) if (out.data[i * 4 + 3] > 0) covered++;
    expect(covered).toBeGreaterThan(4);
  });

  it('an assigned layer rides its chip wholesale — even pixels outside the chip rect', () => {
    // Layer opaque at (0,7) — far OUTSIDE the arm rect. Assigned to 'arm' and
    // translated (+2,0): the pixel must move to (2,7) and never appear at rest.
    const n = 8;
    const data = new Uint8ClampedArray(n * n * 4);
    data.set([0, 255, 0, 255], (7 * n + 0) * 4);
    const layer = { raster: { data, w: n, h: n }, assign: 'arm' };
    const moved = renderPose(T, [layer], [P(), P(0, 2, 0), P()]);
    expect(moved.data[(7 * n + 2) * 4 + 3]).toBe(255);
    expect(moved.data[(7 * n + 2) * 4 + 1]).toBe(255);
    expect(moved.data[(7 * n + 0) * 4 + 3]).toBe(0); // origin vacated
  });

  it('an assigned layer contributes nothing to other chips (no trunk ghost)', () => {
    // Same layer, arm rotated far away: pixel at (0,7) is outside every arm
    // destination — if the root sliced this layer, a ghost would remain at (0,7).
    const n = 8;
    const data = new Uint8ClampedArray(n * n * 4);
    data.set([0, 255, 0, 255], (7 * n + 0) * 4);
    const layer = { raster: { data, w: n, h: n }, assign: 'arm' };
    const out = renderPose(T, [layer], [P(), P(0, 5, -7), P()]);
    expect(out.data[(7 * n + 0) * 4 + 3]).toBe(0);
  });
});

describe('humanoid template + clips', () => {
  it('template is well-formed: root first, parents point backwards, unique names', () => {
    const chips = LPC_HUMANOID_SOUTH.chips;
    expect(chips[0].parent).toBe(-1);
    const names = new Set<string>();
    chips.forEach((ch, i) => {
      expect(names.has(ch.name)).toBe(false);
      names.add(ch.name);
      if (i > 0) {
        expect(ch.parent).toBeGreaterThanOrEqual(0);
        expect(ch.parent).toBeLessThan(i);
      }
      expect(ch.rect.x).toBeGreaterThanOrEqual(0);
      expect(ch.rect.y).toBeGreaterThanOrEqual(0);
      expect(ch.rect.x + ch.rect.w).toBeLessThanOrEqual(LPC_HUMANOID_SOUTH.cell);
      expect(ch.rect.y + ch.rect.h).toBeLessThanOrEqual(LPC_HUMANOID_SOUTH.cell);
    });
  });

  it('clip tracks reference real chips', () => {
    const names = new Set(LPC_HUMANOID_SOUTH.chips.map((c) => c.name));
    for (const clip of [CLIP_PRAY_RAISE, CLIP_PRAY_BOW]) {
      for (const key of Object.keys(clip.tracks)) expect(names.has(key)).toBe(true);
      expect(clip.frames).toBeGreaterThanOrEqual(2);
    }
  });

  it('layer assignments reference real chips', () => {
    const names = new Set(LPC_HUMANOID_SOUTH.chips.map((c) => c.name));
    for (const spec of DEFAULT_HUMANOID_LAYERS) {
      if (spec.assign !== undefined) expect(names.has(spec.assign)).toBe(true);
    }
  });

  it('head tracks translate, never rotate (front-facing pitch is faked with dy)', () => {
    for (const clip of [CLIP_PRAY_RAISE, CLIP_PRAY_BOW]) {
      for (const k of clip.tracks.head) expect(k.deg).toBe(0);
      const end = clip.tracks.head[clip.tracks.head.length - 1];
      expect(end.dy).not.toBe(0);
    }
  });

  it('frame 0 of a stand→pose clip is the rest pose', () => {
    const poses = sampleClip(LPC_HUMANOID_SOUTH, CLIP_PRAY_RAISE, 0);
    expect(poses.every((p) => p.deg === 0 && p.dx === 0 && p.dy === 0)).toBe(true);
  });

  it('bakeClip yields the declared frame count at cell size', () => {
    const cell = solidCell(64, [128, 128, 128, 255]);
    const frames = bakeClip(LPC_HUMANOID_SOUTH, [cell], CLIP_PRAY_RAISE, { supersample: 2 });
    expect(frames).toHaveLength(CLIP_PRAY_RAISE.frames);
    expect(frames[0].w).toBe(64);
    expect(frames[0].h).toBe(64);
  });
});
