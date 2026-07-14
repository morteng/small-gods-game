import { noise } from '@/core/noise';
import { defaultEntity } from '@/world/brush-helpers';
import { registerBrush } from '@/world/brushes';
import { placeGrassCover } from './grassland';
import { canopyOf } from '@/flora/biome-flora';
import type { Entity, Region, BrushContext } from '@/core/types';

const BRUSH = 'sacred_grove';
const TILE_TYPES = new Set(['sacred_grove', 'glen']);
// The grove's canopy species (yew/oak/birch), picked deterministically per cell.
const GROVE_CANOPY = canopyOf('sacred_grove');

export function sacredGroveBrush(region: Region, seed: number, ctx: BrushContext): Entity[] {
  const out: Entity[] = [];
  for (let y = region.y; y < region.y + region.h; y++) {
    for (let x = region.x; x < region.x + region.w; x++) {
      const tile = ctx.tiles.tiles[y]?.[x];
      if (!tile || !TILE_TYPES.has(tile.type)) continue;

      if (noise(x, y, seed) < 0.56) {   // raised 0.45→0.56 (~25%, density pass)
        // Pick a canopy species deterministically from the grove pool.
        const pick = noise(x, y, seed + 1);
        let acc = 0, kind = GROVE_CANOPY[0]?.[0] ?? 'english-oak';
        for (const [id, w] of GROVE_CANOPY) { acc += w; if (pick < acc) { kind = id; break; } }
        const ox = (noise(x, y, seed + 3) - 0.5) * 0.3;
        const oy = (noise(x, y, seed + 4) - 0.5) * 0.3;
        out.push(defaultEntity(BRUSH, kind, x + ox, y + oy, { offsetX: ox, offsetY: oy }, ['sacred']));
      } else if (noise(x, y, seed + 10) < 0.35) {   // raised 0.15→0.35 (density pass): this brush's
        // openUndergrowth equivalent — foxglove filling the non-canopy clearings
        out.push(defaultEntity(BRUSH, 'foxglove', x + 0.5, y + 0.5, {}, ['sacred']));
      } else if (noise(x, y, seed + 20) < 0.01) {
        if (ctx.world.query({ region: { x, y, w: 1, h: 1 } }).length === 0) {
          out.push(defaultEntity(BRUSH, 'standing_stone', x + 0.5, y + 0.5, {}, ['sacred']));
        }
      } else if (noise(x, y, seed + 30) < 0.005) {
        out.push(defaultEntity(BRUSH, 'shrine_stone', x + 0.5, y + 0.5, {}, ['sacred']));
      }
    }
  }
  out.push(...placeGrassCover(region, seed, ctx));
  return out;
}

registerBrush(BRUSH, sacredGroveBrush);
