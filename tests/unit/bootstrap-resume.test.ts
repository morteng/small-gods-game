import { describe, it, expect } from 'vitest';
import { bootstrapWorld } from '@/game/bootstrap-world';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap, Tile, WorldSeed } from '@/core/types';
import type { SaveFile } from '@/core/save-file';
import { encodeTiles, decodeTiles } from '@/core/tile-codec';
import '@/world/brushes/index';

function miniMap(): GameMap {
  const tiles: Tile[][] = [[{ type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' }]];
  return { tiles, width: 1, height: 1, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function fakeSave(): SaveFile {
  const m = miniMap();
  const { tiles, ...mapRest } = m;
  return {
    version: 1, contentVersion: 1, savedAt: 1, worldSeed: { name: 'resumed' } as any,
    map: { ...mapRest, tiles: encodeTiles(tiles, m.width, m.height) }, biomeMap: null,
    snapshot: { tick: 77, rng: [1, 2, 3, 4] as any, entities: [], activeEvents: [], spirits: [] },
    events: [],
    view: { camera: { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 }, selectedNpcId: null, pinnedNpcId: null, followNpc: false, cameraLock: { mode: 'free' }, debug: false, showLabels: true, showPoiMarkers: true },
  };
}

const stubAssets = { loadAll: async () => {} } as any;
const stubDecorationImages = { preload: async () => {}, destroy: () => {} } as any;
const getViewport = () => ({ width: 100, height: 100 } as any);

const testSeed: WorldSeed = {
  name: 'resume-test',
  size: { width: 64, height: 64 },
  biome: 'temperate',
  pois: [{ id: 'v', type: 'village', name: 'V', position: { x: 32, y: 32 }, size: 'medium', description: 'x', npcs: [{ name: 'Seed', role: 'farmer' }] }] as any,
  connections: [],
  constraints: [],
};

describe('bootstrapWorld resume', () => {
  it('applies a valid save and skips world generation', async () => {
    const state = createState();
    const applied: SaveFile[] = [];
    const map = await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
      getViewport,
      readSave: async () => fakeSave(),
      applySave: (s, save) => {
        applied.push(save);
        const { tiles, ...mapRest } = save.map;
        s.map = { ...mapRest, tiles: decodeTiles(tiles) };
        s.world = new World(s.map);
        s.clock.setNow(save.snapshot.tick);
        return true;
      },
    });
    expect(applied).toHaveLength(1);
    expect(state.clock.now()).toBe(77);
    expect(map.width).toBe(1);
  });

  it('falls through to fresh generation when no save exists', async () => {
    const state = createState();
    const applied: SaveFile[] = [];
    await bootstrapWorld({
      state, assets: stubAssets, sheets: new Map(), decorationImages: stubDecorationImages,
      getViewport, worldSeed: testSeed,
      readSave: async () => null,
      applySave: (_s, save) => { applied.push(save); return true; },
    });
    expect(applied).toHaveLength(0);
    expect(state.world).not.toBeNull();
    expect(state.world!.query({ kind: 'npc' }).length).toBeGreaterThan(0);
  }, 30_000);
});
