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
import { composeStructure, type StructureResult, type StructureSpec, type NormAnchor } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import { towerSpec } from '@/assetgen/geometry/tower-spec';
import { gateLeafSpec } from '@/assetgen/geometry/gate-spec';
import type { Mat } from '@/assetgen/types';
import type { BarrierKind } from '@/world/barrier';
import type { SpritePack, BarrierPiece } from '@/render/iso/sprite-canvas';

/** Chunk length along the path, in tiles — short enough that each piece y-sorts + foot-z lifts
 *  at roughly one ground contact, long enough to keep the compose count low. */
const CHUNK_TILES = 4;

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
type Pt = [number, number];

/** One composable element of a run: a cache key, its spec, how to read its placement anchor
 *  from the composed result, and the world placement (anchor point + y-sort tile). */
interface Element {
  key: string;
  spec: () => StructureSpec;
  anchor: (r: StructureResult) => NormAnchor | undefined;
  refX: number; refY: number;    // world point the anchor maps onto
  sortX: number; sortY: number;  // y-sort tile
}

const wallEndAnchor = (r: StructureResult): NormAnchor | undefined => r.anchors.wallEnds?.[0];
const tagAnchor = (r: StructureResult): NormAnchor | undefined => r.anchors.tags?.[0];

function masonryMat(run: BarrierRun): Mat {
  return run.material === 'brick' ? 'brick' : 'stone';
}

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
}

/** Split a run's polyline into per-segment, length-bounded, localised chunks (cache-reusable). */
export function chunkBarrierRun(run: BarrierRun): BarrierChunk[] {
  const path = run.path;
  if (!path || path.length < 2) return [];
  const out: BarrierChunk[] = [];
  let cum = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen <= 1e-6) continue;
    const dx = (bx - ax) / segLen, dy = (by - ay) / segLen;
    for (let s = 0; s < segLen - 1e-6; s += CHUNK_TILES) {
      const cl = Math.min(CHUNK_TILES, segLen - s);
      const startDist = cum + s;
      const gates: BarrierGate[] = [];
      for (const g of run.gates) {
        if (g.t + g.width / 2 > startDist && g.t - g.width / 2 < startDist + cl) {
          gates.push({ t: r3(g.t - startDist), width: r3(g.width) });
        }
      }
      // Which local-y is OUTWARD for this chunk? Local +y maps to world (−dy, dx) after the
      // chunk is rotated to its true bearing; outward is the side away from the ring centre.
      let outwardSign: number | undefined;
      if (run.centroid) {
        const mx = ax + dx * (s + cl / 2), my = ay + dy * (s + cl / 2);   // chunk midpoint (world)
        const dot = (-dy) * (mx - run.centroid[0]) + dx * (my - run.centroid[1]);
        outwardSign = dot >= 0 ? 1 : -1;
      }
      const localRun: BarrierRun = {
        kind: run.kind, path: [[0, 0], [r3(dx * cl), r3(dy * cl)]],
        height: run.height, thickness: run.thickness, material: run.material,
        crenellated: run.crenellated, posts: run.posts, gates,
        ...(outwardSign !== undefined ? { outwardSign } : {}),
      };
      out.push({
        key: JSON.stringify(localRun), localRun,
        refX: ax + dx * s, refY: ay + dy * s,
        sortX: ax + dx * (s + cl / 2), sortY: ay + dy * (s + cl / 2),
      });
    }
    cum += segLen;
  }
  return out;
}

/** Curtain-chunk elements (compose-ready). */
function chunkElements(run: BarrierRun): Element[] {
  return chunkBarrierRun(run).map((c) => ({
    key: `chunk:${c.key}`,
    spec: () => ({ parts: [{ prim: 'linear', run: c.localRun }] }),
    anchor: wallEndAnchor,
    refX: c.refX, refY: c.refY, sortX: c.sortX, sortY: c.sortY,
  }));
}

/** Tower elements: a ROUND drum at each ring corner + twin SQUARE gatehouse towers at each gate
 *  (the authentic medieval pairing). Each kind shares one cached compose (same geometry); only
 *  the placement differs per element. */
