import { describe, it, expect, beforeEach } from 'vitest';
import { registerBrush, getBrush, listBrushes, _resetBrushesForTesting } from '@/world/brushes';
import type { Entity, BrushContext, Region } from '@/core/types';

describe('BrushRegistry', () => {
  beforeEach(() => { _resetBrushesForTesting(); });

  it('registerBrush and getBrush round-trip', () => {
    const fn = (_r: Region, _s: number, _c: BrushContext): Entity[] => [];
    registerBrush('test_brush', fn);
    expect(getBrush('test_brush')).toBe(fn);
  });

  it('getBrush throws on unknown brush', () => {
    expect(() => getBrush('not_real_xyz')).toThrow(/unknown brush/i);
  });

  it('listBrushes returns registered names', () => {
    registerBrush('a', () => []);
    registerBrush('b', () => []);
    expect(new Set(listBrushes())).toEqual(new Set(['a', 'b']));
  });

  it('re-registering the same name with a different fn throws', () => {
    registerBrush('dupe', () => []);
    expect(() => registerBrush('dupe', () => [])).toThrow(/already registered/i);
  });

  it('re-registering the same name with the same fn is a no-op (idempotent)', () => {
    const fn = () => [];
    registerBrush('idem', fn);
    expect(() => registerBrush('idem', fn)).not.toThrow();
    expect(getBrush('idem')).toBe(fn);
  });
});
