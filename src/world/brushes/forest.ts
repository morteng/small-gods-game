import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'forest';
const DENSITY = 0.35;

function pickKind(rng: number): string {
  if (rng < 0.5) return 'oak_tree';
  if (rng < 0.75) return 'orange_tree';
  return 'pale_tree';
}

/**
 * Emit forest trees on tiles of type 'forest'. Ports the variant + density
 * logic from the legacy decoration-placer. Deterministic from (x, y, seed).
 */
export function forestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  const yEnd = region.y + region.h;
  const xEnd = region.x + region.w;
  for (let y = region.y; y < yEnd; y++) {
    for (let x = region.x; x < xEnd; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tile.type !== 'forest') continue;
      if (noise(x, y, seed) > DENSITY) continue;
      const variantRng = noise(x, y, seed + 1);
      const kind = pickKind(variantRng);
      const offRngX = noise(x, y, seed + 3);
      const offRngY = noise(x, y, seed + 4);
      const offsetX = (offRngX - 0.5) * 0.3;
      const offsetY = (offRngY - 0.5) * 0.3;
      out.push(defaultEntity(BRUSH, kind, x + offsetX, y + offsetY, { offsetX, offsetY }));
    }
  }
  return out;
}

registerBrush(BRUSH, forestBrush);
