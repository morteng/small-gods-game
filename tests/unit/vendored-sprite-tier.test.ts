// The VENDORED tier of the parametric sprite cache (WP-H): tier order is
// memory → IDB → vendored static bundle → compose. Mocked fetch serves an
// in-memory bundle built with the REAL encoder, so hits are byte-exact WP-G
// payloads. Covers: vendored hit (skips compose, write-through to IDB, one
// fetch ever), vendored miss (composes), corrupt blob (falls through),
// manifest failure (tier disabled for the session, fetched once), no-IDB
// operation, and the shard-fetch concurrency cap.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { canonicalJson } from '@/render/generated-art-cache';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { blueprintEntity } from '@/blueprint/entity';
import { synthesizeBlueprint } from '@/blueprint/presets';
import {
  parametricSpriteKey, readParametricSprite, encodeSpritePayload, spriteCacheStats,
  _resetParametricSpriteDbForTesting, type CachedSpritePayload,
} from '@/render/parametric-sprite-cache';
import { _resetVendoredSpriteBundleForTesting, type VendoredManifest } from '@/render/vendored-sprite-bundle';
import type { StructureSpec } from '@/assetgen/compose';
import type { SpritePack } from '@/render/iso/sprite-canvas';
import type { Entity } from '@/core/types';

const flush = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - t0 > ms) throw new Error('until(): timed out');
    await flush(5);
  }
}

function noiseBuf(n: number, seed: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n);
  let h = seed | 0;
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) | 0; out[i] = (h >>> 16) & 0xff; }
  return out;
}

function makePayload(seed = 1): CachedSpritePayload {
  const w = 3, h = 2, px = w * h * 4;
  return {
    w, h,
    grey: noiseBuf(px, seed), normal: noiseBuf(px, seed + 1), material: noiseBuf(px, seed + 2),
    anchors: { doors: [], vents: [], wallEnds: [{ x: 0.25, y: 1 }] },
  };
}

/** Build an in-memory bundle (manifest + shards) with the REAL encoder. */
async function buildBundle(
  entries: Array<{ key: string; payload: CachedSpritePayload; shard?: number }>,
): Promise<{ manifest: VendoredManifest; shardBytes: Map<string, Uint8Array> }> {
  const shards: Array<{ file: string; parts: Uint8Array[]; bytes: number }> = [];
  const packs: VendoredManifest['packs'] = {};
  for (const e of entries) {
    const idx = e.shard ?? 0;
    while (shards.length <= idx) shards.push({ file: `shard-${String(shards.length).padStart(3, '0')}.bin`, parts: [], bytes: 0 });
    const rec = await encodeSpritePayload(e.payload);
    const buf = new Uint8Array(rec.buf);
    packs[e.key] = { s: idx, o: shards[idx].bytes, l: buf.byteLength, enc: rec.enc, meta: rec.meta };
    shards[idx].parts.push(buf);
    shards[idx].bytes += buf.byteLength;
  }
  const shardBytes = new Map<string, Uint8Array>();
  for (const s of shards) {
    const buf = new Uint8Array(s.bytes);
    let off = 0;
    for (const p of s.parts) { buf.set(p, off); off += p.byteLength; }
    shardBytes.set(s.file, buf);
  }
  const manifest: VendoredManifest = {
    recipeVersion: ART_RECIPE_VERSION,
    count: entries.length,
    totalBytes: shards.reduce((n, s) => n + s.bytes, 0),
    shards: shards.map((s) => ({ file: s.file, bytes: s.bytes })),
    packs,
  };
  return { manifest, shardBytes };
}

/** Stub global fetch to serve the bundle; returns per-URL call counters. */
function stubBundleFetch(
  manifest: VendoredManifest | null,
  shardBytes: Map<string, Uint8Array>,
  opts: { corruptShards?: boolean } = {},
): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/manifest.json')) {
      if (!manifest) return new Response('nope', { status: 404 });
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    const file = u.split('/').pop()!;
    const bytes = shardBytes.get(file);
    if (!bytes) return new Response('nope', { status: 404 });
    const body = opts.corruptShards ? new Uint8Array(bytes.length).fill(7) : bytes;
    return new Response(body.slice().buffer, { status: 200 });
  }));
  return { calls };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  _resetParametricSpriteDbForTesting();
  _resetVendoredSpriteBundleForTesting();
});
afterEach(() => {
  _resetParametricSpriteDbForTesting();
  _resetVendoredSpriteBundleForTesting();
  vi.unstubAllGlobals();
});

