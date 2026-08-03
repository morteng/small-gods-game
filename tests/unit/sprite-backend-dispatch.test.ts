// The SpriteBackend seam: AssetProvider dispatches, providers with no backend
// refuse by name, and each backend reports the job fields it cannot honour
// instead of silently dropping them.
//
// NOTHING here touches a network or spends anything: every backend is wired
// with an injected fake generate function.
import { describe, it, expect } from 'vitest';
import type { PixelLabGenerateOpts } from '@/core/types';
import type { BuildingImageResult } from '@/llm/openrouter-image-client';
import type { ImageDispatchOpts, ImageProviders } from '@/llm/image-dispatch';
import {
  acceptJob,
  jobRefusal,
  unsupportedJobFields,
  SpriteBackendUnavailableError,
  SpriteJobUnsupportedError,
  type SpriteBackendCapabilities,
  type SpriteJob,
} from '@/assetgen/compilers/backend';
import {
  createSpriteBackend,
  availableProviders,
} from '@/assetgen/compilers/backend-registry';
import {
  createImg2ImgBackend,
  IMG2IMG_CAPABILITIES,
} from '@/assetgen/compilers/img2img-backend';
import {
  createPixelLabBackend,
  denoiseToInitStrength,
  PIXELLAB_DEFAULT_DENOISE01,
} from '@/assetgen/compilers/pixellab-backend';
import { createMockBackend } from '@/assetgen/compilers/mock-backend';

const PNG_URI = 'data:image/png;base64,AAAA';

// ─── Fakes (no network, no spend) ─────────────────────────────────────────────

function fakePixelLab() {
  const calls: { apiKey: string; opts: PixelLabGenerateOpts }[] = [];
  const fn = async (apiKey: string, opts: PixelLabGenerateOpts) => {
    calls.push({ apiKey, opts });
    return { blob: new Blob(['pl'], { type: 'image/png' }), cached: true, key: 'k' };
  };
  return { calls, fn };
}

function fakeDispatch() {
  const calls: { cfg: ImageProviders; opts: ImageDispatchOpts }[] = [];
  const fn = async (cfg: ImageProviders, opts: ImageDispatchOpts): Promise<BuildingImageResult> => {
    calls.push({ cfg, opts });
    return { blob: new Blob(['img'], { type: 'image/png' }), costUsd: 0.03 };
  };
  return { calls, fn };
}

const PROVIDERS: ImageProviders = { openrouter: { apiKey: 'or-key' } };

function img2imgDeps() {
  const dispatch = fakeDispatch();
  return {
    dispatch,
    cfg: {
      model: 'qwen/qwen-image-edit-2511',
      providers: PROVIDERS,
      generateFn: dispatch.fn,
    },
  };
}

// ─── Registry dispatch ────────────────────────────────────────────────────────

describe('createSpriteBackend', () => {
  it('builds a mock backend with no configuration at all', async () => {
    const be = createSpriteBackend('mock');
    expect(be.provider).toBe('mock');
    const res = await be.generate({ prompt: 'a goat', width: 32, height: 32 });
    expect(res.provider).toBe('mock');
    expect(res.ignored).toEqual([]);
    expect(await res.blob.text()).toContain('a goat');
  });

  it('refuses fal by name — a declared provenance value with no backend', () => {
    expect(() => createSpriteBackend('fal')).toThrow(SpriteBackendUnavailableError);
    expect(() => createSpriteBackend('fal')).toThrow(/no backend implemented/);
  });

  it('refuses pixellab without a key rather than failing mid-request', () => {
    expect(() => createSpriteBackend('pixellab')).toThrow(/no PixelLab API key/);
    expect(() => createSpriteBackend('pixellab', { pixellab: { apiKey: '' } }))
      .toThrow(SpriteBackendUnavailableError);
  });

  it('refuses replicate without model/provider wiring', () => {
    expect(() => createSpriteBackend('replicate')).toThrow(/no img2img model\/providers/);
  });

  it('builds the img2img backend for a configured replicate model', async () => {
    const { dispatch, cfg } = img2imgDeps();
    const be = createSpriteBackend('replicate', { replicate: cfg });
    expect(be.provider).toBe('replicate');
    expect(be.model).toBe('qwen/qwen-image-edit-2511');
    const res = await be.generate({ prompt: 'repaint', init: { pngDataUri: PNG_URI } });
    expect(res.costUsd).toBeCloseTo(0.03);
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0].cfg).toBe(PROVIDERS);
    expect(dispatch.calls[0].opts).toEqual({
      initImageDataUri: PNG_URI,
      prompt: 'repaint',
      model: 'qwen/qwen-image-edit-2511',
      signal: undefined,
    });
  });

  it('lists only the providers it could actually build', () => {
    expect(availableProviders({})).toEqual([]);
    expect(availableProviders({ pixellab: { apiKey: '' } })).toEqual([]);
    const { cfg } = img2imgDeps();
    expect(availableProviders({ pixellab: { apiKey: 'k' }, replicate: cfg, mock: {} }))
      .toEqual(['pixellab', 'replicate', 'mock']);
  });
});

