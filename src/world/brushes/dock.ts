import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext, GameMap } from '@/core/types';

const BRUSH = 'dock';
const PLACEABLE = new Set(['sand', 'dirt', 'dirt_road', 'bridge']);
const WATER = new Set(['shallow_water', 'deep_water', 'ocean', 'river']);

function tileHasBuilding(ctx: BrushContext, x: number, y: number): boolean {
  return ctx.world.query({ region: { x, y, w: 1, h: 1 }, tag: 'building' }).length > 0;
}

function nearWater(tiles: GameMap, x: number, y: number): boolean {
  const offsets: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of offsets) {
    const t = tiles.tiles[y + dy]?.[x + dx];
    if (t && WATER.has(t.type)) return true;
  }
  return false;
}

export function dockBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  const cx = Math.floor(region.x + region.w / 2);
  const cy = Math.floor(region.y + region.h / 2);
  const centerTile = ctx.tiles.tiles[cy]?.[cx];
  const anchorPlaced = !!(centerTile && PLACEABLE.has(centerTile.type) && !tileHasBuilding(ctx, cx, cy));
  if (anchorPlaced) {
    out.push(defaultEntity(BRUSH, 'anchor', cx + 0.5, cy + 0.5));
  }

  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      if (x === cx && y === cy && anchorPlaced) continue;
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !PLACEABLE.has(tile.type)) continue;
      if (tileHasBuilding(ctx, x, y)) continue;

      const r = noise(x, y, seed);
      if (r < 0.10) out.push(defaultEntity(BRUSH, 'crate', x + 0.5, y + 0.5));
      else if (r < 0.15) out.push(defaultEntity(BRUSH, 'rope_coil', x + 0.5, y + 0.5));
      else if (r < 0.20) out.push(defaultEntity(BRUSH, 'barrel', x + 0.5, y + 0.5));
      else if (nearWater(ctx.tiles, x, y) && noise(x, y, seed + 50) < 0.30) {
        out.push(defaultEntity(BRUSH, 'nets', x + 0.5, y + 0.5));
      }
    }
  }

  return out;
}

registerBrush(BRUSH, dockBrush);
