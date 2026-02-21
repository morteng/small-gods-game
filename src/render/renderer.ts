import type { RenderContext } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS, TILE_SPRITE_MAP, KENNEY_TILE_SIZE } from '@/core/constants';
import { getSpriteCoords } from '@/render/npc-animator';

/** Render the map to a canvas context */
export function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { map, camera, canvasWidth, canvasHeight, npcs, npcSheets } = rc;

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

  // Draw tiles — sprites where available, TILE_COLORS fallback
  ctx.imageSmoothingEnabled = false;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;
      const variant = rc.visualMap?.[y]?.[x] ?? tile.type;
      const spriteCoord = TILE_SPRITE_MAP[variant];
      if (spriteCoord && rc.tileAtlas) {
        ctx.drawImage(
          rc.tileAtlas,
          spriteCoord.col * KENNEY_TILE_SIZE, spriteCoord.row * KENNEY_TILE_SIZE,
          KENNEY_TILE_SIZE, KENNEY_TILE_SIZE,
          x * TILE_SIZE, y * TILE_SIZE,
          TILE_SIZE, TILE_SIZE,
        );
      } else {
        ctx.fillStyle = TILE_COLORS[tile.type] || '#FF00FF';
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
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

  // Draw tree decorations — after tiles, before POI markers and NPCs
  // Tree sprite: 64×64 px source, drawn at 64×96 world-px (2w × 3h tiles), base anchored at tile bottom
  if (rc.treeSheets.size > 0) {
    const SPRITE_SRC = 64;          // source sprite size in the LPC sheet
    const TREE_W = TILE_SIZE * 2;   // 32px wide = 2 tiles
    const TREE_H = TILE_SIZE * 3;   // 48px tall = 3 tiles (3/4 oblique — taller than wide)
    const camLeft   = camera.x;
    const camTop    = camera.y;
    const camRight  = camera.x + canvasWidth  / camera.zoom;
    const camBottom = camera.y + canvasHeight / camera.zoom;

    for (const deco of rc.decorations) {
      const sheet = rc.treeSheets.get(deco.variant);
      if (!sheet) continue;
      const worldX = (deco.tileX + deco.offsetX) * TILE_SIZE - TREE_W / 2 + TILE_SIZE / 2;
      const worldY = (deco.tileY + deco.offsetY + 1) * TILE_SIZE - TREE_H; // base at tile bottom
      // Cull off-screen
      if (worldX + TREE_W < camLeft || worldX > camRight  ||
          worldY + TREE_H < camTop  || worldY > camBottom) continue;
      ctx.drawImage(
        sheet,
        deco.spriteCol * SPRITE_SRC, deco.spriteRow * SPRITE_SRC, SPRITE_SRC, SPRITE_SRC,
        worldX, worldY, TREE_W, TREE_H,
      );
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

  // Draw NPC sprites
  ctx.imageSmoothingEnabled = false;
  const camLeft   = camera.x;
  const camTop    = camera.y;
  const camRight  = camera.x + canvasWidth  / camera.zoom;
  const camBottom = camera.y + canvasHeight / camera.zoom;
  const npcSize   = 32; // 2×2 tiles world-space

  for (const npc of npcs) {
    const sheet = npcSheets.get(npc.id);
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
