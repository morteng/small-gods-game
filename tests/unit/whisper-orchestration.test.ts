import { describe, it, expect } from 'vitest';
import { sendWhisper, type WhisperOrchestratorDeps } from '@/game/whisper-orchestrator';
import { CommandQueue } from '@/sim/command/command-queue';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { LLMClient } from '@/llm/llm-client';
import type { Entity, NpcProperties } from '@/core/types';
import { recordMemory } from '@/llm/interaction-memory';

function npc(): Entity {
  return { id: 'npc1', kind: 'npc', x: 0, y: 0, properties: {
    name: 'Maeve', role: 'farmer',
    personality: { assertiveness: 0.3, skepticism: 0.5, piety: 0.4, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.3, devotion: 0.1 } },
    needs: { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 },
    mood: 0.5, activity: 'idle', recentEventIds: [],
  } } as unknown as Entity;
}

function mkDeps(store: NpcAttentionStore, queue: CommandQueue, llm: LLMClient): WhisperOrchestratorDeps {
  return {
    queue, llm, store, playerSpiritId: 'player', now: () => 100,
  };
}

// Stub client returning a specific reaction JSON via the provider seam.
function stubClient(json: object): LLMClient {
  return new LLMClient({ async generate() { return { content: JSON.stringify(json), latencyMs: 0 }; } } as any);
}

describe('sendWhisper orchestration', () => {
  it('emits exactly one whisper command with conversational+text payload', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    await sendWhisper(npc(), 'heed the river', mkDeps(store, queue, stubClient({ dialogue: 'a voice?', belief_bonus: 0.05, mood_delta: 0 })));
    const drained = queue.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0].verb).toBe('whisper');
    expect(drained[0].payload).toMatchObject({ conversational: true, text: 'heed the river' });
  });

  it('appends a provisional turn then fills dialogue from the LLM', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    await sendWhisper(npc(), 'x', mkDeps(store, queue, stubClient({ dialogue: 'I hear you', belief_bonus: 0.02, mood_delta: 0.1 })));
    const t = store.getTranscript('npc1');
    expect(t).toHaveLength(1);
    expect(t[0].whisper).toBe('x');
    expect(t[0].dialogue).toBe('I hear you');
    expect(t[0].degraded).not.toBe(true);
  });

  it('marks the turn degraded when the LLM throws', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const throwing = new LLMClient({ async generate() { throw new Error('offline'); } } as any);
    await sendWhisper(npc(), 'x', mkDeps(store, queue, throwing));
    expect(store.getTranscript('npc1')[0].degraded).toBe(true);
  });

  it('marks degraded when the response has no usable dialogue', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    await sendWhisper(npc(), 'x', mkDeps(store, queue, stubClient({ mood_delta: 0.1 })));
    expect(store.getTranscript('npc1')[0].degraded).toBe(true);
  });

  it('clamps the applied faith bonus to ±0.10', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const e = npc();
    const before = (e.properties as any).beliefs.player.faith;
    await sendWhisper(e, 'x', mkDeps(store, queue, stubClient({ dialogue: 'ok', belief_bonus: 0.9, mood_delta: 0 })));
    const after = (e.properties as any).beliefs.player.faith;
    expect(after - before).toBeCloseTo(0.10, 5);
    expect(store.getTranscript('npc1')[0].faithBonus).toBeCloseTo(0.10, 5);
  });
});

describe('whisper interaction memory', () => {
  it('records a memory after a successful whisper', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const e = npc();
    await sendWhisper(e, 'be brave', mkDeps(store, queue, stubClient({ dialogue: 'I will try', belief_bonus: 0.05, mood_delta: 0.1 })));
    const mems = (e.properties as unknown as NpcProperties).memories ?? [];
    expect(mems).toHaveLength(1);
    expect(mems[0].kind).toBe('whisper');
  });

  it('passes prior memories into the whisper prompt', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const e = npc();
    recordMemory(e.properties as unknown as NpcProperties, { tick: 1, kind: 'answer', summary: 'Fooob answered Maeve\'s prayer', salience: 0.7 });
    const captured: string[] = [];
    const client = new LLMClient({ async generate(messages: { content: string }[]) {
      captured.push(messages[messages.length - 1].content);
      return { content: JSON.stringify({ dialogue: 'ok', belief_bonus: 0, mood_delta: 0 }), latencyMs: 0 };
    } } as any);
    await sendWhisper(e, 'again', mkDeps(store, queue, client));
    expect(captured[0]).toContain('answered Maeve');
  });
});
