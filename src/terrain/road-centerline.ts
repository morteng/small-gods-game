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
 *
 * `preKeep` (optional) pins additional indices as mandatory corners — the bow-
 * reconciliation's lever: pinned points partition the RDP into sub-ranges, so the
 * spline is forced back through the walked cells wherever smoothing had bowed away.
 */
export function simplifyPath(points: Pt[], epsilon: number, preKeep?: ReadonlySet<number>): Pt[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [];
  if (preKeep && preKeep.size > 0) {
    // Seed the pinned corners, then RDP each sub-range between consecutive kept points.
    for (const i of preKeep) if (i >= 0 && i < points.length) keep[i] = 1;
    let prev = 0;
    for (let i = 1; i < points.length; i++) {
      if (!keep[i]) continue;
      if (i - prev > 1) stack.push([prev, i]);
      prev = i;
    }
  } else {
    stack.push([0, points.length - 1]);
  }
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

/** A unit direction-of-travel vector at a curve end (see `SmoothOptions`). */
export type Tangent = [number, number];

/**
 * Smooth a chain of control points into a centripetal Catmull-Rom polyline,
 * resampled at roughly `arcStep` tile spacing. Endpoints are clamped (phantom
 * neighbours duplicate the ends) so the curve passes exactly through the first
 * and last control point — UNLESS an endpoint tangent is supplied, in which case
 * the phantom neighbour is placed BEHIND the end along that tangent, so the curve
 * leaves the endpoint travelling in the given direction (the cross-edge C1 seam:
 * two edges sharing a node share a tangent through it instead of hooking).
 * ≤2 points pass through unchanged when no tangent asks for shaping.
 */
export function catmullRomChain(control: Pt[], arcStep = 1, startTangent?: Tangent, endTangent?: Tangent): Pt[] {
  const cps = dedupe(control);
  if (cps.length < 2 || (cps.length === 2 && !startTangent && !endTangent)) return cps.slice();
  const n = cps.length;
  // Phantom neighbours: `startTangent` is the direction of TRAVEL at cps[0] (into the
  // line), so the phantom sits behind it; `endTangent` is the travel direction OUT of
  // cps[n-1], so the phantom continues past it. Scaled by the adjacent chord length —
  // the centripetal knot spacing then weights it like a real neighbour.
  const l0 = Math.hypot(cps[1].x - cps[0].x, cps[1].y - cps[0].y) || 1;
  const ln = Math.hypot(cps[n - 1].x - cps[n - 2].x, cps[n - 1].y - cps[n - 2].y) || 1;
  const phantomStart = startTangent
    ? { x: cps[0].x - startTangent[0] * l0, y: cps[0].y - startTangent[1] * l0 }
    : undefined;
  const phantomEnd = endTangent
    ? { x: cps[n - 1].x + endTangent[0] * ln, y: cps[n - 1].y + endTangent[1] * ln }
    : undefined;
  const out: Pt[] = [cps[0]];
  for (let i = 0; i < cps.length - 1; i++) {
    const p0 = cps[i - 1] ?? phantomStart ?? cps[i];
    const p1 = cps[i];
    const p2 = cps[i + 1];
    const p3 = cps[i + 2] ?? phantomEnd ?? cps[i + 1];
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
  /** Indices into `cells` (the INPUT array, pre-dedupe) that must be kept as spline
   *  control points — the bow-reconciliation pins that force the smoothed line back
   *  through the walked cells where plain smoothing bowed off the legal row. */
  keepIndices?: ReadonlySet<number>;
  /** Direction of travel at `cells[0]` — makes the curve LEAVE the first point along this
   *  vector (cross-edge tangent continuity at a shared graph node). */
  startTangent?: Tangent;
  /** Direction of travel at the last cell — the curve ARRIVES travelling along this vector. */
  endTangent?: Tangent;
}

/**
 * Full pipeline: raw grid cells → simplified corners → centripetal Catmull-Rom
 * centerline. This is what the carve and surface producers should follow instead
 * of the staircase cell path. Deterministic.
 */
export function smoothCenterline(cells: Pt[], opts: SmoothOptions = {}): Pt[] {
  const epsilon = opts.epsilon ?? 0.75;
  const arcStep = opts.arcStep ?? 1;
  // Dedupe while remapping any pinned input indices onto the deduped array.
  const clean: Pt[] = [];
  let keep: Set<number> | undefined;
  if (opts.keepIndices && opts.keepIndices.size > 0) {
    keep = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i];
      const last = clean[clean.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) clean.push(p);
      if (opts.keepIndices.has(i)) keep.add(clean.length - 1);
    }
  } else {
    clean.push(...dedupe(cells));
  }
  if (clean.length < 2 || (clean.length === 2 && !opts.startTangent && !opts.endTangent)) return clean;
  const corners = clean.length === 2 ? clean : simplifyPath(clean, epsilon, keep);
  return catmullRomChain(corners, arcStep, opts.startTangent, opts.endTangent);
}
