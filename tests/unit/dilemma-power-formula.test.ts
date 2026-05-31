import { describe, it, expect } from 'vitest';
import { SpiritSystem } from '@/sim/spirit-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { GameMap, Entity, NpcRole } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, role: NpcRole, b: { faith: number; understanding: number; devotion: number }): Entity {
  const p = initNpcProps(id, role, 7);
  p.beliefs['player'] = { ...b };
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function makeSpirit(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 0, manifestation: null };
}
function ctx(world: World, spirits: Map<SpiritId, Spirit>) {
  const clock = new SimClock();
  return { world, spirits, log: new EventLog(clock), clock, rng: createRng(0), dt: 1000, now: 0 };
}

describe('SpiritSystem power formula', () => {
  it('a fully-deepened believer contributes 9× a pure-faith believer', () => {
    const world = new World(emptyMap());
    addNpc(world, 'fearful', 'farmer', { faith: 0.5, understanding: 0, devotion: 0 });
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit()]]);
    new SpiritSystem().tick(ctx(world, spirits));
    const fearfulPower = spirits.get('player')!.power;

    const world2 = new World(emptyMap());
    addNpc(world2, 'devoted', 'farmer', { faith: 0.5, understanding: 1, devotion: 1 });
    const spirits2 = new Map<SpiritId, Spirit>([['player', makeSpirit()]]);
    new SpiritSystem().tick(ctx(world2, spirits2));
    const devotedPower = spirits2.get('player')!.power;

    expect(devotedPower).toBeCloseTo(fearfulPower * 9, 5);
  });

  it('pure faith (u=d=0) regens faith × POWER_REGEN_RATE', () => {
    const world = new World(emptyMap());
    addNpc(world, 'a', 'farmer', { faith: 0.5, understanding: 0, devotion: 0 });
    const spirits = new Map<SpiritId, Spirit>([['player', makeSpirit()]]);
    new SpiritSystem().tick(ctx(world, spirits));
    expect(spirits.get('player')!.power).toBeCloseTo(0.5 * 0.02, 6);
  });
});
