import { describe, it, expect } from 'vitest';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import type { GameMap } from '@/core/types';
import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';
import {
  stepRoadDynamics,
  repairRoad,
  evolveRoadGraph,
  advanceRoadEvolution,
  connectomeEvolveOptions,
  buildRoadUseInputs,
  freshDynamics,
} from '@/world/road-evolution';
import { emptySettlementCohorts } from '@/sim/cohorts';
import type { SettlementCohorts } from '@/sim/cohorts';

// Derive from the calendar (1:1 realtime) — a hardcoded 240×96 silently
// desyncs from the source constant.
const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

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

describe('connectomeEvolveOptions (endpoint-settlement drive)', () => {
  function mapWith(graph: RoadGraph, pois: { id: string; importance?: string; size?: string }[]): GameMap {
    return { roadGraph: graph, worldSeed: { pois } } as unknown as GameMap;
  }
  const linkEdge = (id: string): RoadEdge => edge(id, { a: `${id}-a`, b: `${id}-b` });
  const graphFor = (id: string, aPoi: string, bPoi: string): RoadGraph => ({
    nodes: [
      { id: `${id}-a`, x: 0, y: 0, kind: 'poi', poiRef: aPoi },
      { id: `${id}-b`, x: 5, y: 0, kind: 'poi', poiRef: bPoi },
    ] as RoadGraph['nodes'],
    edges: [linkEdge(id)],
  });

  it('a thriving endpoint keeps a road maintained; an abandoned one lets it rot', () => {
    const capital = graphFor('hi', 'A', 'B');
    const hiMap = mapWith(capital, [{ id: 'A', importance: 'critical', size: 'huge' }, { id: 'B', importance: 'high', size: 'large' }]);
    const loGraph = graphFor('lo', 'C', 'D');
    const loMap = mapWith(loGraph, [{ id: 'C', importance: 'low', size: 'small' }, { id: 'D', importance: 'low', size: 'small' }]);

    evolveRoadGraph(capital, 60, connectomeEvolveOptions(hiMap));
    evolveRoadGraph(loGraph, 60, connectomeEvolveOptions(loMap));

    const rich = capital.edges[0].dynamics!;
    const poor = loGraph.edges[0].dynamics!;
    expect(rich.condition!).toBeGreaterThan(0.95);     // the capital keeps its road pristine
    expect(poor.condition!).toBeLessThan(rich.condition!); // the hamlet's road has slipped
    expect(poor.condition!).toBeLessThan(0.8);
  });

  it('upkeep follows the MORE prosperous end (one rich patron suffices)', () => {
    const g = graphFor('e', 'rich', 'ruin');
    const m = mapWith(g, [{ id: 'rich', importance: 'critical', size: 'huge' }, { id: 'ruin', importance: 'low', size: 'small' }]);
    const opts = connectomeEvolveOptions(m);
    expect(opts.upkeepFor!(g.edges[0])).toBeGreaterThan(0.7); // the huge capital carries it
  });

  it('returns empty options for a graphless map', () => {
    expect(connectomeEvolveOptions({} as GameMap)).toEqual({});
  });
});

describe('buildRoadUseInputs (road-wear economy S1)', () => {
  const graphFor = (id: string, aPoi: string, bPoi: string): RoadGraph => ({
    nodes: [
      { id: `${id}-a`, x: 0, y: 0, kind: 'poi', poiRef: aPoi },
      { id: `${id}-b`, x: 5, y: 0, kind: 'poi', poiRef: bPoi },
    ] as RoadGraph['nodes'],
    edges: [edge(id)],
  });
  const mapWith = (graph: RoadGraph, pois: { id: string; importance?: string; size?: string }[]): GameMap =>
    ({ roadGraph: graph, worldSeed: { pois }, width: 8, height: 2 } as unknown as GameMap);
  const cohort = (id: string, prosperity: number, count: number): SettlementCohorts => {
    const sc = emptySettlementCohorts(id);
    sc.bands[0].count = count;
    sc.bands[0].needs.prosperity = prosperity;
    return sc;
  };

  it('the traffic floor is higher for important, peopled endpoints', () => {
    const big = graphFor('e', 'A', 'B');
    const bigIn = buildRoadUseInputs(
      mapWith(big, [{ id: 'A', importance: 'critical', size: 'huge' }, { id: 'B', importance: 'high', size: 'large' }]),
      { residents: new Map([['A', 48], ['B', 30]]) },
    );
    const small = graphFor('f', 'C', 'D');
    const smallIn = buildRoadUseInputs(
      mapWith(small, [{ id: 'C', importance: 'low', size: 'small' }, { id: 'D', importance: 'low', size: 'small' }]),
      { residents: new Map() },
    );
    const floorBig = bigIn.trafficFloorFor(big.edges[0]);
    const floorSmall = smallIn.trafficFloorFor(small.edges[0]);
    expect(floorBig).toBeGreaterThan(floorSmall);
    expect(floorBig).toBeLessThanOrEqual(1);
    expect(floorSmall).toBeGreaterThanOrEqual(0);
  });

  it('an edge with no settlement endpoints falls back to a bounded class traffic', () => {
    const g: RoadGraph = { nodes: [], edges: [edge('e', { class: 'path' })] };
    const inputs = buildRoadUseInputs({ roadGraph: g, worldSeed: { pois: [] } } as unknown as GameMap);
    const floor = inputs.trafficFloorFor(g.edges[0]);
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(0.5); // CLASS_TRAFFIC.path region — assert bounded, not exact
    expect(inputs.wealthFor(g.edges[0])).toBe(0); // no purse without endpoints
  });

  it('wealth reads the cohort purse and is gated by endpoint liveness', () => {
    const g = graphFor('e', 'rich', 'poor');
    const pois = [{ id: 'rich', importance: 'high', size: 'large' }, { id: 'poor', importance: 'high', size: 'large' }];
    const cohorts = new Map<string, SettlementCohorts>([['rich', cohort('rich', 0.9, 20)], ['poor', cohort('poor', 0.1, 20)]]);
    const peopled = buildRoadUseInputs(mapWith(g, pois), { residents: new Map([['rich', 40], ['poor', 40]]), cohorts }).wealthFor(g.edges[0]);
    const emptied = buildRoadUseInputs(mapWith(g, pois), { residents: new Map(), cohorts }).wealthFor(g.edges[0]);
    expect(peopled).toBeGreaterThan(0);
    expect(peopled).toBeLessThanOrEqual(1);
    expect(emptied).toBeLessThan(peopled); // same purse, emptied town → liveness gate drops it
  });
});

