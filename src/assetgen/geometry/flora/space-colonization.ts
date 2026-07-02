// src/assetgen/geometry/flora/space-colonization.ts
// Space Colonization (Runions, Lane & Prusinkiewicz, EG 2007) — the canopy-first
// tree generator. The crown ENVELOPE is the authority: we scatter "attraction
// points" through a per-species envelope (dome / cone / column / weeping curtain),
// grow a node/edge skeleton toward them, CULL any growth that would exit the
// envelope, then dress the crown with fewer, LARGER clustered foliage blobs —
// anchored to branch endpoints — plus a silhouette COVERAGE pass that plugs any
// hole in the envelope's outline. Radii come from da Vinci's pipe model (a parent
// is as thick as its children combined), which also gives a continuously tapering
// trunk (no telescoping sleeves).
//
// Like proctree.ts this emits the engine-free FloraSkeleton {limbs, leaves}, so it
// bakes through mesh.ts/compose.ts UNCHANGED. The envelope shape is the lever the
// fact-DB drives (crownShape → envelope). Deterministic via seeded sfc32 Rng.
import type { Vec3 } from '@/assetgen/types';
import type { Rng } from '@/core/rng';
import type { FloraSkeleton, Limb, Leaf } from './turtle';
import { add, sub, scale, normalize, len } from './vec3';

/** Crown silhouettes the envelope sampler supports (mirrors flora-species CrownShape). */
export type Envelope = 'rounded' | 'spreading' | 'conical' | 'columnar' | 'irregular' | 'weeping';

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
  /** Foliage blob radius as a fraction of total height (0 = leafless). */
  foliageRadius: number;
  /** Silhouette samples for the canopy COVERAGE pass (0 = off). Each sample of the
   *  envelope's surface must land inside some foliage blob; a miss spawns a new
   *  blob anchored toward the nearest branch node — no holes in the crown outline. */
  coverage: number;
  /** Weeping curtain: hanging blob chains descend from high branch tips down to
   *  this world-Z fraction of total height. Negative = no curtain. */
  curtainBottom: number;
  /** Curtain blob radius as a fraction of total height. */
  curtainBlobR: number;
}

export const SPACECOL_DEFAULTS: SpaceColParams = {
  attractors: 240, step: 0.06, influence: 6, kill: 2, trunkFrac: 0.35,
  envelope: 'rounded', crownWidth: 0.42, maxNodes: 600, pipeExp: 2.3,
  tipRadius: 0.05, foliageRadius: 0.14, coverage: 70,
  curtainBottom: -1, curtainBlobR: 0.07,
};

interface Node { p: Vec3; parent: number; children: number[]; r: number }

/** Allowed crown radius (fraction of crownWidth) at crown-local height z ∈ [0,1] —
 *  THE envelope authority. Attractor sampling, growth culling and the coverage
 *  pass all read this one profile so they can never disagree on the silhouette. */
export function envelopeMaxR(env: Envelope, z: number): number {
  switch (env) {
    case 'conical':   return 1 - z;                                        // straight cone, tip up
    case 'columnar':  return 0.55 * (1 - 0.15 * Math.abs(z - 0.5) * 2);    // tall, near-cylinder
    case 'spreading': return Math.sqrt(Math.max(0, 1 - Math.pow((z - 0.5) / 0.6, 2))) * (1 - 0.15 * z); // broad dome, base tucked
    case 'weeping':   return Math.sqrt(Math.max(0, 1 - Math.pow((z - 0.55) / 0.48, 2))); // dome that CLOSES at the top (no flat box)
    case 'irregular': return Math.sqrt(Math.max(0, 1 - Math.pow(z * 2 - 1, 2))) * 0.85; // lumpy sphere (sampler jitters)
    case 'rounded':
    default:          return Math.sqrt(Math.max(0, 1 - Math.pow(z * 2 - 1, 2)));        // sphere
  }
}

/** Sample one point inside the crown envelope (local crown coords: Z in [0,1] over
 *  the crown span, X/Y in [-1,1] radial). Direct disc sampling at a UNIFORM z —
 *  never rejection over the bounding box, which would starve narrow reaches of the
 *  envelope (a cone's tip got (1-z)² of the attractors and grew bald/lumpy). */
