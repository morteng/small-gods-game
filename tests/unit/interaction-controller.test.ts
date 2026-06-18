/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { InteractionController } from '@/game/interaction-controller';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { createInteractionState } from '@/game/interaction-state';
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

function ctrlWith(state: any) {
  return new InteractionController({
    state,
    interaction: createInteractionState(),
    dev: { isEnabled: () => false, handleRightClick: async () => {} } as any,
    placementModal: { open: async () => null } as any,
    decorationImages: { load: async () => {}, get: () => null } as any,
  });
}

describe('InteractionController.onTileClick', () => {
  it('selects then deselects an NPC on repeat click', () => {
    const state = createState();
    const world = makeWorld();
    world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 2, properties: initNpcProps('Ana', 'farmer', 1) as any, tags: [] });
    state.world = world; state.map = { width: 4, height: 4, tiles: [] } as any;
    const ctrl = ctrlWith(state);
    ctrl.onTileClick(2, 2);
    expect(state.selectedNpcId).toBe('n1');
    ctrl.onTileClick(2, 2);
    expect(state.selectedNpcId).toBeNull();
  });

  it('clears pinned when selecting a different npc', () => {
    const state = createState();
    const world = makeWorld();
    world.addEntity({ id: 'n1', kind: 'npc', x: 2, y: 2, properties: initNpcProps('Ana','farmer',1) as any, tags: [] });
    world.addEntity({ id: 'n2', kind: 'npc', x: 3, y: 3, properties: initNpcProps('Bo','farmer',2) as any, tags: [] });
    state.world = world; state.map = { width: 4, height: 4, tiles: [] } as any;
    state.pinnedNpcId = 'n1'; state.selectedNpcId = 'n1';
    const ctrl = ctrlWith(state);
    ctrl.onTileClick(3, 3);
    expect(state.selectedNpcId).toBe('n2');
    expect(state.pinnedNpcId).toBeNull();
  });
});
