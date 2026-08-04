import { describe, it, expect, vi } from 'vitest';
import { GeneratedNpcArtSource, type NpcArtRequest, type GeneratedNpcSourceDeps } from '@/render/generated-npc-art-source';
import { NPC_ART_RECIPE_VERSION } from '@/core/content-version';
import { compositeOverChroma } from '@/render/chroma-key';
import { type Raster, cropRaster, opaqueBBox } from '@/render/sprite-postprocess';
import { nearestUpscale, padRaster, assembleStrip } from '@/assetgen/npc-sprite-pipeline';
import { createMockBackend, type MockSpriteBackend } from '@/assetgen/compilers/mock-backend';
import type { SpriteJob } from '@/assetgen/compilers/backend';

const CELL = 64;

/** A rig-frame stand-in: a solid body rect on a transparent cell. */
function poseFrame(rgb: [number, number, number] = [120, 140, 110]): Raster {
  const r: Raster = { data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL };
  for (let py = 10; py < 50; py++) {
    for (let px = 20; px < 44; px++) {
      const o = (py * CELL + px) * 4;
      r.data[o] = rgb[0]; r.data[o + 1] = rgb[1]; r.data[o + 2] = rgb[2]; r.data[o + 3] = 255;
    }
  }
  return r;
}

/** What a well-behaved model sends back: the pose, upscaled, on the magenta
 *  backdrop it was shown — passes every G0 gate. */
function goodGeneration(frame: Raster): Raster {
  const bb = opaqueBBox(frame)!;
  const padded = padRaster(nearestUpscale(cropRaster(frame, bb), 4), 16);
  return { data: compositeOverChroma(padded.data), w: padded.w, h: padded.h };
}

/** A model that painted an opaque scene instead of honouring the chroma
 *  backdrop — fails the border-keyed gate every attempt. */
function badGeneration(): Raster {
  const r: Raster = { data: new Uint8ClampedArray(CELL * CELL * 4), w: CELL, h: CELL };
  for (let i = 0; i < CELL * CELL; i++) {
    const o = i * 4;
    r.data[o] = 40; r.data[o + 1] = 90; r.data[o + 2] = 40; r.data[o + 3] = 255;
  }
  return r;
}

function subject() {
  return { id: 'guard', name: 'a temple guard', wears: ['a grey tunic', 'leather sandals'] };
}

function request(over: Partial<NpcArtRequest> = {}): NpcArtRequest {
  return {
    subject: subject(),
    clip: 'march',
    facing: 'left',
    layerSetHash: 'wardrobe-h1',
    frames: [poseFrame()],
    ...over,
  };
}

interface Rig {
  src: GeneratedNpcArtSource;
  mock: MockSpriteBackend;
  cachePut: ReturnType<typeof vi.fn>;
  onSpend: ReturnType<typeof vi.fn>;
  decodeImage: ReturnType<typeof vi.fn>;
  cacheGet: ReturnType<typeof vi.fn>;
}

/** Wire a source whose backend answers are supplied by a queue (mirrors
 *  npc-sprite-gates.test.ts's `depsReturning`), so a test states exactly what
 *  "the model returned" per call without touching real IDB or a network. */
function makeSource(over: Partial<GeneratedNpcSourceDeps> = {}, genAnswers: Raster[] = []): Rig {
  const queue = [...genAnswers];
  const mock = createMockBackend({ costUsd: 0.01 });
  const decodeImage = vi.fn(async () => queue.shift() ?? goodGeneration(poseFrame()));
  const cachePut = vi.fn(async () => {});
  const onSpend = vi.fn();
  const cacheGet = vi.fn(async () => null);
  const src = new GeneratedNpcArtSource({
    enabled: () => true,
    canSpend: () => true,
    model: () => 'm',
    backend: () => mock,
    onSpend,
    decodeImage,
    encodeInit: async () => 'data:image/png;base64,AAAA',
    encodeStrip: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
    cacheGet,
    baseGet: async () => null,
    cachePut,
    cacheFailed: async () => false,
    recordFailure: async () => {},
    ...over,
  });
  return { src, mock, cachePut, onSpend, decodeImage, cacheGet };
}

