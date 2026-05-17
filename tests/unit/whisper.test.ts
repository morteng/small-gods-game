import { describe, it, expect } from 'vitest';
import { whisper, WHISPER_COST } from '@/sim/whisper';
import { initNpcSim } from '@/sim/npc-sim';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';
import type { NpcSimState } from '@/core/types';

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
