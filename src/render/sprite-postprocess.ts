// Pure-buffer post-processing for img2img building sprites — no canvas, so the
// exact same code runs in the browser, in Node seeding scripts, and in tests.
//
// The pipeline these compose into (see registerAlbedo): the LLM repaints the
// geometry init at ~4x resolution and only APPROXIMATELY preserves the
// silhouette. The geometry alpha is authoritative — we scale the keyed LLM
// output onto the geometry bbox grid, bleed its colours a few pixels outward,
// then clip to the geometry mask. Alpha/normal/depth/albedo are co-registered
// by construction; the LLM contributes colour only.

export interface Raster { data: Uint8ClampedArray; w: number; h: number }

const ALPHA_MIN = 8;

export interface RBBox { x: number; y: number; w: number; h: number }

/** Opaque (alpha ≥ alphaMin) bounding box, or null if fully transparent. */
export function opaqueBBox(r: Raster, alphaMin = ALPHA_MIN): RBBox | null {
  let minX = r.w, minY = r.h, maxX = -1, maxY = -1;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.data[(y * r.w + x) * 4 + 3] >= alphaMin) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function cropRaster(r: Raster, bb: RBBox): Raster {
  const out: Raster = { data: new Uint8ClampedArray(bb.w * bb.h * 4), w: bb.w, h: bb.h };
  for (let y = 0; y < bb.h; y++) {
    const src = ((bb.y + y) * r.w + bb.x) * 4;
    out.data.set(r.data.subarray(src, src + bb.w * 4), y * bb.w * 4);
  }
  return out;
}

/**
 * Area-average (box filter) resample, non-uniform scale supported. Premultiplied
 * alpha accumulation so transparent pixels never darken edge colours.
 */
export function boxDownscale(src: Raster, outW: number, outH: number): Raster {
  const out: Raster = { data: new Uint8ClampedArray(outW * outH * 4), w: outW, h: outH };
  for (let oy = 0; oy < outH; oy++) for (let ox = 0; ox < outW; ox++) {
    const x0 = ox * src.w / outW, x1 = (ox + 1) * src.w / outW;
    const y0 = oy * src.h / outH, y1 = (oy + 1) * src.h / outH;
    let ra = 0, ga = 0, ba = 0, aSum = 0, wSum = 0;
    for (let sy = Math.floor(y0); sy < Math.min(src.h, Math.ceil(y1)); sy++) {
      const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
      for (let sx = Math.floor(x0); sx < Math.min(src.w, Math.ceil(x1)); sx++) {
        const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
        const wgt = wx * wy;
        const o = (sy * src.w + sx) * 4;
        const a = src.data[o + 3];
        ra += src.data[o] * a * wgt; ga += src.data[o + 1] * a * wgt; ba += src.data[o + 2] * a * wgt;
        aSum += a * wgt; wSum += wgt;
      }
    }
    const o = (oy * outW + ox) * 4;
    if (aSum > 0) {
      out.data[o] = Math.round(ra / aSum);
      out.data[o + 1] = Math.round(ga / aSum);
      out.data[o + 2] = Math.round(ba / aSum);
      out.data[o + 3] = Math.round(aSum / (wSum || 1));
    }
  }
  return out;
}

/** Nearest-neighbour resample (crisp pixel scaling). */
export function nearestScale(src: Raster, outW: number, outH: number): Raster {
  const out: Raster = { data: new Uint8ClampedArray(outW * outH * 4), w: outW, h: outH };
  for (let oy = 0; oy < outH; oy++) for (let ox = 0; ox < outW; ox++) {
    const sx = Math.min(src.w - 1, Math.floor((ox + 0.5) * src.w / outW));
    const sy = Math.min(src.h - 1, Math.floor((oy + 0.5) * src.h / outH));
    out.data.set(src.data.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (oy * outW + ox) * 4);
  }
  return out;
}

/**
 * Bleed colour from coloured pixels into adjacent uncoloured ones (4-neighbour,
 * `passes` rings), leaving alpha untouched. Prepares the albedo for clipToMask:
 * mask pixels just outside the LLM's content pick up a plausible colour instead
 * of transparent black.
 */
export function dilateColor(r: Raster, passes: number): Raster {
  const out: Raster = { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
  const colored = new Uint8Array(r.w * r.h);
  for (let i = 0; i < r.w * r.h; i++) colored[i] = out.data[i * 4 + 3] >= ALPHA_MIN ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(colored);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      if (colored[i]) continue;
      let rs = 0, gs = 0, bs = 0, n = 0;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
        const j = ny * r.w + nx;
        if (!colored[j]) continue;
        rs += out.data[j * 4]; gs += out.data[j * 4 + 1]; bs += out.data[j * 4 + 2]; n++;
      }
      if (n > 0) {
        out.data[i * 4] = Math.round(rs / n);
        out.data[i * 4 + 1] = Math.round(gs / n);
        out.data[i * 4 + 2] = Math.round(bs / n);
        next[i] = 1;
      }
    }
    colored.set(next);
  }
  return out;
}