describe('GeneratedNpcArtSource — resolution order', () => {
  it('peek is null until warm resolves, then returns the redressed frames', async () => {
    const frame = poseFrame();
    const { src, mock } = makeSource({}, [goodGeneration(frame)]);
    const req = request({ frames: [frame] });
    expect(src.peek(req)).toBeNull();
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).not.toBeNull());
    expect(src.peek(req)!.frames).toHaveLength(1);
    expect(src.peek(req)!.frames[0].w).toBe(CELL);
    expect(src.peek(req)!.recipeVersion).toBe(NPC_ART_RECIPE_VERSION);
    expect(mock.calls).toHaveLength(1);
  });

  it('serves a cache hit without calling the backend', async () => {
    const frame = poseFrame();
    const strip = assembleStrip([frame]);
    const cacheGet = vi.fn(async () => ({ blob: new Blob(), frameCount: 1, cellW: CELL, cellH: CELL }));
    const { src, mock } = makeSource({ cacheGet, decodeImage: async () => strip });
    const req = request({ frames: [frame] });
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).not.toBeNull());
    expect(cacheGet).toHaveBeenCalledTimes(1);
    expect(mock.calls).toHaveLength(0);
    expect(src.peek(req)!.frames[0].data).toEqual(frame.data);
  });

  it('serves a vendored base-library hit without paying', async () => {
    const frame = poseFrame();
    const strip = assembleStrip([frame]);
    const baseGet = vi.fn(async () => ({ blob: new Blob(), frameCount: 1, cellW: CELL, cellH: CELL }));
    const { src, mock, cachePut } = makeSource({
      cacheGet: async () => null, baseGet, decodeImage: async () => strip,
    });
    const req = request({ frames: [frame] });
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).not.toBeNull());
    expect(baseGet).toHaveBeenCalledTimes(1);
    expect(mock.calls).toHaveLength(0);
    expect(cachePut).not.toHaveBeenCalled(); // static library stays the source of truth
  });

  it('serves free vendored/IDB art even when paid gen is DISABLED', async () => {
    // Regression guard mirroring the building source: enabled() must gate only
    // the PAID generateNpcSheet step, never the free cache/base-library reads.
    const frame = poseFrame();
    const strip = assembleStrip([frame]);
    const baseGet = vi.fn(async () => ({ blob: new Blob(), frameCount: 1, cellW: CELL, cellH: CELL }));
    const { src, mock } = makeSource({
      enabled: () => false, cacheGet: async () => null, baseGet, decodeImage: async () => strip,
    });
    const req = request({ frames: [frame] });
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).not.toBeNull());
    expect(baseGet).toHaveBeenCalledTimes(1);
    expect(mock.calls).toHaveLength(0);
  });

  it('does not generate when disabled or over budget → peek stays null', async () => {
    const a = makeSource({ enabled: () => false });
    const b = makeSource({ canSpend: () => false });
    const req = request();
    a.src.warm(req); b.src.warm(req);
    await Promise.resolve(); await Promise.resolve();
    expect(a.src.peek(req)).toBeNull();
    expect(b.src.peek(req)).toBeNull();
    expect(a.mock.calls).toHaveLength(0);
    expect(b.mock.calls).toHaveLength(0);
  });

  it('over budget caches null → does not re-enter run()/re-read cache every warm', async () => {
    const { src, cacheGet } = makeSource({ canSpend: () => false });
    const req = request();
    src.warm(req); await vi.waitFor(() => expect(cacheGet).toHaveBeenCalledTimes(1));
    src.warm(req); src.warm(req); await Promise.resolve(); await Promise.resolve();
    expect(cacheGet).toHaveBeenCalledTimes(1);
  });

  it('skips a previously-failed key without paying', async () => {
    const cacheFailed = vi.fn(async () => true);
    const { src, mock } = makeSource({ cacheFailed });
    const req = request();
    src.warm(req);
    await vi.waitFor(() => expect(cacheFailed).toHaveBeenCalledTimes(1));
    await Promise.resolve(); await Promise.resolve();
    expect(mock.calls).toHaveLength(0);
    expect(src.peek(req)).toBeNull();
  });

  it('identical requests share one generation', async () => {
    const frame = poseFrame();
    const { src, mock } = makeSource({}, [goodGeneration(frame), goodGeneration(frame)]);
    src.warm(request({ frames: [frame] }));
    src.warm(request({ frames: [frame] }));
    await vi.waitFor(() => expect(mock.calls.length).toBeGreaterThan(0));
    await Promise.resolve();
    expect(mock.calls).toHaveLength(1);
  });
});

describe('GeneratedNpcArtSource — validate before persist', () => {
  it('a null sheet (every gate refuses) persists nothing and records a failure', async () => {
    const recordFailure = vi.fn(async () => {});
    const { src, mock, cachePut } = makeSource({ recordFailure }, [badGeneration(), badGeneration()]);
    const req = request();
    src.warm(req);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(2)); // one retry, inside the pipeline
    await vi.waitFor(() => expect(recordFailure).toHaveBeenCalledTimes(1));
    expect(src.peek(req)).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('a decode/network throw is session-only (never marked failed, never persisted)', async () => {
    const recordFailure = vi.fn(async () => {});
    const { src, cachePut } = makeSource({
      recordFailure,
      backend: () => ({
        provider: 'mock', model: 'm',
        capabilities: { init: 'required', seed: false, size: false, denoise: false, negative: false, abort: true },
        generate: () => { throw new Error('network boom'); },
      }),
    });
    const req = request();
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).toBeNull());
    expect(recordFailure).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('persists the assembled strip PNG + frame layout on success', async () => {
    const frame = poseFrame();
    const { src, cachePut } = makeSource({}, [goodGeneration(frame)]);
    const req = request({ frames: [frame] });
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).not.toBeNull());
    expect(cachePut).toHaveBeenCalledTimes(1);
    const [, , meta] = cachePut.mock.calls[0] as [string, Blob, { frameCount: number; cellW: number; cellH: number }];
    expect(meta.frameCount).toBe(1);
    expect(meta.cellW).toBe(CELL);
    expect(meta.cellH).toBe(CELL);
  });

  it('reports real spend even on a refused (gate-failed) generation', async () => {
    // G0's generateNpcSheet drops its accumulated cost when a sheet is refused
    // post-spend — the source recovers it by wrapping backend.generate rather
    // than trusting NpcSheetResult.costUsd, so the session cap never loses it.
    const onSpend = vi.fn();
    const { src, mock } = makeSource({ onSpend }, [badGeneration(), badGeneration()]);
    const req = request();
    src.warm(req);
    await vi.waitFor(() => expect(mock.calls).toHaveLength(2));
    await vi.waitFor(() => expect(onSpend).toHaveBeenCalled());
    const total = onSpend.mock.calls.reduce((s: number, call) => s + (call[0] as number), 0);
    expect(total).toBeCloseTo(0.02, 6); // two billed attempts, both rejected
  });
});

