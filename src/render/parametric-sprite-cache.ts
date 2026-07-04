// src/render/parametric-sprite-cache.ts
//
// Persistent IndexedDB cache of COMPOSED parametric sprites (buildings, barrier
// elements, plants). `composeStructure` is deterministic given its spec but
// CPU-heavy (~330ms/job; a cold default-world boot queues ~376 jobs ≈ 2 minutes
// of raw compose CPU). This store pays that cost ONCE per ART_RECIPE_VERSION:
// the three parametric sources check it before scheduling a compose, and
// write-behind after a miss composes.
//
// FIDELITY: the cached payload is the CROPPED raw typed-array form of exactly
// what `structureResultToPack` derives from a StructureResult — albedo/normal/
// emissive crops (the same integer-rect crop `greyToSpriteCanvas` performs),
// the material crop (a DATA map: A=metallic, RGB meaningful where A=0 — it must
// NEVER round-trip through a premultiplied 2D canvas, so it is stored and
// rebuilt raw, mirroring `cropRgba`), the ground shadow already foot-relative,
// and the normalised StructureAnchors (barrier placement reads these). Buffers
// serialize as raw bytes, optionally deflated via CompressionStream
// ('deflate-raw') with a raw fallback — never via canvas/PNG encode.
//
// Keys are CONTENT-ADDRESSED over the compose INPUT (the StructureSpec / the
// barrier element key), namespaced per source (compose options differ), with
// ART_RECIPE_VERSION baked in — a recipe bump or any spec/param change simply
// misses. Stale-version records are purged (by key prefix, keys-only scan) on
// first open.
//
// Every open/txn races `withIdbTimeout` and every failure degrades silently to
// composing — a wedged backing store must never stall the art path (see the
// IDB gotcha in CLAUDE.md; mirrors src/render/generated-art-cache.ts).
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { withIdbTimeout } from '@/services/idb-guard';
import { readVendoredSprite } from '@/render/vendored-sprite-bundle';
import type { StructureResult, StructureAnchors } from '@/assetgen/compose';
import { cropRgba, rgbaToCanvas, hasEmissivePixels, type SpritePack } from '@/render/iso/sprite-canvas';

const DB_NAME = 'small-gods-parametric-sprites';
const DB_VERSION = 1;
const DB_STORE = 'sprites';
const PAYLOAD_FORMAT = 1;

/** Namespace per source — compose options differ per source (buildings pass
 *  surfaceTexture+yaw, barriers surfaceTexture, plants neither), so the same
 *  spec hash must never collide across sources. */
export type SpriteCacheNamespace = 'bld' | 'bar' | 'plt';

/** The serializable form of one composed sprite: exactly the data
 *  `structureResultToPack` derives, cropped to the opaque bbox. */
export interface CachedSpritePayload {
  /** Crop dims (Math.round(bbox.w/h), min 1 — same as the pack crop). */
  w: number; h: number;
  grey: Uint8ClampedArray;      // albedo crop, w*h*4
  normal: Uint8ClampedArray;    // normal crop, w*h*4
  material: Uint8ClampedArray;  // material DATA crop, w*h*4 (A=metallic)
  emissive?: Uint8ClampedArray; // only when the full render had any glow
  /** Ground shadow, offset already relative to the albedo crop's bottom-centre
   *  foot anchor (precomputed from bbox at capture time). */
  shadow?: { data: Uint8ClampedArray; w: number; h: number; dx: number; dy: number };
  /** Normalised (opaque-bbox 0..1) structure anchors — barrier elements read
   *  wallEnds/tags for placement; pack.tags comes from anchors.tags. */
  anchors: StructureAnchors;
}

interface SpriteRecord {
  key: string;
  recipeVersion: string;
  createdAt: number;
  meta: string;                  // JSON header: dims, anchors, shadow meta, segment lengths
  enc: 'deflate-raw' | 'raw';
  buf: ArrayBuffer;              // concatenated buffers, possibly deflated
}

interface RecordMeta {
  v: number; w: number; h: number;
  anchors: StructureAnchors;
  shadow?: { w: number; h: number; dx: number; dy: number };
  hasEmissive: boolean;
  segs: number[];                // raw (pre-deflate) byte length per segment
}

