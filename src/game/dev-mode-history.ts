/**
 * Pure undo/redo reducer for dev-mode history.
 *
 * Extracted from the `undo()`, `redo()`, `restoreEntitySnapshot()`, and
 * `restoreTileSnapshot()` methods in game.ts (step 5a — additive only).
 * game.ts is NOT modified in this step; wiring happens in step 5b.
 */

import type { Entity, GameMap, Tile, UndoAction } from '@/core/types';
import type { World } from '@/world/world';

/** Restore an entity's full field set from a snapshot. Mirrors game.ts restoreEntitySnapshot(). */
function restoreEntity(world: World | null, id: string, snap: Entity): void {
  world?.updateEntity(id, {
    kind: snap.kind,
    x: snap.x,
    y: snap.y,
    properties: snap.properties,
    tags: snap.tags,
  });
}

/** Restore a tile's fields from a partial snapshot. Mirrors game.ts restoreTileSnapshot(). */
function restoreTile(map: GameMap | null, tx: number, ty: number, snap: Partial<Tile>): void {
  const tile = map?.tiles[ty]?.[tx];
  if (tile) Object.assign(tile, snap);
}

/**
 * Apply the undo side of an action.
 *
 * Mirrors the switch logic inside game.ts `undo()`:
 *   entity_create  → remove entity (action.after guards the call)
 *   entity_delete  → add entity back (action.before guards the call)
 *   entity_update  → restore pre-edit snapshot from action.before
 *   tile_update    → restore pre-edit tile snapshot from action.before
 */
export function applyUndo(action: UndoAction, world: World | null, map: GameMap | null): void {
  if (action.type === 'entity_create' && action.after) {
    world?.removeEntity(action.target.entityId!);
  } else if (action.type === 'entity_delete' && action.before) {
    world?.addEntity(action.before as Entity);
  } else if (action.type === 'entity_update' && action.before) {
    restoreEntity(world, action.target.entityId!, action.before as Entity);
  } else if (action.type === 'tile_update' && action.before) {
    restoreTile(map, action.target.tileX, action.target.tileY, action.before as Partial<Tile>);
  }
}

/**
 * Apply the redo side of an action.
 *
 * Mirrors the switch logic inside game.ts `redo()`:
 *   entity_create  → add entity back (action.after guards the call)
 *   entity_delete  → remove entity again (action.before guards the call)
 *   entity_update  → re-apply post-edit snapshot from action.after
 *   tile_update    → re-apply post-edit tile snapshot from action.after
 */
export function applyRedo(action: UndoAction, world: World | null, map: GameMap | null): void {
  if (action.type === 'entity_create' && action.after) {
    world?.addEntity(action.after as Entity);
  } else if (action.type === 'entity_delete' && action.before) {
    world?.removeEntity(action.target.entityId!);
  } else if (action.type === 'entity_update' && action.after) {
    restoreEntity(world, action.target.entityId!, action.after as Entity);
  } else if (action.type === 'tile_update' && action.after) {
    restoreTile(map, action.target.tileX, action.target.tileY, action.after as Partial<Tile>);
  }
}
