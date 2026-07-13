import type { SaveFile } from '@/core/save-file';
// Boot awaits readSave(), so an un-guarded open against a wedged IDB store
// would hang the whole game on the loading screen — every operation here
// races the guard and degrades (fresh world / dropped autosave) instead.
import { withIdbTimeout } from '@/services/idb-guard';

/** Per-browser game autosave store. Single object store keyed by slot name;
 *  v1 uses one slot ('autosave'). Mirrors the IndexedDB pattern in pixellab.ts. */

const DB_NAME = 'small-gods-saves';
const DB_VERSION = 1;
const DB_STORE = 'saves';
const DEFAULT_SLOT = 'autosave';

interface StoredSave { key: string; save: SaveFile; }

let _db: IDBDatabase | null = null;

// ── Wedged-store circuit breaker ─────────────────────────────────────────────
// A genuinely wedged backing store (corrupt LevelDB lock, browser killed
// mid-write) makes EVERY op time out at IDB_TIMEOUT_MS. Left alone, autosave
// then hammers it every few seconds — each attempt a 4s pending promise plus a
// duplicate console warning — which both spams the log and was corrupting perf
// measurements. After a couple of consecutive timeouts we trip the breaker:
// further ops short-circuit (autosave silently no-ops, reads return null) and
// the game runs from memory for the rest of the session. One successful op
// resets it. Non-destructive — we never auto-delete the store (clearSave /
// newWorld remain the explicit recovery path).
const WEDGE_THRESHOLD = 2;
let consecutiveFailures = 0;
let wedged = false;

function noteFailure(op: string, err: unknown): void {
  consecutiveFailures++;
  // Drop the cached connection so the next attempt re-opens (recovers a merely
  // stale connection; a truly wedged store will just trip the breaker below).
  if (_db) { try { _db.close(); } catch { /* ignore */ } _db = null; }
  if (!wedged && consecutiveFailures >= WEDGE_THRESHOLD) {
    wedged = true;
    console.warn(
      `[save-store] backing store appears wedged after ${consecutiveFailures} failed ${op} ops — ` +
      `autosave disabled for this session (state kept in memory). Reload to retry.`,
      err,
    );
  } else if (!wedged) {
    console.warn(`[save-store] ${op} failed:`, err);
  }
}

function noteSuccess(): void {
  if (wedged) console.info('[save-store] backing store recovered — autosave re-enabled.');
  consecutiveFailures = 0;
  wedged = false;
}

/** Test-only: drop the cached connection so a fresh IDBFactory is picked up. */
export function _resetSaveDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
  consecutiveFailures = 0;
  wedged = false;
}

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return withIdbTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  }), 'open');
}

/**
 * Persist a save under `slot`. Accepts either a ready SaveFile or a FACTORY —
 * pass a factory building a live-reference save (`toSaveFileLive`) so the
 * expensive deep copy is paid ONCE: the factory runs synchronously right before
 * `put()`, and `put()` structured-clones its argument synchronously in the same
 * task, so the captured state is atomic even though the save aliases live
 * objects (no sim tick can interleave).
 */
export async function writeSave(
  save: SaveFile | (() => SaveFile), slot: string = DEFAULT_SLOT,
): Promise<void> {
  if (!hasIdb() || wedged) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const value = typeof save === 'function' ? save() : save;
      tx.objectStore(DB_STORE).put({ key: slot, save: value } satisfies StoredSave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'write');
    noteSuccess();
  } catch (err) {
    noteFailure('write', err);
  }
}

export async function readSave(slot: string = DEFAULT_SLOT): Promise<SaveFile | null> {
  if (!hasIdb() || wedged) return null;
  try {
    const db = await openDb();
    const result = await withIdbTimeout(new Promise<SaveFile | null>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(slot);
      req.onsuccess = () => resolve((req.result as StoredSave | undefined)?.save ?? null);
      req.onerror = () => reject(req.error);
    }), 'read');
    noteSuccess();
    return result;
  } catch (err) {
    noteFailure('read', err);
    return null;
  }
}

export async function clearSave(slot: string = DEFAULT_SLOT): Promise<void> {
  if (!hasIdb() || wedged) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'clear');
    noteSuccess();
  } catch (err) {
    noteFailure('clear', err);
  }
}
