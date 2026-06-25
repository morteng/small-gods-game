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

/**
 * Sub-tile resolution of the pavedness field. A per-cell (1-per-2m-tile) scalar can
 * only resolve a road EDGE to ±0.5 tile, so the carriageway boundary wobbles at tile
 * frequency (the "zig-zag roads" artifact) however smooth the centerline is. Sampling
 * the centerline distance at S× per tile liberates the edge from the 2 m grid — the
 * shader (which already bilinear-samples this buffer) then reconstructs a smooth sub-
 * tile carriageway. 4× → 0.5 m precision; the field is static + memoised per world so
 * the (16× cells in the road bbox) build cost is paid once. The shader derives S from
 * `arrayLength(&roadSurface)` so no extra uniform is needed.
 */
export const ROAD_SURFACE_SUPERSAMPLE = 4;

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
 * Pure: a world → its road pavedness field (row-major). Each road edge stamps its
 * carriageway (out to the carriageway half-width + a shoulder lip) with its material
 * pavedness, feathered at the edge; overlapping roads take the strongest.
 *
 * `supersample` (S) gives the field S× the cell resolution — fine cell (i,j) samples
 * the centerline distance at the continuous tile coord (i/S, j/S), so the row stride
 * is `width*S` and the array is `width*S * height*S`. S=1 is byte-identical to the
 * per-cell field (the integer-tile path tests pin); S>1 is what liberates the rendered
 * carriageway edge from the 2 m grid. The shader recovers S from the array length.
 */
export function buildRoadSurfaceField(map: GameMap, supersample = 1): Float32Array {
  const { width, height } = map;
  const S = Math.max(1, Math.floor(supersample));
  const rw = width * S, rh = height * S;
  const field = new Float32Array(rw * rh);
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
    // Fine-index bbox: tile bounds → sub-cell lattice. At S=1 these collapse to the
    // integer-tile loop (fi0=x0 … fi1=x1), so the field stays byte-for-byte identical.
    const fi0 = Math.max(0, (Math.floor(minX) - pad) * S);
    const fj0 = Math.max(0, (Math.floor(minY) - pad) * S);
    const fi1 = Math.min(rw - 1, (Math.ceil(maxX) + pad + 1) * S - 1);
    const fj1 = Math.min(rh - 1, (Math.ceil(maxY) + pad + 1) * S - 1);

    for (let j = fj0; j <= fj1; j++) {
      const tileY = j / S;
      for (let i = fi0; i <= fi1; i++) {
        const tileX = i / S;
        const d = minDistToPolyline(centerline, tileX, tileY);
        if (d > halfW) continue;
        const fade = d <= core ? 1 : 1 - (d - core) / (halfW - core);
        const v = paved * fade;
        const idx = j * rw + i;
        if (v > field[idx]) field[idx] = v;
      }
    }
  }
  return field;
}

// ── Memoised per (seed, dims) — the field is static for a world. ──
const cache = new Map<string, Float32Array>();
const CACHE_CAP = 4;

/** Memoised {@link buildRoadSurfaceField} at the production sub-tile resolution. Same
 *  array instance across frames (the field is static for a world). */
export function getRoadSurfaceField(map: GameMap): Float32Array {
  const k = `${map.seed}:${map.width}x${map.height}:r${map.roadGraph?.rev ?? 0}:s${ROAD_SURFACE_SUPERSAMPLE}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const field = buildRoadSurfaceField(map, ROAD_SURFACE_SUPERSAMPLE);
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
