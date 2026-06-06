import { describe, it, expect } from 'vitest';
import { roofRise, ROOF_PROFILES } from '@/render/building-massing-model';
import type { Roof } from '@/world/building-descriptor';

const ALL: Roof[] = [
  'flat','gable','hip','conical','domed','stepped','lean_to',
  'gambrel','mansard','pyramidal','saltbox','onion','spire','tented','jerkinhead','cross_gable',
];

describe('roofRise', () => {
  it('has a profile for every roof kind', () => {
    for (const r of ALL) expect(ROOF_PROFILES[r], r).toBeDefined();
  });

  it('pitched roofs get taller as the building widens (correct height format)', () => {
    const narrow = roofRise('gable', { w: 1, h: 1 });
    const wide = roofRise('gable', { w: 5, h: 5 });
    expect(wide).toBeGreaterThan(narrow);
  });

  it('target-height roofs are width-independent in mode (intrinsic rise)', () => {
    expect(ROOF_PROFILES.spire.mode).toBe('target');
    expect(roofRise('spire', { w: 2, h: 2 })).toBeGreaterThan(roofRise('gable', { w: 2, h: 2 }));
  });

  it('flat is a low parapet, never zero', () => {
    expect(roofRise('flat', { w: 3, h: 3 })).toBeGreaterThan(0);
    expect(roofRise('flat', { w: 3, h: 3 })).toBeLessThan(0.3);
  });

  it('lean_to uses the full span (single slope), not the half-span ridged run', () => {
    // lean_to is pitch 0.4 with fullSpan: rise = 0.4 × shortSpan (=4) = 1.6,
    // i.e. exactly double the half-span run a ridged roof of the same pitch would use.
    const pitch = ROOF_PROFILES.lean_to.pitch!;
    const shortSpan = 4;
    expect(ROOF_PROFILES.lean_to.fullSpan).toBe(true);
    expect(roofRise('lean_to', { w: shortSpan, h: shortSpan })).toBeCloseTo(pitch * shortSpan);
    // and that full-span rise is double the half-span rise the same pitch would yield
    expect(roofRise('lean_to', { w: shortSpan, h: shortSpan })).toBeCloseTo(2 * (pitch * shortSpan / 2));
  });

  it('clamps very wide pitched roofs below maxRise', () => {
    expect(roofRise('gable', { w: 40, h: 40 })).toBeLessThanOrEqual(2.5);
  });
});
