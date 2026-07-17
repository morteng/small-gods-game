// Road-wear economy S1 — the measured `use` statistic: the per-edge footfall tally, the pure
// year-pass fold into `edge.use`, and the snapshot round-trip. Nothing CONSUMES `use` yet (S2/S3);
// this suite pins that the number is made real, deterministic, and scrub-safe.
import { describe, it, expect } from 'vitest';
import {
  RoadUseTally, foldEdgeUse, foldRoadUse,
  USE_W_TRAFFIC, USE_W_WEALTH, USE_EMA_ALPHA, EXPECTED_PASSES_PER_CELL_YEAR,
  type RoadUseFoldInputs, type EdgeUse,
} from '@/world/road-use';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';
import { TICKS_PER_YEAR } from '@/sim/mortality';

function edge(id: string, cells: [number, number][], cls: RoadEdge['class'] = 'track'): RoadEdge {
  return {
    id, a: `${id}:a`, b: `${id}:b`,
    polyline: cells.map(([x, y]) => ({ x, y })),
    feature: 'road', class: cls, surface: 'dirt', bridgeCells: [],
  };
}
function graph(edges: RoadEdge[], rev = 0): RoadGraph {
  return { nodes: [], edges, rev };
}
const flatInputs: RoadUseFoldInputs = { wealthFor: () => 0.5, trafficFloorFor: () => 0.1 };

describe('foldEdgeUse — the pure per-edge fold', () => {
  it('seeds the EMA with the fresh value on the first fold (no cold-start lag toward 0)', () => {
    const u = foldEdgeUse(undefined, 1, 0, 1, 1000, 42);
    // measured=1, floor=0 → traffic=1; wealth=1 → use01 = W_TRAFFIC + W_WEALTH = 1.
    expect(u.ema01).toBeCloseTo(USE_W_TRAFFIC + USE_W_WEALTH, 6);
    expect(u.tallies).toBe(42);
    expect(u.sinceTick).toBe(1000);
  });

  it('the traffic term is max(measured, floor) — a cohort-only route is not dead', () => {
    const u = foldEdgeUse(undefined, 0, 0.8, 0, 0, 0); // no measured, no wealth, floor 0.8
    expect(u.ema01).toBeCloseTo(USE_W_TRAFFIC * 0.8, 6);
  });

  it('moves the prior EMA by ALPHA toward the new value (bounded, converging)', () => {
    const prev: EdgeUse = { ema01: 0, tallies: 0, sinceTick: 0 };
    const u = foldEdgeUse(prev, 1, 0, 1, 10, 0); // target use01 = 1
    expect(u.ema01).toBeCloseTo(USE_EMA_ALPHA * 1, 6);
  });

  it('accumulates lifetime tallies and clamps ema to [0,1]', () => {
    const a = foldEdgeUse(undefined, 5, 5, 5, 0, 10); // wildly over-range inputs
    expect(a.ema01).toBeLessThanOrEqual(1);
    expect(a.ema01).toBeGreaterThanOrEqual(0);
    const b = foldEdgeUse(a, 0, 0, 0, 1, 7);
    expect(b.tallies).toBe(17);
  });
});

describe('RoadUseTally — footfall attribution', () => {
  it('attributes a footfall on an edge cell to that edge', () => {
    const g = graph([edge('e0', [[5, 5], [6, 5]])]);
    const t = new RoadUseTally();
    t.noteFootfall(g, 5, 5, 16, 16);
    t.noteFootfall(g, 6, 5, 16, 16);
    expect(t.rawPasses('e0')).toBe(2);
    expect(t.activeEdges()).toBe(1);
  });

  it('the radius-1 stamp catches a footfall one tile off the centerline', () => {
    const g = graph([edge('e0', [[5, 5]])]);
    const t = new RoadUseTally();
    t.noteFootfall(g, 6, 6, 16, 16); // diagonal neighbour of (5,5)
    expect(t.rawPasses('e0')).toBe(1);
  });

  it('is a no-op off every edge and out of bounds', () => {
    const g = graph([edge('e0', [[5, 5]])]);
    const t = new RoadUseTally();
    t.noteFootfall(g, 12, 12, 16, 16); // far away
    t.noteFootfall(g, -1, 5, 16, 16);  // OOB
    t.noteFootfall(g, 5, 99, 16, 16);  // OOB
    expect(t.activeEdges()).toBe(0);
  });

  it('rebuilds the tile→edge index when graph.rev changes', () => {
    const t = new RoadUseTally();
    const g1 = graph([edge('e0', [[3, 3]])], 1);
    t.noteFootfall(g1, 3, 3, 16, 16);
    expect(t.rawPasses('e0')).toBe(1);
    // A different edge now occupies (3,3) under a new rev — the memo must re-rasterize.
    const g2 = graph([edge('e9', [[3, 3]])], 2);
    t.noteFootfall(g2, 3, 3, 16, 16);
    expect(t.rawPasses('e9')).toBe(1);
    expect(t.rawPasses('e0')).toBe(1); // unchanged
  });

  it('round-trips through serialize / fromSnapshot (sorted, deterministic)', () => {
    const g = graph([edge('e0', [[1, 1]]), edge('e1', [[8, 8]])]);
    const t = new RoadUseTally();
    t.sinceTick = 777;
    t.noteFootfall(g, 1, 1, 16, 16);
    t.noteFootfall(g, 8, 8, 16, 16);
    t.noteFootfall(g, 8, 8, 16, 16);
    const snap = t.serialize();
    expect(snap.sinceTick).toBe(777);
    expect(snap.passes).toEqual([['e0', 1], ['e1', 2]]); // sorted by edgeId
    const t2 = RoadUseTally.fromSnapshot(snap);
    expect(t2.serialize()).toEqual(snap); // byte-identical round-trip
  });
});

