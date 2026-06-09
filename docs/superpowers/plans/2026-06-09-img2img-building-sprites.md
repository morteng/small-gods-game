# Runtime img2img Building Sprites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render in-game buildings as pixel-art sprites generated live from their 3D manifold geometry, via OpenRouter img2img, cached to IndexedDB, with a grey-parametric fallback.

**Architecture:** A new `GeneratedBuildingArtSource` mirrors the existing `ParametricBuildingSource` peek/warm contract. On `warm`, it renders the building's grey massing (`composeStructure(toGeometry(rb))`), sends it as an img2img init image with a brief-derived prompt to `google/gemini-2.5-flash-image` through the existing dev LLM proxy, caches the returned PNG in IndexedDB keyed by blueprint identity, and exposes a cropped+downscaled sprite canvas. The renderer dispatch becomes `generated → parametric → flat`. A ported `CostTracker` + a `$2/session` spend guard + a `liveBuildingArt` settings toggle (default ON) gate generation.

**Tech Stack:** TypeScript, Vite, Vitest (jsdom), OpenRouter chat-completions image models, IndexedDB, manifold-3d (existing), Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-06-09-img2img-building-sprites-design.md`

---

## File Structure

| File | Responsibility | New/Mod |
|---|---|---|
| `src/llm/cost-tracker.ts` | Session/month/all-time USD spend (ported) | New (port) |
| `src/ui/spend-chip.ts` | Spend readout chip (ported) | New (port) |
| `src/llm/openrouter-image-client.ts` | img2img call → `{ blob, costUsd }` | New |
| `src/assetgen/building-image-prompt.ts` | `(ResolvedBlueprint, model) → prompt string` | New |
| `src/render/generated-art-cache.ts` | IndexedDB blob cache | New |
| `src/render/blob-to-building-sprite.ts` | decode → opaque-crop → downscale | New |
| `src/render/generated-building-art-source.ts` | peek/warm source | New |
| `src/render/iso/iso-building.ts` | `pickBuildingSource` adds `generated` | Mod |
| `src/render/iso/iso-renderer.ts` | dispatch the generated source | Mod |
| `src/game/render-context.ts` | `resolveGeneratedBuildingArt` | Mod |
| `src/core/types.ts` | `RenderContext.resolveGeneratedBuildingArt` | Mod |
| `src/game.ts` | own source, wire enabled/spend/onUsage/clear | Mod |
| `src/ui/settings-unified.ts` | `liveBuildingArt` toggle + spend chip | Mod |

**Constants:** `BUILDING_IMAGE_MODEL = 'google/gemini-2.5-flash-image'`, `SESSION_CAP_USD = 2`.

---

## Task 1: Port CostTracker + spend-chip from the stale branch

The `feat/openrouter-cost-latency` branch holds `src/llm/cost-tracker.ts`, `src/ui/spend-chip.ts`, and their tests, written against an older tree. Port the files verbatim (they have no dependencies on deleted code) and confirm they pass on `main`.

**Files:**
- Create: `src/llm/cost-tracker.ts`, `src/ui/spend-chip.ts`
- Create: `tests/unit/cost-tracker.test.ts`, `tests/unit/spend-chip.test.ts`

- [ ] **Step 1: Restore the four files from the branch**

```bash
git checkout feat/openrouter-cost-latency -- \
  src/llm/cost-tracker.ts src/ui/spend-chip.ts \
  tests/unit/cost-tracker.test.ts tests/unit/spend-chip.test.ts
```

- [ ] **Step 2: Run their tests**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/cost-tracker.test.ts tests/unit/spend-chip.test.ts`
Expected: PASS. If a test imports a since-renamed symbol, fix only the import path (do not change behaviour). Do NOT wire the chip into any UI yet (that is Task 9).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from the two new source files.

- [ ] **Step 4: Commit**

```bash
git add src/llm/cost-tracker.ts src/ui/spend-chip.ts tests/unit/cost-tracker.test.ts tests/unit/spend-chip.test.ts
git commit -m "feat(llm): port CostTracker + spend-chip from cost-latency branch"
```

---

## Task 2: OpenRouter image client

