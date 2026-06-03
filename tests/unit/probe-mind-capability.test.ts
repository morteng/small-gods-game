import { describe, it, expect } from 'vitest';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command } from '@/sim/command/types';
import type { ApplyCtx } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps, getNpc } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { createRng } from '@/core/rng';

function tinyMap(): GameMap {
  const tiles = [] as GameMap['tiles'];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function spirit(power = 100, id: SpiritId = 'player'): Spirit {
  return { id, name: 'You', sigil: '✦', color: '#fff', isPlayer: id === 'player', power, manifestation: null };
}

function worldNpc(id: string, setup: (p: NpcProperties) => void): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = 'poi1';
  setup(p);
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}

function ctx(world: World, spirits: Map<SpiritId, Spirit>): ApplyCtx {
  return { world, spirits, log: new EventLog(new SimClock()), rng: createRng(1), now: 0 };
}

function npcProps(world: World, id: string): NpcProperties {
  return getNpc(world, id)!.properties as unknown as NpcProperties;
}

describe('probe_mind capability', () => {
  it('is registered as a divine, implemented verb', () => {
    expect(CAPABILITY_REGISTRY.probe_mind).toBeDefined();
    expect(CAPABILITY_REGISTRY.probe_mind.tier).toBe('divine');
    expect(CAPABILITY_REGISTRY.probe_mind.implemented).toBe(true);
  });

  it('passes precondition at depth 0 with zero power', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('npc1', () => {}));
    const spirits = new Map([['player', spirit(0)]]);
    const c = ctx(world, spirits);
    const cmd: Command = { verb: 'probe_mind', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { depth: 0 }, seq: 1 };
    expect(CAPABILITY_REGISTRY.probe_mind.precondition!(cmd, c)).toBeNull();
  });

  it('fails precondition at depth 4 (cost 8) with power 3', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('npc1', () => {}));
    const spirits = new Map([['player', spirit(3)]]);
    const c = ctx(world, spirits);
    const cmd: Command = { verb: 'probe_mind', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { depth: 4 }, seq: 1 };
    expect(CAPABILITY_REGISTRY.probe_mind.precondition!(cmd, c)).toBe('insufficient_power');
  });

  it('apply spends the depth cost without mutating the npc', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('npc1', () => {}));
    const spirits = new Map([['player', spirit(10)]]);
    const c = ctx(world, spirits);
    const cmd: Command = { verb: 'probe_mind', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { depth: 2 }, seq: 1 };
    const npcBefore = JSON.stringify(npcProps(world, 'npc1'));
    const ok = CAPABILITY_REGISTRY.probe_mind.apply!(cmd, c);
    expect(ok).toBe(true);
    expect(spirits.get('player')!.power).toBe(8); // 10 - 2
    expect(JSON.stringify(npcProps(world, 'npc1'))).toBe(npcBefore);
  });
});
