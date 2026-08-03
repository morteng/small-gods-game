import type { SaveFile } from '@/core/save-file';
import { SAVE_VERSION } from '@/core/save-file';
import { WORLD_CONTENT_VERSION } from '@/core/content-version';
import type { AppendedEvent } from '@/core/events';
// Boot awaits readSave(), so an un-guarded open against a wedged IDB store
// would hang the whole game on the loading screen — every operation here
// races the guard and degrades (fresh world / dropped autosave) instead.
import { withIdbTimeout } from '@/services/idb-guard';

/** Per-browser game save store: FOUR independent slots (autosave + 3 manual),
 *  each with a blob (`saves`), a small probeable summary (`save-meta`), and an
 *  incremental event history (`event-journal`). Mirrors the IndexedDB pattern
 *  in sprite-library.ts. */

export type SaveSlot = 'autosave' | 'slot1' | 'slot2' | 'slot3';

/** Every slot, in the canonical order every listing UI (title CONTINUE probe,
 *  the save/load screens) shows them: autosave first, then the three manual
 *  slots in number order. One definition so a screen's "4 tiles" and a
 *  probe's "4 rows" can never silently drift apart. */
export const SAVE_SLOTS: readonly SaveSlot[] = ['autosave', 'slot1', 'slot2', 'slot3'];

const DB_NAME = 'small-gods-saves';
// v1 → v2: added `save-meta` + `event-journal` alongside the original `saves`
// store. `openDb`'s upgrade path only ADDS stores (guarded by
// `objectStoreNames.contains`) — an existing v1 database's `saves` content
// (a browser's real autosave) survives the upgrade untouched.
const DB_VERSION = 2;
const DB_STORE = 'saves';
const META_STORE = 'save-meta';
const JOURNAL_STORE = 'event-journal';
const DEFAULT_SLOT: SaveSlot = 'autosave';

/** When a slot's journal row count reaches this, the next write compacts
 *  every existing row (plus the new delta) into ONE row instead of appending
 *  another — bounds journal read cost (`readJournal` concatenates every row)
 *  without ever losing history. */
export const JOURNAL_COMPACT_ROWS = 64;

interface StoredSave { key: string; save: SaveFile; }

/** `save-meta` row — everything the load/title screens need to draw a slot
 *  tile WITHOUT deserializing its ~171k-tile blob (see `probeSlots`). */
export interface SaveMeta {
  slot: SaveSlot;
  version: number;
  contentVersion: number;
  savedAt: number;
  name: string;
  tick: number;
  /** In-world date, prebuilt by the caller — the UI never renders a raw tick. */
  dateLabel: string;
  godTier: string;
  beliefMass: number;
  /** Real playtime (ms), mirrors `SaveFile.playtimeMs`. */
  playtimeMs: number;
  /** 320×180 JPEG data URL, or null if no thumbnail was captured. */
  thumbnail: string | null;
  /** Journal high-water mark, mirrors `SaveFile.eventCursor`. */
  eventCursor: number;
}

/** The subset of `SaveMeta` the caller must supply per write — everything
 *  else (`slot`, `version`, `contentVersion`, `savedAt`, `eventCursor`) is
 *  derived from the `SaveFile` blob and the journal delta being written. */
export interface SaveMetaInput {
  name: string;
  tick: number;
  dateLabel: string;
  godTier: string;
  beliefMass: number;
  playtimeMs: number;
  thumbnail: string | null;
}

export type SlotCompat = 'ok' | 'stale-save' | 'stale-world';

/** Compatibility verdict computed from a meta row ALONE (no blob read) —
 *  `'stale-save'` when the save schema (`SAVE_VERSION`) moved on, distinct
 *  from `'stale-world'` when only the world-content generator did. The
 *  load/title screens show the reason and offer Delete rather than silently
 *  regenerating over a slot. */
export function slotCompat(meta: Pick<SaveMeta, 'version' | 'contentVersion'>): SlotCompat {
  if (meta.version !== SAVE_VERSION) return 'stale-save';
  if (meta.contentVersion !== WORLD_CONTENT_VERSION) return 'stale-world';
  return 'ok';
}

/** `event-journal` row: one batch of events appended since the slot's
 *  previous write. `readJournal` concatenates rows in `from` order. */
interface JournalRow {
  slot: SaveSlot;
  from: number;
  to: number;
  events: AppendedEvent[];
}

let _db: IDBDatabase | null = null;

