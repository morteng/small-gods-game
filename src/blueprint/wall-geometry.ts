// src/blueprint/wall-geometry.ts
// One home for wall-face geometry, shared by the opening kinds and the four compilers.
// Converts a part-local ApertureSpec (face/t/sill/halfW/height/depth) into absolute
// structure-space boxes: the carved aperture (a recess) and the flush filler leaf.
import type { ApertureBox } from '@/assetgen/geometry/solids';
import type { ResolvedPart, WallFace } from './types';
import type { ApertureSpec } from './features/opening';
import { bodyWings, type Plan } from './parts/body';

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

/**
 * Outer-wall coordinate (the constant axis of the wall plane) for an opening on `face`
 * at along-position `along`, honouring multi-wing footprints (L/cross plans). The
 * declared face is kept; we just snap to the FRONTMOST wing whose face-parallel span
 * actually contains `along` — so a window placed past an L-plan's frontage step lands on
 * the real set-back wall instead of floating on the bbox edge over the re-entrant notch.
 * Round bodies are a cylinder, not a box: the outer coordinate rides the circle so an
 * opening at any along-position hugs the curved wall instead of floating on the bbox edge.
 * Single-wing/stepped bodies (and any non-`body` part) fall back to the bbox edge.
 */
export function outerCoord(part: ResolvedPart, face: WallFace, along: number): number {
  const { x, y } = part.at, { w, h } = part.size;
  const bbox = face === 'south' ? y + h : face === 'north' ? y : face === 'east' ? x + w : x;
  const plan = part.params?.plan as Plan | undefined;
  if (plan === 'round') {
    // Cylinder of radius min(w,h)/2 centred on the bbox. Project the along-position onto
    // the circle: bulge = √(r²−off²) is how far the wall stands out from the centre line at
    // this point. Off-axis openings (off→r) collapse to the cardinal tangent, never past it.
    const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
    const horiz = face === 'south' || face === 'north';
    const off = Math.min(r, Math.abs(along - (horiz ? cx : cy)));
    const bulge = Math.sqrt(Math.max(0, r * r - off * off));
    switch (face) {
      case 'south': return cy + bulge;
      case 'north': return cy - bulge;
      case 'east':  return cx + bulge;
      case 'west':  return cx - bulge;
    }
  }
  if (plan !== 'L' && plan !== 'cross') return bbox;
  const horiz = face === 'south' || face === 'north';
  const front = face === 'south' || face === 'east';   // frontmost = max coord on +y/+x faces
  let best: number | null = null;
  for (const r of bodyWings(part)) {
    const wx = r.x + x, wy = r.y + y;
    const lo = horiz ? wx : wy, hi = horiz ? wx + r.w : wy + r.h;
    if (along < lo || along > hi) continue;            // this wing doesn't span the opening
    const edge = face === 'south' ? wy + r.h : face === 'north' ? wy : face === 'east' ? wx + r.w : wx;
    if (best === null) best = edge;
    else best = front ? Math.max(best, edge) : Math.min(best, edge);
  }
  return best ?? bbox;
}

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

/**
 * Point on a round body's cylinder wall for an opening, plus the outward radial unit
 * normal there. The opening's along-coordinate is projected onto the circle so the box
 * can be placed ON the curve and yawed to face radially out (flush), instead of sitting
 * axis-aligned on the bbox edge (which only meets the curve at the cardinal midpoint).
 */
function circlePoint(part: ResolvedPart, s: ApertureSpec): { px: number; py: number; nx: number; ny: number; yaw: number } {
  const { x, y } = part.at, { w, h } = part.size;
  const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
  const horiz = s.face === 'south' || s.face === 'north';
  const along = horiz ? x + s.t * w : y + s.t * h;       // matches alongCentre
  const center = horiz ? cx : cy;
  const off = Math.max(-r, Math.min(r, along - center)); // clamp the centre into the circle
  const bulge = Math.sqrt(Math.max(0, r * r - off * off));
  let px: number, py: number;
  if (horiz) { px = cx + off; py = s.face === 'south' ? cy + bulge : cy - bulge; }
  else { py = cy + off; px = s.face === 'east' ? cx + bulge : cx - bulge; }
  const nx = (px - cx) / r, ny = (py - cy) / r;
  // A canonical (south) opening's depth runs along +y. Rotation about Z by `yaw` maps +y
  // onto the radial normal: (0,1) → (−sinθ, cosθ), so θ = atan2(−nx, ny).
  const yaw = Math.atan2(-nx, ny) * 180 / Math.PI;
  return { px, py, nx, ny, yaw };
}

