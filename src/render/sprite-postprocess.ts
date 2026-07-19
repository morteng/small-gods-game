// Pure-buffer post-processing for img2img building sprites — no canvas, so the
// exact same code runs in the browser, in Node seeding scripts, and in tests.
//
// The pipeline these compose into (see registerAlbedo): the LLM repaints the
// geometry init at ~4x resolution and only APPROXIMATELY preserves the
// silhouette. Registration negotiates between the two: deep inside the
// geometry silhouette the geometry is authoritative (disagreements are
// flood-filled with neighbouring colour, never black), within a narrow band
// around the silhouette edge the LLM's alpha wins (small embellishments and
// notches it drew survive), and far outside the silhouette everything is
// clipped. Normal/depth/AO stay co-registered because the band is narrow.

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

/**
 * Unbounded dilateColor: bleed colour outward from coloured pixels until every
 * reachable uncoloured pixel has one, leaving alpha untouched. Replaces the old
 * fixed-radius bleed — large geometry-vs-LLM disagreement regions previously
 * ran out of dilation and shipped as opaque black.
 */
export function floodFillColor(r: Raster): Raster {
  const out: Raster = { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
  const colored = new Uint8Array(r.w * r.h);
  for (let i = 0; i < r.w * r.h; i++) colored[i] = out.data[i * 4 + 3] >= ALPHA_MIN ? 1 : 0;
  for (let changed = true; changed; ) {
    changed = false;
    const next = new Uint8Array(colored);
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const i = y * r.w + x;
      if (colored[i]) continue;
      let rs = 0, gs = 0, bs = 0, n = 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
        const j = ny * r.w + nx;
        if (!colored[j]) continue;
        rs += out.data[j * 4]; gs += out.data[j * 4 + 1]; bs += out.data[j * 4 + 2]; n++;
      }
      if (n > 0) {
        out.data[i * 4] = Math.round(rs / n);
        out.data[i * 4 + 1] = Math.round(gs / n);
        out.data[i * 4 + 2] = Math.round(bs / n);
        next[i] = 1; changed = true;
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

export interface RegisterOpts {
  /**
   * Depth (px, on the mask grid) of the INWARD negotiation band: within this
   * distance inside the geometry silhouette edge the LLM's alpha wins, so notches
   * and gaps it drew (a crenellation, an archway) survive. Default scales with
   * sprite size (~4% of the short side). 0 = strictly geometry-authoritative.
   */
  band?: number;
  /**
   * How far (px) the LLM silhouette may grow OUTWARD past the geometry edge.
   * Default 0 — the albedo NEVER extends beyond the geometry mask. Pixels outside
   * the mask have no co-registered normal/material data, so an outward overhang
   * lights flat/wrong (the "texture misaligned to the 3D model" artifact). Raise
   * this only when there is no companion-map lighting to keep in register.
   */
  outward?: number;
}

/** Magenta-leaning colour = chroma-key bleed that survived keying, never building paint. */
function isChromaTinted(r: number, g: number, b: number): boolean {
  return r - g > 50 && b - g > 50;
}

/** Mask alpha as bits, optionally eroded/dilated by `n` (4-neighbour, Manhattan). */
function maskBits(mask: Raster, n: number): Uint8Array {
  let bits = new Uint8Array(mask.w * mask.h);
  for (let i = 0; i < bits.length; i++) bits[i] = mask.data[i * 4 + 3] >= ALPHA_MIN ? 1 : 0;
  for (let pass = 0; pass < Math.abs(n); pass++) {
    const next = new Uint8Array(bits);
    for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
      const i = y * mask.w + x;
      let edge = false;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const out = nx < 0 || ny < 0 || nx >= mask.w || ny >= mask.h;
        if ((out ? 0 : bits[ny * mask.w + nx]) !== bits[i]) { edge = true; break; }
        if (out && bits[i]) { edge = true; break; }
      }
      if (edge) next[i] = n < 0 ? 0 : 1;
    }
    bits = next;
  }
  return bits;
}

/**
 * Register a keyed LLM repaint onto the geometry mask grid: crop the LLM to its
 * content, box-filter it (non-uniformly) onto the mask's dimensions, scrub
 * chroma residue, then negotiate alpha — geometry wins deep inside (eroded
 * core, holes flood-filled with neighbouring colour), the LLM wins within the
 * inward `band` of the silhouette edge (notches survive), and the silhouette is
 * clipped to the geometry mask (no outward overhang by default, so the albedo
 * stays co-registered with the normal/material maps — see RegisterOpts.outward).
 * `iou` is the silhouette agreement measured BEFORE negotiation — the caller's
 * quality gate. Returns null when the LLM raster has no opaque content at all.
 */
export function registerAlbedo(
  llmKeyed: Raster, mask: Raster, opts: RegisterOpts = {},
): RegisterResult | null {
  const bb = opaqueBBox(llmKeyed);
  if (!bb) return null;
  const scaled = boxDownscale(cropRaster(llmKeyed, bb), mask.w, mask.h);
  for (let i = 0; i < scaled.w * scaled.h; i++) {
    const o = i * 4;
    if (scaled.data[o + 3] >= ALPHA_MIN
        && isChromaTinted(scaled.data[o], scaled.data[o + 1], scaled.data[o + 2])) {
      scaled.data[o] = scaled.data[o + 1] = scaled.data[o + 2] = scaled.data[o + 3] = 0;
    }
  }
  const iou = alphaIoU(scaled, mask);
  const band = opts.band ?? Math.round(Math.min(mask.w, mask.h) * 0.04);
  const outward = opts.outward ?? 0;
  const core = maskBits(mask, -band);
  const outer = maskBits(mask, outward);
  const filled = floodFillColor(scaled);
  const sprite: Raster = { data: new Uint8ClampedArray(mask.w * mask.h * 4), w: mask.w, h: mask.h };
  for (let i = 0; i < mask.w * mask.h; i++) {
    const o = i * 4;
    const a = core[i] ? 255 : outer[i] ? scaled.data[o + 3] : 0;
    if (a === 0) continue;
    sprite.data[o] = filled.data[o];
    sprite.data[o + 1] = filled.data[o + 1];
    sprite.data[o + 2] = filled.data[o + 2];
    sprite.data[o + 3] = a;
  }
  return { sprite, iou };
}

// ---------------------------------------------------------------------------
// Oklab k-means quantizer + ordered dither — THE building img2img pipeline's
// quantize pass since the qwen-edit adoption (generated-building-art-source,
// seed-building-art, the studio's paid-render preview); see docs/superpowers/
// 2026-07-11-img2img-structure-adherence-research.md. quantizePalette above
// remains for flora + old callers. It buckets in raw sRGB, which distorts
// perceptual distance (sRGB is not uniform — a step in blue reads far louder
// than the same step in green) and its callers do no dithering at all, so
// smooth gradients band. This quantizer clusters in Oklab (perceptually
// closer to uniform) and offers an ORDERED (Bayer) dither instead of
// error-diffusion: diffusion drags quantization error sideways across a row,
// which smears the renderer's banded-lighting edges; a fixed 4x4 threshold
// tile does not.
// ---------------------------------------------------------------------------

/**
 * sRGB [0,255] -> Oklab, per Björn Ottosson's reference matrices
 * (https://bottosson.github.io/posts/oklab/). Returns [L, a, b] where L is
 * roughly perceptual lightness in [0,1] and a/b are the opponent axes.
 */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const toLinear = (c: number) => {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

/** Inverse of {@link rgbToOklab}, clamped + rounded back to sRGB [0,255] ints. */
function oklabToRgb(L: number, a: number, bb: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toSrgb = (c: number) => {
    const cs = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(cs * 255)));
  };
  return [toSrgb(lr), toSrgb(lg), toSrgb(lb)];
}

