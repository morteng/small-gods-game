/**
 * Wire a barrier gate anchor to the nearest REACHABLE road tile.
 *
 * A bounded 4-connected BFS from the gate, expanding through carveable ground only:
 * water and caller-supplied blocked cells (wall curtains) are never entered. The old
 * Bresenham version drew a straight line to the nearest road by distance, which could
 * carve a dirt spur straight across a river (a bridgeless ford) or through a curtain
 * wall away from any gate — exactly the crossings the wall/water invariants forbid.
 * BFS finds the nearest road BY PATH, so the spur bends around the obstacle or, when
 * no route exists within the budget, honestly declines (the `gate.road-connected`
 * lint requirement then reports the unwired gate).
 */

import type { Anchor } from '@/world/anchors';
import type { GameMap, Tile } from '@/core/types';
import { WATER_TYPES } from '@/core/constants';

/** Road tile types — same set as building-placer.ts */
const ROAD_TYPES = new Set(['dirt_road', 'stone_road', 'bridge']);

/** Dirt-road type used for newly carved gate paths (matches building-placer default) */
const GATE_PATH_TYPE = 'dirt_road';

/** Return the tile at (x, y) if it's within map bounds, otherwise undefined. */
function tileAt(map: GameMap, x: number, y: number): Tile | undefined {
  return map.tiles[y]?.[x];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connect a gate anchor to the nearest reachable road tile by carving a contiguous
 * path of `dirt_road` tiles between them.
 *
 * @param gate       The gate anchor (integer tile coordinates expected).
 * @param map        The live GameMap whose tile grid will be mutated.
 * @param maxSearch  Chebyshev search radius for the BFS frontier (default 12).
 * @param isBlocked  Extra impassable cells (e.g. wall curtain blocking cells).
 * @returns          `true` if a road was reached and a path was carved;
 *                   `false` if no road is reachable within the search radius
 *                   (the map is left unchanged in that case).
 */
export function wireGateToRoad(
  gate: Anchor,
  map: GameMap,
  maxSearch = 12,
  isBlocked?: (x: number, y: number) => boolean,
): boolean {
  const gx = Math.round(gate.x);
  const gy = Math.round(gate.y);

  const passable = (x: number, y: number): boolean => {
    const t = tileAt(map, x, y);
    if (!t) return false;
    if (WATER_TYPES.has(t.type)) return false;          // never ford — bridges are roads' job
    if (isBlocked?.(x, y)) return false;                 // never pierce a curtain
    return true;
  };

  // BFS from the gate cell. The gate opening itself is passable by construction (it is
  // excluded from the curtain's blocking cells); if a caller-blocked cell coincides
  // anyway, there is nothing safe to carve — decline.
  if (!passable(gx, gy)) return false;
  const key = (x: number, y: number): number => (y + maxSearch - gy) * (2 * maxSearch + 1) + (x + maxSearch - gx);
  const cameFrom = new Map<number, number>();
  cameFrom.set(key(gx, gy), -1);
  let frontier: { x: number; y: number }[] = [{ x: gx, y: gy }];
  let goal: { x: number; y: number } | null = null;

  while (frontier.length && !goal) {
    const next: { x: number; y: number }[] = [];
    for (const c of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = c.x + dx, ny = c.y + dy;
        if (Math.abs(nx - gx) > maxSearch || Math.abs(ny - gy) > maxSearch) continue;
        const k = key(nx, ny);
        if (cameFrom.has(k)) continue;
        const t = tileAt(map, nx, ny);
        if (!t) continue;
        if (ROAD_TYPES.has(t.type)) { cameFrom.set(k, key(c.x, c.y)); goal = { x: nx, y: ny }; break; }
        if (!passable(nx, ny)) continue;
        cameFrom.set(k, key(c.x, c.y));
        next.push({ x: nx, y: ny });
      }
      if (goal) break;
    }
    frontier = next;
  }
  if (!goal) return false;

  // Walk the parent chain back from the road, carving dirt over the non-road cells.
  const unkey = (k: number): { x: number; y: number } => ({
    x: (k % (2 * maxSearch + 1)) - maxSearch + gx,
    y: Math.floor(k / (2 * maxSearch + 1)) - maxSearch + gy,
  });
  let k = key(goal.x, goal.y);
  while (k !== -1) {
    const { x, y } = unkey(k);
    const t = tileAt(map, x, y);
    k = cameFrom.get(k) ?? -1;
    if (!t || ROAD_TYPES.has(t.type)) continue;          // don't overwrite existing road
    t.type = GATE_PATH_TYPE;
    t.walkable = true;
  }
  const gateTile = tileAt(map, gx, gy);
  if (gateTile) gateTile.walkable = true;

  return true;
}
