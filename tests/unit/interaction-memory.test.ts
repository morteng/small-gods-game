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

import { recordMemory, selectMemoriesForPrompt, MEMORY_MAX } from '@/llm/interaction-memory';
import type { NpcProperties, MemoryEntry } from '@/core/types';

function props(): NpcProperties { return { memories: [] } as unknown as NpcProperties; }
function entry(tick: number, salience: number, summary = `m${tick}`): MemoryEntry {
  return { tick, salience, summary, kind: 'whisper' };
}

describe('recordMemory', () => {
  it('appends and lazily creates the array', () => {
    const p = { } as unknown as NpcProperties;
    recordMemory(p, entry(1, 0.2));
    expect(p.memories).toHaveLength(1);
  });

  it('bounds at MEMORY_MAX, evicting the lowest-salience (oldest tiebreak)', () => {
    const p = props();
    for (let i = 0; i < MEMORY_MAX + 1; i++) recordMemory(p, entry(i, 0.1));
    expect(p.memories).toHaveLength(MEMORY_MAX);
    expect(p.memories!.some(m => m.tick === 0)).toBe(false);
    expect(p.memories!.some(m => m.tick === MEMORY_MAX)).toBe(true);
  });

  it('keeps a high-salience landmark through many low-salience inserts', () => {
    const p = props();
    recordMemory(p, entry(0, 0.95, 'LANDMARK'));
    for (let i = 1; i < MEMORY_MAX + 10; i++) recordMemory(p, entry(i, 0.1));
    expect(p.memories!.some(m => m.summary === 'LANDMARK')).toBe(true);
    expect(p.memories).toHaveLength(MEMORY_MAX);
  });
});

import { epithetFor, conferEpithet, EPITHET_THRESHOLD } from '@/llm/interaction-memory';

describe('epithets (M2 — deed-derived bynames)', () => {
  const mem = (kind: MemoryEntry['kind'], tick: number, salience: number): MemoryEntry =>
    ({ tick, salience, summary: 's', kind });

  it('confers nothing on an empty or faint ring', () => {
    expect(epithetFor(undefined)).toBeNull();
    expect(epithetFor([])).toBeNull();
    expect(epithetFor([mem('whisper', 1, EPITHET_THRESHOLD - 0.01)])).toBeNull();
  });

  it('names by the salience-argmax deed, not the most recent', () => {
    const ring = [mem('miracle', 1, 1.0), mem('whisper', 9, 0.6)];
    expect(epithetFor(ring)).toBe('Miracle-touched');
  });

  it('answered prayers escalate with repetition — victory renames you', () => {
    const one = [mem('answer', 1, 0.6)];
    expect(epithetFor(one)).toBe('the Answered');
    const two = [...one, mem('answer', 5, 0.6)];
    expect(epithetFor(two)).toBe('the Twice-Answered');
    const four = [...two, mem('answer', 7, 0.6), mem('answer', 9, 0.6)];
    expect(epithetFor(four)).toBe('the Thrice-Answered');
  });

  it('backfill narration never names anyone, however salient', () => {
    expect(epithetFor([mem('backfill', 1, 0.9)])).toBeNull();
  });

  it('recordMemory confers via the chokepoint, and the name is stable under flooding', () => {
    const p = props();
    recordMemory(p, { tick: 1, salience: 0.7, summary: 'answered', kind: 'answer' });
    expect(p.epithet).toBe('the Answered');
    // Faint whispers flood the ring; the landmark answer survives eviction
    // (lowest-salience-first) and the byname holds.
    for (let i = 2; i < MEMORY_MAX + 5; i++) recordMemory(p, entry(i, 0.1));
    expect(p.memories!.some(m => m.kind === 'answer')).toBe(true);
    expect(p.epithet).toBe('the Answered');
  });

  it('a greater deed renames', () => {
    const p = props();
    recordMemory(p, { tick: 1, salience: 0.7, summary: 'answered', kind: 'answer' });
    recordMemory(p, { tick: 2, salience: 1.0, summary: 'wonder', kind: 'miracle' });
    expect(p.epithet).toBe('Miracle-touched');
  });

  it('conferEpithet never overwrites with null', () => {
    const p = props();
    p.epithet = 'the Answered';
    conferEpithet(p);
    expect(p.epithet).toBe('the Answered');
  });
});

describe('selectMemoriesForPrompt', () => {
  it('returns all (chronological) when under the cap', () => {
    expect(selectMemoriesForPrompt([entry(2, 0.1, 'b'), entry(1, 0.1, 'a')], 6)).toEqual(['b', 'a']);
  });

  it('always includes the top-salience landmark, fills with most recent, chronological', () => {
    const mems = [entry(1, 0.95, 'LANDMARK'), entry(2, 0.1, 'x'), entry(3, 0.1, 'y'), entry(4, 0.1, 'z')];
    const out = selectMemoriesForPrompt(mems, 3);
    expect(out).toHaveLength(3);
    expect(out).toContain('LANDMARK');
    expect(out).toContain('z');
    expect(out[0]).toBe('LANDMARK');
  });

  it('returns [] for non-positive maxCount', () => {
    expect(selectMemoriesForPrompt([entry(1, 0.5)], 0)).toEqual([]);
  });
});