// Standard 4x4 Bayer threshold tile (values 0..15 spread for maximal
// dispersion). Indexed [y&3][x&3] so it tiles seamlessly across any sprite.
const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Bayer threshold normalized to [-0.5, 0.5). */
function bayerOffset(x: number, y: number): number {
  return (BAYER4[y & 3][x & 3] + 0.5) / 16 - 0.5;
}

/**
 * Perceptual (Oklab) k-means palette reduction with an optional ordered
 * (Bayer 4x4) dither, replacing {@link quantizePalette} in the building
 * img2img pipeline (see the file-level comment). Fully transparent
 * pixels are untouched and alpha is preserved exactly; the input raster is
 * never mutated.
 *
 * Determinism: k-means needs a seed, and this codebase forbids `Math.random`
 * anywhere sim-adjacent and prizes determinism everywhere, so initial
 * centroids are chosen by a fixed stratified sample over OPAQUE pixels
 * sorted by Oklab lightness (no RNG) rather than randomly seeded — same
 * input always produces byte-identical output.
 *
 * Dithering (`dither: 'bayer4'`) perturbs each pixel's Oklab L by a fixed
 * 4x4 threshold tile BEFORE the nearest-palette lookup (never stored), so
 * neighbouring pixels straddling a palette boundary alternate between the
 * two nearest colours instead of banding. The perturbation amplitude is set
 * to roughly HALF the mean gap between adjacent (lightness-sorted) palette
 * entries: large enough that a pixel sitting between two palette lights
 * actually dithers between them, small enough that it can only ever hop to
 * its immediate neighbour, never skip a whole palette band into a
 * perceptually wrong colour.
 */
