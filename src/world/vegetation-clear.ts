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
 * Remove vegetation / terrain-feature entities sitting on a road, river, or
 * building footprint. Returns the number of entities removed.
 */
export function clearObstructedVegetation(world: World, map: GameMap): number {
  const toRemove: EntityId[] = [];

  for (const e of world.query({})) {
    const def = tryGetEntityKindDef(e.kind);
    if (!def || !NATURE_CATEGORIES.has(def.category)) continue;

    const tx = Math.floor(e.x);
    const ty = Math.floor(e.y);

    const tile = map.tiles[ty]?.[tx];
    const onRoadOrRiver = tile ? isRoadOrRiver(tile.type) : false;
    const onBuilding = world.registry
      .getAtTile(tx, ty)
      .some(b => b.id !== e.id && isBuilding(b));

    if (onRoadOrRiver || onBuilding) toRemove.push(e.id);
  }

  for (const id of toRemove) world.removeEntity(id);
  return toRemove.length;
}
