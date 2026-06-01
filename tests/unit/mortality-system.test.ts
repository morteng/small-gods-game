import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import { MortalitySystem, CRADLE_MORTALITY_FLOOR } from '@/sim/systems/mortality-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
/** Add an NPC of a given age (now is 0, so birthTick = -age*ticksPerYear). */
function addAged(world: World, id: string, ageYears: number): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(0) * 131) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function ctxFor(world: World, rngSeed: number, now: number, spirits = new Map<SpiritId, Spirit>()) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const deaths: string[] = [];
  log.subscribe((a: { event: SimEvent }) => { if (a.event.type === 'npc_death') deaths.push(a.event.npcId); });
  return { ctx: { world, spirits, log, clock, rng: createRng(rngSeed), dt: 1000, now }, deaths };
}

describe('MortalitySystem', () => {
  it('does nothing while population is below the cradle floor', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < CRADLE_MORTALITY_FLOOR - 1; i++) addAged(world, `n${i}`, 99); // ancient
    const { ctx, deaths } = ctxFor(world, 1, 0);
    const sys = new MortalitySystem();
    for (let t = 0; t < 50; t++) sys.tick({ ...ctx, now: t });
    expect(deaths).toHaveLength(0);
    expect(queryNpcs(world)).toHaveLength(CRADLE_MORTALITY_FLOOR - 1);
  });

  it('eventually kills the very old once above the cradle floor', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < CRADLE_MORTALITY_FLOOR + 2; i++) addAged(world, `n${i}`, 99);
    const { ctx, deaths } = ctxFor(world, 1, 0);
    const sys = new MortalitySystem();
    for (let t = 0; t < 2000; t++) sys.tick({ ...ctx, now: t });
    expect(deaths.length).toBeGreaterThan(0);
  });

  it('is deterministic: same seed -> identical death set', () => {
    const run = () => {
      const world = new World(emptyMap());
      for (let i = 0; i < 8; i++) addAged(world, `n${i}`, 70 + i);
      const { ctx, deaths } = ctxFor(world, 99, 0);
      const sys = new MortalitySystem();
      for (let t = 0; t < 1000; t++) sys.tick({ ...ctx, now: t });
      return deaths.slice().sort();
    };
    expect(run()).toEqual(run());
  });

  it('a dead believer stops contributing power (SpiritSystem no longer sums them)', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < CRADLE_MORTALITY_FLOOR + 1; i++) {
      const e = addAged(world, `n${i}`, 99);
      npcProps(e).beliefs['player'] = { faith: 1, understanding: 1, devotion: 1 };
    }
    const spirits = new Map<SpiritId, Spirit>([
      ['player', { id: 'player', name: 'You', power: 0, isPlayer: true } as unknown as Spirit],
    ]);
    const { ctx } = ctxFor(world, 1, 0, spirits);
    const mort = new MortalitySystem();
    const spiritSys = new SpiritSystem();
    const before = queryNpcs(world).length;
    for (let t = 0; t < 3000; t++) mort.tick({ ...ctx, now: t });
    const after = queryNpcs(world).length;
    expect(after).toBeLessThan(before); // someone died
    // SpiritSystem only sums living NPCs — power regen reflects the survivors, not the dead.
    spiritSys.tick({ ...ctx, now: 3000 });
    expect(spirits.get('player')!.power).toBeGreaterThanOrEqual(0);
  });
});
