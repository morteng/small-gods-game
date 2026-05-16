import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'village';
const PLACEABLE = new Set(['grass', 'dirt']);
const ROAD = new Set(['dirt_road', 'stone_road', 'bridge', 'road']);

function tileHasBuilding(ctx: BrushContext, x: number, y: number): boolean {
  return ctx.world.query({ region: { x, y, w: 1, h: 1 }, tag: 'building' }).length > 0;
}

export function villageBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  const cx = Math.floor(region.x + region.w / 2);
  const cy = Math.floor(region.y + region.h / 2);

  const centerTile = ctx.tiles.tiles[cy]?.[cx];
  const centerPlaceable = centerTile !== undefined && PLACEABLE.has(centerTile.type);
  const centerHasBuilding = tileHasBuilding(ctx, cx, cy);

  if (centerPlaceable && !centerHasBuilding) {
    out.push(defaultEntity(BRUSH, 'well', cx + 0.5, cy + 0.5, { poiKind: 'village' }));
  }

  // Scattered props on placeable, non-building tiles
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !PLACEABLE.has(tile.type)) continue;
      if (tileHasBuilding(ctx, x, y)) continue;
      // Skip the well tile we already placed
      if (x === cx && y === cy && centerPlaceable && !centerHasBuilding) continue;

      const r = noise(x, y, seed);
      if (r < 0.02) out.push(defaultEntity(BRUSH, 'bench', x + 0.5, y + 0.5));
      else if (r < 0.04) out.push(defaultEntity(BRUSH, 'sign_post', x + 0.5, y + 0.5));
      else if (r < 0.06) out.push(defaultEntity(BRUSH, 'lamp_post', x + 0.5, y + 0.5));
    }
  }

  // Fence posts along the top + bottom boundary rows
  const yTop = region.y;
  const yBottom = region.y + region.h - 1;
  for (let x = region.x; x < region.x + region.w; x++) {
    for (const y of [yTop, yBottom]) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || ROAD.has(tile.type) || tileHasBuilding(ctx, x, y)) continue;
      if (noise(x, y, seed + 1) < 0.5) {
        out.push(defaultEntity(BRUSH, 'fence_post', x + 0.5, y + 0.5));
      }
    }
  }

  return out;
}

registerBrush(BRUSH, villageBrush);
