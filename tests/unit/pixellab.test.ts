// The PixelLab backend only. The asset store it used to own is covered by
// sprite-library-store.test.ts — this file exercises the provider-specific
// half (cache-key recipe, request shape, key storage) plus generate()'s
// handoff into the library.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  buildCacheKeyInput,
  buildRequestBody,
  generate,
  loadApiKey,
  saveApiKey,
  clearApiKey,
  RECIPE_V,
} from '@/services/pixellab';
import { cacheClear, cacheGet } from '@/services/sprite-library';

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(impl as never));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  await cacheClear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCacheKeyInput', () => {
  const base = { prompt: 'priest', width: 64, height: 64 };

  it('is stable for identical opts', () => {
    expect(buildCacheKeyInput(base)).toEqual(buildCacheKeyInput({ ...base }));
  });

  it('differs when prompt differs', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(buildCacheKeyInput({ ...base, prompt: 'farmer' }));
  });

  it('differs when size differs', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(buildCacheKeyInput({ ...base, width: 32 }));
  });

  it('differs when seed differs', () => {
    expect(buildCacheKeyInput({ ...base, seed: 1 })).not.toEqual(buildCacheKeyInput({ ...base, seed: 2 }));
  });

  it('bakes recipe version into the key', () => {
    expect(buildCacheKeyInput(base)).toContain(RECIPE_V);
  });

  it('bakes default style enums into the key when not overridden', () => {
    const k = buildCacheKeyInput(base);
    expect(k).toContain('single color black outline');
    expect(k).toContain('basic shading');
    expect(k).toContain('medium detail');
  });

  it('differs guided (init_image) vs unguided', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(
      buildCacheKeyInput({ ...base, initImage: 'AAAA', initImageStrength: 500 }),
    );
  });

  it('differs when palette anchors differ', () => {
    expect(buildCacheKeyInput({ ...base, paletteAnchors: ['#aaa'] })).not.toEqual(
      buildCacheKeyInput({ ...base, paletteAnchors: ['#bbb'] }),
    );
  });

  it('respects a per-call recipeVersion override', () => {
    expect(buildCacheKeyInput(base)).not.toEqual(
      buildCacheKeyInput({ ...base, recipeVersion: 'v2' }),
    );
  });
});

describe('buildRequestBody', () => {
  it('includes the LPC palette swatch as color_image and no_background:true', async () => {
    mockFetch(async () => new Response(new Uint8Array([0, 1, 2, 3]).buffer));
    const body = await buildRequestBody({ prompt: 'priest', width: 64, height: 64 });
    expect(body.no_background).toBe(true);
    expect(body.color_image).toMatchObject({ type: 'base64', format: 'png' });
    expect((body.color_image as { base64: string }).base64.length).toBeGreaterThan(0);
    expect(body.outline).toBe('single color black outline');
    expect(body.shading).toBe('basic shading');
    expect(body.detail).toBe('medium detail');
    expect(body.image_size).toEqual({ width: 64, height: 64 });
  });

  it('attaches init_image + strength AND keeps color_image (scaffold guides shape, palette guides colour)', async () => {
    mockFetch(async () => new Response(new Uint8Array([0, 1, 2, 3]).buffer));
    const body = await buildRequestBody({
      prompt: 'cottage', width: 128, height: 128, initImage: 'BASE64DATA', initImageStrength: 480,
    });
    expect(body.init_image).toMatchObject({ type: 'base64', base64: 'BASE64DATA', format: 'png' });
    expect(body.init_image_strength).toBe(480);
    expect(body.color_image).toMatchObject({ type: 'base64', format: 'png' });
  });

  it('defaults init_image_strength to 300 when omitted', async () => {
    mockFetch(async () => new Response(new Uint8Array([0, 1, 2, 3]).buffer));
    const body = await buildRequestBody({
      prompt: 'cottage', width: 128, height: 128, initImage: 'BASE64DATA',
    });
    expect(body.init_image_strength).toBe(300);
  });

  it('maps the corrected pixflux fields (negative_description, isometric, view, text_guidance_scale)', async () => {
    mockFetch(async () => new Response(new Uint8Array([0, 1, 2, 3]).buffer));
    const body = await buildRequestBody({
      prompt: 'cottage', width: 128, height: 128,
      negativeDescription: 'blurry, text', isometric: true, view: 'high top-down', textGuidanceScale: 10,
    });
    expect(body.negative_description).toBe('blurry, text');
    expect(body.isometric).toBe(true);
    expect(body.view).toBe('high top-down');
    expect(body.text_guidance_scale).toBe(10);
  });
});

