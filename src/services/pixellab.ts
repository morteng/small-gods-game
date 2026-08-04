/**
 * The PixelLab backend: everything provider-SPECIFIC about talking to
 * api.pixellab.ai — request shape, style enums, its own cache-key recipe, key
 * and balance management.
 *
 * The asset store it used to contain now lives in `sprite-library.ts`, which is
 * provider-neutral; this file depends on it, never the reverse. Nothing here
 * may leak into the library (spec contract 3: no provider-specific field
 * escapes its backend).
 */
import type {
  LibraryAsset,
  PixelLabBalance,
  PixelLabGenerateOpts,
  PixelLabKeyStatus,
} from '@/core/types';

import { assetUrl } from '@/core/asset-url';
import { getPixellabApiKey, setPixellabApiKey, clearPixellabApiKey } from './settings-store';
import { cacheGet, cachePut, normalizeTags } from './sprite-library';

const API_BASE = 'https://api.pixellab.ai/v2';

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
  // Resolved lazily, not at module scope: `assetUrl` reads Vite's
  // `import.meta.env.BASE_URL`, which does not exist when this module is
  // reached from a plain Node/tsx import graph (the author-time seeders route
  // through `backend-registry.ts`, which imports this file for the PixelLab
  // provider even when a run never selects it) — only the CALL was ever
  // browser-only, not the import.
  const res = await fetch(assetUrl('sprites/palette/lpc-anchor.png'));
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

// ─── Key storage ──────────────────────────────────────────────────────────────

export function loadApiKey(): string | null {
  return getPixellabApiKey();
}

export function saveApiKey(key: string): void {
  setPixellabApiKey(key);
}

export function clearApiKey(): void {
  clearPixellabApiKey();
}

// ─── Cache key construction ───────────────────────────────────────────────────

/**
 * Canonical, stable string for hashing. Exposed for tests.
 *
 * Why a frozen recipe version: bumping `RECIPE_V` invalidates every cache
 * entry without needing to nuke IndexedDB by hand. Useful if we change the
 * palette swatch or style enums project-wide. Scoped to THIS backend — other
 * backends key their own way; the library only stores the string.
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
  if (opts.negativeDescription) body.negative_description = opts.negativeDescription;
  if (opts.isometric) body.isometric = true;
  if (opts.view) body.view = opts.view;
  if (opts.direction) body.direction = opts.direction;
  if (opts.textGuidanceScale !== undefined) body.text_guidance_scale = opts.textGuidanceScale;
  if (opts.initImage) {
    // img2img: a sparse placement scaffold (footprint diamond + size rectangle) at
    // LOW strength guides composition/scale without being copied. Colours still come
    // from the palette color_image below, so we keep BOTH.
    body.init_image = { type: 'base64', base64: opts.initImage, format: 'png' };
    body.init_image_strength = opts.initImageStrength ?? 300;
  }
  const paletteB64 = await loadPaletteB64();
  body.color_image = { type: 'base64', base64: paletteB64, format: 'png' };
  return body;
}

/**
 * Generate a sprite via PixelLab Pixflux, with the project style recipe and
 * the sprite-library cache applied. Returns a PNG Blob.
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
  // Every pixflux call ships the LPC palette anchor as `color_image`, so LPC
  // pixels are in the request unless a caller states otherwise (spec contract 7).
  const lineage = opts.lineage ?? 'lpc-derived';
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
        // Lineage describes how the stored pixels were made — the cached ones,
        // not this call's. A promotion never rewrites it.
        lineage: hit.lineage ?? lineage,
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
    schemaVersion: 4,
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
    lineage,
  };
  await cachePut(asset);
  return { blob, cached: false, key };
}