function towerElements(run: BarrierRun): Element[] {
  if (!towersEnabled(run)) return [];
  const mat = masonryMat(run);
  const base = { curtainHeight: run.height, curtainThickness: run.thickness, material: mat };
  const tag = `${r3(run.height)}:${r3(run.thickness)}:${mat}`;

  const drum = towerSpec({ ...base, round: true });
  const drumSpec = (): StructureSpec => ({ parts: drum.parts, mountAnchors: drum.mountAnchors });
  const gate = towerSpec({ ...base, tall: true });        // square, taller — frames the gate
  const gateSpec = (): StructureSpec => ({ parts: gate.parts, mountAnchors: gate.mountAnchors });
  const mk = (key: string, spec: () => StructureSpec, x: number, y: number): Element =>
    ({ key, spec, anchor: tagAnchor, refX: x, refY: y, sortX: x, sortY: y });

  const out: Element[] = cornerVertices(run.path).map(([x, y]) => mk(`tower:round:${tag}`, drumSpec, x, y));
  for (const g of run.gates) {
    const { p, dir } = frameAt(run.path, g.t);
    const off = g.width / 2 + gate.side * 0.45;           // flank the opening just outside it
    out.push(mk(`tower:gate:${tag}`, gateSpec, p[0] - dir[0] * off, p[1] - dir[1] * off));
    out.push(mk(`tower:gate:${tag}`, gateSpec, p[0] + dir[0] * off, p[1] + dir[1] * off));
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
  for (const g of run.gates) {
    if (g.width <= 0) continue;
    const { p, dir } = frameAt(run.path, g.t);
    const leaf = gateLeafSpec({ gateWidth: g.width, curtainHeight: run.height, dir });
    out.push({
      key: `gate:${tag}:${r3(g.width)}:${r3(dir[0])},${r3(dir[1])}`,
      spec: () => ({ parts: leaf.parts, mountAnchors: leaf.mountAnchors }),
      anchor: tagAnchor, refX: p[0], refY: p[1], sortX: p[0], sortY: p[1],
    });
  }
  return out;
}

/** All composable elements of a run, in draw-friendly order (curtain first, gate + towers over). */
export function runElements(run: BarrierRun): Element[] {
  if (!run.path || run.path.length < 2) return [];
  return [...chunkElements(run), ...gateElements(run), ...towerElements(run)];
}

/** A composed element: the lit pack + the normalised position of its anchor point. */
interface ComposedEl { pack: SpritePack; ax: number; ay: number }

export interface ParametricBarrierDeps {
  compose?: (spec: StructureSpec) => Promise<StructureResult>;
  onWarm?: () => void;
}

export class ParametricBarrierSource {
  private readonly cache = new Map<string, ComposedEl | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private rev = 0;
  private readonly compose: NonNullable<ParametricBarrierDeps['compose']>;
  private readonly onWarm?: () => void;

  constructor(deps: ParametricBarrierDeps = {}) {
    this.compose = deps.compose ?? ((spec) => composeStructure(spec, undefined, { surfaceTexture: true }));
    this.onWarm = deps.onWarm;
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
      pieces.push({ pack: c.pack, refX: el.refX, refY: el.refY, anchorNX: c.ax, anchorNY: c.ay, sortX: el.sortX, sortY: el.sortY });
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
      this.compose(el.spec())
        .then((res) => {
          const pack = structureResultToPack(res);
          const a = el.anchor(res);
          if (pack && a) this.cache.set(el.key, { pack, ax: a.x, ay: a.y });
          else this.cache.set(el.key, null);
        })
        .catch((err) => {
          if (!this.warned.has(el.key)) { console.warn('[parametric-barrier] compose failed', err); this.warned.add(el.key); }
          this.cache.set(el.key, null);
        })
        .finally(() => { this.inflight.delete(el.key); this.rev++; this.onWarm?.(); });
    }
  }

  /** Monotonic counter bumped when an async warm settles — fold into the static draw-cache key. */
  version(): number { return this.rev; }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); this.rev++; }
}
