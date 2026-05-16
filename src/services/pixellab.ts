import type {
  PixelLabBalance,
  PixelLabCachedAsset,
  PixelLabGenerateOpts,
  PixelLabKeyStatus,
} from '@/core/types';

const API_BASE = 'https://api.pixellab.ai/v2';
const PALETTE_URL = '/sprites/palette/lpc-anchor.png';
const LS_KEY = 'smallgods.pixellab.apiKey';

const DB_NAME = 'smallgods.pixellab';
const DB_STORE = 'assets';
const DB_VERSION = 1;

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function cacheGet(key: string): Promise<PixelLabCachedAsset | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function cachePut(asset: PixelLabCachedAsset): Promise<void> {
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
  return JSON.stringify({
    v: RECIPE_V,
    prompt: opts.prompt,
    w: opts.width,
    h: opts.height,
    seed: opts.seed ?? 0,
    ...recipe,
  });
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
  const paletteB64 = await loadPaletteB64();
  return {
    description:   opts.prompt,
    image_size:    { width: opts.width, height: opts.height },
    no_background: true,
    outline: opts.outline ?? STYLE_RECIPE.outline,
    shading: opts.shading ?? STYLE_RECIPE.shading,
    detail:  opts.detail  ?? STYLE_RECIPE.detail,
    color_image: { type: 'base64', base64: paletteB64, format: 'png' },
    seed: opts.seed ?? 0,
  };
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
  const hit = await cacheGet(key);
  if (hit) return { blob: hit.blob, cached: true, key };

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
  await cachePut({
    key,
    blob,
    prompt: opts.prompt,
    width:  opts.width,
    height: opts.height,
    generatedAt: Date.now(),
  });
  return { blob, cached: false, key };
}

// Re-export so the UI / tests can poke at the cache directly.
export { cacheGet, cachePut, cacheClear };