/** Colour from `albedo`, alpha from `mask` (must be same dimensions). */
export function clipToMask(albedo: Raster, mask: Raster): Raster {
  if (albedo.w !== mask.w || albedo.h !== mask.h) throw new Error('clipToMask: dimension mismatch');
  const out: Raster = { data: new Uint8ClampedArray(albedo.data), w: albedo.w, h: albedo.h };
  for (let i = 0; i < albedo.w * albedo.h; i++) out.data[i * 4 + 3] = mask.data[i * 4 + 3];
  return out;
}

/** Intersection-over-union of the two rasters' opaque coverage (same dimensions). */
export function alphaIoU(a: Raster, b: Raster, alphaMin = ALPHA_MIN): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error('alphaIoU: dimension mismatch');
  let inter = 0, union = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const pa = a.data[i * 4 + 3] >= alphaMin, pb = b.data[i * 4 + 3] >= alphaMin;
    if (pa && pb) inter++;
    if (pa || pb) union++;
  }
  return union === 0 ? 0 : inter / union;
}

/**
 * Fraction of the outermost pixel ring that is transparent. On a freshly keyed
 * LLM image this measures whether the model obeyed the chroma background — a
 * model that painted scenery instead leaves the ring opaque (→ ~0).
 */
export function borderKeyedFraction(r: Raster, alphaMin = ALPHA_MIN): number {
  let keyed = 0, total = 0;
  for (let x = 0; x < r.w; x++) for (const y of [0, r.h - 1]) {
    total++; if (r.data[(y * r.w + x) * 4 + 3] < alphaMin) keyed++;
  }
  for (let y = 1; y < r.h - 1; y++) for (const x of [0, r.w - 1]) {
    total++; if (r.data[(y * r.w + x) * 4 + 3] < alphaMin) keyed++;
  }
  return total === 0 ? 0 : keyed / total;
}

/**
 * Snap opaque pixels to a frequency-derived palette: bucket colours at 16
 * levels/channel, keep the `maxColors` most populous buckets (their mean colour),
 * and map every opaque pixel to its nearest palette entry. Unifies the look
 * across buildings and keeps banded lighting clean later.
 */
export function quantizePalette(r: Raster, maxColors: number, alphaMin = ALPHA_MIN): Raster {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < r.w * r.h; i++) {
    if (r.data[i * 4 + 3] < alphaMin) continue;
    const cr = r.data[i * 4], cg = r.data[i * 4 + 1], cb = r.data[i * 4 + 2];
    const key = ((cr >> 4) << 8) | ((cg >> 4) << 4) | (cb >> 4);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += cr; e.g += cg; e.b += cb;
    buckets.set(key, e);
  }
  const palette = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, maxColors)
    .map(e => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] as const);
  if (palette.length === 0) return { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };

  const out: Raster = { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
  for (let i = 0; i < r.w * r.h; i++) {
    if (out.data[i * 4 + 3] < alphaMin) continue;
    const cr = out.data[i * 4], cg = out.data[i * 4 + 1], cb = out.data[i * 4 + 2];
    let best = palette[0], bestD = Infinity;
    for (const p of palette) {
      const d = (p[0] - cr) ** 2 + (p[1] - cg) ** 2 + (p[2] - cb) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    out.data[i * 4] = best[0]; out.data[i * 4 + 1] = best[1]; out.data[i * 4 + 2] = best[2];
  }
  return out;
}

export interface RegisterResult { sprite: Raster; iou: number }

/**
 * Register a keyed LLM repaint onto the geometry mask grid. The mask (the
 * geometry render's alpha, already cropped to its opaque bbox) is authoritative:
 * crop the LLM to its content, box-filter it (non-uniformly) onto the mask's
 * dimensions, bleed colours outward, clip to the mask. `iou` is the silhouette
 * agreement measured BEFORE dilation/clipping — the caller's quality gate.
 * Returns null when the LLM raster has no opaque content at all.
 */
export function registerAlbedo(
  llmKeyed: Raster, mask: Raster,
  opts: { dilatePasses?: number } = {},
): RegisterResult | null {
  const bb = opaqueBBox(llmKeyed);
  if (!bb) return null;
  const scaled = boxDownscale(cropRaster(llmKeyed, bb), mask.w, mask.h);
  const iou = alphaIoU(scaled, mask);
  const dilated = dilateColor(scaled, opts.dilatePasses ?? 4);
  return { sprite: clipToMask(dilated, mask), iou };
}
