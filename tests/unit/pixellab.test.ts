import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  buildCacheKeyInput,
  buildRequestBody,
  cacheClear,
  generate,
  loadApiKey,
  saveApiKey,
  clearApiKey,
  RECIPE_V,
} from '@/services/pixellab';

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
});

describe('buildRequestBody', () => {
  it('includes the LPC palette swatch as color_image and no_background:true', async () => {
    mockFetch(async () => new Response(new Uint8Array([0, 1, 2, 3]).buffer));
    const body = await buildRequestBody({ prompt: 'priest', width: 64, height: 64 });
    expect(body.no_background).toBe(true);
    expect(body.color_image).toMatchObject({ type: 'base64', format: 'png' });
    expect(body.color_image.base64.length).toBeGreaterThan(0);
    expect(body.outline).toBe('single color black outline');
    expect(body.shading).toBe('basic shading');
    expect(body.detail).toBe('medium detail');
    expect(body.image_size).toEqual({ width: 64, height: 64 });
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
