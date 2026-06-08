// src/blueprint/wall-geometry.ts
// One home for wall-face geometry, shared by the opening kinds and the four compilers.
// Converts a part-local ApertureSpec (face/t/sill/halfW/height/depth) into absolute
// structure-space boxes: the carved aperture (a recess) and the flush filler leaf.
import type { ApertureBox } from '@/assetgen/geometry/solids';
import type { ResolvedPart, WallFace } from './types';
import type { ApertureSpec } from './features/opening';

export const APERTURE_EPS = 0.02;   // pokes the cut past the wall plane (boolean robustness)
export const LEAF_INSET = 0.04;     // leaf outer face sits this far INSIDE the wall plane
export const LEAF_THICKNESS = 0.08; // leaf panel depth

// Outward unit normal per wall face (blueprint layer). Value-table form so the compilers
// can read it directly without a closure.
export const FACE_FACING: Record<WallFace, [number, number]> = {
  south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0],
};

// An absolute structure-space box. Aliased to the assetgen carve type so the aperture
// boxes this module produces are the SAME type the geometry layer subtracts (no silent
// structural-identity coupling that could diverge if either gains a field).
export type FaceBox = ApertureBox;

/** Structure-local perimeter cell an opening at fraction `t` along `face` occupies. */
export function faceCell(part: ResolvedPart, face: WallFace, t = 0.5): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const idx = (run: number) => Math.min(run - 1, Math.max(0, Math.floor(t * run)));
  switch (face) {
    case 'south': return [x + idx(w), y + h - 1];
    case 'north': return [x + idx(w), y];
    case 'east':  return [x + w - 1, y + idx(h)];
    case 'west':  return [x, y + idx(h)];
  }
}

/** Continuous coordinate along the wall run for the opening centre: interpolates along x
 *  for south/north walls, along y for east/west walls, by the opening's fraction `s.t`. */
function alongCentre(part: ResolvedPart, s: ApertureSpec): number {
  const { x, y } = part.at, { w, h } = part.size;
  return (s.face === 'south' || s.face === 'north') ? x + s.t * w : y + s.t * h;
}

/** The aperture box (subtracted from the wall) for this opening, in absolute structure space.
 *  It is a recess of depth `s.depth` into the wall, poking `APERTURE_EPS` past the outer plane. */
export function apertureToBox(s: ApertureSpec, part: ResolvedPart): FaceBox {
  const { x, y } = part.at, { w, h } = part.size;
  const c = alongCentre(part, s);
  const d = s.depth, e = APERTURE_EPS, two = 2 * s.halfW;
  switch (s.face) {
    case 'south': { const yp = y + h; return { at: [c - s.halfW, yp - d, s.sill], size: [two, d + e, s.height] }; }
    case 'north': { const yp = y;     return { at: [c - s.halfW, yp - e, s.sill], size: [two, d + e, s.height] }; }
    case 'east':  { const xp = x + w; return { at: [xp - d, c - s.halfW, s.sill], size: [d + e, two, s.height] }; }
    case 'west':  { const xp = x;     return { at: [xp - e, c - s.halfW, s.sill], size: [d + e, two, s.height] }; }
  }
}

/** The flush filler-leaf box for this opening (outer face inset `LEAF_INSET` inside the wall
 *  plane, so it never protrudes), in absolute structure space. */
export function leafBox(s: ApertureSpec, part: ResolvedPart): FaceBox {
  const { x, y } = part.at, { w, h } = part.size;
  const c = alongCentre(part, s);
  const i = LEAF_INSET, th = LEAF_THICKNESS, two = 2 * s.halfW;
  switch (s.face) {
    case 'south': { const yp = y + h; return { at: [c - s.halfW, yp - i - th, s.sill], size: [two, th, s.height] }; }
    case 'north': { const yp = y;     return { at: [c - s.halfW, yp + i,      s.sill], size: [two, th, s.height] }; }
    case 'east':  { const xp = x + w; return { at: [xp - i - th, c - s.halfW, s.sill], size: [th, two, s.height] }; }
    case 'west':  { const xp = x;     return { at: [xp + i,      c - s.halfW, s.sill], size: [th, two, s.height] }; }
  }
}
