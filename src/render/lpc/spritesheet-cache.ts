import './item-metadata.js';            // sets window.itemMetadata (required by renderer.js)
import { renderCharacter } from './canvas/renderer.js';
import { clearImageCache } from './canvas/load-image.js';
import type { CharacterSpec } from './character-builder';
import { createLimiter } from './concurrency';

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
}
