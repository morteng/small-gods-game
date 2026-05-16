import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'hills';
const TILES = new Set(['hills', 'mountain', 'peak', 'rocky']);

export function hillsBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !TILES.has(tile.type)) continue;

      const r = noise(x, y, seed);
      if (r < 0.04) {
        out.push(defaultEntity(BRUSH, 'boulder', x + 0.5, y + 0.5));
      } else if (r < 0.12) {
        out.push(defaultEntity(BRUSH, 'rock_pile', x + 0.5, y + 0.5));
      } else if (r < 0.27) {
        out.push(defaultEntity(BRUSH, 'grass_tuft', x + 0.5, y + 0.5));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, hillsBrush);