/** Session diagnostics — surfaced as `__spriteCacheStats` (mirrors __composeStats). */
export const spriteCacheStats = {
  hits: 0,
  misses: 0,
  writes: 0,
  bytesRead: 0,
  bytesWritten: 0,
  errors: 0,
  /** IDB misses served by the static vendored bundle (WP-H) instead of composing. */
  vendoredHits: 0,
  vendoredBytes: 0,
};
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__spriteCacheStats = spriteCacheStats;
}

// ── keys ─────────────────────────────────────────────────────────────────────

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
function sdbm(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (s.charCodeAt(i) + (h << 6) + (h << 16) - h) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Content-addressed key over the compose INPUT. Pass the canonical string form
 * of whatever fully determines the composed pixels for that namespace (buildings
 * and plants: `canonicalJson(spec)`; barriers: the element's content key).
 * Two independent 32-bit hashes + the input length (~64 bits + discriminator)
 * make a silent collision — which would show the wrong sprite — negligible.
 * ART_RECIPE_VERSION is baked in, so a recipe bump misses automatically.
 */
export function parametricSpriteKey(ns: SpriteCacheNamespace, material: string): string {
  return `${ART_RECIPE_VERSION}:${ns}:${djb2(material)}:${sdbm(material)}:${material.length.toString(36)}`;
}

const keyPrefix = (): string => `${ART_RECIPE_VERSION}:`;

// ── payload ⇄ StructureResult / SpritePack ──────────────────────────────────

/** Capture the cacheable payload from a fresh compose result. Null if the
 *  result is degenerate. Pure typed-array work — no canvas anywhere. */
export function payloadFromResult(r: StructureResult): CachedSpritePayload | null {
  try {
    const grey = cropRgba(r.grey, r.size, r.bbox);
    const normal = cropRgba(r.normal, r.size, r.bbox);
    const material = cropRgba(r.material, r.size, r.bbox);
    if (!grey || !normal || !material) return null;
    const payload: CachedSpritePayload = {
      w: grey.w, h: grey.h,
      grey: grey.data, normal: normal.data, material: material.data,
      anchors: r.anchors,
    };
    // Same gate as structureResultToPack: only carry emissive when the FULL
    // render has any glow (most sprites are window-less).
    if (hasEmissivePixels(r.emissive)) {
      const em = cropRgba(r.emissive, r.size, r.bbox);
      if (em) payload.emissive = em.data;
    }
    if (r.shadow) {
      // Precompute the foot-relative offset structureResultToPack derives from
      // bbox, so the cached form needs no bbox at all.
      const footX = r.bbox.x + r.bbox.w / 2, footY = r.bbox.y + r.bbox.h;
      payload.shadow = {
        data: r.shadow.data, w: r.shadow.w, h: r.shadow.h,
        dx: r.shadow.ox - footX, dy: r.shadow.oy - footY,
      };
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Rebuild a draw-ready SpritePack from a cached payload. Pixel-identical to the
 * fresh `structureResultToPack` path: putImageData of the same cropped bytes
 * lands the same premultiplied backing values as the full-buffer putImageData +
 * integer-rect drawImage crop, and the material map stays RAW (`materialData`),
 * never touching a premultiplied canvas. Null where no 2D canvas exists
 * (jsdom) — callers fall back to composing.
 */
export function packFromPayload(p: CachedSpritePayload): SpritePack | null {
  try {
    const albedo = rgbaToCanvas(p.grey, p.w, p.h);
    if (!albedo) return null;
    const pack: SpritePack = {
      albedo,
      normal: rgbaToCanvas(p.normal, p.w, p.h) ?? undefined,
      materialData: { data: p.material, w: p.w, h: p.h },
    };
    if (p.emissive) pack.emissive = rgbaToCanvas(p.emissive, p.w, p.h) ?? undefined;
    if (p.shadow) {
      const canvas = rgbaToCanvas(p.shadow.data, p.shadow.w, p.shadow.h);
      if (canvas) pack.shadow = { canvas, dx: p.shadow.dx, dy: p.shadow.dy };
    }
    if (p.anchors.tags?.length) pack.tags = p.anchors.tags;
    return pack;
  } catch {
    // e.g. a half-implemented canvas (jsdom has a 2D ctx object but no ImageData):
    // degrade to composing rather than ever throwing near the frame path.
    return null;
  }
}

// ── codec (raw typed arrays, optional deflate — NEVER canvas/PNG) ───────────

async function deflate(u8: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    // Fresh copy — some impls detach chunk buffers. Swallow the writer promises:
    // any stream error surfaces via the Response read below; an unhandled write
    // rejection must not escape.
    writer.write(u8.slice()).catch(() => {});
    writer.close().catch(() => {});
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  } catch { return null; }
}

async function inflate(buf: ArrayBuffer): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') return null;
  try {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(buf).slice()).catch(() => {});
    writer.close().catch(() => {});
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  } catch { return null; }
}

/** Serialize a payload to a storable record body. Exported for tests. */
export async function encodeSpritePayload(
  p: CachedSpritePayload,
): Promise<{ meta: string; enc: 'deflate-raw' | 'raw'; buf: ArrayBuffer }> {
  const segs: Uint8ClampedArray[] = [p.grey, p.normal, p.material];
  if (p.emissive) segs.push(p.emissive);
  if (p.shadow) segs.push(p.shadow.data);
  const total = segs.reduce((n, s) => n + s.byteLength, 0);
  const raw = new Uint8Array(total);
  let off = 0;
  for (const s of segs) { raw.set(new Uint8Array(s.buffer, s.byteOffset, s.byteLength), off); off += s.byteLength; }
  const meta: RecordMeta = {
    v: PAYLOAD_FORMAT, w: p.w, h: p.h, anchors: p.anchors,
    hasEmissive: !!p.emissive,
    ...(p.shadow ? { shadow: { w: p.shadow.w, h: p.shadow.h, dx: p.shadow.dx, dy: p.shadow.dy } } : {}),
    segs: segs.map((s) => s.byteLength),
  };
  const deflated = await deflate(raw);
  return deflated && deflated.byteLength < raw.byteLength
    ? { meta: JSON.stringify(meta), enc: 'deflate-raw', buf: deflated.buffer as ArrayBuffer }
    : { meta: JSON.stringify(meta), enc: 'raw', buf: raw.buffer as ArrayBuffer };
}

/** Deserialize a record body back to a payload — byte-exact. Null on any
 *  corruption / unsupported format (caller degrades to composing). */
export async function decodeSpritePayload(
  rec: { meta: string; enc: 'deflate-raw' | 'raw'; buf: ArrayBuffer },
): Promise<CachedSpritePayload | null> {
  try {
    const meta = JSON.parse(rec.meta) as RecordMeta;
    if (meta.v !== PAYLOAD_FORMAT || !Array.isArray(meta.segs)) return null;
    const raw = rec.enc === 'deflate-raw' ? await inflate(rec.buf) : new Uint8Array(rec.buf);
    if (!raw) return null;
    const total = meta.segs.reduce((n, s) => n + s, 0);
    if (raw.byteLength !== total) return null;
    const bufs: Uint8ClampedArray[] = [];
    let off = 0;
    for (const len of meta.segs) {
      bufs.push(new Uint8ClampedArray(raw.buffer, raw.byteOffset + off, len));
      off += len;
    }
    const expected = 3 + (meta.hasEmissive ? 1 : 0) + (meta.shadow ? 1 : 0);
    if (bufs.length !== expected) return null;
    const px = meta.w * meta.h * 4;
    if (bufs[0].byteLength !== px || bufs[1].byteLength !== px || bufs[2].byteLength !== px) return null;
    // Copy out of the shared inflate buffer so each map owns its bytes.
    const payload: CachedSpritePayload = {
      w: meta.w, h: meta.h,
      grey: bufs[0].slice(), normal: bufs[1].slice(), material: bufs[2].slice(),
      anchors: meta.anchors,
    };
    let i = 3;
    if (meta.hasEmissive) {
      if (bufs[i].byteLength !== px) return null;
      payload.emissive = bufs[i++].slice();
    }
    if (meta.shadow) {
      if (bufs[i].byteLength !== meta.shadow.w * meta.shadow.h * 4) return null;
      payload.shadow = { data: bufs[i].slice(), w: meta.shadow.w, h: meta.shadow.h, dx: meta.shadow.dx, dy: meta.shadow.dy };
    }
    return payload;
  } catch {
    return null;
  }
}

// ── guarded IDB store ────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;
let _housekept = false;

export function _resetParametricSpriteDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
  _housekept = false;
  spriteCacheStats.hits = 0; spriteCacheStats.misses = 0; spriteCacheStats.writes = 0;
  spriteCacheStats.bytesRead = 0; spriteCacheStats.bytesWritten = 0; spriteCacheStats.errors = 0;
  spriteCacheStats.vendoredHits = 0; spriteCacheStats.vendoredBytes = 0;
}

function hasIdb(): boolean { return typeof indexedDB !== 'undefined' && indexedDB !== null; }

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return withIdbTimeout(new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      _db = req.result;
      resolve(_db);
      if (!_housekept) { _housekept = true; void housekeep(_db); }
    };
    req.onerror = () => reject(req.error);
  }), 'open');
}

