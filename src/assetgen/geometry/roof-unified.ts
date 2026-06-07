// src/assetgen/geometry/roof-unified.ts
// Unified rectilinear roof over a whole cell footprint: one height field
//   h(x,y) = pitch · (distance to the nearest non-gable boundary edge)
// which is the rectilinear straight skeleton — convex corners become hips,
// concave corners become valleys, automatically. Edges marked "gable" are
// excluded from the distance set (the ridge runs out to them) and closed
// with a vertical gable face.
import type { Vec3, Mat, RGB, WorldFacet } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import type { Wing } from '@/assetgen/geometry/building';

export type RoofStyle = 'gable' | 'hip';
const PITCH: Record<RoofStyle, number> = { gable: 1.5, hip: 1.35 };
const MESH = 6; // per-cell subdivisions of the height field

const has = (occ: Set<string>, i: number, j: number): boolean => occ.has(i + ',' + j);
const shade = (c: RGB, f: number): RGB => [Math.round(c[0]*f), Math.round(c[1]*f), Math.round(c[2]*f)];

/** An axis-aligned unit boundary segment with the outward (away-from-interior) direction. */
interface Edge { horiz: boolean; at: number; lo: number; hi: number; outward: -1 | 1 }

/** Boundary edges of a rectilinear cell set, as unit segments carrying their outward side. */
export function boundaryEdges(occ: Set<string>): Edge[] {
  const e: Edge[] = [];
  for (const k of occ) {
    const [i, j] = k.split(',').map(Number);
    if (!has(occ, i, j-1)) e.push({ horiz: true,  at: j,   lo: i, hi: i+1, outward: -1 }); // north (interior +y)
    if (!has(occ, i, j+1)) e.push({ horiz: true,  at: j+1, lo: i, hi: i+1, outward: 1 });  // south
    if (!has(occ, i-1, j)) e.push({ horiz: false, at: i,   lo: j, hi: j+1, outward: -1 }); // west
    if (!has(occ, i+1, j)) e.push({ horiz: false, at: i+1, lo: j, hi: j+1, outward: 1 });  // east
  }
  return e;
}

/** Lines (one per wing short-end) whose boundary edges should be gabled. */
function gableLines(wings: Wing[]): { horiz: boolean; at: number }[] {
  const out: { horiz: boolean; at: number }[] = [];
  for (const w of wings) {
    if (w.w >= w.h) { out.push({ horiz: false, at: w.x }, { horiz: false, at: w.x + w.w }); } // gable the x-ends
    else            { out.push({ horiz: true,  at: w.y }, { horiz: true,  at: w.y + w.h }); } // gable the y-ends
  }
  return out;
}
const isGable = (e: Edge, lines: { horiz: boolean; at: number }[]): boolean =>
  lines.some(l => l.horiz === e.horiz && Math.abs(l.at - e.at) < 1e-9);

/** Roof height (pre-pitch) at (x,y): distance to the nearest active edge it projects onto. */
function distToEdges(x: number, y: number, edges: Edge[]): number {
  let m = Infinity;
  for (const e of edges) {
    if (e.horiz) { if (x >= e.lo && x <= e.hi) m = Math.min(m, Math.abs(y - e.at)); }
    else         { if (y >= e.lo && y <= e.hi) m = Math.min(m, Math.abs(x - e.at)); }
  }
  return m === Infinity ? 0 : m;
}

const cross = (u: Vec3, v: Vec3): Vec3 => [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
function tri(a: Vec3, b: Vec3, c: Vec3, col: RGB): WorldFacet {
  let n = cross([b[0]-a[0], b[1]-a[1], b[2]-a[2]], [c[0]-a[0], c[1]-a[1], c[2]-a[2]]);
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];                          // roof normals point up
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  const f = 0.62 + 0.38 * Math.max(0, (n[0]*0.45 + n[1]*0.35 + n[2]*0.82) / l); // slope-shaded grey
  return { pts: [a, b, c], normal: n, albedo: shade(col, Math.min(1, f)) };
}

export interface UnifiedRoofOpts { baseZ: number; roofMat?: Mat; roofStyle?: RoofStyle }

/** Build the unified roof (height-field mesh + gable closures) for a cell footprint. */
export function unifiedRoofFacets(occ: Set<string>, wings: Wing[], opts: UnifiedRoofOpts): WorldFacet[] {
  const style = opts.roofStyle ?? 'gable';
  const pitch = PITCH[style];
  const c = MATERIAL_RGB[opts.roofMat ?? 'tile'];
  const all = boundaryEdges(occ);
  const gLines = style === 'gable' ? gableLines(wings) : [];
  const active = all.filter(e => !isGable(e, gLines)); // edges the roof slopes down to
  const z = (x: number, y: number): Vec3 => [x, y, opts.baseZ + pitch * distToEdges(x, y, active)];
  const out: WorldFacet[] = [];

  // height-field mesh, per cell
  for (const k of occ) {
    const [i, j] = k.split(',').map(Number);
    for (let a = 0; a < MESH; a++) for (let b = 0; b < MESH; b++) {
      const x0 = i + a/MESH, x1 = i + (a+1)/MESH, y0 = j + b/MESH, y1 = j + (b+1)/MESH;
      const p00 = z(x0,y0), p10 = z(x1,y0), p11 = z(x1,y1), p01 = z(x0,y1);
      out.push(tri(p00, p10, p11, c), tri(p00, p11, p01, c));
    }
  }

  // vertical gable faces: one clean triangle per contiguous gable run (eave–eave–ridge).
  // (Per-cell unit edges are merged into runs; a subdivided face produced coincident
  // slivers that z-fought the roof mesh. A single planar triangle does not.)
  const gc = shade(c, 0.7);
  const EPS = 0.04; // nudge the gable plane a hair outward so it wins the z-test cleanly
  const groups = new Map<string, Edge[]>();
  for (const e of all.filter(ed => isGable(ed, gLines))) {
    const key = `${e.horiz}|${e.at}|${e.outward}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }
  for (const segs of groups.values()) {
    segs.sort((a, b) => a.lo - b.lo);
    const e0 = segs[0];
    const nrm: Vec3 = e0.horiz ? [0, e0.outward, 0] : [e0.outward, 0, 0];
    const at = e0.at + e0.outward * EPS;
    let lo = segs[0].lo, hi = segs[0].hi;
    const runs: [number, number][] = [];
    for (let i = 1; i < segs.length; i++) {
      if (Math.abs(segs[i].lo - hi) < 1e-9) hi = segs[i].hi;
      else { runs.push([lo, hi]); lo = segs[i].lo; hi = segs[i].hi; }
    }
    runs.push([lo, hi]);
    for (const [rlo, rhi] of runs) {
      const mid = (rlo + rhi) / 2;
      const apexZ = e0.horiz ? z(mid, e0.at)[2] : z(e0.at, mid)[2];
      const A: Vec3 = e0.horiz ? [rlo, at, opts.baseZ] : [at, rlo, opts.baseZ];
      const B: Vec3 = e0.horiz ? [rhi, at, opts.baseZ] : [at, rhi, opts.baseZ];
      const P: Vec3 = e0.horiz ? [mid, at, apexZ]      : [at, mid, apexZ];
      out.push({ pts: [A, B, P], normal: nrm, albedo: gc });
    }
  }
  return out;
}
