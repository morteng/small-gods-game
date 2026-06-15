import type { Entity } from '@/core/types';
import { tryGetEntityKindDef } from '@/world/entity-kinds';

/**
 * Get the Y-sort value for an entity. Buildings sort at their footprint bottom
 * (y + sortYOffset), trees sort at their tile center + height offset.
 *
 * Used by hit-testing to pick the topmost entity under the cursor; the renderer
 * itself sorts via `iso-ysort`. (Relocated from the deleted legacy topdown
 * `renderer.ts` when the renderer went WebGPU-only.)
 */
export function getEntitySortY(e: Entity): number {
  const def = tryGetEntityKindDef(e.kind);
  if (!def) return e.y;

  // Buildings sort at their footprint's FRONT (south) edge so an NPC standing
  // in front of a building paints on top of it, while one stepping behind it is
  // occluded. `sortYOffset` is the per-template footprint bottom in tile units
  // (see building-templates.ts); fall back to the footprint height, then the
  // kind's yOffsetForSort. Sorting at the bare top (e.y) is wrong: it makes
  // every NPC overlapping the footprint paint over the building.
  if (def.category === 'building') {
    const offset =
      (e.properties?.sortYOffset as number | undefined) ??
      (e.properties?.footprint as { h?: number } | undefined)?.h ??
      def.yOffsetForSort ?? 1;
    return e.y + offset;
  }

  // Trees and other entities use their yOffsetForSort. Trees should sort at tile
  // center (e.y + 0.5) so NPCs correctly render in front when below, behind when above.
  return e.y + (def.yOffsetForSort ?? 0);
}