**Files:**
- Create: `src/llm/openrouter-image-client.ts`
- Test: `tests/unit/openrouter-image-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/openrouter-image-client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '@/llm/openrouter-image-client';

const PNG_URI = 'data:image/png;base64,AAAA';
const OUT_URI = 'data:image/png;base64,BBBB';

function mockFetchOnce(status: number, json: unknown) {
  return vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => json, text: async () => JSON.stringify(json),
  } as never);
}
afterEach(() => vi.restoreAllMocks());

describe('generateBuildingImage', () => {
  it('builds an image chat-completions request and parses the returned image', async () => {
    const fetchSpy = mockFetchOnce(200, {
      choices: [{ message: { images: [{ image_url: { url: OUT_URI } }] } }],
      usage: { cost: 0.039 },
    });
    const res = await generateBuildingImage(
      { apiKey: 'k', baseUrl: '/api/llm/openrouter/api/v1' },
      { initImageDataUri: PNG_URI, prompt: 'draw a cottage' },
    );
    expect(res.costUsd).toBeCloseTo(0.039);
    expect(res.blob).toBeInstanceOf(Blob);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/llm/openrouter/api/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(BUILDING_IMAGE_MODEL);
    expect(body.modalities).toEqual(['image', 'text']);
    const parts = body.messages[0].content;
    expect(parts[0]).toEqual({ type: 'text', text: 'draw a cottage' });
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: PNG_URI } });
  });

  it('throws when the response carries no image', async () => {
    mockFetchOnce(200, { choices: [{ message: { content: 'nope' } }], usage: {} });
    await expect(generateBuildingImage({ apiKey: 'k' },
      { initImageDataUri: PNG_URI, prompt: 'x' })).rejects.toThrow(/no image/i);
  });

  it('throws on non-200', async () => {
    mockFetchOnce(429, { error: { message: 'rate limited' } });
    await expect(generateBuildingImage({ apiKey: 'k' },
      { initImageDataUri: PNG_URI, prompt: 'x' })).rejects.toThrow(/429|rate limited/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/openrouter-image-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/llm/openrouter-image-client.ts
// img2img building-sprite generation via an OpenRouter image model. Mirrors the
// text OpenRouterProvider's request/header shape (see llm-client.ts), but sends
// an image_url init part + modalities:['image','text'] and parses the image out
// of choices[0].message.images. Never used in tests against the real API.

export const BUILDING_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

export interface BuildingImageClientConfig {
  apiKey: string;
  baseUrl?: string;   // dev → '/api/llm/openrouter/api/v1'; prod → undefined (direct)
  siteUrl?: string;
  siteName?: string;
}

export interface GenerateBuildingImageOpts {
  initImageDataUri: string; // 'data:image/png;base64,...'
  prompt: string;
  signal?: AbortSignal;
}

export interface BuildingImageResult { blob: Blob; costUsd: number }

function dataUriToBlob(uri: string): Blob {
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(uri);
  if (!m) throw new Error('building image: malformed data-URI in response');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function generateBuildingImage(
  cfg: BuildingImageClientConfig,
  opts: GenerateBuildingImageOpts,
): Promise<BuildingImageResult> {
  const url = `${cfg.baseUrl ?? 'https://openrouter.ai/api/v1'}/chat/completions`;
  const body = {
    model: BUILDING_IMAGE_MODEL,
    modalities: ['image', 'text'],
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: opts.prompt },
        { type: 'image_url', image_url: { url: opts.initImageDataUri } },
      ],
    }],
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
    'HTTP-Referer': cfg.siteUrl ?? (typeof window !== 'undefined' ? window.location?.href : '') ?? 'http://localhost:3000',
    'X-Title': cfg.siteName ?? 'Small Gods Game',
  };

  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`building image: HTTP ${resp.status} ${txt.slice(0, 200)}`);
  }
  const json = await resp.json() as {
    choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[];
    usage?: { cost?: number };
  };
  const imgUri = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!imgUri) throw new Error('building image: response contained no image');
  return { blob: dataUriToBlob(imgUri), costUsd: json.usage?.cost ?? 0 };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/openrouter-image-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/llm/openrouter-image-client.ts tests/unit/openrouter-image-client.test.ts
git commit -m "feat(llm): OpenRouter img2img building-image client"
```

---

## Task 3: Building image prompt builder

The prompt is derived from the existing `toBrief(rb, 0)` (subject, traits, materials, era) plus one shared style preamble. Deterministic — feeds the cache key.

**Files:**
- Create: `src/assetgen/building-image-prompt.ts`
- Test: `tests/unit/building-image-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-image-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildingImagePrompt, imageModelFamily } from '@/assetgen/building-image-prompt';
import { synthesizeBlueprint } from '@/blueprint/presets';

const GEMINI = 'google/gemini-2.5-flash-image';
const OPENAI = 'openai/gpt-5-image';

describe('imageModelFamily', () => {
  it('classifies by family', () => {
    expect(imageModelFamily(GEMINI)).toBe('gemini');
    expect(imageModelFamily(OPENAI)).toBe('openai');
    expect(imageModelFamily('something/else')).toBe('generic');
  });
});

describe('buildingImagePrompt', () => {
  it('is deterministic in (rb, model) and includes subject + era', () => {
    const rb = synthesizeBlueprint('cottage')!;
    expect(buildingImagePrompt(rb, GEMINI)).toBe(buildingImagePrompt(rb, GEMINI));
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('cottage');
    expect(p.toLowerCase()).toContain('medieval');
  });

  it('adapts the prompt to the model family', () => {
    const rb = synthesizeBlueprint('cottage')!;
    expect(buildingImagePrompt(rb, GEMINI)).not.toBe(buildingImagePrompt(rb, OPENAI));
  });

  it('reflects materials in the text', () => {
    const rb = synthesizeBlueprint('castle_keep')!;
    const p = buildingImagePrompt(rb, GEMINI);
    expect(p).toContain('castle keep');
    expect(p.toLowerCase()).toMatch(/stone|walls/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/building-image-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/assetgen/building-image-prompt.ts
// Deterministic, MODEL-AWARE text prompt for img2img building generation. The
// grey init image carries silhouette + rough materials; this adds a brief-derived
// description (subject, era, materials, door, traits) wrapped by a per-model-family
// preamble — Gemini-image wants natural-language "redraw the reference" editing
// instructions; OpenAI gpt-image wants a concise descriptive generation prompt.
// Output is a pure function of (rb, model) → safe to fold into the cache key.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { toBrief } from '@/blueprint/compile/to-brief';

export type ImageModelFamily = 'gemini' | 'openai' | 'generic';

/** Map an OpenRouter image model id to its prompt family. */
export function imageModelFamily(model: string): ImageModelFamily {
  const m = model.toLowerCase();
  if (m.includes('gemini')) return 'gemini';            // check first: gemini ids also contain "-image"
  if (m.includes('gpt') || m.startsWith('openai/')) return 'openai';
  return 'generic';
}

const STYLE_TAIL =
  'Clean readable pixel shading, cohesive limited palette, fully transparent ' +
  'background, no ground, no shadow, centered.';

/** Brief-derived core, identical across families (pure function of the blueprint). */
function describeBuilding(rb: ResolvedBlueprint): string {
  const brief = toBrief(rb, 0);
  const mats = brief.materials.map(m => `${m.material} ${m.part}`).join(', ');
  const doorPhrase = brief.door ? ' with a visible wooden door' : '';
  const traits = brief.traits.slice(0, 4).join(', ');
  return `a ${brief.era} ${brief.subject}${doorPhrase}, ${mats}, ${traits}`;
}

export function buildingImagePrompt(rb: ResolvedBlueprint, model: string): string {
  const subject = describeBuilding(rb);
  switch (imageModelFamily(model)) {
    case 'gemini':
      return `Using the attached 3D massing render as a strict reference, redraw it ` +
        `as a crisp 2D isometric pixel-art video-game building sprite. Preserve the ` +
        `exact silhouette, proportions, roof pitch, chimney and door placement. ` +
        `Subject: ${subject}. ${STYLE_TAIL}`;
    case 'openai':
      return `Isometric pixel-art video-game building sprite matching the reference ` +
        `shape exactly (same silhouette, roof pitch, chimney and door placement). ` +
        `Subject: ${subject}. ${STYLE_TAIL}`;
    default:
      return `A crisp 2D isometric pixel-art video-game building sprite, redrawn from ` +
        `the reference shape (same silhouette, roof pitch, chimney, door). ` +
        `Subject: ${subject}. ${STYLE_TAIL}`;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/building-image-prompt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/building-image-prompt.ts tests/unit/building-image-prompt.test.ts
git commit -m "feat(assetgen): deterministic building img2img prompt builder"
```

