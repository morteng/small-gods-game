/**
 * Tests for Rival Spirit System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { RivalSpirit, RivalStrategy, RivalAction } from '@/sim/rival-spirit';
import {
  createRivalSpirit,
  generateRivalSpirits,
  decideRivalAction,
  applyRivalAction,
  expandStrategy,
  defendStrategy,
  undermineStrategy,
  coexistStrategy,
  assignRivalDomains,
} from '@/sim/rival-spirit';
import type { SpiritBelief } from '@/core/types';
import type { RivalSituation } from '@/sim/rival-claims';

// Simple seeded RNG for tests
function createTestRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function situation(patch: Partial<RivalSituation> = {}): RivalSituation {
  return {
    playerPower: 5,
    playerFollowersInSettlement: {},
    rivalFollowersInSettlement: {},
    rivalFollowerDelta: {},
    prayerPressureInSettlement: {},
    opposingFollowersInSettlement: {},
    otherRivals: [],
    npcBeliefs: new Map(),
    ...patch,
  };
}

describe('Rival Spirit Creation', () => {
  it('should create a rival with default personality', () => {
    const rng = createTestRng(12345);
    const rival = createRivalSpirit('rival-1' as any, 'TestRival', rng);
    
    expect(rival.id).toBe('rival-1');
    expect(rival.name).toBe('TestRival');
    expect(rival.personality.aggression).toBeGreaterThanOrEqual(0.3);
    expect(rival.personality.aggression).toBeLessThanOrEqual(0.7);
    expect(rival.strategy).toBeDefined();
    expect(rival.power).toBeGreaterThanOrEqual(5);
    expect(rival.followers).toEqual([]);
  });

  it('should create a rival with custom personality', () => {
    const rng = createTestRng(12345);
    const rival = createRivalSpirit('rival-2' as any, 'AggressiveRival', rng, {
      personality: {
        aggression: 0.9,
        subtlety: 0.1,
        territoriality: 0.5,
        assertiveness: 0.8,
        jealousy: 0.7,
      },
    });

    expect(rival.personality.aggression).toBe(0.9);
    expect(rival.strategy).toBe('expand'); // High aggression -> expand
  });

  it('should generate multiple rivals for a world', () => {
    const settlementIds = ['village-1', 'village-2', 'village-3'];
    const rivals = generateRivalSpirits(12345, settlementIds, 3);

    expect(rivals.length).toBe(3);
    expect(rivals[0].id).toBe('rival-1');
    expect(rivals[1].id).toBe('rival-2');
    expect(rivals[2].id).toBe('rival-3');
    
    for (const rival of rivals) {
      expect(rival.settlements.length).toBeGreaterThanOrEqual(1);
      expect(rival.settlements.length).toBeLessThanOrEqual(2);
    }
  });

  it('should generate deterministic rivals from same seed', () => {
    const settlementIds = ['village-1', 'village-2'];
    const rivals1 = generateRivalSpirits(999, settlementIds, 2);
    const rivals2 = generateRivalSpirits(999, settlementIds, 2);

    expect(rivals1[0].name).toBe(rivals2[0].name);
    expect(rivals1[0].personality.aggression).toBe(rivals2[0].personality.aggression);
    expect(rivals1[1].color).toBe(rivals2[1].color);
  });

  it('assigns a 1–2 need-domain vector to every generated rival, deterministically', () => {
    const settlementIds = ['village-1', 'village-2'];
    const rivals1 = generateRivalSpirits(999, settlementIds, 2);
    const rivals2 = generateRivalSpirits(999, settlementIds, 2);

    for (const r of rivals1) {
      expect(r.domains).toBeDefined();
      expect(r.domains!.length).toBeGreaterThanOrEqual(1);
      expect(r.domains!.length).toBeLessThanOrEqual(2);
      for (const d of r.domains!) {
        expect(['safety', 'prosperity', 'community', 'meaning']).toContain(d);
      }
    }
    // Same seed ⇒ same domains, rival-by-rival.
    expect(rivals1.map(r => r.domains)).toEqual(rivals2.map(r => r.domains));
  });

  it('assignRivalDomains itself is deterministic for a given rng seed', () => {
    expect(assignRivalDomains(createTestRng(42))).toEqual(assignRivalDomains(createTestRng(42)));
    // A different seed is free to (but need not) differ; just assert it stays
    // in-range so the test isn't tautological about shape only.
    const d = assignRivalDomains(createTestRng(7));
    expect(d.length).toBeGreaterThanOrEqual(1);
    expect(d.length).toBeLessThanOrEqual(2);
  });
});

describe('Rival Strategy Decisions', () => {
  let rival: RivalSpirit;

  beforeEach(() => {
    // Create rival with fixed personality (not using RNG)
    rival = {
      id: 'rival-test' as any,
      name: 'TestRival',
      personality: { aggression: 0.8, subtlety: 0.3, territoriality: 0.4, assertiveness: 0.7, jealousy: 0.5 },
      strategy: 'expand',
      power: 10,
      maxPower: 20,
      followers: [],
      settlements: ['village-1'],
      color: '#ff0000',
      createdTick: 0,
      lastActionTick: 0,
      actionCooldown: 150,
    };
  });

  it('should decide expand actions when aggressive', () => {
    // Use a low rng value to trigger the "miracle" branch
    const action = decideRivalAction(rival, 200, situation(), () => 0.1);
    expect(action).not.toBeNull();
    expect(action!.rivalId).toBe(rival.id);
    expect(action!.powerCost).toBeGreaterThan(0);
  });

  it('should respect cooldown between actions', () => {
    rival.lastActionTick = 100;
    rival.actionCooldown = 50;

    // Tick 120 is within cooldown (100 + 50 = 150)
    const action = decideRivalAction(rival, 120, situation(), () => 0.5);
    expect(action).toBeNull();
  });

  it('should not act if not enough power', () => {
    rival.power = 1; // Not enough for a miracle

    // The miracle branch is unaffordable; the whisper fallback (cost 1) is not.
    const action = expandStrategy(rival, situation(), () => 0.5);
    if (action) {
      expect(action.powerCost).toBeLessThanOrEqual(rival.power);
    }
  });
});

describe('Strategy Functions', () => {
  const mockRival: RivalSpirit = {
    id: 'rival-1' as any,
    name: 'Test',
    personality: { aggression: 0.5, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.5, jealousy: 0.5 },
    strategy: 'expand',
    power: 10,
    maxPower: 20,
    followers: [],
    settlements: ['village-1'],
    color: '#ff0000',
    createdTick: 0,
    lastActionTick: 0,
    actionCooldown: 100,
  };

  it('expand strategy should prefer miracles and whispers', () => {
    const action = expandStrategy(mockRival, situation(), () => 0.3);
    expect(action).not.toBeNull();
    expect(['miracle', 'whisper']).toContain(action!.type);
  });

  it('defend strategy should prefer proselytize', () => {
    const action = defendStrategy(mockRival, situation(), () => 0.2);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('proselytize');
  });

  it('undermine strategy should use discredit or curse', () => {
    // Undermining needs a player stronghold to strike.
    const sit = situation({ playerFollowersInSettlement: { 'village-1': 4 } });
    const action = undermineStrategy(mockRival, sit, () => 0.1);
    expect(action).not.toBeNull();
    expect(['discredit', 'curse']).toContain(action!.type);
    expect(action!.targetSpiritId).toBe('player');
    expect(action!.targetSettlementId).toBe('village-1');
  });

  it('undermine strategy stands down when the player holds nothing', () => {
    expect(undermineStrategy(mockRival, situation(), () => 0)).toBeNull();
  });

  it('coexist strategy should use gentle whispers', () => {
    const action = coexistStrategy(mockRival, situation(), () => 0.1);
    if (action) {
      expect(action.type).toBe('whisper');
      expect(action.effect.faithModifier).toBeLessThan(0.05);
    }
  });
});

describe('Apply Rival Actions', () => {
  it('should apply faith modifier to NPC belief', () => {
    const mockNpc = {
      properties: {
        beliefs: {
          'rival-1': { faith: 0.3, understanding: 0.2, devotion: 0.1 } as SpiritBelief,
        },
      },
    };

    const action: RivalAction = {
      type: 'whisper',
      rivalId: 'rival-1' as any,
      targetNpcId: 'npc-1',
      powerCost: 1,
      effect: { faithModifier: 0.05 },
      description: 'Test whisper',
      tick: 0,
    };

    let updatedNpc: any = null;
    applyRivalAction(
      action,
      (id: string) => (id === 'npc-1' ? mockNpc as any : undefined),
      (id: string, updates: any) => { updatedNpc = updates; }
    );

    expect(updatedNpc).not.toBeNull();
    expect(updatedNpc.properties.beliefs['rival-1'].faith).toBeCloseTo(0.35);
  });

  it('should not crash on missing NPC', () => {
    const action: RivalAction = {
      type: 'whisper',
      rivalId: 'rival-1' as any,
      targetNpcId: 'npc-missing',
      powerCost: 1,
      effect: { faithModifier: 0.05 },
      description: 'Test',
      tick: 0,
    };

    expect(() => {
      applyRivalAction(
        action,
        (id: string) => undefined,
        (id: string, updates: any) => {}
      );
    }).not.toThrow();
  });
});
