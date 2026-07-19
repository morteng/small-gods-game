import { describe, expect, it } from 'vitest';
import { sampleClip } from '@/render/paperdoll/rig';
import {
  floraTemplate,
  floraWindClip,
  FLOWER_STEM_BLADES,
  GRASS_TUFT_BLADES,
  type FloraBlade,
} from '@/render/paperdoll/flora-wind';

const CELL = 32;

const BLADES: readonly FloraBlade[] = [
  { rect: { x: 4, y: 10, w: 3, h: 20 }, pivot: [5, 29], phase: 0, gain: 1 },
  { rect: { x: 10, y: 16, w: 3, h: 14 }, pivot: [11, 29], phase: 0.25, gain: 0.5 },
  { rect: { x: 16, y: 4, w: 3, h: 26 }, pivot: [17, 29], phase: 0.5, gain: 1.5 },
];

describe('floraTemplate', () => {
  const t = floraTemplate('test-flora', CELL, BLADES);

  it('chip 0 is the root: full-cell rect, pivot [cell/2, cell-1], parent -1, z 0', () => {
    expect(t.chips[0]).toEqual({
      name: 'root',
      rect: { x: 0, y: 0, w: CELL, h: CELL },
      pivot: [CELL / 2, CELL - 1],
      parent: -1,
      z: 0,
    });
  });

  it('one chip per blade, named blade0..bladeN, parented to root, z 1, in list order', () => {
    expect(t.chips).toHaveLength(BLADES.length + 1);
    BLADES.forEach((b, i) => {
      const ch = t.chips[i + 1];
      expect(ch.name).toBe(`blade${i}`);
      expect(ch.parent).toBe(0);
      expect(ch.z).toBe(1);
      expect(ch.rect).toEqual(b.rect);
      expect(ch.pivot).toEqual(b.pivot);
    });
  });

  it('cell size passes through', () => {
    expect(t.cell).toBe(CELL);
    expect(t.name).toBe('test-flora');
  });
});

describe('floraWindClip loop closure', () => {
  const t = floraTemplate('test-flora', CELL, BLADES);
  const clip = floraWindClip(t, BLADES, 8, 6);

  it('sampleClip(t=0) deep-equals sampleClip(t=1) for every chip', () => {
    const at0 = sampleClip(t, clip, 0);
    const at1 = sampleClip(t, clip, 1);
    expect(at1).toEqual(at0);
  });

  it('closure holds for varied phases/gains and blade counts (1..7 blades)', () => {
    for (let n = 1; n <= 7; n++) {
      const blades: FloraBlade[] = Array.from({ length: n }, (_, i) => ({
        rect: { x: i * 4, y: 0, w: 3, h: 10 + i },
        pivot: [i * 4 + 1, 29],
        phase: (i * 0.137) % 1,
        gain: 0.3 + i * 0.2,
      }));
      const tmpl = floraTemplate(`closure-${n}`, CELL, blades);
      const c = floraWindClip(tmpl, blades, 6, 9);
      expect(sampleClip(tmpl, c, 1)).toEqual(sampleClip(tmpl, c, 0));
    }
  });

  it('closure holds for the authored demo species too', () => {
    const grassT = floraTemplate('grass-tuft', CELL, GRASS_TUFT_BLADES);
    const grassC = floraWindClip(grassT, GRASS_TUFT_BLADES, 8, 6);
    expect(sampleClip(grassT, grassC, 1)).toEqual(sampleClip(grassT, grassC, 0));

    const flowerT = floraTemplate('flower', CELL, FLOWER_STEM_BLADES);
    const flowerC = floraWindClip(flowerT, FLOWER_STEM_BLADES, 8, 6);
    expect(sampleClip(flowerT, flowerC, 1)).toEqual(sampleClip(flowerT, flowerC, 0));
  });
});

