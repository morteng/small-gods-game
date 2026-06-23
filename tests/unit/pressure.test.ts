import { describe, it, expect } from 'vitest';
import { computePressure, type PressureItem } from '@/world/connectome/pressure';

describe('connectome pressure — advisory crowding feedback', () => {
  it('reports no pressure when clearance discs do not overlap', () => {
    const items: PressureItem[] = [
      { id: 'a', x: 0, y: 0, radius: 1 },
      { id: 'b', x: 5, y: 0, radius: 1 },
    ];
    const rep = computePressure(items);
    expect(rep.pairs).toHaveLength(0);
    expect(rep.maxPressure).toBe(0);
    expect(rep.perItem.get('a') ?? 0).toBe(0);
  });

  it('flags an impinging pair with the overlap depth in tiles', () => {
    const items: PressureItem[] = [
      { id: 'a', x: 0, y: 0, radius: 2 },
      { id: 'b', x: 3, y: 0, radius: 2 }, // distance 3, radii sum 4 → overlap 1
    ];
    const rep = computePressure(items);
    expect(rep.pairs).toHaveLength(1);
    expect(rep.pairs[0].overlap).toBeCloseTo(1, 5);
    expect(rep.perItem.get('a')).toBeCloseTo(1, 5);
    expect(rep.perItem.get('b')).toBeCloseTo(1, 5);
    expect(rep.maxPressure).toBeCloseTo(1, 5);
  });

  it('sums pressure over multiple overlaps and ranks the worst pinch first', () => {
    const items: PressureItem[] = [
      { id: 'hub', x: 0, y: 0, radius: 2 },
      { id: 'near', x: 1, y: 0, radius: 2 },   // overlap 3 (worst)
      { id: 'far', x: 3.5, y: 0, radius: 2 },  // overlap 0.5
    ];
    const rep = computePressure(items);
    expect(rep.pairs[0].overlap).toBeGreaterThan(rep.pairs[1].overlap);
    // hub overlaps both → its pressure is the sum
    expect(rep.perItem.get('hub')).toBeCloseTo(3.5, 5);
  });

  it('advisory only — never mutates the input items', () => {
    const items: PressureItem[] = [
      { id: 'a', x: 0, y: 0, radius: 2 },
      { id: 'b', x: 1, y: 0, radius: 2 },
    ];
    const snapshot = JSON.stringify(items);
    computePressure(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it('is deterministic for equal overlaps (stable id ordering)', () => {
    const items: PressureItem[] = [
      { id: 'z', x: 0, y: 0, radius: 2 },
      { id: 'y', x: 2, y: 0, radius: 2 },
      { id: 'x', x: 4, y: 0, radius: 2 },
    ];
    const a = computePressure(items).pairs.map((p) => `${p.a}-${p.b}`);
    const b = computePressure(items).pairs.map((p) => `${p.a}-${p.b}`);
    expect(a).toEqual(b);
  });
});
