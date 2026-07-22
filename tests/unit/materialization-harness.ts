/**
 * Shared harness for the P2 MaterializationSystem suites (NOT a *.test.ts, so
 * vitest never runs it as a suite). Builds a real grass World with cottages, a
 * hand-seeded statistical cohort, and a focus getter the system reads.
 */
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import type { GameMap, BuildingInstance, WorldSeed, Tile, Entity } from '@/core/types';
import type { ZoomBand } from '@/game/affordance/zoom-band';
import {
  emptySettlementCohorts, addSoul, type SettlementCohorts, type SoulObservation,
} from '@/sim/cohorts';
import { initNpcProps } from '@/world/npc-helpers';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { MaterializationSystem } from '@/sim/systems/materialization-system';

export function grassMap(buildings: BuildingInstance[], poiId = 'village'): GameMap {
  const w = 32, h = 32;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const worldSeed = {
    name: 'test', size: { width: w, height: h }, biome: 'plains',
    pois: [{ id: poiId, name: 'Village', type: 'village', position: { x: 6, y: 6 }, size: 'medium', npcs: [{ name: 'x', role: 'farmer' }] }],
    connections: [], constraints: [],
  } as unknown as WorldSeed;
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed, stats: { iterations: 0, backtracks: 0 }, buildings } as unknown as GameMap;
}

export function cottages(poiId: string, n: number): BuildingInstance[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${poiId}_bld_${i}`, templateId: 'cottage',
    tileX: 3 + (i % 6) * 3, tileY: 3 + Math.floor(i / 6) * 3, poiId, state: 'intact' as const,
  }));
}

/** A statistical cohort of `n` adults (age 30) with player faith, a believer share. */
export function seedCohort(poiId: string, n: number): SettlementCohorts {
  const sc = emptySettlementCohorts(poiId);
  for (let i = 0; i < n; i++) {
    const faith = i % 3 === 0 ? 0.6 : 0.1;           // ~1/3 believers
    const obs: SoulObservation = {
      age: 25 + (i % 20),
      beliefs: { player: { faith, understanding: 0.15, devotion: 0.05 } },
      needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.4 },
    };
    addSoul(sc, obs);
  }
  return sc;
}

export interface Harness {
  map: GameMap;
  world: World;
  cohorts: Map<string, SettlementCohorts>;
  sys: MaterializationSystem;
  log: EventLog;
  clock: SimClock;
  now: number;
  setFocus(poiId: string | null, band: ZoomBand): void;
  tick(now?: number): void;
  /** Focus + tick past the dwell delay and up to steady state. */
  materializeFully(poiId: string, band?: ZoomBand): void;
  /** Focus world + tick past the linger delay until every extra folds. */
  foldFully(): void;
  liveCount(poiId: string): number;
}

/** Workplace instances (worker capacity > 0) at spread-out tiles — slice-2 jobs. */
export function workplaces(poiId: string, kinds: string[]): BuildingInstance[] {
  return kinds.map((templateId, i) => ({
    id: `${poiId}_job_${i}`, templateId,
    tileX: 20 + (i % 4) * 2, tileY: 20 + Math.floor(i / 4) * 2, poiId, state: 'intact' as const,
  }));
}

export function makeHarness(
  opts: { cottages?: number; souls?: number; poiId?: string; extraBuildings?: BuildingInstance[] } = {},
): Harness {
  const poiId = opts.poiId ?? 'village';
  const map = grassMap(
    [...cottages(poiId, opts.cottages ?? 12), ...(opts.extraBuildings ?? [])], poiId);
  const world = new World(map);
  const cohorts = new Map<string, SettlementCohorts>([[poiId, seedCohort(poiId, opts.souls ?? 40)]]);
  let focus: { poiId: string | null; band: ZoomBand } = { poiId: null, band: 'world' };
  const clock = new SimClock();
  const log = new EventLog(clock);
  const sys = new MaterializationSystem(() => cohorts, () => map, () => focus);

  const h: Harness = {
    map, world, cohorts, sys, log, clock, now: 0,
    setFocus(p, band) { focus = { poiId: p, band }; },
    tick(now) {
      if (now !== undefined) h.now = now;
      sys.tick({ world, spirits: new Map(), log, clock, rng: createRng(1), dt: 250, now: h.now });
    },
    materializeFully(p, band = 'settlement') {
      h.setFocus(p, band);
      h.tick(h.now + 50);                 // arm dwell
      h.tick(h.now + 50);                 // adopt + first spawn batch
      for (let i = 0; i < 30; i++) h.tick(h.now + 50);  // fill to steady state
    },
    foldFully() {
      h.setFocus(null, 'world');
      h.tick(h.now + 50);                 // arm linger
      for (let i = 0; i < 40; i++) h.tick(h.now + 300);  // fold everyone
    },
    liveCount(p) {
      let n = 0;
      for (const r of sys.liveRefs().values()) if (r.poiId === p) n++;
      return n;
    },
  };
  return h;
}

/** Add a permanent authored named resident (not materialized). */
export function addNamed(world: World, id: string, poiId: string, age = 30): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(0) * 131) | 0);
  p.homePoiId = poiId;
  p.homeX = 6; p.homeY = 6;
  p.birthTick = -age * TICKS_PER_YEAR;
  p.lineageId = id;
  const e: Entity = { id, kind: 'npc', x: 6, y: 6, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
