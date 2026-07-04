// src/render/vendored-sprite-bundle.ts
//
// VENDORED parametric-sprite tier — static, author-time-composed sprite packs
// served from the app's own origin. `scripts/seed-parametric-sprites.ts` runs
// the exact runtime compose pipeline offline and commits the encoded payloads
// under `public/data/parametric-sprites/<ART_RECIPE_VERSION>/` (one manifest +
// a few binary shards), so a FIRST-visit client fetches ~$0-cost static bytes
// instead of paying the ~53s compose-CPU backlog.
//
// This module only resolves a key to the WP-G record body ({ meta, enc, buf })
// — decoding and the IDB write-through live in `parametric-sprite-cache.ts`
// (tier order: memory → IDB → vendored → compose). The payload format is
// exactly `encodeSpritePayload`'s output: the manifest carries each pack's meta
// JSON + encoding, the shard carries its (usually deflate-raw) bytes at a
// recorded offset/length.
//
// Failure posture mirrors the IDB tier: EVERYTHING degrades silently to
// composing. A missing/invalid/timed-out manifest disables the tier for the
// session (fetched once, lazily — never on the boot path); a failed shard
// fetch resolves null for its waiters and stays failed (no retry storms);
// shard fetches are capped at a small concurrency so a cold boot never fires
// hundreds of parallel requests. Shard buffers are dropped shortly after the
// warm burst so ~tens of MB never sit in memory for the whole session
// (mobile is jetsam-sensitive).
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { assetUrl } from '@/core/asset-url';

/** One pack's location + record header inside the bundle. */
interface VendoredPackEntry {
  /** Shard index into `manifest.shards`. */
  s: number;
  /** Byte offset / length of the encoded buffer inside the shard. */
  o: number;
  l: number;
  enc: 'deflate-raw' | 'raw';
  /** The record's meta JSON (dims, anchors, shadow meta, segment lengths). */
  meta: string;
}

export interface VendoredManifest {
  recipeVersion: string;
  count: number;
  totalBytes: number;
  shards: Array<{ file: string; bytes: number }>;
  packs: Record<string, VendoredPackEntry>;
}

/** The WP-G record body shape `decodeSpritePayload` consumes. */
export interface VendoredRecord {
  meta: string;
  enc: 'deflate-raw' | 'raw';
  buf: ArrayBuffer;
}

/** Never let a hung fetch wedge the tier decision — degrade to composing. */
const FETCH_TIMEOUT_MS = 15_000;
/** Max shard fetches in flight (compose-scheduler spirit: no request storms). */
const SHARD_FETCH_CONCURRENCY = 6;
/** Drop a resolved shard buffer this long after its last use — the warm burst
 *  is over in well under this; later stragglers refetch via the HTTP cache. */
const SHARD_RETAIN_MS = 60_000;

const bundleDir = (): string => `data/parametric-sprites/${ART_RECIPE_VERSION}`;

// ── module state (session-scoped, resettable for tests) ─────────────────────

let manifestPromise: Promise<VendoredManifest | null> | null = null;
interface ShardSlot { p: Promise<ArrayBuffer | null>; drop?: ReturnType<typeof setTimeout> }
const shards = new Map<number, ShardSlot>();
let fetchesActive = 0;
const fetchQueue: Array<() => void> = [];

export function _resetVendoredSpriteBundleForTesting(): void {
  manifestPromise = null;
  for (const s of shards.values()) if (s.drop !== undefined) clearTimeout(s.drop);
  shards.clear();
  fetchesActive = 0;
  fetchQueue.length = 0;
}

// ── fetch plumbing ───────────────────────────────────────────────────────────

function hasFetch(): boolean { return typeof fetch === 'function'; }

/** fetch with a hard timeout; null on ANY failure (4xx/5xx/network/abort). */
async function fetchOrNull(url: string): Promise<Response | null> {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctl?.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      return res.ok ? res : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** Run `job` under the shard-fetch concurrency cap. */
function withFetchSlot<T>(job: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => {
    fetchesActive++;
    return job().finally(() => {
      fetchesActive--;
      const next = fetchQueue.shift();
      if (next) next();
    });
  };
  if (fetchesActive < SHARD_FETCH_CONCURRENCY) return run();
  return new Promise<T>((resolve, reject) => {
    fetchQueue.push(() => { run().then(resolve, reject); });
  });
}

// ── manifest (fetched ONCE, lazily; failure disables the tier) ──────────────

async function loadManifest(): Promise<VendoredManifest | null> {
  if (!hasFetch()) return null;
  const res = await fetchOrNull(assetUrl(`${bundleDir()}/manifest.json`));
  if (!res) return null;
  try {
    const m = (await res.json()) as VendoredManifest;
    if (m?.recipeVersion !== ART_RECIPE_VERSION) return null;
    if (!m.packs || typeof m.packs !== 'object' || !Array.isArray(m.shards)) return null;
    return m;
  } catch {
    return null;
  }
}

function getManifest(): Promise<VendoredManifest | null> {
  // Cache the PROMISE: concurrent first reads share one fetch, and a failed
  // manifest (null) disables the tier for the whole session — no re-probing.
  if (!manifestPromise) manifestPromise = loadManifest().catch(() => null);
  return manifestPromise;
}

// ── shards ───────────────────────────────────────────────────────────────────

function touchShard(idx: number, slot: ShardSlot): void {
  if (slot.drop !== undefined) clearTimeout(slot.drop);
  slot.drop = setTimeout(() => { shards.delete(idx); }, SHARD_RETAIN_MS);
  // Never keep the process alive for a cache-eviction timer (Node/tests).
  (slot.drop as { unref?: () => void }).unref?.();
}

function getShard(m: VendoredManifest, idx: number): Promise<ArrayBuffer | null> {
  const existing = shards.get(idx);
  if (existing) { touchShard(idx, existing); return existing.p; }
  const file = m.shards[idx]?.file;
  const slot: ShardSlot = {
    p: !file
      ? Promise.resolve(null)
      : withFetchSlot(async () => {
          const res = await fetchOrNull(assetUrl(`${bundleDir()}/${file}`));
          if (!res) return null;
          try { return await res.arrayBuffer(); } catch { return null; }
        }),
  };
  // A failed shard stays cached as null — one attempt per session, no storms.
  shards.set(idx, slot);
  touchShard(idx, slot);
  return slot.p;
}

// ── public read ──────────────────────────────────────────────────────────────

/**
 * Resolve a `parametricSpriteKey` to its vendored record body, or null when the
 * bundle is absent / disabled / doesn't carry the key / the shard failed.
 * Never rejects; never blocks boot (all lazy, all timed out).
 */
export async function readVendoredSprite(key: string): Promise<VendoredRecord | null> {
  try {
    const m = await getManifest();
    if (!m) return null;
    const e = m.packs[key];
    if (!e) return null;
    const shard = await getShard(m, e.s);
    if (!shard || e.o < 0 || e.l <= 0 || e.o + e.l > shard.byteLength) return null;
    return { meta: e.meta, enc: e.enc, buf: shard.slice(e.o, e.o + e.l) };
  } catch {
    return null;
  }
}

/** True once the manifest has been fetched and accepted (diagnostics only). */
export async function vendoredBundleAvailable(): Promise<boolean> {
  return (await getManifest()) !== null;
}
