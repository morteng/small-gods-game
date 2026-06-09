// Persistent IndexedDB cache of generated building sprites (PNG blobs), keyed by
// blueprint identity + recipe version + model. Shared across worlds so each
// unique building is generated once, ever. Mirrors src/services/save-store.ts.
import { ART_RECIPE_VERSION } from '@/core/content-version';

const DB_NAME = 'small-gods-generated-art';
const DB_VERSION = 1;
const DB_STORE = 'building-sprites';

export interface GeneratedArtRecord {
  key: string; blob: Blob; recipeVersion: string; model: string; prompt: string; targetWidth: number; createdAt: number;
  // Companion sprite data co-registered with the albedo `blob`, captured from the
  // parametric model at generation time. Not consumed by the current Canvas2D
  // renderer — stored for the future normal-lit renderer (Track R) and door/vent
  // pathing. Optional so pre-v3 / albedo-only records still validate.
  normal?: Blob; anchors?: string;
}

/** A generated building sprite + its co-registered companion data. */
export interface GeneratedArt { blob: Blob; targetWidth: number; normal?: Blob; anchors?: string }

let _db: IDBDatabase | null = null;
export function _resetGeneratedArtDbForTesting(): void { if (_db) { _db.close(); _db = null; } }
function hasIdb(): boolean { return typeof indexedDB !== 'undefined' && indexedDB !== null; }

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

/** Stable string key: recipe version + model id + djb2 hash of blueprint identity. */
export function generatedArtKey(rbJson: string, model: string): string {
  return `${ART_RECIPE_VERSION}:${model}:${djb2(rbJson)}`;
}
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function readGeneratedArt(key: string): Promise<GeneratedArt | null> {
  if (!hasIdb()) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => {
        const r = req.result as GeneratedArtRecord | undefined;
        resolve(r && r.recipeVersion === ART_RECIPE_VERSION
          ? { blob: r.blob, targetWidth: r.targetWidth, normal: r.normal, anchors: r.anchors }
          : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) { console.warn('[generated-art-cache] read failed:', err); return null; }
}

export async function writeGeneratedArt(
  key: string, blob: Blob,
  meta: { model: string; prompt: string; targetWidth: number; normal?: Blob; anchors?: string },
): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        key, blob, recipeVersion: ART_RECIPE_VERSION, model: meta.model, prompt: meta.prompt,
        targetWidth: meta.targetWidth, createdAt: 0, normal: meta.normal, anchors: meta.anchors,
      } satisfies GeneratedArtRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) { console.warn('[generated-art-cache] write failed:', err); }
}

export async function clearGeneratedArt(): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) { console.warn('[generated-art-cache] clear failed:', err); }
}
