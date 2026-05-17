import { describe, it, expect } from 'vitest';
import {
  personalityFromSeed,
  computeMood,
  clamp01,
  tickNpcEntity,
} from '@/sim/npc-sim';
import { initNpcProps } from '@/world/npc-helpers';
import type { NpcNeeds, Entity, NpcProperties } from '@/core/types';

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


function makeNpcEntity(seed = 42, faith = 0.5): Entity {
  const props = initNpcProps('Alice', 'farmer', seed) as unknown as Record<string, unknown>;
  (props as unknown as NpcProperties).beliefs['player'].faith = faith;
  return { id: 'n1', kind: 'npc', x: 0, y: 0, properties: props };
}

describe('tickNpcEntity', () => {
  it('decays faith on tick (skeptic > 0 case)', () => {
    const e = makeNpcEntity(42, 0.5);
    const before = (e.properties as unknown as NpcProperties).beliefs.player.faith;
    tickNpcEntity(e);
    expect((e.properties as unknown as NpcProperties).beliefs.player.faith).toBeLessThanOrEqual(before);
  });

  it('decrements whisperCooldown', () => {
    const e = makeNpcEntity();
    (e.properties as unknown as NpcProperties).whisperCooldown = 3;
    tickNpcEntity(e);
    expect((e.properties as unknown as NpcProperties).whisperCooldown).toBe(2);
  });

  it('updates mood from needs', () => {
    const e = makeNpcEntity();
    const p = e.properties as unknown as NpcProperties;
    p.needs.safety = p.needs.prosperity = p.needs.community = p.needs.meaning = 0.9;
    tickNpcEntity(e);
    expect(p.mood).toBeGreaterThan(0.8);
  });
});
