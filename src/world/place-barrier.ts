// src/world/place-barrier.ts
import type { World } from '@/world/world';
import type { Entity, EntityId } from '@/core/types';
import { barrierFootprintTiles, type BarrierRun } from '@/world/barrier';
import { tileBlockedByBuilding } from '@/world/building-collision';
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

  // Gate anchors: world point at distance g.t, facing perpendicular to the local segment.
  for (const g of run.gates) {
    const [gx, gy] = pointAt(path, g.t);
    const [a, b] = segmentAt(path, g.t);
    const [ux, uy] = unit(a[0], a[1], b[0], b[1]); // along-segment unit
    anchors.push({ kind: 'gate', x: gx, y: gy, facing: [-uy, ux], width: g.width });
  }

  const finalId = id ?? `barrier_${run.kind}_${Math.round(cx)}_${Math.round(cy)}_${run.path.length}`;

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
 */
export function reconcileBarriersWithBuildings(world: World): void {
  for (const e of world.query({ tag: 'barrier' })) {
    const props = e.properties as { footprintCells?: [number, number][] } | undefined;
    const cells = props?.footprintCells;
    if (!Array.isArray(cells)) continue;
    const kept = cells.filter(([x, y]) => !tileBlockedByBuilding(world, x, y));
    if (kept.length !== cells.length) props!.footprintCells = kept;
  }
}
