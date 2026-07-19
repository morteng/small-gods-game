/**
 * Snap-to-source-palette quantize: force every output pixel to the nearest
 * (Oklab) color that ACTUALLY OCCURS in the source sheets, and every alpha to
 * fully-on/off. Unlike `quantizePaletteOklab` — which builds its palette from
 * the already-blended frame and so keeps antialiased in-between colors — this
 * kills rotation/skinning blending entirely: baked frames can only use pixels
 * the pixel artist shipped. No dither: dithering invents texture the source
 * never had.
 */
import { rgbToOklab, type Raster } from '../sprite-postprocess';

export interface SourcePalette {
  rgb: [number, number, number][];
  lab: [number, number, number][];
}

/** Collect the exact opaque-color set of the given rasters (row-major order). */
export function collectSourcePalette(rasters: readonly Raster[]): SourcePalette {
  const seen = new Set<number>();
  const rgb: [number, number, number][] = [];
  for (const r of rasters) {
    for (let i = 0; i < r.w * r.h; i++) {
      if (r.data[i * 4 + 3] === 0) continue;
      const cr = r.data[i * 4];
      const cg = r.data[i * 4 + 1];
      const cb = r.data[i * 4 + 2];
      const key = (cr << 16) | (cg << 8) | cb;
      if (seen.has(key)) continue;
      seen.add(key);
      rgb.push([cr, cg, cb]);
    }
  }
  return { rgb, lab: rgb.map(([r, g, b]) => rgbToOklab(r, g, b)) };
}

function nearestIndex(
  palette: SourcePalette,
  cache: Map<number, number>,
  cr: number,
  cg: number,
  cb: number,
): number {
  const key = (cr << 16) | (cg << 8) | cb;
  let pi = cache.get(key);
  if (pi === undefined) {
    const [L, A, B] = rgbToOklab(cr, cg, cb);
    let best = Infinity;
    pi = 0;
    for (let k = 0; k < palette.lab.length; k++) {
      const [l2, a2, b2] = palette.lab[k];
      const d = (L - l2) ** 2 + (A - a2) ** 2 + (B - b2) ** 2;
      if (d < best) {
        best = d;
        pi = k;
      }
    }
    cache.set(key, pi);
  }
  return pi;
}

/**
 * Snap a frame to the source palette. Alpha thresholds at `alphaMin`
 * (default 128 — half-covered supersample pixels drop out, hard silhouette).
 */
export function snapToSourcePalette(frame: Raster, palette: SourcePalette, alphaMin = 128): Raster {
  const out: Raster = { data: new Uint8ClampedArray(frame.data), w: frame.w, h: frame.h };
  if (palette.rgb.length === 0) return out;
  const cache = new Map<number, number>();
  for (let i = 0; i < frame.w * frame.h; i++) {
    const a = out.data[i * 4 + 3];
    if (a < alphaMin) {
      out.data[i * 4 + 3] = 0;
      continue;
    }
    out.data[i * 4 + 3] = 255;
    const pi = nearestIndex(palette, cache, out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2]);
    const [r, g, b] = palette.rgb[pi];
    out.data[i * 4] = r;
    out.data[i * 4 + 1] = g;
    out.data[i * 4 + 2] = b;
  }
  return out;
}

/**
 * Collect only the colors that occur ON THE SILHOUETTE BOUNDARY of the source
 * rasters (opaque pixel 4-adjacent to transparency or the raster edge) — the
 * pixel artist's outline inks, per material.
 */
export function collectOutlinePalette(rasters: readonly Raster[]): SourcePalette {
  const seen = new Set<number>();
  const rgb: [number, number, number][] = [];
  for (const r of rasters) {
    const { w, h, data } = r;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (data[i * 4 + 3] === 0) continue;
        const boundary =
          x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
          data[(i - 1) * 4 + 3] === 0 || data[(i + 1) * 4 + 3] === 0 ||
          data[(i - w) * 4 + 3] === 0 || data[(i + w) * 4 + 3] === 0;
        if (!boundary) continue;
        const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
        if (seen.has(key)) continue;
        seen.add(key);
        rgb.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
      }
    }
  }
  return { rgb, lab: rgb.map(([r, g, b]) => rgbToOklab(r, g, b)) };
}

/**
 * Re-ink the silhouette: every opaque boundary pixel whose color is not one of
 * the source outline inks (rotation blended the 1px dark contour away and the
 * palette snap resolved it to a fill color) is re-stroked with the NEAREST
 * outline ink (Oklab) — skin edges go back to dark skin ink, cloth edges to
 * dark cloth ink. Interior pixels are never touched, and a frame whose
 * boundary already uses outline inks passes through byte-identical (frame 0
 * of any clip). Run AFTER `snapToSourcePalette` (assumes binary alpha).
 */
export function reinkOutline(frame: Raster, outline: SourcePalette): Raster {
  const out: Raster = { data: new Uint8ClampedArray(frame.data), w: frame.w, h: frame.h };
  if (outline.rgb.length === 0) return out;
  const inks = new Set(outline.rgb.map(([r, g, b]) => (r << 16) | (g << 8) | b));
  const cache = new Map<number, number>();
  const { w, h, data } = frame; // boundary test reads the ORIGINAL frame
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] === 0) continue;
      const boundary =
        x === 0 || x === w - 1 || y === 0 || y === h - 1 ||
        data[(i - 1) * 4 + 3] === 0 || data[(i + 1) * 4 + 3] === 0 ||
        data[(i - w) * 4 + 3] === 0 || data[(i + w) * 4 + 3] === 0;
      if (!boundary) continue;
      const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
      if (inks.has(key)) continue;
      const pi = nearestIndex(outline, cache, data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      const [r, g, b] = outline.rgb[pi];
      out.data[i * 4] = r;
      out.data[i * 4 + 1] = g;
      out.data[i * 4 + 2] = b;
    }
  }
  return out;
}