// ─── The img2img backend is a different animal, and says so ───────────────────

describe('img2img backend', () => {
  it('declares an editor: init required, no seed/size/denoise/negative', () => {
    expect(IMG2IMG_CAPABILITIES).toEqual({
      init: 'required', seed: false, size: false, denoise: false, negative: false, abort: true,
    });
  });

  it('refuses a job with no init image instead of generating from nothing', async () => {
    const { cfg } = img2imgDeps();
    const be = createImg2ImgBackend(cfg);
    await expect(be.generate({ prompt: 'p' })).rejects.toThrow(SpriteJobUnsupportedError);
    await expect(be.generate({ prompt: 'p' })).rejects.toThrow(/supplied none/);
  });

  it('reports every field it had to ignore rather than implying it honoured them', async () => {
    const { cfg } = img2imgDeps();
    const be = createImg2ImgBackend(cfg);
    const res = await be.generate({
      prompt: 'p',
      negative: 'blurry',
      width: 64,
      height: 64,
      seed: 7,
      init: { pngDataUri: PNG_URI, denoise01: 0.2 },
    });
    expect(res.ignored).toEqual(['negative', 'width', 'height', 'seed', 'denoise01']);
  });

  it('passes an AbortSignal through — cancellation it really does support', async () => {
    const { dispatch, cfg } = img2imgDeps();
    const be = createImg2ImgBackend(cfg);
    const ctl = new AbortController();
    const res = await be.generate({ prompt: 'p', init: { pngDataUri: PNG_URI }, signal: ctl.signal });
    expect(res.ignored).toEqual([]);
    expect(dispatch.calls[0].opts.signal).toBe(ctl.signal);
  });

  it('refuses an OpenRouter-routed model: AssetProvider cannot name its host', () => {
    expect(() => createImg2ImgBackend({
      model: 'google/gemini-2.5-flash-image',
      providers: PROVIDERS,
    })).toThrow(SpriteBackendUnavailableError);
    expect(() => createImg2ImgBackend({
      model: 'black-forest-labs/flux.2-klein-4b',
      providers: PROVIDERS,
    })).toThrow(/widen AssetProvider deliberately/);
  });
});

// ─── The PixelLab backend keeps its provider-shaped fields to itself ──────────

