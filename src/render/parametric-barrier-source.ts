// src/render/parametric-barrier-source.ts
// Runtime, memoized source of manifold-generated, lit barrier sprites — the world-render half
// of the parametric-kit wall unification. Mirrors ParametricBuildingSource's peek/warm
// contract: peek() is the sync frame read, warm() kicks async compose off the frame path.
//
// A barrier ENTITY carries a `BarrierRun` (a polyline ring/line). A building is one compact
// footprint → one sprite; a wall run is world-scale and weaves past buildings, so it can't be
// ONE sprite. We decompose a run into ELEMENTS, each composed to its own lit SpritePack and
// y-sorted at its own iso depth (preserving the legacy per-slab interleaving, now lit):
//   • CURTAIN chunks — bounded per-segment pieces (≈4 tiles), localised so identical straight
//     pieces share ONE cached compose (a long straight curtain = many blits of one sprite).
//   • TOWERS — a flanking mural tower at every corner of a crenellated masonry ring (covering
//     the curtain's corner joint, the authentic medieval solution) + twin towers flanking each
//     gate (a gatehouse). All a ring's towers share one cached compose.
// Any failure caches null → the caller falls back to the flat-quad `barrierSlabs`. Never throws.
import type { Entity } from '@/core/types';
import type { BarrierRun, BarrierGate } from '@/world/barrier';
import { composeStructure, type StructureResult, type StructureSpec, type StructureAnchors, type NormAnchor } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import { scheduleCompose } from '@/render/compose-scheduler';
import { composePayload } from '@/render/compose-offthread';
import {
  parametricSpriteKey, readParametricSprite, writeParametricSprite,
  payloadFromResult, packFromPayload, type CachedSpritePayload,
} from '@/render/parametric-sprite-cache';
import { towerSpec } from '@/assetgen/geometry/tower-spec';
import { gateLeafSpec, gateFrameSpec } from '@/assetgen/geometry/gate-spec';
import { postSpec } from '@/assetgen/geometry/post-spec';
import { stairSpec } from '@/assetgen/geometry/stair-spec';
import { masonryWork, gateIsArched } from '@/assetgen/geometry/linear';
import { mToTiles } from '@/render/scale-contract';
import type { Mat } from '@/assetgen/types';
import type { BarrierKind } from '@/world/barrier';
import type { SpritePack, BarrierPiece } from '@/render/iso/sprite-canvas';

/** Chunk length along the path, in tiles — short enough that each piece y-sorts + foot-z lifts
 *  at roughly one ground contact, long enough to keep the compose count low. */
const CHUNK_TILES = 4;
/** Max iso-DEPTH span (|Δ(x+y)| tiles) one chunk may cover. Each chunk carries a single
 *  midpoint sort key, so a chunk running along the depth axis puts its whole length at one
 *  depth — a building whose sort key falls inside that span draws wholly in front of or
 *  behind the entire chunk ("buildings poke through walls"). Capping the depth span keeps
 *  the ambiguity window under a building footprint; cross-depth walls keep full length. */
const CHUNK_DEPTH_SPAN_MAX = 2;

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
type Pt = [number, number];

/** One composable element of a run: a cache key, its spec, how to read its placement anchor
 *  from the composed result, and the world placement (anchor point + y-sort tile). */
interface Element {
  key: string;
  spec: () => StructureSpec;
  /** Reads only `anchors` — a persisted-cache hit rebuilds placement from the
   *  stored StructureAnchors without a full StructureResult. */
  anchor: (r: { anchors: StructureAnchors }) => NormAnchor | undefined;
  refX: number; refY: number;    // world point the anchor maps onto
  sortX: number; sortY: number;  // y-sort tile
  /** Optional terrain-lift sample point when it must differ from the anchor — gate assemblies
   *  foot every element at the same opening vertex (see BarrierPiece.footX). */
  footX?: number; footY?: number;
}

const wallEndAnchor = (r: { anchors: StructureAnchors }): NormAnchor | undefined => r.anchors.wallEnds?.[0];
const tagAnchor = (r: { anchors: StructureAnchors }): NormAnchor | undefined => r.anchors.tags?.[0];

function masonryMat(run: BarrierRun): Mat {
  return run.material === 'brick' ? 'brick' : 'stone';
}

/** A real GATE (road crossing) gets a gatehouse + timber leaf + a stair beside it; a GAP (the line
 *  meeting water / a building / an open waterfront) is just an opening. Missing kind ⇒ gate (legacy). */
const isRealGate = (g: BarrierGate): boolean => g.kind !== 'gap';

/** Crenellated stone/brick rings get flanking towers; field walls / palisades / hedges don't. */
function towersEnabled(run: BarrierRun): boolean {
  return !!run.crenellated && (run.material === 'stone' || run.material === 'brick');
}

const unit = (a: Pt, b: Pt): Pt => {
  const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
  return [dx / m, dy / m];
};

/** Vertices where the polyline TURNS (closed rings: every corner; open paths: interior bends). */
function cornerVertices(path: Pt[]): Pt[] {
  const pts = path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1]);
  const n = pts.length;
  if (n < 3) return [];
  const closed = Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 1e-6;
  const verts = closed ? pts.slice(0, -1) : pts;
  const m = verts.length;
  const out: Pt[] = [];
  for (let i = 0; i < m; i++) {
    const hasPrev = closed || i > 0, hasNext = closed || i < m - 1;
    if (!hasPrev || !hasNext) continue;                 // open-path endpoints: no tower
    const d1 = unit(verts[(i - 1 + m) % m], verts[i]);
    const d2 = unit(verts[i], verts[(i + 1) % m]);
    if (d1[0] * d2[0] + d1[1] * d2[1] < 0.99) out.push(verts[i]);   // a real turn
  }
  return out;
}

