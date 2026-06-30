// src/world/irrigation.ts
//
// Irrigation ditches — the conveyance that brings water from a stream/lake to a farm's fields
// (G7). The farmland pass (`stampFarmland`) tills `farm_field` patches around farm buildings;
// this pass connects each patch to its nearest water by digging a short ditch of
// `irrigation_ditch` tiles across the open soil between them, then flags the served fields
// `irrigated`. A patch with no water in reach stays rain-fed (no ditch, no flag).
//
// This is the demand→source→routed-line shape of the aqueduct (G6) at field scale, as a pure
// worldgen tile pass: deterministic (paths come from tile positions + a fixed BFS order; no RNG),
// and it only re-dresses open soil — it never crosses water, roads, buildings or the fields
// themselves, so it can't block routing or placement. The `irrigated` flag is a queryable
// fertility signal (watered vs rain-fed) for future crop/yield logic, the linter and MCP.

import type { GameMap } from '@/core/types';
import type { World } from '@/world/world';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { WATER_TYPES } from '@/core/constants';

/** Open soil a ditch may cross / be dug into (mirrors farmland's FIELD_SOIL). */
const DITCH_SOIL: ReadonlySet<string> = new Set(['grass', 'meadow', 'glen', 'scrubland', 'dirt', 'hills', 'sand']);

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const isWater = (map: GameMap, x: number, y: number): boolean =>
  WATER_TYPES.has(map.tiles[y]?.[x]?.type ?? '');

/** A cell a ditch path may traverse: a field cell, or open soil free of buildings. */
function traversable(map: GameMap, world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y][x];
  if (t.type === 'farm_field') return true;          // the field itself — a source, never stamped
  if (!DITCH_SOIL.has(t.type)) return false;
  return !tileBlockedByBuilding(world, x, y);
}

/** Flood-fill the farm_field tiles into 4-connected patches (deterministic top-left scan). */
function fieldPatches(map: GameMap): { x: number; y: number }[][] {
  const seen = new Uint8Array(map.width * map.height);
  const patches: { x: number; y: number }[][] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x].type !== 'farm_field' || seen[y * map.width + x]) continue;
      const patch: { x: number; y: number }[] = [];
      const stack = [[x, y]];
      seen[y * map.width + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        patch.push({ x: cx, y: cy });
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          const k = ny * map.width + nx;
          if (seen[k] || map.tiles[ny][nx].type !== 'farm_field') continue;
          seen[k] = 1;
          stack.push([nx, ny]);
        }
      }
      patches.push(patch);
    }
  }
  return patches;
}

/**
 * Dig irrigation ditches from each farm-field patch to its nearest water. Returns the number of
 * `irrigation_ditch` tiles stamped. Deterministic: patches scan top-left, BFS uses a fixed dir
 * order, so a given map always yields the same ditches.
 */
export function stampIrrigation(map: GameMap, world: World, opts: { maxRoute?: number } = {}): number {
  const maxRoute = opts.maxRoute ?? 10;
  const W = map.width;
  let stamped = 0;

  for (const patch of fieldPatches(map)) {
    // Multi-source BFS outward from every cell of THIS patch across traversable soil, to the
    // nearest water-adjacent land cell within `maxRoute` steps. parent[] reconstructs the path.
    const dist = new Map<number, number>();
    const parent = new Map<number, number>();
    const seeds = patch.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));   // stable frontier order
    const queue: number[] = [];
    for (const { x, y } of seeds) { const k = y * W + x; dist.set(k, 0); queue.push(k); }

    let landAtWater = -1;   // the land cell from which water was reached (ditch ends here)
    let head = 0;
    while (head < queue.length && landAtWater < 0) {
      const k = queue[head++];
      const cx = k % W, cy = (k - cx) / W;
      const d = dist.get(k)!;
      if (d >= maxRoute) continue;                       // out of reach — stop expanding this branch
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (isWater(map, nx, ny)) { landAtWater = k; break; }   // reached water — this land cell is the mouth
        const nk = ny * W + nx;
        if (dist.has(nk) || !traversable(map, world, nx, ny)) continue;
        dist.set(nk, d + 1);
        parent.set(nk, k);
        queue.push(nk);
      }
    }

    if (landAtWater < 0) continue;     // no water within reach — this patch stays rain-fed

    // Stamp the ditch back along the path: every non-field soil cell from the mouth to the patch.
    for (let k: number | undefined = landAtWater; k !== undefined; k = parent.get(k)) {
      const x = k % W, y = (k - x) / W;
      if (map.tiles[y][x].type !== 'farm_field') {       // leave the fields as fields
        map.tiles[y][x].type = 'irrigation_ditch';
        map.tiles[y][x].walkable = true;
        stamped++;
      }
    }
    // The whole patch is now watered.
    for (const { x, y } of patch) map.tiles[y][x].irrigated = true;
  }

  return stamped;
}