describe('connectomeEvolveOptions — live population & climate', () => {
  const graphFor = (id: string, aPoi: string, bPoi: string, line = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]): RoadGraph => ({
    nodes: [
      { id: `${id}-a`, x: 0, y: 0, kind: 'poi', poiRef: aPoi },
      { id: `${id}-b`, x: 2, y: 0, kind: 'poi', poiRef: bPoi },
    ] as RoadGraph['nodes'],
    edges: [edge(id, { polyline: line })],
  });
  const mapWith = (graph: RoadGraph, pois: { id: string; importance?: string; size?: string }[]): GameMap =>
    ({ roadGraph: graph, worldSeed: { pois }, width: 8, height: 2 } as unknown as GameMap);

  it('a settlement that EMPTIED lets its road rot; the same settlement fully peopled keeps it', () => {
    const pois = [{ id: 'A', importance: 'medium', size: 'medium' }, { id: 'B', importance: 'medium', size: 'medium' }];
    const full = graphFor('full', 'A', 'B');
    const empty = graphFor('empty', 'A', 'B');
    // Same static ceiling for both maps — only the live census differs.
    const peopled = new Map([['A', 40], ['B', 40]]);
    const abandoned = new Map([['A', 0], ['B', 0]]);

    evolveRoadGraph(full, 60, connectomeEvolveOptions(mapWith(full, pois), { residents: peopled }));
    evolveRoadGraph(empty, 60, connectomeEvolveOptions(mapWith(empty, pois), { residents: abandoned }));

    const kept = full.edges[0].dynamics!;
    const rotted = empty.edges[0].dynamics!;
    expect(rotted.condition!).toBeLessThan(kept.condition!);       // the emptied town's road slipped
    expect(rotted.overgrowth!).toBeGreaterThan(kept.overgrowth!);  // and greened over
    expect(kept.condition!).toBeGreaterThan(0.7);                  // the peopled one held up
  });

  it('with no census the live path matches the static ceiling exactly (back-compat)', () => {
    const pois = [{ id: 'A', importance: 'high', size: 'large' }, { id: 'B', importance: 'high', size: 'large' }];
    const g = graphFor('g', 'A', 'B');
    const m = mapWith(g, pois);
    // residents absent ⇒ vitality is the static ceiling; a full census at/above baseline equals it.
    const staticUpkeep = connectomeEvolveOptions(m).upkeepFor!(g.edges[0]);
    const liveFull = connectomeEvolveOptions(m, { residents: new Map([['A', 99], ['B', 99]]) }).upkeepFor!(g.edges[0]);
    expect(liveFull).toBeCloseTo(staticUpkeep, 5);
  });

  it('per-edge climate: a cold, wet road wears faster than a warm, dry one', () => {
    const cold = graphFor('cold', 'A', 'B', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]); // mid → cell (1,0)
    const warm = graphFor('warm', 'A', 'B', [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 7, y: 0 }]); // mid → cell (6,0)
    const moisture = new Float32Array(16); const temperature = new Float32Array(16).fill(0.5);
    moisture[1] = 0.9; temperature[1] = 0.05; // (1,0): wet + frozen
    moisture[6] = 0.1; temperature[6] = 0.70; // (6,0): dry + warm
    const climate = { moisture, temperature };
    const coldOpts = connectomeEvolveOptions(mapWith(cold, [{ id: 'A' }, { id: 'B' }]), { climate });
    const warmOpts = connectomeEvolveOptions(mapWith(warm, [{ id: 'A' }, { id: 'B' }]), { climate });
    expect(coldOpts.climateFor!(cold.edges[0])).toBeGreaterThan(warmOpts.climateFor!(warm.edges[0]));
  });
});

