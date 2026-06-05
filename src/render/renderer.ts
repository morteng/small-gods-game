import type { RenderContext, Entity, GeneratedDecoration, NpcInstance } from '@/core/types';
import { TILE_SIZE, TILE_COLORS, BG_COLOR, POI_ICONS, TILE_SPRITE_MAP, KENNEY_TILE_SIZE } from '@/core/constants';
import { getSpriteCoords } from '@/render/npc-animator';
import { getTerrainSpriteCoords, LPC_TILE_SIZE } from '@/render/terrain-atlas';
import type { BuildingTemplate } from '@/map/building-templates';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import { BUILDING_TEMPLATES } from '@/map/building-templates';
import { isLayerHidden, isEntityHidden } from '@/render/layer-visibility';
import { drawBuildingPlaceholder } from './building-massing';
import { computeGroundMaterialField } from './ground-material';
import { GROUND_COLORS, type BuildingDescriptor } from '@/world/building-descriptor';

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
  drawGroundMaterialOverlay(ctx, rc);
  drawYSortedEntities(ctx, rc);
  drawOverlays(ctx, rc);

  // ── Dev Mode: draw selection highlight ──────────────────
  if (rc.devMode?.enabled && rc.devMode.selected) {
    drawSelectionHighlight(ctx, rc);
  }

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
  if (isLayerHidden('terrain', rc.devMode)) return;
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
      if (tile.state === 'void') continue;

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

// Pass 0b: Building-ordered ground material (derived; translucent overlay).
function drawGroundMaterialOverlay(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  if (isLayerHidden('buildings', rc.devMode)) return;
  const field = computeGroundMaterialField(rc.world);
  if (field.size === 0) return;
  const { camera, canvasWidth, canvasHeight, map } = rc;
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endX = Math.min(map.width, Math.ceil((camera.x + canvasWidth / camera.zoom) / TILE_SIZE) + 1);
  const endY = Math.min(map.height, Math.ceil((camera.y + canvasHeight / camera.zoom) / TILE_SIZE) + 1);

  ctx.globalAlpha = 0.55;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile || tile.state === 'void') continue;
      const mat = field.get(`${x},${y}`);
      if (!mat) continue;
      ctx.fillStyle = GROUND_COLORS[mat] ?? '#8a8a8a';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.globalAlpha = 1;
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
// Pass 1: Y-sorted entities (world entities via world.query, then NPCs)
// =============================================================================

const _templateCache = new Map<string, BuildingTemplate>();
function getBuildingTemplate(id: string): BuildingTemplate | null {
  if (_templateCache.has(id)) return _templateCache.get(id)!;
  const tpl = BUILDING_TEMPLATES.find(t => t.id === id) ?? null;
  if (tpl) _templateCache.set(id, tpl);
  return tpl;
}

function treeSheetForKind(kind: string): string | null {
  switch (kind) {
    case 'oak_tree':    return 'green';
    case 'orange_tree': return 'orange';
    case 'pale_tree':   return 'pale';
    case 'brown_tree':  return 'brown';
    case 'dead_tree':   return 'dead';
    case 'pine_tree':   return 'pale';
    case 'birch_tree':  return 'pale';
    default: return null;
  }
}

function drawTreeSprite(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement, e: Entity): void {
  const SPRITE_SRC = 64;
  const BASE_W = TILE_SIZE * 2;
  const BASE_H = TILE_SIZE * 3;
  const offsetX = (e.properties?.offsetX as number) ?? 0;
  const offsetY = (e.properties?.offsetY as number) ?? 0;
  const tileX = Math.floor(e.x);
  const tileY = Math.floor(e.y);
  
  // Get scale from entity properties (set by brush), fallback to deterministic variation
  const scale = (e.properties?.scale as number) ?? (0.8 + ((tileX * 7 + tileY * 13) % 40) / 100);
  const rotation = (e.properties?.rotation as number) ?? ((tileX * 3 + tileY * 5) % 11) - 5;
  
  const TREE_W = BASE_W * scale;
  const TREE_H = BASE_H * scale;
  
  const worldX = (tileX + offsetX) * TILE_SIZE - TREE_W / 2 + TILE_SIZE / 2;
  const worldY = (tileY + offsetY + 1) * TILE_SIZE - TREE_H;
  const centerX = worldX + TREE_W / 2;
  const centerY = worldY + TREE_H;
  
  // Deterministic sprite column from tile coords
  const spriteCol = Math.abs(((tileX * 13) ^ (tileY * 7))) % 8;
  
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(sheet, spriteCol * SPRITE_SRC, 0, SPRITE_SRC, SPRITE_SRC,
                -TREE_W / 2, -TREE_H, TREE_W, TREE_H);
  ctx.restore();
}

