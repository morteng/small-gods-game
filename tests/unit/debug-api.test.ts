/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { createDebugApi } from '@/dev/debug-api';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

function miniMap(w = 8, h = 8): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    for (let x = 0; x < w; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function setup() {
  const state = createState();
  const map = miniMap();
  state.map = map;
  state.world = new World(map);
  state.worldSeed = { name: 'Testland' } as any;
  state.world.addEntity({ id: 'c1', kind: 'cottage', x: 2, y: 3, tags: ['building', 'shelter'], properties: {} } as any);
  state.world.addEntity({ id: 'c2', kind: 'cottage', x: 4, y: 4, tags: ['building'], properties: {} } as any);
  state.world.addEntity({ id: 't1', kind: 'tavern', x: 5, y: 5, tags: ['building'], properties: {} } as any);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 1, y: 1, tags: [], properties: { name: 'Ada' } } as any);
  state.world.addEntity({ id: 'v1', kind: 'tree', x: 6, y: 6, tags: ['vegetation'], properties: {} } as any);
  const canvas = document.createElement('canvas');
  const query = createGameQuery({ state, canvas });
  const api = createDebugApi({ query, state, viewport: () => ({ width: 800, height: 600 }), playStory: () => false, music: () => ({}) });
  return { state, api };
}

describe('debug-api', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  it('inventory() counts buildings by kind plus npc/veg totals', () => {
    const inv = s.api.inventory();
    expect(inv.world).toBe('Testland');
    expect(inv.map).toEqual({ w: 8, h: 8 });
    expect(inv.buildings).toBe(3);
    expect(inv.byKind).toEqual({ cottage: 2, tavern: 1 });
    expect(inv.npcs).toBe(1);
    expect(inv.vegetation).toBe(1);
  });

  it('query() passes through to World.query', () => {
    expect(s.api.query({ kind: 'tavern' }).map(e => e.id)).toEqual(['t1']);
    expect(s.api.query({ tag: 'building' })).toHaveLength(3);
  });

  it('focusKind() moves+zooms the camera and returns true; false when kind absent', () => {
    const before = { x: s.state.camera.x, y: s.state.camera.y };
    expect(s.api.focusKind('tavern', 3)).toBe(true);
    expect(s.state.camera.zoom).toBe(3);
    expect(s.state.camera.x !== before.x || s.state.camera.y !== before.y).toBe(true);
    expect(s.api.focusKind('castle_keep')).toBe(false);
  });

  it('fitMap() sets a zoom that fits the map', () => {
    s.api.fitMap();
    expect(s.state.camera.zoom).toBeGreaterThan(0);
  });
});