describe('advanceRoadEvolution — lazy opts thunk', () => {
  const roadGraph = (): RoadGraph => ({ nodes: [], edges: [edge('e')] });

  it('does NOT invoke the opts thunk below the half-year gate', () => {
    const g = roadGraph(); g.evolvedAtTick = 0;
    let calls = 0;
    advanceRoadEvolution(g, 0.1 * TICKS_PER_YEAR, () => { calls++; return {}; });
    expect(calls).toBe(0);
  });

  it('invokes the opts thunk exactly once when an advance applies', () => {
    const g = roadGraph(); g.evolvedAtTick = 0;
    let calls = 0;
    const years = advanceRoadEvolution(g, 0.6 * TICKS_PER_YEAR, () => { calls++; return {}; });
    expect(years).toBeGreaterThan(0);
    expect(calls).toBe(1);
  });

  it('does NOT invoke the thunk on first sight (baseline-only)', () => {
    const g = roadGraph(); // evolvedAtTick undefined
    let calls = 0;
    advanceRoadEvolution(g, 5 * TICKS_PER_YEAR, () => { calls++; return {}; });
    expect(calls).toBe(0);
    expect(g.evolvedAtTick).toBe(5 * TICKS_PER_YEAR);
  });
});

describe('applyRoadClassSurface + endpointPoiIdsFor (road-wear economy S2)', () => {
  function mapWith(edges: RoadEdge[]): GameMap {
    const width = 8, height = 3;
    const tiles = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => ({ type: 'dirt_road', x, y, walkable: true, state: 'realized' as const })),
    );
    // A patch of water + a bridge deck on row 1 to prove they're skipped.
    tiles[0][3].type = 'river'; tiles[0][3].walkable = false;
    tiles[0][4].type = 'bridge';
    return {
      tiles, width, height, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
      roadGraph: { nodes: [], edges, rev: 0 },
    } as unknown as GameMap;
  }

  it('re-stamps a stone-surfaced edge dirt_road → stone_road, skipping water/bridge, and bumps tilesRev', async () => {
    const { applyRoadClassSurface, endpointPoiIdsFor } = await import('@/world/road-evolution');
    const e = edge('e0', { surface: 'stone', polyline: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }] });
    const map = mapWith([e]);
    const before = map.tilesRev ?? 0;
    const touched = applyRoadClassSurface(map, [{ edgeId: 'e0', from: 'track', to: 'road', surfaceChanged: true }]);
    expect(touched).toBe(3); // (1,0) (2,0) (5,0) — the river (3,0) and bridge (4,0) are skipped
    expect(map.tiles[0][1].type).toBe('stone_road');
    expect(map.tiles[0][3].type).toBe('river');  // water untouched
    expect(map.tiles[0][4].type).toBe('bridge'); // deck untouched
    expect(map.tilesRev).toBe(before + 1);
    void endpointPoiIdsFor;
  });

  it('is a no-op (no tilesRev bump) for transitions that did not change surface', async () => {
    const { applyRoadClassSurface } = await import('@/world/road-evolution');
    const map = mapWith([edge('e0', { surface: 'dirt', polyline: [{ x: 1, y: 0 }] })]);
    const touched = applyRoadClassSurface(map, [{ edgeId: 'e0', from: 'path', to: 'track', surfaceChanged: false }]);
    expect(touched).toBe(0);
    expect(map.tilesRev ?? 0).toBe(0);
  });

  it('endpointPoiIdsFor resolves an edge\'s endpoint POI ids through the node→poi plumbing', async () => {
    const { endpointPoiIdsFor } = await import('@/world/road-evolution');
    const e = edge('e0', { a: 'n0', b: 'n1' });
    const map = {
      tiles: [], width: 8, height: 3, villages: [], seed: 1, success: true,
      worldSeed: { pois: [{ id: 'town' }, { id: 'hamlet' }] },
      stats: { iterations: 0, backtracks: 0 }, buildings: [],
      roadGraph: { nodes: [{ id: 'n0', x: 0, y: 0, kind: 'poi', poiRef: 'town' }, { id: 'n1', x: 5, y: 0, kind: 'poi', poiRef: 'hamlet' }], edges: [e], rev: 0 },
    } as unknown as GameMap;
    expect(endpointPoiIdsFor(map)(e)).toEqual(['town', 'hamlet']);
  });
});
