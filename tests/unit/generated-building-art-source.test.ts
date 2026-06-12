import { describe, it, expect, vi } from 'vitest';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import type { Raster } from '@/render/sprite-postprocess';
import { CHROMA_RGB } from '@/render/chroma-key';
import type { Entity } from '@/core/types';

const SPRITE = {} as unknown as HTMLCanvasElement; // opaque stand-in
function entity(seed: string): Entity {
  return { id: 'b1', kind: 'cottage', x: 0, y: 0,
    properties: { blueprint: { rb: { preset: seed, footprint: { w: 2, h: 2 } } } } } as unknown as Entity;
}

function raster(w: number, h: number, fill: [number, number, number, number]): Raster {
  const r: Raster = { data: new Uint8ClampedArray(w * h * 4), w, h };
  for (let i = 0; i < w * h; i++) r.data.set(fill, i * 4);
  return r;
}
const MAGENTA: [number, number, number, number] = [...CHROMA_RGB, 255] as [number, number, number, number];

/** A well-behaved LLM result: magenta ring (keys out), solid red building inside. */
function goodLlm(): Raster {
  const r = raster(8, 8, MAGENTA);
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) r.data.set([200, 40, 30, 255], (y * 8 + x) * 4);
  return r;
}
/** Model ignored the chroma demand: opaque scenery to every edge. */
function opaqueBgLlm(): Raster { return raster(8, 8, [200, 40, 30, 255]); }
/** Model returned pure background: nothing survives keying. */
function emptyLlm(): Raster { return raster(8, 8, MAGENTA); }
/** Building drawn with a quadrant missing → silhouette IoU 0.75 vs the square mask. */
function lShapeLlm(): Raster {
  const r = goodLlm();
  for (let y = 1; y < 4; y++) for (let x = 4; x < 7; x++) r.data.set(MAGENTA, (y * 8 + x) * 4);
  return r;
}
/** Only two opposite quadrants drawn → silhouette IoU ~0.5: a gross mismatch
 *  that crop-to-bbox can't normalize away (unlike a plain offset/scale error). */
function checkerLlm(): Raster {
  const r = goodLlm();
  for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) {
    if ((x < 4) !== (y < 4)) r.data.set(MAGENTA, (y * 8 + x) * 4);
  }
  return r;
}

const mask4 = (): Raster => raster(4, 4, [0, 0, 0, 255]);

