// src/assetgen/geometry/building.ts
import type { Vec3, Mat, RGB, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';

export type RoofKind = 'gable' | 'hip' | 'pyramidal' | 'flat';
export interface Wing { x: number; y: number; w: number; h: number; storeys?: number; roof?: RoofKind }

const STOREY = 2.1;                                  // cube-units of height per storey
const INSET = 0.32;                                  // exterior-side footprint inset (tiles)
const PITCH: Record<RoofKind, number> = { gable: 1.5, hip: 1.35, pyramidal: 1.7, flat: 0 };

const shade = (c: RGB, f: number): RGB => [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];

export function occupancy(wings: Wing[]): Set<string> {
  const s = new Set<string>();
  for (const w of wings) for (let i = w.x; i < w.x+w.w; i++) for (let j = w.y; j < w.y+w.h; j++) s.add(i+','+j);
  return s;
}
const has = (occ: Set<string>, i: number, j: number): boolean => occ.has(i+','+j);

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
export { STOREY, INSET, PITCH, shade, has };