describe('GeneratedNpcArtSource — cache key sensitivity', () => {
  // These drive `warm()` end-to-end (not just generatedNpcArtKey in isolation,
  // covered in generated-npc-art-cache.test.ts) so a regression in keyOf()
  // itself — e.g. one field silently dropped — would show up as a shared
  // generation where the test expects two independent ones. Each case gets its
  // own fresh source: two requests sharing a source and a key would dedupe at
  // `warm()` and never issue a second `cacheGet` call at all.
  async function firstKey(req: NpcArtRequest, model: () => string = () => 'm'): Promise<string> {
    const seen: string[] = [];
    const cacheGet = vi.fn(async (key: string) => { seen.push(key); return null; });
    const { src } = makeSource({ cacheGet, model });
    src.warm(req);
    await vi.waitFor(() => expect(src.peek(req)).not.toBeNull());
    return seen[0];
  }

  it('differs when the clip differs', async () => {
    const a = await firstKey(request({ clip: 'march' }));
    const b = await firstKey(request({ clip: 'walk' }));
    expect(a).not.toBe(b);
  });

  it('differs when the facing differs', async () => {
    const a = await firstKey(request({ facing: 'left' }));
    const b = await firstKey(request({ facing: 'right' }));
    expect(a).not.toBe(b);
  });

  it('differs when the wardrobe layer-set identity differs', async () => {
    const a = await firstKey(request({ layerSetHash: 'h1' }));
    const b = await firstKey(request({ layerSetHash: 'h2' }));
    expect(a).not.toBe(b);
  });

  it('differs when the model differs', async () => {
    const a = await firstKey(request(), () => 'model-a');
    const b = await firstKey(request(), () => 'model-b');
    expect(a).not.toBe(b);
  });

  // The recipe version itself (also part of the key, per generatedNpcArtKey)
  // is a module-level constant with no per-request seam to vary here — its
  // sensitivity is covered directly in generated-npc-art-cache.test.ts.

  it('is otherwise identical: the same request never generates twice', async () => {
    const cacheGet = vi.fn(async () => null);
    const { src } = makeSource({ cacheGet });
    src.warm(request());
    await vi.waitFor(() => expect(cacheGet).toHaveBeenCalledTimes(1));
    src.warm(request()); // structurally identical, different object — must dedupe
    await Promise.resolve(); await Promise.resolve();
    expect(cacheGet).toHaveBeenCalledTimes(1);
  });
});

describe('GeneratedNpcArtSource — concurrency limit', () => {
  it('limits concurrent paid generations', async () => {
    let active = 0, maxActive = 0;
    const releases: Array<() => void> = [];
    const backend = {
      provider: 'mock' as const, model: 'm',
      capabilities: { init: 'required' as const, seed: false, size: false, denoise: false, negative: false, abort: true },
      generate: (_job: SpriteJob) => new Promise<{ blob: Blob; provider: 'mock'; model: string; costUsd: number; ignored: [] }>((res) => {
        active++; maxActive = Math.max(maxActive, active);
        releases.push(() => {
          active--;
          res({ blob: new Blob([new Uint8Array([1])], { type: 'image/png' }), provider: 'mock', model: 'm', costUsd: 0.01, ignored: [] });
        });
      }),
    };
    const decodeImage = vi.fn(async () => goodGeneration(poseFrame()));
    const src = new GeneratedNpcArtSource({
      enabled: () => true, canSpend: () => true, model: () => 'm',
      backend: () => backend,
      decodeImage,
      encodeInit: async () => 'data:image/png;base64,AAAA',
      encodeStrip: async () => new Blob([new Uint8Array([9])], { type: 'image/png' }),
      cacheGet: async () => null, baseGet: async () => null,
      cachePut: async () => {}, cacheFailed: async () => false, recordFailure: async () => {},
    });
    for (const layerSetHash of ['w1', 'w2', 'w3', 'w4']) src.warm(request({ layerSetHash }));
    await vi.waitFor(() => expect(active).toBeGreaterThanOrEqual(1));
    await Promise.resolve();
    expect(maxActive).toBeLessThanOrEqual(2);
    while (releases.length) releases.shift()!();
  });
});
