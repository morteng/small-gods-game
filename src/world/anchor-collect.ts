// src/world/anchor-collect.ts
//
// Gather every world feature's anchors into ONE typed list (+ the road polylines the matcher
// snaps to). Buildings and barriers already emit anchors onto their entities
// (`entity.properties.anchors`); roads contribute endpoint anchors + their centre polylines;
// crossings contribute bank anchors. Each anchor is stamped with a deterministic id and its
// owner so links are stable and traceable. Pure read — mutates nothing.

import type { World } from './world';
import type { RoadGraph } from './road-graph';
import type { Anchor } from './anchors';
import type { RoadPolyline } from './anchor-rules';
import { detectCrossings } from './connectome/detect-crossings';

export interface CollectedAnchors {
  anchors: Anchor[];
  roads: RoadPolyline[];
}

/** Unit vector a→b, or [0,0] if degenerate. */
function unit(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const m = Math.hypot(dx, dy);
  return m === 0 ? [0, 0] : [dx / m, dy / m];
}

/**
 * Collect all anchors + road polylines from the live world.
 * Deterministic given the same world + road graph.
 */
export function collectAnchors(world: World, roadGraph: RoadGraph | undefined, width: number): CollectedAnchors {
  const anchors: Anchor[] = [];

  // 1) Entity-borne anchors (buildings: door/gate; barriers: wall_end/gate). Stamp owner + id.
  for (const e of world.query({})) {
    const raw = (e.properties as { anchors?: Anchor[] } | undefined)?.anchors;
    if (!Array.isArray(raw)) continue;
    raw.forEach((a, i) => {
      anchors.push({ ...a, ownerId: a.ownerId ?? e.id, id: a.id ?? `${e.id}:a${i}` });
    });
  }

  // 2) Road endpoint anchors + the centre polylines the matcher snaps structures onto.
  const roads: RoadPolyline[] = [];
  if (roadGraph) {
    for (const edge of roadGraph.edges) {
      if (edge.feature !== 'road') continue;
      const pts = edge.polyline;
      if (pts.length < 2) continue;
      roads.push({ id: edge.id, points: pts });
      const aFace = unit(pts[1].x, pts[1].y, pts[0].x, pts[0].y);            // outward at start
      const bFace = unit(pts[pts.length - 2].x, pts[pts.length - 2].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
      anchors.push({ kind: 'road', x: pts[0].x, y: pts[0].y, facing: aFace, ownerId: edge.id, id: `${edge.id}:end-a`, tags: ['approach'] });
      anchors.push({ kind: 'road', x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, facing: bFace, ownerId: edge.id, id: `${edge.id}:end-b`, tags: ['approach'] });
    }
  }

  // 3) Bank anchors from river crossings (already paired at the crossing source; emitted here so
  //    the overlay + resolver can see them). Facing points inward, toward the span.
  if (roadGraph) {
    for (const spec of detectCrossings(roadGraph, width)) {
      if (!spec.banks) continue;
      const [n, f] = spec.banks;
      const inward = unit(n.x, n.y, f.x, f.y);
      anchors.push({ kind: 'bank', x: n.x, y: n.y, facing: inward, width: spec.spanTiles, ownerId: spec.id, id: `${spec.id}:bank-a`, tags: ['crossing'] });
      anchors.push({ kind: 'bank', x: f.x, y: f.y, facing: [-inward[0], -inward[1]], width: spec.spanTiles, ownerId: spec.id, id: `${spec.id}:bank-b`, tags: ['crossing'] });
    }
  }

  return { anchors, roads };
}
