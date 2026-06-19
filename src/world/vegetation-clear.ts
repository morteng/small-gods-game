/**
 * Reconciliation sweep: remove nature entities (trees, rocks, debris) that ended
 * up under a road, river, or building footprint.
 *
 * Map generation writes terrain, buildings, and vegetation in several passes
 * that are NOT strictly ordered — biome brushes seed vegetation, then roads and
 * rivers paint tiles over it, and POI-zone brushes can drop flora after the
 * buildings exist. Rather than make every writer defensively check the others,
 * this is the single place that enforces the world rule:
 *
 *   roads and rivers clear vegetation, and nothing vegetates on a building.
 *
 * Deterministic (no RNG) and idempotent — safe to run once at the end of
 * generation, or again after a later edit that paints roads/buildings.
 */
import type { GameMap, EntityId } from '@/core/types';
import type { World } from '@/world/world';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { isBuilding } from '@/world/building-collision';

/** Entity categories considered "nature" and therefore clearable. */
const NATURE_CATEGORIES = new Set(['vegetation', 'terrain-feature']);

/** Tile types that must be clear of vegetation. */
export function isRoadOrRiver(type: string): boolean {
  return (
    type === 'river' ||
    type === 'road' || type.startsWith('road_') ||
    type.startsWith('dirt_road') || type.startsWith('stone_road') ||
    type === 'bridge' || type.startsWith('bridge_')
  );
}

/**
 * Clearance radius (TILES) of the road/river CORRIDOR within which vegetation is
 * removed. The 1-tile road/river cell is not enough: roads render as a swept
 * ribbon ~1 tile wide that now snakes DIAGONALLY across cells the grid never
 * marked as road, and tree canopies overhang. So we clear trunks within this
 * radius of any road/river cell centre — a clean strip the ribbon sits in, with a
 * margin for the canopy. Tuned so a forest road reads as a real clearing without
 * carving a bald motorway.
 */
export const CORRIDOR_CLEAR_RADIUS = 1.6;

/** True if any cell within `r` tiles of continuous point (x,y) is road/river. */
function nearRoadOrRiver(map: GameMap, x: number, y: number, r: number): boolean {
  const span = Math.ceil(r);
  const cx = Math.floor(x), cy = Math.floor(y);
  const r2 = r * r;
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const tx = cx + dx, ty = cy + dy;
      const tile = map.tiles[ty]?.[tx];
      if (!tile || !isRoadOrRiver(tile.type)) continue;
      // Distance from the trunk to the cell centre (continuous), so the strip
      // width is symmetric regardless of which cell the trunk floored into.
      const ddx = (tx + 0.5) - x, ddy = (ty + 0.5) - y;
      if (ddx * ddx + ddy * ddy <= r2) return true;
    }
  }
  return false;
}

/**
 * Remove vegetation / terrain-feature entities sitting on a building footprint or
 * within the road/river CORRIDOR (a dilation of the road/river cells by
 * {@link CORRIDOR_CLEAR_RADIUS} — see above). Returns the number removed.
 */
export function clearObstructedVegetation(
  world: World, map: GameMap, corridorRadius = CORRIDOR_CLEAR_RADIUS,
): number {
  const toRemove: EntityId[] = [];

  for (const e of world.query({})) {
    const def = tryGetEntityKindDef(e.kind);
    if (!def || !NATURE_CATEGORIES.has(def.category)) continue;

    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);

    const inCorridor = nearRoadOrRiver(map, e.x, e.y, corridorRadius);
    const onBuilding = world.registry
      .getAtTile(tx, ty)
      .some(b => b.id !== e.id && isBuilding(b));

    if (inCorridor || onBuilding) toRemove.push(e.id);
  }

  for (const id of toRemove) world.removeEntity(id);
  return toRemove.length;
}
