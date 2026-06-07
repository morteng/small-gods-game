// src/assetgen/render/rasterize.ts
import type { ScreenFacet, RGB, Pt } from '@/assetgen/types';
import { normalRGB } from '@/assetgen/render/projection';

/**
 * Fit an affine depth plane d(x,y) = A·x + B·y + C from 3 non-collinear (pt, depth)
 * samples. Valid because the projection is orthographic: a planar world facet's
 * view-depth is affine in screen space. Returns null if all vertices are collinear.
 */
function depthPlane(pts: Pt[], depths: number[]): [number, number, number] | null {
  const n = pts.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    const p0 = pts[a], p1 = pts[b], p2 = pts[c];
    const det = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    if (Math.abs(det) < 1e-6) continue;
    const d0 = depths[a], d1 = depths[b], d2 = depths[c];
    const A = ((d1 - d0) * (p2.y - p0.y) - (d2 - d0) * (p1.y - p0.y)) / det;
    const B = ((d2 - d0) * (p1.x - p0.x) - (d1 - d0) * (p2.x - p0.x)) / det;
    const C = d0 - A * p0.x - B * p0.y;
    return [A, B, C];
  }
  return null;
}

/** Scanline-fill a convex polygon with a per-pixel z-test (larger depth = nearer wins). */
function fillPolyZ(
  data: Uint8ClampedArray, zbuf: Float32Array, W: number, H: number,
  pts: Pt[], rgb: RGB, plane: [number, number, number] | null, flat: number,
): void {
  const [A, B, C] = plane ?? [0, 0, flat];
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
      for (let x = xa; x <= xb; x++) {
        const d = A * x + B * y + C;
        const zi = y * W + x;
        if (d < zbuf[zi]) continue;               // a nearer fragment already owns this pixel
        zbuf[zi] = d;
        const o = zi * 4; data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
      }
    }
  }
}

/**
 * Rasterise facets into an RGBA buffer with a per-pixel z-buffer — resolves
 * interpenetration and partial occlusion exactly (no global facet sort, which
 * mis-orders small-near-vs-large-far facets). Falls back to the facet's mean
 * `depth` as a constant plane when per-vertex `depths` are absent.
 */
export function rasterize(facets: ScreenFacet[], size: number, mode: 'albedo' | 'normal'): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const zbuf = new Float32Array(size * size);
  zbuf.fill(-Infinity);
  for (const f of facets) {
    const rgb = mode === 'albedo' ? f.albedo : normalRGB(f.normal);
    const plane = f.depths ? depthPlane(f.pts, f.depths) : null;
    fillPolyZ(data, zbuf, size, size, f.pts, rgb, plane, f.depth);
  }
  return data;
}
