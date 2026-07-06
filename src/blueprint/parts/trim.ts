// src/blueprint/parts/trim.ts
// Architectural TRIM vocabulary emitted as extra prims alongside a part's massing:
//   • buttresses — two-stage stepped piers between the windows + paired at the corners,
//     the gothic load-path made visible (churches, tithe barns, any masonry span).
//   • parapets — crenellated merlon teeth around a flat top (keeps, watch towers),
//     reusing the SAME battlement builders the defensive-wall towers use.
// Pure prim emission; deterministic; no new geometry primitives needed.
import type { Part as Prim } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import type { ResolvedPart, WallFace } from '../types';
import { merlonsAlongEdge } from '@/assetgen/geometry/tower-spec';
import { mToTiles } from '@/render/scale-contract';

/** Buttress proportions (tiles; 1 tile = 2 m). A two-stage pier: the lower stage is
 *  deeper, the upper sets back — the classic weathered offset. */
const BUTTRESS_W = 0.42;          // width along the wall — a chunky stone pier, not a thin stick
const LOWER_D = 0.46, UPPER_D = 0.28;  // bold projection from the wall plane (weathered set-off)
const LOWER_H_FRAC = 0.62, UPPER_H_FRAC = 0.9;  // stage tops as fractions of eave height (tall piers)

/** One two-stage buttress at wall position (x, y), projecting outward (ox, oy). */
function buttress(x: number, y: number, ox: number, oy: number, eaveH: number, mat: Mat, work?: string, finish?: string): Prim[] {
  const stage = (d: number, hFrac: number): Prim => ({
    prim: 'box',
    at: [
      x - (ox === 0 ? BUTTRESS_W / 2 : ox < 0 ? d : 0),
      y - (oy === 0 ? BUTTRESS_W / 2 : oy < 0 ? d : 0),
      0,
    ],
    size: [ox === 0 ? BUTTRESS_W : d, oy === 0 ? BUTTRESS_W : d, eaveH * hFrac],
    material: mat, ...(work ? { work } : {}), ...(finish ? { finish } : {}),
  });
  return [stage(LOWER_D, LOWER_H_FRAC), stage(UPPER_D, UPPER_H_FRAC)];
}

/** Wall-plane origin + outward direction for a face of a part rect. */
function facePlane(p: ResolvedPart, face: WallFace): { ox: number; oy: number; wallX: number; wallY: number; run: number; alongX: boolean } {
  const { x, y } = p.at, { w, h } = p.size;
  switch (face) {
    case 'south': return { ox: 0, oy: 1, wallX: x, wallY: y + h, run: w, alongX: true };
    case 'north': return { ox: 0, oy: -1, wallX: x, wallY: y, run: w, alongX: true };
    case 'east':  return { ox: 1, oy: 0, wallX: x + w, wallY: y, run: h, alongX: false };
    case 'west':  return { ox: -1, oy: 0, wallX: x, wallY: y, run: h, alongX: false };
  }
}

/**
 * Buttresses for a rect body: piers at the MIDPOINTS BETWEEN that face's windows (the
 * bay lines — windows already snap to bay centres), or even ~1.6-tile spacing when a
 * face has no windows; plus a pair of angle buttresses at each corner. Emitted on the
 * two LONG (eave) faces — where the roof thrust lands — and the corners brace both ways.
 */
export function buttressPrims(p: ResolvedPart, mat: Mat, eaveH: number, work?: string, finish?: string): Prim[] {
  const { w, h } = p.size;
  const out: Prim[] = [];
  const longFaces: WallFace[] = w >= h ? ['south', 'north'] : ['east', 'west'];

  for (const face of longFaces) {
    const { ox, oy, wallX, wallY, run, alongX } = facePlane(p, face);
    const ts = p.features
      .filter((f) => f.type === 'window' && (f.face ?? 'south') === face)
      .map((f) => (f.params.t as number) ?? 0.5)
      .sort((a, b) => a - b);
    // Bay lines: between adjacent windows; windowless walls get even spacing.
    const lines: number[] = [];
    if (ts.length >= 2) for (let i = 0; i + 1 < ts.length; i++) lines.push((ts[i] + ts[i + 1]) / 2);
    else {
      const n = Math.max(0, Math.round(run / 1.6) - 1);
      for (let i = 1; i <= n; i++) lines.push(i / (n + 1));
    }
    for (const t of lines) {
      const bx = alongX ? wallX + t * run : wallX;
      const by = alongX ? wallY : wallY + t * run;
      out.push(...buttress(bx, by, ox, oy, eaveH, mat, work, finish));
    }
  }

  // Angle buttresses: a pair at each corner, one along each wall, flush to the arris.
  const { x, y } = p.at;
  const inset = BUTTRESS_W / 2 + 0.02;
  const corners: Array<[number, number, 1 | -1, 1 | -1]> = [
    [x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    out.push(...buttress(cx - sx * inset, cy, 0, sy, eaveH, mat, work, finish));   // pier on the ±y face
    out.push(...buttress(cx, cy - sy * inset, sx, 0, eaveH, mat, work, finish));   // pier on the ±x face
  }
  return out;
}

/**
 * A crenellated parapet around a flat rect top: merlon teeth on all four edges (the
 * defensive-wall battlement builder), standing on a low continuous breast so the
 * crenels don't read as a gap-toothed floor from below.
 */
export function parapetPrims(p: ResolvedPart, topZ: number, mat: Mat, work?: string, finish?: string): Prim[] {
  // Sit a hair PROUD of the wall planes: a flush breast would be coplanar with the
  // body's wall faces and the flat-roof slab edge (z-fight).
  const o = 0.03;
  const x = p.at.x - o, y = p.at.y - o, w = p.size.w + 2 * o, h = p.size.h + 2 * o;
  const pt = mToTiles(0.4);          // parapet thickness
  const breastH = mToTiles(0.5), merlonH = mToTiles(1.3);
  const out: Prim[] = [];
  // Low breast wall: four thin curbs around the rim (merlon teeth above stay bare —
  // weathered battlements read as raw masonry even on a washed body).
  const fin = { ...(work ? { work } : {}), ...(finish ? { finish } : {}) };
  out.push(
    { prim: 'box', at: [x, y, topZ], size: [w, pt, breastH], material: mat, ...fin },
    { prim: 'box', at: [x, y + h - pt, topZ], size: [w, pt, breastH], material: mat, ...fin },
    { prim: 'box', at: [x, y + pt, topZ], size: [pt, h - 2 * pt, breastH], material: mat, ...fin },
    { prim: 'box', at: [x + w - pt, y + pt, topZ], size: [pt, h - 2 * pt, breastH], material: mat, ...fin },
  );
  // Merlon teeth on the breast, all four edges.
  out.push(...merlonsAlongEdge('x', y, x, x + w, topZ + breastH, merlonH, pt, mat));
  out.push(...merlonsAlongEdge('x', y + h - pt, x, x + w, topZ + breastH, merlonH, pt, mat));
  out.push(...merlonsAlongEdge('y', x, y, y + h, topZ + breastH, merlonH, pt, mat));
  out.push(...merlonsAlongEdge('y', x + w - pt, y, y + h, topZ + breastH, merlonH, pt, mat));
  return out;
}
