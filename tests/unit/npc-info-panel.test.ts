import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderNpcInfoPanel } from '@/ui/npc-info-panel';
import type { NpcSimState } from '@/core/types';

function makeSim(overrides: Partial<NpcSimState> = {}): NpcSimState {
  return {
    npcId: 'oak-1',
    name: 'Brother Alric',
    role: 'priest',
    personality: { assertiveness: 0.5, skepticism: 0.5, piety: 0.7, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.2, devotion: 0.1 } },
    needs: { safety: 0.8, prosperity: 0.6, community: 0.7, meaning: 0.5 },
    mood: 0.65,
    recentEvents: [],
    relationships: [],
    whisperCooldown: 0,
    homePoiId: 'oakshire',
    activity: 'idle',
    ...overrides,
  };
}

describe('renderNpcInfoPanel', () => {
  let panel: HTMLDivElement;

  beforeEach(() => {
    panel = document.createElement('div');
  });

  it('shows the NPC name and role', () => {
    renderNpcInfoPanel(panel, makeSim());
    expect(panel.textContent).toContain('Brother Alric');
    expect(panel.textContent).toContain('priest');
  });

  it('shows home POI', () => {
    renderNpcInfoPanel(panel, makeSim());
    expect(panel.textContent).toContain('oakshire');
  });

  it('shows all four needs', () => {
    renderNpcInfoPanel(panel, makeSim());
    expect(panel.textContent).toContain('safety');
    expect(panel.textContent).toContain('prosperity');
    expect(panel.textContent).toContain('community');
    expect(panel.textContent).toContain('meaning');
  });

  it('shows player belief triple', () => {
    renderNpcInfoPanel(panel, makeSim());
    expect(panel.textContent).toContain('faith');
    expect(panel.textContent).toContain('understanding');
    expect(panel.textContent).toContain('devotion');
  });

  it('falls back gracefully when player belief is missing', () => {
    const sim = makeSim();
    sim.beliefs = {};
    renderNpcInfoPanel(panel, sim);
    expect(panel.textContent).toContain('faith');
  });

  it('shows an unpinned pin button by default', () => {
    renderNpcInfoPanel(panel, makeSim());
    const btn = panel.querySelector<HTMLButtonElement>('button[data-sg="pin"]');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders the pin button as pressed when pinned=true', () => {
    renderNpcInfoPanel(panel, makeSim(), { pinned: true });
    const btn = panel.querySelector<HTMLButtonElement>('button[data-sg="pin"]');
    expect(btn!.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking the pin button calls onTogglePin', () => {
    const onTogglePin = vi.fn();
    renderNpcInfoPanel(panel, makeSim(), { onTogglePin });
    const btn = panel.querySelector<HTMLButtonElement>('button[data-sg="pin"]');
    btn!.click();
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('updates content when called twice with different sims', () => {
    renderNpcInfoPanel(panel, makeSim({ name: 'First' }));
    expect(panel.textContent).toContain('First');
    renderNpcInfoPanel(panel, makeSim({ name: 'Second' }));
    expect(panel.textContent).toContain('Second');
    expect(panel.textContent).not.toContain('First');
  });
});
