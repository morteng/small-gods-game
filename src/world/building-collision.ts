/**
 * Building collision layer — the single source of truth for "can a mortal walk
 * onto this tile, given the buildings that cover it?"
 *
 * A building occupies a rectangular footprint of tiles
 * (`entity.properties.footprint`). The {@link EntityRegistry} indexes *every*
 * footprint cell (`registry.byTile`), so `registry.getAtTile(x, y)`
 * authoritatively reports which building(s) cover a tile. World's own spatial
 * index is point-based (it only knows the origin corner), which is why
 * collision must go through the registry tile index, not `world.query({region})`.
 *
 * ## Designed to grow
 *
 * Today every footprint cell is solid. This module is the seam where richer
 * collision will live as buildings gain interiors and features:
 *   - per-cell passability from the ground floor plan
 *     (`BuildingTemplate.floors[0].walkable[localY][localX]`),
 *   - walkable entrances (`BuildingTemplate.doorCell`),
 *   - stairs linking stories, roof overhangs that occlude but don't block,
 *   - material/era variations.
 * Keep that logic here so pathfinding, perception, and placement share one
 * definition of solidity rather than each re-deriving it.
 */
import type { Entity, EntityId } from '@/core/types';
import type { World } from '@/world/world';
import { tryGetEntityKindDef } from '@/world/entity-kinds';

/** True when this entity is a building (its footprint forms a collider). */
export function isBuilding(e: Entity): boolean {
  return tryGetEntityKindDef(e.kind)?.category === 'building';
}

/**
 * Whether a single footprint cell of `building` can be walked through.
 *
 * v1: the whole footprint is solid (returns false for every covered cell).
 *
 * Extension point: derive local coordinates with
 * `localX = tileX - Math.floor(building.x)`, `localY = tileY - Math.floor(building.y)`,
 * then return true where the ground floor plan marks the cell walkable
 * (`floors[0].walkable[localY]?.[localX]`) or the cell is the `doorCell`.
 */
export function isFootprintCellPassable(
  _building: Entity,
  _tileX: number,
  _tileY: number,
): boolean {
  return false;
}

/**
 * Does a building footprint block ground movement onto (tileX, tileY)?
 *
 * @param excludeEntityId - entity to ignore (e.g. an NPC testing its own tile).
 */
export function tileBlockedByBuilding(
  world: World,
  tileX: number,
  tileY: number,
  excludeEntityId?: EntityId,
): boolean {
  for (const e of world.registry.getAtTile(tileX, tileY)) {
    if (excludeEntityId && e.id === excludeEntityId) continue;
    if (isBuilding(e) && !isFootprintCellPassable(e, tileX, tileY)) return true;
  }
  return false;
}
