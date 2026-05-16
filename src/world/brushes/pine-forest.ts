import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'pine_forest';

export function pineForestBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tile.type !== 'pine_forest') continue;
      if (noise(x, y, seed) < 0.50) {
        const kind = noise(x, y, seed + 1) < 0.5 ? 'pine_tree' : 'pale_tree';
        const ox = (noise(x, y, seed + 3) - 0.5) * 0.3;
        const oy = (noise(x, y, seed + 4) - 0.5) * 0.3;
        out.push(defaultEntity(BRUSH, kind, x + ox, y + oy, { offsetX: ox, offsetY: oy }));
      } else if (noise(x, y, seed + 10) < 0.05) {
        out.push(defaultEntity(BRUSH, 'mushroom', x + 0.5, y + 0.5));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, pineForestBrush);
