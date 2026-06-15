import type { RenderContext, HitResult, Tile, Entity, NpcInstance, GeneratedDecoration } from '@/core/types';
import { getEntitySortY } from '@/render/entity-sort';
import { pickTile } from '@/ui/pick-tile';

/**
 * Convert screen (canvas) coordinates to a tile and perform a hit-test
 * against NPCs → entities → decorations → tiles.
 *
 * Tile resolution is delegated to `pickTile`, the single mode-aware
 * screen→tile inverse — so this works in both topdown and iso. (Rolling
 * its own topdown-only math here was why iso hover/selection was broken.)
 *
 * Returns a HitResult describing what (if anything) was clicked.
 */
export function hitTest(rc: RenderContext, canvasX: number, canvasY: number): HitResult {
  const { tx: tileX, ty: tileY } = pickTile(rc.camera, canvasX, canvasY);

  // 1. Check NPCs (rendered on top of everything)
  for (const npc of rc.npcs) {
    if (Math.floor(npc.tileX) === tileX && Math.floor(npc.tileY) === tileY) {
      return { type: 'npc', npc, tileX, tileY };
    }
  }

  // 2. Check entities (buildings, trees, rocks) via spatial query
  if (rc.world) {
    const entities = rc.world.query({ region: { x: tileX, y: tileY, w: 1, h: 1 } });
    if (entities.length > 0) {
      // Sort by y-sort order so the topmost entity is selected
      entities.sort((a, b) => getEntitySortY(b) - getEntitySortY(a));
      return { type: 'entity', entity: entities[0], tileX, tileY };
    }
  }

  // 3. Check decorations
  for (const d of rc.generatedDecorations ?? []) {
    if (d.tileX === tileX && d.tileY === tileY) {
      return { type: 'decoration', decoration: d, tileX, tileY };
    }
  }

  // 4. Return tile info
  const tile = rc.map.tiles[tileY]?.[tileX];
  return { type: 'tile', tile, tileX, tileY };
}
