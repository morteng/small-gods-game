// Sprites are vendored under public/sprites/lpc/ — see scripts/vendor-lpc-sprites.sh.
// Resolve against Vite's `base` so the path works at the dev root ('/') and under
// a GitHub Pages project subpath ('/small-gods-game/'). BASE_URL always ends in '/'.
const LPC_BASE_URL = (import.meta.env.BASE_URL ?? '/') + 'sprites/lpc/';

let loadedImages = {};
let knownMissing = new Set();
let imagesToLoad = 0;
let imagesLoaded = 0;

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
 * were removed from upstream LPC.
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (loadedImages[src]) {
      resolve(loadedImages[src]);
      return;
    }

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
        loadedImages[src] = img;
        imagesLoaded++;
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
        imagesLoaded++;
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
    imagesToLoad++;
  });
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
