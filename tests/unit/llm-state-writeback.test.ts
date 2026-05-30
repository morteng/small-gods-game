/**
 * Tests for LLM State Writeback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyLLMWriteback,
  validateLLMResponse,
  createInteractionSummary,
  type LLMResponse,
} from '@/llm/state-writeback';
import { initNpcProps } from '@/world/npc-helpers';
import { EventLog } from '@/core/events';
import type { Entity, NpcRole } from '@/core/types';
import type { SpiritId } from '@/core/spirit';

// Helper to create a test NPC entity
function createTestNpc(name: string, role: NpcRole, seed: number): Entity {
  const props = initNpcProps(name, role, seed);
  return {
    id: `npc-${seed}`,
    kind: 'npc',
    x: 10,
    y: 10,
    properties: props as unknown as Record<string, unknown>,
  };
}

describe('applyLLMWriteback', () => {
  let npc: Entity;
  let eventLog: EventLog;
  const spiritId: SpiritId = 'player';

  beforeEach(() => {
    npc = createTestNpc('Gwendolyn', 'farmer', 12345);
    eventLog = new EventLog({ now: () => 0 } as any);
  });

  it('should apply belief delta (faith increase)', () => {
    const response: LLMResponse = {
      belief_delta: { faith: 0.15 },
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toContain('beliefs.faith');
    const props = npc.properties as any;
    expect(props.beliefs[spiritId].faith).toBeGreaterThan(0.15); // Starts with some faith
  });

  it('should apply belief delta (faith decrease)', () => {
    const response: LLMResponse = {
      belief_delta: { faith: -0.2 },
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toContain('beliefs.faith');
    // Faith should decrease (exact value depends on initial state)
    expect(result.changedFields.length).toBeGreaterThan(0);
  });

  it('should apply understanding delta', () => {
    const response: LLMResponse = {
      belief_delta: { understanding: 0.05 },
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toContain('beliefs.understanding');
  });

  it('should apply devotion delta', () => {
    const response: LLMResponse = {
      belief_delta: { devotion: 0.03 },
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toContain('beliefs.devotion');
  });

  it('should apply mood delta', () => {
    const response: LLMResponse = {
      mood_delta: 0.1,
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toContain('mood');
  });

  it('should apply negative mood delta', () => {
    const response: LLMResponse = {
      mood_delta: -0.15,
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toContain('mood');
  });

  it('should add new events to event log and NPC ring buffer', () => {
    const response: LLMResponse = {
      new_events: ['A divine whisper stirred the air'],
    };

    applyLLMWriteback(npc, response, spiritId, eventLog);

    // Should have logged the event
    expect(eventLog.size()).toBe(1);
    // Check that recentEventIds was updated
    const props = npc.properties as any;
    expect(props.recentEventIds.length).toBeGreaterThan(0);
  });

  it('should limit new events to max 2', () => {
    const response: LLMResponse = {
      new_events: ['Event 1', 'Event 2', 'Event 3', 'Event 4'],
    };

    applyLLMWriteback(npc, response, spiritId, eventLog);

    // Should only add 2 events (capped by implementation)
    expect(eventLog.size()).toBe(2);
  });

  it('should keep NPC recentEventIds capped at 8', () => {
    const props = (npc.properties as any);
    // Pre-fill with 7 events
    props.recentEventIds = [1, 2, 3, 4, 5, 6, 7];

    const response: LLMResponse = {
      new_events: ['New event 1', 'New event 2'],
    };

    applyLLMWriteback(npc, response, spiritId, eventLog);

    // Should have 8 entries (7 original + 2 new - 1 shifted = 8)
    expect(props.recentEventIds.length).toBeLessThanOrEqual(8);
  });

  it('should store narration in result', () => {
    const response: LLMResponse = {
      narration: 'The wind whispers through the trees.',
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.narration).toBe('The wind whispers through the trees.');
  });

  it('should store dialogue in result', () => {
    const response: LLMResponse = {
      dialogue: "I hear the gods speaking to me.",
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.dialogue).toBe("I hear the gods speaking to me.");
  });

  it('should clamp faith delta to valid range', () => {
    const response: LLMResponse = {
      belief_delta: { faith: 0.5 }, // Over max of 0.3
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('belief.faith');
  });

  it('should clamp mood delta to valid range', () => {
    const response: LLMResponse = {
      mood_delta: 0.5, // Over max of 0.2
    };

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should create new belief entry if none exists', () => {
    const npcNoBelief = createTestNpc('Nonbeliever', 'soldier', 999);
    const props = (npcNoBelief.properties as any);
    delete props.beliefs.player; // Remove existing belief

    const response: LLMResponse = {
      belief_delta: { faith: 0.1 },
    };

    const result = applyLLMWriteback(npcNoBelief, response, spiritId, eventLog);

    expect(result.changedFields).toContain('beliefs.faith');
    expect(props.beliefs.player).toBeDefined();
    expect(props.beliefs.player.faith).toBeGreaterThan(0);
  });

  it('should handle empty response gracefully', () => {
    const response: LLMResponse = {};

    const result = applyLLMWriteback(npc, response, spiritId, eventLog);

    expect(result.changedFields).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validateLLMResponse', () => {
  it('should validate response with narration', () => {
    expect(validateLLMResponse({ narration: 'Something happens.' })).toBe(true);
  });

  it('should validate response with dialogue', () => {
    expect(validateLLMResponse({ dialogue: 'Hello there.' })).toBe(true);
  });

  it('should validate response with belief_delta', () => {
    expect(validateLLMResponse({ belief_delta: { faith: 0.1 } })).toBe(true);
  });

  it('should validate response with mood_delta', () => {
    expect(validateLLMResponse({ mood_delta: 0.05 })).toBe(true);
  });

  it('should validate response with new_events', () => {
    expect(validateLLMResponse({ new_events: ['An event occurred'] })).toBe(true);
  });

  it('should reject null', () => {
    expect(validateLLMResponse(null)).toBe(false);
  });

  it('should reject non-object', () => {
    expect(validateLLMResponse('string')).toBe(false);
  });

  it('should reject empty object', () => {
    expect(validateLLMResponse({})).toBe(false);
  });
});

describe('createInteractionSummary', () => {
  it('should summarize dialogue', () => {
    const response: LLMResponse = {
      dialogue: 'The gods are watching us, I know it!',
    };

    const summary = createInteractionSummary('Gwendolyn', response, 'Player');

    expect(summary).toContain('Gwendolyn said:');
    expect(summary).toContain('The gods are watching us');
  });

  it('should summarize belief changes', () => {
    const response: LLMResponse = {
      belief_delta: { faith: 0.15, understanding: 0.05 },
    };

    const summary = createInteractionSummary('Thomas', response, 'Player');

    expect(summary).toContain('Belief changed:');
    expect(summary).toContain('faith+0.15');
    expect(summary).toContain('understanding+0.05');
  });

  it('should summarize mood improvement', () => {
    const response: LLMResponse = {
      mood_delta: 0.1,
    };

    const summary = createInteractionSummary('Alice', response, 'Player');

    expect(summary).toContain('Mood improved');
    expect(summary).toContain('0.10');
  });

  it('should summarize mood worsening', () => {
    const response: LLMResponse = {
      mood_delta: -0.15,
    };

    const summary = createInteractionSummary('Bob', response, 'Player');

    expect(summary).toContain('Mood worsened');
    expect(summary).toContain('0.15');
  });

  it('should handle response with no changes', () => {
    const response: LLMResponse = {};

    const summary = createInteractionSummary('Silent', response, 'Player');

    expect(summary).toContain('Silent interacted with Player');
  });
});
