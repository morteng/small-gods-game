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
    src.warm(e); await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('serves a cache hit without calling generate', async () => {
    const { src, generate } = makeSource({ cacheGet: async () => ({ blob: new Blob(), targetWidth: 256 }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
    expect(generate).not.toHaveBeenCalled();
  });

  it('serves a vendored base-library hit without paying (IDB miss, base hit)', async () => {
    const baseGet = vi.fn(async () => ({ blob: new Blob(), targetWidth: 256 }));
    const { src, generate, cachePut } = makeSource({ cacheGet: async () => null, baseGet });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
    expect(baseGet).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(cachePut).not.toHaveBeenCalled(); // static library stays the source of truth
  });

  it('serves free vendored/IDB art even when paid gen is DISABLED (the freeze must not hide shipped sprites)', async () => {
    // Regression: warm() must consult the free base library regardless of enabled().
    // enabled() gates only PAID generation; a shipped img2img sprite must still load
    // while the reseed freeze is on, or every building falls back to grey massing.
    const baseGet = vi.fn(async () => ({ blob: new Blob(), targetWidth: 256 }));
    const { src, generate } = makeSource({ enabled: () => false, cacheGet: async () => null, baseGet });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
    expect(baseGet).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled(); // free art served; nothing paid
  });

  it('passes the blueprint preset to baseGet so in-world variants reuse their preset sprite', async () => {
    // Regression: an in-world building's exact key embeds variant parts/materials and
    // misses the bare-preset seed key. fetchFromBaseLibrary falls back to the preset,
    // so warm() must forward rb.preset as the 2nd baseGet arg (else no fallback possible).
    const baseGet = vi.fn(async () => ({ blob: new Blob(), targetWidth: 256 }));
    const { src } = makeSource({ cacheGet: async () => null, baseGet });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
    expect(baseGet).toHaveBeenCalledWith(expect.any(String), 'cottage');
  });

  it('decodes the normal into a canvas + pairs a NEUTRAL material (never the material canvas)', async () => {
    // The material map is a DATA map (alpha 0) that a 2D canvas decode zeroes → AO 0 →
    // sprite lit BLACK. So the source drops the per-building material entirely and pairs
    // the real normal with a shared neutral materialData (which also flips `lit` on).
    const NORMAL = {} as unknown as HTMLCanvasElement;
    const normalBlob = new Blob([new Uint8Array([2])]);
    // Tag each decoded raster with the canvas it maps to so rasterToSprite is
    // order-independent (albedo is decoded first but rasterized last now).
    const { src } = makeSource({
      cacheGet: async () => ({ blob: new Blob(), targetWidth: 256, normal: normalBlob }),
      decodeImage: async (b: Blob) => ({ ...goodLlm(), __c: b === normalBlob ? NORMAL : SPRITE }),
      rasterToSprite: (r: { __c?: HTMLCanvasElement }) => r.__c ?? SPRITE,
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    const pack = src.peek(e)!;
    expect(pack.albedo).toBe(SPRITE);
    expect(pack.normal).toBe(NORMAL);
    expect(pack.material).toBeUndefined();            // never the (black-inducing) material canvas
    expect(pack.materialData).toBeDefined();          // neutral material ⇒ lit path on
    expect(pack.materialData!.data[1]).toBe(255);     // G=255 ⇒ AO 1
    expect(pack.materialData!.data[3]).toBe(0);       // A=0   ⇒ dielectric
  });

  it('a hit without a normal yields an unlit pack (albedo only, no neutral material)', async () => {
    const { src } = makeSource({ cacheGet: async () => ({ blob: new Blob(), targetWidth: 256 }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    expect(src.peek(e)!.normal).toBeUndefined();
    expect(src.peek(e)!.material).toBeUndefined();
    expect(src.peek(e)!.materialData).toBeUndefined(); // no normal ⇒ nothing to light with
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

  it('a quality-gate failure persists a negative marker (no re-pay next load)', async () => {
    const recordFailure = vi.fn(async () => {});
    // opaque background → border gate fails both attempts → genuine bad generation.
    const { src, generate } = makeSource({ decodeImage: async () => opaqueBgLlm(), recordFailure });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(recordFailure).toHaveBeenCalledTimes(1));
    expect(src.peek(e)).toBeNull();
  });

  it('a decode/network throw is session-only (NOT marked failed — stays retryable)', async () => {
    const recordFailure = vi.fn(async () => {});
    const { src } = makeSource({ generate: vi.fn(async () => { throw new Error('net'); }), recordFailure });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).toBeNull());
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('skips a previously-failed key without paying (cacheFailed → true)', async () => {
    const cacheFailed = vi.fn(async () => true);
    const { src, generate } = makeSource({ cacheGet: async () => null, cacheFailed });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(cacheFailed).toHaveBeenCalledTimes(1));
    await Promise.resolve(); await Promise.resolve();
    expect(generate).not.toHaveBeenCalled();
    expect(src.peek(e)).toBeNull();
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

describe('GeneratedBuildingArtSource emissive + provenance', () => {
  // Tagged-raster trick (same as the normal-map test above): decodeImage marks each
  // raster with the canvas its source blob should map to, so rasterToSprite proves
  // WHICH blob each pack slot was decoded from, order-independently.
  const NORMAL = {} as unknown as HTMLCanvasElement;
  const EMISSIVE = {} as unknown as HTMLCanvasElement;
  const normalBlob = new Blob([new Uint8Array([2])]);
  const emissiveBlob = new Blob([new Uint8Array([3])]);
  const tagged = {
    decodeImage: async (b: Blob) =>
      ({ ...goodLlm(), __c: b === emissiveBlob ? EMISSIVE : b === normalBlob ? NORMAL : SPRITE }),
    rasterToSprite: (r: { __c?: HTMLCanvasElement }) => r.__c ?? SPRITE,
  };

  it('decodes + attaches the cached emissive companion onto the pack', async () => {
    // Regression: the emissive blob was fetched + cached but never decoded, so painted
    // sprites had no emissive map and their windows could never glow at night.
    const { src } = makeSource({
      cacheGet: async () => ({ blob: new Blob(), targetWidth: 256, normal: normalBlob, emissive: emissiveBlob }),
      ...tagged,
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    const pack = src.peek(e)!;
    expect(pack.albedo).toBe(SPRITE);
    expect(pack.normal).toBe(NORMAL);
    expect(pack.emissive).toBe(EMISSIVE);
  });

  it('tolerates a hit without an emissive (older cached records)', async () => {
    const { src } = makeSource({
      cacheGet: async () => ({ blob: new Blob(), targetWidth: 256, normal: normalBlob }),
      ...tagged,
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    expect(src.peek(e)!.emissive).toBeUndefined();   // absent map ⇒ no glow, never a throw
  });

  it('attaches the freshly-produced emissive on the paid path too', async () => {
    const { src } = makeSource({
      produce: async () => ({
        initDataUri: 'data:image/png;base64,AA', mask: mask4(),
        normal: normalBlob, emissive: emissiveBlob, anchors: '{"vents":[]}',
      }),
      ...tagged,
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    expect(src.peek(e)!.emissive).toBe(EMISSIVE);
  });

  it('peekMeta is null before anything resolves and after a null (grey-fallback) resolve', async () => {
    const { src } = makeSource({ canSpend: () => false, cacheGet: async () => null });
    const e = entity('cottage');
    expect(src.peekMeta(e)).toBeNull();          // nothing resolved yet
    src.warm(e); await Promise.resolve(); await Promise.resolve();
    expect(src.peekMeta(e)).toBeNull();          // resolved to null (no art) ⇒ no provenance
  });

  it('peekMeta reports exact for an IDB hit (content-addressed ⇒ never stale)', async () => {
    const { src } = makeSource({ cacheGet: async () => ({ blob: new Blob(), targetWidth: 256 }) });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    expect(src.peekMeta(e)).toEqual({ resolved: 'exact' });
  });

  it('peekMeta propagates a preset-fallback provenance from the base library', async () => {
    const baseGet = vi.fn(async () => ({ blob: new Blob(), targetWidth: 256, provenance: 'preset-fallback' as const }));
    const { src } = makeSource({ cacheGet: async () => null, baseGet });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    expect(src.peekMeta(e)).toEqual({ resolved: 'preset-fallback' });
  });

  it('peekMeta reports exact for a freshly-generated sprite', async () => {
    const { src } = makeSource();
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
    expect(src.peekMeta(e)).toEqual({ resolved: 'exact' });
  });

  it('the REAL base library tags a preset-name fallback and fetches the emissive', async () => {
    // Drives the default fetchFromBaseLibrary (no baseGet override) against a stubbed
    // fetch: the manifest has NO entry at the exact content key, only one seeded from
    // the bare preset name — so the hit must come back tagged preset-fallback, with
    // normal + emissive companion blobs fetched alongside the albedo.
    const files: Record<string, Blob> = {
      'c.png': new Blob([new Uint8Array([1])]),
      'c.normal.png': normalBlob,
      'c.emissive.png': emissiveBlob,
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('manifest.json')) {
        return { ok: true, json: async () => ({ entries: {
          'some-other-exact-key': {
            file: 'c.png', targetWidth: 256, preset: 'cottage',
            normal: 'c.normal.png', emissive: 'c.emissive.png',
          },
        } }) };
      }
      const name = String(url).split('/').pop()!;
      return { ok: !!files[name], blob: async () => files[name] };
    }));
    try {
      const { src } = makeSource({ enabled: () => false, cacheGet: async () => null, ...tagged });
      const e = entity('cottage'); src.warm(e);
      await vi.waitFor(() => expect(src.peek(e)).not.toBeNull());
      expect(src.peek(e)!.normal).toBe(NORMAL);
      expect(src.peek(e)!.emissive).toBe(EMISSIVE);
      expect(src.peekMeta(e)).toEqual({ resolved: 'preset-fallback' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('GeneratedBuildingArtSource validation gate', () => {
  it('persists the PROCESSED sprite (not the raw LLM blob) with the companion pack', async () => {
    const normal = new Blob([new Uint8Array([2])]);
    const { src, cachePut, encoded } = makeSource({
      produce: async () => ({ initDataUri: 'data:image/png;base64,AA', mask: mask4(), normal, anchors: '{"vents":[]}' }),
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
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
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
    expect(cachePut).toHaveBeenCalledTimes(1);
  });

  it('a failed first attempt that succeeds on retry is persisted', async () => {
    let call = 0;
    const { src, generate, cachePut } = makeSource({
      decodeImage: async () => (++call === 1 ? opaqueBgLlm() : goodLlm()),
    });
    const e = entity('cottage'); src.warm(e);
    await vi.waitFor(() => expect(src.peek(e)?.albedo).toBe(SPRITE));
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