export function quantizePaletteOklab(
  sprite: Raster,
  colors: number,
  opts: { dither?: 'none' | 'bayer4' } = {},
): Raster {
  const dither = opts.dither ?? 'none';
  const out: Raster = { data: new Uint8ClampedArray(sprite.data), w: sprite.w, h: sprite.h };

  // Distinct opaque colours, keyed exactly (not bucketed) — row-major scan
  // order, so downstream ordering (and thus k-means) is deterministic.
  const distinctMap = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < sprite.w * sprite.h; i++) {
    if (sprite.data[i * 4 + 3] < ALPHA_MIN) continue;
    const cr = sprite.data[i * 4], cg = sprite.data[i * 4 + 1], cb = sprite.data[i * 4 + 2];
    const key = (cr << 16) | (cg << 8) | cb;
    const e = distinctMap.get(key);
    if (e) e.n++; else distinctMap.set(key, { r: cr, g: cg, b: cb, n: 1 });
  }
  if (distinctMap.size === 0 || colors <= 0) return out;

  interface Pt { r: number; g: number; b: number; n: number; L: number; a: number; bb: number }
  const distinct: Pt[] = [...distinctMap.values()].map((e) => {
    const [L, a, bb] = rgbToOklab(e.r, e.g, e.b);
    return { ...e, L, a, bb };
  });

  let paletteRgb: [number, number, number][];
  let paletteLab: [number, number, number][];

  if (distinct.length <= colors) {
    // Fewer distinct colours than the budget — every colour IS a centroid.
    paletteRgb = distinct.map((p) => [p.r, p.g, p.b]);
    paletteLab = distinct.map((p) => [p.L, p.a, p.bb]);
  } else {
    // Deterministic init: stratified sample over lightness-sorted points
    // (no RNG — see the doc comment above).
    const byLum = [...distinct].sort((p, q) => p.L - q.L);
    const centroids: [number, number, number][] = [];
    for (let i = 0; i < colors; i++) {
      const idx = Math.min(byLum.length - 1, Math.floor(((i + 0.5) * byLum.length) / colors));
      centroids.push([byLum[idx].L, byLum[idx].a, byLum[idx].bb]);
    }
    const assign = new Int32Array(distinct.length).fill(-1);
    for (let iter = 0; iter < 30; iter++) {
      let changed = false;
      for (let i = 0; i < distinct.length; i++) {
        const p = distinct[i];
        let best = 0, bestD = Infinity;
        for (let c = 0; c < centroids.length; c++) {
          const cc = centroids[c];
          const dL = p.L - cc[0], da = p.a - cc[1], db = p.bb - cc[2];
          const d = dL * dL + da * da + db * db;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; changed = true; }
      }
      const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
      for (let i = 0; i < distinct.length; i++) {
        const p = distinct[i], s = sums[assign[i]];
        s.L += p.L * p.n; s.a += p.a * p.n; s.b += p.bb * p.n; s.n += p.n;
      }
      for (let c = 0; c < centroids.length; c++) {
        if (sums[c].n > 0) centroids[c] = [sums[c].L / sums[c].n, sums[c].a / sums[c].n, sums[c].b / sums[c].n];
      }
      if (!changed) break;
    }
    paletteLab = centroids;
    paletteRgb = centroids.map(([L, a, bb]) => oklabToRgb(L, a, bb));
  }

  let ditherAmp = 0;
  if (dither === 'bayer4' && paletteLab.length > 1) {
    const ls = paletteLab.map((p) => p[0]).sort((a, b) => a - b);
    let gapSum = 0;
    for (let i = 1; i < ls.length; i++) gapSum += ls[i] - ls[i - 1];
    ditherAmp = gapSum / (ls.length - 1) / 2;
  }

  const okCache = new Map<number, [number, number, number]>();
  for (const p of distinct) okCache.set((p.r << 16) | (p.g << 8) | p.b, [p.L, p.a, p.bb]);

  for (let y = 0; y < sprite.h; y++) for (let x = 0; x < sprite.w; x++) {
    const i = y * sprite.w + x, o = i * 4;
    if (out.data[o + 3] < ALPHA_MIN) continue;
    const key = (out.data[o] << 16) | (out.data[o + 1] << 8) | out.data[o + 2];
    const lab = okCache.get(key)!;
    const L = dither === 'bayer4' && ditherAmp > 0 ? lab[0] + bayerOffset(x, y) * ditherAmp : lab[0];
    let best = 0, bestD = Infinity;
    for (let c = 0; c < paletteLab.length; c++) {
      const cc = paletteLab[c];
      const dL = L - cc[0], da = lab[1] - cc[1], db = lab[2] - cc[2];
      const d = dL * dL + da * da + db * db;
      if (d < bestD) { bestD = d; best = c; }
    }
    out.data[o] = paletteRgb[best][0];
    out.data[o + 1] = paletteRgb[best][1];
    out.data[o + 2] = paletteRgb[best][2];
  }
  return out;
}
