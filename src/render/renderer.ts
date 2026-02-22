import type { RenderContext } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS, TILE_SPRITE_MAP, KENNEY_TILE_SIZE } from '@/core/constants';
import { getSpriteCoords } from '@/render/npc-animator';
import { getTerrainSpriteCoords, LPC_TILE_SIZE } from '@/render/terrain-atlas';
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
// Procedural road rendering
// =============================================================================

/** Connection mask for each road direction suffix — bits: N=1 E=2 S=4 W=8 */
const ROAD_DIRS: Record<string, number> = {
  ns: 0b0101, ew: 0b1010,
  ne: 0b0011, nw: 0b1001, se: 0b0110, sw: 0b1100,
  end_n: 0b0001, end_e: 0b0010, end_s: 0b0100, end_w: 0b1000,
  t_nes: 0b0111, t_new: 0b1011, t_nsw: 0b1101, t_esw: 0b1110,
  cross: 0b1111,
};

/** Parse road type prefix and direction suffix from a variant string */
function parseRoadVariant(variant: string): { prefix: string; suffix: string } | null {
  if (variant.startsWith('dirt_road_'))  return { prefix: 'dirt_road',  suffix: variant.slice(10) };
  if (variant.startsWith('stone_road_')) return { prefix: 'stone_road', suffix: variant.slice(11) };
  if (variant.startsWith('bridge_'))     return { prefix: 'bridge',     suffix: variant.slice(7)  };
  if (variant.startsWith('road_'))       return { prefix: 'road',       suffix: variant.slice(5)  };
  return null;
}

/** Road fill + edge colors by type */
const ROAD_STYLE: Record<string, { fill: string; edge: string }> = {
  dirt_road:  { fill: '#C4956A', edge: '#9E7B4F' },
  stone_road: { fill: '#A0A0A0', edge: '#787878' },
  road:       { fill: '#A0A0A0', edge: '#787878' },
  bridge:     { fill: '#A08060', edge: '#6B5340' },
};

/**
 * Draw a road tile procedurally. Returns true if variant was a road (handled).
 * Draws a grass/water base, then colored road strips in connected directions.
 */
