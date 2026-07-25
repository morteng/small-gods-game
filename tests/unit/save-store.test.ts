import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  writeSave, readSave, clearSave, deleteSlot, probeSlots, slotCompat,
  appendJournal, readJournal, JOURNAL_COMPACT_ROWS, _journalRowCountForTesting,
  _resetSaveDbForTesting,
  type SaveSlot, type SaveMetaInput,
} from '@/services/save-store';
import { IDB_TIMEOUT_MS } from '@/services/idb-guard';
import { SAVE_VERSION, toSaveFileLive, applySaveFile, type SaveFile } from '@/core/save-file';
import { WORLD_CONTENT_VERSION } from '@/core/content-version';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';
import type { AppendedEvent } from '@/core/events';

function fakeSave(tick: number): SaveFile {
  return {
    version: SAVE_VERSION, contentVersion: WORLD_CONTENT_VERSION, savedAt: 1000,
    playtimeMs: 0, eventCursor: 0,
    worldSeed: { name: 'w' } as any, map: { width: 1, height: 1 } as any,
    biomeMap: null,
    snapshot: { tick, rng: [1, 2, 3, 4] as any, entities: [], activeEvents: [], spirits: [] },
    view: {} as any,
  };
}

function fakeMeta(over: Partial<SaveMetaInput> = {}): SaveMetaInput {
  return {
    name: 'Test Save', tick: 0, dateLabel: 'Day 1, morning', godTier: 'whisper',
    beliefMass: 1.5, playtimeMs: 60_000, thumbnail: null, ...over,
  };
}

function fakeEvent(id: number, t = 0): AppendedEvent {
  return { id, t, event: { type: 'power_depleted', spiritId: 'player' } };
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

  it('round-trips independently per slot (autosave / slot1 / slot2 / slot3)', async () => {
    const slots: SaveSlot[] = ['autosave', 'slot1', 'slot2', 'slot3'];
    for (const [i, slot] of slots.entries()) await writeSave(fakeSave(100 + i), slot);
    for (const [i, slot] of slots.entries()) {
      expect((await readSave(slot))?.snapshot.tick).toBe(100 + i);
    }
    // Deleting one slot never touches the others.
    await clearSave('slot2');
    expect(await readSave('slot2')).toBeNull();
    expect((await readSave('slot1'))?.snapshot.tick).toBe(101);
    expect((await readSave('slot3'))?.snapshot.tick).toBe(103);
  });
});

describe('save-store — meta + probeSlots', () => {
  beforeEach(() => { _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('probeSlots reads meta without ever deserializing a blob', async () => {
    const meta = fakeMeta({ name: 'My World', tick: 500 });
    await writeSave(fakeSave(500), 'slot1', meta, { events: [fakeEvent(1)], from: 0 });
    const rows = await probeSlots();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slot: 'slot1', version: SAVE_VERSION, contentVersion: WORLD_CONTENT_VERSION,
      name: 'My World', tick: 500, dateLabel: meta.dateLabel, godTier: meta.godTier,
      beliefMass: meta.beliefMass, playtimeMs: meta.playtimeMs, thumbnail: null,
      eventCursor: 1,
    });
  });

  it('probeSlots returns one row per written slot, empty for untouched ones', async () => {
    await writeSave(fakeSave(1), 'autosave', fakeMeta({ name: 'Auto' }), { events: [], from: 0 });
    await writeSave(fakeSave(2), 'slot1', fakeMeta({ name: 'Manual 1' }), { events: [], from: 0 });
    const rows = await probeSlots();
    expect(rows.map(r => r.slot).sort()).toEqual(['autosave', 'slot1']);
  });

  it('writeSave without meta/journal writes only the blob (probeSlots stays empty)', async () => {
    await writeSave(fakeSave(9), 'slot1');
    expect(await readSave('slot1')).not.toBeNull();
    expect(await probeSlots()).toEqual([]);
  });

  it('the blob, meta row, and journal delta land together — a slot with a blob always has meta', async () => {
    await writeSave(fakeSave(3), 'slot2', fakeMeta(), { events: [fakeEvent(1), fakeEvent(2)], from: 0 });
    expect(await readSave('slot2')).not.toBeNull();
    const rows = await probeSlots();
    expect(rows.find(r => r.slot === 'slot2')).toBeTruthy();
    expect(await readJournal('slot2')).toHaveLength(2);
  });
});

