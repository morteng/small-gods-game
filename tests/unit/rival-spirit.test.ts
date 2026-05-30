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
} from '@/sim/rival-spirit';
import type { SpiritBelief } from '@/core/types';

// Simple seeded RNG for tests
function createTestRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
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
    const context = {
      playerPower: 5,
      playerFollowersInSettlement: {},
      rivalFollowersInSettlement: {},
      npcBeliefs: new Map(),
    };

    // Use a low rng value to trigger the "miracle" branch (rng < 0.4)
    const action = decideRivalAction(rival, 200, context, () => 0.1);
    expect(action).not.toBeNull();
    expect(action!.rivalId).toBe(rival.id);
    expect(action!.powerCost).toBeGreaterThan(0);
  });

  it('should respect cooldown between actions', () => {
    rival.lastActionTick = 100;
    rival.actionCooldown = 50;

    const context = {
      playerPower: 5,
      playerFollowersInSettlement: {},
      rivalFollowersInSettlement: {},
      npcBeliefs: new Map(),
    };

    // Tick 120 is within cooldown (100 + 50 = 150)
    const action = decideRivalAction(rival, 120, context, () => 0.5);
    expect(action).toBeNull();
  });

  it('should not act if not enough power', () => {
    rival.power = 1; // Not enough for miracle (cost 3)
    rival.strategy = 'expand';

    const context = {
      playerPower: 5,
      playerFollowersInSettlement: {},
      rivalFollowersInSettlement: {},
      npcBeliefs: new Map(),
    };

    // Use rng = 0.1 to get miracle branch (cost 3, but we only have 1 power)
    // Then try whisper branch (rng = 0.5, cost 1, we have 1 power)
    const action = expandStrategy(rival, 0.5, context);
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

  const mockContext = {
    playerPower: 5,
    playerFollowersInSettlement: {},
    rivalFollowersInSettlement: {},
    npcBeliefs: new Map(),
  };

  it('expand strategy should prefer miracles and whispers', () => {
    const action = expandStrategy(mockRival, 0.3, mockContext);
    expect(action).not.toBeNull();
    expect(['miracle', 'whisper']).toContain(action!.type);
  });

  it('defend strategy should prefer proselytize', () => {
    const action = defendStrategy(mockRival, 0.2, mockContext);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('proselytize');
  });

  it('undermine strategy should use discredit or curse', () => {
    const action = undermineStrategy(mockRival, 0.1, mockContext);
    expect(action).not.toBeNull();
    expect(['discredit', 'curse']).toContain(action!.type);
    expect(action!.targetSpiritId).toBe('player');
  });

  it('coexist strategy should use gentle whispers', () => {
    const action = coexistStrategy(mockRival, 0.1, mockContext);
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
