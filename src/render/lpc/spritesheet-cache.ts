import './item-metadata.js';            // sets window.itemMetadata (required by renderer.js)
import { renderCharacter } from './canvas/renderer.js';
import type { CharacterSpec } from './character-builder';

/** Stable hash of a CharacterSpec — used as cache key */
function specHash(spec: CharacterSpec): string {
  return JSON.stringify({ s: spec.sex, b: spec.bodyType, i: spec.items });
}

// Cache: hash → settled canvas (null if generation failed)
const cache = new Map<string, HTMLCanvasElement | null>();
// In-flight promises: hash → pending generation
const inflight = new Map<string, Promise<HTMLCanvasElement | null>>();

/**
 * Get a rendered LPC spritesheet for the given CharacterSpec.
 * Returns null if generation fails.
 * Concurrent calls with the same spec share one Promise.
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

  // Start new generation
  const canvas = document.createElement('canvas');
  const promise = renderCharacter(spec.items, spec.bodyType, canvas)
    .then(() => {
      cache.set(hash, canvas);
      inflight.delete(hash);
      return canvas;
    })
    .catch((err: unknown) => {
      console.warn('LPC spritesheet generation failed:', err);
      cache.set(hash, null);
      inflight.delete(hash);
      return null;
    });

  inflight.set(hash, promise);
  return promise;
}

/** Clear the cache (e.g. for testing) */
export function clearSheetCache(): void {
  cache.clear();
  inflight.clear();
}
