import type {
  AssetKind,
  AssetQuery,
  AssetSummary,
  LibraryAsset,
  PixelLabBalance,
  PixelLabGenerateOpts,
  PixelLabKeyStatus,
} from '@/core/types';

import { assetUrl } from '@/core/asset-url';
import { matchesAsset } from './asset-match';

const API_BASE = 'https://api.pixellab.ai/v2';
const PALETTE_URL = assetUrl('sprites/palette/lpc-anchor.png');
const LS_KEY = 'smallgods.pixellab.apiKey';

const DB_NAME = 'smallgods.pixellab';
const DB_STORE = 'assets';
const DB_VERSION = 3;

/**
 * Project-wide style recipe baked into every call. The palette swatch
 * (color_image) keeps generated assets coherent with the existing LPC art.
 */
const STYLE_RECIPE = {
  outline: 'single color black outline' as const,
  shading: 'basic shading' as const,
  detail: 'medium detail' as const,
};

let cachedPaletteB64: string | null = null;

async function loadPaletteB64(): Promise<string> {
  if (cachedPaletteB64) return cachedPaletteB64;
  const res = await fetch(PALETTE_URL);
  if (!res.ok) throw new Error(`palette swatch fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  cachedPaletteB64 = arrayBufferToBase64(buf);
  return cachedPaletteB64;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Normalize tags: lowercase, trim, dedupe (preserve first-occurrence order),
 *  drop empties. Called at write time so reads can be dumb. */
export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function base64ToBlob(b64: string, mime = 'image/png'): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── IndexedDB cache ──────────────────────────────────────────────────────────

/** Cached connection — reused across calls; closed by `_resetDbForTesting`. */
let _db: IDBDatabase | null = null;

/**
 * Test-only: close the cached DB connection so that tests can call
 * `indexedDB.deleteDatabase` without hitting a blocked state.
 * Not needed in production (the browser closes the connection on unload).
 */
export function _resetDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
}

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction!;
      const oldVersion = event.oldVersion;

      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        store = db.createObjectStore(DB_STORE, { keyPath: 'key' });
      } else {
        store = tx.objectStore(DB_STORE);
      }

      // v1 → v2: backfill metadata fields and add indexes
      if (oldVersion < 2) {
        // Backfill every existing record
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const v = cursor.value as Record<string, unknown>;
          // Only touch records that don't already have schemaVersion
          if (v.schemaVersion !== 2) {
            cursor.update({
              ...v,
              schemaVersion: 2,
              curated: 'pending',
              origin: 'sandbox',
              kind: 'unknown',
              tags: [],
            });
          }
          cursor.continue();
        };

        // Create new indexes
        if (!store.indexNames.contains('kind')) store.createIndex('kind', 'kind');
        if (!store.indexNames.contains('curated')) store.createIndex('curated', 'curated');
        if (!store.indexNames.contains('tags')) {
          store.createIndex('tags', 'tags', { multiEntry: true });
        }
      }

      // v2 → v3: backfill generation metadata
      if (oldVersion < 3) {
        const cur3 = store.openCursor();
        cur3.onsuccess = () => {
          const cursor = cur3.result;
          if (!cursor) return;
          const v = cursor.value as Record<string, unknown>;
          if (v.schemaVersion !== 3) {
            cursor.update({
              ...v,
              // v1 → v2 defaults (safe no-ops for records already at v2)
              curated: v.curated ?? 'pending',
              origin: v.origin ?? 'sandbox',
              kind: v.kind ?? 'unknown',
              tags: v.tags ?? [],
              // v2 → v3 fields
              schemaVersion: 3,
              provider: v.provider ?? 'pixellab',
              model: v.model ?? 'pixflux',
              style: v.style ?? 'pixel-art',
              recipeVersion: v.recipeVersion ?? RECIPE_V,
            });
          }
          cursor.continue();
        };
        if (!store.indexNames.contains('style')) store.createIndex('style', 'style');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<LibraryAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function cachePut(asset: LibraryAsset): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(asset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function cacheClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Key storage ──────────────────────────────────────────────────────────────

export function loadApiKey(): string | null {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}

export function saveApiKey(key: string): void {
  try { localStorage.setItem(LS_KEY, key); } catch { /* ignore */ }
}

export function clearApiKey(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

// ─── Cache key construction ───────────────────────────────────────────────────

/**
 * Canonical, stable string for hashing. Exposed for tests.
 *
 * Why a frozen recipe version: bumping `RECIPE_V` invalidates every cache
 * entry without needing to nuke IndexedDB by hand. Useful if we change the
 * palette swatch or style enums project-wide.
 */
export const RECIPE_V = 'v1';

export function buildCacheKeyInput(opts: PixelLabGenerateOpts): string {
  const recipe = {
    outline: opts.outline ?? STYLE_RECIPE.outline,
    shading: opts.shading ?? STYLE_RECIPE.shading,
    detail:  opts.detail  ?? STYLE_RECIPE.detail,
  };
  // Base fields (and their order) match the legacy key exactly so existing
  // vendored/cached assets keep resolving. New fields are appended only when
  // set — an unguided, default-recipe call hashes byte-identically to before.
  const base: Record<string, unknown> = {
    v: opts.recipeVersion ?? RECIPE_V,
    prompt: opts.prompt,
    w: opts.width,
    h: opts.height,
    seed: opts.seed ?? 0,
    ...recipe,
  };
  if (opts.initImage) base.init = 1;
  if (opts.initImageStrength !== undefined) base.initStrength = opts.initImageStrength;
  if (opts.paletteAnchors?.length) base.palette = opts.paletteAnchors.join(',');
  return JSON.stringify(base);
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchBalance(apiKey: string): Promise<PixelLabBalance> {
  const res = await fetch(`${API_BASE}/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`balance: HTTP ${res.status}`);
  const body = await res.json();
  return {
    generationsRemaining: body.subscription?.generations ?? 0,
    generationsTotal:     body.subscription?.total       ?? 0,
    creditsUsd:           body.credits?.usd              ?? 0,
  };
}

