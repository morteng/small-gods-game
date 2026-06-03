import { describe, it, expect, beforeEach } from 'vitest';
import { mountWhisperMode } from '@/ui/npc-whisper-mode';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

describe('mountWhisperMode', () => {
  let body: HTMLElement;
  let store: NpcAttentionStore;
  beforeEach(() => { body = document.createElement('div'); store = new NpcAttentionStore(); });

  it('renders existing transcript turns on refresh', () => {
    store.appendTurn('npc1', { whisper: 'heed the river', dialogue: 'a voice?', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1');
    h.refresh();
    expect(body.textContent).toContain('heed the river');
    expect(body.textContent).toContain('a voice?');
  });

  it('calls onSend with trimmed input text and clears the input', () => {
    let sent = '';
    const h = mountWhisperMode(body, { store, onSend: (t) => { sent = t; } });
    h.setNpc('npc1');
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = '  flee north  ';
    (body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(sent).toBe('flee north');
    expect(input.value).toBe('');
  });

  it('does not call onSend for empty/whitespace input', () => {
    let calls = 0;
    const h = mountWhisperMode(body, { store, onSend: () => { calls++; } });
    h.setNpc('npc1');
    const input = body.querySelector('[data-sg=whisper-input]') as HTMLTextAreaElement;
    input.value = '   ';
    (body.querySelector('[data-sg=whisper-send]') as HTMLButtonElement).click();
    expect(calls).toBe(0);
  });

  it('appends a new turn on refresh without removing prior DOM nodes', () => {
    store.appendTurn('npc1', { whisper: 'a', dialogue: 'b', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1'); h.refresh();
    const first = body.querySelector('[data-sg=turn]');
    store.appendTurn('npc1', { whisper: 'c', dialogue: 'd', tick: 2 });
    h.refresh();
    expect(body.querySelectorAll('[data-sg=turn]').length).toBe(2);
    expect(body.querySelector('[data-sg=turn]')).toBe(first);
  });

  it('shows a degraded marker when a turn is flagged degraded', () => {
    store.appendTurn('npc1', { whisper: 'x', dialogue: '', tick: 1, degraded: true });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1'); h.refresh();
    expect(body.textContent?.toLowerCase()).toMatch(/no vision|the words land/);
  });

  it('switches transcript when setNpc changes', () => {
    store.appendTurn('a', { whisper: 'alpha', dialogue: 'A', tick: 1 });
    store.appendTurn('b', { whisper: 'beta', dialogue: 'B', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('a'); h.refresh();
    expect(body.textContent).toContain('alpha');
    h.setNpc('b'); h.refresh();
    expect(body.textContent).toContain('beta');
    expect(body.textContent).not.toContain('alpha');
  });

  it('refreshLast() re-renders the final turn after its dialogue is filled in', () => {
    store.appendTurn('npc1', { whisper: 'heed', dialogue: '', tick: 1 });
    const h = mountWhisperMode(body, { store, onSend: () => {} });
    h.setNpc('npc1'); h.refresh();
    expect(body.textContent).not.toContain('a voice');
    store.getTranscript('npc1')[0].dialogue = 'a voice?';
    h.refreshLast();
    expect(body.textContent).toContain('a voice?');
    expect(body.querySelectorAll('[data-sg=turn]').length).toBe(1);
  });
});