/**
 * The opening the curtain cutter ACTUALLY cuts for a real gate: centre `t` (global path distance)
 * + width, snapped to the carrying edge's piece grid — the same math `chunkBarrierRun` applies.
 * Gate furniture (leaf, jamb frame, flanker towers, stair) must place against THIS opening:
 * anchored at the raw `g.t` it drifts up to a full piece off the cut passage, and the leaf hangs
 * beside its own arch (the floating-door bug — reproduced in `place-gate-towers`, whose t=6 w=2.5
 * gate cuts an opening [6,8] while the leaf drew centred on 6). Non-canonical edges cut
 * continuously, so the raw gate comes back unchanged.
 */
export function snappedGateOpening(run: BarrierRun, g: BarrierGate): { t: number; width: number } {
  const path = run.path;
  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L <= 1e-6) continue;
    // Same HALF-OPEN ownership as chunkBarrierRun: a vertex-centred gate belongs to the edge
    // starting there (except the final edge, which keeps its end so an open-path gate resolves).
    const carries = g.t >= cum - 1e-6 && (g.t < cum + L - 1e-6 || i === path.length - 1);
    if (carries) {
      const ec = classifyEdge(b[0] - a[0], b[1] - a[1]);
      if (!ec.canonical) return { t: g.t, width: g.width };
      const tc = g.t - cum;
      const gw = Math.max(1, Math.min(2, Math.round((g.width || ec.slotLen) / ec.slotLen)));
      const W = gw * ec.slotLen;
      if (W <= L + 1e-6) {
        const nPO = Math.max(1, Math.round(W / ec.cutLen));
        const nPiecesEdge = Math.max(1, Math.round(L / ec.cutLen));
        const startIdx = Math.max(0, Math.min(nPiecesEdge - nPO, Math.round((tc - W / 2) / ec.cutLen)));
        return { t: cum + startIdx * ec.cutLen + W / 2, width: W };
      }
      return { t: g.t, width: W };
    }
    cum += L;
  }
  return { t: g.t, width: g.width };
}

/** World point + along-unit direction at path distance `t`. */
function frameAt(path: Pt[], t: number): { p: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: unit(a, b) }; }
    acc += len;
  }
  const a = path[path.length - 2] ?? path[0], b = path[path.length - 1];
  return { p: b, dir: unit(a, b) };
}

/** A localised curtain chunk: a short BarrierRun in its OWN frame (origin at the chunk start,
 *  running in the segment's true world direction) + the world placement of origin/midpoint. */
export interface BarrierChunk {
  key: string; localRun: BarrierRun;
  refX: number; refY: number; sortX: number; sortY: number;
  /** Gate fragments only: the opening's start vertex — the shared terrain-lift foot point of
   *  the whole gate assembly (fragments + leaf + jambs + flankers ride one terrace). */
  footX?: number; footY?: number;
}

// ── Canonical piece grid (WP-W2) ───────────────────────────────────────────────────────────
// A canonical wall edge (WP-W1 rings + snapped connection/croft walls) is cut into a FINITE
// vocabulary of pieces so identical pieces across worlds share ONE composed sprite (and can be
// pre-generated / img2img-styled): a cardinal piece = 2 tiles (delta (±2,0)/(0,±2)); a diagonal
// piece = ONE (±1,±1) step = √2. Both respect CHUNK_DEPTH_SPAN_MAX = 2. A non-canonical (free-
// angle) edge — only legacy hand-built runs — falls back to the old continuous cutter (`free:` key).