describe('foldRoadUse — the year-pass fold', () => {
  it('the first call establishes the window baseline and writes no use', () => {
    const g = graph([edge('e0', [[5, 5], [6, 5]])]);
    const t = new RoadUseTally();
    t.noteFootfall(g, 5, 5, 16, 16);
    const win = foldRoadUse(g, t, 5000, flatInputs);
    expect(win).toBe(0);
    expect(t.sinceTick).toBe(5000);
    expect(g.edges[0].use).toBeUndefined(); // no measurement yet
  });

  it('folds measured footfall into edge.use, then resets the tally', () => {
    const g = graph([edge('e0', [[5, 5], [6, 5]])]);
    const t = new RoadUseTally();
    foldRoadUse(g, t, 0, flatInputs); // baseline at tick 0
    for (let i = 0; i < 40; i++) t.noteFootfall(g, 5, 5, 16, 16);
    const now = TICKS_PER_YEAR; // one fiction-year window
    const win = foldRoadUse(g, t, now, flatInputs);
    expect(win).toBeCloseTo(1, 3);
    expect(g.edges[0].use).toBeDefined();
    expect(g.edges[0].use!.ema01).toBeGreaterThan(0);
    expect(g.edges[0].use!.tallies).toBe(40);
    expect(g.edges[0].use!.sinceTick).toBe(now);
    expect(t.rawPasses('e0')).toBe(0); // tally reset after the fold
  });

  it('measured traffic normalizes by length × window × the per-class expectation', () => {
    // A `track` cell over one year expects EXPECTED_PASSES_PER_CELL_YEAR.track passes to saturate.
    const cells: [number, number][] = [[5, 5]]; // length 1
    const g = graph([edge('e0', cells, 'track')]);
    const t = new RoadUseTally();
    foldRoadUse(g, t, 0, flatInputs);
    const expected = EXPECTED_PASSES_PER_CELL_YEAR.track;
    for (let i = 0; i < expected; i++) t.noteFootfall(g, 5, 5, 16, 16);
    const zeroWealthNoFloor: RoadUseFoldInputs = { wealthFor: () => 0, trafficFloorFor: () => 0 };
    foldRoadUse(g, t, TICKS_PER_YEAR, zeroWealthNoFloor);
    // measuredNorm ≈ 1 → traffic 1, wealth 0 → use01 = W_TRAFFIC; seeded EMA == use01.
    expect(g.edges[0].use!.ema01).toBeCloseTo(USE_W_TRAFFIC, 2);
  });

  it('dilutes pre-skip footfall over a long window (skip-safe — an abandoned road reads low)', () => {
    const g = graph([edge('e0', [[5, 5]], 'track')]);
    const t = new RoadUseTally();
    foldRoadUse(g, t, 0, flatInputs);
    for (let i = 0; i < 200; i++) t.noteFootfall(g, 5, 5, 16, 16); // a busy week, then...
    const noFloor: RoadUseFoldInputs = { wealthFor: () => 0, trafficFloorFor: () => 0 };
    // ...a 100-fiction-year jump before the next fold: the same 200 passes that would SATURATE a
    // one-year window (measuredNorm ≥ 1) dilute ~30× to a near-dead reading.
    foldRoadUse(g, t, 100 * TICKS_PER_YEAR, noFloor);
    expect(g.edges[0].use!.ema01).toBeLessThan(0.05);
  });

  it('the inferred floor keeps a busy-endpoint route alive with zero measured footfall', () => {
    const g = graph([edge('e0', [[5, 5]], 'road')]);
    const t = new RoadUseTally();
    foldRoadUse(g, t, 0, flatInputs);
    const highFloor: RoadUseFoldInputs = { wealthFor: () => 0.9, trafficFloorFor: () => 0.9 };
    foldRoadUse(g, t, TICKS_PER_YEAR, highFloor); // no footfall at all
    // traffic = floor 0.9, wealth 0.9 → use01 = 0.9*(W_TRAFFIC+W_WEALTH) = 0.9.
    expect(g.edges[0].use!.ema01).toBeCloseTo(0.9 * (USE_W_TRAFFIC + USE_W_WEALTH), 3);
  });

  it('is deterministic — identical footfall sequences yield identical tallies', () => {
    const build = () => {
      const g = graph([edge('e0', [[5, 5], [6, 5]]), edge('e1', [[9, 9]])]);
      const t = new RoadUseTally();
      for (const [x, y] of [[5, 5], [6, 5], [9, 9], [5, 5]] as [number, number][]) {
        t.noteFootfall(g, x, y, 16, 16);
      }
      return t.serialize();
    };
    expect(build()).toEqual(build());
  });
});