---

## Task 4: IndexedDB generated-art cache

Mirrors `src/services/save-store.ts`. Stores the PNG blob keyed by a string cache key, with `targetWidth` so the hit path needs no recompute.

**Files:**
- Create: `src/render/generated-art-cache.ts`
- Test: `tests/unit/generated-art-cache.test.ts`

- [ ] **Step 1: Write the failing test** (uses `fake-indexeddb`, already a dev dep used by `save-store.test.ts`; if absent, install with `npm i -D fake-indexeddb`)

```ts
// tests/unit/generated-art-cache.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { readGeneratedArt, writeGeneratedArt, clearGeneratedArt, _resetGeneratedArtDbForTesting } from '@/render/generated-art-cache';

beforeEach(async () => { _resetGeneratedArtDbForTesting(); await clearGeneratedArt(); });

describe('generated-art-cache', () => {
  it('round-trips a blob + targetWidth', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    await writeGeneratedArt('k1', blob, { model: 'm', prompt: 'p', targetWidth: 256 });
    const got = await readGeneratedArt('k1');
    expect(got?.targetWidth).toBe(256);
    expect(await got!.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  it('returns null on miss', async () => {
    expect(await readGeneratedArt('absent')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/generated-art-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/generated-art-cache.ts
// Persistent IndexedDB cache of generated building sprites (PNG blobs), keyed by
// blueprint identity + recipe version + prompt. Shared across worlds so each
// unique building is generated once, ever. Mirrors src/services/save-store.ts.
import { ART_RECIPE_VERSION } from '@/core/content-version';

const DB_NAME = 'small-gods-generated-art';
const DB_VERSION = 1;
const DB_STORE = 'building-sprites';

export interface GeneratedArtRecord {
  key: string; blob: Blob; recipeVersion: string; model: string; prompt: string; targetWidth: number; createdAt: number;
}

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

/** Stable string key: recipe version + model id + djb2 hash of blueprint
 *  identity. The prompt is a pure function of (blueprint, model), so those two
 *  cover it; a prompt-logic change is handled by bumping ART_RECIPE_VERSION.
 *  The model is in the key so switching image models never serves stale art. */
export function generatedArtKey(rbJson: string, model: string): string {
  return `${ART_RECIPE_VERSION}:${model}:${djb2(rbJson)}`;
}
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function readGeneratedArt(key: string): Promise<{ blob: Blob; targetWidth: number } | null> {
  if (!hasIdb()) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => {
        const r = req.result as GeneratedArtRecord | undefined;
        resolve(r && r.recipeVersion === ART_RECIPE_VERSION ? { blob: r.blob, targetWidth: r.targetWidth } : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) { console.warn('[generated-art-cache] read failed:', err); return null; }
}

export async function writeGeneratedArt(key: string, blob: Blob, meta: { model: string; prompt: string; targetWidth: number }): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        key, blob, recipeVersion: ART_RECIPE_VERSION, model: meta.model, prompt: meta.prompt, targetWidth: meta.targetWidth, createdAt: 0,
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
```

Note: `createdAt: 0` keeps the record deterministic (no `Date.now()`); a real timestamp isn't needed for v1. If `fake-indexeddb` is not installed, run `npm i -D fake-indexeddb` first and commit the `package.json`/lockfile change in this task.

