import { describe, it, expect } from 'vitest';
import { advanceNpcFrames } from '@/render/npc-animator';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

function makeMap(w = 5, h = 5): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

describe('advanceNpcFrames', () => {
  it('advances frame after FRAME_MS and wraps 1..8', () => {
    const world = new World(makeMap());
    const props = initNpcProps('Bria', 'farmer', 1);
    props.frame = 1; props.frameTimer = 0;
    world.addEntity({ id: 'n1', kind: 'npc', x: 0, y: 0, properties: props as any });
    advanceNpcFrames(world, 200); // > FRAME_MS (150)
    const after = world.query({ kind: 'npc' })[0].properties as any;
    expect(after.frame).toBe(2);
  });
});
