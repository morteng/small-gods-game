// src/render/ribbon/ribbon-geometry.ts
//
// Ribbon geometry — the pure, terrain-agnostic foundation under BOTH road and
// river rendering (the "GPU ribbon-mesh", roads-epic T7). A linear feature is a
// polyline of tile-cells walked by A* / drainTo, so it staircases; here we
//
//   1. smooth the centerline with a centripetal Catmull-Rom spline (α=0.5 —
//      provably no cusp/self-intersection per segment, interpolates THROUGH the
//      control cells), then
//   2. resample it at a fixed arc-step and sweep a width-by-class cross-section
//      into a triangle-list mesh whose vertices carry PARAMETRIC attributes:
//        gx,gy   tile-space position (centerline ± normal·halfWidth)
//        across  −1 (left bank) … +1 (right bank)
//        along   arc length from the start, in tiles
//        width   local half-width in tiles (for FS feather / foam scale)
//        tx,ty   unit tangent (flow direction for rivers)
//        speed   flow-speed param (0 for roads; slope-derived for rivers)
//
// The mesh is TILE-SPACE only: the ribbon GPU vertex shader lifts each vertex
// onto the terrain height buffer and iso-projects it (exactly like the terrain
// shader), so the strip follows the ground on the GPU with no per-frame CPU lift.
// The parametric attrs are what the road/river fragment shaders sweep cobbles,
// flow, foam and edge-feathering across. No GPU/DOM here — fully unit-testable.

/** Floats per ribbon vertex (the interleaved vertex-buffer stride / 4).
 *  Layout: x,y, across, along, halfWidth, tx,ty, speed, tag0,tag1. */
export const RIBBON_FLOATS_PER_VERTEX = 10;

export interface Pt {
  x: number;
  y: number;
}

/** A per-sample scalar: a constant, or evaluated from the centerline position and
 *  its normalised arc-length `along01` ∈ [0,1] (lets rivers taper width / vary
 *  speed by terrain without this module knowing about terrain). */
export type RibbonScalar = number | ((x: number, y: number, along01: number) => number);

export interface RibbonSpec {
  /** Raw polyline in tile space (the walked cells). */
  points: Pt[];
  /** Half-width in tiles (a tile is 2 m). */
  halfWidth: RibbonScalar;
  /** Flow-speed param; default 0 (roads don't flow). */
  speed?: RibbonScalar;
  /** Ramer–Douglas–Peucker tolerance in TILES applied BEFORE smoothing — collapses
   *  the 4-connected cell staircase into free diagonal runs so the road/river cuts
   *  across tiles instead of stepping along the grid. Genuine bends (deviation ≫
   *  tol) are preserved, then rounded by the spline. 0 disables. Default 1.4. */
  simplifyTol?: number;
  /** Feature-defined 2-float tag baked per vertex (e.g. road surface id, river
   *  Strahler order) so one draw call can shade mixed ribbons. Default [0,0]. */
  tag?: [number, number] | ((x: number, y: number, along01: number) => [number, number]);
  /** Centerline resample step in tiles (smaller = smoother curve). */
  stepTiles?: number;
}

/** One resampled centerline sample with its frame + parametric attributes. */
export interface CenterlineSample {
  x: number;
  y: number;
  /** unit tangent */
  tx: number;
  ty: number;
  /** arc length from start, in tiles */
  along: number;
  halfWidth: number;
  speed: number;
  tag0: number;
  tag1: number;
}

export interface RibbonMesh {
  /** Interleaved vertex data, {@link RIBBON_FLOATS_PER_VERTEX} floats/vertex. */
  data: Float32Array;
  vertexCount: number;
}

function evalScalar(s: RibbonScalar | undefined, x: number, y: number, a01: number, dflt = 0): number {
  if (s === undefined) return dflt;
  return typeof s === 'number' ? s : s(x, y, a01);
}

/** Perpendicular distance from point `p` to the segment `a→b` (a point if a==b). */
function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * Ramer–Douglas–Peucker line simplification: drop points within `eps` tiles of the
 * chord, keeping only the vertices where the path genuinely bends. A grid staircase
 * (each step ≤ ~0.71 tiles off its diagonal chord) collapses to straight diagonal
 * runs; real corners (deviation ≫ eps) survive to be rounded by the spline. Iterative
 * (explicit stack) so long polylines don't blow the call stack.
 */
export function simplifyRDP(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3 || eps <= 0) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let idx = -1;
    let maxD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx !== -1) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Centripetal Catmull-Rom resample: a staircased polyline → a smooth, evenly-ish
 * spaced centerline that passes through the original cells. Endpoints are clamped
 * (duplicated) so the curve reaches them. Returns positions only; the frame +
 * attributes are added by {@link centerlineSamples}.
 */
