import { describe, it, expect } from 'vitest';
import { buildMindCard } from '@/game/affordance/mind-card';
import type { InspectorView } from '@/game/game-query';
import { UISPEC_BUDGETS } from '@/story/uispec';

function npcView(over: Partial<InspectorView> = {}): InspectorView {
  return {
    kind: 'npc',
    title: 'Tola the Twice-Answered',
    subtitle: 'farmer · age 34 · praying for prosperity',
    state: [
      { label: 'Faith', value: 0.6 },
      { label: 'Understanding', value: 0.3 },
      { label: 'Devotion', value: 0.4 },
      { label: 'Mood', value: 0.5 },
      { label: 'Safety', value: 0.2 },
    ],
    domains: [],
    affordances: [],
    thought: 'Please, something. Anything would help now.',
    memories: [
      { summary: "A voice in the dark told me to hold fast.", salience: 0.9, kind: 'whisper' },
      { summary: 'The rain came when I begged for it.', salience: 0.8, kind: 'answer' },
    ],
    ...over,
  };
}

describe('buildMindCard', () => {
  it('returns null for a non-npc view', () => {
    expect(buildMindCard({ ...npcView(), kind: 'settlement' } as InspectorView)).toBeNull();
  });

  it('leads with the deterministic thought, then the three belief bars', () => {
    const spec = buildMindCard(npcView())!;
    expect(spec.title).toBe('Tola the Twice-Answered');
    expect(spec.body[0]).toEqual({ kind: 'paragraph', text: 'Please, something. Anything would help now.' });
    const bars = spec.body.filter(b => b.kind === 'beliefBar').map(b => (b as { label: string }).label);
    expect(bars).toEqual(['Faith', 'Understanding', 'Devotion']);
    // Mood / Safety are NOT belief axes → excluded.
    expect(bars).not.toContain('Mood');
  });

  it('surfaces remembered deeds as omen lines', () => {
    const spec = buildMindCard(npcView())!;
    const omens = spec.body.filter(b => b.kind === 'omen').map(b => (b as { text: string }).text);
    expect(omens).toContain('The rain came when I begged for it.');
  });

  it('LLM prose replaces the opening thought when supplied', () => {
    const spec = buildMindCard(npcView(), 'Their mind is a field gone to seed, waiting.')!;
    expect(spec.body[0]).toEqual({ kind: 'paragraph', text: 'Their mind is a field gone to seed, waiting.' });
  });

  it('never exceeds the no-scroll block budget', () => {
    const spec = buildMindCard(npcView())!;
    expect(spec.body.length).toBeLessThanOrEqual(UISPEC_BUDGETS.blocks);
    expect(spec.choices).toEqual([]);
  });

  it('reads with no memories and no thought (an empty-ring soul)', () => {
    const spec = buildMindCard(npcView({ thought: undefined, memories: undefined }))!;
    // still valid: just the belief bars.
    expect(spec.body.every(b => b.kind === 'beliefBar')).toBe(true);
    expect(spec.body.length).toBe(3);
  });
});
