/**
 * Ground material an individual building "orders" for the tiles under it and a
 * surrounding apron ring. DERIVED, never written to tiles: deleting/moving a
 * building reverts the ground for free, and nothing new is serialized. When the
 * 2.5D flatten lands, this is the seam to promote to a baked Tile.material.
 *
 * Footprint material wins over any neighbour's apron material.
 */
import type { World } from '@/world/world';
import { isBuilding } from '@/world/building-collision';
import type { BuildingDescriptor, GroundMat } from '@/world/building-descriptor';

const key = (x: number, y: number): string => `${x},${y}`;

function descriptorOf(props: Record<string, unknown> | undefined): BuildingDescriptor | undefined {
  return props?.descriptor as BuildingDescriptor | undefined;
}

/** Build the per-frame map of tile → ordered ground material. */
export function computeGroundMaterialField(world: World): Map<string, GroundMat> {
  const buildings = world.query({}).filter(isBuilding);
  const field = new Map<string, GroundMat>();

  // Pass 1: footprints (these win).
  for (const b of buildings) {
    const d = descriptorOf(b.properties);
    if (!d?.groundMaterial) continue;
    const ox = Math.floor(b.x), oy = Math.floor(b.y);
    for (let dy = 0; dy < d.footprint.h; dy++) {
      for (let dx = 0; dx < d.footprint.w; dx++) {
        field.set(key(ox + dx, oy + dy), d.groundMaterial);
      }
    }
  }

  // Pass 2: aprons (only where a footprint hasn't already claimed the cell).
  for (const b of buildings) {
    const d = descriptorOf(b.properties);
    if (!d?.apron) continue;
    const ox = Math.floor(b.x), oy = Math.floor(b.y);
    const r = d.apron.radius;
    for (let dy = -r; dy < d.footprint.h + r; dy++) {
      for (let dx = -r; dx < d.footprint.w + r; dx++) {
        const inFootprint = dx >= 0 && dx < d.footprint.w && dy >= 0 && dy < d.footprint.h;
        if (inFootprint) continue;
        const k = key(ox + dx, oy + dy);
        if (!field.has(k)) field.set(k, d.apron.material);
      }
    }
  }

  return field;
}
