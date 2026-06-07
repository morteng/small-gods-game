// src/assetgen/geometry/building.ts
import type { Vec3, Mat, RGB, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';

export type RoofKind = 'gable' | 'hip' | 'pyramidal' | 'flat';
export interface Wing { x: number; y: number; w: number; h: number; storeys?: number; roof?: RoofKind }

export const STOREY = 2.1;                           // cube-units of height per storey
export const INSET = 0.32;                            // exterior-side footprint inset (tiles)
export const PITCH: Record<RoofKind, number> = { gable: 1.5, hip: 1.35, pyramidal: 1.7, flat: 0 };

export const shade = (c: RGB, f: number): RGB => [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];

export function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x+w.w; i++) for (let j = w.y; j < w.y+w.h; j++) s.add(i+','+j);
  return s;
}
export const has = (occ: Set<string>, i: number, j: number): boolean => occ.has(i+','+j);

export function cellStoreys(wings: Wing[], i: number, j: number): number {
  let m = 1;
  for (const w of wings) if (i>=w.x && i<w.x+w.w && j>=w.y && j<w.y+w.h) m = Math.max(m, w.storeys ?? 1);
  return m;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Ground rectangle of one cell; inset only on EXTERIOR sides (shared sides stay flush). */
export function cellRect(occ: Set<string>, i: number, j: number): Rect {
  return {
    x0: i     + (has(occ, i-1, j) ? 0 : INSET),
    x1: i + 1 - (has(occ, i+1, j) ? 0 : INSET),
    y0: j     + (has(occ, i, j-1) ? 0 : INSET),
    y1: j + 1 - (has(occ, i, j+1) ? 0 : INSET),
  };
}

/** Ground rectangle of a whole wing; inset only where the wing borders open space. */
export function wingRect(occ: Set<string>, w: Wing): Rect {
  const colShared = (ci: number) => { for (let j=w.y; j<w.y+w.h; j++) if (has(occ, ci, j)) return true; return false; };
  const rowShared = (rj: number) => { for (let i=w.x; i<w.x+w.w; i++) if (has(occ, i, rj)) return true; return false; };
  return {
    x0: w.x       + (colShared(w.x - 1)     ? 0 : INSET),
    x1: w.x + w.w - (colShared(w.x + w.w)   ? 0 : INSET),
    y0: w.y       + (rowShared(w.y - 1)     ? 0 : INSET),
    y1: w.y + w.h - (rowShared(w.y + w.h)   ? 0 : INSET),
  };
}

// (wallFacets / roofFacets / buildingFacets land in the following tasks.)

/** Per-cell exterior walls (all four sides; shared sides culled) + a top cap. World space. */
export function wallFacets(wings: Wing[], occ: Set<string>, wallMat: Mat): WorldFacet[] {
  const c = MATERIAL_RGB[wallMat];
  const out: WorldFacet[] = [];
  for (const k of occ) {
    const [i, j] = k.split(',').map(Number);
    const r = cellRect(occ, i, j);
    const b = cellStoreys(wings, i, j) * STOREY;
    if (!has(occ, i, j-1)) out.push({ pts: [[r.x0,r.y0,0],[r.x1,r.y0,0],[r.x1,r.y0,b],[r.x0,r.y0,b]], normal: [0,-1,0], albedo: shade(c, 0.5) });  // north (culled at view)
    if (!has(occ, i, j+1)) out.push({ pts: [[r.x0,r.y1,0],[r.x1,r.y1,0],[r.x1,r.y1,b],[r.x0,r.y1,b]], normal: [0,1,0],  albedo: shade(c, 0.62) }); // south
    if (!has(occ, i-1, j)) out.push({ pts: [[r.x0,r.y0,0],[r.x0,r.y1,0],[r.x0,r.y1,b],[r.x0,r.y0,b]], normal: [-1,0,0], albedo: shade(c, 0.5) });  // west (culled)
    if (!has(occ, i+1, j)) out.push({ pts: [[r.x1,r.y0,0],[r.x1,r.y1,0],[r.x1,r.y1,b],[r.x1,r.y0,b]], normal: [1,0,0],  albedo: shade(c, 0.82) }); // east
    out.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b],[r.x1,r.y1,b],[r.x0,r.y1,b]], normal: [0,0,1], albedo: shade(c, 0.95) }); // top cap
  }
  return out;
}

