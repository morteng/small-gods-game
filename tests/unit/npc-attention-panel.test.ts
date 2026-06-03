import { describe, it, expect, beforeEach } from 'vitest';
import { mountNpcAttentionPanel } from '@/ui/npc-attention-panel';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import type { NpcSimState } from '@/core/types';

function fakeSim(over: Partial<NpcSimState> = {}): NpcSimState {
  return {
    npcId: 'npc1',
    name: 'Maeve',
    role: 'farmer',
    homePoiId: 'poi_east',
    activity: 'idle',
    needs: { safety: 0.5, prosperity: 0.4, community: 0.6, meaning: 0.3 },
    beliefs: { player: { faith: 0.4, understanding: 0.2, devotion: 0.1 } },
    ...over,
  } as unknown as NpcSimState;
}

describe('mountNpcAttentionPanel', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); });

  it('renders identity, needs and faith bars on first update', () => {
    const h = mountNpcAttentionPanel(host, { store: new NpcAttentionStore(), onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {} });
    h.update(fakeSim(), { power: 5 });
    expect(host.textContent).toContain('Maeve');
    expect(host.textContent).toContain('farmer');
    expect(host.querySelectorAll('.sg-fill').length).toBeGreaterThanOrEqual(7);
    h.destroy();
  });

  it('shows a Whisper/Mind mode switch, Whisper active by default', () => {
    const h = mountNpcAttentionPanel(host, { store: new NpcAttentionStore(), onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {} });
    h.update(fakeSim(), { power: 5 });
    const tabs = host.querySelectorAll('[data-sg-mode]');
    expect(tabs.length).toBe(2);
    expect(h.getActiveMode()).toBe('whisper');
    h.destroy();
  });

  it('switches mode on tab click without re-mounting the panel', () => {
    const h = mountNpcAttentionPanel(host, { store: new NpcAttentionStore(), onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {} });
    h.update(fakeSim(), { power: 5 });
    const mindTab = host.querySelector('[data-sg-mode="mind"]') as HTMLButtonElement;
    mindTab.click();
    expect(h.getActiveMode()).toBe('mind');
    h.destroy();
  });

  it('update() does not wipe a focused element in the active body', () => {
    const h = mountNpcAttentionPanel(host, { store: new NpcAttentionStore(), onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {} });
    h.update(fakeSim(), { power: 5 });
    const body = host.querySelector('[data-sg-body="whisper"]') as HTMLElement;
    const sentinel = document.createElement('span');
    sentinel.id = 'sentinel';
    body.appendChild(sentinel);
    h.update(fakeSim({ needs: { safety: 0.9, prosperity: 0.4, community: 0.6, meaning: 0.3 } }), { power: 6 });
    expect(host.querySelector('#sentinel')).not.toBeNull();
    h.destroy();
  });

  it('fires onWhisper from the action footer', () => {
    let whispered = 0;
    const h = mountNpcAttentionPanel(host, { store: new NpcAttentionStore(), onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {} });
    h.update(fakeSim(), { power: 5, onWhisper: () => { whispered++; } });
    const btn = host.querySelector('[data-sg-action="whisper"]') as HTMLButtonElement;
    btn.click();
    expect(whispered).toBe(1);
    h.destroy();
  });

  it('gates the whisper action when power is below cost', () => {
    const h = mountNpcAttentionPanel(host, { store: new NpcAttentionStore(), onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {} });
    h.update(fakeSim(), { power: 0 });
    const btn = host.querySelector('[data-sg-action="whisper"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    h.destroy();
  });
});