/** The 8 canonical unit deltas, indexed by 45° octant from +x (matches wall-connections.ts). */
const CANONICAL_DIRS: Pt[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
/** Cardinal render piece: 2 along-axis tiles. */
const CARDINAL_CUT = 2;
/** Diagonal render piece: ONE (±1,±1) step = √2 tiles. */
const DIAG_CUT = Math.SQRT2;
/** A GATE slot is a full WP-W1 gate piece: 2 tiles cardinal / 2 diagonal steps (2√2). */
const CARDINAL_SLOT = 2;
const DIAG_SLOT = 2 * Math.SQRT2;
/** cos(0.5°): edges whose bearing is within 0.5° of a canonical direction are cut on the grid;
 *  anything more off-axis falls to the legacy free-angle chunker. */
const CANON_DOT = Math.cos(0.5 * Math.PI / 180);
/** Normalized-bearing integer step deltas (E, NE, N, NW) — cardinal steps are unit, diagonal one (±1,±1). */
const BEARING_STEP: Pt[] = [[1, 0], [1, 1], [0, 1], [-1, 1]];

interface EdgeClass {
  oct: number; canonical: boolean; cls: 'card' | 'diag'; reversed: boolean;
  bearing: 0 | 1 | 2 | 3; worldUnit: Pt; cutLen: number; slotLen: number;
}

/** Classify an edge delta: octant, whether it is (near-)canonical, cardinal/diagonal, and — for
 *  the OUTPUT normalization that halves the sprite set — whether it points into the back half
 *  {W,SW,S,SE} (⇒ emit reversed from the far endpoint at bearing oct%4 ∈ {E,NE,N,NW}). */
function classifyEdge(dx: number, dy: number): EdgeClass {
  const L = Math.hypot(dx, dy) || 1;
  const oct = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const cu = CANONICAL_DIRS[oct]; const cl = Math.hypot(cu[0], cu[1]) || 1;
  const canonical = (dx / L) * (cu[0] / cl) + (dy / L) * (cu[1] / cl) >= CANON_DOT;
  const cls = oct % 2 === 1 ? 'diag' : 'card';
  return {
    oct, canonical, cls, reversed: oct >= 4, bearing: (oct % 4) as 0 | 1 | 2 | 3,
    worldUnit: [cu[0] / cl, cu[1] / cl], cutLen: cls === 'diag' ? DIAG_CUT : CARDINAL_CUT,
    slotLen: cls === 'diag' ? DIAG_SLOT : CARDINAL_SLOT,
  };
}

/** Deterministic 0|1|2 from a world tile position — the living (hedge) piece variant seed. No RNG. */
const posHash3 = (x: number, y: number): 0 | 1 | 2 => {
  const h = (Math.round(x) * 73856093) ^ (Math.round(y) * 19349663);
  return (((h % 3) + 3) % 3) as 0 | 1 | 2;
};

/** The finite piece-key fields. `pieceRunFromKey` is its inverse, so a key ALWAYS reconstructs the
 *  exact localised run it named (and re-cutting that run reproduces the key) — the W3 enumeration hook. */
export interface PieceKey {
  kind: BarrierKind; material: string; work: string;   // masonryWork(run), explicit
  h: number; th: number;                                // r3(height), r3(thickness)
  bearing: 0 | 1 | 2 | 3;                               // normalized octant (E, NE, N, NW)
  cls: 'card' | 'diag';
  len: 'full' | `rem${number}`;                         // diagonals always 'full'
  out: -1 | 0 | 1;                                       // outward sign (0 = symmetric / no centroid)
  role: 'curtain' | 'gate'; gw?: 1 | 2; gi?: 0 | 1 | 2 | 3;
  cren?: 1; hoard?: 1; posts?: 1;
  variant?: 0 | 1 | 2;                                   // living-family only, position-hashed
}

/** Serialize a PieceKey to a stable string (the cache/dedup key). No JSON braces, fixed field order.
 *  e.g. `piece:wall:stone:ashlar:1.5x2:b1:diag:full:o1:curtain:cren,hoard`. */
function pieceKeyStr(k: PieceKey): string {
  const seg: string[] = ['piece', k.kind, k.material, k.work, `${r3(k.h)}x${r3(k.th)}`,
    `b${k.bearing}`, k.cls, k.len, `o${k.out}`, k.role];
  if (k.role === 'gate') seg.push(`g${k.gw}i${k.gi}`);
  const flags: string[] = [];
  if (k.cren) flags.push('cren');
  if (k.hoard) flags.push('hoard');
  if (k.posts) flags.push('posts');
  if (flags.length) seg.push(flags.join(','));
  if (k.variant !== undefined) seg.push(`v${k.variant}`);
  return seg.join(':');
}

/** Rebuild the localised BarrierRun a PieceKey names — the single source of truth for `el.spec()`,
 *  so key ⇄ spec can never diverge (and the W3 seeder can enumerate the vocabulary directly). */
export function pieceRunFromKey(k: PieceKey): BarrierRun {
  const NB = BEARING_STEP[k.bearing];
  const isDiag = k.cls === 'diag';
  const stepUnit = isDiag ? Math.SQRT2 : 1;               // along-tiles per integer step delta
  const along = k.len === 'full' ? (isDiag ? DIAG_CUT : CARDINAL_CUT) : parseFloat(k.len.slice(3));
  const mul = along / stepUnit;
  const path: Pt[] = [[0, 0], [r3(NB[0] * mul), r3(NB[1] * mul)]];
  const cutLen = isDiag ? DIAG_CUT : CARDINAL_CUT;
  const slotLen = isDiag ? DIAG_SLOT : CARDINAL_SLOT;
  const gates: BarrierGate[] = [];
  if (k.role === 'gate') {
    const W = (k.gw ?? 1) * slotLen;
    // Opening centre in this fragment's local frame; gateCut spans the WHOLE opening so each
    // fragment renders its slice of one arch.
    gates.push({ t: r3(W / 2 - (k.gi ?? 0) * cutLen), width: r3(W), kind: 'gate' });
  }
  return {
    kind: k.kind, path, height: k.h, thickness: k.th, material: k.material, gates,
    ...(k.cren ? { crenellated: true } : {}),
    ...(k.posts ? { posts: true } : {}),
    ...(k.hoard ? { hoarded: true } : {}),
    ...(k.out !== 0 ? { outwardSign: k.out } : {}),
    ...(k.variant !== undefined ? { variant: k.variant } : {}),
  };
}

/** Legacy free-angle chunker for a single non-canonical edge (hand-built runs only). Byte-identical
 *  to the pre-WP-W2 continuous cutter minus the retired `merlonPhase` (merlons self-tile now). */
function pushFreeEdge(out: BarrierChunk[], run: BarrierRun, a: Pt, b: Pt, cum: number): void {
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (segLen <= 1e-6) return;
  const dx = (b[0] - a[0]) / segLen, dy = (b[1] - a[1]) / segLen;
  const depthRate = Math.abs(dx + dy);
  const step = depthRate > 1e-6 ? Math.min(CHUNK_TILES, CHUNK_DEPTH_SPAN_MAX / depthRate) : CHUNK_TILES;
  for (let s = 0; s < segLen - 1e-6; s += step) {
    const cl = Math.min(step, segLen - s);
    const startDist = cum + s;
    const gates: BarrierGate[] = [];
    for (const g of run.gates) {
      if (g.t + g.width / 2 > startDist && g.t - g.width / 2 < startDist + cl) {
        gates.push({ t: r3(g.t - startDist), width: r3(g.width), ...(g.kind ? { kind: g.kind } : {}) });
      }
    }
    let outwardSign: number | undefined;
    if (run.centroid) {
      const mx = a[0] + dx * (s + cl / 2), my = a[1] + dy * (s + cl / 2);
      const dot = (-dy) * (mx - run.centroid[0]) + dx * (my - run.centroid[1]);
      outwardSign = dot >= 0 ? 1 : -1;
    }
    const localRun: BarrierRun = {
      kind: run.kind, path: [[0, 0], [r3(dx * cl), r3(dy * cl)]],
      height: run.height, thickness: run.thickness, material: run.material,
      crenellated: run.crenellated, posts: run.posts, gates,
      ...(outwardSign !== undefined ? { outwardSign } : {}),
      ...(run.hoarded ? { hoarded: true } : {}),
    };
    out.push({
      key: `free:${JSON.stringify(localRun)}`, localRun,
      refX: a[0] + dx * s, refY: a[1] + dy * s,
      sortX: a[0] + dx * (s + cl / 2), sortY: a[1] + dy * (s + cl / 2),
    });
  }
}

/** Cut a run's polyline into canonical pieces (curtain + gate fragments) drawn from a FINITE
 *  vocabulary (WP-W2). Each piece localises to its own frame + placement; real gates REPLACE the
 *  curtain pieces under their slot span with gate fragments (one arch spans the whole opening);
 *  gaps DROP the pieces their span covers. Non-canonical edges fall back to `pushFreeEdge`. */
export function chunkBarrierRun(run: BarrierRun): BarrierChunk[] {
  const path = run.path;
  if (!path || path.length < 2) return [];
  const out: BarrierChunk[] = [];
  const cx = run.centroid?.[0], cy = run.centroid?.[1];
  const living = run.material === 'hedge';
  const baseKey = {
    kind: run.kind, material: run.material, work: masonryWork(run),
    h: r3(run.height), th: r3(run.thickness),
    ...(run.crenellated ? { cren: 1 as const } : {}),
    ...(run.hoarded ? { hoard: 1 as const } : {}),
    ...(run.posts ? { posts: 1 as const } : {}),
  };
  // Gaps drop pieces by GLOBAL midpoint; real gates replace pieces on the edge they sit on.
  const gapSpans: [number, number][] = [];
  for (const g of run.gates) if (g.kind === 'gap') gapSpans.push([g.t - g.width / 2, g.t + g.width / 2]);

  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L <= 1e-6) continue;
    const ec = classifyEdge(b[0] - a[0], b[1] - a[1]);
    if (!ec.canonical) { pushFreeEdge(out, run, a, b, cum); cum += L; continue; }

    // Real-gate opening spans on THIS edge (edge-local). Slots (gw) derive from the pre-snapped
    // width; the centre re-snaps onto piece boundaries (defensive — WP-W1 gates are already
    // snapped, so this is a no-op there) EXCEPT when the width is wider than the edge itself, the
    // reconstructed-fragment case (pieceRunFromKey), where the span is used verbatim so the key
    // round-trips.
    const openings: { openStart: number; openEnd: number; gw: 1 | 2; nPO: number }[] = [];
    for (const g of run.gates) {
      if (g.kind === 'gap') continue;
      // A gate belongs to the edge carrying its CENTRE — except a reconstructed single-piece
      // fragment (pieceRunFromKey), whose opening SPAN covers its whole 1-piece edge while the
      // centre sits off it (a 2-slot DIAGONAL gate's outer fragments, gi 0/3: |t| > cutLen).
      // Without the span-covers case those fragments re-cut as curtain and the key round-trip
      // (the W3 enumeration invariant) breaks.
      const spanCovers = g.t - g.width / 2 < cum + 1e-6 && g.t + g.width / 2 > cum + L - 1e-6;
      // HALF-OPEN centre ownership [cum, cum+L): a gate centred exactly on a shared VERTEX
      // belongs to the edge STARTING there — the closed test let both edges claim it, cutting
      // TWO openings (one per edge) around the corner: a double-width breach with an orphan leaf.
      // The final edge keeps its end so an open-path gate at t=total still resolves (mirrors
      // snappedGateOpening).
      const ownsCentre = g.t >= cum - 1e-6 && (g.t < cum + L - 1e-6 || i === path.length - 1);
      if (!ownsCentre && !spanCovers) continue;
      const tc = g.t - cum;
      const gw = Math.max(1, Math.min(2, Math.round((g.width || ec.slotLen) / ec.slotLen))) as 1 | 2;
      const W = gw * ec.slotLen;
      const nPO = Math.max(1, Math.round(W / ec.cutLen));
      let openStart: number;
      if (W <= L + 1e-6) {
        const nPiecesEdge = Math.max(1, Math.round(L / ec.cutLen));
        const startIdx = Math.max(0, Math.min(nPiecesEdge - nPO, Math.round((tc - W / 2) / ec.cutLen)));
        openStart = startIdx * ec.cutLen;
      } else {
        openStart = tc - W / 2;
      }
      openings.push({ openStart, openEnd: openStart + W, gw, nPO });
    }

    let s = 0;
    while (s < L - 1e-6) {
      const along = Math.min(ec.cutLen, L - s);
      const isRem = along < ec.cutLen - 1e-6;
      const gMid = cum + s + along / 2;                             // global midpoint (gaps)
      const ws: Pt = [a[0] + ec.worldUnit[0] * s, a[1] + ec.worldUnit[1] * s];
      const we: Pt = [a[0] + ec.worldUnit[0] * (s + along), a[1] + ec.worldUnit[1] * (s + along)];
      const wm: Pt = [(ws[0] + we[0]) / 2, (ws[1] + we[1]) / 2];
      // Gap → drop this piece.
      if (gapSpans.some(([g0, g1]) => gMid > g0 + 1e-6 && gMid < g1 - 1e-6)) { s += along; continue; }
      // Gate fragment? (only full pieces sit inside a whole-slot opening)
      let gate: { gw: 1 | 2; gi: 0 | 1 | 2 | 3; t: number; width: number } | undefined;
      let gateFoot: Pt | undefined;
      if (!isRem) {
        const pm = s + along / 2;
        for (const op of openings) {
          if (pm > op.openStart + 1e-6 && pm < op.openEnd - 1e-6) {
            const giEdge = Math.round((s - op.openStart) / ec.cutLen);
            const gi = (ec.reversed ? op.nPO - 1 - giEdge : giEdge) as 0 | 1 | 2 | 3;
            const W = op.gw * ec.slotLen;
            gate = { gw: op.gw, gi, t: r3(W / 2 - gi * ec.cutLen), width: r3(W) };
            // Shared gate-assembly foot: half a tile INSIDE the opening from its start vertex, so
            // every fragment of this opening — and the leaf/jambs/towers placed by
            // snappedGateOpening — lifts by ONE terrain sample instead of each riding its own
            // terrace. Half a tile in (not the vertex itself): the terraced footing benches the
            // ground per piece slot and a bench BOUNDARY tile takes its uphill neighbour's height
            // (ramp-tuck, barrier-deformation.ts) — sampling exactly on the boundary could lift
            // the whole assembly onto the neighbouring curtain's bench.
            const footS = op.openStart + 0.55;
            gateFoot = [a[0] + ec.worldUnit[0] * footS, a[1] + ec.worldUnit[1] * footS];
            break;
          }
        }
      }
      // Outward sign in the FINAL (normalized) local frame: local +y maps to world (−fdy, fdx).
      const fdir: Pt = ec.reversed ? [-ec.worldUnit[0], -ec.worldUnit[1]] : ec.worldUnit;
      let outSign: -1 | 0 | 1 = 0;
      if (cx !== undefined && cy !== undefined) {
        const dot = (-fdir[1]) * (wm[0] - cx) + fdir[0] * (wm[1] - cy);
        outSign = dot >= 0 ? 1 : -1;
      } else if (typeof run.outwardSign === 'number') {
        outSign = run.outwardSign >= 0 ? 1 : -1;
      }
      const len: PieceKey['len'] = isRem ? (`rem${r3(along)}` as `rem${number}`) : 'full';
      const pk: PieceKey = {
        kind: baseKey.kind, material: baseKey.material, work: baseKey.work, h: baseKey.h, th: baseKey.th,
        bearing: ec.bearing, cls: ec.cls, len, out: outSign,
        role: gate ? 'gate' : 'curtain',
        ...(gate ? { gw: gate.gw, gi: gate.gi } : {}),
        ...('cren' in baseKey ? { cren: baseKey.cren } : {}),
        ...('hoard' in baseKey ? { hoard: baseKey.hoard } : {}),
        ...('posts' in baseKey ? { posts: baseKey.posts } : {}),
        // Living pieces get a position-hashed variant for organic variety; a RECONSTRUCTED run
        // (pieceRunFromKey, single piece at the origin) already carries its variant — honor it so
        // the key round-trips instead of re-hashing position (0,0).
        ...(living ? { variant: (typeof run.variant === 'number' ? run.variant : posHash3(ws[0], ws[1])) as 0 | 1 | 2 } : {}),
      };
      out.push({
        key: pieceKeyStr(pk), localRun: pieceRunFromKey(pk),
        refX: ec.reversed ? we[0] : ws[0], refY: ec.reversed ? we[1] : ws[1],
        sortX: wm[0], sortY: wm[1],
        // Curtain pieces foot at their MIDPOINT — the interior of their own footing bench.
        // The end vertices sit exactly on bench boundaries, where the ramp-tuck rule hands
        // the tile to the uphill neighbour — a piece sampling there would float above the
        // bench it actually spans.
        footX: gateFoot ? gateFoot[0] : wm[0], footY: gateFoot ? gateFoot[1] : wm[1],
      });
      s += along;
    }
    cum += L;
  }
  return out;
}