export interface RoofMeta { ridge?: [Vec3, Vec3]; apex?: Vec3 }

/** One wing's roof in world space. Gable ends are closed (no open silhouette notch). */
export function roofFacets(occ: Set<string>, w: Wing, roofMat: Mat): { facets: WorldFacet[]; meta: RoofMeta } {
  const kind = w.roof ?? 'gable';
  const c = MATERIAL_RGB[roofMat];
  const r = wingRect(occ, w);
  const b = (w.storeys ?? 1) * STOREY;
  const shortSpan = Math.max(0.5, Math.min(w.w, w.h) - 2 * INSET);
  const rise = PITCH[kind] * (shortSpan / 2);
  const top = b + rise;
  const facets: WorldFacet[] = [];
  const meta: RoofMeta = {};
  if (kind === 'flat') return { facets, meta };

  if (kind === 'gable') {
    if (w.w >= w.h) {                                   // ridge along x (long axis)
      const ym = (r.y0 + r.y1) / 2;
      const ra: Vec3 = [r.x0, ym, top], rb: Vec3 = [r.x1, ym, top];
      facets.push({ pts: [[r.x0,r.y1,b],[r.x1,r.y1,b], rb, ra], normal: [0, PITCH.gable, 1],  albedo: shade(c, 0.84) }); // south slope
      facets.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b], rb, ra], normal: [0, -PITCH.gable, 1], albedo: shade(c, 1.0) });  // north slope
      facets.push({ pts: [[r.x1,r.y0,b],[r.x1,r.y1,b], rb],     normal: [1, 0, 0],            albedo: shade(c, 0.8) });  // east gable end
      facets.push({ pts: [[r.x0,r.y0,b],[r.x0,r.y1,b], ra],     normal: [-1, 0, 0],           albedo: shade(c, 0.6) });  // west gable end
      meta.ridge = [ra, rb];
    } else {                                            // ridge along y
      const xm = (r.x0 + r.x1) / 2;
      const ra: Vec3 = [xm, r.y0, top], rb: Vec3 = [xm, r.y1, top];
      facets.push({ pts: [[r.x1,r.y0,b],[r.x1,r.y1,b], rb, ra], normal: [PITCH.gable, 0, 1],  albedo: shade(c, 0.84) }); // east slope
      facets.push({ pts: [[r.x0,r.y0,b],[r.x0,r.y1,b], rb, ra], normal: [-PITCH.gable, 0, 1], albedo: shade(c, 1.0) });  // west slope
      facets.push({ pts: [[r.x0,r.y1,b],[r.x1,r.y1,b], rb],     normal: [0, 1, 0],            albedo: shade(c, 0.62) }); // south gable end
      facets.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b], ra],     normal: [0, -1, 0],           albedo: shade(c, 0.5) });  // north gable end
      meta.ridge = [ra, rb];
    }
  } else {                                              // hip | pyramidal — apex
    const ap: Vec3 = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, top];
    facets.push({ pts: [[r.x0,r.y0,b],[r.x1,r.y0,b], ap], normal: [0, -1, 1], albedo: shade(c, 1.0) });  // north
    facets.push({ pts: [[r.x1,r.y0,b],[r.x1,r.y1,b], ap], normal: [1, 0, 1],  albedo: shade(c, 0.82) }); // east
    facets.push({ pts: [[r.x0,r.y1,b],[r.x1,r.y1,b], ap], normal: [0, 1, 1],  albedo: shade(c, 0.7) });  // south
    facets.push({ pts: [[r.x0,r.y0,b],[r.x0,r.y1,b], ap], normal: [-1, 0, 1], albedo: shade(c, 0.6) });  // west
    meta.apex = ap;
  }
  return { facets, meta };
}
