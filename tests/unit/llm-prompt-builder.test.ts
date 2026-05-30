/**
 * Tests for the LLM NPC prompt builder.
 */

import { describe, it, expect } from 'vitest';
import { buildNpcPrompt, createInteractionSummary, type NpcPromptContext, type BuiltPrompt } from '@/llm/npc-prompt-builder';
import type { Entity, NpcRole, SettlementEventType } from '@/core/types';
import { initNpcProps } from '@/world/npc-helpers';

// Mock NPC entity for testing
function createMockNpc(name: string, role: NpcRole, seed: number): Entity {
  const props = initNpcProps(name, role, seed);
  return {
    id: `npc-${seed}`,
    kind: 'npc',
    x: 10,
    y: 10,
    properties: props as unknown as Record<string, unknown>,
  };
}

// Mock prompt context
function createMockContext(npc: Entity): NpcPromptContext {
  return {
    npc,
    world: {} as any, // Mock world
    recentEvents: ['A whisper stirred the air', 'The harvest was bountiful'],
    previousInteractions: ['Player whispered about prosperity'],
    nearbyNpcNames: ['Alice', 'Bob'],
    activeEvents: [],
    playerSpiritId: 'player',
  };
}

describe('buildNpcPrompt', () => {
  it('should build a prompt with NPC card', () => {
    const npc = createMockNpc('Gwendolyn', 'farmer', 12345);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.system).toContain('Small Gods');
    expect(prompt.user).toContain('Gwendolyn');
    expect(prompt.user).toContain('farmer');
    expect(prompt.estimatedTokens).toBeGreaterThan(0);
  });

  it('should include personality traits', () => {
    const npc = createMockNpc('Thomas', 'priest', 67890);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('assertiveness');
    expect(prompt.user).toContain('skepticism');
    expect(prompt.user).toContain('piety');
    expect(prompt.user).toContain('sociability');
  });

  it('should include belief values', () => {
    const npc = createMockNpc('Alice', 'merchant', 11111);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('faith=');
    expect(prompt.user).toContain('understanding=');
    expect(prompt.user).toContain('devotion=');
  });

  it('should include needs', () => {
    const npc = createMockNpc('Bob', 'soldier', 22222);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('safety=');
    expect(prompt.user).toContain('prosperity=');
    expect(prompt.user).toContain('community=');
    expect(prompt.user).toContain('meaning=');
  });

  it('should include mood', () => {
    const npc = createMockNpc('Charlie', 'elder', 33333);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('Mood:');
  });

  it('should include recent events', () => {
    const npc = createMockNpc('Diana', 'child', 44444);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('RECENT EVENTS');
    expect(prompt.user).toContain('whisper stirred');
  });

  it('should include previous interactions', () => {
    const npc = createMockNpc('Eve', 'noble', 55555);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('PREVIOUS INTERACTIONS');
    expect(prompt.user).toContain('whispered about prosperity');
  });

  it('should include nearby NPC names', () => {
    const npc = createMockNpc('Frank', 'beggar', 66666);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('CURRENT CONTEXT');
    expect(prompt.user).toContain('Alice');
    expect(prompt.user).toContain('Bob');
  });

  it('should include active events when present', () => {
    const npc = createMockNpc('Grace', 'farmer', 77777);
    const ctx: NpcPromptContext = {
      ...createMockContext(npc),
      activeEvents: ['drought', 'festival'] as SettlementEventType[],
    };
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('Active settlement events');
  });

  it('should estimate tokens reasonably', () => {
    const npc = createMockNpc('Henry', 'priest', 88888);
    const ctx = createMockContext(npc);
    const prompt = buildNpcPrompt(ctx);

    // Rough estimate: ~4 chars per token
    const expected = Math.ceil((prompt.system.length + prompt.user.length) / 4);
    expect(prompt.estimatedTokens).toBe(expected);
  });

  it('should handle empty events and interactions', () => {
    const npc = createMockNpc('Ivy', 'child', 99999);
    const ctx: NpcPromptContext = {
      npc,
      world: {} as any,
      recentEvents: [],
      previousInteractions: [],
      nearbyNpcNames: [],
      activeEvents: [],
      playerSpiritId: 'player',
    };
    const prompt = buildNpcPrompt(ctx);

    expect(prompt.user).toContain('None recently');
    expect(prompt.user).toContain('No previous interactions');
  });
});

describe('createInteractionSummary', () => {
  it('should summarize dialogue', () => {
    const response = {
      dialogue: 'The gods are watching us, I know it!',
    };

    const summary = createInteractionSummary('Gwendolyn', response, 'Player');

    expect(summary).toContain('Gwendolyn said:');
    expect(summary).toContain('The gods are watching us');
  });

  it('should summarize belief changes', () => {
    const response = {
      belief_delta: { faith: 0.15, understanding: 0.05 },
    };

    const summary = createInteractionSummary('Thomas', response, 'Player');

    expect(summary).toContain('Belief changed:');
    expect(summary).toContain('faith+0.15');
    expect(summary).toContain('understanding+0.05');
  });

  it('should summarize mood improvement', () => {
    const response = {
      mood_delta: 0.1,
    };

    const summary = createInteractionSummary('Alice', response, 'Player');

    expect(summary).toContain('Mood improved');
    expect(summary).toContain('0.10');
  });

  it('should summarize mood worsening', () => {
    const response = {
      mood_delta: -0.15,
    };

    const summary = createInteractionSummary('Bob', response, 'Player');

    expect(summary).toContain('Mood worsened');
    expect(summary).toContain('0.15');
  });

  it('should handle response with no changes', () => {
    const response = {};

    const summary = createInteractionSummary('Silent', response, 'Player');

    expect(summary).toContain('Silent interacted with Player');
  });
});
