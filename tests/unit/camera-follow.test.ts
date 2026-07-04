import { describe, it, expect } from 'vitest';
import { applyFollowCamera } from '@/game/camera-follow';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { worldToScreen } from '@/render/iso/iso-projection';
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

function makeWorld() {
  return new World(makeMap());
}

describe('applyFollowCamera', () => {
  it('no-ops when followNpc is false', () => {
    const state = createState();
    state.followNpc = false;
    const before = state.camera.x;
    applyFollowCamera(state, { width: 800, height: 600 });
    expect(state.camera.x).toBe(before);
  });

  it('lerps camera 15% toward the selected npc', () => {
    const state = createState();
    const world = makeWorld();
    world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: initNpcProps('A', 'farmer', 1) as any, tags: [] });
    state.world = world;
    state.selectedNpcId = 'n1';
    state.followNpc = true;
    state.camera.x = 0; state.camera.y = 0; state.camera.zoom = 1;
    // The camera pans in iso-screen space — the follow target is the npc's tile
    // projected through the SAME iso transform the renderer uses.
    const targetX = worldToScreen(10 + 0.5, 10 + 0.5, 0, 0, 0).sx - 800 / 2;
    applyFollowCamera(state, { width: 800, height: 600 });
    expect(state.camera.x).toBeCloseTo(targetX * 0.15, 5);
  });

  it('clears followNpc when the selected npc is gone', () => {
    const state = createState();
    state.world = makeWorld();
    state.selectedNpcId = 'missing';
    state.followNpc = true;
    applyFollowCamera(state, { width: 800, height: 600 });
    expect(state.followNpc).toBe(false);
  });
});
