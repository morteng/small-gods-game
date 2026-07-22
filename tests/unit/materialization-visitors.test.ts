/**
 * P2 slice 3 — MARKET / VISITORS.
 *
 * Visitors are a second materialized category layered on the focused host during
 * market hours: merchants who gather at the town's market tile. Two flavours share
 * one mechanism — everyday LOCAL bustle drawn from the host's own cohort, and a
 * weekly MARKET-DAY pull drawn from a ≤1-hop road-neighbour's cohort. The load-
 * bearing invariant is CROSS-POI soul conservation: a neighbour's visitor draws
 * from and folds back to the NEIGHBOUR's cohort, keyed so CohortSystem's stat-tier
 * audit balances with no relaxation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import type { GameMap, BuildingInstance, WorldSeed, Tile, POI } from '@/core/types';
import type { RoadEdge, RoadGraph } from '@/world/road-graph';
import type { ZoomBand } from '@/game/affordance/zoom-band';
import { cohortPopulation, type SettlementCohorts } from '@/sim/cohorts';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { TICKS_PER_DAY, tickAtSolarHour } from '@/core/calendar';
import { CohortSystem } from '@/sim/systems/cohort-system';
import { MaterializationSystem } from '@/sim/systems/materialization-system';
import {
  isMarketHour, isMarketDay, localVisitorTarget, neighbourVisitorTarget,
  attractorCapacity, marketAnchorTile, settlementDraws,
  MARKET_OPEN_HOUR, MARKET_CLOSE_HOUR, LOCAL_VISITOR_MAX, NEIGHBOUR_VISITOR_MAX,
} from '@/sim/population/settlement-demand';
import { cottages, seedCohort } from './materialization-harness';

beforeAll(() => loadDefaultPacks());

// ── fixtures ────────────────────────────────────────────────────────────────

function road(id: string, a: string, b: string): RoadEdge {
  return { id, a, b, polyline: [], feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [] } as RoadEdge;
}

function poi(id: string, x: number, y: number): POI {
  return { id, name: id, type: 'village', position: { x, y }, size: 'medium', npcs: [{ name: 'x', role: 'farmer' }] } as unknown as POI;
}

interface MktHarness {
  map: GameMap;
  world: World;
  cohorts: Map<string, SettlementCohorts>;
  sys: MaterializationSystem;
  log: EventLog;
  clock: SimClock;
  setFocus(p: string | null, band: ZoomBand): void;
  tick(now: number): void;
  visitorSrcCounts(): Map<string, number>;
}

/** A grass map with a `host` town (+ optional attractors) and, optionally, a road-
 *  linked `nb` neighbour — each with its own statistical cohort. */
function mkt(opts: {
  hostAttractors?: string[]; withNeighbour?: boolean;
  hostSouls?: number; neighbourSouls?: number;
} = {}): MktHarness {
  const w = 32, h = 32;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }

  const pois: POI[] = [poi('host', 6, 6)];
  if (opts.withNeighbour) pois.push(poi('nb', 24, 6));

  let roadGraph: RoadGraph | undefined;
  if (opts.withNeighbour) {
    roadGraph = {
      nodes: [
        { id: 'nH', x: 6, y: 6, kind: 'poi', poiRef: 'host' },
        { id: 'nN', x: 24, y: 6, kind: 'poi', poiRef: 'nb' },
      ],
      edges: [road('e1', 'nH', 'nN')],
    } as RoadGraph;
  }

  const attractors: BuildingInstance[] = (opts.hostAttractors ?? []).map((templateId, i) => ({
    id: `host_att_${i}`, templateId, tileX: 6 + i, tileY: 9, poiId: 'host', state: 'intact' as const,
  }));
  const buildings: BuildingInstance[] = [
    ...cottages('host', 12), ...attractors,
    ...(opts.withNeighbour ? cottages('nb', 8) : []),
  ];

  const worldSeed = {
    name: 'test', size: { width: w, height: h }, biome: 'plains',
    pois, connections: [], constraints: [],
  } as unknown as WorldSeed;

  const map = {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed, stats: { iterations: 0, backtracks: 0 }, buildings, roadGraph,
  } as unknown as GameMap;

  const world = new World(map);
  const cohorts = new Map<string, SettlementCohorts>([['host', seedCohort('host', opts.hostSouls ?? 40)]]);
  if (opts.withNeighbour) cohorts.set('nb', seedCohort('nb', opts.neighbourSouls ?? 40));

  let focus: { poiId: string | null; band: ZoomBand } = { poiId: null, band: 'world' };
  const clock = new SimClock();
  const log = new EventLog(clock);
  const sys = new MaterializationSystem(() => cohorts, () => map, () => focus);

  return {
    map, world, cohorts, sys, log, clock,
    setFocus(p, band) { focus = { poiId: p, band }; },
    tick(now) { sys.tick({ world, spirits: new Map(), log, clock, rng: createRng(1), dt: 250, now }); },
    visitorSrcCounts() {
      const m = new Map<string, number>();
      for (const v of sys.visitorRefs().values()) m.set(v.srcPoi, (m.get(v.srcPoi) ?? 0) + 1);
      return m;
    },
  };
}

