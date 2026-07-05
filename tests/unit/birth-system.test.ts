import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import { BirthSystem, POP_CAP_PER_POI } from '@/sim/systems/birth-system';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addAdult(world: World, id: string, poiId: string, ageYears = 30): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  const e: Entity = { id, kind: 'npc', x: 2, y: 2, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function ctxFor(world: World, seed: number, now: number) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const births: string[] = [];
  log.subscribe((a: { event: SimEvent }) => { if (a.event.type === 'npc_birth') births.push(a.event.npcId); });
  return { ctx: { world, spirits: new Map(), log, clock, rng: createRng(seed), dt: 1000, now }, births };
}

describe('BirthSystem', () => {
  it('produces no births without a fertile pair', () => {
    const world = new World(emptyMap());
    addAdult(world, 'lonely', 'village', 30); // only one adult
    const { ctx, births } = ctxFor(world, 1, 0);
    const sys = new BirthSystem();
    for (let t = 0; t < 1000; t++) sys.tick({ ...ctx, now: t });
    expect(births).toHaveLength(0);
  });

  it('births children carrying a parent lineage and diluted faith', () => {
    const world = new World(emptyMap());
    const a = addAdult(world, 'mum', 'village', 28);
    addAdult(world, 'dad', 'village', 31);
    npcProps(a).beliefs['player'] = { faith: 0.8, understanding: 0.6, devotion: 0.2 };
    const { ctx, births } = ctxFor(world, 5, 0);
    const sys = new BirthSystem();
    // Each fire is one game-HOUR under 1:1 realtime (per-check chance ≈
    // BIRTH_RATE_PER_PAIR/24), so give the pair several game-years of checks.
    for (let t = 0; t < 100_000 && births.length === 0; t++) sys.tick({ ...ctx, now: t });
    expect(births.length).toBeGreaterThan(0);
    const child = world.registry.get(births[0])!;
    const cp = npcProps(child);
    expect(['mum', 'dad']).toContain(cp.lineageId);
    expect(cp.beliefs['player'].faith).toBeLessThan(0.8); // diluted relative to parent
  });

  it('never lets births push a POI above the population cap', () => {
    const world = new World(emptyMap());
    // Start below the cap with enough fertile pairs to push toward it.
    const start = POP_CAP_PER_POI - 4;
    for (let i = 0; i < start; i++) addAdult(world, `a${i}`, 'village', 30);
    const { ctx } = ctxFor(world, 9, 0);
    const sys = new BirthSystem();
    for (let t = 0; t < 5000; t++) sys.tick({ ...ctx, now: t });
    const n = queryNpcs(world).length;
    expect(n).toBeLessThanOrEqual(POP_CAP_PER_POI); // cap respected — births stop at the cap
    expect(n).toBeGreaterThan(start);               // but births DID happen (non-vacuous)
  });

  it('is deterministic: same seed -> identical birth count', () => {
    const run = () => {
      const world = new World(emptyMap());
      addAdult(world, 'mum', 'village', 28);
      addAdult(world, 'dad', 'village', 31);
      const { ctx, births } = ctxFor(world, 123, 0);
      const sys = new BirthSystem();
      for (let t = 0; t < 4000; t++) sys.tick({ ...ctx, now: t });
      return births.length;
    };
    expect(run()).toBe(run());
  });
});
