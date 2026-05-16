import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'quarry';
const TILES = new Set(['quarry', 'rocky']);

export function quarryBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !TILES.has(tile.type)) continue;

      const r = noise(x, y, seed);
      if (r < 0.10) {
        out.push(defaultEntity(BRUSH, 'stone_block', x + 0.5, y + 0.5));
      } else if (r < 0.30) {
        out.push(defaultEntity(BRUSH, 'boulder', x + 0.5, y + 0.5));
      } else if (r < 0.33) {
        out.push(defaultEntity(BRUSH, 'ore_vein', x + 0.5, y + 0.5));
      } else if (r < 0.48) {
        out.push(defaultEntity(BRUSH, 'pebbles', x + 0.5, y + 0.5));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, quarryBrush);
