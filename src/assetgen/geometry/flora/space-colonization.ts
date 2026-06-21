// src/assetgen/geometry/flora/space-colonization.ts
// Space Colonization (Runions, Lane & Prusinkiewicz, EG 2007) — the natural-crown
// half of the flora kit. We scatter "attraction points" through a crown ENVELOPE,
// then iteratively grow a node/edge skeleton toward them: each tree node steps one
// increment along the average direction of the attractors that see it; attractors
// die once a node reaches them. The grown graph is the branch skeleton; radii come
// from da Vinci's pipe model (a parent is as thick as its children combined).
//
// Like proctree.ts this emits the engine-free FloraSkeleton {limbs, leaves}, so it
// bakes through mesh.ts/compose.ts UNCHANGED. The envelope shape (rounded, conical,
// columnar, spreading…) is what makes one species' crown read differently from the
// next — it's the lever the fact-DB drives. Deterministic via seeded sfc32 Rng.
import type { Vec3 } from '@/assetgen/types';
import type { Rng } from '@/core/rng';
import type { FloraSkeleton, Limb, Leaf } from './turtle';
import { add, sub, scale, normalize, len } from './vec3';

/** Crown silhouettes the envelope sampler supports (mirrors flora-species CrownShape). */
export type Envelope = 'rounded' | 'spreading' | 'conical' | 'columnar' | 'irregular';

export interface SpaceColParams {
  /** Attraction points scattered in the crown (more = denser, slower). */
  attractors: number;
  /** Growth step length, in pre-scale units (crown spans roughly [trunkH..1] in Z). */
  step: number;
  /** Node "sees" attractors within influenceRadius × step. */
  influence: number;
  /** Attractor dies within killRadius × step of a node. */
  kill: number;
  /** Bare trunk height as a fraction of total height before the crown starts. */
  trunkFrac: number;
  /** Crown envelope shape. */
  envelope: Envelope;
  /** Crown half-width (X/Y radius) as a fraction of total height. */
  crownWidth: number;
  /** Safety cap on grown nodes. */
  maxNodes: number;
  /** Pipe-model exponent (≈2 → area conserved; higher → stouter trunk). */
  pipeExp: number;
  /** Leaf-node tip radius (pre-scale, unit-root); internal radii scale up from it. */
  tipRadius: number;
  /** Foliage blob radius at crown tips (0 = leafless). */
  foliageRadius: number;
}

export const SPACECOL_DEFAULTS: SpaceColParams = {
  attractors: 240, step: 0.06, influence: 6, kill: 2, trunkFrac: 0.35,
  envelope: 'rounded', crownWidth: 0.42, maxNodes: 600, pipeExp: 2.3,
  tipRadius: 0.05, foliageRadius: 0.16,
};

interface Node { p: Vec3; parent: number; children: number[]; r: number }

/** Sample one point inside the crown envelope (local crown coords: Z in [0,1] over
 *  the crown span, X/Y in [-1,1] radial). Rejection-sampled to the silhouette. */
function sampleEnvelope(env: Envelope, rng: Rng): Vec3 {
  for (let tries = 0; tries < 32; tries++) {
    const z = rng.next();                       // 0 = crown base, 1 = crown top
    const x = rng.next() * 2 - 1;
    const y = rng.next() * 2 - 1;
    const rad = Math.hypot(x, y);
    // Allowed radius at height z, per silhouette.
    let maxR: number;
    switch (env) {
      case 'conical':  maxR = 1 - z; break;                       // cone, tip up
      case 'columnar': maxR = 0.55 * (1 - 0.15 * Math.abs(z - 0.5) * 2); break; // tall, near-cylinder
      case 'spreading': maxR = Math.sqrt(Math.max(0, 1 - Math.pow((z - 0.35) / 0.65, 2))) * (1 - 0.2 * z); break; // oblate, low & wide
      case 'irregular': maxR = Math.sqrt(Math.max(0, 1 - Math.pow(z * 2 - 1, 2))) * (0.7 + 0.3 * rng.next()); break;
      case 'rounded':
      default:         maxR = Math.sqrt(Math.max(0, 1 - Math.pow(z * 2 - 1, 2))); break; // sphere
    }
    if (rad <= maxR) return [x, y, z];
  }
  return [0, 0, rng.next()];
}

