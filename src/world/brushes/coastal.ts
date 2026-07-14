// Coastal strand cover — driftwood + shells on the sand, MARRAM GRASS binding the
// foredune at the waterline, and gorse only on the dune BACK-slope (the inland side,
// away from the water). Marram is the dune-builder that actually fringes a beach; the
// old placement put gorse right at the tideline (there was no dune-grass species yet).
// Uses the decorrelated hash01 (not the correlated `noise()` LCG step) so the scatter
// doesn't tile.
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import type { Entity, Region, BrushContext, GameMap } from '@/core/types';

const BRUSH = 'coastal';
const WATER = new Set(['shallow_water', 'deep_water', 'ocean', 'river']);

/** Decorrelated [0,1) hash — same mix the vegetation placer uses. */
function hash01(x: number, y: number, key: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(key | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function nearWater(tiles: GameMap, x: number, y: number): boolean {
  const offsets: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of offsets) {
    const t = tiles.tiles[y + dy]?.[x + dx];
    if (t && WATER.has(t.type)) return true;
  }
  return false;
}

function place(out: Entity[], kind: string, x: number, y: number, s: number, scaleLo = 0.85, scaleHi = 1.15): void {
  const fx = 0.5 + (hash01(x, y, s + 3) - 0.5) * 0.9;
  const fy = 0.5 + (hash01(x, y, s + 4) - 0.5) * 0.9;
  out.push(defaultEntity(BRUSH, kind, x + fx, y + fy, {
    offsetX: fx, offsetY: fy, scale: scaleLo + hash01(x, y, s + 5) * (scaleHi - scaleLo),
  }));
}

export function coastalBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile) continue;
      if (tile.type !== 'sand' && tile.type !== 'beach') continue;
      const s = seed + (y * ctx.tiles.width + x) * 5;
      const wet = nearWater(ctx.tiles, x, y);

      if (hash01(x, y, s) < 0.05) {
        place(out, 'driftwood', x, y, s + 10, 1, 1);
      } else if (hash01(x, y, s + 1) < 0.10) {
        place(out, 'shell', x, y, s + 20, 1, 1);
      } else if (wet && hash01(x, y, s + 2) < 0.38) {
        // Marram grass binds the foredune right at the waterline.
        place(out, 'marram-grass', x, y, s + 30, 0.8, 1.25);
      } else if (!wet && hash01(x, y, s + 6) < 0.16) {
        // Gorse holds the dune BACK-slope (inland, away from the water).
        place(out, 'gorse', x, y, s + 40);
      }
    }
  }
  return out;
}

registerBrush(BRUSH, coastalBrush);
