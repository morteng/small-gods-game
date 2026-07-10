// src/assetgen/render/rasterize.ts
import type { ScreenFacet, RGB, Pt, Vec3 } from '@/assetgen/types';
import { normalRGB } from '@/assetgen/render/projection';
import { materialPbr } from '@/assetgen/material-pbr';
import { prepareSurface, type FinishId, type SurfaceWork } from '@/assetgen/render/material-surface';

/** Opt-in analytic surface texturing (K0). When present, opaque pixels are textured by the
 *  Material+Finish engine at their interpolated world position; absent ⇒ flat per-facet
 *  albedo (the original behaviour, used for coverage masks and pre-K0d goldens). */
export interface SurfaceTexOpts { unitsPerMetre: number }

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

export interface RasterMaps {
  albedo: Uint8ClampedArray;   // RGBA
  normal: Uint8ClampedArray;   // RGB(A)
  material: Uint8ClampedArray; // R=depth(normalised later), G=AO(255 here), B=roughness, A=metallic
  emissive: Uint8ClampedArray; // RGB(A)
  depthRaw: Float32Array;      // view-depth per pixel (−Inf where empty)
  size: number;
  /** OPT-IN per-pixel provenance (see `pickIds` below). `data[i]` = 0 (no pick) or 1+index
   *  into `table` (the facet `src` strings, interned in first-seen order). Present only when
   *  the caller asked — every default caller gets the exact same struct as before. */
  pick?: { data: Uint16Array; table: string[] };
}

