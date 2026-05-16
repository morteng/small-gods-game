import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'castle';
const PLACEABLE = new Set(['grass', 'dirt', 'stone_road', 'dirt_road']);

function tileHasBuilding(ctx: BrushContext, x: number, y: number): boolean {
  return ctx.world.query({ region: { x, y, w: 1, h: 1 }, tag: 'building' }).length > 0;
}

export function castleBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];

  // Corner banners
  const corners: ReadonlyArray<readonly [number, number]> = [
    [region.x, region.y],
    [region.x + region.w - 1, region.y],
    [region.x, region.y + region.h - 1],
    [region.x + region.w - 1, region.y + region.h - 1],
  ];
  for (const [x, y] of corners) {
    const tile = ctx.tiles.tiles[y]?.[x];
    if (!tile || !PLACEABLE.has(tile.type)) continue;
    if (tileHasBuilding(ctx, x, y)) continue;
    out.push(defaultEntity(BRUSH, 'banner', x + 0.5, y + 0.5));
  }

  // Lamp posts on stone_road tiles
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tile.type !== 'stone_road') continue;
      if (tileHasBuilding(ctx, x, y)) continue;
      if (noise(x, y, seed + 50) < 0.50) {
        out.push(defaultEntity(BRUSH, 'lamp_post', x + 0.5, y + 0.5));
      }
    }
  }

  return out;
}

registerBrush(BRUSH, castleBrush);
