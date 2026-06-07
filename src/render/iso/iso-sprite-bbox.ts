/**
 * Opaque-content anchor for generated building sprites.
 *
 * PixelLab returns a building floating inside its (correctly-sized) transparent
 * frame with arbitrary margins, so anchoring the FRAME's bottom-centre to the
 * footprint leaves the building a few px off its tiles. We instead anchor the
 * building's REAL base: scan the alpha channel for the opaque bounding box and
 * return its horizontal centre + bottom row. The renderer then lands that point
 * on the footprint's front tip → pixel-exact placement, no init_image guide.
 *
 * Result is cached per image src (the scan is one offscreen readback per unique
 * sprite). When no canvas/readback is available (jsdom tests, image not yet
 * decoded) it falls back to the full-frame anchor — identical to the old
 * behaviour, so tests stay green and placement degrades gracefully.
 */
export interface SpriteAnchor {
  /** x of the opaque content's horizontal centre, in image pixels. */
  centerX: number;
  /** y just below the lowest opaque row (the building's base), in image pixels. */
  bottom: number;
}

const cache = new Map<string, SpriteAnchor>();

export function opaqueAnchor(img: HTMLImageElement): SpriteAnchor {
  const natW = img.naturalWidth || img.width || 0;
  const natH = img.naturalHeight || img.height || 0;
  const full: SpriteAnchor = { centerX: natW / 2, bottom: natH };

  // Only trust (and cache) a scan once the image is actually decoded.
  const ready = (img as HTMLImageElement).complete !== false && natW > 0 && natH > 0;
  if (!ready) return full;

  const key = img.src || '';
  if (!key) return scanOpaque(img, natW, natH) ?? full; // un-keyable: never cache
  const cached = cache.get(key);
  if (cached) return cached;

  const scanned = scanOpaque(img, natW, natH) ?? full;
  cache.set(key, scanned);
  return scanned;
}

function scanOpaque(img: HTMLImageElement, w: number, h: number): SpriteAnchor | null {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : typeof document !== 'undefined'
          ? Object.assign(document.createElement('canvas'), { width: w, height: h })
          : null;
    if (!canvas) return null;
    canvas.width = w; canvas.height = h;
    const ctx = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;

    let minX = w, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] > 8) { // alpha threshold
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          maxY = y;
        }
      }
    }
    if (maxX < 0) return null; // fully transparent
    return { centerX: (minX + maxX + 1) / 2, bottom: maxY + 1 };
  } catch {
    return null;
  }
}
