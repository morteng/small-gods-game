import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'wilderness';
const PLACEABLE = new Set([
  'grass',
  'dirt',
  'scrubland',
  'forest',
  'glen',
  'hills',
  'dirt_road',
  'sacred_grove',
  'meadow',
]);

function tileHasBuilding(ctx: BrushContext, x: number, y: number): boolean {
  return ctx.world.query({ region: { x, y, w: 1, h: 1 }, tag: 'building' }).length > 0;
}

export function wildernessBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !PLACEABLE.has(tile.type)) continue;
      if (tileHasBuilding(ctx, x, y)) continue;

      const r = noise(x, y, seed);
      if (r < 0.001) out.push(defaultEntity(BRUSH, 'tent', x + 0.5, y + 0.5));
      else if (r < 0.003) out.push(defaultEntity(BRUSH, 'campfire', x + 0.5, y + 0.5));
      else if (r < 0.023) out.push(defaultEntity(BRUSH, 'log', x + 0.5, y + 0.5));
      else if (r < 0.043) out.push(defaultEntity(BRUSH, 'stump', x + 0.5, y + 0.5));
    }
  }
  return out;
}

registerBrush(BRUSH, wildernessBrush);
