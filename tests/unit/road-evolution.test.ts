import { describe, it, expect } from 'vitest';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import {
  stepRoadDynamics,
  repairRoad,
  evolveRoadGraph,
  advanceRoadEvolution,
  freshDynamics,
} from '@/world/road-evolution';

const TICKS_PER_YEAR = 240 * 96;

function edge(id: string, partial: Partial<RoadEdge> = {}): RoadEdge {
  return {
    id,
    a: `${id}-a`,
    b: `${id}-b`,
    polyline: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
    feature: 'road',
    class: 'road',
    surface: 'dirt',
    bridgeCells: [],
    ...partial,
  };
}

describe('stepRoadDynamics', () => {
  it('a freshly built road starts pristine', () => {
    const d = freshDynamics();
    expect(d).toEqual({ ageYears: 0, condition: 1, traffic: 0, wear: 0, overgrowth: 0 });
  });

  it('ages monotonically by exactly dtYears', () => {
    const d = stepRoadDynamics(undefined, { dtYears: 12, upkeep: 0.5, traffic: 0.5 });
    expect(d.ageYears).toBeCloseTo(12, 6);
  });

  it('a maintained highway stays pristine over a century', () => {
    const d = stepRoadDynamics(freshDynamics(), { dtYears: 100, upkeep: 0.9, traffic: 0.9, climate: 0.5 });
    expect(d.condition).toBeGreaterThan(0.95);
    expect(d.overgrowth).toBeLessThan(0.05);
  });

  it('a neglected path ruins and is reclaimed by vegetation', () => {
    const d = stepRoadDynamics(freshDynamics(), { dtYears: 60, upkeep: 0, traffic: 0.2, climate: 0.5 });
    expect(d.condition).toBeLessThan(0.2);   // fallen into disrepair
    expect(d.overgrowth).toBeGreaterThan(0.3); // greening over
  });

  it('high traffic suppresses overgrowth even with no upkeep', () => {
    const kept = stepRoadDynamics(freshDynamics(), { dtYears: 60, upkeep: 0, traffic: 0.9, climate: 0.5 });
    const idle = stepRoadDynamics(freshDynamics(), { dtYears: 60, upkeep: 0, traffic: 0.1, climate: 0.5 });
    expect(kept.overgrowth).toBeLessThan(idle.overgrowth);
  });

  it('worse climate degrades condition faster', () => {
    const wet = stepRoadDynamics(freshDynamics(), { dtYears: 40, upkeep: 0.2, traffic: 0.4, climate: 1 });
    const dry = stepRoadDynamics(freshDynamics(), { dtYears: 40, upkeep: 0.2, traffic: 0.4, climate: 0 });
    expect(wet.condition).toBeLessThan(dry.condition);
  });

  it('all fields stay within [0,1] under extreme neglect', () => {
    const d = stepRoadDynamics(freshDynamics(), { dtYears: 500, upkeep: 0, traffic: 0, climate: 1 });
    for (const v of [d.condition, d.traffic, d.wear, d.overgrowth]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and sub-step-stable (one big step ≈ many small steps)', () => {
    const big = stepRoadDynamics(freshDynamics(), { dtYears: 30, upkeep: 0.1, traffic: 0.3, climate: 0.6 });
    let acc = freshDynamics();
    for (let i = 0; i < 30; i++) acc = stepRoadDynamics(acc, { dtYears: 1, upkeep: 0.1, traffic: 0.3, climate: 0.6 });
    expect(big.condition).toBeCloseTo(acc.condition, 6);
    expect(big.overgrowth).toBeCloseTo(acc.overgrowth, 6);
    expect(big.ageYears).toBeCloseTo(acc.ageYears, 6);
  });

  it('dtYears <= 0 is a no-op on the moving fields', () => {
    const start = stepRoadDynamics(freshDynamics(), { dtYears: 20, upkeep: 0, traffic: 0.2 });
    const same = stepRoadDynamics(start, { dtYears: 0, upkeep: 0, traffic: 0.2 });
    expect(same.condition).toBeCloseTo(start.condition, 9);
    expect(same.overgrowth).toBeCloseTo(start.overgrowth, 9);
    expect(same.ageYears).toBeCloseTo(start.ageYears, 9);
  });
});

describe('repairRoad', () => {
  it('a patch restores condition and clears overgrowth but keeps age', () => {
    const ruined = stepRoadDynamics(freshDynamics(), { dtYears: 60, upkeep: 0, traffic: 0.2 });
    const fixed = repairRoad(ruined);
    expect(fixed.condition).toBe(1);
    expect(fixed.overgrowth).toBe(0);
    expect(fixed.wear).toBeLessThan(ruined.wear + 1e-9);
    expect(fixed.ageYears).toBeCloseTo(ruined.ageYears, 6); // a patch doesn't reset the clock
  });

  it('a full rebuild resets age and wear', () => {
    const ruined = stepRoadDynamics(freshDynamics(), { dtYears: 60, upkeep: 0, traffic: 0.5 });
    const rebuilt = repairRoad(ruined, { rebuild: true });
    expect(rebuilt.ageYears).toBe(0);
    expect(rebuilt.wear).toBe(0);
    expect(rebuilt.condition).toBe(1);
  });
});

describe('evolveRoadGraph', () => {
  const mkGraph = (): RoadGraph => ({
    nodes: [],
    edges: [edge('hw', { class: 'highway' }), edge('pa', { class: 'path' }), edge('rv', { feature: 'river', surface: 'water' })],
  });

  it('bumps rev and evolves road edges, leaving rivers untouched', () => {
    const g = mkGraph();
    expect(g.rev ?? 0).toBe(0);
    evolveRoadGraph(g, 40);
    expect(g.rev).toBe(1);
    expect(g.edges.find(e => e.id === 'hw')!.dynamics).toBeDefined();
    expect(g.edges.find(e => e.id === 'pa')!.dynamics).toBeDefined();
    expect(g.edges.find(e => e.id === 'rv')!.dynamics).toBeUndefined(); // rivers don't evolve here
  });

  it('class defaults: a highway outlasts a path over the same span', () => {
    const g = mkGraph();
    evolveRoadGraph(g, 50);
    const hw = g.edges.find(e => e.id === 'hw')!.dynamics!;
    const pa = g.edges.find(e => e.id === 'pa')!.dynamics!;
    expect(hw.condition!).toBeGreaterThan(pa.condition!);
    expect(hw.overgrowth!).toBeLessThan(pa.overgrowth!);
  });

  it('per-edge upkeep override can rescue a path', () => {
    const g = mkGraph();
    evolveRoadGraph(g, 50, { upkeepFor: () => 1, trafficFor: () => 0.5 });
    const pa = g.edges.find(e => e.id === 'pa')!.dynamics!;
    expect(pa.condition!).toBeGreaterThan(0.9);
  });

  it('dtYears <= 0 does not bump rev', () => {
    const g = mkGraph();
    evolveRoadGraph(g, 0);
    expect(g.rev ?? 0).toBe(0);
  });

  it('is deterministic across two identical runs', () => {
    const a = mkGraph(); evolveRoadGraph(a, 37, { climateFor: () => 0.7 });
    const b = mkGraph(); evolveRoadGraph(b, 37, { climateFor: () => 0.7 });
    expect(a.edges.map(e => e.dynamics)).toEqual(b.edges.map(e => e.dynamics));
  });
});

describe('advanceRoadEvolution (stateless graph-clock driver)', () => {
  const mkGraph = (): RoadGraph => ({ nodes: [], edges: [edge('pa', { class: 'path' })] });

  it('first sight just sets the baseline (roads start fresh, no retroactive aging)', () => {
    const g = mkGraph();
    const applied = advanceRoadEvolution(g, 5 * TICKS_PER_YEAR);
    expect(applied).toBe(0);
    expect(g.evolvedAtTick).toBe(5 * TICKS_PER_YEAR);
    expect(g.rev ?? 0).toBe(0);
    expect(g.edges[0].dynamics).toBeUndefined();
  });

  it('advances by the elapsed years once past the apply gate, then sets the new baseline', () => {
    const g = mkGraph();
    advanceRoadEvolution(g, 0); // baseline at tick 0
    const applied = advanceRoadEvolution(g, 40 * TICKS_PER_YEAR);
    expect(applied).toBeCloseTo(40, 6);
    expect(g.evolvedAtTick).toBe(40 * TICKS_PER_YEAR);
    expect(g.rev).toBe(1);
    expect(g.edges[0].dynamics!.ageYears).toBeCloseTo(40, 6);
  });

  it('is a no-op below the half-year apply gate (avoids per-day re-derivation)', () => {
    const g = mkGraph();
    advanceRoadEvolution(g, 0);
    const applied = advanceRoadEvolution(g, Math.floor(0.2 * TICKS_PER_YEAR));
    expect(applied).toBe(0);
    expect(g.rev ?? 0).toBe(0);
    expect(g.evolvedAtTick).toBe(0); // baseline unmoved until we actually apply
  });

  it('many small gated advances ≈ one big advance (replay/skip parity)', () => {
    const stepped = mkGraph();
    advanceRoadEvolution(stepped, 0);
    for (let y = 1; y <= 40; y++) advanceRoadEvolution(stepped, y * TICKS_PER_YEAR);

    const jumped = mkGraph();
    advanceRoadEvolution(jumped, 0);
    advanceRoadEvolution(jumped, 40 * TICKS_PER_YEAR);

    expect(stepped.edges[0].dynamics!.condition!).toBeCloseTo(jumped.edges[0].dynamics!.condition!, 6);
    expect(stepped.edges[0].dynamics!.overgrowth!).toBeCloseTo(jumped.edges[0].dynamics!.overgrowth!, 6);
  });
});
