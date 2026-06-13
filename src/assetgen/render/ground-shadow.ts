// src/assetgen/render/ground-shadow.ts
// Geometry-correct cast shadow: instead of skewing the finished 2D sprite (which
// treats every pixel as the same height and distorts tall/round forms), we take
// the SAME 3D facets the sprite is rendered from and project them onto the ground
// plane (z=0) along the sun ray, then rasterise the union as a flat dark mask.
// The result is the object's TRUE shadow shape, baked once at generation time and
// blitted cheaply at runtime. Co-registered with the sprite via the same `fit`.
import type { WorldFacet } from '@/assetgen/types';
import { project, type ProjScale } from './projection';

export interface GroundShadow {
  /** RGBA, black with per-pixel coverage alpha. */
  data: Uint8ClampedArray;
  w: number;
  h: number;
  /** Screen-space origin (same coords as `project()`), so it positions vs the sprite. */
  ox: number;
  oy: number;
}

/** Ground screen-displacement per screen-px of height, from the (screen-space) sun
 *  direction [sx=right, sy=up, sz=toward-camera]. Mirrors the live-shadow math so the
 *  baked shadow points the same way the lighting implies. */
export function groundOffset(sun: [number, number, number], damp = 0.8): { gx: number; gy: number } {
  const [sx, sy, sz] = sun;
  const up = Math.max(0.2, sy);
  return { gx: (-sx / up) * damp, gy: (-sz / up) * 0.5 * damp };
}

/** Scanline-fill a polygon's coverage into an alpha buffer (union; no z-test). */
function fillCoverage(alpha: Uint8ClampedArray, W: number, H: number, pts: Array<{ x: number; y: number }>): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(H - 1, Math.floor(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) alpha[y * W + x] = 1;
    }
  }
}

/**
 * Project all facets to the ground along the sun and rasterise the union.
 * `sun` is the screen-space sun direction (default the canonical upper-left).
 * Returns null if the geometry is flat/empty (nothing to cast).
 */
export function composeGroundShadow(
  facets: WorldFacet[], fit: ProjScale, sun: [number, number, number] = [-0.5, 0.65, 0.58],
): GroundShadow | null {
  if (!facets.length) return null;
  const { gx, gy } = groundOffset(sun);
  // Each world vertex (x,y,z): its ground FOOT screen pos is project(x,y,0) =
  // (project.x, project.y + z·scale); the shadow slides that foot along the sun by
  // (gx,gy)·heightPx. So shadowPt = (project.x + gx·hpx, project.y + hpx·(1 + gy)).
  const shadowFacets: Array<Array<{ x: number; y: number }>> = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of facets) {
    const poly = f.pts.map((p) => {
      const s = project(p, fit);
      const hpx = p[2] * fit.scale;
      const x = s.x + gx * hpx;
      const y = s.y + hpx * (1 + gy);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return { x, y };
    });
    shadowFacets.push(poly);
  }
  const pad = 1;
  const ox = Math.floor(minX) - pad, oy = Math.floor(minY) - pad;
  const w = Math.ceil(maxX) - ox + pad, h = Math.ceil(maxY) - oy + pad;
  if (w <= 0 || h <= 0 || w * h > 4_000_000) return null;
  const alpha = new Uint8ClampedArray(w * h);
  for (const poly of shadowFacets) {
    fillCoverage(alpha, w, h, poly.map((p) => ({ x: p.x - ox, y: p.y - oy })));
  }
  // Pack to RGBA (black, coverage alpha). A light feather could come later.
  const data = new Uint8ClampedArray(w * h * 4);
  let any = false;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i]) { data[i * 4 + 3] = 255; any = true; }
  }
  return any ? { data, w, h, ox, oy } : null;
}