/** Noon (market hour) on calendar day `d`. */
function noon(d: number): number { return d * TICKS_PER_DAY + tickAtSolarHour(12); }

/** Focus `poiId` and tick to steady state starting near `baseTick` (stays in-hour). */
function settle(H: MktHarness, poiId: string, baseTick: number): number {
  H.setFocus(poiId, 'settlement');
  let now = baseTick;
  for (let i = 0; i < 40; i++) { H.tick(now); now += 100; }
  return now;
}

/** Unfocus and tick past the fold linger until everyone is banked back. */
function unfocus(H: MktHarness, fromTick: number): number {
  H.setFocus(null, 'world');
  let now = fromTick;
  for (let i = 0; i < 60; i++) { H.tick(now); now += 300; }
  return now;
}

function cohortPop(H: MktHarness, poiId: string): number {
  const sc = H.cohorts.get(poiId);
  return sc ? cohortPopulation(sc) : 0;
}

/** All souls, both tiers: every cohort's stat population + every live entity. */
function totalSouls(H: MktHarness): number {
  let n = queryNpcs(H.world).length;
  for (const sc of H.cohorts.values()) n += cohortPopulation(sc);
  return n;
}

// ── pure gates ───────────────────────────────────────────────────────────────

describe('slice-3 market gates (pure)', () => {
  it('isMarketHour is open on [open, close) only', () => {
    expect(isMarketHour(MARKET_OPEN_HOUR - 1)).toBe(false);
    expect(isMarketHour(MARKET_OPEN_HOUR)).toBe(true);
    expect(isMarketHour(MARKET_CLOSE_HOUR - 1)).toBe(true);
    expect(isMarketHour(MARKET_CLOSE_HOUR)).toBe(false);
    expect(isMarketHour(23)).toBe(false);
  });

  it('isMarketDay fires exactly once per 7-day week for a settlement, staggered across towns', () => {
    const daysFor = (id: string) => Array.from({ length: 7 }, (_, d) => isMarketDay(id, d)).filter(Boolean).length;
    expect(daysFor('host')).toBe(1);
    expect(daysFor('nb')).toBe(1);
    // deterministic + stable under +7 shifts
    for (let d = 0; d < 14; d++) expect(isMarketDay('host', d)).toBe(isMarketDay('host', d + 7));
    // at least some pair of towns trades on different days (stagger, not lockstep)
    const phases = ['host', 'nb', 'village', 'town-c'].map(id => [...Array(7).keys()].find(d => isMarketDay(id, d)));
    expect(new Set(phases).size).toBeGreaterThan(1);
  });

  it('localVisitorTarget is 0 without attractors, else a capped fraction of own pop', () => {
    const noAttr = settlementDraws(mkt().map, 'host'); // cottages only
    expect(attractorCapacity(noAttr)).toBe(0);
    expect(localVisitorTarget(100, noAttr)).toBe(0);

    const withAttr = settlementDraws(mkt({ hostAttractors: ['market_stall', 'market_stall'] }).map, 'host');
    expect(attractorCapacity(withAttr)).toBeGreaterThan(0);
    expect(localVisitorTarget(4, withAttr)).toBe(1);           // round(0.15*4)=1
    expect(localVisitorTarget(10_000, withAttr)).toBeLessThanOrEqual(LOCAL_VISITOR_MAX);
  });

  it('neighbourVisitorTarget is a capped fraction of the neighbour pop', () => {
    expect(neighbourVisitorTarget(40)).toBe(2);                // round(0.05*40)
    expect(neighbourVisitorTarget(10_000)).toBe(NEIGHBOUR_VISITOR_MAX);
    expect(neighbourVisitorTarget(0)).toBe(0);
  });

  it('marketAnchorTile falls back to the POI centre (land-snapped) when no plan exists', () => {
    const H = mkt();
    expect(marketAnchorTile(H.map, 'host')).toEqual({ x: 6, y: 6 });
    expect(marketAnchorTile(H.map, 'nowhere')).toBeNull();
  });
});

