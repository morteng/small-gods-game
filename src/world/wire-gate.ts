/**
 * Wire a barrier gate anchor to the nearest road tile.
 *
 * Reuses the same road-detection constants and Bresenham stepping pattern
 * as building-placer.ts (door-path carving). The carve helpers are duplicated
 * minimally here rather than re-exported from building-placer because
 * building-placer's bresenhamLine is file-private and not worth exporting
 * just for this use.  A shared module would be the right home if a third
 * caller appears.
 */

import type { Anchor } from '@/world/anchors';
import type { GameMap, Tile } from '@/core/types';

/** Road tile types — same set as building-placer.ts */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** Dirt-road type used for newly carved gate paths (matches building-placer default) */
const GATE_PATH_TYPE = 'dirt_road';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Return the tile at (x, y) if it's within map bounds, otherwise undefined. */
function tileAt(map: GameMap, x: number, y: number): Tile | undefined {
  return map.tiles[y]?.[x];
}

/**
 * Scan outward from (cx, cy) in Chebyshev rings up to maxSearch.
 * Returns the coordinates of the nearest tile whose type is in ROAD_TYPES,
 * or null if none found.
 */
function nearestRoadTile(
  map: GameMap,
  cx: number, cy: number,
  maxSearch: number,
): { x: number; y: number } | null {
  for (let r = 0; r <= maxSearch; r++) {
    // Collect all cells at Chebyshev distance exactly r
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        const t = tileAt(map, nx, ny);
        if (t && ROAD_TYPES.has(t.type)) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

/**
 * Bresenham line from (x0,y0) to (x1,y1), inclusive of both endpoints.
 * Identical algorithm to the one in building-placer.ts.
 */
function bresenhamLine(
  x0: number, y0: number,
  x1: number, y1: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  while (true) {
    pts.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
  return pts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connect a gate anchor to the nearest road tile by carving a contiguous
 * path of `dirt_road` tiles between them.
 *
 * @param gate       The gate anchor (integer tile coordinates expected).
 * @param map        The live GameMap whose tile grid will be mutated.
 * @param maxSearch  Chebyshev search radius for finding a road (default 12).
 * @returns          `true` if a road was found and a path was carved;
 *                   `false` if no road tile exists within the search radius
 *                   (the map is left unchanged in that case).
 */
export function wireGateToRoad(
  gate: Anchor,
  map: GameMap,
  maxSearch = 12,
): boolean {
  const gx = Math.round(gate.x);
  const gy = Math.round(gate.y);

  // Ensure the gate cell itself is walkable
  const gateTile = tileAt(map, gx, gy);
  if (gateTile) {
    gateTile.walkable = true;
  }

  // Find nearest road tile
  const road = nearestRoadTile(map, gx, gy, maxSearch);
  if (!road) return false;

  // Carve path from gate to road (Bresenham), skipping the road endpoint itself
  const path = bresenhamLine(gx, gy, road.x, road.y);
  for (const pt of path) {
    const t = tileAt(map, pt.x, pt.y);
    if (!t) continue;
    // Stop updating once we've reached an existing road tile (don't overwrite it)
    if (ROAD_TYPES.has(t.type)) break;
    t.type = GATE_PATH_TYPE;
    t.walkable = true;
  }

  return true;
}
