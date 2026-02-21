import { describe, it, expect } from 'vitest';
import {
  canWhisper,
  whisperNpc,
  computePowerRegen,
  WHISPER_COST,
  WHISPER_FAITH_BOOST,
  WHISPER_UNDERSTANDING_BOOST,
  WHISPER_COOLDOWN,
  POWER_REGEN_RATE,
} from '@/sim/divine-actions';
import { initNpcSim } from '@/sim/npc-sim';
import type { NpcSimState } from '@/core/types';

function makeSim(faith = 0.35): NpcSimState {
  const sim = initNpcSim('npc-1', 'Alice', 'farmer', 42);
  sim.beliefs['player'].faith = faith;
  sim.whisperCooldown = 0;
  return sim;
}

describe('canWhisper', () => {
  it('returns true when power >= cost and cooldown is 0', () => {
    expect(canWhisper(makeSim(), WHISPER_COST)).toBe(true);
  });

  it('returns false when power < cost', () => {
    expect(canWhisper(makeSim(), 0.5)).toBe(false);
  });

  it('returns false when power is exactly 0', () => {
    expect(canWhisper(makeSim(), 0)).toBe(false);
  });

  it('returns false when cooldown > 0', () => {
    const sim = makeSim();
    sim.whisperCooldown = 3;
    expect(canWhisper(sim, WHISPER_COST)).toBe(false);
  });

  it('returns true when cooldown is exactly 0', () => {
    const sim = makeSim();
    sim.whisperCooldown = 0;
    expect(canWhisper(sim, WHISPER_COST)).toBe(true);
  });
});

describe('whisperNpc', () => {
  it('boosts faith by WHISPER_FAITH_BOOST', () => {
    const sim = makeSim(0.35);
    const beforeFaith = sim.beliefs['player'].faith;
    whisperNpc(sim, WHISPER_COST);
    expect(sim.beliefs['player'].faith).toBeCloseTo(beforeFaith + WHISPER_FAITH_BOOST, 10);
  });

  it('boosts understanding by WHISPER_UNDERSTANDING_BOOST', () => {
    const sim = makeSim();
    const beforeUnd = sim.beliefs['player'].understanding;
    whisperNpc(sim, WHISPER_COST);
    expect(sim.beliefs['player'].understanding).toBeCloseTo(beforeUnd + WHISPER_UNDERSTANDING_BOOST, 10);
  });

  it('returns playerPower minus cost', () => {
    const sim = makeSim();
    const result = whisperNpc(sim, 5);
    expect(result).toBeCloseTo(5 - WHISPER_COST, 10);
  });

  it('sets whisperCooldown to WHISPER_COOLDOWN', () => {
    const sim = makeSim();
    whisperNpc(sim, WHISPER_COST);
    expect(sim.whisperCooldown).toBe(WHISPER_COOLDOWN);
  });

  it('pushes event to recentEvents', () => {
    const sim = makeSim();
    whisperNpc(sim, WHISPER_COST);
    expect(sim.recentEvents).toHaveLength(1);
    expect(typeof sim.recentEvents[0]).toBe('string');
  });

  it('caps recentEvents ring buffer at 5', () => {
    const sim = makeSim();
    for (let i = 0; i < 8; i++) {
      whisperNpc(sim, WHISPER_COST);
    }
    expect(sim.recentEvents).toHaveLength(5);
  });

  it('clamps faith at 1 when it would exceed 1', () => {
    const sim = makeSim(0.99);
    whisperNpc(sim, WHISPER_COST);
    expect(sim.beliefs['player'].faith).toBeLessThanOrEqual(1);
  });

  it('clamps understanding at 1', () => {
    const sim = makeSim();
    sim.beliefs['player'].understanding = 0.99;
    whisperNpc(sim, WHISPER_COST);
    expect(sim.beliefs['player'].understanding).toBeLessThanOrEqual(1);
  });

  it('does nothing if player belief does not exist', () => {
    const sim = makeSim();
    delete sim.beliefs['player'];
    const result = whisperNpc(sim, WHISPER_COST);
    // Should return power unchanged or reduced — the key is it doesn't throw
    expect(result).toBeDefined();
  });
});

describe('computePowerRegen', () => {
  it('sums faith × POWER_REGEN_RATE across all NPCs', () => {
    const sims = new Map<string, NpcSimState>();
    const s1 = makeSim(0.5);
    const s2 = makeSim(0.3);
    sims.set('a', s1);
    sims.set('b', s2);
    const expected = (0.5 + 0.3) * POWER_REGEN_RATE;
    expect(computePowerRegen(sims)).toBeCloseTo(expected, 10);
  });

  it('returns 0 for empty map', () => {
    expect(computePowerRegen(new Map())).toBe(0);
  });

  it('returns 0 when all NPCs have no player belief', () => {
    const sims = new Map<string, NpcSimState>();
    const sim = makeSim();
    delete sim.beliefs['player'];
    sims.set('a', sim);
    expect(computePowerRegen(sims)).toBe(0);
  });

  it('regen scales linearly with faith', () => {
    const sims1 = new Map<string, NpcSimState>([['a', makeSim(0.5)]]);
    const sims2 = new Map<string, NpcSimState>([['a', makeSim(1.0)]]);
    expect(computePowerRegen(sims2)).toBeCloseTo(computePowerRegen(sims1) * 2, 10);
  });
});

describe('constants', () => {
  it('WHISPER_COST is 1', () => { expect(WHISPER_COST).toBe(1); });
  it('WHISPER_COOLDOWN is 5', () => { expect(WHISPER_COOLDOWN).toBe(5); });
  it('POWER_REGEN_RATE is 0.02', () => { expect(POWER_REGEN_RATE).toBe(0.02); });
  it('WHISPER_FAITH_BOOST is positive', () => { expect(WHISPER_FAITH_BOOST).toBeGreaterThan(0); });
  it('WHISPER_UNDERSTANDING_BOOST is positive', () => { expect(WHISPER_UNDERSTANDING_BOOST).toBeGreaterThan(0); });
});
