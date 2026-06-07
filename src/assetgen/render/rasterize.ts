// src/assetgen/render/rasterize.ts
import type { ScreenFacet, RGB, Pt } from '@/assetgen/types';
import { normalRGB } from '@/assetgen/render/projection';

/** Scanline-fill a convex polygon (RGBA, opaque) into `data`. */
function fillPoly(data: Uint8ClampedArray, W: number, H: number, pts: Pt[], rgb: RGB): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(H - 1, Math.floor(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) { const o = (y*W + x)*4; data[o]=rgb[0]; data[o+1]=rgb[1]; data[o+2]=rgb[2]; data[o+3]=255; }
    }
  }
}

/** Painter's-order rasterise (far→near) into an RGBA buffer. */
export function rasterize(facets: ScreenFacet[], size: number, mode: 'albedo' | 'normal'): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const sorted = [...facets].sort((a, b) => a.depth - b.depth);
  for (const f of sorted) fillPoly(data, size, size, f.pts, mode === 'albedo' ? f.albedo : normalRGB(f.normal));
  return data;
}
