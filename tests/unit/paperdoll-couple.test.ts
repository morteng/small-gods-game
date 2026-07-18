import { describe, expect, it } from 'vitest';
import { sampleClip, sampleTrack, type AnimTemplate, type Clip } from '@/render/paperdoll/rig';
import { CLIP_DESPAIR, CLIP_PRAY_BOW, CLIP_PRAY_ECSTATIC, LPC_HUMANOID_SOUTH } from '@/render/paperdoll/lpc-humanoid';

const T: AnimTemplate = {
  name: 'couple-test',
  cell: 8,
  chips: [
    { name: 'root', rect: { x: 0, y: 0, w: 8, h: 8 }, pivot: [4, 4], parent: -1, z: 0 },
    { name: 'thigh', rect: { x: 2, y: 4, w: 2, h: 2 }, pivot: [3, 4], parent: 0, z: 1 },
    { name: 'shin', rect: { x: 2, y: 6, w: 2, h: 2 }, pivot: [3, 6], parent: 1, z: 2 },
  ],
};

const rootSway: Clip['tracks'] = {
  root: [
    { t: 0, deg: 0, dx: 0 },
    { t: 1, deg: 0, dx: -2 },
  ],
};

describe('sampleClip couplings', () => {
  it('adds gain × source track value to the destination (deg by default)', () => {
    const clip: Clip = {
      name: 'c',
      frames: 2,
      tracks: rootSway,
      couple: [{ from: 'root', prop: 'dx', to: 'thigh', gain: -6 }],
    };
    const poses = sampleClip(T, clip, 1);
    expect(poses[1].deg).toBeCloseTo(12); // -6 × -2
    expect(poses[1].dx).toBe(0); // only the named prop is written
    expect(poses[0].dx).toBe(-2); // source pose untouched
  });

  it('stacks on top of the destination chip\'s own track', () => {
    const clip: Clip = {
      name: 'c',
      frames: 2,
      tracks: {
        ...rootSway,
        thigh: [
          { t: 0, deg: 0 },
          { t: 1, deg: 10 },
        ],
      },
      couple: [{ from: 'root', prop: 'dx', to: 'thigh', gain: 1 }],
    };
    expect(sampleClip(T, clip, 1)[1].deg).toBeCloseTo(8); // 10 + 1×(-2)
  });

  it('writes toProp when given, and multiple couplings accumulate', () => {
    const clip: Clip = {
      name: 'c',
      frames: 2,
      tracks: rootSway,
      couple: [
        { from: 'root', prop: 'dx', to: 'shin', toProp: 'dx', gain: 0.5 },
        { from: 'root', prop: 'dx', to: 'shin', toProp: 'dx', gain: 0.25 },
      ],
    };
    expect(sampleClip(T, clip, 1)[2].dx).toBeCloseTo(-1.5); // (0.5+0.25) × -2
  });

  it('lag samples the source earlier, clamped to t=0', () => {
    const clip: Clip = {
      name: 'c',
      frames: 2,
      tracks: rootSway,
      couple: [{ from: 'root', prop: 'dx', to: 'thigh', gain: 1, lag: 0.25 }],
    };
    const lagged = sampleTrack(rootSway.root, 0.25).dx;
    expect(sampleClip(T, clip, 0.5)[1].deg).toBeCloseTo(lagged);
    expect(sampleClip(T, clip, 0.1)[1].deg).toBeCloseTo(sampleTrack(rootSway.root, 0).dx); // clamped
  });

  it('ignores couplings naming unknown chips, and reads only raw tracks (no chaining)', () => {
    const clip: Clip = {
      name: 'c',
      frames: 2,
      tracks: rootSway,
      couple: [
        { from: 'root', prop: 'dx', to: 'ghost', gain: 9 },
        { from: 'ghost', prop: 'deg', to: 'thigh', gain: 9 },
        { from: 'root', prop: 'dx', to: 'thigh', gain: -1 },
        // thigh's DERIVED deg must not leak into shin — sources are tracks only.
        { from: 'thigh', prop: 'deg', to: 'shin', gain: 1 },
      ],
    };
    const poses = sampleClip(T, clip, 1);
    expect(poses[1].deg).toBeCloseTo(2); // only the valid root coupling
    expect(poses[2].deg).toBe(0); // thigh has no keyed track → shin gets nothing
  });
});

describe('authored clips use couplings', () => {
  it('despair: coupled shins exactly counter the thighs (feet planted, as the old hand keys did)', () => {
    const chips = LPC_HUMANOID_SOUTH.chips.map((c) => c.name);
    const thighL = chips.indexOf('legL_up');
    const shinL = chips.indexOf('legL_fore');
    const thighR = chips.indexOf('legR_up');
    const shinR = chips.indexOf('legR_fore');
    for (const t of [0, 0.3, 0.6, 1]) {
      const poses = sampleClip(LPC_HUMANOID_SOUTH, CLIP_DESPAIR, t);
      expect(poses[shinL].deg).toBeCloseTo(-poses[thighL].deg);
      expect(poses[shinR].deg).toBeCloseTo(-poses[thighR].deg);
    }
  });

  it('pray-bow: the head drop splays the knees, shins counter to keep feet planted', () => {
    const chips = LPC_HUMANOID_SOUTH.chips.map((c) => c.name);
    const thighL = chips.indexOf('legL_up');
    const shinL = chips.indexOf('legL_fore');
    const thighR = chips.indexOf('legR_up');
    // Rest: straight legs.
    expect(sampleClip(LPC_HUMANOID_SOUTH, CLIP_PRAY_BOW, 0)[thighL].deg).toBe(0);
    const poses = sampleClip(LPC_HUMANOID_SOUTH, CLIP_PRAY_BOW, 1);
    expect(poses[thighL].deg).toBeGreaterThan(0); // splays with the bow
    expect(poses[thighR].deg).toBeLessThan(0); // mirrored
    expect(poses[shinL].deg).toBeCloseTo(-poses[thighL].deg); // planted feet
  });

  it('pray-ecstatic: trunk sway drives a partial, lagged knee flex', () => {
    const chips = LPC_HUMANOID_SOUTH.chips.map((c) => c.name);
    const thigh = chips.indexOf('legL_up');
    const shin = chips.indexOf('legL_fore');
    // Before the sway starts, knees are straight.
    expect(sampleClip(LPC_HUMANOID_SOUTH, CLIP_PRAY_ECSTATIC, 0.2)[thigh].deg).toBe(0);
    // Mid-sway (trunk dx < 0): thigh flexes into the sway, shin counters PART
    // of it — the below-knee smidge — and trails on a longer lag.
    const poses = sampleClip(LPC_HUMANOID_SOUTH, CLIP_PRAY_ECSTATIC, 0.76);
    expect(poses[thigh].deg).toBeGreaterThan(0);
    expect(poses[shin].deg).toBeLessThan(0);
    expect(Math.abs(poses[shin].deg)).toBeLessThan(Math.abs(poses[thigh].deg));
  });
});
