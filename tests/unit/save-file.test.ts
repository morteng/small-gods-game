import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { SAVE_VERSION, toSaveFile, toSaveFileLive, applySaveFile } from '@/core/save-file';
import { WORLD_CONTENT_VERSION } from '@/core/content-version';
import type { GameMap, Tile, BiomeMap } from '@/core/types';

function tile(x: number, y: number): Tile {
  return { type: 'grass', x, y, walkable: true, state: 'realized' };
}

function miniMap(): GameMap {
  const w = 2, h = 2;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push(tile(x, y));
    tiles.push(row);
  }
  // exercise the codec's optional-field paths through the real save round-trip
  tiles[1][1] = {
    type: 'road', x: 1, y: 1, walkable: true, state: 'realized',
    baseType: 'grass', irrigated: true, realizedAt: 42,
  };
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function seededState() {
  const s = createState();
  s.map = miniMap();
  s.biomeMap = { width: 2, height: 2, cells: [] } as unknown as BiomeMap;
  s.world = new World(s.map);
  s.world.addEntity({
    id: 'n1', kind: 'npc', x: 0, y: 0,
    properties: { name: 'Maeve', beliefs: { player: { faith: 0.4, understanding: 0.2, devotion: 0.1 } } },
  } as any);
  s.clock.setNow(123);
  s.eventLog.append({ type: 'whisper', spiritId: 'player', npcId: 'n1' });
  s.camera.x = 50; s.camera.y = 60; s.camera.zoom = 2;
  s.selectedNpcId = 'n1';
  return s;
}

describe('save-file', () => {
  it('toSaveFile captures snapshot, map, events, and view', () => {
    const save = toSaveFile(seededState(), 9999);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.savedAt).toBe(9999);
    expect(save.snapshot.tick).toBe(123);
    expect(save.snapshot.entities).toHaveLength(1);
    expect(save.events.length).toBeGreaterThanOrEqual(1);
    expect(save.view.camera.zoom).toBe(2);
    expect(save.view.selectedNpcId).toBe('n1');
  });

  it('round-trip restores tick, entities, eventLog, and camera into a fresh state', () => {
    const save = toSaveFile(seededState(), 1);
    const fresh = createState();
    fresh.map = miniMap();
    fresh.world = new World(fresh.map);
    expect(applySaveFile(fresh, save)).toBe(true);
    expect(fresh.clock.now()).toBe(123);
    expect(fresh.world!.query({ kind: 'npc' })).toHaveLength(1);
    expect(fresh.eventLog.size()).toBe(save.events.length);
    expect(fresh.camera.zoom).toBe(2);
    expect(fresh.selectedNpcId).toBe('n1');
    // visual/blob maps are derived, not stored
    expect(fresh.visualMap).not.toBeNull();
    expect(fresh.blobMap).not.toBeNull();
  });

  it('restores into a fresh state whose world is still null (the real resume path)', () => {
    // bootstrapWorld's resume branch calls applySaveFile on the freshly-created
    // GameState, where createState() leaves world AND map null. restoreSnapshot
    // builds the world from the save's map, so it must not require a pre-existing one.
    const save = toSaveFile(seededState(), 1);
    const fresh = createState();
    expect(fresh.world).toBeNull();
    expect(applySaveFile(fresh, save)).toBe(true);
    expect(fresh.world).not.toBeNull();
    expect(fresh.world!.query({ kind: 'npc' })).toHaveLength(1);
    expect(fresh.clock.now()).toBe(123);
  });

  it('applySaveFile returns false on version mismatch and leaves state untouched', () => {
    const save = toSaveFile(seededState(), 1);
    save.version = 999;
    const fresh = createState();
    fresh.map = miniMap();
    fresh.world = new World(fresh.map);
    const before = fresh.clock.now();
    expect(applySaveFile(fresh, save)).toBe(false);
    expect(fresh.clock.now()).toBe(before);
  });

  it('rejects a pre-codec v2 save (version gate fires before the map is touched)', () => {
    // A v2 save's map.tiles is Tile[][], not EncodedTiles — the version check
    // must reject it without ever reaching the decoder.
    const save = toSaveFile(seededState(), 1);
    save.version = 2;
    (save.map as unknown as GameMap).tiles = [[tile(0, 0)]]; // old shape
    const fresh = createState();
    expect(applySaveFile(fresh, save)).toBe(false);
    expect(fresh.map).toBeNull();
  });
});

describe('save-file — live (single-clone) autosave path', () => {
  it('toSaveFileLive aliases live state instead of deep-cloning it', () => {
    const state = seededState();
    const save = toSaveFileLive(state, 1);
    // Aliasing IS the contract for everything but tiles — the IDB put()'s
    // synchronous structured clone is the one deep copy per save.
    expect(save.map.villages).toBe(state.map!.villages);
    expect(save.map.buildings).toBe(state.map!.buildings);
    const liveNpc = state.world!.query({ kind: 'npc' })[0];
    expect(save.snapshot.entities[0]).toBe(liveNpc);
    expect(save.snapshot.entities[0].properties).toBe(liveNpc.properties);
  });

  it('encodes tiles synchronously into the compact codec (never aliases the grid)', () => {
    const state = seededState();
    const save = toSaveFileLive(state, 1);
    // Tiles are the exception to the aliasing contract: the factory ENCODES
    // them (typed arrays) so put()'s clone never walks the 171k-object grid,
    // and the encoded form is stable even after the live world mutates.
    expect(save.map.tiles.typeOrd).toBeInstanceOf(Uint16Array);
    expect(save.map.tiles.flags).toBeInstanceOf(Uint8Array);
    expect(save.map.tiles.width).toBe(2);
    expect(save.map.tiles.height).toBe(2);
    state.map!.tiles[0][0].type = 'MUTATED';
    const fresh = createState();
    expect(applySaveFile(fresh, save)).toBe(true);
    expect(fresh.map!.tiles[0][0].type).toBe('grass');
  });

  it('toSaveFileLive round-trips through applySaveFile identically to toSaveFile', () => {
    const state = seededState();
    const save = toSaveFileLive(state, 1);
    const fresh = createState();
    expect(applySaveFile(fresh, save)).toBe(true);
    expect(fresh.clock.now()).toBe(123);
    expect(fresh.world!.query({ kind: 'npc' })).toHaveLength(1);
    expect(fresh.eventLog.size()).toBe(save.events.length);
    // applySaveFile deep-copies on the way IN, so the restored state never
    // aliases the save (nor, transitively, the source state).
    expect(fresh.map).not.toBe(state.map);
    expect(fresh.map!.villages).not.toBe(save.map.villages);
    expect(fresh.world!.query({ kind: 'npc' })[0]).not.toBe(save.snapshot.entities[0]);
    // and the decoded tiles deep-equal the source grid
    expect(fresh.map!.tiles).toEqual(state.map!.tiles);
  });
});

describe('save-file — world content version gate', () => {
  it('stamps the current WORLD_CONTENT_VERSION when saving', () => {
    const save = toSaveFile(seededState(), 123);
    expect(save.contentVersion).toBe(WORLD_CONTENT_VERSION);
  });

  it('applySaveFile rejects a save whose contentVersion mismatches', () => {
    const save = toSaveFile(seededState(), 123);
    const stale = { ...save, contentVersion: WORLD_CONTENT_VERSION + 1 };
    expect(applySaveFile(seededState(), stale)).toBe(false);
  });

  it('applySaveFile accepts a save whose version + contentVersion both match', () => {
    const save = toSaveFile(seededState(), 123);
    expect(applySaveFile(seededState(), save)).toBe(true);
  });
});
