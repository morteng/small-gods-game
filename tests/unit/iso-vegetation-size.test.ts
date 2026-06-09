import { describe, it, expect } from 'vitest';
import { natureBillboard } from '@/render/iso/iso-sprites';
import { mToPx } from '@/render/scale-contract';

describe('natureBillboard', () => {
  it('oak is much taller than a boulder (truthful proportions)', () => {
    expect(natureBillboard('oak_tree').targetPx).toBeCloseTo(mToPx(15));
    expect(natureBillboard('boulder').targetPx).toBeCloseTo(mToPx(1.2));
    expect(natureBillboard('oak_tree').targetPx).toBeGreaterThan(natureBillboard('boulder').targetPx * 8);
  });
  it('source-scale is a positive integer', () => {
    const s = natureBillboard('oak_tree').srcScale;
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(1);
  });
  it('unknown kind falls back to default height', () => {
    expect(natureBillboard('made_up').targetPx).toBeCloseTo(mToPx(1.0));
  });
});