describe('tier order: IDB miss → vendored bundle', () => {
  it('a vendored hit returns the byte-exact payload, counts vendoredHits, and writes through to IDB (one fetch ever)', async () => {
    const key = parametricSpriteKey('bld', 'vendored-hit');
    const p = makePayload(11);
    const { manifest, shardBytes } = await buildBundle([{ key, payload: p }]);
    const { calls } = stubBundleFetch(manifest, shardBytes);

    const got = await readParametricSprite(key);
    expect(got).not.toBeNull();
    expect(Array.from(got!.grey)).toEqual(Array.from(p.grey));
    expect(Array.from(got!.material)).toEqual(Array.from(p.material));
    expect(got!.anchors).toEqual(p.anchors);
    expect(spriteCacheStats.vendoredHits).toBe(1);

    // Write-through lands in IDB…
    await until(() => spriteCacheStats.writes >= 1);
    const fetchesSoFar = calls.length;
    // …so a FRESH session (vendored state reset, fetch now failing) still hits IDB.
    _resetVendoredSpriteBundleForTesting();
    const again = await readParametricSprite(key);
    expect(again).not.toBeNull();
    expect(Array.from(again!.grey)).toEqual(Array.from(p.grey));
    expect(calls.length).toBe(fetchesSoFar); // IDB hit — vendored never consulted again
  });

  it('slices the right pack out of a multi-pack shard (offset math)', async () => {
    const k1 = parametricSpriteKey('bar', 'first');
    const k2 = parametricSpriteKey('bar', 'second');
    const p1 = makePayload(21), p2 = makePayload(42);
    const { manifest, shardBytes } = await buildBundle([{ key: k1, payload: p1 }, { key: k2, payload: p2 }]);
    stubBundleFetch(manifest, shardBytes);
    const got2 = await readParametricSprite(k2);
    expect(got2).not.toBeNull();
    expect(Array.from(got2!.grey)).toEqual(Array.from(p2.grey));
    const got1 = await readParametricSprite(k1);
    expect(Array.from(got1!.grey)).toEqual(Array.from(p1.grey));
    expect(spriteCacheStats.vendoredHits).toBe(2);
  });

  it('a key absent from the manifest resolves null (→ compose) and counts a miss', async () => {
    const { manifest, shardBytes } = await buildBundle([{ key: parametricSpriteKey('bld', 'other'), payload: makePayload() }]);
    stubBundleFetch(manifest, shardBytes);
    expect(await readParametricSprite(parametricSpriteKey('bld', 'absent'))).toBeNull();
    expect(spriteCacheStats.vendoredHits).toBe(0);
    expect(spriteCacheStats.misses).toBe(1);
  });

  it('corrupt shard bytes decode to null and fall through to compose — never throw', async () => {
    const key = parametricSpriteKey('bld', 'corrupt');
    // Compressible payload → enc='deflate-raw', so corrupted bytes FAIL inflation.
    // (A raw-encoded record has no redundancy — corruption there is undetectable,
    // which is fine: the transport (HTTP+IDB) is already integrity-checked; this
    // guards the decode path never throwing.)
    const px = 3 * 2 * 4;
    const payload: CachedSpritePayload = {
      w: 3, h: 2,
      grey: new Uint8ClampedArray(px).fill(120), normal: new Uint8ClampedArray(px).fill(128),
      material: new Uint8ClampedArray(px).fill(40), anchors: { doors: [], vents: [] },
    };
    const { manifest, shardBytes } = await buildBundle([{ key, payload }]);
    stubBundleFetch(manifest, shardBytes, { corruptShards: true });
    expect(await readParametricSprite(key)).toBeNull();
    expect(spriteCacheStats.vendoredHits).toBe(0);
    expect(spriteCacheStats.misses).toBe(1);
  });

  it('a missing manifest disables the tier for the session — fetched ONCE, reads resolve null', async () => {
    const { calls } = stubBundleFetch(null, new Map());
    expect(await readParametricSprite(parametricSpriteKey('bld', 'a'))).toBeNull();
    expect(await readParametricSprite(parametricSpriteKey('bld', 'b'))).toBeNull();
    expect(calls.filter((u) => u.endsWith('/manifest.json')).length).toBe(1);
    expect(calls.some((u) => u.includes('shard'))).toBe(false);
  });

  it('a manifest for a DIFFERENT recipe version is rejected (tier disabled)', async () => {
    const key = parametricSpriteKey('bld', 'stale');
    const { manifest, shardBytes } = await buildBundle([{ key, payload: makePayload() }]);
    stubBundleFetch({ ...manifest, recipeVersion: 'v0' }, shardBytes);
    expect(await readParametricSprite(key)).toBeNull();
  });

  it('works without IndexedDB at all: vendored still serves the payload', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const key = parametricSpriteKey('plt', 'no-idb');
    const p = makePayload(33);
    const { manifest, shardBytes } = await buildBundle([{ key, payload: p }]);
    stubBundleFetch(manifest, shardBytes);
    const got = await readParametricSprite(key);
    expect(got).not.toBeNull();
    expect(Array.from(got!.grey)).toEqual(Array.from(p.grey));
    expect(spriteCacheStats.vendoredHits).toBe(1);
  });

  it('caps concurrent shard fetches at 6 (no fetch storms)', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      key: parametricSpriteKey('bar', `cap-${i}`), payload: makePayload(i + 1), shard: i,
    }));
    const { manifest, shardBytes } = await buildBundle(entries);
    let active = 0, maxActive = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/manifest.json')) return new Response(JSON.stringify(manifest), { status: 200 });
      active++; maxActive = Math.max(maxActive, active);
      await flush(10);
      active--;
      const bytes = shardBytes.get(u.split('/').pop()!)!;
      return new Response(bytes.slice().buffer, { status: 200 });
    }));
    const got = await Promise.all(entries.map((e) => readParametricSprite(e.key)));
    expect(got.every((g) => g !== null)).toBe(true);
    expect(maxActive).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(6);
    // Drain this test's 12 write-throughs so they can't leak into a later
    // test's freshly-stubbed IDBFactory (the write chain is module-level).
    await until(() => spriteCacheStats.writes >= entries.length);
  });
});

