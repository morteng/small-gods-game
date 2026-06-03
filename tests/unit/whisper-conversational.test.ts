import { describe, it, expect } from 'vitest';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command, ApplyCtx } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng } from '@/core/rng';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

// ── ctx construction reused from tests/unit/command-system.test.ts ─────────────

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

function makeCtx() {
  const world = new World(tinyMap());
  world.addEntity(worldNpc('npc1', (p) => { p.whisperCooldown = 5; }));
  const spirits = new Map([['player', spirit(10)]]);
  return ctx(world, spirits);
}

describe('whisper conversational cooldown bypass', () => {
  it('rejects a normal whisper while cooldown > 0', () => {
    const c = makeCtx();
    const cmd: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, seq: 1 };
    expect(CAPABILITY_REGISTRY.whisper.precondition!(cmd, c)).toBe('precondition_failed');
  });

  it('allows a conversational whisper while cooldown > 0', () => {
    const c = makeCtx();
    const cmd: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { conversational: true }, seq: 1 };
    expect(CAPABILITY_REGISTRY.whisper.precondition!(cmd, c)).toBeNull();
  });

  it('conversational apply still moves faith and spends power', () => {
    const c = makeCtx();
    const cmd: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'npc1' }, payload: { conversational: true }, seq: 1 };
    const before = c.spirits.get('player')!.power;
    const ok = CAPABILITY_REGISTRY.whisper.apply!(cmd, c);
    expect(ok).toBe(true);
    expect(c.spirits.get('player')!.power).toBeLessThan(before); // power spent
  });

  it('conversational still rejects a missing npc as invalid_target', () => {
    const c = makeCtx();
    const cmd: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'ghost' }, payload: { conversational: true }, seq: 1 };
    expect(CAPABILITY_REGISTRY.whisper.precondition!(cmd, c)).toBe('invalid_target');
  });
});
