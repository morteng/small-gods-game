import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { writeSave, readSave, clearSave, _resetSaveDbForTesting } from '@/services/save-store';
import { IDB_TIMEOUT_MS } from '@/services/idb-guard';
import type { SaveFile } from '@/core/save-file';

function fakeSave(tick: number): SaveFile {
  return {
    version: 1, contentVersion: 1, savedAt: 1000, worldSeed: { name: 'w' } as any, map: { width: 1, height: 1 } as any,
    biomeMap: null,
    snapshot: { tick, eventId: 0, rng: [1, 2, 3, 4] as any, entities: [], activeEvents: [], spirits: [] },
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