- [ ] **Step 4: Run to verify it passes**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/generated-art-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/generated-art-cache.ts tests/unit/generated-art-cache.test.ts package.json package-lock.json
git commit -m "feat(render): IndexedDB cache for generated building sprites"
```

---

## Task 5: Blob → building sprite (decode, opaque-crop, downscale)

Turns a generated PNG blob into a tight sprite canvas sized to the footprint, so the existing `drawIsoBuildingSpriteGenerated` (centre/bottom anchor) blits it correctly. Target opaque width = `(footprint.w + footprint.h) * ISO_TILE_W/2` — empirically equal to the parametric sprite's bbox width (verified: 2×2→256, 3×3→384).

**Files:**
- Create: `src/render/blob-to-building-sprite.ts`
- Test: `tests/unit/blob-to-building-sprite.test.ts`

- [ ] **Step 1: Write the failing test** (jsdom has no real canvas/`createImageBitmap`, so the unit test asserts the pure target-width math + graceful null; the pixel pipeline is covered by manual e2e in Task 10)

```ts
// tests/unit/blob-to-building-sprite.test.ts
import { describe, it, expect } from 'vitest';
import { buildingSpriteTargetWidth, blobToBuildingSprite } from '@/render/blob-to-building-sprite';

describe('buildingSpriteTargetWidth', () => {
  it('matches the parametric diamond width', () => {
    expect(buildingSpriteTargetWidth({ w: 2, h: 2 })).toBe(256);
    expect(buildingSpriteTargetWidth({ w: 3, h: 3 })).toBe(384);
    expect(buildingSpriteTargetWidth({ w: 3, h: 2 })).toBe(320);
  });
});