describe('generate', () => {
  it('hits API on cache miss, then serves from cache on second call', async () => {
    let calls = 0;
    mockFetch(async (url: string) => {
      if (url.includes('lpc-anchor.png')) {
        return new Response(new Uint8Array([0]).buffer);
      }
      calls++;
      return jsonResponse({ image: { base64: TINY_PNG_B64 }, usage: { type: 'usd', usd: 0 } });
    });

    const first = await generate('test-key', { prompt: 'priest', width: 64, height: 64 });
    expect(first.cached).toBe(false);
    expect(calls).toBe(1);
    expect(first.blob.size).toBeGreaterThan(0);

    const second = await generate('test-key', { prompt: 'priest', width: 64, height: 64 });
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);  // no new network call
    expect(second.key).toBe(first.key);
  });

  it('throws on API error', async () => {
    mockFetch(async (url: string) => {
      if (url.includes('lpc-anchor.png')) return new Response(new Uint8Array([0]).buffer);
      return new Response('forbidden', { status: 403 });
    });
    await expect(generate('bad-key', { prompt: 'x', width: 32, height: 32 })).rejects.toThrow(/403/);
  });

  it('passes the API key as a bearer token', async () => {
    let seenAuth: string | null = null;
    mockFetch(async (url: string, init?: RequestInit) => {
      if (url.includes('lpc-anchor.png')) return new Response(new Uint8Array([0]).buffer);
      const headers = init?.headers as Record<string, string> | undefined;
      seenAuth = headers?.Authorization ?? null;
      return jsonResponse({ image: { base64: TINY_PNG_B64 }, usage: { type: 'usd', usd: 0 } });
    });
    await generate('my-secret', { prompt: 'p', width: 32, height: 32 });
    expect(seenAuth).toBe('Bearer my-secret');
  });
});

describe('API key storage', () => {
  it('round-trips through localStorage', () => {
    expect(loadApiKey()).toBeNull();
    saveApiKey('abc');
    expect(loadApiKey()).toBe('abc');
    clearApiKey();
    expect(loadApiKey()).toBeNull();
  });
});

describe('generate — library metadata', () => {
  function mockGen(): void {
    mockFetch(async (url: string) => {
      if (url.includes('lpc-anchor.png')) return new Response(new Uint8Array([0]).buffer);
      return jsonResponse({ image: { base64: TINY_PNG_B64 }, usage: { type: 'usd', usd: 0 } });
    });
  }

  it('writes pending/sandbox/unknown defaults when opts have no metadata', async () => {
    mockGen();
    const r = await generate('k', { prompt: 'a-spooky-shrine', width: 32, height: 32 });
    const stored = await cacheGet(r.key);
    expect(stored).not.toBeNull();
    expect(stored!.curated).toBe('pending');
    expect(stored!.origin).toBe('sandbox');
    expect(stored!.kind).toBe('unknown');
    expect(stored!.tags).toEqual([]);
  });

  it('writes kept/official with caller metadata on official origin', async () => {
    mockGen();
    const r = await generate('k', {
      prompt: 'a-spooky-shrine-2',
      width: 32,
      height: 32,
      origin: 'official',
      kind: 'decoration',
      tags: ['Shrine', 'spooky'],
      description: 'a moss-covered shrine',
    });
    const stored = await cacheGet(r.key);
    expect(stored!.curated).toBe('kept');
    expect(stored!.origin).toBe('official');
    expect(stored!.kind).toBe('decoration');
    expect(stored!.tags).toEqual(['shrine', 'spooky']);   // normalized
    expect(stored!.description).toBe('a moss-covered shrine');
    expect(stored!.schemaVersion).toBe(4);
  });

  it('promotes sandbox entry to kept on later official cache hit', async () => {
    mockGen();
    // First call: sandbox
    const r1 = await generate('k', { prompt: 'twin-call', width: 32, height: 32 });
    expect((await cacheGet(r1.key))!.curated).toBe('pending');

    // Second call (same shape): official with metadata — should hit cache AND promote
    const r2 = await generate('k', {
      prompt: 'twin-call',
      width: 32,
      height: 32,
      origin: 'official',
      kind: 'decoration',
      tags: ['rune'],
      description: 'glowing rune',
    });
    expect(r2.cached).toBe(true);
    expect(r2.key).toBe(r1.key);

    const stored = await cacheGet(r2.key);
    expect(stored!.curated).toBe('kept');
    expect(stored!.origin).toBe('official');
    expect(stored!.kind).toBe('decoration');
    expect(stored!.tags).toEqual(['rune']);
    expect(stored!.description).toBe('glowing rune');
  });

  it('does NOT demote a kept entry on later sandbox cache hit', async () => {
    mockGen();
    // First: official → kept
    const r1 = await generate('k', {
      prompt: 'pinned',
      width: 32,
      height: 32,
      origin: 'official',
      kind: 'icon',
      tags: ['star'],
    });
    expect((await cacheGet(r1.key))!.curated).toBe('kept');

    // Second: sandbox — should hit cache and leave the entry alone
    await generate('k', { prompt: 'pinned', width: 32, height: 32 });
    const stored = await cacheGet(r1.key);
    expect(stored!.curated).toBe('kept');
    expect(stored!.kind).toBe('icon');
    expect(stored!.tags).toEqual(['star']);
  });

  it('a promotion never rewrites the stored lineage', async () => {
    mockGen();
    // Stored as self-owned; the promoting call says nothing about lineage.
    const r1 = await generate('k', {
      prompt: 'owned-then-promoted', width: 32, height: 32, lineage: 'owned',
    });
    await generate('k', {
      prompt: 'owned-then-promoted', width: 32, height: 32,
      origin: 'official', kind: 'decoration',
    });
    // Lineage describes the pixels that exist, not the call that found them.
    expect((await cacheGet(r1.key))!.lineage).toBe('owned');
  });
});
