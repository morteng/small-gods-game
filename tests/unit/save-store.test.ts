import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { writeSave, readSave, clearSave, _resetSaveDbForTesting } from '@/services/save-store';
import type { SaveFile } from '@/core/save-file';

function fakeSave(tick: number): SaveFile {
  return {
    version: 1, savedAt: 1000, worldSeed: { name: 'w' } as any, map: { width: 1, height: 1 } as any,
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
