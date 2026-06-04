import type { SaveFile } from '@/core/save-file';

/** Per-browser game autosave store. Single object store keyed by slot name;
 *  v1 uses one slot ('autosave'). Mirrors the IndexedDB pattern in pixellab.ts. */

const DB_NAME = 'small-gods-saves';
const DB_VERSION = 1;
const DB_STORE = 'saves';
const DEFAULT_SLOT = 'autosave';

interface StoredSave { key: string; save: SaveFile; }

let _db: IDBDatabase | null = null;

/** Test-only: drop the cached connection so a fresh IDBFactory is picked up. */
export function _resetSaveDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
}

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

export async function writeSave(save: SaveFile, slot: string = DEFAULT_SLOT): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ key: slot, save } satisfies StoredSave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[save-store] writeSave failed:', err);
  }
}

export async function readSave(slot: string = DEFAULT_SLOT): Promise<SaveFile | null> {
  if (!hasIdb()) return null;
  try {
    const db = await openDb();
    return await new Promise<SaveFile | null>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(slot);
      req.onsuccess = () => resolve((req.result as StoredSave | undefined)?.save ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[save-store] readSave failed:', err);
    return null;
  }
}

export async function clearSave(slot: string = DEFAULT_SLOT): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[save-store] clearSave failed:', err);
  }
}
