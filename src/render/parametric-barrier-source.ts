// src/render/parametric-barrier-source.ts
// Runtime, memoized source of manifold-generated, lit barrier sprites — the world-render half
// of the parametric-kit wall unification. Mirrors ParametricBuildingSource's peek/warm
// contract: peek() is the sync frame read, warm() kicks async compose off the frame path.
//
// A barrier ENTITY carries a `BarrierRun` (a polyline ring/line). A building is one compact
// footprint → one sprite; a wall run is world-scale and weaves past buildings, so it can't be
// ONE sprite. We decompose the run into bounded CHUNKS (≈4 tiles), each composed to its own
// lit SpritePack and y-sorted at its own iso depth — preserving the legacy per-slab
// interleaving, now lit like a building. Chunks are localised to their own origin (direction
// preserved) so identical straight pieces share ONE cached compose: a long straight curtain is
// many blits of one sprite, only its corner/gate chunks unique. Any failure caches null →
// the caller falls back to the flat-quad `barrierSlabs`. Never throws on the frame path.
import type { Entity } from '@/core/types';
import type { BarrierRun, BarrierGate } from '@/world/barrier';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import type { SpritePack, BarrierPiece } from '@/render/iso/sprite-canvas';

/** Chunk length along the path, in tiles. Short enough that each piece y-sorts + foot-z lifts
 *  at roughly one ground contact, long enough to keep the compose count low. */
const CHUNK_TILES = 4;

/** A localised chunk: a short BarrierRun in its OWN frame (origin at the chunk start, running
 *  in the segment's true world direction) + the world placement of that origin/midpoint. */
interface Chunk {
  key: string;           // cache key — identical chunks (same shape/material/gate) share a compose
  localRun: BarrierRun;
  refX: number; refY: number;   // world position of the chunk's local origin (path[0])
  sortX: number; sortY: number; // world midpoint (y-sort anchor)
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Split a run's polyline into per-segment, length-bounded, localised chunks. */
export function chunkBarrierRun(run: BarrierRun): Chunk[] {
  const path = run.path;
  if (!path || path.length < 2) return [];
  const chunks: Chunk[] = [];
  let cum = 0;                       // cumulative distance to the current segment start
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (segLen <= 1e-6) continue;
    const dx = (bx - ax) / segLen, dy = (by - ay) / segLen;
    for (let s = 0; s < segLen - 1e-6; s += CHUNK_TILES) {
      const cl = Math.min(CHUNK_TILES, segLen - s);
      const startDist = cum + s;      // distance along the WHOLE run to this chunk's start
      const refX = ax + dx * s, refY = ay + dy * s;
      // Gates intersecting [startDist, startDist+cl], rebased to chunk-local distance.
      const gates: BarrierGate[] = [];
      for (const g of run.gates) {
        if (g.t + g.width / 2 > startDist && g.t - g.width / 2 < startDist + cl) {
          gates.push({ t: g.t - startDist, width: g.width });
        }
      }
      const localRun: BarrierRun = {
        kind: run.kind,
        path: [[0, 0], [r3(dx * cl), r3(dy * cl)]],
        height: run.height, thickness: run.thickness, material: run.material,
        crenellated: run.crenellated, posts: run.posts,
        gates: gates.map((g) => ({ t: r3(g.t), width: r3(g.width) })),
      };
      chunks.push({
        key: JSON.stringify(localRun),
        localRun,
        refX, refY,
        sortX: ax + dx * (s + cl / 2), sortY: ay + dy * (s + cl / 2),
      });
    }
    cum += segLen;
  }
  return chunks;
}

/** A composed chunk: the lit pack + the normalised position of the chunk's local origin. */
interface ChunkPack { pack: SpritePack; ax: number; ay: number }

export interface ParametricBarrierDeps {
  compose?: (run: BarrierRun) => Promise<StructureResult>;
  onWarm?: () => void;
}

export class ParametricBarrierSource {
  private readonly cache = new Map<string, ChunkPack | null>();
  private readonly inflight = new Set<string>();
  private readonly warned = new Set<string>();
  private rev = 0;
  private readonly compose: NonNullable<ParametricBarrierDeps['compose']>;
  private readonly onWarm?: () => void;

  constructor(deps: ParametricBarrierDeps = {}) {
    this.compose = deps.compose ?? ((run) =>
      composeStructure({ parts: [{ prim: 'linear', run }] }, undefined, { surfaceTexture: true }));
    this.onWarm = deps.onWarm;
  }

  private runOf(e: Entity): BarrierRun | null {
    const run = (e.properties as { barrier?: BarrierRun } | undefined)?.barrier;
    return run && run.path?.length >= 2 ? run : null;
  }

  /** Sync read: the run's pieces, or null until every chunk's compose has settled. Chunks that
   *  failed (cached null) are skipped, so one bad chunk never blanks the whole run. */
  peek(e: Entity): BarrierPiece[] | null {
    const run = this.runOf(e);
    if (!run) return null;
    const chunks = chunkBarrierRun(run);
    if (!chunks.length) return null;
    const pieces: BarrierPiece[] = [];
    let anyPending = false;
    for (const c of chunks) {
      const cp = this.cache.get(c.key);
      if (cp === undefined) { anyPending = true; continue; }   // not composed yet
      if (cp === null) continue;                               // failed — skip this chunk
      pieces.push({
        pack: cp.pack, refX: c.refX, refY: c.refY,
        anchorNX: cp.ax, anchorNY: cp.ay, sortX: c.sortX, sortY: c.sortY,
      });
    }
    // While any chunk is still pending, return null so the caller draws the flat-quad fallback
    // for the WHOLE run (mixing lit pieces with flat slabs would double-draw). Once all settle,
    // show the lit pieces.
    return anyPending ? null : (pieces.length ? pieces : null);
  }

  /** Fire-and-forget compose of every chunk. Safe to call each frame; runs once per chunk key. */
  warm(e: Entity): void {
    const run = this.runOf(e);
    if (!run) return;
    for (const c of chunkBarrierRun(run)) {
      if (this.cache.has(c.key) || this.inflight.has(c.key)) continue;
      this.inflight.add(c.key);
      this.compose(c.localRun)
        .then((res) => {
          const pack = structureResultToPack(res);
          const wallEnd = res.anchors.wallEnds?.[0];
          if (pack && wallEnd) this.cache.set(c.key, { pack, ax: wallEnd.x, ay: wallEnd.y });
          else this.cache.set(c.key, null);
        })
        .catch((err) => {
          if (!this.warned.has(c.key)) { console.warn('[parametric-barrier] compose failed', err); this.warned.add(c.key); }
          this.cache.set(c.key, null);
        })
        .finally(() => { this.inflight.delete(c.key); this.rev++; this.onWarm?.(); });
    }
  }

  /** Monotonic counter bumped when an async warm settles — fold into the static draw-cache key. */
  version(): number { return this.rev; }

  /** Clear on world reset. */
  clear(): void { this.cache.clear(); this.inflight.clear(); this.warned.clear(); this.rev++; }
}