/**
 * Grow a space-colonization skeleton at natural proportions (root at origin, +Z up,
 * total height ≈ 1, root radius 1). Callers scale positions to the target height and
 * map unit radii onto a metric trunk radius — same contract as growProctree.
 */
export function growSpaceColonization(params: Partial<SpaceColParams>, rng: Rng): FloraSkeleton {
  const p = { ...SPACECOL_DEFAULTS, ...params };
  const crownBase = p.trunkFrac;
  const crownSpan = 1 - crownBase;
  const halfW = p.crownWidth;

  // Scatter attractors in the envelope, mapped from local crown coords to world.
  const attractors: Vec3[] = [];
  for (let i = 0; i < p.attractors; i++) {
    const s = sampleEnvelope(p.envelope, rng);
    attractors.push([s[0] * halfW, s[1] * halfW, crownBase + s[2] * crownSpan]);
  }
  const alive = attractors.map(() => true);

  // Root the tree and grow a bare trunk up to the crown base so it isn't all branches.
  const nodes: Node[] = [{ p: [0, 0, 0], parent: -1, children: [], r: 0 }];
  let trunkZ = 0;
  while (trunkZ < crownBase - p.step) {
    const last = nodes.length - 1;
    const np: Vec3 = [0, 0, nodes[last].p[2] + p.step];
    nodes.push({ p: np, parent: last, children: [], r: 0 });
    nodes[last].children.push(nodes.length - 1);
    trunkZ = np[2];
  }

  const di = p.influence * p.step;
  const dk = p.kill * p.step;

  for (let iter = 0; iter < p.maxNodes; iter++) {
    if (nodes.length >= p.maxNodes) break;
    // Each node accumulates the directions of attractors for which it is nearest.
    const pull = new Map<number, Vec3>();
    let anyAttractor = false;
    for (let ai = 0; ai < attractors.length; ai++) {
      if (!alive[ai]) continue;
      const a = attractors[ai];
      let best = -1, bestD = di;
      for (let ni = 0; ni < nodes.length; ni++) {
        const d = len(sub(a, nodes[ni].p));
        if (d < bestD) { bestD = d; best = ni; }
      }
      if (best < 0) continue;
      anyAttractor = true;
      const dir = normalize(sub(a, nodes[best].p));
      const cur = pull.get(best);
      pull.set(best, cur ? add(cur, dir) : dir);
    }
    if (!anyAttractor || pull.size === 0) break;

    // Grow one new node per pulled node, stepping along the averaged attractor dir.
    for (const [ni, dirSum] of pull) {
      if (nodes.length >= p.maxNodes) break;
      const d = len(dirSum) > 1e-6 ? normalize(dirSum) : [0, 0, 1];
      const np = add(nodes[ni].p, scale(d as Vec3, p.step));
      const idx = nodes.length;
      nodes.push({ p: np, parent: ni, children: [], r: 0 });
      nodes[ni].children.push(idx);
    }

    // Kill attractors now reached by some node.
    for (let ai = 0; ai < attractors.length; ai++) {
      if (!alive[ai]) continue;
      for (let ni = 0; ni < nodes.length; ni++) {
        if (len(sub(attractors[ai], nodes[ni].p)) < dk) { alive[ai] = false; break; }
      }
    }
  }

  // Pipe-model radii: leaves get tipRadius, internals combine children (r^e summed).
  const e = p.pipeExp;
  const computeR = (i: number): number => {
    const n = nodes[i];
    if (n.children.length === 0) { n.r = p.tipRadius; return n.r; }
    let acc = 0;
    for (const c of n.children) { const cr = computeR(c); acc += Math.pow(cr, e); }
    n.r = Math.pow(acc, 1 / e);
    return n.r;
  };
  const root = computeR(0) || 1;

  // Emit limbs (one per parent→child edge) with unit-normalized radii, and foliage
  // blobs at every leaf node (terminal twig) — the clustered-solids crown.
  const limbs: Limb[] = [];
  const leaves: Leaf[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    const par = nodes[n.parent];
    limbs.push({ a: par.p, b: n.p, r0: par.r / root, r1: n.r / root });
    if (n.children.length === 0 && p.foliageRadius > 0) {
      leaves.push({ at: n.p, r: p.foliageRadius * (0.8 + rng.next() * 0.5) });
    }
  }
  return { limbs, leaves };
}