/** Curtain + gate-fragment piece elements (compose-ready). The piece key IS the element key: it is
 *  finite (a `piece:…` grammar), so identical pieces across worlds dedup to one composed sprite. */
function chunkElements(run: BarrierRun): Element[] {
  return chunkBarrierRun(run).map((c) => ({
    key: c.key,
    spec: () => ({ parts: [{ prim: 'linear', run: c.localRun }] }),
    anchor: wallEndAnchor,
    refX: c.refX, refY: c.refY, sortX: c.sortX, sortY: c.sortY,
    ...(c.footX !== undefined ? { footX: c.footX, footY: c.footY } : {}),
  }));
}

/** The gate assembly's shared placement: snapped opening centre/width + frame + the opening-start
 *  foot vertex every element of the assembly lifts from. */
function gateFrameOf(run: BarrierRun, g: BarrierGate): { p: Pt; dir: Pt; width: number; foot: Pt } {
  const o = snappedGateOpening(run, g);
  const { p, dir } = frameAt(run.path, o.t);
  // Half a tile INSIDE the opening — the same shared foot the gate fragments carry
  // (chunkBarrierRun's `footS`), clear of the bench-boundary ramp-tuck tile.
  const { p: foot } = frameAt(run.path, o.t - o.width / 2 + 0.55);
  return { p, dir, width: o.width, foot };
}

