import { describe, it, expect } from 'vitest';
import { whisper, WHISPER_COST, whisperEntity } from '@/sim/whisper';
import { initNpcSim } from '@/sim/npc-sim';
import { initNpcProps } from '@/world/npc-helpers';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';
import type { NpcSimState, Entity, NpcProperties } from '@/core/types';

function makePlayer(power = 3): Spirit {
  return {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700',
    isPlayer: true, power, manifestation: null,
  };
}
function makeSim(): NpcSimState {
  const sim = initNpcSim('npc-1', 'Alice', 'farmer', 42);
  sim.beliefs['player'].faith = 0.3;
  sim.whisperCooldown = 0;
  return sim;
}

describe('whisper', () => {
  it('debits the spirit, boosts the NPCs faith in that spirit, and emits whisper event', () => {
    const spirit = makePlayer(3);
    const sim = makeSim();
    const clock = new SimClock();
    const log = new EventLog(clock);

    whisper(spirit, sim, log);

    expect(spirit.power).toBe(3 - WHISPER_COST);
    expect(sim.beliefs['player'].faith).toBeGreaterThan(0.3);
    const evts = log.since(0);
    expect(evts).toHaveLength(1);
    expect(evts[0].event).toMatchObject({ type: 'whisper', spiritId: 'player', npcId: 'npc-1' });
  });

  it('returns false and is a noop if power is insufficient', () => {
    const spirit = makePlayer(0);
    const sim = makeSim();
    const log = new EventLog(new SimClock());
    const ok = whisper(spirit, sim, log);
    expect(ok).toBe(false);
    expect(spirit.power).toBe(0);
    expect(log.size()).toBe(0);
  });

  it('returns false and is a noop if NPC is on cooldown', () => {
    const spirit = makePlayer(3);
    const sim = makeSim();
    sim.whisperCooldown = 4;
    const log = new EventLog(new SimClock());
    const ok = whisper(spirit, sim, log);
    expect(ok).toBe(false);
    expect(spirit.power).toBe(3);
    expect(log.size()).toBe(0);
  });

  it('creates a belief entry if the spirit was previously unbelieved-in', () => {
    const spirit: Spirit = { ...makePlayer(3), id: 'rival', name: 'Grooob', isPlayer: false };
    const sim = makeSim();
    const log = new EventLog(new SimClock());
    whisper(spirit, sim, log);
    expect(sim.beliefs['rival']).toBeDefined();
    expect(sim.beliefs['rival'].faith).toBeGreaterThan(0);
  });
});

function makeNpcEntity(faith = 0.3): Entity {
  const props = initNpcProps('Alice', 'farmer', 42) as unknown as Record<string, unknown>;
  (props as unknown as NpcProperties).beliefs['player'].faith = faith;
  return { id: 'npc-1', kind: 'npc', x: 0, y: 0, properties: props };
}

describe('whisperEntity', () => {
  it('debits spirit, boosts NPC faith, emits whisper event', () => {
    const spirit = makePlayer(3);
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    const ok = whisperEntity(spirit, e, log);
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
    expect(whisperEntity(spirit, e, log)).toBe(false);
    expect(log.size()).toBe(0);
  });

  it('noop on cooldown', () => {
    const spirit = makePlayer(3);
    const e = makeNpcEntity();
    (e.properties as unknown as NpcProperties).whisperCooldown = 4;
    const log = new EventLog(new SimClock());
    expect(whisperEntity(spirit, e, log)).toBe(false);
  });

  it('creates a new belief entry for a previously unknown spirit', () => {
    const spirit: Spirit = { ...makePlayer(3), id: 'rival', name: 'Grooob', isPlayer: false };
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    whisperEntity(spirit, e, log);
    expect((e.properties as unknown as NpcProperties).beliefs['rival']).toBeDefined();
  });
});