/** Purge records from other recipe versions (keys-only scan — the version rides
 *  in the key prefix) + the one dev summary line. Best-effort, fire-and-forget. */
async function housekeep(db: IDBDatabase): Promise<void> {
  try {
    const keys = await withIdbTimeout(new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }), 'keys');
    const prefix = keyPrefix();
    const stale = keys.filter((k) => typeof k === 'string' && !k.startsWith(prefix));
    if (stale.length) {
      await withIdbTimeout(new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        for (const k of stale) store.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }), 'purge');
    }
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.info(`[parametric-sprite-cache] ${keys.length - stale.length} entries at ${ART_RECIPE_VERSION}${stale.length ? ` (purged ${stale.length} stale)` : ''} — live stats: __spriteCacheStats`);
    }
  } catch { /* best-effort housekeeping only */ }
}

// Reads are MICRO-BATCHED: a warm boot fires ~400 reads in one burst, and both
// naive shapes fail under that load —
//   • fully concurrent: hundreds of get-transactions racing 4s withIdbTimeout
//     timers starve each other's event delivery past the deadline (measured
//     live: 166/393 warm reads "timed out" → needless composes);
//   • strictly serial, one txn per get: ~55ms of per-transaction overhead each
//     (measured idle) → a 2-minute warm drain.
// Batching N gets into ONE readonly transaction amortizes the txn overhead to
// ~nothing, keeps at most one txn in flight (deadline starts when the batch
// RUNS, so the guard stays honest), and decodes sequentially so inflate work
// spreads instead of bursting.
// 16 keeps a batch's txn under the 4s guard even on a saturated main thread
// (measured worst case: 32 gets ≈ 5.4s on a tab rendering the full map; halving
// the batch halves it). A timed-out batch degrades to composing — correct but
// wasteful, so stay under the deadline.
const READ_BATCH_MAX = 16;