describe('slotCompat', () => {
  it('ok when version and contentVersion both match the current build', () => {
    expect(slotCompat({ version: SAVE_VERSION, contentVersion: WORLD_CONTENT_VERSION })).toBe('ok');
  });

  it('stale-save when the save SCHEMA moved on', () => {
    expect(slotCompat({ version: SAVE_VERSION - 1, contentVersion: WORLD_CONTENT_VERSION })).toBe('stale-save');
  });

  it('stale-world when only the WORLD CONTENT generator moved on', () => {
    expect(slotCompat({ version: SAVE_VERSION, contentVersion: WORLD_CONTENT_VERSION - 1 })).toBe('stale-world');
  });

  it('stale-save takes precedence when both are stale', () => {
    expect(slotCompat({ version: SAVE_VERSION - 1, contentVersion: WORLD_CONTENT_VERSION - 1 })).toBe('stale-save');
  });
});

describe('save-store — event journal', () => {
  beforeEach(() => { _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('appendJournal + readJournal round-trips a single batch', async () => {
    const events = [fakeEvent(1), fakeEvent(2), fakeEvent(3)];
    await appendJournal('slot1', events, 0);
    expect(await readJournal('slot1')).toEqual(events);
  });

  it('readJournal concatenates multiple batches in ascending `from` order', async () => {
    const batch1 = [fakeEvent(1), fakeEvent(2)];
    const batch2 = [fakeEvent(3), fakeEvent(4)];
    // Append out of chronological call order but correct `from` — the read
    // must still come back sorted by `from`, not by write order.
    await appendJournal('slot1', batch2, 2);
    await appendJournal('slot1', batch1, 0);
    expect(await readJournal('slot1')).toEqual([...batch1, ...batch2]);
  });

  it('readJournal(slot, upTo) filters to events at/under the cursor', async () => {
    await appendJournal('slot1', [fakeEvent(1), fakeEvent(2), fakeEvent(3)], 0);
    expect(await readJournal('slot1', 2)).toEqual([fakeEvent(1), fakeEvent(2)]);
  });

  it('appendJournal is a no-op for an empty batch', async () => {
    await appendJournal('slot1', [], 0);
    expect(await readJournal('slot1')).toEqual([]);
    expect(await _journalRowCountForTesting('slot1')).toBe(0);
  });

  it('journals for different slots never mix', async () => {
    await appendJournal('slot1', [fakeEvent(1)], 0);
    await appendJournal('slot2', [fakeEvent(1)], 0);
    expect(await readJournal('slot1')).toHaveLength(1);
    expect(await readJournal('slot2')).toHaveLength(1);
    await clearSave('slot1');
    expect(await readJournal('slot1')).toHaveLength(0);
    expect(await readJournal('slot2')).toHaveLength(1); // untouched
  });

  it('append many batches → compact → read: the event sequence is IDENTICAL and the row count collapses', async () => {
    const slot: SaveSlot = 'slot1';
    const all: AppendedEvent[] = [];
    let cursor = 0;
    const totalBatches = JOURNAL_COMPACT_ROWS + 5;
    for (let i = 0; i < totalBatches; i++) {
      const ev = fakeEvent(cursor + 1, cursor);
      // eslint-disable-next-line no-await-in-loop -- each append must observe the previous one's committed row count
      await appendJournal(slot, [ev], cursor);
      all.push(ev);
      cursor = ev.id;
    }
    const read = await readJournal(slot);
    expect(read).toEqual(all);
    // Compaction fires once the EXISTING row count exceeds JOURNAL_COMPACT_ROWS
    // (the (JOURNAL_COMPACT_ROWS+2)th append), collapsing everything so far
    // into one row; the remaining batches after that append normally again.
    const rows = await _journalRowCountForTesting(slot);
    expect(rows).toBe(totalBatches - JOURNAL_COMPACT_ROWS - 1);
    expect(rows).toBeLessThan(totalBatches);
  });

  it('the atomic writeSave path compacts identically to standalone appendJournal', async () => {
    const slot: SaveSlot = 'slot1';
    let cursor = 0;
    for (let i = 0; i < JOURNAL_COMPACT_ROWS + 2; i++) {
      const ev = fakeEvent(cursor + 1, cursor);
      // eslint-disable-next-line no-await-in-loop -- sequential cursor dependency
      await writeSave(fakeSave(i), slot, fakeMeta({ tick: i }), { events: [ev], from: cursor });
      cursor = ev.id;
    }
    const rows = await _journalRowCountForTesting(slot);
    expect(rows).toBeLessThan(JOURNAL_COMPACT_ROWS);
    const events = await readJournal(slot);
    expect(events).toHaveLength(JOURNAL_COMPACT_ROWS + 2);
    expect(events[events.length - 1].id).toBe(cursor);
  });
});

describe('deleteSlot / clearSave — removes all three stores together', () => {
  beforeEach(() => { _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('removes the blob, meta row, and journal rows in one call', async () => {
    const slot: SaveSlot = 'slot2';
    await writeSave(fakeSave(5), slot, fakeMeta(), { events: [fakeEvent(1)], from: 0 });
    expect(await readSave(slot)).not.toBeNull();
    expect((await probeSlots()).some(m => m.slot === slot)).toBe(true);
    expect(await readJournal(slot)).toHaveLength(1);

    await deleteSlot(slot);

    expect(await readSave(slot)).toBeNull();
    expect((await probeSlots()).some(m => m.slot === slot)).toBe(false);
    expect(await readJournal(slot)).toHaveLength(0);
  });

  it('deleteSlot is the same function as clearSave (game.ts calls clearSave() bare)', () => {
    expect(deleteSlot).toBe(clearSave);
  });
});

describe('IndexedDB schema upgrade v1 → v2', () => {
  beforeEach(() => { _resetSaveDbForTesting(); (globalThis as any).indexedDB = new IDBFactory(); });

  it('preserves an existing v1 `saves` row and adds save-meta/event-journal', async () => {
    const fdb = (globalThis as any).indexedDB as IDBFactory;
    // Simulate a browser that already has a v1 database (only the `saves`
    // store) — the ORIGINAL schema, before this slice.
    await new Promise<void>((resolve, reject) => {
      const req = fdb.open('small-gods-saves', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('saves', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put({ key: 'autosave', save: fakeSave(11) });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // The real module now opens at its current DB_VERSION — triggering the
    // upgrade path, which must ADD the new stores WITHOUT touching the
    // pre-existing `saves` row.
    const got = await readSave('autosave');
    expect(got?.snapshot.tick).toBe(11);

    // The new stores are live and usable post-upgrade.
    await writeSave(fakeSave(1), 'slot1', fakeMeta(), { events: [fakeEvent(1)], from: 0 });
    expect(await probeSlots()).toHaveLength(1);
    expect(await readJournal('slot1')).toHaveLength(1);
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

  it('probeSlots degrades to [] (never hangs, never throws) against a wedged store', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    const p = probeSlots();
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual([]);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('readJournal degrades to [] (a resume must load with a short annals strip, never fail)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    const p = readJournal('autosave');
    await vi.advanceTimersByTimeAsync(IDB_TIMEOUT_MS + 1);
    await expect(p).resolves.toEqual([]);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
