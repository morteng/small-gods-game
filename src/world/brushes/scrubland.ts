import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'scrubland';

export function scrublandBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tile.type !== 'scrubland') continue;

      if (noise(x, y, seed) < 0.20) {
        const v = noise(x, y, seed + 1);
        const kind = v < 0.5 ? 'shrub' : v < 0.75 ? 'cactus' : 'grass_tuft';
        const ox = (noise(x, y, seed + 3) - 0.5) * 0.3;
        const oy = (noise(x, y, seed + 4) - 0.5) * 0.3;
        out.push(defaultEntity(BRUSH, kind, x + ox, y + oy, { offsetX: ox, offsetY: oy }));
      } else if (noise(x, y, seed + 20) < 0.02) {
        out.push(defaultEntity(BRUSH, 'boulder', x + 0.5, y + 0.5));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, scrublandBrush);
