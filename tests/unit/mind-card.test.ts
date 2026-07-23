import { describe, it, expect } from 'vitest';
import { buildMindCard, buildMindCloudTokens } from '@/game/affordance/mind-card';
import type { InspectorView } from '@/game/game-query';
import { UISPEC_BUDGETS, type CloudToken, type UiSpecBlock } from '@/story/uispec';

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
      { label: 'Safety', value: 0.2 },      // loud need (loudness 0.8)
      { label: 'Prosperity', value: 0.97 }, // basically met → excluded (loudness 0.03)
    ],
    domains: [{ label: 'Storm', value: 0.7 }],
    affordances: [],
    thought: 'Please, something. Anything would help now.',
    memories: [
      { summary: "A voice in the dark told me to hold fast.", salience: 0.9, kind: 'whisper' },
      { summary: 'The rain came when I begged for it.', salience: 0.8, kind: 'answer' },
    ],
    relationships: [{ name: 'Bram', type: 'friend', trust: 0.85 }],
    ...over,
  };
}

function cloudOf(spec: { body: UiSpecBlock[] }): CloudToken[] {
  const b = spec.body.find(x => x.kind === 'wordCloud');
  return b ? (b as { tokens: CloudToken[] }).tokens : [];
}

describe('buildMindCloudTokens', () => {
  it('draws a token from every category, weighted by the real sim number', () => {
    const toks = buildMindCloudTokens(npcView());
    const find = (t: string) => toks.find(k => k.text === t);
    expect(find('SAFETY')).toMatchObject({ tone: 'need', weight: 0.8 });      // 1 - satisfaction
    expect(find('STORM')).toMatchObject({ tone: 'divine', weight: 0.7 });     // domain conviction
    expect(find('THE RAIN CAME WHEN I BEGGED FOR IT.')).toMatchObject({ tone: 'memory', weight: 0.8 });
    expect(find('BRAM')).toMatchObject({ tone: 'person', weight: 0.85 });     // trust
  });

  it('leaves out needs that are basically met (below the loudness floor)', () => {
    const toks = buildMindCloudTokens(npcView());
    expect(toks.some(t => t.text === 'PROSPERITY')).toBe(false); // loudness 0.03
    expect(toks.some(t => t.text === 'SAFETY')).toBe(true);
  });

  it('omits domains they never think about (conviction 0)', () => {
    const toks = buildMindCloudTokens(npcView({ domains: [{ label: 'Flood', value: 0 }] }));
    expect(toks.some(t => t.tone === 'divine')).toBe(false);
  });

  it('sorts loudest-first and caps to the cloud budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Kin${i}`, type: 'friend', trust: i / 30 }));
    const toks = buildMindCloudTokens(npcView({ relationships: many }));
    expect(toks.length).toBeLessThanOrEqual(16);
    // descending by weight
    for (let i = 1; i < toks.length; i++) expect(toks[i - 1].weight).toBeGreaterThanOrEqual(toks[i].weight);
  });
});

describe('buildMindCard', () => {
  it('returns null for a non-npc view', () => {
    expect(buildMindCard({ ...npcView(), kind: 'settlement' } as InspectorView)).toBeNull();
  });

  it('leads with the deterministic thought, then the weighted mind cloud', () => {
    const spec = buildMindCard(npcView())!;
    expect(spec.title).toBe('Tola the Twice-Answered');
    expect(spec.body[0]).toEqual({ kind: 'paragraph', text: 'Please, something. Anything would help now.' });
    expect(spec.body.some(b => b.kind === 'wordCloud')).toBe(true);
    expect(cloudOf(spec).length).toBeGreaterThan(0);
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

  it('falls back to belief bars for a blank soul with nothing to cloud', () => {
    const blank = npcView({
      state: [
        { label: 'Faith', value: 0.6 }, { label: 'Understanding', value: 0.3 }, { label: 'Devotion', value: 0.4 },
        { label: 'Safety', value: 0.95 }, { label: 'Prosperity', value: 0.95 }, // all needs met → no need tokens
      ],
      domains: [], memories: undefined, relationships: undefined,
    });
    const spec = buildMindCard(blank)!;
    expect(spec.body.some(b => b.kind === 'wordCloud')).toBe(false);
    const bars = spec.body.filter(b => b.kind === 'beliefBar').map(b => (b as { label: string }).label);
    expect(bars).toEqual(['Faith', 'Understanding', 'Devotion']);
  });
});