// `pickIds` mirrors how `surface` is optional: absent ⇒ zero new allocations, zero writes,
// byte-identical output (the golden-hash contract). When set, each z-test-WINNING pixel also
// records which facet `src` owns it — the same visibility rule as every colour buffer, so the
// pick pixel is exactly the pixel you see. Facets with no `src` still CLEAR the pixel to 0
// (a nearer untagged surface must occlude a farther tagged one, or picks would bleed through).
export function rasterizeMaps(facets: ScreenFacet[], size: number, surface?: SurfaceTexOpts, pickIds?: boolean): RasterMaps {
  const n = size * size;
  const albedo = new Uint8ClampedArray(n * 4);
  const normal = new Uint8ClampedArray(n * 4);
  const material = new Uint8ClampedArray(n * 4);
  const emissive = new Uint8ClampedArray(n * 4);
  const zbuf = new Float32Array(n); zbuf.fill(-Infinity);
  // Uint16 caps the table at 65535 distinct ids — orders of magnitude past any blueprint's
  // part+feature count, and 2 bytes/px keeps a 1k² pick buffer at 2 MB.
  const pick = pickIds ? { data: new Uint16Array(n), table: [] as string[] } : undefined;
  const intern = pick ? new Map<string, number>() : undefined;

  for (const f of facets) {
    const nrm = normalRGB(f.normal);
    // Intern this facet's pick id once (0 = untagged); hoisted out of the pixel loop.
    let pid = 0;
    if (pick && intern && f.src) {
      const got = intern.get(f.src);
      if (got !== undefined) pid = got;
      else { pick.table.push(f.src); pid = pick.table.length; intern.set(f.src, pid); }
    }
    const pbr = materialPbr(f.mat);
    const plane = f.depths ? depthPlane(f.pts, f.depths) : null;
    const [A, B, C] = plane ?? [0, 0, f.depth];

    // ── Surface texturing setup (per facet, hoisted out of the pixel loop) ──
    // Fit three affine world-coordinate planes wx/wy/wz over screen space (valid because the
    // projection is orthographic ⇒ world coords are affine in screen x,y), then bind one
    // Material+Finish sampler. Falls back to flat if world data is missing/degenerate.
    let sampler: ReturnType<typeof prepareSurface> | null = null;
    let pw: [number, number, number][] | null = null;
    if (surface && f.worldPts && f.depths) {
      const wx = depthPlane(f.pts, f.worldPts.map((p) => p[0]));
      const wy = depthPlane(f.pts, f.worldPts.map((p) => p[1]));
      const wz = depthPlane(f.pts, f.worldPts.map((p) => p[2]));
      if (wx && wy && wz) {
        pw = [wx, wy, wz];
        sampler = prepareSurface(
          {
            material: f.mat,
            work: f.work as SurfaceWork | undefined,
            finish: f.finish as FinishId | undefined,
            tint: f.tint,
          },
          f.normal, surface.unitsPerMetre, f.frame,
        );
      }
    }

    let minY = Infinity, maxY = -Infinity;
    for (const p of f.pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(size - 1, Math.floor(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0, j = f.pts.length - 1; i < f.pts.length; j = i++) {
        const a = f.pts[i], b = f.pts[j];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + (y - a.y) / (b.y - a.y) * (b.x - a.x));
      }
      xs.sort((m, q) => m - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k])), xb = Math.min(size - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) {
          const d = A * x + B * y + C;
          const zi = y * size + x;
          if (d < zbuf[zi]) continue;
          zbuf[zi] = d;
          // Pick write shares the z-win exactly (visible pixel == pick pixel). Unconditional
          // (pid may be 0): an untagged winner must overwrite a farther tagged facet.
          if (pick) pick.data[zi] = pid;
          const o = zi * 4;
          if (sampler && pw) {
            const wpos: Vec3 = [
              pw[0][0] * x + pw[0][1] * y + pw[0][2],
              pw[1][0] * x + pw[1][1] * y + pw[1][2],
              pw[2][0] * x + pw[2][1] * y + pw[2][2],
            ];
            const s = sampler.at(wpos);
            const sn = normalRGB(s.normal);
            albedo[o] = s.albedo[0]; albedo[o + 1] = s.albedo[1]; albedo[o + 2] = s.albedo[2]; albedo[o + 3] = 255;
            normal[o] = sn[0]; normal[o + 1] = sn[1]; normal[o + 2] = sn[2]; normal[o + 3] = 255;
            material[o] = 0;
            material[o + 1] = 255;
            material[o + 2] = Math.round(s.roughness * 255);
            material[o + 3] = Math.round(pbr.metallic * 255);
          } else {
            albedo[o] = f.albedo[0]; albedo[o + 1] = f.albedo[1]; albedo[o + 2] = f.albedo[2]; albedo[o + 3] = 255;
            normal[o] = nrm[0]; normal[o + 1] = nrm[1]; normal[o + 2] = nrm[2]; normal[o + 3] = 255;
            material[o] = 0;
            material[o + 1] = 255;
            material[o + 2] = Math.round(pbr.roughness * 255);
            material[o + 3] = Math.round(pbr.metallic * 255);
          }
          emissive[o] = pbr.emissive[0]; emissive[o + 1] = pbr.emissive[1]; emissive[o + 2] = pbr.emissive[2]; emissive[o + 3] = 255;
        }
      }
    }
  }
  return { albedo, normal, material, emissive, depthRaw: zbuf, size, ...(pick ? { pick } : {}) };
}

/**
 * Normalise raw view-depth into material.R (0=far, 255=near) across the opaque
 * range. Returns the raw {lo,hi} span so callers can keep the metric scale —
 * per-sprite normalisation is lossy, and inter-sprite lighting will want it back.
 * Returns null for an all-empty buffer.
 */
export function writeNormalisedDepth(maps: RasterMaps): { lo: number; hi: number } | null {
  let lo = Infinity, hi = -Infinity;
  const z = maps.depthRaw;
  for (let i = 0; i < z.length; i++) { if (z[i] === -Infinity) continue; if (z[i] < lo) lo = z[i]; if (z[i] > hi) hi = z[i]; }
  if (!isFinite(lo)) return null;
  const span = (hi - lo) || 1;
  for (let i = 0; i < z.length; i++) {
    if (z[i] === -Infinity) continue;
    maps.material[i * 4] = Math.round(((z[i] - lo) / span) * 255);
  }
  return { lo, hi };
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
