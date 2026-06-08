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
 * Today the descriptor's `door` cell is passable; every other footprint cell is
 * solid. This module is the seam where richer collision will live as buildings
 * gain interiors and features:
 *   - per-cell passability declared on `BuildingDescriptor` (in
 *     `@/world/building-descriptor`) — the natural home for a future walkability
 *     map alongside the existing `door` field,
 *   - stairs linking stories, roof overhangs that occlude but don't block,
 *   - material/era variations.
 * Keep that logic here so pathfinding, perception, and placement share one
 * definition of solidity rather than each re-deriving it.
 */
import type { Entity, EntityId } from '@/core/types';
import type { World } from '@/world/world';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { blueprintOf } from '@/blueprint/entity';

/** True when this entity is a building (its footprint forms a collider). */
export function isBuilding(e: Entity): boolean {
  if (tryGetEntityKindDef(e.kind)?.category === 'building') return true;
  // Extensibility fallback: a descriptor-tagged building with an unregistered
  // kind still collides.
  return Array.isArray(e.tags) && e.tags.includes('building');
}

/**
 * Whether a single footprint cell of `building` can be walked through.
 *
 * Reads the blueprint's precomputed collision mask (`@/blueprint/entity`): a
 * door cell (relative to the footprint top-left) is passable; a `blocked`
 * structure cell is solid; any footprint cell outside `blocked` is walkable
 * lawn (the building's yard). Buildings without a stored blueprint remain
 * fully solid.
 */
export function isFootprintCellPassable(
  building: Entity,
  tileX: number,
  tileY: number,
): boolean {
  const stored = blueprintOf(building);
  if (!stored) return false;   // unknown building → solid
  const localX = tileX - Math.floor(building.x);
  const localY = tileY - Math.floor(building.y);
  const k = `${localX},${localY}`;
  if (stored.collision.doorCells.includes(k)) return true;   // door → passable
  return !stored.collision.blocked.includes(k);              // lawn → passable; structure → solid
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
