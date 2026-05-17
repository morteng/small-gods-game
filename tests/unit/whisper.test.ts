import { describe, it, expect } from 'vitest';
import { whisper, WHISPER_COST } from '@/sim/whisper';
import { initNpcProps } from '@/world/npc-helpers';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';
import type { Entity, NpcProperties } from '@/core/types';

function makePlayer(power = 3): Spirit {
  return {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700',
    isPlayer: true, power, manifestation: null,
  };
}

function makeNpcEntity(faith = 0.3): Entity {
  const props = initNpcProps('Alice', 'farmer', 42) as unknown as Record<string, unknown>;
  (props as unknown as NpcProperties).beliefs['player'].faith = faith;
  return { id: 'npc-1', kind: 'npc', x: 0, y: 0, properties: props };
}

describe('whisper', () => {
  it('debits spirit, boosts NPC faith, emits whisper event', () => {
    const spirit = makePlayer(3);
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    const ok = whisper(spirit, e, log);
    expect(ok).toBe(true);
    expect(spirit.power).toBe(2);
    expect((e.properties as unknown as NpcProperties).beliefs['player'].faith).toBeGreaterThan(0.3);
    const evts = log.since(0);
    expect(evts[0].event).toMatchObject({ type: 'whisper', spiritId: 'player', npcId: 'npc-1' });
  });

  it('noop on insufficient power', () => {
    const spirit = makePlayer(0);
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    expect(whisper(spirit, e, log)).toBe(false);
    expect(log.size()).toBe(0);
  });

  it('noop on cooldown', () => {
    const spirit = makePlayer(3);
    const e = makeNpcEntity();
    (e.properties as unknown as NpcProperties).whisperCooldown = 4;
    const log = new EventLog(new SimClock());
    expect(whisper(spirit, e, log)).toBe(false);
  });

  it('creates a new belief entry for a previously unknown spirit', () => {
    const spirit: Spirit = { ...makePlayer(3), id: 'rival', name: 'Grooob', isPlayer: false };
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    whisper(spirit, e, log);
    expect((e.properties as unknown as NpcProperties).beliefs['rival']).toBeDefined();
  });

  it('returns false when power is exactly equal to cost — success case', () => {
    const spirit = makePlayer(WHISPER_COST);
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    expect(whisper(spirit, e, log)).toBe(true);
    expect(spirit.power).toBe(0);
  });
});