/** A real gate whose opening is swallowed by a GAP span has no curtain to hang furniture on —
 *  the pieces there were dropped (water/building opening overlapping the committed gate), so a
 *  leaf/frame/tower placed anyway floats in the void (the door-over-the-river bug). Skip it. */
function gateSwallowedByGap(run: BarrierRun, g: BarrierGate): boolean {
  const o = snappedGateOpening(run, g);
  return run.gates.some((other) =>
    other !== g && other.kind === 'gap'
    && o.t > other.t - other.width / 2 - 1e-6 && o.t < other.t + other.width / 2 + 1e-6);
}

/** Tower elements: a ROUND drum at each ring corner + twin SQUARE gatehouse towers at each gate
 *  (the authentic medieval pairing). Each kind shares one cached compose (same geometry); only
 *  the placement differs per element. */
function towerElements(run: BarrierRun): Element[] {
  if (!towersEnabled(run)) return [];
  const mat = masonryMat(run);
  const work = masonryWork(run);   // towers course to MATCH the curtain (no crazy-paving beside ashlar)
  const base = { curtainHeight: run.height, curtainThickness: run.thickness, material: mat, work };
  const tag = `${r3(run.height)}:${r3(run.thickness)}:${mat}:${work}`;
  const c = run.centroid;
  // Unit vector toward the town interior at (x,y) — the tower's doorway/loops orient to it.
  const inwardAt = (x: number, y: number): [number, number] | undefined => {
    if (!c) return undefined;
    const ix = c[0] - x, iy = c[1] - y, m = Math.hypot(ix, iy) || 1;
    return [ix / m, iy / m];
  };
  // OCTANT-snap the inward orientation (WP-W2): a tower's doorway/loops face one of the 8 canonical
  // directions, so tower keys collapse from ~28 continuous inward values to 8 — the finite vocabulary.
  const octOf = (v: [number, number]): number => ((Math.round(Math.atan2(v[1], v[0]) / (Math.PI / 4)) % 8) + 8) % 8;
  const octUnit = (v: [number, number]): [number, number] => {
    const [ux, uy] = CANONICAL_DIRS[octOf(v)]; const m = Math.hypot(ux, uy) || 1; return [ux / m, uy / m];
  };
  const q = (v?: [number, number]): string => v ? `o${octOf(v)}` : 'solid';
  // Towers y-sort at their CAMERA-NEAR face, not their centre: a tower projects `side/2`
  // proud of the wall line both ways, so a curtain piece whose midpoint sits a touch nearer
  // used to draw over the drum and slice it. +0.35·side on both axes ≈ the near surface
  // (√2/2·side of iso depth) — the tower now caps its joint instead of being cut by it.
  const mk = (key: string, spec: () => StructureSpec, x: number, y: number, side = 0): Element =>
    ({ key, spec, anchor: tagAnchor, refX: x, refY: y, sortX: x + side * 0.35, sortY: y + side * 0.35 });
  const drumAt = (x: number, y: number): Element => {
    const inward = inwardAt(x, y);
    const drum = towerSpec({ ...base, round: true, inward: inward ? octUnit(inward) : undefined });
    return mk(`tower:round:${tag}:${q(inward)}`, () => ({ parts: drum.parts, mountAnchors: drum.mountAnchors }), x, y, drum.side);
  };

  const out: Element[] = [];
  // WP-S coverage placement is authoritative when present: a round DRUM at each salient/fill tower, a
  // square gatehouse tower at each gate flanker (its position already offset clear of the leaf span).
  if (run.towers && run.towers.length) {
    for (const t of run.towers) {
      const inward = inwardAt(t.x, t.y);
      if (t.role === 'gate') {
        const gate = towerSpec({ ...base, tall: true, inward: inward ? octUnit(inward) : undefined });   // square, taller — frames the gate
        out.push(mk(`tower:gate:${tag}:${q(inward)}`, () => ({ parts: gate.parts, mountAnchors: gate.mountAnchors }), t.x, t.y, gate.side));
      } else {
        out.push(drumAt(t.x, t.y));
      }
    }
    // CORNER COVERAGE (WP-W2, render-side only): the coverage pass sites towers by bowshot, not by
    // ring geometry, so a turning vertex can be left with a square-cut curtain joint bared. Cap any
    // uncovered corner with an extra drum (reuses the existing `tower:round:` vocabulary — no new key).
    for (const [x, y] of cornerVertices(run.path)) {
      if (run.towers.some((t) => Math.hypot(t.x - x, t.y - y) <= 2)) continue;
      out.push(drumAt(x, y));
    }
    return out;
  }
  // Legacy derivation (runs without WP-S placement, e.g. hand-built runs / crofts): a round drum at
  // every corner + twin square gatehouse towers flanking each real gate.
  for (const [x, y] of cornerVertices(run.path)) out.push(drumAt(x, y));
  for (const g of run.gates) {
    if (!isRealGate(g)) continue;                            // a gap opening gets no gatehouse
    if (gateSwallowedByGap(run, g)) continue;                // no curtain there — nothing to flank
    const { p, dir, width, foot } = gateFrameOf(run, g);     // the SNAPPED opening, not the raw t
    const inward = inwardAt(p[0], p[1]);
    const gate = towerSpec({ ...base, tall: true, inward });   // square, taller — frames the gate
    const gateSpec = (): StructureSpec => ({ parts: gate.parts, mountAnchors: gate.mountAnchors });
    // FRAME the opening: seat each tower fully OUTSIDE the clear passage (its inner face clears the
    // gate edge by a jamb gap) instead of piling onto it. `side*0.45 < side/2` used to overlap the
    // opening; `width/2 + side/2 + gap` puts the inner face a jamb's width beyond the passage.
    const off = width / 2 + gate.side / 2 + mToTiles(0.6);
    for (const s of [-1, 1] as const) {
      const el = mk(`tower:gate:${tag}:${q(inward)}`, gateSpec, p[0] + s * dir[0] * off, p[1] + s * dir[1] * off, gate.side);
      el.footX = foot[0]; el.footY = foot[1];                // ride the gate assembly's terrace
      out.push(el);
    }
  }
  return out;
}

