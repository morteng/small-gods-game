import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot } from '@/core/snapshot';
import { initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

describe('snapshot size budget', () => {
  it('a snapshot with 200 NPCs serializes to < 200 KB JSON', () => {
    const state = createState();
    const tiles: Tile[][] = [];
    for (let y = 0; y < 60; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 60; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 60, height: 60, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    state.map = map;
    state.world = new World(map);
    for (let i = 0; i < 200; i++) {
      state.world.addEntity({
        id: `n${i}`, kind: 'npc', x: i % 60, y: Math.floor(i / 60),
        properties: initNpcProps(`npc${i}`, 'farmer', 30) as unknown as Record<string, unknown>,
      });
    }
    const snap = captureSnapshot(state);
    const bytes = JSON.stringify(snap).length;
    expect(bytes).toBeLessThan(200_000);
  });
});