// ── local bustle ─────────────────────────────────────────────────────────────

describe('slice-3 local visitors (own-cohort bustle)', () => {
  it('gathers merchants at the market during market hours, conserving souls', () => {
    // Over-populated (pop > housing) — the normal P1 state, so souls remain for
    // the market after homes fill.
    const H = mkt({ hostAttractors: ['market_stall', 'market_stall'], hostSouls: 90 });
    expect(totalSouls(H)).toBe(90);

    settle(H, 'host', noon(0));                 // day 0 is NOT host's market day → local only
    const visitors = [...H.sys.visitorRefs().values()];
    expect(visitors.length).toBeGreaterThan(0);
    expect([...H.visitorSrcCounts().keys()]).toEqual(['host']);   // all drawn from own cohort
    expect(totalSouls(H)).toBe(90);                                // conserved while live

    // Each visitor is a merchant milling at the market tile (6,6 ± jitter), flagged.
    for (const ref of visitors) {
      const e = H.world.registry.get(ref.id)!;
      const p = npcProps(e);
      expect(p.visitorTemp).toBe(true);
      expect(p.materializedTemp).toBe(true);
      expect(p.role).toBe('merchant');
      expect(p.homePoiId).toBe('host');
      expect(Math.abs((p.homeX ?? 0) - 6)).toBeLessThanOrEqual(2);
      expect(Math.abs((p.homeY ?? 0) - 6)).toBeLessThanOrEqual(2);
    }
  });

  it('materializes NO visitors when the town has no attractors', () => {
    const H = mkt({ hostSouls: 40 });            // cottages only
    settle(H, 'host', noon(0));
    expect(H.sys.visitorRefs().size).toBe(0);
  });

  it('materializes NO visitors outside market hours', () => {
    const H = mkt({ hostAttractors: ['market_stall'], hostSouls: 40 });
    const nightHour = 0 * TICKS_PER_DAY + tickAtSolarHour(22);
    H.setFocus('host', 'settlement');
    let now = nightHour;
    for (let i = 0; i < 40; i++) { H.tick(now); now += 100; }
    expect(H.sys.visitorRefs().size).toBe(0);
  });

  it('folds every visitor back and restores the cohort exactly on unfocus', () => {
    const H = mkt({ hostAttractors: ['market_stall', 'market_stall'], hostSouls: 90 });
    const after = settle(H, 'host', noon(0));
    expect(H.sys.visitorRefs().size).toBeGreaterThan(0);

    unfocus(H, after);
    expect(H.sys.visitorRefs().size).toBe(0);
    expect(queryNpcs(H.world).length).toBe(0);          // residents folded too
    expect(cohortPop(H, 'host')).toBe(90);              // whole again
    expect(totalSouls(H)).toBe(90);
  });

  it('is deterministic — same seed, same visitor ids and market positions', () => {
    const run = () => {
      const H = mkt({ hostAttractors: ['market_stall', 'market_stall'], hostSouls: 90 });
      settle(H, 'host', noon(0));
      return [...H.sys.visitorRefs().values()]
        .map(r => { const e = H.world.registry.get(r.id)!; return `${r.id}@${e.x},${e.y}`; })
        .sort();
    };
    expect(run()).toEqual(run());
  });
});

