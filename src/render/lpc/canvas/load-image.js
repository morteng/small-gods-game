// Sprites are vendored under public/sprites/lpc/ — see scripts/vendor-lpc-sprites.sh.
// Resolve against Vite's `base` so the path works at the dev root ('/') and under
// a GitHub Pages project subpath ('/small-gods-game/'). BASE_URL always ends in '/'.
const LPC_BASE_URL = (import.meta.env.BASE_URL ?? '/') + 'sprites/lpc/';

// src → Promise<HTMLImageElement>. Caching the PROMISE (not the settled image)
// dedupes IN-FLIGHT loads too: at boot many spritesheets compose concurrently and
// share the same body/hair/clothes PNGs — without this each sheet re-fetched and
// re-decoded the same file (the "LPC loading storm").
let imagePromises = {};
let knownMissing = new Set();

/**
 * Derive a variantless fallback URL.
 * Many LPC layers (body, head, face, hair, longsleeve, armour plates) dropped
 * per-variant subfolders upstream: ".../walk/black.png" no longer exists, only
 * ".../walk.png". When the variant path 404s, try the flat path.
 */
function variantlessFallback(src) {
  const m = src.match(/^(.*)\/([^\/]+)\/([^\/]+)\.png$/);
  if (!m) return null;
  const [, prefix, animFolder] = m;
  return `${prefix}/${animFolder}.png`;
}

/**
 * Load an image, with variantless fallback for layers whose per-variant files
 * were removed from upstream LPC. Concurrent + repeat calls for the same `src`
 * share one load (and one decoded image).
 */
export function loadImage(src) {
  const cached = imagePromises[src];
  if (cached) return cached;

  const promise = new Promise((resolve, reject) => {
    const profiler = window.profiler;
    if (profiler) profiler.mark(`image-load:${src}:start`);

    const resolveFullUrl = (s) => s.startsWith('http') ? s : LPC_BASE_URL + s;
    const primaryUrl = resolveFullUrl(src);

    // Skip primary entirely if we already know it's missing.
    const fallbackSrc = variantlessFallback(src);
    const fallbackUrl = fallbackSrc ? resolveFullUrl(fallbackSrc) : null;

    const tryLoad = (url, isFallback) => {
      const img = new Image();
      img.onload = () => {
        if (profiler) {
          profiler.mark(`image-load:${src}:end`);
          profiler.measure(`image-load:${src}`, `image-load:${src}:start`, `image-load:${src}:end`);
        }
        resolve(img);
      };
      img.onerror = () => {
        if (!isFallback && fallbackUrl) {
          knownMissing.add(url);
          tryLoad(fallbackUrl, true);
          return;
        }
        knownMissing.add(url);
        // Silent failure: the LPC compositor tolerates missing layers.
        // Surface in window.DEBUG mode only.
        if (window.DEBUG) console.warn(`Failed to load image: ${src}`);
        reject(new Error(`Failed to load ${src}`));
      };
      img.crossOrigin = 'anonymous';
      img.src = url;
    };

    if (knownMissing.has(primaryUrl) && fallbackUrl) {
      tryLoad(fallbackUrl, true);
    } else {
      tryLoad(primaryUrl, false);
    }
  });

  // Cache rejections too (the file is permanently missing — retrying can't help),
  // but pre-attach a catch so a cached rejection is never an unhandled rejection.
  promise.catch(() => {});
  imagePromises[src] = promise;
  return promise;
}

/**
 * Release every cached decoded item image. The composed spritesheets keep their
 * own settled cache (spritesheet-cache.ts); the underlying body/hair/clothes
 * PNGs are only needed while sheets are being composed, and holding hundreds of
 * decoded frames costs real memory (a dominant contributor on mobile). Called
 * when the sheet queue drains; a later NPC birth simply re-fetches from the
 * HTTP cache. `knownMissing` survives (it's tiny and saves 404 round-trips).
 */
export function clearImageCache() {
  imagePromises = {};
}

/**
 * Load multiple images in parallel.
 */
export async function loadImagesInParallel(items, getPath = (item) => item.spritePath) {
  const promises = items.map(item =>
    loadImage(getPath(item))
      .then(img => ({ item, img, success: true }))
      .catch(() => ({ item, img: null, success: false }))
  );
  return Promise.all(promises);
}
