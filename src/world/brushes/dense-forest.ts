import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'dense_forest';
const TREE_DENSITY = 0.70;
const UNDERGROWTH_DENSITY = 0.10;

export function denseForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tile.type !== 'dense_forest') continue;

      if (noise(x, y, seed) < TREE_DENSITY) {
        const variant = noise(x, y, seed + 1);
        const kind = variant < 0.6 ? 'oak_tree' : 'brown_tree';
        const ox = (noise(x, y, seed + 3) - 0.5) * 0.3;
        const oy = (noise(x, y, seed + 4) - 0.5) * 0.3;
        out.push(defaultEntity(BRUSH, kind, x + ox, y + oy, { offsetX: ox, offsetY: oy }));
      } else if (noise(x, y, seed + 10) < UNDERGROWTH_DENSITY) {
        const v = noise(x, y, seed + 11);
        const kind = v < 0.5 ? 'shrub' : 'fern';
        out.push(defaultEntity(BRUSH, kind, x + 0.5, y + 0.5));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, denseForestBrush);
