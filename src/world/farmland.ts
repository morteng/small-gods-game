// src/world/farmland.ts
//
// Tilled fields around farm buildings — the agricultural ground a settlement works. A farm
// (a barn / stable, tagged 'farm') sits at the settlement EDGE (its placement affinity), so
// the open land just beyond it is where its fields lie. This pass stamps a patch of
// `farm_field` tiles on the soft ground adjacent to each farm, on the side with the most open
// land (away from the built-up core), skipping anything already special — water, roads, other
// buildings, existing fields. Fields are walkable ground, so they never block roads or
// placement; they only re-dress soil the settlement already owns.
//
// This is the FARMLAND SUBSTRATE: it gives a farming settlement visible fields (the live
// noise worldgen had none — `farm_field` was only ever painted by the dormant WFC engine) and
// it is the ground a later irrigation pass (G7) distributes water across. Pure + deterministic
// (field extent derives from the farm's tile position; no RNG).

import type { GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import { blueprintOf } from '@/blueprint/entity';
import { tileBlockedByBuilding } from '@/world/building-collision';
import { WATER_TYPES } from '@/core/constants';

/** Open natural soil a field may re-dress (never water/sand/road/built/special). */
const FIELD_SOIL: ReadonlySet<string> = new Set(['grass', 'meadow', 'glen', 'scrubland', 'dirt', 'hills']);
const ROAD_TILES: ReadonlySet<string> = new Set(['dirt_road', 'stone_road', 'bridge']);

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** A cell that a field may overwrite: open soil, not under a building, not road/water. */
function isSoil(map: GameMap, world: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y]?.[x];
  if (!t || !FIELD_SOIL.has(t.type)) return false;
  if (ROAD_TILES.has(t.type) || WATER_TYPES.has(t.type)) return false;
  return !tileBlockedByBuilding(world, x, y);
}

/**
 * Stamp tilled fields around every farm building. Returns the number of tiles painted.
 * Deterministic: a farm's field side + extent come from its integer tile position only.
 */
export function stampFarmland(map: GameMap, world: World, opts: { maxRadius?: number } = {}): number {
  const maxR = opts.maxRadius ?? 6;
  const farms = (world.query({ tag: 'farm' }) as Entity[])
    .slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x) || String(a.id).localeCompare(String(b.id)));  // stable order

  let painted = 0;
  for (const farm of farms) {
    const fp = blueprintOf(farm)?.collision.footprint;
    const fw = fp?.w ?? 2, fh = fp?.h ?? 2;
    const cx = Math.floor(farm.x), cy = Math.floor(farm.y);
    // Field span scales gently with the farm size; deterministic.
    const span = Math.min(maxR, 3 + ((cx * 7 + cy * 13) % 3));   // 3..5 tiles deep
    const cross = Math.max(fw, fh) + 2;                          // a touch wider than the barn

    // Score each cardinal side by how much open soil a candidate field rect would cover; the
    // best side is the open land beyond the barn (the built core scores low — it's all houses).
    let best: { dir: [number, number]; cells: [number, number][] } | null = null;
    for (const [dx, dy] of DIRS) {
      const cells: [number, number][] = [];
      // Rect starts one tile past the barn footprint in (dx,dy), `span` deep, `cross` wide.
      for (let d = 1; d <= span; d++) {
        for (let c = -Math.floor(cross / 2); c <= Math.floor(cross / 2); c++) {
          const x = cx + dx * (d + Math.floor((dx ? fw : fh) / 2)) + (dx ? 0 : c);
          const y = cy + dy * (d + Math.floor((dy ? fh : fw) / 2)) + (dy ? 0 : c);
          if (isSoil(map, world, x, y)) cells.push([x, y]);
        }
      }
      if (!best || cells.length > best.cells.length) best = { dir: [dx, dy], cells };
    }
    if (!best || best.cells.length < 3) continue;   // no open ground to farm — skip

    for (const [x, y] of best.cells) {
      const t = map.tiles[y][x];
      t.type = 'farm_field';
      t.walkable = true;
      painted++;
    }
  }
  return painted;
}
