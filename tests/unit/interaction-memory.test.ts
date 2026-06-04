import { describe, it, expect } from 'vitest';
import { distillInteraction, computeSalience } from '@/llm/interaction-memory';
import type { LLMResponse } from '@/llm/state-writeback';

describe('distillInteraction', () => {
  it('summarizes dialogue, belief and mood', () => {
    const res: LLMResponse = { dialogue: 'The gods are watching us', belief_delta: { faith: 0.15, understanding: 0.05 }, mood_delta: 0.1 };
    const s = distillInteraction('Gwendolyn', res, 'Player');
    expect(s).toContain('Gwendolyn said:');
    expect(s).toContain('The gods are watching us');
    expect(s).toContain('faith+0.15');
    expect(s).toContain('understanding+0.05');
    expect(s).toContain('Mood improved');
  });

  it('falls back to a generic line for an empty response', () => {
    expect(distillInteraction('Silent', {}, 'Player')).toContain('Silent interacted with Player');
  });
});

describe('computeSalience', () => {
  it('orders kinds: miracle > answer > dream > whisper > backfill for equal deltas', () => {
    const sal = (k: Parameters<typeof computeSalience>[0]) => computeSalience(k);
    expect(sal('miracle')).toBeGreaterThan(sal('answer'));
    expect(sal('answer')).toBeGreaterThan(sal('dream'));
    expect(sal('dream')).toBeGreaterThan(sal('whisper'));
    expect(sal('whisper')).toBeGreaterThan(sal('backfill'));
  });

  it('answer-prayer alone clears the landmark bar (>= 0.6)', () => {
    expect(computeSalience('answer')).toBeGreaterThanOrEqual(0.6);
  });

  it('larger belief/mood deltas raise salience, clamped to [0,1]', () => {
    expect(computeSalience('whisper', { faith: 0.3 }, 0.2)).toBeGreaterThan(computeSalience('whisper'));
    expect(computeSalience('miracle', { faith: 1, understanding: 1, devotion: 1 }, 1)).toBe(1);
    expect(computeSalience('backfill')).toBeGreaterThanOrEqual(0);
  });
});
