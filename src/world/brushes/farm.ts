import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'farm';
const FIELD_TYPES = new Set(['farm_field']);
const HAY_TYPES = new Set(['grass', 'dirt']);
const PLACEABLE_CENTER = new Set(['farm_field', 'grass', 'dirt']);
const ROAD = new Set(['dirt_road', 'stone_road', 'bridge', 'road']);

function tileHasBuilding(ctx: BrushContext, x: number, y: number): boolean {
  return ctx.world.query({ region: { x, y, w: 1, h: 1 }, tag: 'building' }).length > 0;
}

export function farmBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  const cx = Math.floor(region.x + region.w / 2);
  const cy = Math.floor(region.y + region.h / 2);
  const scarecrowPlaced =
    (ctx.tiles.tiles[cy]?.[cx] && PLACEABLE_CENTER.has(ctx.tiles.tiles[cy][cx].type) && !tileHasBuilding(ctx, cx, cy));

  if (scarecrowPlaced) {
    out.push(defaultEntity(BRUSH, 'scarecrow', cx + 0.5, cy + 0.5));
  }

  // Crop rows on every farm_field tile, plus hay bales on grass/dirt
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      if (x === cx && y === cy && scarecrowPlaced) continue;
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || tileHasBuilding(ctx, x, y)) continue;
      if (FIELD_TYPES.has(tile.type)) {
        out.push(defaultEntity(BRUSH, 'crop_row', x + 0.5, y + 0.5));
      } else if (HAY_TYPES.has(tile.type) && noise(x, y, seed + 100) < 0.03) {
        out.push(defaultEntity(BRUSH, 'hay_bale', x + 0.5, y + 0.5));
      }
    }
  }

  // Fence posts along top + bottom boundary rows
  const yTop = region.y;
  const yBottom = region.y + region.h - 1;
  for (let x = region.x; x < region.x + region.w; x++) {
    for (const y of [yTop, yBottom]) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || ROAD.has(tile.type) || tileHasBuilding(ctx, x, y)) continue;
      if (noise(x, y, seed + 200) < 0.5) {
        out.push(defaultEntity(BRUSH, 'fence_post', x + 0.5, y + 0.5));
      }
    }
  }

  return out;
}

registerBrush(BRUSH, farmBrush);
