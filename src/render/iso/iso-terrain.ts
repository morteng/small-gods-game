import type { GameMap, DevModeState } from '@/core/types';
import { TILE_COLORS } from '@/core/constants';
import { worldToScreen } from './iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import type { TileBounds } from './iso-projection';
import { effectiveTileType } from '@/render/layer-visibility';

export interface IsoTerrainArgs {
  map: GameMap;
  bounds: TileBounds;
  originX: number;
  originY: number;
  devMode?: DevModeState;
}

export function drawIsoTerrain(ctx: CanvasRenderingContext2D, args: IsoTerrainArgs): void {
  const { map, bounds, originX, originY, devMode } = args;
  const iMin = bounds.minTx + bounds.minTy;
  const iMax = bounds.maxTx + bounds.maxTy;
  for (let i = iMin; i <= iMax; i++) {
    const txLo = Math.max(bounds.minTx, i - bounds.maxTy);
    const txHi = Math.min(bounds.maxTx, i - bounds.minTy);
    for (let tx = txLo; tx <= txHi; tx++) {
      const ty = i - tx;
      const tile = map.tiles[ty]?.[tx];
      if (!tile) continue;
      const { sx, sy } = worldToScreen(tx, ty, 0, originX, originY);
      ctx.fillStyle = TILE_COLORS[effectiveTileType(tile.type, devMode)] ?? '#444';
      ctx.beginPath();
      ctx.moveTo(sx, sy - ISO_TILE_H / 2);
      ctx.lineTo(sx + ISO_TILE_W / 2, sy);
      ctx.lineTo(sx, sy + ISO_TILE_H / 2);
      ctx.lineTo(sx - ISO_TILE_W / 2, sy);
      ctx.closePath();
      ctx.fill();
    }
  }
}