function drawEntityFallback(ctx: CanvasRenderingContext2D, rc: RenderContext, e: Entity): void {
  const def = tryGetEntityKindDef(e.kind);
  const color = def?.sprite.fallbackColor ?? '#FF00FF';
  const shape = def?.sprite.fallbackShape ?? 'square';
  const px = e.x * TILE_SIZE;
  const py = e.y * TILE_SIZE;
  const r = TILE_SIZE * 0.35;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(px, py, r, 0, Math.PI * 2);
  } else if (shape === 'triangle') {
    ctx.moveTo(px, py - r);
    ctx.lineTo(px - r, py + r);
    ctx.lineTo(px + r, py + r);
    ctx.closePath();
  } else {
    ctx.rect(px - r, py - r, r * 2, r * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
  if (rc.camera.zoom >= 1.5 && rc.showLabels !== false) {
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(6, 8 / rc.camera.zoom)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(e.kind, px, py - r - 2);
  }
}

function drawEntity(ctx: CanvasRenderingContext2D, rc: RenderContext, e: Entity): void {
  // 0. Remains: a cheap gray grave marker (rich weathering visuals deferred).
  if (e.kind === 'remains') {
    const px = e.x * TILE_SIZE;
    const py = e.y * TILE_SIZE;
    const w = TILE_SIZE * 0.28;
    const h = TILE_SIZE * 0.42;
    ctx.fillStyle = '#8a8a8a';
    ctx.globalAlpha = 0.85;
    // headstone: a rounded-top slab
    ctx.beginPath();
    ctx.moveTo(px - w / 2, py + h / 2);
    ctx.lineTo(px - w / 2, py - h * 0.2);
    ctx.arc(px, py - h * 0.2, w / 2, Math.PI, 0);
    ctx.lineTo(px + w / 2, py + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // 1. Parametric building — topdown silhouette from the descriptor.
  const descriptor = e.properties?.descriptor as BuildingDescriptor | undefined;
  if (descriptor) {
    drawBuildingPlaceholder(ctx, descriptor, Math.floor(e.x), Math.floor(e.y));
    return;
  }

  // 2. Building sprite path (legacy fallback)
  const templateId = (e.properties?.templateId as string | undefined) ?? e.kind;
  const buildingSprite = rc.buildingSprites.get(templateId);
  if (buildingSprite) {
    const tpl = getBuildingTemplate(templateId);
    if (tpl) {
      const bx = Math.floor(e.x) * TILE_SIZE + tpl.spriteOffset.x;
      const by = Math.floor(e.y) * TILE_SIZE + tpl.spriteOffset.y;
      ctx.drawImage(buildingSprite, 0, 0, tpl.spriteSize.w, tpl.spriteSize.h,
                    bx, by, tpl.spriteSize.w, tpl.spriteSize.h);
      return;
    }
  }

  // 3. Tree sprite path
  const treeSheetName = treeSheetForKind(e.kind);
  if (treeSheetName) {
    const sheet = rc.treeSheets.get(treeSheetName);
    if (sheet) {
      drawTreeSprite(ctx, sheet, e);
      return;
    }
  }

  // 4. Fallback shape
  drawEntityFallback(ctx, rc, e);
}

/**
 * Get the Y-sort value for an entity. Buildings sort at their footprint bottom
 * (y + sortYOffset), trees sort at their tile center + height offset.
 */
export function getEntitySortY(e: Entity): number {
  const def = tryGetEntityKindDef(e.kind);
  if (!def) return e.y;

  // Buildings sort at their footprint's FRONT (south) edge so an NPC standing
  // in front of a building paints on top of it, while one stepping behind it is
  // occluded. `sortYOffset` is the per-template footprint bottom in tile units
  // (see building-templates.ts); fall back to the footprint height, then the
  // kind's yOffsetForSort. Sorting at the bare top (e.y) is wrong: it makes
  // every NPC overlapping the footprint paint over the building.
  if (def.category === 'building') {
    const offset =
      (e.properties?.sortYOffset as number | undefined) ??
      (e.properties?.footprint as { h?: number } | undefined)?.h ??
      def.yOffsetForSort ?? 1;
    return e.y + offset;
  }

  // Trees and other entities use their yOffsetForSort
  // Trees should sort at tile center (e.y + 0.5) so NPCs correctly render
  // in front of them when below, and behind when above
  return e.y + (def.yOffsetForSort ?? 0);
}

function drawNpc(ctx: CanvasRenderingContext2D, rc: RenderContext, npc: NpcInstance): void {
  const sheet = rc.npcSheets.get(npc.id);
  if (!sheet) return;
  const npcSize = TILE_SIZE;
  const { sx, sy } = getSpriteCoords(npc);
  ctx.drawImage(sheet, sx, sy, 64, 64, npc.tileX * TILE_SIZE, npc.tileY * TILE_SIZE, npcSize, npcSize);
}

/**
 * Player-placed decoration. Drawn at its full TILE_SIZE×TILE_SIZE footprint
 * via the cached `<img>`; falls back to a yellow square while the blob is
 * still loading from IndexedDB.
 */
function drawDecoration(ctx: CanvasRenderingContext2D, rc: RenderContext, d: GeneratedDecoration): void {
  const px = d.tileX * TILE_SIZE;
  const py = d.tileY * TILE_SIZE;
  const img = rc.resolveDecorationImage?.(d.assetId) ?? null;
  if (img) {
    ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
    return;
  }
  // Placeholder until the image is ready.
  ctx.fillStyle = 'rgba(255, 213, 79, 0.55)';
  ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  ctx.strokeStyle = '#FFD54F';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(px + 2.5, py + 2.5, TILE_SIZE - 5, TILE_SIZE - 5);
}

type SortedItem =
  | { sortY: number; kind: 'entity'; entity: Entity }
  | { sortY: number; kind: 'decoration'; placement: GeneratedDecoration }
  | { sortY: number; kind: 'npc'; npc: NpcInstance };

function drawYSortedEntities(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { camera, canvasWidth, canvasHeight, world } = rc;
  const camLeft   = camera.x / TILE_SIZE;
  const camTop    = camera.y / TILE_SIZE;
  const camRight  = (camera.x + canvasWidth  / camera.zoom) / TILE_SIZE;
  const camBottom = (camera.y + canvasHeight / camera.zoom) / TILE_SIZE;

  const region = {
    x: Math.max(0, Math.floor(camLeft) - 1),
    y: Math.max(0, Math.floor(camTop) - 1),
    w: Math.ceil(camRight - camLeft) + 2,
    h: Math.ceil(camBottom - camTop) + 2,
  };
  const entities = world.query({ region });

  const items: SortedItem[] = entities.map(e => {
    return { sortY: getEntitySortY(e), kind: 'entity' as const, entity: e };
  });

  // Decorations interleave with entities via y-sort. Sort key = tile bottom
  // (tileY + 1) so a decoration on tile (x, 5) sorts behind a tree at y≈6.
  for (const d of rc.generatedDecorations ?? []) {
    if (d.tileX + 1 < camLeft || d.tileX > camRight ||
        d.tileY + 1 < camTop  || d.tileY > camBottom) continue;
    items.push({ sortY: d.tileY + 1, kind: 'decoration', placement: d });
  }

  // Add NPCs to the sorted items list for proper Y-sorting with buildings
  for (const npc of rc.npcs) {
    const underTile = rc.map.tiles[Math.floor(npc.tileY)]?.[Math.floor(npc.tileX)];
    if (underTile?.state === 'void') continue;
    // NPCs sort at tileY + 1 (bottom of their tile) for proper Y-sorting
    items.push({ sortY: npc.tileY + 1, kind: 'npc', npc });
  }

  items.sort((a, b) => a.sortY - b.sortY);

  const hideDecorations = isLayerHidden('decorations', rc.devMode);
  const hideNpcs = isLayerHidden('npcs', rc.devMode);
  ctx.imageSmoothingEnabled = false;
  for (const item of items) {
    if (item.kind === 'entity') {
      const e = item.entity;
      const underTile = rc.map.tiles[Math.floor(e.y)]?.[Math.floor(e.x)];
      if (underTile?.state === 'void') continue;
      if (isEntityHidden(e, rc.devMode)) continue;
      drawEntity(ctx, rc, e);
    } else if (item.kind === 'decoration') {
      if (hideDecorations) continue;
      const d = item.placement;
      const underTile = rc.map.tiles[Math.floor(d.tileY)]?.[Math.floor(d.tileX)];
      if (underTile?.state === 'void') continue;
      drawDecoration(ctx, rc, d);
    } else {
      // item.kind === 'npc'
      if (hideNpcs) continue;
      drawNpc(ctx, rc, item.npc);
    }
  }
}

// =============================================================================
// Pass 2: UI overlays (POI markers)
// =============================================================================

function drawOverlays(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const { map, camera } = rc;

  if (!map.worldSeed?.pois) return;
  const showMarkers = rc.showPoiMarkers !== false;
  const showLabels = rc.showLabels !== false;
  if (!showMarkers && !showLabels) return;

  for (const poi of map.worldSeed.pois) {
    if (!poi.position) continue;
    const icon = POI_ICONS[poi.type] || POI_ICONS.village;
    const px = (poi.position.x + 0.5) * TILE_SIZE;
    const py = (poi.position.y + 0.5) * TILE_SIZE;
    const r = TILE_SIZE * 0.8;

    if (showMarkers) {
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
    }

    if (showLabels && poi.name && camera.zoom >= 0.5) {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, 10 / camera.zoom)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(poi.name, px, py + r + 10 / camera.zoom);
    }
  }
}

// =============================================================================
// Dev Mode — Selection Highlight
// =============================================================================

function drawSelectionHighlight(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const hit = rc.devMode!.selected;
  if (!hit || hit.type === null) return;

  ctx.save();
  ctx.strokeStyle = '#FFD700';
  ctx.lineWidth = 2 / rc.camera.zoom;
  ctx.setLineDash([4 / rc.camera.zoom, 4 / rc.camera.zoom]);

  const TILE = TILE_SIZE;

  switch (hit.type) {
    case 'tile': {
      const x = hit.tileX * TILE;
      const y = hit.tileY * TILE;
      ctx.strokeRect(x, y, TILE, TILE);
      break;
    }
    case 'entity': {
      const e = hit.entity!;
      // Draw at entity position
      const x = e.x * TILE;
      const y = e.y * TILE;
      // For buildings, use footprint dimensions if available
      const def = tryGetEntityKindDef(e.kind);
      if (def?.category === 'building') {
        const tpl = getBuildingTemplate((e.properties?.templateId as string) ?? e.kind);
        if (tpl) {
          ctx.strokeRect(x, y, tpl.footprint.w * TILE, tpl.footprint.h * TILE);
          break;
        }
      }
      ctx.strokeRect(x, y, TILE, TILE);
      break;
    }
    case 'npc': {
      const n = hit.npc!;
      const x = n.tileX * TILE;
      const y = n.tileY * TILE;
      ctx.strokeRect(x, y, TILE, TILE);
      break;
    }
    case 'decoration': {
      const d = hit.decoration!;
      const x = d.tileX * TILE;
      const y = d.tileY * TILE;
      ctx.strokeRect(x, y, TILE, TILE);
      break;
    }
  }

  ctx.restore();
}
