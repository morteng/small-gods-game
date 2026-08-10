/**
 * Building collision layer — the single source of truth for "can a mortal walk
 * onto this tile, given the buildings that cover it?"
 *
 * A building occupies a rectangular footprint of tiles
 * (`entity.properties.footprint`). The {@link EntityRegistry} indexes *every*
 * footprint cell, so `registry.getCollidersAtTile(x, y)` authoritatively reports
 * which building(s) cover a tile. World's own spatial index is point-based (it
 * only knows the origin corner), which is why collision must go through the
 * registry tile index, not `world.query({region})`.
 *
 * It reads the COLLIDER half of that index, not `getAtTile`: mortals are indexed
 * by tile too, and once a whole settlement gathers on one venue tile, walking the
 * full occupant list made every walkability test — and therefore every A*
 * neighbour expansion — cost O(crowd). Nothing soft can block, so nothing soft
 * is worth looking at.
 *
 * ## Designed to grow
 *
 * Today the blueprint's door cells are passable; every other blocked footprint
 * cell is solid. This module is the seam where richer collision will live as
 * buildings gain interiors and features:
 *   - per-cell passability declared on the blueprint (the compiled `blocked` /
 *     `doorCells` sets) — the natural home for a future walkability map,
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
 * True when this entity is a placed barrier (wall/fence/palisade/rampart/
 * barricade/hedge run) — `placeBarrier` tags every run `'barrier'`
 * (`place-barrier.ts`) but never `'building'`, so `isBuilding` alone is blind
 * to it. Deliberately kept SEPARATE from `isBuilding` rather than folded in:
 * `isBuilding` feeds the movement collider ({@link tileBlockedByBuilding}),
 * and a barrier already blocks movement via its own `'obstacle'` tag — union-
 * ing the two here would double-count and change collision semantics nobody
 * asked to change. This predicate exists for callers that need "is this a
 * solid MAN-MADE structure" without touching that path — today the
 * vegetation clear/fill sweeps, so trees don't stand inside wall footprints
 * and ground cover isn't re-sown over them.
 */
export function isBarrier(e: Entity): boolean {
  return Array.isArray(e.tags) && e.tags.includes('barrier');
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
  // Colliders, not every body: a gathering tile can carry a hundred mortals and
  // none of them is a wall. `getCollidersAtTile` is the crowd-independent index.
  for (const e of world.registry.getCollidersAtTile(tileX, tileY)) {
    if (excludeEntityId && e.id === excludeEntityId) continue;
    if (isBuilding(e) && !isFootprintCellPassable(e, tileX, tileY)) return true;
  }
  return false;
}