export function smoothCenterline(pts: Pt[], stepTiles = 0.5): Pt[] {
  if (pts.length < 3) return pts.slice();
  const p = [pts[0], ...pts, pts[pts.length - 1]]; // clamp ends
  const out: Pt[] = [pts[0]];
  const alpha = 0.5;
  const tj = (ti: number, a: Pt, b: Pt) => ti + Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha);

  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    if (t2 === t1) continue; // coincident control points
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.ceil(segLen / stepTiles));
    for (let s = 1; s <= steps; s++) {
      const t = t1 + (t2 - t1) * (s / steps);
      const a1 = lerpT(p0, p1, t0, t1, t);
      const a2 = lerpT(p1, p2, t1, t2, t);
      const a3 = lerpT(p2, p3, t2, t3, t);
      const b1 = lerpT(a1, a2, t0, t2, t);
      const b2 = lerpT(a2, a3, t1, t3, t);
      out.push(lerpT(b1, b2, t1, t2, t));
    }
  }
  return dedupe(out);
}

function lerpT(a: Pt, b: Pt, ta: number, tb: number, t: number): Pt {
  const w = tb === ta ? 0 : (t - ta) / (tb - ta);
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}

/** Drop consecutive coincident points (zero-length segments break the tangent). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) out.push(p);
  }
  return out;
}

/**
 * Smooth + resample a polyline into centerline samples with a unit tangent,
 * cumulative arc length, and the per-sample width/speed scalars evaluated. The
 * tangent is a central difference (forward/back at the ends).
 */
export function centerlineSamples(spec: RibbonSpec): CenterlineSample[] {
  // Liberate from the grid: collapse the cell staircase into diagonal runs BEFORE
  // smoothing, so the spline rounds real bends instead of every tile step.
  const simplified = simplifyRDP(spec.points, spec.simplifyTol ?? 1.4);
  const c = smoothCenterline(simplified, spec.stepTiles ?? 0.5);
  if (c.length < 2) return [];

  // Cumulative arc length per point.
  const arc: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    arc.push(arc[i - 1] + Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y));
  }
  const total = arc[arc.length - 1] || 1;

  const out: CenterlineSample[] = [];
  for (let i = 0; i < c.length; i++) {
    const prev = c[Math.max(0, i - 1)];
    const next = c[Math.min(c.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const a01 = arc[i] / total;
    const tag = spec.tag === undefined
      ? [0, 0]
      : (typeof spec.tag === 'function' ? spec.tag(c[i].x, c[i].y, a01) : spec.tag);
    out.push({
      x: c[i].x,
      y: c[i].y,
      tx: dx,
      ty: dy,
      along: arc[i],
      halfWidth: Math.max(0, evalScalar(spec.halfWidth, c[i].x, c[i].y, a01, 0)),
      speed: evalScalar(spec.speed, c[i].x, c[i].y, a01, 0),
      tag0: tag[0],
      tag1: tag[1],
    });
  }
  return out;
}

/** Push one vertex (8 floats) onto `arr`. */
function vert(arr: number[], s: CenterlineSample, across: number): void {
  // Offset the position to the bank: perpendicular = (−ty, tx).
  arr.push(
    s.x + -s.ty * s.halfWidth * across,
    s.y + s.tx * s.halfWidth * across,
    across,
    s.along,
    s.halfWidth,
    s.tx,
    s.ty,
    s.speed,
    s.tag0,
    s.tag1,
  );
}

/**
 * Sweep one or more ribbon specs into a single interleaved triangle-list mesh
 * ({@link RIBBON_FLOATS_PER_VERTEX} floats/vertex). Two triangles per centerline
 * segment; left bank `across=−1`, right bank `across=+1`. Specs that smooth to
 * fewer than two samples are skipped. Empty input → a zero-length mesh.
 */
export function buildRibbonMesh(specs: RibbonSpec[]): RibbonMesh {
  const arr: number[] = [];
  for (const spec of specs) {
    const s = centerlineSamples(spec);
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i];
      const b = s[i + 1];
      // Quad (aL,aR,bL,bR) → 2 tris. Winding is irrelevant (no back-face cull).
      vert(arr, a, -1); vert(arr, a, +1); vert(arr, b, -1);
      vert(arr, a, +1); vert(arr, b, +1); vert(arr, b, -1);
    }
  }
  return { data: new Float32Array(arr), vertexCount: arr.length / RIBBON_FLOATS_PER_VERTEX };
}
