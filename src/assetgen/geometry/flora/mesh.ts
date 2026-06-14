// src/assetgen/geometry/flora/mesh.ts
// Turn a flora skeleton (limbs + leaves) and rocks into WorldFacets directly —
// no manifold CSG needed: limbs/leaves/rocks just overlap and the existing
// z-buffer rasteriser composites them. We reuse `manifoldToFacets` for IDENTICAL
// per-face shading/material handling by handing it a minimal triangle-soup mesh
// (it only reads numProp/vertProperties/triVerts), so flora sprites match the
// building pipeline's look by construction.
import type { Vec3, Mat, WorldFacet } from '@/assetgen/types';
import type { Mesh } from 'manifold-3d';
import { manifoldToFacets } from '@/assetgen/geometry/solids';
import { add, scale, sub, normalize, cross } from './vec3';
import type { Limb, Leaf } from './turtle';

/** Accumulates a flat triangle soup, then emits facets via the shared shader. */
class MeshSoup {
  private verts: number[] = [];
  private tris: number[] = [];
  tri(a: Vec3, b: Vec3, c: Vec3): void {
    const i = this.verts.length / 3;
    this.verts.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.tris.push(i, i + 1, i + 2);
  }
  facets(mat: Mat): WorldFacet[] {
    if (!this.tris.length) return [];
    const mesh = { numProp: 3, vertProperties: Float32Array.from(this.verts), triVerts: Uint32Array.from(this.tris) };
    return manifoldToFacets(mesh as unknown as Mesh, mat);
  }
}

const TAU = Math.PI * 2;

/** Ring of `sides` points around `center` in the plane spanned by (u,w), radius `r`. */
function ring(center: Vec3, u: Vec3, w: Vec3, r: number, sides: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const t = (TAU * i) / sides;
    out.push(add(center, add(scale(u, Math.cos(t) * r), scale(w, Math.sin(t) * r))));
  }
  return out;
}

/** Stable perpendicular frame for a limb direction. */
function perp(dir: Vec3): [Vec3, Vec3] {
  const d = normalize(dir);
  const seed: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(d, seed));
  const w = normalize(cross(d, u));
  return [u, w];
}

/** Tapered tube facets for each limb (outward-wound sides + end caps). `sides` low for pixel-art. */
export function tubeFacets(limbs: Limb[], mat: Mat, sides = 5): WorldFacet[] {
  const m = new MeshSoup();
  for (const limb of limbs) {
    const dir = sub(limb.b, limb.a);
    if (dir[0] === 0 && dir[1] === 0 && dir[2] === 0) continue;
    const [u, w] = perp(dir);
    const A = ring(limb.a, u, w, Math.max(limb.r0, 1e-4), sides);
    const B = ring(limb.b, u, w, Math.max(limb.r1, 1e-4), sides);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      m.tri(A[i], B[j], B[i]);   // outward winding (see vec3 derivation)
      m.tri(A[i], A[j], B[j]);
      m.tri(limb.a, A[j], A[i]); // base cap (faces -dir)
      m.tri(limb.b, B[i], B[j]); // tip cap  (faces +dir)
    }
  }
  return m.facets(mat);
}

/** Unit octa-sphere (subdivided octahedron), verts on the unit sphere + outward tris. */
function octaSphere(subdiv: number): { verts: Vec3[]; tris: [number, number, number][] } {
  let verts: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // 8 faces wound outward (CCW seen from outside).
  let tris: [number, number, number][] = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];
  for (let s = 0; s < subdiv; s++) {
    const next: [number, number, number][] = [];
    const mid = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = mid.get(key);
      if (hit !== undefined) return hit;
      const idx = verts.length;
      verts.push(normalize(add(verts[a], verts[b])));
      mid.set(key, idx);
      return idx;
    };
    for (const [a, b, c] of tris) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }
  return { verts, tris };
}

/** Low-poly foliage blobs (one octa-sphere per leaf). */
export function blobFacets(leaves: Leaf[], mat: Mat, subdiv = 1): WorldFacet[] {
  const { verts, tris } = octaSphere(subdiv);
  const m = new MeshSoup();
  for (const leaf of leaves) {
    const w = verts.map(v => add(scale(v, leaf.r), leaf.at) as Vec3);
    for (const [a, b, c] of tris) m.tri(w[a], w[b], w[c]);
  }
  return m.facets(mat);
}

/** Cheap deterministic value-noise on a direction (hash of quantised dir + seed). */
function dirNoise(d: Vec3, seed: number): number {
  const q = (x: number): number => Math.round((x + 1) * 6);
  let h = (q(d[0]) * 73856093) ^ (q(d[1]) * 19349663) ^ (q(d[2]) * 83492791) ^ (seed * 2654435761);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h % 1000) / 1000; // [0,1)
}

export interface RockOpts {
  center: [number, number]; baseZ: number; radius: number; seed: number;
  /** Displacement amplitude as a fraction of radius (irregularity). */
  jitter?: number; mat?: Mat; subdiv?: number;
}

/** A noise-displaced octa-sphere boulder, resting with its base at `baseZ`. */
export function rockFacets(o: RockOpts): WorldFacet[] {
  const jitter = o.jitter ?? 0.35;
  const { verts, tris } = octaSphere(o.subdiv ?? 2);
  const c: Vec3 = [o.center[0], o.center[1], o.baseZ + o.radius * 0.62];
  const disp = verts.map(v => {
    const f = 1 + (dirNoise(v, o.seed) - 0.5) * 2 * jitter;
    // squash vertically so boulders sit low and wide, not ball-like
    return [v[0] * f, v[1] * f, v[2] * f * 0.7] as Vec3;
  });
  const m = new MeshSoup();
  for (const [a, b, cc] of tris) {
    m.tri(add(scale(disp[a], o.radius), c) as Vec3, add(scale(disp[b], o.radius), c) as Vec3, add(scale(disp[cc], o.radius), c) as Vec3);
  }
  return m.facets(o.mat ?? 'stone');
}
