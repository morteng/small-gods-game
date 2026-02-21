import type { RenderContext } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS, TILE_SPRITE_MAP, KENNEY_TILE_SIZE } from '@/core/constants';
import { getSpriteCoords } from '@/render/npc-animator';
import { getTerrainAtlasCoords } from '@/render/terrain-atlas';
import type { BuildingTemplate } from '@/map/building-templates';
import { BUILDING_TEMPLATES } from '@/map/building-templates';

/** Render the map to a canvas context */
export function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { camera, canvasWidth, canvasHeight } = rc;

  // Clear
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  drawTerrain(ctx, rc);
  drawYSortedEntities(ctx, rc);
  drawOverlays(ctx, rc);

  ctx.restore();
}

// =============================================================================
// Pass 0: Terrain ground (blob-autotiled LPC or TILE_COLORS fallback)
// =============================================================================

function drawTerrain(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { map, camera, canvasWidth, canvasHeight } = rc;

  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endX = Math.min(map.width, Math.ceil((camera.x + canvasWidth / camera.zoom) / TILE_SIZE) + 1);
  const endY = Math.min(map.height, Math.ceil((camera.y + canvasHeight / camera.zoom) / TILE_SIZE) + 1);

  ctx.imageSmoothingEnabled = false;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      // --- LPC terrain atlas (blob autotiled) ---
      if (rc.blobMap && rc.terrainAtlas) {
        const blob = rc.blobMap[y]?.[x];
        if (blob) {
          const coords = getTerrainAtlasCoords(blob.terrainGroup, blob.blobIndex);
          if (coords) {
            ctx.drawImage(rc.terrainAtlas, coords.sx, coords.sy, coords.sw, coords.sh, px, py, TILE_SIZE, TILE_SIZE);
            drawRoadOverlay(ctx, rc, x, y, px, py);
            continue;
          }
        }
      }

      // --- Kenney atlas fallback (roads, rivers use visualMap variants) ---
      const variant = rc.visualMap?.[y]?.[x] ?? tile.type;
      const spriteCoord = TILE_SPRITE_MAP[variant];
      if (spriteCoord && rc.tileAtlas) {
        ctx.drawImage(
          rc.tileAtlas,
          spriteCoord.col * KENNEY_TILE_SIZE, spriteCoord.row * KENNEY_TILE_SIZE,
          KENNEY_TILE_SIZE, KENNEY_TILE_SIZE,
          px, py, TILE_SIZE, TILE_SIZE,
        );
      } else {
        ctx.fillStyle = TILE_COLORS[tile.type] || '#FF00FF';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
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
}

/**
 * Draw road/river sprite overlay on top of LPC terrain tile.
 * When the LPC terrain atlas is in use, roads and rivers are drawn as overlays.
 */
function drawRoadOverlay(
  ctx: CanvasRenderingContext2D,
  rc: RenderContext,
  x: number,
  y: number,
  px: number,
  py: number,
): void {
  if (!rc.visualMap || !rc.tileAtlas) return;
  const variant = rc.visualMap[y]?.[x];
  if (!variant || !isPathVariant(variant)) return;
  const spriteCoord = TILE_SPRITE_MAP[variant];
  if (!spriteCoord) return;
  ctx.drawImage(
    rc.tileAtlas,
    spriteCoord.col * KENNEY_TILE_SIZE, spriteCoord.row * KENNEY_TILE_SIZE,
    KENNEY_TILE_SIZE, KENNEY_TILE_SIZE,
    px, py, TILE_SIZE, TILE_SIZE,
  );
}

function isPathVariant(variant: string): boolean {
  return variant.startsWith('road_') || variant.startsWith('river_') ||
         variant.startsWith('bridge_') || variant.startsWith('dirt_road_');
}

// =============================================================================
// Pass 1: Y-sorted entities (trees, buildings, NPCs)
// =============================================================================

interface YSortable {
  sortY: number;
  draw(ctx: CanvasRenderingContext2D): void;
}

const _templateCache = new Map<string, BuildingTemplate>();
function getBuildingTemplate(id: string): BuildingTemplate | null {
  if (_templateCache.has(id)) return _templateCache.get(id)!;
  const tpl = BUILDING_TEMPLATES.find(t => t.id === id) ?? null;
  if (tpl) _templateCache.set(id, tpl);
  return tpl;
}

const BUILDING_COLORS: Record<string, string> = {
  residential: '#C4956A',
  religious:   '#CE93D8',
  commercial:  '#FFB74D',
  military:    '#78909C',
  farm:        '#AED581',
  special:     '#80DEEA',
};

function drawYSortedEntities(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { map, camera, canvasWidth, canvasHeight } = rc;
  const camLeft   = camera.x;
  const camTop    = camera.y;
  const camRight  = camera.x + canvasWidth  / camera.zoom;
  const camBottom = camera.y + canvasHeight / camera.zoom;

  const entities: YSortable[] = [];

  // Trees
  if (rc.treeSheets.size > 0) {
    const SPRITE_SRC = 64;
    const TREE_W = TILE_SIZE * 2;
    const TREE_H = TILE_SIZE * 3;

    for (const deco of rc.decorations) {
      if (deco.category !== 'tree') continue;
      const sheet = rc.treeSheets.get(deco.variant);
      if (!sheet) continue;
      const worldX = (deco.tileX + deco.offsetX) * TILE_SIZE - TREE_W / 2 + TILE_SIZE / 2;
      const worldY = (deco.tileY + deco.offsetY + 1) * TILE_SIZE - TREE_H;
      if (worldX + TREE_W < camLeft || worldX > camRight ||
          worldY + TREE_H < camTop  || worldY > camBottom) continue;

      const sortY = (deco.tileY + 1) * TILE_SIZE;
      // capture loop vars
      const wx = worldX; const wy = worldY;
      const sc = deco.spriteCol; const sr = deco.spriteRow;
      const sh = sheet;
      entities.push({
        sortY,
        draw: (c) => {
          c.drawImage(sh, sc * SPRITE_SRC, sr * SPRITE_SRC, SPRITE_SRC, SPRITE_SRC, wx, wy, TREE_W, TREE_H);
        },
      });
    }
  }

  // Buildings
  for (const building of (map.buildings ?? [])) {
    const template = getBuildingTemplate(building.templateId);
    if (!template) continue;
    const bx = building.tileX * TILE_SIZE;
    const by = building.tileY * TILE_SIZE;
    const bw = template.footprint.w * TILE_SIZE;
    const bh = template.footprint.h * TILE_SIZE;
    if (bx + bw < camLeft || bx > camRight || by + bh < camTop || by > camBottom) continue;

    const color = BUILDING_COLORS[template.category] ?? '#A1887F';
    const sortY = (building.tileY + template.footprint.h) * TILE_SIZE;
    const name = template.name;
    const zoom = camera.zoom;
    entities.push({
      sortY,
      draw: (c) => {
        c.fillStyle = color;
        c.fillRect(bx, by, bw, bh);
        c.strokeStyle = 'rgba(0,0,0,0.4)';
        c.lineWidth = 1;
        c.strokeRect(bx, by, bw, bh);
        if (zoom >= 0.5) {
          c.fillStyle = '#fff';
          c.font = `${Math.max(6, 9 / zoom)}px sans-serif`;
          c.textAlign = 'center';
          c.fillText(name, bx + bw / 2, by + bh / 2 + 3);
        }
      },
    });
  }

  // NPCs
  const npcSize = TILE_SIZE; // 1×1 tile at LPC natural size (32×32)

  for (const npc of rc.npcs) {
    const sheet = rc.npcSheets.get(npc.id);
    if (!sheet) continue;
    const screenX = npc.tileX * TILE_SIZE;
    const screenY = npc.tileY * TILE_SIZE;
    if (screenX + npcSize < camLeft || screenX > camRight ||
        screenY + npcSize < camTop  || screenY > camBottom) continue;

    const { sx, sy } = getSpriteCoords(npc);
    const sortY = (npc.tileY + 1) * TILE_SIZE;
    const npcSheet = sheet;
    const nsx = sx; const nsy = sy;
    const nscX = screenX; const nscY = screenY;
    entities.push({
      sortY,
      draw: (c) => {
        c.drawImage(npcSheet, nsx, nsy, 64, 64, nscX, nscY, npcSize, npcSize);
      },
    });
  }

  // Sort by sortY ascending (entities with lower feet drawn first = behind)
  entities.sort((a, b) => a.sortY - b.sortY);
  ctx.imageSmoothingEnabled = false;
  for (const e of entities) e.draw(ctx);
}

// =============================================================================
// Pass 2: UI overlays (POI markers)
// =============================================================================

function drawOverlays(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { map, camera } = rc;

  if (!map.worldSeed?.pois) return;

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

    if (poi.name && camera.zoom >= 0.5) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(poi.name, px, py + r + 10 / camera.zoom);
    }
  }
}
