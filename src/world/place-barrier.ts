// src/world/place-barrier.ts
import type { World } from '@/world/world';
import type { Entity, EntityId } from '@/core/types';
import { barrierFootprintTiles, gateOpeningCell, type BarrierRun } from '@/world/barrier';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { blueprintOf } from '@/blueprint/entity';
import { buildingVisualCells } from '@/blueprint/footprint';
import type { Anchor } from '@/world/anchors';

/** Map a path distance `t` (tiles) to a world point along the polyline. */
function pointAt(path: [number, number][], t: number): [number, number] {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (t <= acc + len) { const u = (t - acc) / (len || 1); return [ax + (bx - ax) * u, ay + (by - ay) * u]; }
    acc += len;
  }
  return path[path.length - 1];
}

/** Unit vector from a→b, or [0,0] if degenerate. */
function unit(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const m = Math.hypot(dx, dy);
  return m === 0 ? [0, 0] : [dx / m, dy / m];
}

/** Which segment of the polyline contains distance `t` → its [start, end] points. */
function segmentAt(path: [number, number][], t: number): [[number, number], [number, number]] {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (t <= acc + len) return [a, b];
    acc += len;
  }
  return [path[path.length - 2], path[path.length - 1]];
}

/**
 * Place a functional barrier into the live ECS. The entity is tagged 'obstacle'
 * and indexes ONLY its blocking cells (not gate gaps) via `properties.footprintCells`,
 * so A* blocks the wall everywhere except gate gaps.
 *
 * Deterministic: no Math.random. The default id encodes centroid + path length.
 */
export function placeBarrier(world: World, run: BarrierRun, id?: string): EntityId {
  const { blocking: rawBlocking } = barrierFootprintTiles(run);
  // Never index a barrier cell that sits inside a building's walls — the building
  // owns that tile (a hedge/wall through a wall is the bug). Ring gates already
  // open the line at most building crossings; this is the GUARANTEE for the
  // remainder (a thick wall whose footprint spills a cell past the gated
  // centreline, or a road endpoint POI the building covers).
  const blocking = rawBlocking.filter(([x, y]) => !tileBlockedByBuilding(world, x, y));

  // Centroid of the path → entity x,y.
  let sx = 0, sy = 0;
  for (const [px, py] of run.path) { sx += px; sy += py; }
  const cx = sx / run.path.length;
  const cy = sy / run.path.length;

  const path = run.path;
  const last = path.length - 1;

  // Anchors: wall_end at each endpoint (outward = direction past the end).
  const anchors: Anchor[] = [];
  {
    // Start: outward points from path[1] toward path[0].
    const [fsx, fsy] = unit(path[1][0], path[1][1], path[0][0], path[0][1]);
    anchors.push({ kind: 'wall_end', x: path[0][0], y: path[0][1], facing: [fsx, fsy] });
    // End: outward points from path[last-1] toward path[last].
    const [fex, fey] = unit(path[last - 1][0], path[last - 1][1], path[last][0], path[last][1]);
    anchors.push({ kind: 'wall_end', x: path[last][0], y: path[last][1], facing: [fex, fey] });
  }

  const finalId = id ?? `barrier_${run.kind}_${Math.round(cx)}_${Math.round(cy)}_${run.path.length}`;

  // Gate anchors — REAL gates only (a `kind:'gap'` waterfront/building opening is absence of
  // wall, not a portal; emitting anchors for gaps made the links untrustworthy). Facing is the
  // ring normal ORIENTED OUTWARD when the run declares its inside (`centroid`) — the raw
  // `[-uy, ux]` pointed inward for half the gates, so the `facing:'toward'` gate→road rule
  // silently dropped them. Each gate also emits a `gate_anchor` inner+outer port PAIR (the
  // stair-anchor pattern: shared `pair` key + `requireSamePair` rule) 1 tile either side of THE
  // shared opening cell (`gateOpeningCell`), so a road threading the opening is a graph match.
  for (const g of run.gates) {
    if (g.kind === 'gap') continue;
    const [gx, gy] = pointAt(path, g.t);
    const [a, b] = segmentAt(path, g.t);
    const [ux, uy] = unit(a[0], a[1], b[0], b[1]); // along-segment unit
    let nx = -uy, ny = ux;                          // a ring normal
    if (run.centroid) {
      const [rcx, rcy] = run.centroid;
      if (nx * (gx - rcx) + ny * (gy - rcy) < 0) { nx = -nx; ny = -ny; }   // OUTWARD
    }
    anchors.push({ kind: 'gate', x: gx, y: gy, facing: [nx, ny], width: g.width, ownerId: finalId });
    const [ox, oy] = gateOpeningCell(run, g);
    const pair = `${finalId}:gate:${g.t}`;
    anchors.push({ kind: 'gate_anchor', x: ox + nx, y: oy + ny, facing: [nx, ny], width: g.width,
      ownerId: finalId, id: `${pair}:outer`, pair, tags: ['outer'] });
    anchors.push({ kind: 'gate_anchor', x: ox - nx, y: oy - ny, facing: [-nx, -ny], width: g.width,
      ownerId: finalId, id: `${pair}:inner`, pair, tags: ['inner'] });
  }

  const entity: Entity = {
    id: finalId,
    kind: `${run.kind}_run`,
    x: cx,
    y: cy,
    tags: ['barrier', 'obstacle', 'settlement'],
    properties: { barrier: run, anchors, footprintCells: blocking } as unknown as Record<string, unknown>,
  };
  world.addEntity(entity);
  return finalId;
}

/**
 * Re-filter every placed barrier's blocking cells against the FINAL set of
 * buildings. `placeBarrier` already drops cells under buildings present at its
 * time, but a building placed LATER (a neighbouring settlement) can still land on
 * an earlier ring. Run once after all settlements are placed: a building is
 * authoritative over its footprint, so a barrier never blocks a building wall.
 *
 * Filters against the building VISUAL extent (the renderer's silhouette box — a
 * SUPERSET of the solid walls: door thresholds, eave overhang, draw-only cells),
 * not just the collision footprint. The ring/croft gating opens the line at building
 * crossings, but sub-tile slab rasterization (gate spans sampled at one phase, slabs
 * at another) can still drift a single blocking cell under a silhouette in a dense
 * settlement — this post-pass is the authoritative C1 guarantee (INV4) by construction.
 */
export function reconcileBarriersWithBuildings(world: World): void {
  // Union of every building's drawn silhouette cells.
  const visual = new Set<string>();
  for (const e of world.query({ tag: 'building' })) {
    const bp = blueprintOf(e);
    if (!bp) continue;
    for (const c of buildingVisualCells(bp.rb, Math.floor(e.x), Math.floor(e.y))) visual.add(c);
  }
  for (const e of world.query({ tag: 'barrier' })) {
    const props = e.properties as { footprintCells?: [number, number][] } | undefined;
    const cells = props?.footprintCells;
    if (!Array.isArray(cells)) continue;
    const kept = cells.filter(
      ([x, y]) => !tileBlockedByBuilding(world, x, y) && !visual.has(`${x},${y}`),
    );
    if (kept.length !== cells.length) props!.footprintCells = kept;
  }
}