describe('pixellab backend', () => {
  it('maps denoise01 onto the 1–999 strength scale, default-preserving', () => {
    expect(denoiseToInitStrength(PIXELLAB_DEFAULT_DENOISE01)).toBe(300);
    expect(denoiseToInitStrength(0)).toBe(999);
    expect(denoiseToInitStrength(1)).toBe(1);
    // Out-of-range input clamps rather than producing an invalid request.
    expect(denoiseToInitStrength(-3)).toBe(999);
    expect(denoiseToInitStrength(9)).toBe(1);
  });

  it('translates a job into a pixflux request: bare base64, negative, seed, meta', async () => {
    const pl = fakePixelLab();
    const be = createPixelLabBackend({ apiKey: 'pl-key', generateFn: pl.fn });
    const job: SpriteJob = {
      prompt: 'an acolyte',
      negative: 'blurry',
      width: 48,
      height: 64,
      seed: 11,
      init: { pngDataUri: PNG_URI, denoise01: PIXELLAB_DEFAULT_DENOISE01 },
      meta: { kind: 'npc-sprite', tags: ['cult'], lineage: 'lpc-derived' },
    };
    const res = await be.generate(job);
    expect(res.ignored).toEqual([]);
    expect(pl.calls).toHaveLength(1);
    expect(pl.calls[0].apiKey).toBe('pl-key');
    const opts = pl.calls[0].opts;
    expect(opts.initImage).toBe('AAAA'); // data-URI prefix stripped
    expect(opts.initImageStrength).toBe(300);
    expect(opts.negativeDescription).toBe('blurry');
    expect(opts.seed).toBe(11);
    expect(opts.width).toBe(48);
    expect(opts.height).toBe(64);
    expect(opts.kind).toBe('npc-sprite');
    expect(opts.lineage).toBe('lpc-derived');
  });

  it('reports a cache hit and no cost — PixelLab bills generations, not dollars', async () => {
    const pl = fakePixelLab();
    const be = createPixelLabBackend({ apiKey: 'k', generateFn: pl.fn });
    const res = await be.generate({ prompt: 'p', width: 32, height: 32 });
    expect(res.cached).toBe(true);
    expect(res.costUsd).toBeUndefined();
    expect(res.provider).toBe('pixellab');
    expect(res.model).toBe('pixflux');
    expect(pl.calls[0].opts.initImage).toBeUndefined();
  });

  it('refuses a sizeless job — it has no size of its own to fall back on', async () => {
    const pl = fakePixelLab();
    const be = createPixelLabBackend({ apiKey: 'k', generateFn: pl.fn });
    await expect(be.generate({ prompt: 'p' })).rejects.toThrow(/no width\/height/);
    await expect(be.generate({ prompt: 'p', width: 32 })).rejects.toThrow(SpriteJobUnsupportedError);
    expect(pl.calls).toHaveLength(0);
  });

  it('reports the AbortSignal it cannot honour', async () => {
    const pl = fakePixelLab();
    const be = createPixelLabBackend({ apiKey: 'k', generateFn: pl.fn });
    const res = await be.generate({
      prompt: 'p', width: 32, height: 32, signal: new AbortController().signal,
    });
    expect(res.ignored).toEqual(['signal']);
  });
});

// ─── The pure capability predicates ───────────────────────────────────────────

const FULL: SpriteBackendCapabilities = {
  init: 'optional', seed: true, size: true, denoise: true, negative: true, abort: true,
};

describe('capability predicates', () => {
  it('ignores nothing when the backend can do everything', () => {
    const job: SpriteJob = {
      prompt: 'p', negative: 'n', width: 8, height: 8, seed: 1,
      init: { pngDataUri: PNG_URI, denoise01: 0.5 }, signal: new AbortController().signal,
    };
    expect(unsupportedJobFields(FULL, job)).toEqual([]);
    expect(jobRefusal(FULL, job)).toBeNull();
  });

  it('only reports fields the job actually set', () => {
    const caps: SpriteBackendCapabilities = { ...FULL, seed: false, negative: false };
    expect(unsupportedJobFields(caps, { prompt: 'p', width: 8, height: 8 })).toEqual([]);
    expect(unsupportedJobFields(caps, { prompt: 'p', width: 8, height: 8, seed: 0 }))
      .toEqual(['seed']);
  });

  it('treats an init a backend cannot take as fatal, not as a field to drop', () => {
    const caps: SpriteBackendCapabilities = { ...FULL, init: 'unsupported' };
    const job: SpriteJob = { prompt: 'p', width: 8, height: 8, init: { pngDataUri: PNG_URI } };
    expect(jobRefusal(caps, job)).toMatch(/init-referenced gates/);
    expect(() => acceptJob('mock', caps, job)).toThrow(SpriteJobUnsupportedError);
  });

  it('lets a mock narrow its powers so a pipeline can be tested against a weak backend', async () => {
    const be = createMockBackend({ capabilities: { seed: false, size: false } });
    const res = await be.generate({ prompt: 'p', seed: 3, width: 16, height: 16 });
    expect(res.ignored).toEqual(['width', 'height', 'seed']);
    expect(be.calls).toHaveLength(1);
  });

  it('gives identical bytes for identical jobs (deterministic stand-in)', async () => {
    const be = createMockBackend();
    const job: SpriteJob = { prompt: 'p', width: 32, height: 32, seed: 4 };
    const a = await (await be.generate(job)).blob.text();
    const b = await (await be.generate(job)).blob.text();
    expect(a).toBe(b);
  });
});