describe('blobToBuildingSprite', () => {
  it('returns null when no canvas backend is available (jsdom)', async () => {
    const blob = new Blob([new Uint8Array([0])], { type: 'image/png' });
    expect(await blobToBuildingSprite(blob, 256)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/blob-to-building-sprite.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/blob-to-building-sprite.ts
// Decode a generated PNG blob → crop to its opaque bbox → downscale so the opaque
// content width equals the footprint diamond width. Returns a tight SpriteCanvas
// for drawIsoBuildingSpriteGenerated (centre/bottom anchor). Returns null when no
// canvas/createImageBitmap is available (jsdom) → caller falls back to grey.
import { ISO_TILE_W } from '@/render/iso/iso-projection';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';

export function buildingSpriteTargetWidth(footprint: { w: number; h: number }): number {
  return Math.round((footprint.w + footprint.h) * (ISO_TILE_W / 2));
}

function makeCanvas(w: number, h: number): SpriteCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

export async function blobToBuildingSprite(blob: Blob, targetWidth: number): Promise<SpriteCanvas | null> {
  if (typeof createImageBitmap === 'undefined') return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  const w = bmp.width, h = bmp.height;
  const scratch = makeCanvas(w, h);
  const sctx = scratch?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!scratch || !sctx) return null;
  sctx.drawImage(bmp, 0, 0);

  // Opaque bbox scan.
  const data = sctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null; // fully transparent
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const scale = targetWidth / cw;
  const outW = Math.max(1, Math.round(cw * scale)), outH = Math.max(1, Math.round(ch * scale));
  const out = makeCanvas(outW, outH);
  const octx = out?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!out || !octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(scratch as CanvasImageSource, minX, minY, cw, ch, 0, 0, outW, outH);
  return out;
}
```

If `ISO_TILE_W` is not exported from `iso-projection.ts`, add `export const ISO_TILE_W = 128;` there (it already defines the value internally) or import from wherever the `128` constant lives — verify with `grep -n "ISO_TILE_W" src/render/iso/iso-projection.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/blob-to-building-sprite.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/blob-to-building-sprite.ts tests/unit/blob-to-building-sprite.test.ts
git commit -m "feat(render): decode generated building blob to footprint-sized sprite"
```

---

## Task 6: GeneratedBuildingArtSource

The peek/warm source. Pure dependencies are injected for testing; production defaults wire the real client/cache/compose.

**Files:**
- Create: `src/render/generated-building-art-source.ts`
- Test: `tests/unit/generated-building-art-source.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/generated-building-art-source.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import type { Entity } from '@/core/types';

const SPRITE = {} as unknown as HTMLCanvasElement; // opaque stand-in
function entity(seed: string): Entity {
  return { id: 'b1', kind: 'cottage', x: 0, y: 0,
    properties: { blueprint: { rb: { preset: seed, footprint: { w: 2, h: 2 } } } } } as unknown as Entity;
}

function makeSource(over = {}) {
  const generate = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' }));
  const src = new GeneratedBuildingArtSource({
    enabled: () => true, canSpend: () => true, model: () => 'm',
    prompt: () => 'P', initDataUri: async () => 'data:image/png;base64,AA',
    targetWidth: () => 256, generate,
    cacheGet: async () => null, cachePut: async () => {},
    decode: async () => SPRITE,
    ...over,
  });
  return { src, generate };
}

describe('GeneratedBuildingArtSource', () => {
  it('peek is null until warm resolves, then returns the sprite', async () => {
    const { src, generate } = makeSource();
    const e = entity('cottage');
    expect(src.peek(e)).toBeNull();
    src.warm(e); await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('serves a cache hit without calling generate', async () => {
    const { src, generate } = makeSource({ cacheGet: async () => ({ blob: new Blob(), targetWidth: 256 }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not generate when disabled or over budget → peek stays null', async () => {
    const a = makeSource({ enabled: () => false });
    const b = makeSource({ canSpend: () => false });
    const e = entity('cottage');
    a.src.warm(e); b.src.warm(e); await Promise.resolve(); await Promise.resolve();
    expect(a.src.peek(e)).toBeNull(); expect(b.src.peek(e)).toBeNull();
    expect(a.generate).not.toHaveBeenCalled(); expect(b.generate).not.toHaveBeenCalled();
  });

  it('caches null on failure (falls back) and never throws', async () => {
    const { src } = makeSource({ generate: vi.fn(async () => { throw new Error('boom'); }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBeNull());
  });

  it('identical blueprints share one generation', async () => {
    const { src, generate } = makeSource();
    src.warm(entity('cottage')); src.warm(entity('cottage'));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/generated-building-art-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/render/generated-building-art-source.ts
// Runtime source of img2img-generated building sprites. Mirrors
// ParametricBuildingSource's peek/warm contract: peek() is the sync frame read,
// warm() kicks generation off the frame path (≤ once per cache key). Pipeline:
// blueprint → grey init → OpenRouter img2img → IndexedDB cache → sprite canvas.
// Any failure / disabled / over-budget caches null so the renderer falls back to
// the grey parametric sprite. Never throws on the frame path.
import type { Entity } from '@/core/types';
import { blueprintOf } from '@/blueprint/entity';
import type { ResolvedBlueprint } from '@/blueprint/types';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { greyToDataUri } from '@/render/iso/sprite-canvas';
import { buildingImagePrompt } from '@/assetgen/building-image-prompt';
import { buildingSpriteTargetWidth, blobToBuildingSprite } from '@/render/blob-to-building-sprite';
import { generatedArtKey, readGeneratedArt, writeGeneratedArt } from '@/render/generated-art-cache';

export interface GeneratedSourceDeps {
  enabled: () => boolean;
  canSpend: () => boolean;
  /** Currently-selected image model id (drives prompt family + cache key). */
  model: () => string;
  /** Generate a PNG blob from an init data-URI + prompt (wraps the client + cost tracking). */
  generate: (initDataUri: string, prompt: string, signal?: AbortSignal) => Promise<Blob>;
  // Seams below default to the real pipeline; overridden in tests.
  prompt?: (rb: ResolvedBlueprint) => string;
  initDataUri?: (rb: ResolvedBlueprint) => Promise<string>;
  targetWidth?: (rb: ResolvedBlueprint) => number;
  cacheGet?: (key: string) => Promise<{ blob: Blob; targetWidth: number } | null>;
  cachePut?: (key: string, blob: Blob, meta: { model: string; prompt: string; targetWidth: number }) => Promise<void>;
  decode?: (blob: Blob, targetWidth: number) => Promise<SpriteCanvas | null>;
}

export class GeneratedBuildingArtSource {
  private readonly cache = new Map<string, SpriteCanvas | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private readonly d: Required<GeneratedSourceDeps>;

  constructor(deps: GeneratedSourceDeps) {
    this.d = {
      prompt: (rb) => buildingImagePrompt(rb, deps.model()),
      initDataUri: async (rb) => { const r = await composeStructure(toGeometry(rb)); return greyToDataUri(r.grey, r.size); },
      targetWidth: (rb) => buildingSpriteTargetWidth(rb.footprint),
      cacheGet: (k) => readGeneratedArt(k),
      cachePut: (k, b, m) => writeGeneratedArt(k, b, m),
      decode: (b, w) => blobToBuildingSprite(b, w),
      ...deps,
    } as Required<GeneratedSourceDeps>;
  }

  private rbOf(e: Entity): ResolvedBlueprint | undefined { return blueprintOf(e)?.rb; }
  private keyOf(rb: ResolvedBlueprint): string { return generatedArtKey(JSON.stringify(rb), this.d.model()); }

  peek(e: Entity): SpriteCanvas | null {
    const rb = this.rbOf(e); if (!rb) return null;
    return this.cache.get(this.keyOf(rb)) ?? null;
  }

  warm(e: Entity): void {
    const rb = this.rbOf(e); if (!rb) return;
    const key = this.keyOf(rb);            // cheap; no prompt/toBrief on the frame path
    if (this.cache.has(key) || this.inflight.has(key)) return;
    if (!this.d.enabled()) { return; } // not cached: re-evaluate if toggled on later
    this.inflight.add(key);
    void this.run(rb, key).finally(() => this.inflight.delete(key));
  }

  private async run(rb: ResolvedBlueprint, key: string): Promise<void> {
    const targetWidth = this.d.targetWidth(rb);
    try {
      const hit = await this.d.cacheGet(key);
      if (hit) { this.cache.set(key, await this.d.decode(hit.blob, hit.targetWidth)); return; }
      if (!this.d.canSpend()) { return; } // over budget: leave uncached so a later world (under cap) can retry
      const prompt = this.d.prompt(rb);    // computed lazily — only when actually generating
      const initDataUri = await this.d.initDataUri(rb);
      const blob = await this.d.generate(initDataUri, prompt);
      await this.d.cachePut(key, blob, { model: this.d.model(), prompt, targetWidth });
      this.cache.set(key, await this.d.decode(blob, targetWidth));
    } catch (err) {
      if (!this.warned.has(key)) { console.warn('[generated-building] generation failed', err); this.warned.add(key); }
      this.cache.set(key, null);
    }
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); }
}
```

- [ ] **Step 4: Add the `greyToDataUri` helper to `sprite-canvas.ts`**

In `src/render/iso/sprite-canvas.ts`, append:

```ts
/** Encode a full grey RGBA buffer as a PNG data-URI (img2img init image). Null in jsdom. */
export function greyToDataUri(grey: Uint8ClampedArray, size: number): string | null {
  const c = makeCanvas(size, size);
  const ctx = c?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!c || !ctx) return null;
  ctx.putImageData(new ImageData(grey as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return (c as HTMLCanvasElement).toDataURL?.('image/png') ?? null;
}
```

(`makeCanvas` already exists in that file. `OffscreenCanvas` lacks `toDataURL`; the optional chain + the `document` branch in `makeCanvas` handle both — in the browser `makeCanvas` returns an `HTMLCanvasElement` only when `OffscreenCanvas` is undefined, so for the data-URI path prefer the document canvas: change `greyToDataUri` to construct a `document.createElement('canvas')` directly when available.) Final `greyToDataUri`:

```ts
export function greyToDataUri(grey: Uint8ClampedArray, size: number): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.putImageData(new ImageData(grey as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return c.toDataURL('image/png');
}
```

The source's default `initDataUri` must handle a null (jsdom) by throwing → caught → null sprite. Update the default to: `const uri = greyToDataUri(r.grey, r.size); if (!uri) throw new Error('no canvas for init image'); return uri;`.

- [ ] **Step 5: Run to verify it passes**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/generated-building-art-source.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/render/generated-building-art-source.ts src/render/iso/sprite-canvas.ts tests/unit/generated-building-art-source.test.ts
git commit -m "feat(render): GeneratedBuildingArtSource (geometry → img2img → cached sprite)"
```

---

## Task 7: Render dispatch — `generated → parametric → flat`

**Files:**
- Modify: `src/render/iso/iso-building.ts` (`pickBuildingSource`)
- Modify: `src/core/types.ts` (`RenderContext.resolveGeneratedBuildingArt`)
- Modify: `src/game/render-context.ts`
- Modify: `src/render/iso/iso-renderer.ts`
- Test: `tests/unit/pick-building-source.test.ts` (new or extend existing)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pick-building-source.test.ts
import { describe, it, expect } from 'vitest';
import { pickBuildingSource } from '@/render/iso/iso-building';

const C = {} as unknown as CanvasImageSource;
describe('pickBuildingSource (generated → parametric → flat)', () => {
  const has = () => C, none = () => null;
  it('prefers generated', () => expect(pickBuildingSource('auto', none, has, none)).toBe('generated'));
  it('falls to parametric', () => expect(pickBuildingSource('auto', none, none, has)).toBe('parametric'));
  it('falls to flat', () => expect(pickBuildingSource('auto', none, none, none)).toBe('flat'));
  it('fallback mode skips asset but allows generated', () => expect(pickBuildingSource('fallback', has, has, none)).toBe('generated'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/pick-building-source.test.ts`
Expected: FAIL — `pickBuildingSource` has the old 3-arg signature.

- [ ] **Step 3: Update `pickBuildingSource`** in `src/render/iso/iso-building.ts`

Replace the function with the 4-source version (asset kept for completeness but generated takes precedence over parametric):

```ts
export function pickBuildingSource(
  mode: BuildingRenderMode,
  asset: () => CanvasImageSource | null,
  generated: () => CanvasImageSource | null,
  parametric: () => CanvasImageSource | null,
): 'asset' | 'generated' | 'parametric' | 'flat' {
  if (mode !== 'fallback' && asset()) return 'asset';
  if (generated()) return 'generated';
  if (parametric()) return 'parametric';
  return 'flat';
}
```

- [ ] **Step 4: Add `resolveGeneratedBuildingArt` to the `RenderContext` type** in `src/core/types.ts`

Find the `resolveParametricBuildingArt?: (e: Entity) => ... ` field and add directly below it:

```ts
  resolveGeneratedBuildingArt?: (entity: Entity) => CanvasImageSource | null;
```

(Match the exact type used by `resolveParametricBuildingArt`.)

- [ ] **Step 5: Wire the resolver** in `src/game/render-context.ts`

Add `generatedBuildingArtSource: GeneratedBuildingArtSource;` to `RenderContextDeps` (and the destructure), import the type, and add after `resolveParametricBuildingArt`:

```ts
    resolveGeneratedBuildingArt: (entity: Entity) => {
      const s = generatedBuildingArtSource.peek(entity);
      if (s) return s;
      generatedBuildingArtSource.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
```

- [ ] **Step 6: Dispatch in `src/render/iso/iso-renderer.ts`** (around line 153-160)

```ts
          const mode = rc.devMode?.buildingRenderMode ?? 'auto';
          const asset = () => rc.resolveBuildingArt?.(b.e) ?? null;
          const generated = () => rc.resolveGeneratedBuildingArt?.(b.e) ?? null;
          const parametric = () => rc.resolveParametricBuildingArt?.(b.e) ?? null;
          switch (pickBuildingSource(mode, asset, generated, parametric)) {
            case 'asset':      drawIsoBuildingSprite(drawCtx, asset() as HTMLImageElement, bx, by, { w: b.s.w, h: b.s.h }); break;
            case 'generated':  drawIsoBuildingSpriteGenerated(drawCtx, generated() as HTMLCanvasElement, bx, by, { w: b.s.w, h: b.s.h }); break;
            case 'parametric': drawIsoBuildingSpriteGenerated(drawCtx, parametric() as HTMLCanvasElement, bx, by, { w: b.s.w, h: b.s.h }); break;
            case 'flat':       drawIsoFlatBlock(drawCtx, { w: b.s.w, h: b.s.h }, bx, by); break;
          }
```

- [ ] **Step 7: Run the test + typecheck**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/unit/pick-building-source.test.ts && npx tsc --noEmit`
Expected: tests PASS; tsc reports `render-context.ts` needs the new dep — that is wired in Task 8, so a transient tsc error there is acceptable until Task 8. (If you prefer green tsc now, make `generatedBuildingArtSource` optional in `RenderContextDeps` and guard the resolver.)

- [ ] **Step 8: Commit**

```bash
git add src/render/iso/iso-building.ts src/core/types.ts src/game/render-context.ts src/render/iso/iso-renderer.ts tests/unit/pick-building-source.test.ts
git commit -m "feat(render): dispatch generated building sprites (generated → parametric → flat)"
```

---

## Task 8: Wire into game.ts — source, client, cost, enabled, clear

**Files:**
- Modify: `src/game.ts`
- (Read) `src/llm/provider-factory.ts`, `src/llm/cost-tracker.ts`

- [ ] **IMPORTANT — reuse the existing wiring.** `game.ts` ALREADY has `private costTracker = new CostTracker();` (line ~100), already fed by the LLM text client via `(r) => this.costTracker.record(r)`, and the spend chip is ALREADY mounted (line ~373). Do NOT declare a second CostTracker or mount a second chip. The CostTracker API is: `record({ cost?: number; cacheStatus?: 'HIT'|'MISS' })` and `snapshot(): { sessionUsd, ... }`. `BUILDING_IMAGE_MODEL` is the selected model for now (a settings model-picker is a later, separate feature).

**Step 1: Construct the generated source, reusing the existing `costTracker`**

In `src/game.ts`, near the existing `parametricBuildingSource` field (line ~105), add:

```ts
  private liveBuildingArtEnabled = true; // setting `liveBuildingArt`, default ON
  private readonly generatedBuildingArtSource = new GeneratedBuildingArtSource({
    enabled: () => this.liveBuildingArtEnabled,
    canSpend: () => this.costTracker.snapshot().sessionUsd < SESSION_CAP_USD,
    model: () => BUILDING_IMAGE_MODEL,
    generate: async (initDataUri, prompt) => {
      const cfg = loadProviderConfig();
      const res = await generateBuildingImage(
        { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(),
          siteName: cfg.openrouterSiteName },
        { initImageDataUri, prompt, model: BUILDING_IMAGE_MODEL },
      );
      this.costTracker.record({ cost: res.costUsd, cacheStatus: 'MISS' });
      return res.blob;
    },
  });
```

Imports at top (CostTracker is already imported; add the rest):

```ts
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '@/llm/openrouter-image-client';
import { loadProviderConfig, openrouterImageBaseUrl } from '@/llm/provider-factory';
```

Add `const SESSION_CAP_USD = 2;` near the top of the file. (`loadProviderConfig` may already be imported — don't duplicate.)

- [ ] **Step 2: Add the `openrouterImageBaseUrl()` helper to `provider-factory.ts`**

```ts
/** Base URL for image generation: dev proxy when available, else direct OpenRouter. */
export function openrouterImageBaseUrl(): string | undefined {
  return useDevLlmProxy() ? '/api/llm/openrouter/api/v1' : undefined;
}
```

Import it in `game.ts`.

- [ ] **Step 3: Pass the source into the render context**

Where `buildRenderContext({...})` is called (in `frame-renderer.ts` or `game.ts` — `grep -n "buildRenderContext\|parametricBuildingSource" src/game/frame-renderer.ts src/game.ts`), add `generatedBuildingArtSource: this.generatedBuildingArtSource` alongside `parametricBuildingSource`.

- [ ] **Step 4: Clear on world reset**

Find where `this.parametricBuildingSource.clear()` is called (world reset / New World) and add `this.generatedBuildingArtSource.clear();` next to it. (`grep -n "parametricBuildingSource.clear" src/game.ts`.)

- [ ] **Step 5: Apply the setting**

In the `onGameSettingChange` handler (or `applyGameSetting`) in `game.ts`, add a case:

```ts
    if (key === 'liveBuildingArt') { this.liveBuildingArtEnabled = value !== false; }
```

Read the persisted value on startup the same way other game settings are read (e.g. `showLabels`).

- [ ] **Step 6: Typecheck + build**

Run: `npx tsc --noEmit && TMPDIR=$PWD/.tmp npm run build`
Expected: clean (build emits `manifold.wasm`).

- [ ] **Step 7: Commit**

```bash
git add src/game.ts src/llm/provider-factory.ts src/game/frame-renderer.ts
git commit -m "feat(game): wire GeneratedBuildingArtSource + CostTracker + spend cap"
```

---

## Task 9: Settings toggle + spend chip

**Files:**
- Modify: `src/ui/settings-unified.ts`
- Test: `tests/dom/settings-unified.test.ts` (extend if present, else new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/dom/settings-live-building-art.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createSettingsPanel } from '@/ui/settings-unified';

describe('liveBuildingArt toggle', () => {
  it('renders ON by default and fires onGameSettingChange', () => {
    const onGameSettingChange = vi.fn();
    const host = document.createElement('div');
    createSettingsPanel(host, { onGameSettingChange });
    const row = [...host.querySelectorAll('label')].find(l => /generate building art/i.test(l.textContent || ''));
    expect(row).toBeTruthy();
    const cb = row!.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    cb.click();
    expect(onGameSettingChange).toHaveBeenCalledWith('liveBuildingArt', false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/dom/settings-live-building-art.test.ts`
Expected: FAIL — no such row.

- [ ] **Step 3: Add the toggle row** in `createGameSettings` (`src/ui/settings-unified.ts`, after the `Show POI Markers` row ~line 292)

```ts
  section.appendChild(createToggleRow('Generate building art (uses your OpenRouter key)', 'liveBuildingArt', true, opts));
  const note = document.createElement('div');
  note.className = 'sg-field__hint';
  note.textContent = 'Renders buildings as AI pixel-art from their 3D shape. ~$0.04 each, cached. Capped at $2/session.';
  section.appendChild(note);
```

- [ ] **Step 4: Run the test**

Run: `TMPDIR=$PWD/.tmp npx vitest run tests/dom/settings-live-building-art.test.ts`
Expected: PASS.

- [ ] **Step 5: Spend chip — already mounted, nothing to do**

The spend chip is already mounted in the bottom-left bar (`game.ts:373` `mountSpendChip(this.ui.bottomLeftBar, this.costTracker)`, visible when provider is openrouter) and the image client records spend into that same `costTracker` (Task 8). So image-generation spend already shows up. Just confirm this during manual verification — no code needed here.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/settings-unified.ts tests/dom/settings-live-building-art.test.ts
git commit -m "feat(ui): liveBuildingArt settings toggle (default on) + spend chip"
```

---

## Task 10: Full verification + manual e2e eyeball

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `TMPDIR=$PWD/.tmp npx vitest run`
Expected: all green (prior baseline 1640 + the new tests). Investigate any failure; the `replay-speed`/`game-ui` flakes re-run clean.

- [ ] **Step 2: Production build**

Run: `TMPDIR=$PWD/.tmp npm run build`
Expected: clean, emits `manifold.wasm`.

- [ ] **Step 3: Manual e2e — generated sprites appear in-game**

```bash
npm run dev   # terminal 1, port 3000 (ensure .env has OPENROUTER_API_KEY)
KINDS=cottage,tavern,castle_keep,yurt node scripts/e2e-smoke.mjs
```

Then re-capture after generation has had time to run:

```bash
# Wait ~30s after the smoke run completes so warm() resolves, then grab again:
node -e "import('playwright').then(async({chromium})=>{const b=await chromium.launch();const p=await(await b.newContext({viewport:{width:1280,height:800}})).newPage();await p.goto('http://localhost:3000');await p.waitForTimeout(45000);for(const k of ['cottage','tavern']){await p.evaluate(({k})=>{const g=window.__game,e=g.state.world.query({kind:k})[0];if(!e)return;const c=g.state.camera,vw=g.container.clientWidth,vh=g.container.clientHeight;c.zoom=4;const tx=e.x+.5,ty=e.y+.5;c.x=(tx-ty)*64-vw/(2*c.zoom);c.y=(tx+ty)*32-vh/(2*c.zoom);},{k});await p.waitForTimeout(500);const u=await p.evaluate(()=>window.__game.canvas.toDataURL('image/png'));require('fs').writeFileSync('tmp/gen-'+k+'.png',Buffer.from(u.split(',')[1],'base64'));}await b.close();})"
```

Read `tmp/gen-cottage.png` / `tmp/gen-tavern.png`. **Expected:** real pixel-art building sprites (not grey clay), matching the building silhouette, anchored on their tiles.

- [ ] **Step 4: Verify caching (no re-spend on reload)**

Reload the page (do NOT clear IndexedDB). Buildings should show generated art **immediately** (from cache) with no new spend. Confirm via the spend chip / console.

- [ ] **Step 5: Confirm fallback**

Toggle `liveBuildingArt` off in Settings, New World → buildings render grey parametric (no API calls). Toggle on → they generate again.

- [ ] **Step 6: Final commit (docs/memory only if needed)**

```bash
git add -A docs/
git commit -m "docs: img2img building sprites — verification notes" || true
```

---

## Self-Review notes (for the executor)

- **CostTracker is already in main** (not a stale branch): `game.ts` already owns `this.costTracker` + a mounted spend chip, fed by the text LLM client. Task 8 REUSES it (no second instance). API: `record({ cost, cacheStatus:'HIT'|'MISS' })`, `snapshot().sessionUsd`.
- **Prompts are model-aware** (Task 3): `buildingImagePrompt(rb, model)` branches by `imageModelFamily(model)`; the model id is in the cache key (Task 4) and sent to the client (Task 8). Selected model = `BUILDING_IMAGE_MODEL` for now (settings model-picker is a later feature).
- **`ISO_TILE_W` export** — verify it's exported from `iso-projection.ts` (Task 5); add the export if missing.
- **`fake-indexeddb`** — confirm it's a dependency (Task 4); install if not.
- **Production path** is out of scope: in prod `openrouterImageBaseUrl()` returns `undefined` → direct OpenRouter call, which may hit CORS. The toggle defaults ON but generation simply fails → grey fallback. A prod-safe path is a separate follow-up.
- The baked `asset` path remains in `pickBuildingSource` but is v2-gated and effectively dormant; not removed here.
```
