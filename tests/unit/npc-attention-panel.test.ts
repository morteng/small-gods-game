import { describe, it, expect, beforeEach } from 'vitest';
import { mountNpcAttentionPanel } from '@/ui/npc-attention-panel';
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

function deps(over: Partial<Parameters<typeof mountNpcAttentionPanel>[1]> = {}) {
  return { onWhisperSend: () => {}, onMindOpen: () => {}, onMindCrossNav: () => {}, ...over };
}

describe('mountNpcAttentionPanel', () => {
  let host: HTMLElement;
  beforeEach(() => { host = document.createElement('div'); });

  it('renders identity, needs and faith bars on first update', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.update(fakeSim(), { power: 5 });
    expect(host.textContent).toContain('Maeve');
    expect(host.textContent).toContain('farmer');
    expect(host.querySelectorAll('.sg-fill').length).toBeGreaterThanOrEqual(7);
    h.destroy();
  });

  it('shows the mind body and a whisper input, with no mode tabs', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.update(fakeSim(), { power: 5 });
    expect(host.querySelectorAll('[data-sg-mode]').length).toBe(0); // tabs gone
    expect(host.querySelector('[data-sg-body="mind"]')).not.toBeNull();
    expect(host.querySelector('[data-sg=whisper-input]')).not.toBeNull();
    h.destroy();
  });

  it('opens the mind surface when an NPC is selected', () => {
    const opened: Array<[string, string[], number]> = [];
    const h = mountNpcAttentionPanel(host, deps({ onMindOpen: (id, path, depth) => opened.push([id, path, depth]) }));
    h.setNpc('npc1');
    expect(opened).toEqual([['npc1', ['surface'], 0]]);
    h.destroy();
  });

  it('sending a whisper resets to surface and fires onWhisperSend', () => {
    const sends: Array<[string, string]> = [];
    const h = mountNpcAttentionPanel(host, deps({
      onWhisperSend: (id, text) => sends.push([id, text]),
    }));
    h.setNpc('npc1');
    h.update(fakeSim(), { power: 5 });
    const input = host.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = 'heed the river';
    (host.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(sends).toEqual([['npc1', 'heed the river']]);
    h.destroy();
  });

  it('gates the whisper send when power is below cost', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.setNpc('npc1');
    h.update(fakeSim(), { power: 0 });
    expect((host.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).disabled).toBe(true);
    h.destroy();
  });

  it('update() does not wipe a focused element in the mind body', () => {
    const h = mountNpcAttentionPanel(host, deps());
    h.setNpc('npc1');
    h.update(fakeSim(), { power: 5 });
    const body = host.querySelector('[data-sg-body="mind"]') as HTMLElement;
    const sentinel = document.createElement('span'); sentinel.id = 'sentinel';
    body.appendChild(sentinel);
    h.update(fakeSim({ needs: { safety: 0.9, prosperity: 0.4, community: 0.6, meaning: 0.3 } }), { power: 6 });
    expect(host.querySelector('#sentinel')).not.toBeNull();
    h.destroy();
  });
});
