// src/world/road-surface.ts
//
// The road SURFACE/MATERIAL channel (design doc 2026-06-24, Slice 2). A road is
// carved into the height field by road-deformation; this is the matching per-cell
// "pavedness" field that makes the carriageway READ as its material (packed earth →
// gravel → cobble → paved) AND lets snow/ice/mud compose on top through the SAME
// unified terrain material gradient — a cold paved road ices, a wet dirt track muds,
// with no road-specific shader branch.
//
// Value semantics: 0 = no road; otherwise a 0..1 "pavedness" — dirt ~0.2 … paved 1.0,
// dimmed by upkeep (condition) and reclamation (overgrowth). The terrain shader maps it
// to a road albedo ramp (damp earth → pale cobble) and hardens the surface (less grass).
//
// Derived (pure) from the road graph + RoadState, memoised per (seed, dims) like the
// deformation store. Re-derives identically on load; nothing persisted.

import type { GameMap } from '@/core/types';
import type { SurfaceMaterial } from '@/world/road-state';
import { edgeRoadProfile } from '@/world/road-deformation';
import type { Pt } from '@/terrain/road-centerline';

/** Surface material → base pavedness (how hard/stone-like the running surface reads). */
const PAVEDNESS: Record<SurfaceMaterial, number> = { dirt: 0.2, gravel: 0.45, cobble: 0.75, paved: 1.0 };

/** Min distance from (px,py) to a polyline. */
function minDistToPolyline(pts: Pt[], px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const dx = pts[i + 1].x - ax, dy = pts[i + 1].y - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Pure: a world → its per-cell road pavedness field (row-major width*height). Each road
 * edge stamps its carriageway (out to the carriageway half-width + a shoulder lip) with
 * its material pavedness, feathered at the edge; overlapping roads take the strongest.
 */
export function buildRoadSurfaceField(map: GameMap): Float32Array {
  const { width, height } = map;
  const field = new Float32Array(width * height);
  const graph = map.roadGraph;
  if (!graph) return field;

  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p]));

  for (const edge of graph.edges) {
    const profile = edgeRoadProfile(map, edge, nodeById, poiById);
    if (!profile) continue;
    const { centerline, state, x } = profile;
    const paved = Math.max(0, Math.min(1, PAVEDNESS[state.surfaceMaterial] * state.condition * (1 - 0.7 * state.overgrowth)));
    if (paved <= 0) continue;
    const halfW = x.carriageHalf + 0.3;
    const core = halfW * 0.7;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of centerline) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = Math.ceil(halfW) + 1;
    const x0 = Math.max(0, Math.floor(minX) - pad);
    const y0 = Math.max(0, Math.floor(minY) - pad);
    const x1 = Math.min(width - 1, Math.ceil(maxX) + pad);
    const y1 = Math.min(height - 1, Math.ceil(maxY) + pad);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const d = minDistToPolyline(centerline, tx, ty);
        if (d > halfW) continue;
        const fade = d <= core ? 1 : 1 - (d - core) / (halfW - core);
        const v = paved * fade;
        const idx = ty * width + tx;
        if (v > field[idx]) field[idx] = v;
      }
    }
  }
  return field;
}

// ── Memoised per (seed, dims) — the field is static for a world. ──
const cache = new Map<string, Float32Array>();
const CACHE_CAP = 4;

/** Memoised {@link buildRoadSurfaceField}. Same array instance across frames. */
export function getRoadSurfaceField(map: GameMap): Float32Array {
  const k = `${map.seed}:${map.width}x${map.height}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const field = buildRoadSurfaceField(map);
  cache.set(k, field);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return field;
}

/** Drop the memo (tests). */
export function clearRoadSurfaceCache(): void {
  cache.clear();
}