/** Round-body aperture: a radial slot centred on the cylinder wall, yawed to face out. */
function roundAperture(part: ResolvedPart, s: ApertureSpec): FaceBox {
  const { px, py, nx, ny, yaw } = circlePoint(part, s);
  const depth = s.depth + APERTURE_EPS;                  // poke a touch past the outer face
  // Outer face at P + EPS outward, inner at P − depth inward → centre offset along normal.
  const ox = px + nx * (APERTURE_EPS - s.depth) / 2, oy = py + ny * (APERTURE_EPS - s.depth) / 2;
  return { at: [ox - s.halfW, oy - depth / 2, s.sill], size: [2 * s.halfW, depth, s.height], yaw };
}

/** Round-body filler leaf: a thin pane on the cylinder wall, inset and yawed to match. */
function roundLeaf(part: ResolvedPart, s: ApertureSpec): FaceBox {
  const { px, py, nx, ny, yaw } = circlePoint(part, s);
  const off = LEAF_INSET + LEAF_THICKNESS / 2;           // pane centre, inset from the wall face
  const ox = px - nx * off, oy = py - ny * off;
  return { at: [ox - s.halfW, oy - LEAF_THICKNESS / 2, s.sill], size: [2 * s.halfW, LEAF_THICKNESS, s.height], yaw };
}

/** The aperture box (subtracted from the wall) for this opening, in absolute structure space.
 *  It is a recess of depth `s.depth` into the wall, poking `APERTURE_EPS` past the outer plane. */
export function apertureToBox(s: ApertureSpec, part: ResolvedPart): FaceBox {
  if (part.params?.plan === 'round') return roundAperture(part, s);
  const c = alongCentre(part, s);
  const d = s.depth, e = APERTURE_EPS, two = 2 * s.halfW;
  switch (s.face) {
    case 'south': { const yp = outerCoord(part, 'south', c); return { at: [c - s.halfW, yp - d, s.sill], size: [two, d + e, s.height] }; }
    case 'north': { const yp = outerCoord(part, 'north', c); return { at: [c - s.halfW, yp - e, s.sill], size: [two, d + e, s.height] }; }
    case 'east':  { const xp = outerCoord(part, 'east',  c); return { at: [xp - d, c - s.halfW, s.sill], size: [d + e, two, s.height] }; }
    case 'west':  { const xp = outerCoord(part, 'west',  c); return { at: [xp - e, c - s.halfW, s.sill], size: [d + e, two, s.height] }; }
  }
}

/** The flush filler-leaf box for this opening (outer face inset `LEAF_INSET` inside the wall
 *  plane, so it never protrudes), in absolute structure space. */
export function leafBox(s: ApertureSpec, part: ResolvedPart): FaceBox {
  if (part.params?.plan === 'round') return roundLeaf(part, s);
  const c = alongCentre(part, s);
  const i = LEAF_INSET, th = LEAF_THICKNESS, two = 2 * s.halfW;
  switch (s.face) {
    case 'south': { const yp = outerCoord(part, 'south', c); return { at: [c - s.halfW, yp - i - th, s.sill], size: [two, th, s.height] }; }
    case 'north': { const yp = outerCoord(part, 'north', c); return { at: [c - s.halfW, yp + i,      s.sill], size: [two, th, s.height] }; }
    case 'east':  { const xp = outerCoord(part, 'east',  c); return { at: [xp - i - th, c - s.halfW, s.sill], size: [th, two, s.height] }; }
    case 'west':  { const xp = outerCoord(part, 'west',  c); return { at: [xp + i,      c - s.halfW, s.sill], size: [th, two, s.height] }; }
  }
}
