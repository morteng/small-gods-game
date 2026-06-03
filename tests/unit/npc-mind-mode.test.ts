import { describe, it, expect, beforeEach } from 'vitest';
import { mountMindMode } from '@/ui/npc-mind-mode';
import type { MindPage } from '@/llm/npc-attention-store';

const surface: MindPage = {
  depth: 0,
  prose: 'She kneels in the wet furrows.',
  links: [
    { label: 'Tom', kind: 'entity', entityId: 'tom' },
    { label: 'fear of being forgotten', kind: 'concept' },
  ],
};

describe('mountMindMode', () => {
  let body: HTMLElement;
  beforeEach(() => { body = document.createElement('div'); });

  it('renders prose and both link kinds', () => {
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 1 });
    h.showPage(['surface'], surface);
    expect(body.textContent).toContain('She kneels');
    expect(body.querySelector('[data-sg-link="entity"]')?.textContent).toContain('Tom');
    expect(body.querySelector('[data-sg-link="concept"]')?.textContent).toContain('forgotten');
    h.destroy();
  });

  it('gold link click triggers cross-nav with the entity id', () => {
    let crossed = '';
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: (id) => { crossed = id; }, nextCost: () => 1 });
    h.showPage(['surface'], surface);
    (body.querySelector('[data-sg-link="entity"]') as HTMLElement).click();
    expect(crossed).toBe('tom');
    h.destroy();
  });

  it('purple link click triggers drill with label+concept', () => {
    let drilled: any = null;
    const h = mountMindMode(body, { onDrill: (label, kind) => { drilled = { label, kind }; }, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 2 });
    h.showPage(['surface'], surface);
    (body.querySelector('[data-sg-link="concept"]') as HTMLElement).click();
    expect(drilled).toEqual({ label: 'fear of being forgotten', kind: 'concept' });
    h.destroy();
  });

  it('renders a clickable breadcrumb and fires onCrumb with the index', () => {
    let idx = -1;
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: (i) => { idx = i; }, onCrossNav: () => {}, nextCost: () => 0 });
    h.showPage(['surface', 'fear of being forgotten'], { ...surface, depth: 1 });
    const crumbs = body.querySelectorAll('[data-sg-crumb]');
    expect(crumbs.length).toBe(2);
    (crumbs[0] as HTMLElement).click();
    expect(idx).toBe(0);
    h.destroy();
  });

  it('shows the next-drill cost', () => {
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 4 });
    h.showPage(['surface'], surface);
    expect(body.textContent).toContain('4');
    h.destroy();
  });

  it('shows a loading state then the page', () => {
    const h = mountMindMode(body, { onDrill: () => {}, onCrumb: () => {}, onCrossNav: () => {}, nextCost: () => 1 });
    h.showLoading(['surface', 'a']);
    expect(body.textContent?.toLowerCase()).toMatch(/reading|listening|…/);
    h.showPage(['surface', 'a'], { ...surface, depth: 1 });
    expect(body.textContent).toContain('She kneels');
    h.destroy();
  });
});
