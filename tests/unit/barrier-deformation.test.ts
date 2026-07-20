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
  it('a wall gets a terraced foundation — ONE level brush per edge, benched per piece slot', () => {
    const defs = buildBarrierDeformations(mapWith([placed('wall', [[4, 4], [20, 4]])]));  // one 16-tile edge
    expect(defs.length).toBe(1);
    const d = defs[0];
    expect(d.op).toBe('level');
    expect(d.source).toBe('wall:foundation');
    expect(d.priority).toBe(20);                       // below pads/roads/rivers
    expect(Number.isFinite(d.target ?? NaN)).toBe(true);
    expect(typeof d.targetAt).toBe('function');
  });

  it('the bench is piecewise-constant per 2-tile slot, with boundary tiles TUCKED under the uphill bench', () => {
    const d = buildBarrierDeformations(mapWith([placed('wall', [[4, 4], [20, 4]])]))[0];
    // Slot INTERIORS (≥ 0.55 from either boundary) are one bench height each.
    const bench = (k: number): number => d.targetAt!(4 + k * 2 + 1, 4);
    for (let k = 0; k < 8; k++) {
      expect(d.targetAt!(4 + k * 2 + 0.8, 4)).toBe(bench(k));
      expect(d.targetAt!(4 + k * 2 + 1.2, 4)).toBe(bench(k));
    }
    // A bench BOUNDARY takes the HIGHER of its two neighbours (ramp-tuck): the interpolation
    // ramp between benches tucks under the uphill piece's end — never daylight under a piece.
    for (let k = 1; k < 8; k++) {
      expect(d.targetAt!(4 + k * 2, 4)).toBe(Math.max(bench(k - 1), bench(k)));
    }
    // Off-edge projections clamp to the end slots (no NaN off the ends).
    expect(Number.isFinite(d.targetAt!(0, 4))).toBe(true);
    expect(Number.isFinite(d.targetAt!(40, 4))).toBe(true);
  });

  it('a real gate opening spanning two slots gets ONE merged bench (the gatehouse terrace)', () => {
    const run = { kind: 'wall' as const, path: [[4, 4], [20, 4]] as [number, number][],
      height: 3, thickness: 1.2, material: 'stone',
      gates: [{ t: 8, width: 4 }] };                    // 2-slot cardinal opening → slots [6,8) + [8,10)
    const d = buildBarrierDeformations(mapWith([{ id: 'g', run } as never]))[0];
    // Gate t=8 (edge-local, cardinal slot 2, width 4 → slots [6,8)+[8,10), world x∈[10,14)):
    // the two opening slots share one merged bench (sampled at each slot's interior).
    expect(d.targetAt!(11, 4)).toBe(d.targetAt!(13, 4));
    // …benches outside the opening are untouched by the merge (still finite, own values).
    expect(Number.isFinite(d.targetAt!(15, 4))).toBe(true);
  });

  it('a diagonal edge benches per √2 slot (one canonical diagonal piece each)', () => {
    const d = buildBarrierDeformations(mapWith([placed('wall', [[4, 4], [10, 10]])]))[0];
    // Two points inside the FIRST diagonal step share a bench…
    expect(d.targetAt!(4.3, 4.3)).toBe(d.targetAt!(4.7, 4.7));
    // …and a point two steps along may sit on a different one (its own slot's mean).
    expect(typeof d.targetAt!(6.5, 6.5)).toBe('number');
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

  it('the footing levels FLUSH under the curtain line — peak 1 at the core, 0 outside', () => {
    const d = buildBarrierDeformations(mapWith([placed('wall', [[4, 4], [12, 4]])]))[0];
    const core = d.mask(6, 4);                          // on the centerline
    expect(core).toBeCloseTo(1, 5);                     // flush — the piece's foot-z lift equals the bench
    // `level` lerps an arbitrary base all the way to the slot's bench at the core.
    const base = 10;
    expect(applyOp(d, base, base, core, 6, 4)).toBeCloseTo(d.targetAt!(6, 4), 5);
    // Far from the wall: untouched.
    expect(d.mask(40, 40)).toBe(0);
  });

  it('foundation count reflects only carved barriers; no runs → empty', () => {
    expect(buildBarrierDeformations(mapWith([]))).toHaveLength(0);
    const mixed = mapWith([placed('wall', [[0, 0], [8, 0]]), placed('hedge', [[0, 0], [8, 0]])]);
    expect(barrierFoundationCount(mixed)).toBe(1);
  });
});
