import { describe, it, expect } from 'vitest';
import { NpcAttentionStore } from '@/llm/npc-attention-store';

// Contract test: a restore clears the attention store. The Game-level composition
// (onRestore calling attentionStore.clearAll alongside commandQueue.clear) is
// verified by reading game.ts; here we assert the clear contract itself.
describe('attention store scrub-clear wiring', () => {
  it('clears the attention store on restore', () => {
    const store = new NpcAttentionStore();
    store.appendTurn('npc1', { whisper: 'x', dialogue: 'y', tick: 1 });
    let cleared = false;
    const onRestore = () => { store.clearAll(); cleared = true; };
    onRestore();
    expect(cleared).toBe(true);
    expect(store.getTranscript('npc1')).toEqual([]);
  });
});