// ── market-day neighbour pull (cross-POI) ─────────────────────────────────────

describe('slice-3 market-day pull (road-neighbour, cross-POI)', () => {
  it('pulls visitors from a road-neighbour on the host market day, drawn from the NEIGHBOUR cohort', () => {
    const H = mkt({ withNeighbour: true, hostSouls: 40, neighbourSouls: 40 });   // host: cottages only
    expect(isMarketDay('host', 5)).toBe(true);

    settle(H, 'host', noon(5));                 // host's market day at noon
    const srcs = H.visitorSrcCounts();
    expect([...srcs.keys()]).toEqual(['nb']);   // no host attractors ⇒ purely the neighbour pull
    const pulled = srcs.get('nb')!;
    expect(pulled).toBe(neighbourVisitorTarget(40));

    // The neighbour cohort lost exactly the pulled souls; the whole world is conserved.
    expect(cohortPop(H, 'nb')).toBe(40 - pulled);
    expect(totalSouls(H)).toBe(80);

    // Visitors physically stand at the HOST market (6,6), not back home at the neighbour (24,6).
    for (const ref of H.sys.visitorRefs().values()) {
      const e = H.world.registry.get(ref.id)!;
      expect(npcProps(e).homePoiId).toBe('nb');
      expect(e.x).toBeLessThan(15);
    }
  });

  it('does NOT pull neighbours on a non-market day', () => {
    const H = mkt({ withNeighbour: true, hostSouls: 40, neighbourSouls: 40 });
    expect(isMarketDay('host', 0)).toBe(false);
    settle(H, 'host', noon(0));
    expect(H.sys.visitorRefs().size).toBe(0);   // no host attractors + not market day ⇒ nobody
    expect(cohortPop(H, 'nb')).toBe(40);
  });

  it('folds neighbour visitors back into the NEIGHBOUR cohort on unfocus (cross-POI conservation)', () => {
    const H = mkt({ withNeighbour: true, hostSouls: 40, neighbourSouls: 40 });
    const after = settle(H, 'host', noon(5));
    expect(H.sys.visitorRefs().size).toBeGreaterThan(0);

    unfocus(H, after);
    expect(H.sys.visitorRefs().size).toBe(0);
    expect(cohortPop(H, 'host')).toBe(40);
    expect(cohortPop(H, 'nb')).toBe(40);        // the neighbour is made whole again
    expect(totalSouls(H)).toBe(80);
  });
});

// ── CohortSystem audit (the cross-POI keying proof) ──────────────────────────

describe('slice-3 visitors × CohortSystem audit', () => {
  it('a cross-settlement materialize+fold cycle logs zero conservation violations', () => {
    const H = mkt({ withNeighbour: true, hostAttractors: ['market_stall'], hostSouls: 40, neighbourSouls: 40 });
    const cohortSys = new CohortSystem(() => H.cohorts);
    const violations = () => {
      let v = 0;
      for (const e of H.log.since(0)) if (e.event.type === 'system_error') v++;
      return v;
    };
    const auditAt = (now: number) =>
      cohortSys.tick({ world: H.world, spirits: new Map(), log: H.log, clock: H.clock, rng: createRng(9), dt: 1000, now });

    auditAt(noon(5) - 1);                        // baseline census + statBaseline
    const after = settle(H, 'host', noon(5));    // residents (host) + visitors (host local + nb pull)
    auditAt(after + 1);                          // audit the materialize window
    expect(violations()).toBe(0);

    const end = unfocus(H, after);
    auditAt(end + 1);                            // audit the fold window
    expect(violations()).toBe(0);

    expect(cohortPop(H, 'host')).toBe(40);
    expect(cohortPop(H, 'nb')).toBe(40);
  });
});
