import { describe, it, expect } from 'vitest';
import { buildMindPagePrompt, MIND_PAGE_TOOL } from '@/llm/mind-prompt-builder';
import type { Entity } from '@/core/types';

function npc(): Entity {
  return { id: 'maeve', kind: 'npc', x: 1, y: 1, properties: {
    name: 'Maeve', role: 'farmer',
    personality: { assertiveness: 0.3, skepticism: 0.6, piety: 0.4, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.3, devotion: 0.1 } },
    needs: { safety: 0.4, prosperity: 0.3, community: 0.6, meaning: 0.3 },
    mood: 0.5, activity: 'work', recentEventIds: [], relationships: [], homePoiId: 'poi_east',
  } } as unknown as Entity;
}

describe('buildMindPagePrompt', () => {
  it('defines an emit_mind_page tool requiring prose + links', () => {
    expect(MIND_PAGE_TOOL.name).toBe('emit_mind_page');
    const props = (MIND_PAGE_TOOL.parameters as any).properties;
    expect(props.prose).toBeDefined();
    expect(props.links).toBeDefined();
  });

  it('includes the npc name and the breadcrumb path', () => {
    const { messages } = buildMindPagePrompt({ npc: npc(), path: ['surface', 'fear of being forgotten'], candidates: [], depth: 1 });
    const text = messages.map(m => m.content).join('\n');
    expect(text).toContain('Maeve');
    expect(text).toContain('fear of being forgotten');
  });

  it('lists candidate ids the model may link as entities', () => {
    const { messages } = buildMindPagePrompt({
      npc: npc(), path: ['surface'], depth: 0,
      candidates: [{ id: 'tom', label: 'Tom', kind: 'npc' }, { id: 'poi_east', label: 'Easthollow', kind: 'place' }],
    });
    const text = messages.map(m => m.content).join('\n');
    expect(text).toContain('tom');
    expect(text).toContain('Easthollow');
  });

  it('summarizes a deep breadcrumb tail to bound tokens', () => {
    const longPath = ['surface', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { messages } = buildMindPagePrompt({ npc: npc(), path: longPath, candidates: [], depth: 7 });
    const text = messages.map(m => m.content).join('\n');
    expect(text).toContain('g');
    expect(text.length).toBeLessThan(4000);
  });

  it('instructs terse prose at shallow depth and allows more at depth', () => {
    const shallow = buildMindPagePrompt({ npc: npc(), path: ['surface'], candidates: [], depth: 0 });
    const sText = shallow.messages.map(m => m.content).join('\n').toLowerCase();
    expect(sText).toMatch(/brevity/);
    expect(sText).toMatch(/one short sentence|glimpse|fragmentary/);

    const deep = buildMindPagePrompt({ npc: npc(), path: ['surface', 'a', 'b', 'c', 'd', 'e'], candidates: [], depth: 5 });
    const dText = deep.messages.map(m => m.content).join('\n').toLowerCase();
    expect(dText).toMatch(/three or four sentences|dwell/);
  });
});