export async function verifyKey(apiKey: string): Promise<PixelLabKeyStatus> {
  if (!apiKey) return 'missing';
  try {
    await fetchBalance(apiKey);
    return 'valid';
  } catch {
    return 'invalid';
  }
}

/**
 * Build the create-image-pixflux request body with the project recipe baked in.
 * Exposed for tests.
 */
export async function buildRequestBody(opts: PixelLabGenerateOpts) {
  const body: Record<string, unknown> = {
    description:   opts.prompt,
    image_size:    { width: opts.width, height: opts.height },
    no_background: true,
    outline: opts.outline ?? STYLE_RECIPE.outline,
    shading: opts.shading ?? STYLE_RECIPE.shading,
    detail:  opts.detail  ?? STYLE_RECIPE.detail,
    seed: opts.seed ?? 0,
  };
  if (opts.initImage) {
    // img2img: the guidance image (rendered massing) carries projection,
    // footprint, door placement AND the material colours — so it doubles as
    // the palette anchor and we skip the generic LPC color_image.
    body.init_image = { type: 'base64', base64: opts.initImage, format: 'png' };
    body.init_image_strength = opts.initImageStrength ?? 500;
  } else {
    const paletteB64 = await loadPaletteB64();
    body.color_image = { type: 'base64', base64: paletteB64, format: 'png' };
  }
  return body;
}

/**
 * Generate a sprite via PixelLab Pixflux, with the project style recipe and
 * IndexedDB cache applied. Returns a PNG Blob.
 *
 * Returned object includes `cached: true` when the call hit IndexedDB and
 * never touched the network — useful for the UI to show a "cached" indicator.
 */
export interface GenerateResult {
  blob: Blob;
  cached: boolean;
  key: string;
}

export async function generate(
  apiKey: string,
  opts: PixelLabGenerateOpts,
): Promise<GenerateResult> {
  const key = await sha256Hex(buildCacheKeyInput(opts));
  const origin = opts.origin ?? 'sandbox';
  const hit = await cacheGet(key);

  if (hit) {
    // Promotion: if caller asked for official origin and the existing entry
    // is not yet kept, upgrade it in place with the caller's metadata.
    if (origin === 'official' && hit.curated !== 'kept') {
      const promoted: LibraryAsset = {
        ...hit,
        curated: 'kept',
        origin: 'official',
        kind: opts.kind ?? hit.kind,
        tags: opts.tags ? normalizeTags(opts.tags) : hit.tags,
        description: opts.description ?? hit.description,
        style: opts.style ?? hit.style ?? 'pixel-art',
        affinity: opts.affinity ?? hit.affinity,
      };
      await cachePut(promoted);
    }
    return { blob: hit.blob, cached: true, key };
  }

  const body = await buildRequestBody(opts);
  const res = await fetch(`${API_BASE}/create-image-pixflux`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`generate: HTTP ${res.status} ${text}`.trim());
  }
  const json = await res.json();
  const b64 = json?.image?.base64;
  if (!b64) throw new Error('generate: missing image.base64 in response');

  const blob = base64ToBlob(b64);
  const asset: LibraryAsset = {
    key,
    schemaVersion: 3,
    blob,
    prompt: opts.prompt,
    width: opts.width,
    height: opts.height,
    generatedAt: Date.now(),
    curated: origin === 'official' ? 'kept' : 'pending',
    origin,
    kind: opts.kind ?? 'unknown',
    tags: normalizeTags(opts.tags),
    description: opts.description,
    provider: 'pixellab',
    model: 'pixflux',
    style: opts.style ?? 'pixel-art',
    recipeVersion: RECIPE_V,
    affinity: opts.affinity,
  };
  await cachePut(asset);
  return { blob, cached: false, key };
}