describe('source-level: vendored hit skips compose entirely', () => {
  const spec: StructureSpec = { parts: [] };
  const cachedSprite: SpritePack = { albedo: { width: 10, height: 8 } as unknown as HTMLCanvasElement };
  const entity = (): Entity => blueprintEntity('b1', synthesizeBlueprint('cottage')!, 0, 0);

  it('ParametricBuildingSource on a COLD store: vendored serves the pack, ZERO composes scheduled', async () => {
    const key = parametricSpriteKey('bld', canonicalJson(spec));
    const p = makePayload(55);
    const { manifest, shardBytes } = await buildBundle([{ key, payload: p }]);
    stubBundleFetch(manifest, shardBytes);

    const compose = vi.fn(async () => { throw new Error('must not compose'); });
    const onWarm = vi.fn();
    const src = new ParametricBuildingSource({
      toSpec: () => spec, compose, packFromCache: () => cachedSprite, onWarm,
    });
    src.warm(entity());
    await until(() => src.peek(entity()) === cachedSprite);
    expect(compose).not.toHaveBeenCalled();
    expect(spriteCacheStats.vendoredHits).toBe(1);
    expect(onWarm).toHaveBeenCalledTimes(1);
    // Second boot (fresh source, vendored reset, fetch dead): the IDB
    // write-through must serve it. Kill the vendored tier FIRST, then wait for
    // the actual IDB record — a bare `writes >= 1` can be satisfied by a
    // leftover write from an earlier test still draining the module-level
    // write chain, racing our own write-through.
    _resetVendoredSpriteBundleForTesting();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await until(async () => (await readParametricSprite(key)) !== null);
    const src2 = new ParametricBuildingSource({
      toSpec: () => spec, compose, packFromCache: () => cachedSprite,
    });
    src2.warm(entity());
    await until(() => src2.peek(entity()) === cachedSprite);
    expect(compose).not.toHaveBeenCalled();
  });

  it('keepStages (studio) never touches the vendored tier', async () => {
    const key = parametricSpriteKey('bld', canonicalJson(spec));
    const { manifest, shardBytes } = await buildBundle([{ key, payload: makePayload() }]);
    const { calls } = stubBundleFetch(manifest, shardBytes);
    const fakeSprite: SpritePack = { albedo: { width: 4, height: 4 } as unknown as HTMLCanvasElement };
    const compose = vi.fn(async () => ({
      grey: noiseBuf(64, 1), normal: noiseBuf(64, 2), material: noiseBuf(64, 3),
      emissive: new Uint8ClampedArray(64), size: 4, bbox: { x: 1, y: 1, w: 2, h: 2 },
      anchors: { doors: [], vents: [] }, meta: { bbox: { x: 1, y: 1, w: 2, h: 2 }, anchors: { doors: [], vents: [] } },
    }));
    const src = new ParametricBuildingSource({
      toSpec: () => spec, compose: compose as never, toSprite: () => fakeSprite, keepStages: true,
    });
    src.warm(entity());
    await until(() => src.peek(entity()) === fakeSprite);
    expect(compose).toHaveBeenCalledTimes(1); // fresh compose, stages retained
    expect(calls.length).toBe(0);             // no manifest, no shards
  });
});
