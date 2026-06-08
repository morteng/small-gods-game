/**
 * Ground material an individual building "orders" for the tiles under it.
 * DERIVED, never written to tiles: deleting/moving a building reverts the ground
 * for free, and nothing new is serialized. When the 2.5D flatten lands, this is
 * the seam to promote to a baked Tile.material.
 *
 * Reads the building's blueprint `materials.ground`. (The old apron ring was
 * dropped with the descriptor model — the building sprite carries its own base.)
 */
import type { World } from '@/world/world';
import { isBuilding } from '@/world/building-collision';
import { blueprintOf } from '@/blueprint/entity';
import type { GroundMat } from '@/world/building-descriptor';

const key = (x: number, y: number): string => `${x},${y}`;

/** Build the per-frame map of tile → ordered ground material. */
export function computeGroundMaterialField(world: World): Map<string, GroundMat> {
  const buildings = world.query({}).filter(isBuilding);
  const field = new Map<string, GroundMat>();

  // Footprint ground material under each building.
  for (const b of buildings) {
    const stored = blueprintOf(b);
    const ground = stored?.rb.materials.ground as GroundMat | undefined;
    if (!ground) continue;
    const fp = stored!.rb.footprint;
    const ox = Math.floor(b.x), oy = Math.floor(b.y);
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        field.set(key(ox + dx, oy + dy), ground);
      }
    }
  }

  return field;
}
