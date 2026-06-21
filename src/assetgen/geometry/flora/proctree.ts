// src/assetgen/geometry/flora/proctree.ts
// A recursive branch generator — the woody-skeleton half of the flora kit, ported
// from the proctree.js algorithm (supereggbert / jarikomppa lineage, permissive)
// but rewritten to emit our engine-free FloraSkeleton {limbs, leaves} instead of
// proctree's three.js-shaped vertex/face buffers. The skeleton flows UNCHANGED
// through mesh.ts (tubeFacets + blobFacets) and compose.ts `case 'flora'`, so a
// proctree tree lights/shadows exactly like an L-system tree or a building.
//
// The model: a branch grows as a short chain of tapered limb segments (so it can
// curve via droop/sweep/twist), then SPLITS into `branchFactor` children whose
// directions fan out of a clump cone with a per-level azimuth. Recursion stops at
// `levels`, where terminal twigs drop a small cluster of foliage blobs. Everything
// is driven off a seeded sfc32 Rng — deterministic, Math.random-free.
import type { Vec3 } from '@/assetgen/types';
import type { Rng } from '@/core/rng';
import type { FloraSkeleton, Limb, Leaf } from './turtle';
import { add, scale, normalize, cross, rotateAbout } from './vec3';

export interface ProctreeParams {
  /** Branch-recursion depth (trunk = level 0). 3–6 reads well at sprite scale. */
  levels: number;
  /** Children spawned at each split. 2–4; higher = denser. */
  branchFactor: number;
  /** Limb segments per branch — curvature resolution (≥1). */
  segmentsPerBranch: number;
  /** Trunk length, in the skeleton's pre-scale units (scaled to target height later). */
  trunkLength: number;
  /** Child length = parent length × this (0.6–0.9). */
  lengthFalloff: number;
  /** Radius multiplier along a single branch (taper, ~0.9). */
  taper: number;
  /** Child base radius = parent tip radius × this (0.6–0.8). */
  radiusFalloff: number;
  /** Min/max half-angle (radians) of the clump cone children fan into. */
  clumpMin: number;
  clumpMax: number;
  /** Downward droop blended into child directions, growing with level (willow → high). */
  drop: number;
  /** Upward bias blended into child directions (conifer leaders → high). */
  climb: number;
  /** Directional sweep bias (e.g. prevailing wind/sun lean), world units. */
  sweep: number;
  /** Roll twist (radians) applied to the child azimuth frame per level — irregularity. */
  twist: number;
  /** Per-segment heading jitter (radians) for organic wobble. */
  jitter: number;
  /** Foliage blob radius, pre-scale units (0 = leafless / dead). */
  foliageRadius: number;
  /** Foliage blobs clustered around each terminal twig tip (1 = single blob). */
  foliageBunch: number;
  /** Fraction [0..1] of branches near the tips that bear foliage (lower → bare interior). */
  foliageThreshold: number;
}

export const PROCTREE_DEFAULTS: ProctreeParams = {
  levels: 4, branchFactor: 3, segmentsPerBranch: 2, trunkLength: 1,
  lengthFalloff: 0.78, taper: 0.9, radiusFalloff: 0.7,
  clumpMin: 0.4, clumpMax: 0.9, drop: 0.1, climb: 0.25, sweep: 0,
  twist: 0.6, jitter: 0.12, foliageRadius: 0.18, foliageBunch: 3, foliageThreshold: 1,
};

/** Two unit vectors perpendicular to `d` (and each other) — the azimuth frame. */
function frame(d: Vec3): [Vec3, Vec3] {
  const seed: Vec3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(d, seed));
  const w = normalize(cross(d, u));
  return [u, w];
}

/** Tip a unit heading `d` by polar angle `theta` at azimuth `phi` around its own frame. */
function tip(d: Vec3, theta: number, phi: number): Vec3 {
  const [u, w] = frame(d);
  const radial = add(scale(u, Math.cos(phi)), scale(w, Math.sin(phi)));
  return normalize(add(scale(d, Math.cos(theta)), scale(radial, Math.sin(theta))));
}