/** A TIMBER defensive ring (a palisade) gets corner POSTS + gate FRAMES — the wooden analogue of
 *  the masonry ring's drum towers + stone gatehouse. Masonry (towered) rings and un-centred croft
 *  fences are excluded. */
function postsEnabled(run: BarrierRun): boolean {
  return !!run.centroid && !towersEnabled(run) && run.material === 'timber' && run.path.length >= 4;
}

/** Timber corner-post elements: a stout capped post covering each corner joint of a palisade ring. */
function postElements(run: BarrierRun): Element[] {
  if (!postsEnabled(run)) return [];
  const tag = `${r3(run.height)}:${r3(run.thickness)}`;
  return cornerVertices(run.path).map(([x, y]) => {
    const post = postSpec({ curtainHeight: run.height, curtainThickness: run.thickness });
    return {
      key: `post:${tag}`,
      spec: () => ({ parts: post.parts, mountAnchors: post.mountAnchors }),
      anchor: tagAnchor, refX: x, refY: y, sortX: x, sortY: y,
    } as Element;
  });
}

/** Timber gate-frame elements: jamb posts + a lintel framing each real gate of a palisade ring. */
function gateFrameElements(run: BarrierRun): Element[] {
  if (!postsEnabled(run)) return [];
  const tag = `${r3(run.height)}:${r3(run.thickness)}`;
  const out: Element[] = [];
  for (const g of run.gates) {
    if (g.width <= 0 || !isRealGate(g)) continue;
    if (gateSwallowedByGap(run, g)) continue;                // no curtain — no jambs to frame
    const { p, dir, width, foot } = gateFrameOf(run, g);
    const frame = gateFrameSpec({ gateWidth: width, curtainHeight: run.height, dir });
    out.push({
      key: `gateframe:${tag}:${r3(width)}:${r3(dir[0])},${r3(dir[1])}`,
      spec: () => ({ parts: frame.parts, mountAnchors: frame.mountAnchors }),
      anchor: tagAnchor, refX: p[0], refY: p[1], sortX: p[0], sortY: p[1],
      footX: foot[0], footY: foot[1],
    });
  }
  return out;
}

