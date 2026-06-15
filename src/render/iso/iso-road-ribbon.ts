// src/render/iso/iso-road-ribbon.ts
//
// Roads as smooth ground RIBBONS — the visible half of roads-epic Slice 1. The
// road graph's polylines (Slice 0 promoted them; `RenderGraph.edges()` projects
// them) are walked by A* as 4-connected cells, so the raw path staircases. Here
// we smooth each road's centerline with a centripetal Catmull-Rom spline
// (α=0.5 — provably no cusp/self-intersection in a segment, interpolates THROUGH
// the cells; design §11/§7) and sweep a width-by-class cross-section into ribbon
// quads.
//
// The quads are emitted as ordinary `poly` DrawItems in world-screen space, so
// they ride the SAME machinery as everything else: `liftDrawList` raises each
// quad onto the terrain heightfield (per-quad, so the ribbon follows the ground
// it was grade-cut into), and the GPU shape pass triangulates + depth-sorts them.
// Prepended to the entity list → lowest list-index depth → drawn UNDER buildings,
// trees and NPCs, on the ground where a road belongs.
import type { DrawItem } from './draw-list';
import type { RoadGraph, RoadClass, RoadSurface } from '@/world/road-graph';
import { worldToScreen } from './iso-projection';

/** Ribbon half-width in TILES by class (offset is applied in tile space, so the
 *  iso transform foreshortens it correctly). A road tile is carved 1 wide. */
const HALF_WIDTH_TILES: Record<RoadClass, number> = {
  highway: 0.62,
  road: 0.48,
  track: 0.34,
  path: 0.24,
};

/** Surface → fill. Slightly darker than the carved dirt tile so the ribbon reads
 *  as a packed road over the trampled ground, not a flat recolour. */
const SURFACE_COLOR: Record<RoadSurface, string> = {
  dirt: '#5f4d33',
  stone: '#857c70',
  water: '#3c6076',
};

type Pt = { x: number; y: number };

/** Centripetal Catmull-Rom: resample a polyline into a smooth, evenly-ish spaced
 *  centerline. Endpoints are duplicated so the curve passes through them. */
function smoothCenterline(pts: Pt[], stepTiles = 0.5): Pt[] {
  if (pts.length < 3) return pts.slice();
  const p = [pts[0], ...pts, pts[pts.length - 1]]; // clamp ends
  const out: Pt[] = [pts[0]];
  const alpha = 0.5;
  const tj = (ti: number, a: Pt, b: Pt) =>
    ti + Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha);

  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    if (t2 === t1) continue; // coincident control points
    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.ceil(segLen / stepTiles));
    for (let s = 1; s <= steps; s++) {
      const t = t1 + (t2 - t1) * (s / steps);
      // Barry–Goldman pyramidal evaluation.
      const a1 = lerpT(p0, p1, t0, t1, t);
      const a2 = lerpT(p1, p2, t1, t2, t);
      const a3 = lerpT(p2, p3, t2, t3, t);
      const b1 = lerpT2(a1, a2, t0, t2, t);
      const b2 = lerpT2(a2, a3, t1, t3, t);
      out.push(lerpT3(b1, b2, t1, t2, t));
    }
  }
  return out;
}

function lerpT(a: Pt, b: Pt, ta: number, tb: number, t: number): Pt {
  const w = tb === ta ? 0 : (t - ta) / (tb - ta);
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}
const lerpT2 = lerpT;
const lerpT3 = lerpT;

/** Build ribbon quad `poly` items for every road edge in the graph. World-screen
 *  coords (z=0); terrain lift + depth handled downstream. */
export function buildRoadRibbonItems(
  graph: RoadGraph | undefined,
  o: { originX: number; originY: number },
): DrawItem[] {
  if (!graph?.edges.length) return [];
  const items: DrawItem[] = [];
  for (const edge of graph.edges) {
    if (edge.feature !== 'road') continue;
    const raw = edge.polyline;
    if (raw.length < 2) continue;
    const hw = HALF_WIDTH_TILES[edge.class] ?? HALF_WIDTH_TILES.road;
    const color = SURFACE_COLOR[edge.surface] ?? SURFACE_COLOR.dirt;
    const c = smoothCenterline(raw);
    if (c.length < 2) continue;

    // Per centerline point: unit tangent (central difference) → perpendicular.
    for (let i = 0; i < c.length - 1; i++) {
      const a = c[i];
      const b = c[i + 1];
      const ta = tangent(c, i);
      const tb = tangent(c, i + 1);
      const pa = { x: -ta.y * hw, y: ta.x * hw };
      const pb = { x: -tb.y * hw, y: tb.x * hw };
      // Quad corners in tile space, then projected. Order: aL → bL → bR → aR.
      const aL = worldToScreen(a.x + pa.x, a.y + pa.y, 0, o.originX, o.originY);
      const bL = worldToScreen(b.x + pb.x, b.y + pb.y, 0, o.originX, o.originY);
      const bR = worldToScreen(b.x - pb.x, b.y - pb.y, 0, o.originX, o.originY);
      const aR = worldToScreen(a.x - pa.x, a.y - pa.y, 0, o.originX, o.originY);
      items.push({
        t: 'poly',
        points: [
          { x: aL.sx, y: aL.sy },
          { x: bL.sx, y: bL.sy },
          { x: bR.sx, y: bR.sy },
          { x: aR.sx, y: aR.sy },
        ],
        color,
      });
    }
  }
  return items;
}

/** Unit tangent at centerline point i (central difference, clamped at ends). */
function tangent(c: Pt[], i: number): Pt {
  const prev = c[Math.max(0, i - 1)];
  const next = c[Math.min(c.length - 1, i + 1)];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