function sampleEnvelope(env: Envelope, rng: Rng): Vec3 {
  const z = rng.next();                         // 0 = crown base, 1 = crown top
  let maxR = envelopeMaxR(env, z);
  if (env === 'irregular') maxR *= 0.75 + 0.35 * rng.next(); // lumpy outline
  const rad = maxR * Math.sqrt(rng.next());     // area-uniform within the disc
  const phi = rng.next() * Math.PI * 2;
  return [Math.cos(phi) * rad, Math.sin(phi) * rad, z];
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

  // True while `pt` sits inside the crown envelope (small tolerance) — growth that
  // would exit is culled, so no bare sticks poke out of the canopy silhouette.
  const insideCrown = (pt: Vec3): boolean => {
    const lz = (pt[2] - crownBase) / crownSpan;
    if (lz < -0.02 || lz > 1.02) return false;
    const maxR = envelopeMaxR(p.envelope, Math.min(Math.max(lz, 0), 1));
    return Math.hypot(pt[0], pt[1]) <= maxR * halfW * 1.1 + p.step * 0.5;
  };

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

  // Incremental nearest-node cache: nodes are only ever ADDED, so an attractor's
  // nearest distance only improves — track it per attractor and refresh against
  // NEW nodes only. Exactly equivalent to a full rescan, O(A × maxNodes) total
  // (the naive per-iteration rescan made 26-species prewarm seconds-slow).
  const nearIdx = new Int32Array(attractors.length).fill(-1);
  const nearD = new Float64Array(attractors.length).fill(Infinity);
  const refresh = (ai: number, from: number): void => {
    const a = attractors[ai];
    for (let ni = from; ni < nodes.length; ni++) {
      const d = len(sub(a, nodes[ni].p));
      if (d < nearD[ai]) { nearD[ai] = d; nearIdx[ai] = ni; }
    }
  };
  for (let ai = 0; ai < attractors.length; ai++) refresh(ai, 0);

  for (let iter = 0; iter < p.maxNodes; iter++) {
    if (nodes.length >= p.maxNodes) break;
    // Each node accumulates the directions of attractors for which it is nearest.
    const pull = new Map<number, Vec3>();
    let anyAttractor = false;
    for (let ai = 0; ai < attractors.length; ai++) {
      if (!alive[ai] || nearD[ai] >= di) continue;
      anyAttractor = true;
      const best = nearIdx[ai];
      const dir = normalize(sub(attractors[ai], nodes[best].p));
      const cur = pull.get(best);
      pull.set(best, cur ? add(cur, dir) : dir);
    }
    if (!anyAttractor || pull.size === 0) break;

    // Grow one new node per pulled node, stepping along the averaged attractor dir.
    // Steps that would exit the envelope are culled; a fully-stalled pass ends growth.
    const firstNew = nodes.length;
    for (const [ni, dirSum] of pull) {
      if (nodes.length >= p.maxNodes) break;
      const d = len(dirSum) > 1e-6 ? normalize(dirSum) : [0, 0, 1];
      const np = add(nodes[ni].p, scale(d as Vec3, p.step));
      if (!insideCrown(np)) continue;
      const idx = nodes.length;
      nodes.push({ p: np, parent: ni, children: [], r: 0 });
      nodes[ni].children.push(idx);
    }
    if (nodes.length === firstNew) break;

    // Fold the new nodes into the nearest cache, then kill reached attractors.
    for (let ai = 0; ai < attractors.length; ai++) {
      if (!alive[ai]) continue;
      refresh(ai, firstNew);
      if (nearD[ai] < dk) alive[ai] = false;
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

  // Emit limbs (one per parent→child edge) with unit-normalized radii.
  const limbs: Limb[] = [];
  const leaves: Leaf[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    const par = nodes[n.parent];
    limbs.push({ a: par.p, b: n.p, r0: par.r / root, r1: n.r / root });
  }

  // ── Foliage: fewer, LARGER clustered blobs anchored at branch endpoints. Blobs
  // deep in the crown run bigger than rim blobs (depth-scaled), so the canopy reads
  // as one full mass with a gently broken edge — not tip-tufts on bare sticks. Each
  // blob is also capped by the LOCAL envelope width, so a cone's tip blobs shrink
  // with the cone and the silhouette keeps its species profile instead of blunting.
  const blobCap = (lz: number): number =>
    envelopeMaxR(p.envelope, Math.min(Math.max(lz, 0), 1)) * halfW * 0.9 + 0.035;
  const crownNodes: Node[] = [];
  for (const n of nodes) if (n.p[2] >= crownBase - p.step) crownNodes.push(n);
  if (p.foliageRadius > 0 && p.envelope === 'conical') {
    // ── Conifer canopy: stacked blob TIERS built straight from the envelope —
    // rings of clumps whose radius follows the cone profile (a real conifer's
    // whorled branches wrap their foliage in the same rings). Symmetric enough to
    // read "pine" at 40 px, jittered enough to stay organic.
    const tiers = 5;
    const spacing = crownSpan / tiers;
    for (let t = 0; t < tiers; t++) {
      const tz = (t + 0.5) / tiers;
      const zw = crownBase + tz * crownSpan + (rng.next() - 0.5) * 0.02;
      const prof = envelopeMaxR('conical', tz) * halfW;
      // Blob radius follows the cone but never drops below tier spacing — upper
      // tiers must overlap vertically or the leader shows bare between them.
      const r = Math.max(prof * 0.6, spacing * 0.62);
      const ringR = prof * 0.58;
      const count = Math.max(1, Math.round((Math.PI * 2 * ringR) / (r * 1.15)));
      const phi0 = rng.next() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const phi = phi0 + (i / count) * Math.PI * 2;
        leaves.push({
          at: [Math.cos(phi) * ringR, Math.sin(phi) * ringR, zw + (rng.next() - 0.5) * r * 0.4],
          r: r * (0.85 + 0.3 * rng.next()),
        });
      }
      if (count > 1) leaves.push({ at: [0, 0, zw + r * 0.2], r });
    }
    // Leader tip: one small clump closing the cone's point.
    leaves.push({ at: [0, 0, crownBase + crownSpan * 0.99], r: Math.max(p.foliageRadius * 0.6, 0.04) });
  } else if (p.foliageRadius > 0) {
    for (const n of crownNodes) {
      if (n.children.length !== 0) continue;
      const lz = Math.min(Math.max((n.p[2] - crownBase) / crownSpan, 0), 1);
      const rimR = Math.max(envelopeMaxR(p.envelope, lz) * halfW, 1e-6);
      const rimFrac = Math.min(1, Math.hypot(n.p[0], n.p[1]) / rimR);
      const r = p.foliageRadius * (1.15 - 0.3 * rimFrac) * (0.85 + 0.3 * rng.next());
      leaves.push({ at: n.p, r: Math.min(r, blobCap(lz)) });
    }
  }

  // ── Weeping curtain: chains of blobs hang from high RIM tips down towards
  // curtainBottom, drifting slightly outward — the willow's cascade IS its envelope.
  // Interior tips drop NO chains (invisible inside the curtain), and the strand
  // count is HARD-CAPPED, outermost tips first: ~2 dozen strands draw the whole
  // cascade; more only multiplied hidden facets (the prewarm hot spot — weeping
  // species ran 5× every other tree's leaf count).
  if (p.curtainBottom >= 0 && p.curtainBlobR > 0) {
    const rimTips: Array<{ n: Node; rimFrac: number }> = [];
    for (const n of crownNodes) {
      if (n.children.length !== 0) continue;
      const lz = (n.p[2] - crownBase) / crownSpan;
      if (lz < 0.3) continue;
      const radial = Math.hypot(n.p[0], n.p[1]);
      const rimR = Math.max(envelopeMaxR(p.envelope, Math.min(Math.max(lz, 0), 1)) * halfW, 1e-6);
      if (radial >= rimR * 0.55) rimTips.push({ n, rimFrac: radial / rimR });
    }
    rimTips.sort((a, b) => b.rimFrac - a.rimFrac);
    for (const { n } of rimTips.slice(0, 30)) {
      const radial = Math.hypot(n.p[0], n.p[1]);
      const out: Vec3 = radial > 1e-6
        ? [n.p[0] / radial, n.p[1] / radial, 0]
        : [Math.cos(rng.next() * Math.PI * 2), Math.sin(rng.next() * Math.PI * 2), 0];
      const stepLen = p.curtainBlobR * 1.7;
      let at: Vec3 = [n.p[0], n.p[1], n.p[2]];
      while (at[2] - stepLen > p.curtainBottom) {
        at = [
          at[0] + out[0] * stepLen * 0.18 + (rng.next() - 0.5) * stepLen * 0.3,
          at[1] + out[1] * stepLen * 0.18 + (rng.next() - 0.5) * stepLen * 0.3,
          at[2] - stepLen,
        ];
        leaves.push({ at, r: p.curtainBlobR * (1.0 + 0.4 * rng.next()) });
      }
    }
  }

  // ── Coverage pass: sample the envelope's SURFACE; any sample not already inside
  // a blob spawns one, anchored 60% of the way from the nearest branch node toward
  // the surface — the silhouette closes with no holes and no free-floating foliage.
  // (Skipped for conical: the constructed tiers ARE its coverage.)
  if (p.coverage > 0 && p.foliageRadius > 0 && crownNodes.length > 0 && p.envelope !== 'conical') {
    for (let i = 0; i < p.coverage; i++) {
      const z = p.envelope === 'weeping' ? 0.35 + 0.65 * rng.next() : rng.next();
      const phi = rng.next() * Math.PI * 2;
      let mr = envelopeMaxR(p.envelope, z);
      if (p.envelope === 'irregular') mr *= 0.75 + 0.35 * rng.next();
      const target: Vec3 = [
        Math.cos(phi) * mr * halfW,
        Math.sin(phi) * mr * halfW,
        crownBase + z * crownSpan,
      ];
      let covered = false;
      for (const lf of leaves) {
        if (len(sub(target, lf.at)) < lf.r * 1.05) { covered = true; break; }
      }
      if (covered) continue;
      let best: Node | null = null, bd = Infinity;
      for (const n of crownNodes) {
        const d = len(sub(target, n.p));
        if (d < bd) { bd = d; best = n; }
      }
      const at = best ? add(best.p, scale(sub(target, best.p), 0.6)) : target;
      leaves.push({ at, r: Math.min(p.foliageRadius * (0.9 + 0.25 * rng.next()), blobCap(z)) });
    }
  }

  return { limbs, leaves };
}
