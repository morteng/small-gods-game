import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { World } from '@/world/world';
import { initNpcProps, getNpc, npcProps } from '@/world/npc-helpers';
import { recordMemory, selectMemoriesForPrompt } from '@/llm/interaction-memory';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeState() {
  const state = createState();
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = { tiles, width: 5, height: 5, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  state.map = map;
  state.world = new World(map);
  const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: initNpcProps('Aelith', 'farmer', 1) as any };
  state.world.addEntity(npc);
  return { state, npc };
}

describe('snapshot persists NPC memory', () => {
  it('round-trips memories (snapshot is authoritative)', () => {
    const { state, npc } = makeState();
    recordMemory(npcProps(npc), { tick: 1, kind: 'answer', summary: 'a landmark', salience: 0.7 });
    const snap = captureSnapshot(state);
    npcProps(npc).memories = []; // mutate after capture
    restoreSnapshot(state, snap);
    const restored = npcProps(getNpc(state.world!, 'n1')!);
    expect(restored.memories).toHaveLength(1);
    expect(restored.memories![0].summary).toBe('a landmark');
  });

  it('tolerates an entity with no memories field (old save)', () => {
    const { state, npc } = makeState();
    delete (npcProps(npc) as { memories?: unknown }).memories;
    const snap = captureSnapshot(state);
    expect(() => restoreSnapshot(state, snap)).not.toThrow();
    const restored = npcProps(getNpc(state.world!, 'n1')!);
    expect(selectMemoriesForPrompt(restored.memories ?? [], 6)).toEqual([]);
  });
});
