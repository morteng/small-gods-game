import { describe, it, expect } from 'vitest';
import {
  personalityFromSeed,
  initNpcSim,
  computeMood,
  tickNpcSim,
  clamp01,
} from '@/sim/npc-sim';
import type { NpcNeeds } from '@/core/types';

describe('clamp01', () => {
  it('clamps values below 0 to 0', () => {
    expect(clamp01(-0.5)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(clamp01(1.5)).toBe(1);
  });

  it('leaves values in range unchanged', () => {
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe('personalityFromSeed', () => {
  it('is deterministic — same seed produces same values', () => {
    const p1 = personalityFromSeed(42, 'farmer');
    const p2 = personalityFromSeed(42, 'farmer');
    expect(p1).toEqual(p2);
  });

  it('produces different values for different seeds', () => {
    const p1 = personalityFromSeed(1, 'farmer');
    const p2 = personalityFromSeed(9999, 'farmer');
    expect(p1.skepticism).not.toBe(p2.skepticism);
  });

  it('all trait values are in [0, 1]', () => {
    for (const seed of [0, 1, 100, 99999]) {
      const p = personalityFromSeed(seed, 'farmer');
      expect(p.assertiveness).toBeGreaterThanOrEqual(0);
      expect(p.assertiveness).toBeLessThanOrEqual(1);
      expect(p.skepticism).toBeGreaterThanOrEqual(0);
      expect(p.skepticism).toBeLessThanOrEqual(1);
      expect(p.piety).toBeGreaterThanOrEqual(0);
      expect(p.piety).toBeLessThanOrEqual(1);
      expect(p.sociability).toBeGreaterThanOrEqual(0);
      expect(p.sociability).toBeLessThanOrEqual(1);
    }
  });

  it('priest has higher piety than merchant (on average, via bonus)', () => {
    // Sample several seeds and confirm priest piety > merchant piety on average
    let priestTotal = 0, merchantTotal = 0;
    const N = 20;
    for (let i = 0; i < N; i++) {
      priestTotal   += personalityFromSeed(i * 13 + 7, 'priest').piety;
      merchantTotal += personalityFromSeed(i * 13 + 7, 'merchant').piety;
    }
    expect(priestTotal / N).toBeGreaterThan(merchantTotal / N);
  });
});

describe('initNpcSim', () => {
  it('stores npcId, name, role correctly', () => {
    const sim = initNpcSim('npc-1', 'Alice', 'farmer', 42);
    expect(sim.npcId).toBe('npc-1');
    expect(sim.name).toBe('Alice');
    expect(sim.role).toBe('farmer');
  });

  it('priest has higher initial faith than farmer', () => {
    const priest  = initNpcSim('p', 'P', 'priest',  100);
    const farmer  = initNpcSim('f', 'F', 'farmer',  100);
    expect(priest.beliefs['player'].faith).toBeGreaterThan(farmer.beliefs['player'].faith);
  });

  it('beliefs are keyed to player', () => {
    const sim = initNpcSim('id', 'Bob', 'soldier', 7);
    expect(sim.beliefs).toHaveProperty('player');
    expect(Object.keys(sim.beliefs)).toHaveLength(1);
  });

  it('initial faith is in [0, 1]', () => {
    const sim = initNpcSim('id', 'X', 'beggar', 5);
    expect(sim.beliefs['player'].faith).toBeGreaterThanOrEqual(0);
    expect(sim.beliefs['player'].faith).toBeLessThanOrEqual(1);
  });

  it('initial needs are in [0, 1]', () => {
    const sim = initNpcSim('id', 'X', 'elder', 999);
    expect(sim.needs.safety).toBeGreaterThanOrEqual(0);
    expect(sim.needs.safety).toBeLessThanOrEqual(1);
    expect(sim.needs.prosperity).toBeGreaterThanOrEqual(0);
    expect(sim.needs.prosperity).toBeLessThanOrEqual(1);
    expect(sim.needs.community).toBeGreaterThanOrEqual(0);
    expect(sim.needs.community).toBeLessThanOrEqual(1);
    expect(sim.needs.meaning).toBeGreaterThanOrEqual(0);
    expect(sim.needs.meaning).toBeLessThanOrEqual(1);
  });

  it('mood is average of four needs', () => {
    const sim = initNpcSim('id', 'X', 'noble', 77);
    const expected = (sim.needs.safety + sim.needs.prosperity + sim.needs.community + sim.needs.meaning) / 4;
    expect(sim.mood).toBeCloseTo(expected, 10);
  });

  it('understanding starts at 0.1 and devotion at 0.05', () => {
    const sim = initNpcSim('id', 'X', 'child', 3);
    expect(sim.beliefs['player'].understanding).toBe(0.1);
    expect(sim.beliefs['player'].devotion).toBe(0.05);
  });
});

describe('computeMood', () => {
  it('returns average of all four needs', () => {
    const needs: NpcNeeds = { safety: 0.8, prosperity: 0.6, community: 0.4, meaning: 0.2 };
    expect(computeMood(needs)).toBeCloseTo(0.5, 10);
  });

  it('returns 0 when all needs are 0', () => {
    const needs: NpcNeeds = { safety: 0, prosperity: 0, community: 0, meaning: 0 };
    expect(computeMood(needs)).toBe(0);
  });

  it('returns 1 when all needs are 1', () => {
    const needs: NpcNeeds = { safety: 1, prosperity: 1, community: 1, meaning: 1 };
    expect(computeMood(needs)).toBe(1);
  });
});

describe('tickNpcSim', () => {
  it('faith decays proportionally to skepticism', () => {
    const highSkeptic = initNpcSim('h', 'H', 'merchant', 42);
    const lowSkeptic  = initNpcSim('l', 'L', 'merchant', 42);
    // Override skepticism directly
    highSkeptic.personality.skepticism = 1.0;
    lowSkeptic.personality.skepticism  = 0.1;

    const h0 = highSkeptic.beliefs['player'].faith;
    const l0 = lowSkeptic.beliefs['player'].faith;

    tickNpcSim(highSkeptic);
    tickNpcSim(lowSkeptic);

    const hDelta = h0 - highSkeptic.beliefs['player'].faith;
    const lDelta = l0 - lowSkeptic.beliefs['player'].faith;
    expect(hDelta).toBeGreaterThan(lDelta);
  });

  it('faith does not decay when skepticism is 0', () => {
    const sim = initNpcSim('id', 'X', 'farmer', 5);
    sim.personality.skepticism = 0;
    const before = sim.beliefs['player'].faith;
    // Also ensure no boost from needs (needs are moderate)
    sim.needs = { safety: 0.6, prosperity: 0.6, community: 0.6, meaning: 0.6 };
    tickNpcSim(sim);
    expect(sim.beliefs['player'].faith).toBe(before);
  });

  it('needs decay slowly each tick', () => {
    const sim = initNpcSim('id', 'X', 'farmer', 5);
    sim.needs = { safety: 0.8, prosperity: 0.8, community: 0.8, meaning: 0.8 };
    tickNpcSim(sim);
    expect(sim.needs.safety).toBeCloseTo(0.799, 3);
    expect(sim.needs.prosperity).toBeCloseTo(0.799, 3);
    expect(sim.needs.community).toBeCloseTo(0.7995, 4);
    expect(sim.needs.meaning).toBeCloseTo(0.7995, 4);
  });

  it('mood is recomputed after tick', () => {
    const sim = initNpcSim('id', 'X', 'farmer', 5);
    tickNpcSim(sim);
    const expected = computeMood(sim.needs);
    expect(sim.mood).toBeCloseTo(expected, 10);
  });

  it('faith never goes below 0', () => {
    const sim = initNpcSim('id', 'X', 'soldier', 1);
    sim.beliefs['player'].faith = 0;
    sim.personality.skepticism = 1;
    tickNpcSim(sim);
    expect(sim.beliefs['player'].faith).toBeGreaterThanOrEqual(0);
  });

  it('needs never go below 0', () => {
    const sim = initNpcSim('id', 'X', 'farmer', 1);
    sim.needs = { safety: 0, prosperity: 0, community: 0, meaning: 0 };
    tickNpcSim(sim);
    expect(sim.needs.safety).toBeGreaterThanOrEqual(0);
    expect(sim.needs.prosperity).toBeGreaterThanOrEqual(0);
    expect(sim.needs.community).toBeGreaterThanOrEqual(0);
    expect(sim.needs.meaning).toBeGreaterThanOrEqual(0);
  });

  it('low needs boost faith via piety', () => {
    const sim = initNpcSim('id', 'X', 'priest', 42);
    sim.needs = { safety: 0.1, prosperity: 0.1, community: 0.1, meaning: 0.1 };
    sim.personality.skepticism = 0;  // no decay
    sim.personality.piety = 1.0;
    const before = sim.beliefs['player'].faith;
    tickNpcSim(sim);
    expect(sim.beliefs['player'].faith).toBeGreaterThanOrEqual(before);
  });
});
