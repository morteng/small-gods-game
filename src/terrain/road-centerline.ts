// src/terrain/road-centerline.ts
//
// Centerline smoothing for roads — the research's decided spline pick
// (§11.4 of 2026-06-14-roads-linear-features-connectome-design.md):
// **centripetal Catmull-Rom (α=0.5)**, the only Catmull-Rom parameterisation with
// no cusps and no self-intersection within a segment (Yuksel 2011), interpolating
// THROUGH its control points — ideal for a centerline pinned to ordered cells.
//
// Why this matters under "roads = carved terrain": the carve follows the centerline
// directly, so a raw 4-connected A* path (orthogonal staircase) would carve a
// STAIRCASE DITCH. We first simplify the cell path to its key corners
// (Ramer–Douglas–Peucker), then run a centripetal Catmull-Rom through those corners
// and resample at ~1-tile arc spacing → a flowing graded centerline the carve can
// follow.
//
// Pure + deterministic (no Math.random); same input cells → same centerline.

export interface Pt {
  x: number;
  y: number;
}

/** Drop consecutive duplicate points (A* can revisit a cell coordinate). */
export function dedupe(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  return out;
}

/** Perpendicular distance from p to the line through a→b (a==b → distance to a). */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // |cross product| / |a→b|
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/**
 * Ramer–Douglas–Peucker: keep only the corners that deviate more than `epsilon`
 * from the straight chord. Collapses the staircase of a grid path to its real
 * turns before splining. Iterative (no recursion-depth blowups on long paths).
 */
export function simplifyPath(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], points[lo], points[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

/**
 * Centripetal Catmull-Rom interpolation of ONE segment p1→p2, using neighbours
 * p0/p3 for tangents. Returns the point at normalised parameter `s` in [0,1].
 * α=0.5 (centripetal). Coincident knots are guarded so spacing never divides by 0.
 */
function catmullRomPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, s: number): Pt {
  const ALPHA = 0.5;
  const knot = (ti: number, a: Pt, b: Pt): number => ti + Math.pow(Math.hypot(b.x - a.x, b.y - a.y), ALPHA);
  const EPS = 1e-9;
  const t0 = 0;
  const t1 = Math.max(knot(t0, p0, p1), t0 + EPS);
  const t2 = Math.max(knot(t1, p1, p2), t1 + EPS);
  const t3 = Math.max(knot(t2, p2, p3), t2 + EPS);
  const t = t1 + s * (t2 - t1);

  const lerpP = (a: Pt, b: Pt, ta: number, tb: number, tt: number): Pt => {
    const w = (tt - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const A1 = lerpP(p0, p1, t0, t1, t);
  const A2 = lerpP(p1, p2, t1, t2, t);
  const A3 = lerpP(p2, p3, t2, t3, t);
  const B1 = lerpP(A1, A2, t0, t2, t);
  const B2 = lerpP(A2, A3, t1, t3, t);
  return lerpP(B1, B2, t1, t2, t);
}

/**
 * Smooth a chain of control points into a centripetal Catmull-Rom polyline,
 * resampled at roughly `arcStep` tile spacing. Endpoints are clamped (phantom
 * neighbours duplicate the ends) so the curve passes exactly through the first
 * and last control point. ≤2 points pass through unchanged.
 */
export function catmullRomChain(control: Pt[], arcStep = 1): Pt[] {
  const cps = dedupe(control);
  if (cps.length <= 2) return cps.slice();
  const out: Pt[] = [cps[0]];
  for (let i = 0; i < cps.length - 1; i++) {
    const p0 = cps[i - 1] ?? cps[i];
    const p1 = cps[i];
    const p2 = cps[i + 1];
    const p3 = cps[i + 2] ?? cps[i + 1];
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.ceil(segLen / arcStep));
    for (let k = 1; k <= steps; k++) {
      out.push(catmullRomPoint(p0, p1, p2, p3, k / steps));
    }
  }
  return dedupe(out);
}

export interface SmoothOptions {
  /** RDP tolerance in tiles — how far the smoothed line may sit from a grid corner. */
  epsilon?: number;
  /** Resample spacing of the output polyline, in tiles. */
  arcStep?: number;
}

/**
 * Full pipeline: raw grid cells → simplified corners → centripetal Catmull-Rom
 * centerline. This is what the carve and surface producers should follow instead
 * of the staircase cell path. Deterministic.
 */
export function smoothCenterline(cells: Pt[], opts: SmoothOptions = {}): Pt[] {
  const epsilon = opts.epsilon ?? 0.75;
  const arcStep = opts.arcStep ?? 1;
  const clean = dedupe(cells);
  if (clean.length <= 2) return clean;
  const corners = simplifyPath(clean, epsilon);
  return catmullRomChain(corners, arcStep);
}
