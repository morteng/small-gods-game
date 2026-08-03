import './item-metadata.js';            // sets window.itemMetadata (required by renderer.js)
import { renderCharacter } from './canvas/renderer.js';
import { clearImageCache } from './canvas/load-image.js';
import type { CharacterSpec } from './character-builder';
import { createLimiter } from './concurrency';
import { humanoidLayerSpecs } from './humanoid-layers';
import { loadHumanoidCharacter } from '@/render/paperdoll/humanoid-loader';
import { bakeRigStripRows, paintRigStrip } from './rig-rows';

/** Stable hash of a CharacterSpec — used as cache key */
function specHash(spec: CharacterSpec): string {
  const sortedItems = Object.fromEntries(
    Object.keys(spec.items).sort().map(k => [k, spec.items[k]])
  );
  return JSON.stringify({ s: spec.sex, b: spec.bodyType, i: sortedItems });
}

// Cache: hash → settled canvas (null if generation failed)
const cache = new Map<string, HTMLCanvasElement | null>();
// In-flight promises: hash → pending generation
const inflight = new Map<string, Promise<HTMLCanvasElement | null>>();

// At boot every NPC's sheet is requested at once; each composition fans out to
// ~100 layer-image loads and a stack of full-sheet drawImage calls. Run a few at
// a time so image dedupe (shared body/hair PNGs land in cache before the next
// sheet asks) and the main thread both get breathing room.
const limiter = createLimiter(3);

/**
 * Get a rendered LPC spritesheet for the given CharacterSpec.
 * Returns null if generation fails.
 * Concurrent calls with the same spec share one Promise; at most a few
 * generations run concurrently (the rest queue).
 */
export function getOrGenerateSheet(spec: CharacterSpec): Promise<HTMLCanvasElement | null> {
  const hash = specHash(spec);

  // Already settled — return immediately
  if (cache.has(hash)) {
    return Promise.resolve(cache.get(hash) ?? null);
  }

  // Already generating — share the promise
  const existing = inflight.get(hash);
  if (existing) return existing;

  // Start new generation (queued behind the concurrency limiter)
  const promise = limiter(async () => {
    const canvas = document.createElement('canvas');
    await renderCharacter(spec.items, spec.bodyType, canvas);
    return canvas;
  })
    .then((canvas) => {
      cache.set(hash, canvas);
      return canvas as HTMLCanvasElement | null;
    })
    .catch((err: unknown) => {
      console.warn('LPC spritesheet generation failed:', err);
      cache.set(hash, null);
      return null;
    })
    .finally(() => {
      inflight.delete(hash);
      // Queue drained → release the decoded item images (body/hair/clothes PNGs).
      // The composed sheets above are what the renderer uses; the underlying
      // frames were measured at hundreds of MB decoded on mobile. A later birth
      // re-fetches from the HTTP cache.
      if (inflight.size === 0) clearImageCache();
    });

  inflight.set(hash, promise);
  return promise;
}

/** Unsettled sheet requests (queued + running). The boot art-settle gate sums
 *  this into its pending count so the loading overlay outlives LPC composition —
 *  NPCs never pop in one by one over a live, janking frame loop. */
export function pendingSheets(): number {
  return inflight.size;
}

/** Clear the cache (e.g. for testing) */
export function clearSheetCache(): void {
  cache.clear();
  inflight.clear();
  rigCache.clear();
  rigInflight.clear();
}

// ── rig rows ────────────────────────────────────────────────────────────────
// The paper-doll clips baked from this wardrobe's own part sheets, on their own
// canvas (see `rig-rows.ts` for why it is not the composed sheet). Keyed by the
// same spec hash, so a crowd of identical wardrobes bakes once.

const rigCache = new Map<string, HTMLCanvasElement | null>();
const rigInflight = new Map<string, Promise<void>>();

// ONE at a time, unlike the sheet composition above. A rig bake is SYNCHRONOUS
// raster math, not I/O: running three concurrently would not overlap anything,
// it would only interleave three streams of blocking frames instead of one.
// Serial + the bake's own per-frame idle yield is what keeps the loop breathing
// while a town gradually gains its prayers.
const rigLimiter = createLimiter(1);

/**
 * This wardrobe's baked rig strip if it is ready, else null — queuing the bake
 * on the first miss. Deliberately non-blocking and deliberately silent about
 * why: an NPC whose strip has not landed plays its standing animation (the
 * animation table's `fallback`), which is honest and never a placeholder frame.
 * A failed bake caches null so it is attempted once, not every re-kick.
 */
export function getOrBakeRigRows(spec: CharacterSpec): HTMLCanvasElement | null {
  const hash = specHash(spec);
  const settled = rigCache.get(hash);
  if (settled !== undefined) return settled;
  if (rigInflight.has(hash)) return null;

  const promise = rigLimiter(async () => {
    const { layers, sheets } = await loadHumanoidCharacter(humanoidLayerSpecs(spec));
    const rows = await bakeRigStripRows(sheets, layers);
    rigCache.set(hash, paintRigStrip(rows));
  })
    .catch((err: unknown) => {
      // Survivable: this wardrobe simply keeps standing. Never rethrow — this
      // runs off a repeating re-kick and an unhandled rejection would spray.
      console.warn('LPC rig-row bake failed:', err);
      rigCache.set(hash, null);
    })
    .finally(() => { rigInflight.delete(hash); });

  rigInflight.set(hash, promise);
  return null;
}

