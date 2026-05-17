import { describe, it, expect } from 'vitest';
import { SpiritSystem, POWER_REGEN_RATE } from '@/sim/spirit-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function makeSpirit(id: string, isPlayer = false, power = 1): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer, power, manifestation: null };
}
function ctx(spirits: Map<SpiritId, Spirit>) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const world = new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
  return { world, log, clock, spirits, rng: createRng(0) };
}
function addBeliever(world: World, id: string, faiths: Record<string, number>) {
  const props = initNpcProps('Alice', 'farmer', 1);
  props.beliefs = Object.fromEntries(
    Object.entries(faiths).map(([sid, f]) => [sid, { faith: f, understanding: 0, devotion: 0 }])
  );
  world.addEntity({ id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity);
}

describe('SpiritSystem', () => {
  it('regens power for each spirit from its believers faith', () => {
    const spirits = new Map<SpiritId, Spirit>([
      ['player', makeSpirit('player', true, 1)],
      ['rival',  makeSpirit('rival', false, 1)],
    ]);
    const c = ctx(spirits);
    addBeliever(c.world, 'n1', { player: 0.8, rival: 0.4 });
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 1 });
    expect(spirits.get('player')!.power).toBeCloseTo(1 + 0.8 * POWER_REGEN_RATE, 6);
    expect(spirits.get('rival')!.power).toBeCloseTo(1 + 0.4 * POWER_REGEN_RATE, 6);
  });

  it('emits power_depleted when a spirit hits zero', () => {
    const spirits = new Map<SpiritId, Spirit>([['p', { ...makeSpirit('p'), power: 0 }]]);
    const c = ctx(spirits);
    addBeliever(c.world, 'n1', { p: 0 });  // no faith → no regen
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 1 });
    const evts = c.log.since(0);
    expect(evts.length).toBe(1);
    expect(evts[0].event).toMatchObject({ type: 'power_depleted', spiritId: 'p' });
  });

  it('does not re-emit power_depleted on subsequent ticks while still at zero', () => {
    const spirits = new Map<SpiritId, Spirit>([['p', { ...makeSpirit('p'), power: 0 }]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 1 });
    sys.tick({ ...c, dt: 1000, now: 2 });
    const evts = c.log.since(0).map(a => a.event).filter(e => e.type === 'power_depleted');
    expect(evts.length).toBe(1);
  });
});
