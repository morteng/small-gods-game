import { describe, it, expect, vi } from 'vitest';
import { GeneratedFloraArtSource } from '@/render/generated-flora-art-source';
import type { Raster } from '@/render/sprite-postprocess';
import { CHROMA_RGB } from '@/render/chroma-key';

const SPRITE = {} as unknown as HTMLCanvasElement; // opaque stand-in

function raster(w: number, h: number, fill: [number, number, number, number]): Raster {
  const r: Raster = { data: new Uint8ClampedArray(w * h * 4), w, h };
  for (let i = 0; i < w * h; i++) r.data.set(fill, i * 4);
  return r;
}
const MAGENTA: [number, number, number, number] = [...CHROMA_RGB, 255] as [number, number, number, number];

/** Well-behaved LLM result: magenta ring keys out, solid green plant inside. */
function goodLlm(): Raster {
  const r = raster(8, 8, MAGENTA);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) r.data.set([40, 120, 40, 255], (y * 8 + x) * 4);
  return r;
}
/** Model ignored the chroma demand: opaque to every edge. */
function opaqueBgLlm(): Raster { return raster(8, 8, [40, 120, 40, 255]); }

const mask4 = (): Raster => raster(4, 4, [0, 0, 0, 255]);

function makeSource(over: Record<string, unknown> = {}) {
  const generate = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' }));
  const cachePut = vi.fn(async () => {});
  const recordFailure = vi.fn(async () => {});
  const encoded = new Blob([new Uint8Array([7])], { type: 'image/png' });
  const src = new GeneratedFloraArtSource({
    enabled: () => true, canSpend: () => true, model: () => 'm',
    prompt: () => 'P',
    produce: async () => ({ initDataUri: 'data:image/png;base64,AA', mask: mask4(), anchors: '{}' }),
    decodeImage: async () => goodLlm(),
    encodeRaster: async () => encoded,
    rasterToSprite: () => SPRITE,
    generate,
    cacheGet: async () => null,
    baseGet: async () => null,
    cachePut,
    cacheFailed: async () => false,
    recordFailure,
    ...over,
  });
  return { src, generate, cachePut, recordFailure };
}

// 'english-oak' is a flora-DB species → isPlantPreset true → resolvable to a key.
const OAK = 'english-oak';

describe('GeneratedFloraArtSource', () => {
  it('peek is null before warm; non-plant kinds never resolve', () => {
    const { src } = makeSource();
    expect(src.peek(OAK)).toBeNull();
    // A building / unknown kind is not a plant preset → stays null even after warm.
    src.warm('cottage');
    expect(src.peek('cottage')).toBeNull();
  });

  it('warm → generate → register → caches a SpritePack for a species kind', async () => {
    const { src, generate, cachePut } = makeSource();
    src.warm(OAK);
    await vi.waitFor(() => expect(src.peek(OAK)).not.toBeNull());
    expect(generate).toHaveBeenCalledTimes(1);
    expect(cachePut).toHaveBeenCalledTimes(1);
    expect(src.peek(OAK)!.albedo).toBe(SPRITE);
  });

  it('does not generate when disabled (grey parametric fallback path)', async () => {
    const { src, generate } = makeSource({ enabled: () => false });
    src.warm(OAK);
    await new Promise((r) => setTimeout(r, 5));
    expect(generate).not.toHaveBeenCalled();
    expect(src.peek(OAK)).toBeNull();
  });

  it('a failed quality gate records a negative marker and never persists', async () => {
    const { src, cachePut, recordFailure } = makeSource({ decodeImage: async () => opaqueBgLlm() });
    src.warm(OAK);
    await vi.waitFor(() => expect(recordFailure).toHaveBeenCalled());
    expect(cachePut).not.toHaveBeenCalled();
    expect(src.peek(OAK)).toBeNull();
  });

  it('serves a cached/vendored hit without generating', async () => {
    const hitBlob = new Blob([new Uint8Array([9])], { type: 'image/png' });
    const { src, generate } = makeSource({
      cacheGet: async () => ({ blob: hitBlob, targetWidth: 4 }),
    });
    src.warm(OAK);
    await vi.waitFor(() => expect(src.peek(OAK)).not.toBeNull());
    expect(generate).not.toHaveBeenCalled();
  });

  it('skips paying when over budget', async () => {
    const { src, generate } = makeSource({ canSpend: () => false });
    src.warm(OAK);
    await new Promise((r) => setTimeout(r, 5));
    expect(generate).not.toHaveBeenCalled();
    expect(src.peek(OAK)).toBeNull(); // cached null so we don't re-enter every frame
  });
});