/**
 * Grow a proctree skeleton at natural proportions (trunk rooted at origin, +Z up,
 * base radius 1). Callers uniformly scale positions to a target height and map the
 * unit radii onto a metric trunk radius — matching `buildFloraSkeleton`'s contract.
 */
export function growProctree(params: Partial<ProctreeParams>, rng: Rng): FloraSkeleton {
  const p = { ...PROCTREE_DEFAULTS, ...params };
  const limbs: Limb[] = [];
  const leaves: Leaf[] = [];
  const segs = Math.max(1, Math.round(p.segmentsPerBranch));

  // A single branch: a chain of `segs` tapered limbs that gently bends, then splits.
  const grow = (pos: Vec3, dir: Vec3, length: number, radius: number, level: number): void => {
    let here = pos;
    let head = normalize(dir);
    let r = radius;
    const segLen = length / segs;
    const tipTaper = Math.pow(p.taper, 1 / segs);

    for (let i = 0; i < segs; i++) {
      // Bend the heading: droop pulls toward -Z, climb toward +Z, sweep toward +X,
      // plus a little seeded wobble. Strength rises with level (twigs droop most).
      const lf = level / Math.max(1, p.levels);
      const bend: Vec3 = [
        p.sweep,
        (rng.next() * 2 - 1) * p.jitter,
        p.climb * (1 - lf) - p.drop * lf + (rng.next() * 2 - 1) * p.jitter,
      ];
      head = normalize(add(head, scale(bend, segLen)));
      const next = add(here, scale(head, segLen));
      const r1 = r * tipTaper;
      limbs.push({ a: here, b: next, r0: r, r1 });
      here = next;
      r = r1;
    }

    if (level >= p.levels) {
      if (p.foliageRadius > 0) placeFoliage(here, head);
      return;
    }

    // Split: fan `branchFactor` children out of the clump cone. One child continues
    // the parent line more steeply (the "leader") so trunks read as continuous.
    const phi0 = rng.next() * Math.PI * 2 + p.twist * level;
    const childLen = length * p.lengthFalloff;
    const childRad = r * p.radiusFalloff;
    let foliated = 0;
    for (let c = 0; c < p.branchFactor; c++) {
      const lead = c === 0;
      const theta = lead
        ? p.clumpMin * 0.35
        : p.clumpMin + rng.next() * (p.clumpMax - p.clumpMin);
      const phi = phi0 + (c / p.branchFactor) * Math.PI * 2 + (rng.next() * 2 - 1) * 0.3;
      let cd = tip(head, theta, phi);
      // Mild roll so successive levels don't all split in one plane.
      cd = rotateAbout(cd, head, p.twist * (rng.next() * 2 - 1));
      grow(here, cd, childLen * (lead ? 1.1 : 1), childRad * (lead ? 1.05 : 1), level + 1);
      foliated++;
    }
    void foliated;
  };

  // A bunched cluster of blobs around a twig tip — denser, less ball-like than one blob.
  const placeFoliage = (at: Vec3, head: Vec3): void => {
    const n = Math.max(1, Math.round(p.foliageBunch));
    const [u, w] = frame(head);
    for (let i = 0; i < n; i++) {
      const spread = p.foliageRadius * 0.8;
      const off = add(
        add(scale(u, (rng.next() * 2 - 1) * spread), scale(w, (rng.next() * 2 - 1) * spread)),
        scale(head, (rng.next() * 0.6) * p.foliageRadius),
      );
      const rr = p.foliageRadius * (0.7 + rng.next() * 0.5);
      leaves.push({ at: add(at, off), r: rr });
    }
  };

  grow([0, 0, 0], [0, 0, 1], p.trunkLength, 1, 0);
  return { limbs, leaves };
}