/** Defensive enclosures get a closing timber gate in each opening; garden fences / hedges
 *  keep a plain gap. The leaf is always timber even in a masonry wall (a wooden castle gate). */
const GATE_LEAF_KINDS = new Set<BarrierKind>(['wall', 'palisade', 'rampart']);

/** Timber gate-leaf elements: one closed double-leaf gate per opening of a defensive run. */
function gateElements(run: BarrierRun): Element[] {
  if (!GATE_LEAF_KINDS.has(run.kind)) return [];
  const tag = `${r3(run.height)}:${r3(run.thickness)}`;
  const out: Element[] = [];
  const arch = gateIsArched(run);
  for (const g of run.gates) {
    if (g.width <= 0 || !isRealGate(g)) continue;           // a plain gap gets no closing leaf
    if (gateSwallowedByGap(run, g)) continue;               // opening swallowed by a gap — no door in a void
    const { p, dir, width, foot } = gateFrameOf(run, g);    // fill the CUT passage, not the raw span
    const leaf = gateLeafSpec({ gateWidth: width, curtainHeight: run.height, dir, arch });
    // The leaf y-sorts just BEHIND every fragment of its own opening: the fragments carry the
    // cut passage as transparent pixels, so a leaf drawn first shows exactly through the arch
    // and is occluded by the masonry around it from EITHER side of the wall (drawn at the same
    // depth it used to paste over the whole inner wall face when seen from inside town). Bias
    // = the iso-depth of the farthest fragment midpoint from the opening centre, plus margin.
    const isDiag = Math.abs(dir[0]) > 1e-6 && Math.abs(dir[1]) > 1e-6;
    const cutLen = isDiag ? Math.SQRT2 : 2;
    const depthRate = Math.abs(dir[0] + dir[1]);
    const bias = Math.max(0, ((width - cutLen) / 2) * depthRate) + 0.5;
    out.push({
      key: `gate:${tag}:${r3(width)}:${r3(dir[0])},${r3(dir[1])}${arch ? ':arch' : ''}`,
      spec: () => ({ parts: leaf.parts, mountAnchors: leaf.mountAnchors }),
      anchor: tagAnchor, refX: p[0], refY: p[1], sortX: p[0] - bias / 2, sortY: p[1] - bias / 2,
      footX: foot[0], footY: foot[1],
    });
  }
  return out;
}

/** Only real defensive rings (a crenellated masonry curtain that knows its inside) get stairs. */
function stairsEnabled(run: BarrierRun): boolean {
  return !!run.crenellated && !!run.centroid && (run.material === 'stone' || run.material === 'brick');
}

/** Mural-stair elements: ONE clean coursed flight up to the wall-walk on the INNER face, beside the
 *  main gate. (The old per-long-segment + per-gate flights placed ~8–14 tiny inward stubs per ring
 *  that read as rubble cairns / detached columns at game zoom — clean walls beat rubble, so we keep
 *  a single readable flight at the gate the player enters by.) */
function stairElements(run: BarrierRun): Element[] {
  if (!stairsEnabled(run)) return [];
  const gate = run.gates.find((g) => isRealGate(g) && !gateSwallowedByGap(run, g));   // the main (first real) gate
  if (!gate) return [];
  const c = run.centroid!;
  const H = run.height;
  const parapetH = run.crenellated ? Math.min(mToTiles(1.6), H * 0.4) : 0;
  const walkZ = H - parapetH;                               // the wall-walk the flight climbs to
  const mat = masonryMat(run);
  const work = masonryWork(run);                            // course to MATCH the curtain
  const tag = `${r3(H)}:${r3(run.thickness)}:${mat}:${work}`;

  const { p, dir, width } = gateFrameOf(run, gate);
  const off = width / 2 + mToTiles(2.4);                    // sit clear of the passage + gatehouse
  const sp: Pt = [p[0] - dir[0] * off, p[1] - dir[1] * off];
  const inx = c[0] - sp[0], iny = c[1] - sp[1], m = Math.hypot(inx, iny) || 1;
  const inward: Pt = [inx / m, iny / m];
  const stair = stairSpec({ walkZ, dir, inward, thickness: run.thickness, material: mat, work });
  return [{
    key: `stair:${tag}:${r3(dir[0])},${r3(dir[1])}`,
    spec: () => ({ parts: stair.parts, mountAnchors: stair.mountAnchors }),
    anchor: tagAnchor, refX: sp[0], refY: sp[1], sortX: sp[0], sortY: sp[1],
  }];
}

/** All composable elements of a run, in draw-friendly order (curtain first, gate + towers over). */
export function runElements(run: BarrierRun): Element[] {
  if (!run.path || run.path.length < 2) return [];
  return [
    ...chunkElements(run), ...stairElements(run),
    ...gateElements(run), ...gateFrameElements(run),
    ...towerElements(run), ...postElements(run),
  ];
}

/** A composed element: the lit pack + the normalised position of its anchor point. */
interface ComposedEl { pack: SpritePack; ax: number; ay: number }

