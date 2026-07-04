// Persistent parametric-sprite cache: codec fidelity (byte-equal round-trip,
// incl. the material DATA map), content-addressed keys pinned to
// ART_RECIPE_VERSION, graceful degradation without IndexedDB, and the
// IDB write→read round-trip + stale-version purge (fake-indexeddb).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { canonicalJson } from '@/render/generated-art-cache';
import type { StructureResult } from '@/assetgen/compose';
import {
  parametricSpriteKey, payloadFromResult, packFromPayload,
  encodeSpritePayload, decodeSpritePayload,
  readParametricSprite, writeParametricSprite,
  _resetParametricSpriteDbForTesting,
  type CachedSpritePayload,
} from '@/render/parametric-sprite-cache';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > ms) throw new Error('until(): timed out');
    await flush(5);
  }
}

/** Deterministic pseudo-random RGBA buffer (includes A=0 pixels with live RGB). */
function noiseBuf(n: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n);
  let h = seed | 0;
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) | 0; out[i] = (h >>> 16) & 0xff; }
  return out;
}

function makePayload(withExtras = true): CachedSpritePayload {
  const w = 3, h = 2, px = w * h * 4;
  // Material is a DATA map: force A=0 with meaningful RGB on the first pixel —
  // exactly the case a premultiplied canvas round-trip would destroy.
  const material = noiseBuf(px, 7);
  material[0] = 200; material[1] = 150; material[2] = 90; material[3] = 0;
  const p: CachedSpritePayload = {
    w, h,
    grey: noiseBuf(px, 1), normal: noiseBuf(px, 3), material,
    anchors: { doors: [], vents: [], wallEnds: [{ x: 0.25, y: 1 }] },
  };
  if (withExtras) {
    p.emissive = noiseBuf(px, 11);
    p.shadow = { data: noiseBuf(2 * 4 * 4, 13), w: 2, h: 4, dx: -3.5, dy: 1.25 };
  }
  return p;
}

function fakeStructureResult(): StructureResult {
  const size = 4, px = size * size * 4;
  const bbox = { x: 1, y: 1, w: 2, h: 2 };
  const material = noiseBuf(px, 21);
  material[(1 * size + 1) * 4 + 3] = 0; // A=0 inside the crop, RGB live
  return {
    grey: noiseBuf(px, 17), normal: noiseBuf(px, 19), material,
    emissive: noiseBuf(px, 23), size, bbox,
    anchors: { doors: [], vents: [], wallEnds: [{ x: 0.25, y: 1 }] },
    meta: { bbox, anchors: { doors: [], vents: [] } },
    shadow: { data: noiseBuf(2 * 2 * 4, 29), w: 2, h: 2, ox: 1.5, oy: 2.5 },
  };
}

