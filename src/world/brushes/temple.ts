import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'temple';
const PLACEABLE = new Set(['sacred_grove', 'glen', 'grass', 'dirt']);

function tileHasBuilding(ctx: BrushContext, x: number, y: number): boolean {
  return ctx.world.query({ region: { x, y, w: 1, h: 1 }, tag: 'building' }).length > 0;
}

function canPlace(ctx: BrushContext, x: number, y: number, region: Region): boolean {
  if (x < region.x || x >= region.x + region.w) return false;
  if (y < region.y || y >= region.y + region.h) return false;
  const tile = ctx.tiles.tiles[y]?.[x];
  if (!tile || !PLACEABLE.has(tile.type)) return false;
  return !tileHasBuilding(ctx, x, y);
}

export function templeBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  const cx = Math.floor(region.x + region.w / 2);
  const cy = Math.floor(region.y + region.h / 2);
  const reserved = new Set<string>();

  if (canPlace(ctx, cx, cy, region)) {
    out.push(defaultEntity(BRUSH, 'altar', cx + 0.5, cy + 0.5));
    reserved.add(`${cx},${cy}`);
  }

  const offsets: ReadonlyArray<readonly [number, number]> = [[0, -2], [0, 2], [-2, 0], [2, 0]];
  for (const [dx, dy] of offsets) {
    const sx = cx + dx, sy = cy + dy;
    if (canPlace(ctx, sx, sy, region)) {
      out.push(defaultEntity(BRUSH, 'statue', sx + 0.5, sy + 0.5));
      reserved.add(`${sx},${sy}`);
    }
  }

  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      if (reserved.has(`${x},${y}`)) continue;
      if (!canPlace(ctx, x, y, region)) continue;
      if (noise(x, y, seed) < 0.20) {
        out.push(defaultEntity(BRUSH, 'flower_patch', x + 0.5, y + 0.5, {}, ['sacred']));
      }
    }
  }

  return out;
}

registerBrush(BRUSH, templeBrush);