export interface ParametricBarrierDeps {
  compose?: (spec: StructureSpec) => Promise<StructureResult>;
  onWarm?: () => void;
  /** Test seam: rebuild a SpritePack from a persisted cache payload (defaults to
   *  `packFromPayload`; jsdom has no canvas, so tests inject a fake). */
  packFromCache?: (p: CachedSpritePayload) => SpritePack | null;
}

export class ParametricBarrierSource {
  private readonly cache = new Map<string, ComposedEl | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private rev = 0;
  private readonly compose: NonNullable<ParametricBarrierDeps['compose']>;
  private readonly onWarm?: () => void;
  private readonly packFromCache: NonNullable<ParametricBarrierDeps['packFromCache']>;
  /** Offload compose to the worker pool — only when the DEFAULT compose is used (an
   *  injected compose can't cross the worker boundary). Injected-compose tests keep the
   *  byte-identical inline path. */
  private readonly offthread: boolean;

  constructor(deps: ParametricBarrierDeps = {}) {
    this.compose = deps.compose ?? ((spec) => composeStructure(spec, undefined, { surfaceTexture: true }));
    this.onWarm = deps.onWarm;
    this.packFromCache = deps.packFromCache ?? packFromPayload;
    this.offthread = deps.compose === undefined;
  }

  private runOf(e: Entity): BarrierRun | null {
    const run = (e.properties as { barrier?: BarrierRun } | undefined)?.barrier;
    return run && run.path?.length >= 2 ? run : null;
  }

  /** Sync read: the run's pieces, or null until every element's compose has settled. Elements
   *  that failed (cached null) are skipped, so one bad piece never blanks the whole run. */
  peek(e: Entity): BarrierPiece[] | null {
    const run = this.runOf(e);
    if (!run) return null;
    const els = runElements(run);
    if (!els.length) return null;
    const pieces: BarrierPiece[] = [];
    let anyPending = false;
    for (const el of els) {
      const c = this.cache.get(el.key);
      if (c === undefined) { anyPending = true; continue; }
      if (c === null) continue;
      pieces.push({
        pack: c.pack, refX: el.refX, refY: el.refY, anchorNX: c.ax, anchorNY: c.ay,
        sortX: el.sortX, sortY: el.sortY,
        ...(el.footX !== undefined ? { footX: el.footX, footY: el.footY } : {}),
      });
    }
    // While anything is still pending, draw the flat-quad fallback for the WHOLE run (mixing lit
    // pieces with flat slabs would double-draw). Once all settle, show the lit pieces.
    return anyPending ? null : (pieces.length ? pieces : null);
  }

  /** Fire-and-forget compose of every element. Safe to call each frame; runs once per key. */
  warm(e: Entity): void {
    const run = this.runOf(e);
    if (!run) return;
    for (const el of runElements(run)) {
      if (this.cache.has(el.key) || this.inflight.has(el.key)) continue;
      this.inflight.add(el.key);
      // Persistent key = the element's content key (`el.key` is already the
      // in-memory dedup authority: chunk keys embed the full localised run —
      // merlon phase, gates, coursing, outward sign —; tower/gate/stair keys the
      // same quantised identity the session cache dedups on) + ART_RECIPE_VERSION.
      const idbKey = parametricSpriteKey('bar', el.key);
      // Off-thread path (production default): the worker pool composes the element and
      // returns its cache payload, which rebuilds a pixel-identical pack + placement
      // anchor on the main thread (WP-A) — a wall ring's dozens of segments compose in
      // parallel instead of fusing into one main-thread long task.
      const composeOffthread = (): Promise<void> =>
        composePayload(el.spec(), { surfaceTexture: true })
          .then((payload) => {
            if (payload) {
              const pack = this.packFromCache(payload);
              const a = el.anchor({ anchors: payload.anchors });
              if (pack && a) {
                this.cache.set(el.key, { pack, ax: a.x, ay: a.y });
                void writeParametricSprite(idbKey, payload);
                return;
              }
            }
            this.cache.set(el.key, null);
          })
          .catch((err) => {
            if (!this.warned.has(el.key)) { console.warn('[parametric-barrier] compose failed', err); this.warned.add(el.key); }
            this.cache.set(el.key, null);
          });
      // Inline path (injected compose): byte-identical to pre-WP-A — through the shared
      // main-thread queue (compose-scheduler.ts). el.spec() is built inside the job.
      const composeInline = (): Promise<void> =>
        scheduleCompose(() => this.compose(el.spec()))
          .then((res) => {
            const pack = structureResultToPack(res);
            const a = el.anchor(res);
            if (pack && a) {
              this.cache.set(el.key, { pack, ax: a.x, ay: a.y });
              // Write-behind persist (anchors ride along in the payload).
              const payload = payloadFromResult(res);
              if (payload) void writeParametricSprite(idbKey, payload);
            } else this.cache.set(el.key, null);
          })
          .catch((err) => {
            if (!this.warned.has(el.key)) { console.warn('[parametric-barrier] compose failed', err); this.warned.add(el.key); }
            this.cache.set(el.key, null);
          });
      const composePath = this.offthread ? composeOffthread : composeInline;
      // Persisted-sprite fast path: hit → rebuild pack + placement anchor from the
      // stored payload, NO compose job; anything else degrades to composing.
      readParametricSprite(idbKey)
        .then((payload) => {
          if (payload) {
            const pack = this.packFromCache(payload);
            const a = el.anchor({ anchors: payload.anchors });
            if (pack && a) { this.cache.set(el.key, { pack, ax: a.x, ay: a.y }); return; }
          }
          return composePath();
        })
        .catch(() => composePath())
        .finally(() => { this.inflight.delete(el.key); this.rev++; this.onWarm?.(); });
    }
  }

  /** Monotonic counter bumped when an async warm settles — fold into the static draw-cache key. */
  version(): number { return this.rev; }

  /** Warms still in flight (IDB read or compose) — summed by the boot gate. */
  pending(): number { return this.inflight.size; }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); this.rev++; }
}