// ── Wedged-store circuit breaker ─────────────────────────────────────────────
// A genuinely wedged backing store (corrupt LevelDB lock, browser killed
// mid-write) makes EVERY op time out at IDB_TIMEOUT_MS. Left alone, autosave
// then hammers it every few seconds — each attempt a 4s pending promise plus a
// duplicate console warning — which both spams the log and was corrupting perf
// measurements. After a couple of consecutive timeouts we trip the breaker:
// further ops short-circuit (autosave silently no-ops, reads return null/[])
// and the game runs from memory for the rest of the session. One successful op
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
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'slot' });
      }
      if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
        db.createObjectStore(JOURNAL_STORE, { keyPath: ['slot', 'from'] });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  }), 'open');
}

/** A slot's journal rows, as an `IDBKeyRange` over the compound `[slot, from]`
 *  key — array keys compare lexicographically element-by-element, so bounding
 *  the first element to `slot` and the second to the full number range
 *  selects exactly that slot's rows regardless of how many `from` values exist. */
function slotJournalRange(slot: SaveSlot): IDBKeyRange {
  return IDBKeyRange.bound([slot, -Infinity], [slot, Infinity]);
}

/** Mutate the journal store (must already be inside an active `readwrite`
 *  transaction covering `JOURNAL_STORE`) with a new delta for `slot`,
 *  compacting when the existing row count is already at/over
 *  `JOURNAL_COMPACT_ROWS`. Shared by `appendJournal` (its own transaction) and
 *  `writeSave` (the blob+meta+journal transaction) so both paths compact
 *  identically. No-op for an empty batch — a manual `flush()`/`saveNow()`
 *  with no new events since the last write owes the journal nothing. */
function putJournalDelta(store: IDBObjectStore, slot: SaveSlot, events: AppendedEvent[], from: number): void {
  if (events.length === 0) return;
  const to = events[events.length - 1].id;
  const getReq = store.getAll(slotJournalRange(slot));
  getReq.onsuccess = () => {
    const rows = (getReq.result as JournalRow[] | undefined) ?? [];
    if (rows.length > JOURNAL_COMPACT_ROWS) {
      // Compact: every existing row for this slot PLUS the new delta collapse
      // into one row spanning the slot's full history, keyed at the earliest
      // `from` — the old per-batch rows are deleted so the row count drops
      // back to 1 instead of growing without bound.
      const merged = rows.flatMap(r => r.events).concat(events);
      const minFrom = rows.reduce((m, r) => Math.min(m, r.from), from);
      for (const r of rows) store.delete([slot, r.from]);
      store.put({ slot, from: minFrom, to, events: merged } satisfies JournalRow);
    } else {
      store.put({ slot, from, to, events } satisfies JournalRow);
    }
  };
  // getReq.onerror is intentionally unhandled here: an IDB request error
  // bubbles to the owning transaction's onerror (aborting it) unless
  // preventDefault'd, which is exactly the "fail the whole write" behavior
  // writeSave/appendJournal want — their tx.onerror already rejects the promise.
}

/**
 * Persist a save under `slot`. Accepts either a ready SaveFile or a FACTORY —
 * pass a factory building a live-reference save (`toSaveFileLive`) so the
 * expensive deep copy is paid ONCE: the factory runs synchronously right before
 * `put()`, and `put()` structured-clones its argument synchronously in the same
 * task, so the captured state is atomic even though the save aliases live
 * objects (no sim tick can interleave).
 *
 * When `meta`/`journal` are supplied, the blob, its `save-meta` row, AND the
 * journal delta all land in ONE IndexedDB transaction across the three
 * stores. This atomicity matters: without it, a crash between separate
 * transactions could leave a slot LISTED (meta present) with no blob, or with
 * a meta `eventCursor` stamped past history that was never actually
 * journaled — either way, `probeSlots`/`readJournal` would then lie. Omitting
 * `meta`/`journal` (as the plain round-trip tests below do) just writes the
 * blob, matching the pre-P3a behavior.
 */
export async function writeSave(
  save: SaveFile | (() => SaveFile),
  slot: SaveSlot = DEFAULT_SLOT,
  meta?: SaveMetaInput,
  journal?: { events: AppendedEvent[]; from: number },
): Promise<void> {
  if (!hasIdb() || wedged) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction([DB_STORE, META_STORE, JOURNAL_STORE], 'readwrite');
      const value = typeof save === 'function' ? save() : save;
      tx.objectStore(DB_STORE).put({ key: slot, save: value } satisfies StoredSave);

      if (meta) {
        const eventCursor = journal && journal.events.length > 0
          ? journal.events[journal.events.length - 1].id
          : (journal?.from ?? value.eventCursor);
        const metaRow: SaveMeta = {
          slot, version: value.version, contentVersion: value.contentVersion, savedAt: value.savedAt,
          name: meta.name, tick: meta.tick, dateLabel: meta.dateLabel, godTier: meta.godTier,
          beliefMass: meta.beliefMass, playtimeMs: meta.playtimeMs, thumbnail: meta.thumbnail,
          eventCursor,
        };
        tx.objectStore(META_STORE).put(metaRow);
      }
      if (journal) putJournalDelta(tx.objectStore(JOURNAL_STORE), slot, journal.events, journal.from);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'write');
    noteSuccess();
  } catch (err) {
    noteFailure('write', err);
  }
}