describe('floraWindClip amplitude scaling', () => {
  it('peak |deg| across sampled t scales linearly with amplitudeDeg for a gain-1 blade', () => {
    const single: FloraBlade[] = [{ rect: { x: 0, y: 0, w: 3, h: 10 }, pivot: [1, 29], phase: 0, gain: 1 }];
    const t = floraTemplate('amp', CELL, single);
    const peakAt = (amp: number): number => {
      const clip = floraWindClip(t, single, 8, amp);
      let peak = 0;
      for (let i = 0; i < 200; i++) {
        const poses = sampleClip(t, clip, i / 199);
        peak = Math.max(peak, Math.abs(poses[1].deg));
      }
      return peak;
    };
    const p6 = peakAt(6);
    const p12 = peakAt(12);
    const p18 = peakAt(18);
    expect(p6).toBeGreaterThan(0);
    expect(p12 / p6).toBeCloseTo(2, 1);
    expect(p18 / p6).toBeCloseTo(3, 1);
  });

  it('peak |deg| scales with blade gain at fixed amplitude', () => {
    const blades: FloraBlade[] = [
      { rect: { x: 0, y: 0, w: 3, h: 10 }, pivot: [1, 29], phase: 0, gain: 1 },
      { rect: { x: 4, y: 0, w: 3, h: 10 }, pivot: [5, 29], phase: 0, gain: 2 },
    ];
    const t = floraTemplate('gain', CELL, blades);
    const clip = floraWindClip(t, blades, 8, 10);
    let peak1 = 0;
    let peak2 = 0;
    for (let i = 0; i < 200; i++) {
      const poses = sampleClip(t, clip, i / 199);
      peak1 = Math.max(peak1, Math.abs(poses[1].deg));
      peak2 = Math.max(peak2, Math.abs(poses[2].deg));
    }
    expect(peak2 / peak1).toBeCloseTo(2, 1);
  });

  it('a blade with no explicit gain defaults to gain 1 (same peak as gain: 1)', () => {
    const withGain: FloraBlade[] = [{ rect: { x: 0, y: 0, w: 3, h: 10 }, pivot: [1, 29], gain: 1 }];
    const noGain: FloraBlade[] = [{ rect: { x: 0, y: 0, w: 3, h: 10 }, pivot: [1, 29] }];
    const t1 = floraTemplate('g1', CELL, withGain);
    const t2 = floraTemplate('g2', CELL, noGain);
    const c1 = floraWindClip(t1, withGain, 8, 8);
    const c2 = floraWindClip(t2, noGain, 8, 8);
    for (const tt of [0, 0.25, 0.5, 0.75, 1]) {
      expect(sampleClip(t2, c2, tt)[1].deg).toBeCloseTo(sampleClip(t1, c1, tt)[1].deg, 6);
    }
  });
});

describe('floraWindClip phase de-sync', () => {
  it('two blades with phases 0 and 0.25 hit their peaks at different t', () => {
    const blades: FloraBlade[] = [
      { rect: { x: 0, y: 0, w: 3, h: 10 }, pivot: [1, 29], phase: 0, gain: 1 },
      { rect: { x: 4, y: 0, w: 3, h: 10 }, pivot: [5, 29], phase: 0.25, gain: 1 },
    ];
    const t = floraTemplate('desync', CELL, blades);
    const clip = floraWindClip(t, blades, 8, 10);

    const argmaxT = (chipIdx: number): number => {
      let bestT = 0;
      let bestDeg = -Infinity;
      for (let i = 0; i < 400; i++) {
        const tt = i / 399;
        const deg = sampleClip(t, clip, tt)[chipIdx].deg;
        if (deg > bestDeg) {
          bestDeg = deg;
          bestT = tt;
        }
      }
      return bestT;
    };

    const peakT0 = argmaxT(1);
    const peakT1 = argmaxT(2);
    expect(Math.abs(peakT0 - peakT1)).toBeGreaterThan(0.05);
    // phase 0 blade peaks (sin(2π(t+0))=1) at t=0.25; phase 0.25 blade peaks
    // (sin(2π(t+0.25))=1) at t=0.
    expect(peakT0).toBeCloseTo(0.25, 1);
    expect(peakT1).toBeCloseTo(0, 1);
  });
});

describe('floraTemplate/floraWindClip determinism', () => {
  it('two identical builder calls produce deep-equal templates and clips', () => {
    const t1 = floraTemplate('det', CELL, GRASS_TUFT_BLADES);
    const t2 = floraTemplate('det', CELL, GRASS_TUFT_BLADES);
    expect(t1).toEqual(t2);

    const c1 = floraWindClip(t1, GRASS_TUFT_BLADES, 8, 6);
    const c2 = floraWindClip(t2, GRASS_TUFT_BLADES, 8, 6);
    expect(c1).toEqual(c2);
  });
});