function makeSource(over = {}) {
  const generate = vi.fn(async () => new Blob([new Uint8Array([1])], { type: 'image/png' }));
  const cachePut = vi.fn(async () => {});
  const encoded = new Blob([new Uint8Array([7])], { type: 'image/png' });
  const src = new GeneratedBuildingArtSource({
    enabled: () => true, canSpend: () => true, model: () => 'm',
    prompt: () => 'P',
    produce: async () => ({ initDataUri: 'data:image/png;base64,AA', mask: mask4(), anchors: '{"vents":[]}' }),
    decodeImage: async () => goodLlm(),
    encodeRaster: async () => encoded,
    rasterToSprite: () => SPRITE,
    generate,
    cacheGet: async () => null, cachePut,
    ...over,
  });
  return { src, generate, cachePut, encoded };
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

  it('serves a vendored base-library hit without paying (IDB miss, base hit)', async () => {
    const baseGet = vi.fn(async () => ({ blob: new Blob(), targetWidth: 256 }));
    const { src, generate, cachePut } = makeSource({ cacheGet: async () => null, baseGet });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(baseGet).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled(); // static library stays the source of truth
  });

  it('does not generate when disabled or over budget → peek stays null', async () => {
    const a = makeSource({ enabled: () => false });
    const b = makeSource({ canSpend: () => false });
    const e = entity('cottage');
    a.src.warm(e); b.src.warm(e); await Promise.resolve(); await Promise.resolve();
    expect(a.src.peek(e)).toBeNull(); expect(b.src.peek(e)).toBeNull();
    expect(a.generate).not.toHaveBeenCalled(); expect(b.generate).not.toHaveBeenCalled();
  });

  it('over budget caches null → does not re-enter run() / re-read cache each frame', async () => {
    const cacheGet = vi.fn(async () => null);
    const { src } = makeSource({ canSpend: () => false, cacheGet });
    const e = entity('cottage');
    src.warm(e); await vi.waitFor(() => expect(cacheGet).toHaveBeenCalledTimes(1));
    src.warm(e); src.warm(e); await Promise.resolve(); await Promise.resolve();
    expect(cacheGet).toHaveBeenCalledTimes(1); // cached null after the first miss; no thrash
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

  it('blueprints with identical content but different key order share one generation', async () => {
    const { src, generate } = makeSource();
    const a = { id: 'b1', kind: 'cottage', x: 0, y: 0,
      properties: { blueprint: { rb: { preset: 'cottage', footprint: { w: 2, h: 2 } } } } } as unknown as Entity;
    const b = { id: 'b2', kind: 'cottage', x: 1, y: 1,
      properties: { blueprint: { rb: { footprint: { h: 2, w: 2 }, preset: 'cottage' } } } } as unknown as Entity;
    src.warm(a); src.warm(b);
    await vi.waitFor(() => expect(src.peek(a)).not.toBeNull());
    await vi.waitFor(() => expect(src.peek(b)).not.toBeNull());
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('GeneratedBuildingArtSource validation gate', () => {
  it('persists the PROCESSED sprite (not the raw LLM blob) with the companion pack', async () => {
    const normal = new Blob([new Uint8Array([2])]);
    const { src, cachePut, encoded } = makeSource({
      produce: async () => ({ initDataUri: 'data:image/png;base64,AA', mask: mask4(), normal, anchors: '{"vents":[]}' }),
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(cachePut).toHaveBeenCalledTimes(1);
    const [, blob, meta] = cachePut.mock.calls[0] as unknown as [string, Blob, { targetWidth: number; normal?: Blob; anchors?: string }];
    expect(blob).toBe(encoded);          // the registered/quantized PNG, not generate()'s output
    expect(meta.targetWidth).toBe(4);    // sprite is on the geometry mask grid
    expect(meta.normal).toBe(normal);
    expect(meta.anchors).toBe('{"vents":[]}');
  });

  it('rejects an opaque background (border did not key): retries once, never persists', async () => {
    const { src, generate, cachePut } = makeSource({ decodeImage: async () => opaqueBgLlm() });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(src.peek(e)).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('rejects an all-background result (nothing survives keying): retries once, never persists', async () => {
    const { src, generate, cachePut } = makeSource({ decodeImage: async () => emptyLlm() });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(src.peek(e)).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('rejects a gross silhouette mismatch below the IoU gate', async () => {
    const { src, generate, cachePut } = makeSource({ decodeImage: async () => checkerLlm() });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(src.peek(e)).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });

  it('tolerates moderate silhouette deviation (IoU 0.75 passes the relaxed gate)', async () => {
    const { src, cachePut } = makeSource({ decodeImage: async () => lShapeLlm() });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it('a failed first attempt that succeeds on retry is persisted', async () => {
    let call = 0;
    const { src, generate, cachePut } = makeSource({
      decodeImage: async () => (++call === 1 ? opaqueBgLlm() : goodLlm()),
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBe(SPRITE));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it('limits concurrent paid generations (a settlement does not fire one request per building)', async () => {
    let active = 0, maxActive = 0;
    const releases: Array<() => void> = [];
    const generate = vi.fn((_init: string, _prompt: string) => new Promise<Blob>(res => {
      active++; maxActive = Math.max(maxActive, active);
      releases.push(() => { active--; res(new Blob([new Uint8Array([1])], { type: 'image/png' })); });
    }));
    const { src } = makeSource({ generate });
    for (const preset of ['cottage', 'tavern', 'tower', 'shrine']) src.warm(entity(preset));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await Promise.resolve(); // give any extra (unwanted) generations a chance to start
    expect(maxActive).toBe(2);
    while (releases.length) releases.shift()!();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(4));
    expect(maxActive).toBe(2);
    while (releases.length) releases.shift()!();
  });

  it('an undecodable image fails immediately (no paid retry), never persists', async () => {
    const { src, generate, cachePut } = makeSource({ decodeImage: async () => null });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    // Let run() settle, then confirm the failure was cached: a re-warm is a no-op.
    await vi.waitFor(async () => {
      src.warm(e); await Promise.resolve();
      expect(generate).toHaveBeenCalledTimes(1);
    });
    expect(src.peek(e)).toBeNull();
    expect(cachePut).not.toHaveBeenCalled();
  });
});
