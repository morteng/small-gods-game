// src/world/anchor-fillet.ts
//
// The roads-article construction: connect two "profiles" (a point + a tangent direction) with a
// straight run and a single tangent arc. https://sandboxspirit.com/blog/simple-geometry-of-roads/
//
// `filletPath(p0, t0, p1, t1)` returns a sampled polyline that leaves p0 along t0, follows one
// circular arc (constant curvature — the property real roads want), and arrives at p1 along t1.
// When the two rays don't admit a single forward arc (an S-curve, or near-parallel), it falls
// back to a cubic Hermite through the same profiles, exactly as the article splits the hard case
// with an intermediary t=0.5 profile. Pure; used to smooth a road's APPROACH onto a matched
// anchor so it meets the structure tangentially. Render-only — never mutates the source polyline.

export interface Pt { x: number; y: number }
export type Vec = readonly [number, number];

function norm(v: Vec): [number, number] {
  const m = Math.hypot(v[0], v[1]);
  return m === 0 ? [0, 0] : [v[0] / m, v[1] / m];
}

/** Cubic Hermite from (p0,m0) to (p1,m1), sampled into `segments` spans. Tangents scaled by chord. */
export function hermite(p0: Pt, t0: Vec, p1: Pt, t1: Vec, segments: number): Pt[] {
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const a = norm(t0), b = norm(t1);
  const m0x = a[0] * chord, m0y = a[1] * chord, m1x = b[0] * chord, m1y = b[1] * chord;
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const s = i / segments, s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    out.push({
      x: h00 * p0.x + h10 * m0x + h01 * p1.x + h11 * m1x,
      y: h00 * p0.y + h10 * m0y + h01 * p1.y + h11 * m1y,
    });
  }
  return out;
}

export interface FilletOptions {
  /** Approx arc-length between samples in tiles (default 0.5). */
  step?: number;
  /** Min |det| of the ray system before treating the rays as parallel (default 1e-4). */
  parallelEps?: number;
}

/**
 * Smooth path from profile (p0,t0) to profile (p1,t1). Returns a polyline INCLUDING both
 * endpoints. Single line→arc when the rays meet ahead; Hermite fallback otherwise.
 */
export function filletPath(p0: Pt, t0: Vec, p1: Pt, t1: Vec, opts: FilletOptions = {}): Pt[] {
  const step = opts.step ?? 0.5;
  const eps = opts.parallelEps ?? 1e-4;
  const a = norm(t0), b = norm(t1);

  // Solve s·a + u·b = (p1 - p0) for the ray intersection I = p0 + s·a (and p1 = I + (u)·b… see header).
  const det = a[0] * b[1] - b[0] * a[1];
  if (Math.abs(det) < eps) {
    // Parallel / collinear rays — no single arc. Hermite handles it (straight if truly collinear).
    return resample(hermite(p0, a, p1, b, 24), step);
  }
  const rx = p1.x - p0.x, ry = p1.y - p0.y;
  const s = (rx * b[1] - ry * b[0]) / det;
  const u = (a[0] * ry - a[1] * rx) / det;
  if (s <= 1e-6 || u <= 1e-6) {
    // Intersection is behind a profile → an S-curve; the article inserts a Hermite midpoint.
    return resample(hermite(p0, a, p1, b, 24), step);
  }

  const I = { x: p0.x + s * a[0], y: p0.y + s * a[1] };
  const T = Math.min(s, u);
  const At = { x: I.x - T * a[0], y: I.y - T * a[1] }; // tangent point on ray A (toward p0)
  const Bt = { x: I.x + T * b[0], y: I.y + T * b[1] }; // tangent point on ray B (toward p1)

  // Arc centre: intersection of the normals at At and Bt.
  const nA: Vec = [-a[1], a[0]];
  const nB: Vec = [-b[1], b[0]];
  const cdet = nA[0] * -nB[1] - -nB[0] * nA[1];
  let arc: Pt[];
  if (Math.abs(cdet) < eps) {
    arc = [At, Bt];
  } else {
    const ex = Bt.x - At.x, ey = Bt.y - At.y;
    const k = (ex * -nB[1] - ey * -nB[0]) / cdet;
    const C = { x: At.x + k * nA[0], y: At.y + k * nA[1] };
    arc = sampleArc(C, At, Bt, step);
  }

  // p0 → (straight) → At → (arc) → Bt → (straight) → p1. Dedup coincident joins.
  const path: Pt[] = [p0];
  pushUnique(path, At);
  for (const q of arc) pushUnique(path, q);
  pushUnique(path, Bt);
  pushUnique(path, p1);
  return path;
}

/**
 * Re-shape the TAIL of a road polyline so it arrives at `target` heading into `-targetFacing`
 * (i.e. straight into the door/gate the anchor sits on). Grafts a fillet from a point
 * `graftBack` tiles before the end; the head of the polyline is untouched. Pure, render-only —
 * callers keep the original cell polyline for determinism and splice this for the ribbon.
 */
export function filletApproach(
  poly: ReadonlyArray<Pt>, target: Pt, targetFacing: Vec, opts: FilletOptions & { graftBack?: number } = {},
): Pt[] {
  if (poly.length < 2) return poly.slice();
  const graftBack = opts.graftBack ?? 3;
  // Walk back from the end accumulating arc length until ~graftBack tiles, to find the graft index.
  let acc = 0, gi = poly.length - 1;
  for (let i = poly.length - 1; i > 0; i--) {
    acc += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
    gi = i - 1;
    if (acc >= graftBack) break;
  }
  const graft = poly[gi];
  const next = poly[Math.min(gi + 1, poly.length - 1)];
  const tan = norm([next.x - graft.x, next.y - graft.y]);
  const arrive = norm([-targetFacing[0], -targetFacing[1]]); // road heads into the structure
  const tail = filletPath(graft, tan, target, arrive, opts);
  return [...poly.slice(0, gi), ...tail];
}

function sampleArc(C: Pt, from: Pt, to: Pt, step: number): Pt[] {
  const r = Math.hypot(from.x - C.x, from.y - C.y);
  let a0 = Math.atan2(from.y - C.y, from.x - C.x);
  const a1 = Math.atan2(to.y - C.y, to.x - C.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI; // minor arc — a fillet never turns ≥180°
  const n = Math.max(1, Math.ceil((Math.abs(d) * r) / step));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + d * (i / n);
    out.push({ x: C.x + r * Math.cos(ang), y: C.y + r * Math.sin(ang) });
  }
  return out;
}

function pushUnique(path: Pt[], p: Pt): void {
  const last = path[path.length - 1];
  if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) path.push(p);
}

/** Resample a polyline at ~`step` arc-length spacing, keeping the endpoints. */
function resample(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    let t = step - carry;
    while (t < len) {
      out.push({ x: a.x + (b.x - a.x) * (t / len), y: a.y + (b.y - a.y) * (t / len) });
      t += step;
    }
    carry = (carry + len) % step;
  }
  const last = pts[pts.length - 1];
  pushUnique(out, last);
  return out;
}
