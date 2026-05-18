import type { GameMap } from '@/core/types';
import type { BlobTile } from '@/map/blob-autotiler';
import { TILE_COLORS } from '@/core/constants';
import { worldToScreen } from './iso-projection';
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import type { IsoAtlas } from './iso-atlas';
import type { TileBounds } from './iso-projection';

export interface IsoTerrainArgs {
  map: GameMap;
  atlas: IsoAtlas;
  blobMap: BlobTile[][] | null;
  bounds: TileBounds;
  originX: number;
  originY: number;
}

export function drawIsoTerrain(ctx: CanvasRenderingContext2D, args: IsoTerrainArgs): void {
  const { map, atlas, blobMap, bounds, originX, originY } = args;
  const iMin = bounds.minTx + bounds.minTy;
  const iMax = bounds.maxTx + bounds.maxTy;
  for (let i = iMin; i <= iMax; i++) {
    const txLo = Math.max(bounds.minTx, i - bounds.maxTy);
    const txHi = Math.min(bounds.maxTx, i - bounds.minTy);
    for (let tx = txLo; tx <= txHi; tx++) {
      const ty = i - tx;
      const tile = map.tiles[ty]?.[tx];
      if (!tile) continue;
      const blob = blobMap?.[ty]?.[tx];
      const group = blob?.terrainGroup ?? tile.type;
      const variant = blob?.blobIndex ?? 0;
      const sprite = atlas.getTerrain(group, variant);
      const { sx, sy } = worldToScreen(tx, ty, 0, originX, originY);
      if (sprite) {
        ctx.drawImage(sprite.img, sprite.sx, sprite.sy, sprite.sw, sprite.sh,
                      sx - ISO_TILE_W / 2, sy - ISO_TILE_H / 2, ISO_TILE_W, ISO_TILE_H);
      } else {
        ctx.fillStyle = TILE_COLORS[tile.type] ?? '#444';
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
}
