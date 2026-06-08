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
 * The descriptor's `door` cell (relative to the footprint top-left) is the one
 * passable cell; every other covered cell is solid. Buildings without a door
 * property (legacy / old-style entities) remain fully solid.
 */
export function isFootprintCellPassable(
  building: Entity,
  tileX: number,
  tileY: number,
): boolean {
  const props = building.properties;
  const desc = props?.descriptor as
    | { door?: { x: number; y: number }; structure?: { w: number; h: number; dx: number; dy: number } }
    | undefined;
  const door = (props?.door as { x: number; y: number } | undefined) ?? desc?.door;
  const localX = tileX - Math.floor(building.x);
  const localY = tileY - Math.floor(building.y);

  // Cells outside the structure rect are walkable lawn (the building's yard).
  const s = desc?.structure;
  if (s) {
    const inStructure =
      localX >= s.dx && localX < s.dx + s.w && localY >= s.dy && localY < s.dy + s.h;
    if (!inStructure) return true;
  }

  if (!door) return false;
  return localX === door.x && localY === door.y;
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
