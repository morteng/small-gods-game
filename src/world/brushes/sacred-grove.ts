import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'sacred_grove';
const TILE_TYPES = new Set(['sacred_grove', 'glen']);

export function sacredGroveBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !TILE_TYPES.has(tile.type)) continue;

      if (noise(x, y, seed) < 0.45) {
        const kind = noise(x, y, seed + 1) < 0.5 ? 'oak_tree' : 'birch_tree';
        const ox = (noise(x, y, seed + 3) - 0.5) * 0.3;
        const oy = (noise(x, y, seed + 4) - 0.5) * 0.3;
        out.push(defaultEntity(BRUSH, kind, x + ox, y + oy, { offsetX: ox, offsetY: oy }, ['sacred']));
      } else if (noise(x, y, seed + 10) < 0.15) {
        out.push(defaultEntity(BRUSH, 'flower_patch', x + 0.5, y + 0.5, {}, ['sacred']));
      } else if (noise(x, y, seed + 20) < 0.01) {
        if (ctx.world.query({ region: { x, y, w: 1, h: 1 } }).length === 0) {
          out.push(defaultEntity(BRUSH, 'standing_stone', x + 0.5, y + 0.5, {}, ['sacred']));
        }
      } else if (noise(x, y, seed + 30) < 0.005) {
        out.push(defaultEntity(BRUSH, 'shrine_stone', x + 0.5, y + 0.5, {}, ['sacred']));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, sacredGroveBrush);
