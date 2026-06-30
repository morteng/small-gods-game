import { describe, it, expect } from 'vitest';
import { buildBarrierDeformations, barrierFoundationCount } from '@/world/barrier-deformation';
import { applyOp } from '@/world/terrain-deformation';
import { BARRIER_DEFAULTS, type PlacedBarrier, type BarrierKind } from '@/world/barrier';
import type { GameMap } from '@/core/types';

// heightMetresAt only reads seed/width/height/worldSeed, so a partial map suffices.
function mapWith(barrierRuns: PlacedBarrier[]): GameMap {
  return { seed: 4242, width: 48, height: 48, worldSeed: null, barrierRuns } as unknown as GameMap;
}
const placed = (kind: BarrierKind, path: [number, number][], id = kind): PlacedBarrier =>
  ({ id, run: { kind, path, ...BARRIER_DEFAULTS[kind], gates: [] } });

describe('buildBarrierDeformations', () => {
  it('a wall gets a stepped foundation — ~one level brush per 4-tile span', () => {
    const defs = buildBarrierDeformations(mapWith([placed('wall', [[4, 4], [20, 4]])]));  // 16 tiles
    expect(defs.length).toBe(4);                       // 16 / 4
    for (const d of defs) {
      expect(d.op).toBe('level');
      expect(d.source).toBe('wall:foundation');
      expect(d.priority).toBe(20);                     // below pads/roads/rivers
      expect(Number.isFinite(d.target ?? NaN)).toBe(true);
    }
  });

  it('hedges and light fences get NO foundation (they follow the ground)', () => {
    const m = mapWith([placed('hedge', [[0, 0], [8, 0]]), placed('fence', [[0, 0], [8, 0]]), placed('barricade', [[0, 0], [8, 0]])]);
    expect(buildBarrierDeformations(m)).toHaveLength(0);
    expect(barrierFoundationCount(m)).toBe(0);
  });

  it('palisades and ramparts DO get a foundation', () => {
    expect(buildBarrierDeformations(mapWith([placed('palisade', [[0, 0], [8, 0]])])).length).toBeGreaterThan(0);
    expect(buildBarrierDeformations(mapWith([placed('rampart', [[0, 0], [8, 0]])])).length).toBeGreaterThan(0);
  });

  it('the footing LEVELS gently toward its target — peak<1 at the core, 0 outside', () => {
    const d = buildBarrierDeformations(mapWith([placed('wall', [[4, 4], [12, 4]])]))[0];   // first span [4,4]→[8,4]
    const core = d.mask(6, 4);                          // on the centerline
    expect(core).toBeGreaterThan(0.8);
    expect(core).toBeLessThanOrEqual(0.86);             // ~peak 0.85 — a gentle pull, not a hard shelf
    // `level` lerps an arbitrary base `core` of the way toward the target.
    const base = 10;
    expect(applyOp(d, base, base, core, 6, 4)).toBeCloseTo(base + core * ((d.target ?? 0) - base), 5);
    // Far from the wall: untouched.
    expect(d.mask(40, 40)).toBe(0);
  });

  it('foundation count reflects only carved barriers; no runs → empty', () => {
    expect(buildBarrierDeformations(mapWith([]))).toHaveLength(0);
    const mixed = mapWith([placed('wall', [[0, 0], [8, 0]]), placed('hedge', [[0, 0], [8, 0]])]);
    expect(barrierFoundationCount(mixed)).toBe(1);
  });
});
