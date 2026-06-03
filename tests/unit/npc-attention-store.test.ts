import { describe, it, expect } from 'vitest';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

describe('NpcAttentionStore', () => {
  it('starts empty for any npc', () => {
    const s = new NpcAttentionStore();
    expect(s.getTranscript('npc1')).toEqual([]);
    expect(s.getPage('npc1', 'surface')).toBeUndefined();
  });

  it('appends and returns transcript turns in order', () => {
    const s = new NpcAttentionStore();
    s.appendTurn('npc1', { whisper: 'heed the river', dialogue: 'a voice?', tick: 10 });
    s.appendTurn('npc1', { whisper: 'flee', dialogue: 'I will', tick: 12 });
    const t = s.getTranscript('npc1');
    expect(t).toHaveLength(2);
    expect(t[0].whisper).toBe('heed the river');
    expect(t[1].dialogue).toBe('I will');
  });

  it('isolates transcripts per npc', () => {
    const s = new NpcAttentionStore();
    s.appendTurn('a', { whisper: 'x', dialogue: 'y', tick: 1 });
    expect(s.getTranscript('b')).toEqual([]);
  });

  it('stores and retrieves mind pages by node-path', () => {
    const s = new NpcAttentionStore();
    const page = { prose: 'she kneels', links: [], depth: 0 };
    s.putPage('npc1', 'surface', page);
    expect(s.getPage('npc1', 'surface')).toBe(page);
    expect(s.getPage('npc1', 'surface ▸ fear')).toBeUndefined();
  });

  it('invalidatePage removes a cached page so it regenerates', () => {
    const s = new NpcAttentionStore();
    s.putPage('npc1', 'surface', { prose: 'old', links: [], depth: 0 });
    expect(s.getPage('npc1', 'surface')).toBeDefined();
    s.invalidatePage('npc1', 'surface');
    expect(s.getPage('npc1', 'surface')).toBeUndefined();
  });

  it('invalidatePage is a no-op for an unknown npc or key', () => {
    const s = new NpcAttentionStore();
    expect(() => s.invalidatePage('ghost', 'surface')).not.toThrow();
  });

  it('clearAll() wipes every npc transcript and page', () => {
    const s = new NpcAttentionStore();
    s.appendTurn('a', { whisper: 'x', dialogue: 'y', tick: 1 });
    s.putPage('a', 'surface', { prose: 'p', links: [], depth: 0 });
    s.clearAll();
    expect(s.getTranscript('a')).toEqual([]);
    expect(s.getPage('a', 'surface')).toBeUndefined();
  });
});