/**
 * Library query. Returns only assets with `curated === 'kept'`, narrowed by
 * `kind` (required) and optional tag/size filters. Results are ordered
 * newest-first by `generatedAt`. Default limit 16.
 */
export async function findAssets(q: AssetQuery): Promise<AssetSummary[]> {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  const index = store.index('kind');

  return new Promise<AssetSummary[]>((resolve, reject) => {
    const matches: LibraryAsset[] = [];
    const limit = q.limit ?? 16;
    const req = index.openCursor(IDBKeyRange.only(q.kind));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        // Sort newest-first, then slice to limit, then project to summary
        matches.sort((a, b) => b.generatedAt - a.generatedAt);
        resolve(matches.slice(0, limit).map(toSummary));
        return;
      }
      const a = cursor.value as LibraryAsset;
      if (passesFilters(a, q)) matches.push(a);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** All kept assets of a kind, newest-first, with full v3 metadata. Unlike
 *  findAssets() this applies no tag/size filtering — callers (AssetLibrary)
 *  filter via asset-match. */
export async function listKeptSummaries(kind: AssetKind): Promise<AssetSummary[]> {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, 'readonly');
  const index = tx.objectStore(DB_STORE).index('kind');
  return new Promise<AssetSummary[]>((resolve, reject) => {
    const matches: LibraryAsset[] = [];
    const req = index.openCursor(IDBKeyRange.only(kind));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        matches.sort((a, b) => b.generatedAt - a.generatedAt);
        resolve(matches.map(toSummary));
        return;
      }
      const a = cursor.value as LibraryAsset;
      if (a.curated === 'kept') matches.push(a);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function passesFilters(a: LibraryAsset, q: AssetQuery): boolean {
  if (a.curated !== 'kept') return false;
  if (!matchesAsset(
    { kind: a.kind, style: a.style ?? 'pixel-art', model: a.model ?? 'pixflux',
      provider: a.provider ?? 'pixellab', tags: a.tags, affinity: a.affinity,
      width: a.width, height: a.height },
    { kind: q.kind, style: q.style ?? (a.style ?? 'pixel-art'),
      model: q.model, provider: q.provider, size: q.size },
  )) return false;
  if (q.tagsAll && !q.tagsAll.every(t => a.tags.includes(t))) return false;
  if (q.tagsAny && !q.tagsAny.some(t => a.tags.includes(t))) return false;
  return true;
}

function toSummary(a: LibraryAsset): AssetSummary {
  return {
    id: a.key,
    kind: a.kind,
    tags: a.tags,
    prompt: a.prompt,
    description: a.description,
    width: a.width,
    height: a.height,
    addedAt: a.generatedAt,
    style: a.style ?? 'pixel-art',
    model: a.model ?? 'pixflux',
    provider: a.provider ?? 'pixellab',
    affinity: a.affinity,
  };
}

/** Resolve an asset id (= LibraryAsset.key) to its blob, or null if missing. */
export async function getAssetBlob(id: string): Promise<Blob | null> {
  const entry = await cacheGet(id);
  return entry?.blob ?? null;
}

// ─── Curation actions ─────────────────────────────────────────────────────────

/** Read-modify-write a single asset. No-op if id is unknown. */
async function patchAsset(id: string, patch: Partial<LibraryAsset>): Promise<void> {
  const existing = await cacheGet(id);
  if (!existing) return;
  await cachePut({ ...existing, ...patch });
}

/** Mark an asset as kept (queryable by `findAssets`). No-op if id unknown. */
export async function markAssetKept(id: string): Promise<void> {
  await patchAsset(id, { curated: 'kept' });
}

/** Mark an asset as rejected (excluded from `findAssets`). No-op if id unknown. */
export async function markAssetRejected(id: string): Promise<void> {
  await patchAsset(id, { curated: 'rejected' });
}

/**
 * Patch caller-facing metadata. Any provided field is overwritten; omitted
 * fields are unchanged. Tags are re-normalized.
 */
export async function updateAssetMetadata(
  id: string,
  patch: Partial<Pick<LibraryAsset, 'kind' | 'tags' | 'description'>>,
): Promise<void> {
  const normalized: Partial<LibraryAsset> = { ...patch };
  if (patch.tags !== undefined) normalized.tags = normalizeTags(patch.tags);
  await patchAsset(id, normalized);
}

/** Diagnostic / dev-tool helper: list every asset (any curation status),
 *  ordered newest-first. Returns full LibraryAsset records (including blob). */
export async function listRecentAssets(limit = 20): Promise<LibraryAsset[]> {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  return new Promise<LibraryAsset[]>((resolve, reject) => {
    const out: LibraryAsset[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        out.sort((a, b) => b.generatedAt - a.generatedAt);
        resolve(out.slice(0, limit));
        return;
      }
      out.push(cursor.value as LibraryAsset);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// Re-export so the UI / tests can poke at the cache directly.
export { cacheGet, cachePut, cacheClear };
