import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext, GameMap } from '@/core/types';

const BRUSH = 'coastal';
const WATER = new Set(['shallow_water', 'deep_water', 'ocean', 'river']);

function nearWater(tiles: GameMap, x: number, y: number): boolean {
  const offsets: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of offsets) {
    const t = tiles.tiles[y + dy]?.[x + dx];
    if (t && WATER.has(t.type)) return true;
  }
  return false;
}

export function coastalBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile) continue;
      if (tile.type !== 'sand' && tile.type !== 'beach') continue;

      if (noise(x, y, seed) < 0.05) {
        out.push(defaultEntity(BRUSH, 'driftwood', x + 0.5, y + 0.5));
      } else if (noise(x, y, seed + 1) < 0.10) {
        out.push(defaultEntity(BRUSH, 'shell', x + 0.5, y + 0.5));
      } else if (nearWater(ctx.tiles, x, y) && noise(x, y, seed + 2) < 0.30) {
        // Gorse — the DB's coastal shrub — fringes the waterline (no reed species yet).
        out.push(defaultEntity(BRUSH, 'gorse', x + 0.5, y + 0.5));
      }
    }
  }
  return out;
}

registerBrush(BRUSH, coastalBrush);
