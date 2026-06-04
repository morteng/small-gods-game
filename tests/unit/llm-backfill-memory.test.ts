import { describe, it, expect } from 'vitest';
import { LlmBackfillService } from '@/game/llm-backfill';
import { LLMClient, type LLMProvider, type LLMMessage } from '@/llm/llm-client';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { LlmDisplayHandle } from '@/ui/llm-display';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 5, height: 5, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

const noopDisplay = { showBoth() {}, showDialogue() {}, showNarration() {} } as unknown as LlmDisplayHandle;

function capturingProvider(captured: string[]): LLMProvider {
  return {
    isAvailable: () => true,
    async generate(messages: LLMMessage[]) {
      captured.push(messages[messages.length - 1].content);
      return { content: JSON.stringify({ dialogue: 'I feel watched', belief_delta: { faith: 0.1 } }), latencyMs: 0 };
    },
  } as unknown as LLMProvider;
}

describe('backfill interaction memory', () => {
  it('records a memory and feeds it into the next prompt', async () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: initNpcProps('Aelith', 'farmer', 1) as any };
    state.world.addEntity(npc);

    const captured: string[] = [];
    const svc = new LlmBackfillService({ state, llmDisplay: noopDisplay, client: new LLMClient(capturingProvider(captured)) });

    await svc.trigger(npc);
    expect(npcProps(npc).memories ?? []).toHaveLength(1);
    expect(npcProps(npc).memories![0].kind).toBe('backfill');

    await svc.trigger(npc);
    expect(captured[1]).toContain('Aelith said:');
    expect(captured[1]).not.toContain('No previous interactions');
  });
});