interface PendingRead { key: string; resolve: (p: CachedSpritePayload | null) => void }
const pendingReads: PendingRead[] = [];
let readPumping = false;

// ── vendored tier (WP-H): IDB miss → static bundle fetch → compose ──────────
//
// An IDB miss consults the pregenerated bundle under
// `public/data/parametric-sprites/<ART_RECIPE_VERSION>/` before the caller
// composes. A vendored hit is decoded (same codec — the blobs ARE the WP-G
// record format) and written THROUGH to IDB so the network is paid once ever;
// any failure (no bundle, missing key, corrupt bytes) resolves null and the
// caller composes, exactly as before this tier existed. Fired without awaiting
// inside the read pump so N misses fetch concurrently (the bundle module caps
// shard-fetch concurrency itself). The studio's keepStages paths never call
// readParametricSprite, so they skip this tier the same way they skip IDB.
function resolveViaVendored(pr: PendingRead): void {
  void (async () => {
    try {
      const rec = await readVendoredSprite(pr.key);
      if (rec) {
        const payload = await decodeSpritePayload(rec);
        if (payload) {
          spriteCacheStats.vendoredHits++;
          spriteCacheStats.vendoredBytes += rec.buf.byteLength;
          // Write-through (fire-and-forget; no-ops without IDB, swallows failure).
          void writeParametricSprite(pr.key, payload);
          pr.resolve(payload);
          return;
        }
      }
    } catch { /* degrade to composing */ }
    spriteCacheStats.misses++;
    pr.resolve(null);
  })();
}

