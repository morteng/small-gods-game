import type { GameMap, Camera } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR } from '@/core/constants';

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  minimapWidth: number,
  minimapHeight: number,
  canvasWidth: number,
  canvasHeight: number
): void {
  const scaleX = minimapWidth / map.width;
  const scaleY = minimapHeight / map.height;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (minimapWidth - map.width * scale) / 2;
  const offsetY = (minimapHeight - map.height * scale) / 2;

  // Background
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, minimapWidth, minimapHeight);

  // Tiles (1 pixel per tile at small scale)
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      ctx.fillStyle = TILE_COLORS[tile.type] || '#333';
      ctx.fillRect(
        offsetX + x * scale,
        offsetY + y * scale,
        Math.max(1, scale),
        Math.max(1, scale)
      );
    }
  }

  // Viewport indicator
  const vpX = offsetX + (camera.x / TILE_SIZE) * scale;
  const vpY = offsetY + (camera.y / TILE_SIZE) * scale;
  const vpW = (canvasWidth / camera.zoom / TILE_SIZE) * scale;
  const vpH = (canvasHeight / camera.zoom / TILE_SIZE) * scale;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
}
