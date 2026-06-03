import { describe, it, expect } from 'vitest';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { createState } from '@/core/state';
import { captureSnapshot } from '@/core/snapshot';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

/** Minimal world attachment so captureSnapshot doesn't throw. */
function attachWorld(state: ReturnType<typeof createState>): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
}

describe('attention surface determinism guard', () => {
  it('store contents never appear in a captured snapshot', () => {
    const state = createState();
    attachWorld(state);

    const store = new NpcAttentionStore();
    store.appendTurn('npc1', { whisper: 'SECRET_WHISPER', dialogue: 'SECRET_REACTION', tick: 1 });
    store.putPage('npc1', 'surface', { prose: 'SECRET_INNER_THOUGHT', links: [], depth: 0 });

    // The store is a SEPARATE object, never referenced by GameState, so a
    // snapshot of state cannot contain the store's unique marker strings.
    const snap = captureSnapshot(state);
    const json = JSON.stringify(snap);

    expect(json).not.toContain('SECRET_WHISPER');
    expect(json).not.toContain('SECRET_REACTION');
    expect(json).not.toContain('SECRET_INNER_THOUGHT');
  });

  it('clearAll() leaves the store empty (scrub semantics)', () => {
    const store = new NpcAttentionStore();
    store.appendTurn('n', { whisper: 'x', dialogue: 'y', tick: 1 });
    store.putPage('n', 'surface', { prose: 'p', links: [], depth: 0 });

    store.clearAll();

    expect(store.getTranscript('n')).toEqual([]);
    expect(store.getPage('n', 'surface')).toBeUndefined();
  });
});