async function pumpReads(): Promise<void> {
  readPumping = true;
  // Yield one macrotask before the first splice so a synchronous warm burst
  // (every visible entity in one frame) lands in full batches, not a batch of 1.
  await new Promise<void>((r) => setTimeout(r, 0));
  while (pendingReads.length) {
    const batch = pendingReads.splice(0, READ_BATCH_MAX);
    let recs: Array<SpriteRecord | undefined>;
    try {
      const db = await openDb();
      recs = await withIdbTimeout(new Promise<Array<SpriteRecord | undefined>>((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const out = new Array<SpriteRecord | undefined>(batch.length);
        batch.forEach((b, i) => {
          const req = store.get(b.key);
          req.onsuccess = () => { out[i] = req.result as SpriteRecord | undefined; };
        });
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      }), 'read');
    } catch {
      // Wedged/absent IDB: the vendored tier can still serve the sprite (its
      // write-through simply degrades too).
      spriteCacheStats.errors += batch.length;
      for (const b of batch) resolveViaVendored(b);
      continue;
    }
    for (let i = 0; i < batch.length; i++) {
      const rec = recs[i];
      if (!rec || rec.recipeVersion !== ART_RECIPE_VERSION) { resolveViaVendored(batch[i]); continue; }
      const payload = await decodeSpritePayload(rec);
      if (!payload) { resolveViaVendored(batch[i]); continue; }
      spriteCacheStats.hits++;
      spriteCacheStats.bytesRead += rec.buf.byteLength;
      batch[i].resolve(payload);
    }
  }
  readPumping = false;
}

/**
 * Read a cached sprite payload. Null on miss / stale version / corruption /
 * absent-or-wedged IDB — the caller composes instead. Never rejects.
 */
export function readParametricSprite(key: string): Promise<CachedSpritePayload | null> {
  return new Promise((resolve) => {
    // No IDB at all (private-mode edge / stripped context): the vendored tier
    // can still serve the sprite; its IDB write-through no-ops.
    if (!hasIdb()) { resolveViaVendored({ key, resolve }); return; }
    pendingReads.push({ key, resolve });
    if (!readPumping) void pumpReads();
  });
}

async function doWrite(key: string, payload: CachedSpritePayload): Promise<void> {
  try {
    const body = await encodeSpritePayload(payload);
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        key, recipeVersion: ART_RECIPE_VERSION, createdAt: Date.now(), ...body,
      } satisfies SpriteRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'write');
    spriteCacheStats.writes++;
    spriteCacheStats.bytesWritten += body.buf.byteLength;
  } catch {
    spriteCacheStats.errors++;
  }
}

// Writes are SERIALIZED through one chain: a cold boot fires ~400 write-behinds
// while the compose backlog is still hogging the main thread, and hundreds of
// CONCURRENT put-transactions all racing 4s withIdbTimeout timers starve each
// other's oncomplete delivery past the deadline (measured live: 382/392 writes
// "timed out" yet committed anyway). One in-flight txn at a time keeps event
// delivery prompt and the guard honest; a rejected/wedged write never breaks
// the chain for later ones.
let writeChain: Promise<void> = Promise.resolve();

/**
 * Write-behind persist of a freshly composed sprite. Fire-and-forget: never
 * blocks sprite availability, swallows every failure. The returned promise
 * settles when THIS write has been processed (tests await it).
 */
export function writeParametricSprite(key: string, payload: CachedSpritePayload): Promise<void> {
  if (!hasIdb()) return Promise.resolve();
  const p = writeChain.then(() => doWrite(key, payload));
  writeChain = p;
  return p;
}

/** Drop everything (dev tooling / tests). */
export async function clearParametricSprites(): Promise<void> {
  if (!hasIdb()) return;
  try {
    const db = await openDb();
    await withIdbTimeout(new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }), 'clear');
  } catch { /* degrade */ }
}
