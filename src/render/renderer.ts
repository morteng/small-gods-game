import type { GameMap, Camera, NpcInstance } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS } from '@/core/constants';
import { getSpriteCoords } from '@/render/npc-animator';

/** Render the map to a canvas context */
export function renderMap(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  npcs: NpcInstance[] = [],
  sheets: Map<string, HTMLCanvasElement> = new Map(),
): void {
  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  // Determine visible tile range
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endX = Math.min(map.width, Math.ceil((camera.x + canvasWidth / camera.zoom) / TILE_SIZE) + 1);
  const endY = Math.min(map.height, Math.ceil((camera.y + canvasHeight / camera.zoom) / TILE_SIZE) + 1);

  // Draw tiles
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      ctx.fillStyle = TILE_COLORS[tile.type] || '#FF00FF';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  // Draw grid lines at high zoom
  if (camera.zoom >= 2) {
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 0.5 / camera.zoom;
    for (let y = startY; y <= endY; y++) {
      ctx.beginPath();
      ctx.moveTo(startX * TILE_SIZE, y * TILE_SIZE);
      ctx.lineTo(endX * TILE_SIZE, y * TILE_SIZE);
      ctx.stroke();
    }
    for (let x = startX; x <= endX; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, startY * TILE_SIZE);
      ctx.lineTo(x * TILE_SIZE, endY * TILE_SIZE);
      ctx.stroke();
    }
  }

  // Draw POI markers
  if (map.worldSeed?.pois) {
    for (const poi of map.worldSeed.pois) {
      if (!poi.position) continue;
      const icon = POI_ICONS[poi.type] || POI_ICONS.village;
      const px = (poi.position.x + 0.5) * TILE_SIZE;
      const py = (poi.position.y + 0.5) * TILE_SIZE;
      const r = TILE_SIZE * 0.8;

      ctx.fillStyle = icon.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      if (icon.shape === 'circle') {
        ctx.arc(px, py, r, 0, Math.PI * 2);
      } else if (icon.shape === 'triangle') {
        ctx.moveTo(px, py - r);
        ctx.lineTo(px - r, py + r * 0.6);
        ctx.lineTo(px + r, py + r * 0.6);
        ctx.closePath();
      } else if (icon.shape === 'square') {
        ctx.rect(px - r * 0.7, py - r * 0.7, r * 1.4, r * 1.4);
      } else { // diamond
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r, py);
        ctx.closePath();
      }
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label
      if (poi.name && camera.zoom >= 0.5) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(poi.name, px, py + r + 10 / camera.zoom);
      }
    }
  }

  // Draw village markers (from WFC generation)
  for (const v of map.villages) {
    if (!v.name) continue;
    const px = (v.x + 0.5) * TILE_SIZE;
    const py = (v.y + 0.5) * TILE_SIZE;
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(v.name, px, py - TILE_SIZE);
  }

  // Draw NPC sprites
  ctx.imageSmoothingEnabled = false;
  const camLeft   = camera.x;
  const camTop    = camera.y;
  const camRight  = camera.x + canvasWidth  / camera.zoom;
  const camBottom = camera.y + canvasHeight / camera.zoom;
  const npcSize   = 32; // 2×2 tiles world-space

  for (const npc of npcs) {
    const sheet = sheets.get(npc.id);
    if (!sheet) continue;

    const screenX = npc.tileX * TILE_SIZE;
    const screenY = npc.tileY * TILE_SIZE;

    // Cull off-screen
    if (screenX + npcSize < camLeft  || screenX > camRight  ||
        screenY + npcSize < camTop   || screenY > camBottom) continue;

    const { sx, sy } = getSpriteCoords(npc);
    ctx.drawImage(sheet, sx, sy, 64, 64, screenX, screenY, npcSize, npcSize);
  }

  ctx.restore();
}
