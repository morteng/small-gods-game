import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { writeSave, readSave, clearSave, _resetSaveDbForTesting } from '@/services/save-store';
import { IDB_TIMEOUT_MS } from '@/services/idb-guard';
import { toSaveFileLive, applySaveFile, type SaveFile } from '@/core/save-file';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

function fakeSave(tick: number): SaveFile {
  return {
    version: 1, contentVersion: 1, savedAt: 1000, worldSeed: { name: 'w' } as any, map: { width: 1, height: 1 } as any,
    biomeMap: null,
    snapshot: { tick, rng: [1, 2, 3, 4] as any, entities: [], activeEvents: [], spirits: [] },
    events: [], view: {} as any,
  };
}

describe('save-store', () => {
  beforeEach(() => { _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('round-trips a save under the default slot', async () => {
    await writeSave(fakeSave(42));
    const got = await readSave();
    expect(got?.snapshot.tick).toBe(42);
  });

  it('returns null for an absent slot', async () => {
    expect(await readSave()).toBeNull();
  });

  it('clearSave removes the saved slot', async () => {
    await writeSave(fakeSave(7));
    await clearSave();
    expect(await readSave()).toBeNull();
  });

  it('overwrites the same slot on re-write', async () => {
    await writeSave(fakeSave(1));
    await writeSave(fakeSave(2));
    expect((await readSave())?.snapshot.tick).toBe(2);
  });

  it('accepts a save FACTORY and captures its live references at put() time', async () => {
    // The live-save path: the factory builds a save that aliases mutable state;
    // put()'s synchronous structured clone must freeze the put-time values, so
    // mutations AFTER writeSave resolves never leak into the stored save.
    const live = fakeSave(5);
    let calls = 0;
    await writeSave(() => { calls++; return live; });
    live.snapshot.tick = 999;
    expect(calls).toBe(1);
    expect((await readSave())?.snapshot.tick).toBe(5);
  });

  it('a real live save (encoded tiles) is atomic: post-write mutations never leak', async () => {
    const tiles: Tile[][] = [[{ type: 'grass', x: 0, y: 0, walkable: true, state: 'realized' }]];
    const map: GameMap = {
      tiles, width: 1, height: 1, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    const state = createState();
    state.map = map;
    state.world = new World(map);

    await writeSave(() => toSaveFileLive(state, 1000));
    // Mutate live state AFTER the write resolved — both the encoded grid and
    // the aliased-then-cloned map fields must be frozen at put() time.
    map.tiles[0][0].type = 'MUTATED';
    map.villages.push({ x: 0, y: 0, type: 'hamlet' });

    const got = await readSave();
    expect(got).not.toBeNull();
    const fresh = createState();
    expect(applySaveFile(fresh, got!)).toBe(true);
    expect(fresh.map!.tiles[0][0].type).toBe('grass');
    expect(fresh.map!.villages).toHaveLength(0);
  });
});

describe('save-store circuit breaker (wedged store)', () => {
  beforeEach(() => { _resetSaveDbForTesting(); });
  afterEach(() => { vi.restoreAllMocks(); _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('trips after consecutive failures and stops hammering the store', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // open() that never fires any callback → every op times out via the guard.
    let opens = 0;
    vi.stubGlobal('indexedDB', { open: () => { opens++; return {}; } });

    // Failure 1 (below threshold): plain warn, store still attempted.
    const p1 = readSave();
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await expect(p1).resolves.toBeNull();

    // Failure 2 (hits threshold): breaker trips.
    const p2 = readSave();
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await expect(p2).resolves.toBeNull();

    const opensAfterTrip = opens;
    // Subsequent ops short-circuit: no new open(), instant resolve.
    await expect(readSave()).resolves.toBeNull();
    await writeSave(fakeSave(9));
    expect(opens).toBe(opensAfterTrip);  // never touched the wedged store again
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('appears wedged'), expect.anything(),
    );
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