describe('codec round-trip (fidelity is non-negotiable)', () => {
  it('serialize→deserialize is BYTE-EQUAL for every map, including the material DATA map', async () => {
    const p = makePayload();
    const rec = await encodeSpritePayload(p);
    const back = await decodeSpritePayload(rec);
    expect(back).not.toBeNull();
    expect(Array.from(back!.grey)).toEqual(Array.from(p.grey));
    expect(Array.from(back!.normal)).toEqual(Array.from(p.normal));
    expect(Array.from(back!.material)).toEqual(Array.from(p.material));
    expect(Array.from(back!.emissive!)).toEqual(Array.from(p.emissive!));
    expect(Array.from(back!.shadow!.data)).toEqual(Array.from(p.shadow!.data));
    expect(back!.shadow).toMatchObject({ w: 2, h: 4, dx: -3.5, dy: 1.25 });
    expect(back!.w).toBe(p.w); expect(back!.h).toBe(p.h);
    expect(back!.anchors).toEqual(p.anchors);
    // A=0 material pixel kept its RGB — the premultiply-destruction case.
    expect(back!.material[3]).toBe(0);
    expect([back!.material[0], back!.material[1], back!.material[2]]).toEqual([200, 150, 90]);
  });

  it('round-trips without emissive/shadow (window-less, flat geometry)', async () => {
    const p = makePayload(false);
    const back = await decodeSpritePayload(await encodeSpritePayload(p));
    expect(back).not.toBeNull();
    expect(back!.emissive).toBeUndefined();
    expect(back!.shadow).toBeUndefined();
    expect(Array.from(back!.material)).toEqual(Array.from(p.material));
  });

  /** Real sprites are large and full of flat runs — highly compressible. (The tiny
   *  noise payloads above deflate LARGER than raw, and the codec correctly keeps raw.) */
  function compressiblePayload(): CachedSpritePayload {
    const w = 32, h = 32, px = w * h * 4;
    return {
      w, h,
      grey: new Uint8ClampedArray(px).fill(120),
      normal: new Uint8ClampedArray(px).fill(128),
      material: new Uint8ClampedArray(px).fill(40),
      anchors: { doors: [], vents: [] },
    };
  }

  it('compresses via deflate-raw when available (and round-trips byte-equal)', async () => {
    const p = compressiblePayload();
    const rec = await encodeSpritePayload(p);
    expect(rec.enc).toBe('deflate-raw'); // Node ≥18 has CompressionStream
    expect(rec.buf.byteLength).toBeLessThan(3 * 32 * 32 * 4);
    const back = await decodeSpritePayload(rec);
    expect(Array.from(back!.material)).toEqual(Array.from(p.material));
  });

  it('falls back to RAW encoding when CompressionStream is unavailable — still byte-equal', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    try {
      const p = makePayload();
      const rec = await encodeSpritePayload(p);
      expect(rec.enc).toBe('raw');
      const back = await decodeSpritePayload(rec);
      expect(Array.from(back!.material)).toEqual(Array.from(p.material));
      expect(Array.from(back!.grey)).toEqual(Array.from(p.grey));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a deflate record read where DecompressionStream is missing degrades to null (→ compose)', async () => {
    const rec = await encodeSpritePayload(compressiblePayload());
    expect(rec.enc).toBe('deflate-raw');
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      expect(await decodeSpritePayload(rec)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('corrupt meta / truncated buffers decode to null, never throw', async () => {
    const rec = await encodeSpritePayload(makePayload());
    expect(await decodeSpritePayload({ ...rec, meta: 'not json' })).toBeNull();
    expect(await decodeSpritePayload({ ...rec, buf: rec.buf.slice(0, 8) })).toBeNull();
    expect(await decodeSpritePayload({ ...rec, meta: JSON.stringify({ v: 99 }) })).toBeNull();
  });
});

describe('payloadFromResult', () => {
  it('captures the same crops structureResultToPack derives + foot-relative shadow offsets', () => {
    const r = fakeStructureResult();
    const p = payloadFromResult(r)!;
    expect(p.w).toBe(2); expect(p.h).toBe(2);
    // Crop of a 4×4 buffer at bbox (1,1,2,2): row-by-row byte equality vs manual crop.
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const so = ((y + 1) * 4 + (x + 1)) * 4, di = (y * 2 + x) * 4;
        for (let c = 0; c < 4; c++) {
          expect(p.grey[di + c]).toBe(r.grey[so + c]);
          expect(p.material[di + c]).toBe(r.material[so + c]);
        }
      }
    }
    // dx = ox − (bbox.x + w/2) = 1.5 − 2 = −0.5; dy = oy − (bbox.y + h) = 2.5 − 3 = −0.5
    expect(p.shadow).toMatchObject({ dx: -0.5, dy: -0.5, w: 2, h: 2 });
    expect(p.anchors).toEqual(r.anchors);
    expect(p.emissive).toBeDefined(); // fake emissive has non-black pixels
  });

  it('omits emissive when the full render has no glow (same gate as the live pack)', () => {
    const r = fakeStructureResult();
    r.emissive = new Uint8ClampedArray(r.size * r.size * 4); // all black
    expect(payloadFromResult(r)!.emissive).toBeUndefined();
  });
});

describe('packFromPayload', () => {
  it('returns null without a canvas backend (jsdom) — sources degrade to composing', () => {
    expect(packFromPayload(makePayload())).toBeNull();
  });

  it('with a canvas backend: albedo non-null, RAW materialData, shadow offset + tags preserved', () => {
    class FakeOffscreen {
      width: number; height: number;
      constructor(w: number, h: number) { this.width = w; this.height = h; }
      getContext(): { putImageData: (d: unknown, x: number, y: number) => void } {
        return { putImageData: () => {} };
      }
    }
    class FakeImageData {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreen);
    vi.stubGlobal('ImageData', FakeImageData);
    try {
      const p = makePayload();
      p.anchors = { doors: [], vents: [], tags: [{ x: 0.5, y: 0.25, kind: 'sign' as never, z: 1 }] };
      const pack = packFromPayload(p)!;
      expect(pack).not.toBeNull();
      expect(pack.albedo).toBeTruthy();
      expect(pack.normal).toBeTruthy();
      // Material stays a RAW data map — never a canvas.
      expect(pack.materialData).toBeDefined();
      expect(pack.materialData!.w).toBe(p.w);
      expect(Array.from(pack.materialData!.data)).toEqual(Array.from(p.material));
      expect(pack.shadow).toMatchObject({ dx: -3.5, dy: 1.25 });
      expect(pack.emissive).toBeTruthy();
      expect(pack.tags).toEqual(p.anchors.tags);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('keys', () => {
  it('bakes in ART_RECIPE_VERSION and the namespace', () => {
    const k = parametricSpriteKey('bld', 'material');
    expect(k.startsWith(`${ART_RECIPE_VERSION}:bld:`)).toBe(true);
    expect(parametricSpriteKey('bar', 'material')).not.toBe(k);
    expect(parametricSpriteKey('plt', 'material')).not.toBe(k);
  });

  it('is stable across object property order (via canonicalJson) and changes with any param', () => {
    const a = canonicalJson({ parts: [{ prim: 'box', size: [1, 2, 3] }], yaw: 0.5 });
    const b = canonicalJson({ yaw: 0.5, parts: [{ size: [1, 2, 3], prim: 'box' }] });
    expect(parametricSpriteKey('bld', a)).toBe(parametricSpriteKey('bld', b));
    const c = canonicalJson({ parts: [{ prim: 'box', size: [1, 2, 3] }], yaw: 0.75 });
    expect(parametricSpriteKey('bld', c)).not.toBe(parametricSpriteKey('bld', a));
  });
});

describe('graceful degradation without IndexedDB', () => {
  it('read resolves null and write resolves silently', async () => {
    vi.stubGlobal('indexedDB', undefined);
    _resetParametricSpriteDbForTesting();
    try {
      expect(await readParametricSprite(parametricSpriteKey('bld', 'x'))).toBeNull();
      await expect(writeParametricSprite(parametricSpriteKey('bld', 'x'), makePayload())).resolves.toBeUndefined();
    } finally {
      _resetParametricSpriteDbForTesting();
      vi.unstubAllGlobals();
    }
  });
});

describe('IDB store (fake-indexeddb)', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    _resetParametricSpriteDbForTesting();
  });
  afterEach(() => {
    _resetParametricSpriteDbForTesting();
    vi.unstubAllGlobals();
  });

  it('write→read round-trips the payload byte-equal through a real object store', async () => {
    const key = parametricSpriteKey('bld', 'roundtrip');
    const p = makePayload();
    await writeParametricSprite(key, p);
    const back = await readParametricSprite(key);
    expect(back).not.toBeNull();
    expect(Array.from(back!.material)).toEqual(Array.from(p.material));
    expect(Array.from(back!.grey)).toEqual(Array.from(p.grey));
    expect(back!.shadow).toMatchObject({ dx: -3.5, dy: 1.25 });
  });

  it('a missing key reads null', async () => {
    expect(await readParametricSprite(parametricSpriteKey('bld', 'absent'))).toBeNull();
  });

  it('purges records from other recipe versions on first open (keys-only scan)', async () => {
    const staleKey = 'v0:bld:stale:stale:1';
    // Seed a stale-version record through the raw API.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('small-gods-parametric-sprites', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sprites', { keyPath: 'key' });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('sprites', 'readwrite');
        tx.objectStore('sprites').put({ key: staleKey, recipeVersion: 'v0', createdAt: 0, meta: '{}', enc: 'raw', buf: new ArrayBuffer(4) });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    _resetParametricSpriteDbForTesting();
    // Any read opens the DB, which kicks the fire-and-forget housekeeping purge.
    await readParametricSprite(parametricSpriteKey('bld', 'anything'));
    await until(async () => {
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = indexedDB.open('small-gods-parametric-sprites', 1);
        req.onsuccess = () => {
          const db = req.result;
          const kq = db.transaction('sprites', 'readonly').objectStore('sprites').getAllKeys();
          kq.onsuccess = () => { db.close(); resolve(kq.result); };
          kq.onerror = () => reject(kq.error);
        };
        req.onerror = () => reject(req.error);
      });
      return !keys.includes(staleKey);
    });
  });
});
