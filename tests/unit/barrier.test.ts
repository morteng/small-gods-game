import { describe, it, expect } from 'vitest';
import { barrierFootprintTiles, gateFootprintTiles, type BarrierRun } from '@/world/barrier';

const run = (over: Partial<BarrierRun> = {}): BarrierRun => ({
  kind: 'wall', path: [[0, 0], [4, 0]], height: 3, thickness: 1, material: 'stone', gates: [], ...over,
});

describe('barrierFootprintTiles', () => {
  it('rasterizes a straight horizontal run into contiguous blocking cells', () => {
    const { blocking, gate } = barrierFootprintTiles(run());
    expect(gate).toHaveLength(0);
    expect(blocking).toEqual(expect.arrayContaining([[0, 0], [1, 0], [2, 0], [3, 0]]));
  });

  it('excludes gate-span cells from blocking and reports them as gate cells', () => {
    const { blocking, gate } = barrierFootprintTiles(run({ gates: [{ t: 2, width: 1 }] }));
    expect(blocking.some(([x]) => x === 2)).toBe(false);
    expect(gate.some(([x]) => x === 2)).toBe(true);
  });

  it('rasterizes a diagonal run', () => {
    const { blocking } = barrierFootprintTiles(run({ path: [[0, 0], [3, 3]] }));
    expect(blocking).toEqual(expect.arrayContaining([[0, 0], [1, 1], [2, 2]]));
  });
});

describe('gateFootprintTiles — single-span cells (junction artifacts)', () => {
  it('returns exactly one gate span, matching the combined gate pass, sorted', () => {
    const gate = { t: 2, width: 1 };
    const r = run({ gates: [gate] });
    const single = gateFootprintTiles(r, gate);
    const combined = barrierFootprintTiles(r).gate;
    // same cell set as the combined pass (one gate ⇒ they coincide)
    expect(new Set(single.map(String))).toEqual(new Set(combined.map(String)));
    expect(single.some(([x]) => x === 2)).toBe(true);
    // sorted (y, then x)
    const sorted = [...single].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(single).toEqual(sorted);
  });

  it('isolates ONE opening when a run carries several', () => {
    const g0 = { t: 1, width: 1 }, g1 = { t: 3, width: 1 };
    const r = run({ gates: [g0, g1] });
    const only1 = gateFootprintTiles(r, g1);
    expect(only1.some(([x]) => x === 3)).toBe(true);
    expect(only1.some(([x]) => x === 1)).toBe(false);   // the other gate's cells are excluded
  });
});

// ─── Even thickness: INTEGER cells ─────────────────────────────────────────────
//
// `(thickness - 1) / 2` is 0.5 at thickness 2, and both rasterizers used it as a
// loop bound, so every emitted cell was half-integer ("12.5,30.5") and could never
// match an integer tile lookup. Silent, because the cells were still returned and
// stored: `vegetation-clear.ts` built its tall-barrier set from them and matched
// nothing (vegetation was never cleared along a rampart), and `entity-registry.ts`
// indexed occupancy from the same cells. Both shipped catalogue rungs that carry an
// even thickness — the fortress stone `wall` (2) and `rampart` (2 and 3) — were
// affected. No world at the probed seeds actually reaches those rungs today
// (measured: default/12345 and default/777 produce 17 and 13 runs, ALL thickness 1),
// which is why nothing visibly broke and why this needs a test rather than a probe.
describe('barrierFootprintTiles — even thickness', () => {
  const integral = (cells: [number, number][]): boolean =>
    cells.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y));

  it.each([1, 2, 3, 4])('emits only INTEGER cells at thickness %i', (thickness) => {
    const r = run({ thickness, gates: [{ t: 2, width: 1 }] });
    const { blocking, gate } = barrierFootprintTiles(r);
    expect(integral(blocking), `thickness ${thickness}: blocking has a non-integer cell`).toBe(true);
    expect(integral(gate), `thickness ${thickness}: gate has a non-integer cell`).toBe(true);
    expect(integral(gateFootprintTiles(r, r.gates[0])), `thickness ${thickness}: gateFootprintTiles`).toBe(true);
  });

  it.each([1, 2, 3, 4])('spans exactly %i cells across the centreline', (thickness) => {
    // A straight west→east run at y=0: the CROSS-SECTION is the set of distinct y's.
    const { blocking } = barrierFootprintTiles(run({ thickness }));
    expect(new Set(blocking.map(([, y]) => y)).size).toBe(thickness);
  });
});
