import { describe, it, expect } from 'vitest';
import { natureBillboard } from '@/render/iso/iso-sprites';
import { mToPx } from '@/render/scale-contract';

describe('natureBillboard', () => {
  it('a standing stone is much taller than a mushroom (truthful proportions)', () => {
    expect(natureBillboard('standing_stone').targetPx).toBeCloseTo(mToPx(3.0));
    expect(natureBillboard('mushroom').targetPx).toBeCloseTo(mToPx(0.2));
    expect(natureBillboard('standing_stone').targetPx).toBeGreaterThan(natureBillboard('mushroom').targetPx * 8);
  });
  it('unknown kind falls back to default height', () => {
    expect(natureBillboard('made_up').targetPx).toBeCloseTo(mToPx(1.0));
  });
});