export async function readSave(slot: SaveSlot = DEFAULT_SLOT): Promise<SaveFile | null> {
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

/**
 * Every slot's `save-meta` row — the ONLY thing the load/title screens read
 * to draw four tiles. Deliberately never touches `DB_STORE`: a `SaveFile`
 * blob is ~171k tiles, so deserializing four of them just to draw a menu is
 * unacceptable (see the module doc). Degrades to `[]` (never throws) on a
 * wedged store — the title screen just shows no slots rather than hanging.
 */
export async function probeSlots(): Promise<SaveMeta[]> {
  if (!hasIdb() || wedged) return [];
  try {
    const db = await openDb();
    const metas = await withIdbTimeout(new Promise<SaveMeta[]>((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).getAll();
      req.onsuccess = () => resolve((req.result as SaveMeta[] | undefined) ?? []);
      req.onerror = () => reject(req.error);
    }), 'probe');
    noteSuccess();
    return metas;
  } catch (err) {
    noteFailure('probe', err);
    return [];
  }
}

/**
 * Append one journal row for `slot` (its own transaction — for the atomic
 * blob+meta+journal write in the same transaction, see `writeSave`'s
 * `journal` parameter instead). No-op on an empty batch.
 */
export async function appendJournal(slot: SaveSlot, events: AppendedEvent[], from: number): Promise<void> {
  if (!hasIdb() || wedged || events.length === 0) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JOURNAL_STORE, 'readwrite');
      putJournalDelta(tx.objectStore(JOURNAL_STORE), slot, events, from);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'journal-append');
    noteSuccess();
  } catch (err) {
    noteFailure('journal-append', err);
  }
}

/**
 * Concatenate a slot's journal rows in ascending `from` order into one event
 * array, optionally filtered to `id <= upTo` (pass `save.eventCursor` to
 * reconstruct exactly the history a given blob was saved with). A read
 * failure (wedged store, timeout) degrades to `[]` — NEVER throws — so a
 * resume still loads the world; only the annals strip comes back short.
 */
export async function readJournal(slot: SaveSlot, upTo?: number): Promise<AppendedEvent[]> {
  if (!hasIdb() || wedged) return [];
  try {
    const db = await openDb();
    const rows = await withIdbTimeout(new Promise<JournalRow[]>((resolve, reject) => {
      const tx = db.transaction(JOURNAL_STORE, 'readonly');
      const req = tx.objectStore(JOURNAL_STORE).getAll(slotJournalRange(slot));
      req.onsuccess = () => resolve((req.result as JournalRow[] | undefined) ?? []);
      req.onerror = () => reject(req.error);
    }), 'journal-read');
    noteSuccess();
    rows.sort((a, b) => a.from - b.from);
    const events = rows.flatMap(r => r.events);
    return upTo === undefined ? events : events.filter(e => e.id <= upTo);
  } catch (err) {
    noteFailure('journal-read', err);
    return [];
  }
}

/** Test-only: raw journal row count for `slot`, to assert compaction actually
 *  collapsed rows without reading through the (identical either way) event
 *  sequence `readJournal` returns. */
export async function _journalRowCountForTesting(slot: SaveSlot): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(JOURNAL_STORE, 'readonly');
    const req = tx.objectStore(JOURNAL_STORE).count(slotJournalRange(slot));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Remove a slot's blob, meta row, and every journal row — one transaction
 *  across all three stores, so a delete can never leave a partial slot
 *  behind (a meta row with no blob, or orphaned history). */
export async function clearSave(slot: SaveSlot = DEFAULT_SLOT): Promise<void> {
  if (!hasIdb() || wedged) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction([DB_STORE, META_STORE, JOURNAL_STORE], 'readwrite');
      tx.objectStore(DB_STORE).delete(slot);
      tx.objectStore(META_STORE).delete(slot);
      const journalStore = tx.objectStore(JOURNAL_STORE);
      const cursorReq = journalStore.openCursor(slotJournalRange(slot));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'clear');
    noteSuccess();
  } catch (err) {
    noteFailure('clear', err);
  }
}

/** Alias for `clearSave` — the P3a spec's public name for "delete a slot
 *  entirely" (blob + meta + journal). Kept alongside `clearSave` because
 *  `game.ts`'s `newWorld()` already calls the bare `clearSave()` form. */
export const deleteSlot = clearSave;