function drawRoadProcedural(
  ctx: CanvasRenderingContext2D,
  rc: RenderContext,
  variant: string,
  tileType: string,
  px: number, py: number,
): boolean {
  const parsed = parseRoadVariant(variant);
  if (!parsed) return false;

  const mask = ROAD_DIRS[parsed.suffix];
  if (mask === undefined) return false;

  const isBridge = parsed.prefix === 'bridge' || tileType === 'bridge';

  // Draw terrain base underneath the road
  if (isBridge) {
    // Water base for bridges
    ctx.fillStyle = TILE_COLORS['shallow_water'] || '#64B5F6';
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
  } else {
    // Grass base for regular roads — use LPC grass sheet if available
    const grassSheet = rc.terrainSheets.get('grass');
    if (grassSheet) {
      // Blob index 46 = fully interior tile (all 8 neighbors match)
      const { col, row } = getTerrainSpriteCoords(46);
      ctx.drawImage(grassSheet, col * LPC_TILE_SIZE, row * LPC_TILE_SIZE,
                    LPC_TILE_SIZE, LPC_TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
    } else if (rc.tileAtlas) {
      // Kenney grass sprite
      ctx.drawImage(rc.tileAtlas, 0, 0, KENNEY_TILE_SIZE, KENNEY_TILE_SIZE,
                    px, py, TILE_SIZE, TILE_SIZE);
    } else {
      ctx.fillStyle = TILE_COLORS['grass'] || '#66BB6A';
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  // Road geometry: two crossing strips (horizontal + vertical)
  const S = TILE_SIZE;
  const rw = Math.round(S * 0.44); // road width (~14px at 32)
  const m = Math.round((S - rw) / 2); // margin from edge (~9px)
  const b = 1; // border width

  const hasN = !!(mask & 0b0001);
  const hasE = !!(mask & 0b0010);
  const hasS = !!(mask & 0b0100);
  const hasW = !!(mask & 0b1000);

  // Horizontal strip bounds (extends left/right from center)
  const hx0 = hasW ? 0 : m;
  const hx1 = hasE ? S : m + rw;
  // Vertical strip bounds (extends up/down from center)
  const vy0 = hasN ? 0 : m;
  const vy1 = hasS ? S : m + rw;

  const style = ROAD_STYLE[parsed.prefix] || ROAD_STYLE.road;

  // Draw edge (border) — slightly larger
  ctx.fillStyle = style.edge;
  if (hx1 > hx0) ctx.fillRect(px + hx0, py + m - b, hx1 - hx0, rw + 2 * b);
  if (vy1 > vy0) ctx.fillRect(px + m - b, py + vy0, rw + 2 * b, vy1 - vy0);

  // Draw fill
  ctx.fillStyle = style.fill;
  if (hx1 > hx0) ctx.fillRect(px + hx0 + b, py + m, hx1 - hx0 - 2 * b, rw);
  if (vy1 > vy0) ctx.fillRect(px + m, py + vy0 + b, rw, vy1 - vy0 - 2 * b);

  // Fill center square (covers border overlap)
  ctx.fillRect(px + m, py + m, rw, rw);

  // Bridge railings
  if (isBridge) {
    ctx.fillStyle = '#5D4037';
    if (hasN || hasS) {
      // Vertical bridge — railings on left and right
      ctx.fillRect(px + m - 1, py + vy0, 1, vy1 - vy0);
      ctx.fillRect(px + m + rw, py + vy0, 1, vy1 - vy0);
    }
    if (hasE || hasW) {
      // Horizontal bridge — railings on top and bottom
      ctx.fillRect(px + hx0, py + m - 1, hx1 - hx0, 1);
      ctx.fillRect(px + hx0, py + m + rw, hx1 - hx0, 1);
    }
  }

  return true;
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

      // --- LPC terrain sheets (blob autotiled, one PNG per terrain group) ---
      if (rc.blobMap && rc.terrainSheets.size > 0) {
        const blob = rc.blobMap[y]?.[x];
        const sheet = blob ? rc.terrainSheets.get(blob.terrainGroup) : undefined;
        if (blob && sheet) {
          const { col, row } = getTerrainSpriteCoords(blob.blobIndex);
          ctx.drawImage(sheet, col * LPC_TILE_SIZE, row * LPC_TILE_SIZE, LPC_TILE_SIZE, LPC_TILE_SIZE,
                        px, py, TILE_SIZE, TILE_SIZE);
          drawRoadOverlay(ctx, rc, x, y, px, py);
          continue;
        }
      }

      // --- Kenney atlas fallback (roads, rivers use visualMap variants) ---
      const variant = rc.visualMap?.[y]?.[x] ?? tile.type;

      // Road/bridge tiles: draw grass/water base + procedural road overlay
      if (drawRoadProcedural(ctx, rc, variant, tile.type, px, py)) {
        continue;
      }

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
         variant.startsWith('bridge_') || variant.startsWith('dirt_road_') ||
         variant.startsWith('stone_road_');
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

    const sortY = (building.tileY + template.footprint.h) * TILE_SIZE;
    const sprite = rc.buildingSprites.get(building.templateId);

    if (sprite) {
      // LPC sprite: draw at spriteOffset from tile origin, at spriteSize pixels
      const dx = bx + template.spriteOffset.x;
      const dy = by + template.spriteOffset.y;
      const sw = template.spriteSize.w;
      const sh = template.spriteSize.h;
      entities.push({
        sortY,
        draw: (c) => { c.drawImage(sprite, 0, 0, sw, sh, dx, dy, sw, sh); },
      });
    } else {
      // Fallback: colored rectangle with name label
      const color = BUILDING_COLORS[template.category] ?? '#A1887F';
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
