// Persistent IndexedDB cache of generated NPC sprite sheets (PNG strip blobs),
// keyed by clip + facing + wardrobe layer-set identity + recipe version + model.
// Mirrors generated-art-cache.ts (buildings), but a DISTINCT database: an NPC
// sheet's identity (a wardrobe spec hash, not a blueprint) and its stored shape
// (a multi-frame strip, no PBR companion maps — see npc-sprite-pipeline.ts's
// header on why there is nothing to light with here) don't fit the building
// schema, and keeping the stores apart means a schema change on one side never
// touches the other's data.
import { NPC_ART_RECIPE_VERSION } from '@/core/content-version';
// A wedged IDB store must not stall the art pipeline: a hung read here would
// otherwise block the fall-through to the vendored base library forever.
// Guarded ops reject after 4s; callers already degrade on error.
import { withIdbTimeout } from '@/services/idb-guard';

const DB_NAME = 'small-gods-generated-npc-art';
const DB_VERSION = 1;
const DB_STORE = 'npc-sheets';

export interface GeneratedNpcArtRecord {
  key: string; blob: Blob; recipeVersion: string; model: string; prompt: string;
  frameCount: number; cellW: number; cellH: number; createdAt: number;
  // NEGATIVE marker: this request generated but failed the quality gate at this
  // recipe+model, so future loads skip it instead of re-paying (the same leak
  // the building cache closes). No usable art rides along (empty `blob`). Keyed
  // by recipe+model, so a recipe bump or model switch retries automatically.
  failed?: boolean;
}

/** A generated NPC sheet: the assembled strip PNG plus what's needed to slice
 *  it back into frames (`sliceStrip`, npc-sprite-pipeline.ts). */
export interface GeneratedNpcArt {
  blob: Blob; frameCount: number; cellW: number; cellH: number;
}

let _db: IDBDatabase | null = null;
export function _resetGeneratedNpcArtDbForTesting(): void { if (_db) { _db.close(); _db = null; } }
function hasIdb(): boolean { return typeof indexedDB !== 'undefined' && indexedDB !== null; }

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return withIdbTimeout(new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  }), 'open');
}

/**
 * Stable string key: recipe version + model + clip + facing + wardrobe
 * layer-set hash. Every one of those is load-bearing (see the header of
 * `generated-npc-art-source.ts`) — a key that omitted one would serve art made
 * under rules that no longer hold, or hand one character's redress to another.
 * No hashing needed (unlike the building key's blueprint JSON): every input
 * here is already a short, stable identifier.
 */
export function generatedNpcArtKey(
  clip: string, facing: string, layerSetHash: string, model: string,
  recipeVersion: string = NPC_ART_RECIPE_VERSION,
): string {
  return `${recipeVersion}:${model}:${clip}:${facing}:${layerSetHash}`;
}

export async function readGeneratedNpcArt(key: string): Promise<GeneratedNpcArt | null> {
  if (!hasIdb()) return null;
  try {
    const db = await openDb();
    return await withIdbTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => {
        const r = req.result as GeneratedNpcArtRecord | undefined;
        resolve(r && r.recipeVersion === NPC_ART_RECIPE_VERSION && !r.failed
          ? { blob: r.blob, frameCount: r.frameCount, cellW: r.cellW, cellH: r.cellH }
          : null);
      };
      req.onerror = () => reject(req.error);
    }), 'read');
  } catch (err) { console.warn('[generated-npc-art-cache] read failed:', err); return null; }
}

/**
 * True when `key` carries a NEGATIVE marker at the current recipe version: a
 * prior session generated this sheet but it failed the quality gate, so the
 * caller should skip it rather than re-pay. Self-invalidates on a recipe/model
 * bump (the key embeds both, so a different recipe/model simply misses this
 * record).
 */
export async function isGeneratedNpcArtFailed(key: string): Promise<boolean> {
  if (!hasIdb()) return false;
  try {
    const db = await openDb();
    return await withIdbTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => {
        const r = req.result as GeneratedNpcArtRecord | undefined;
        resolve(!!(r && r.failed && r.recipeVersion === NPC_ART_RECIPE_VERSION));
      };
      req.onerror = () => reject(req.error);
    }), 'read');
  } catch (err) { console.warn('[generated-npc-art-cache] failed-check failed:', err); return false; }
}

/**
 * Persist a NEGATIVE marker so a sheet that failed its quality gate is not
 * re-paid on every reload. Stamped with the current recipe version + model, so
 * a recipe bump or model switch retries it automatically.
 */
export async function writeGeneratedNpcArtFailure(key: string, model: string): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        key, blob: new Blob(), recipeVersion: NPC_ART_RECIPE_VERSION, model,
        prompt: '', frameCount: 0, cellW: 0, cellH: 0, createdAt: 0, failed: true,
      } satisfies GeneratedNpcArtRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'write');
  } catch (err) { console.warn('[generated-npc-art-cache] failure-write failed:', err); }
}

export async function writeGeneratedNpcArt(
  key: string, blob: Blob,
  meta: { model: string; prompt: string; frameCount: number; cellW: number; cellH: number },
): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        key, blob, recipeVersion: NPC_ART_RECIPE_VERSION, model: meta.model, prompt: meta.prompt,
        frameCount: meta.frameCount, cellW: meta.cellW, cellH: meta.cellH, createdAt: 0,
      } satisfies GeneratedNpcArtRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'write');
  } catch (err) { console.warn('[generated-npc-art-cache] write failed:', err); }
}

export async function clearGeneratedNpcArt(): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'clear');
  } catch (err) { console.warn('[generated-npc-art-cache] clear failed:', err); }
}
