import type { Camera, BiomeMap, POI } from '@/core/types';
import type { RenderMode } from './select-renderer';
import { worldToScreen as topdownWorldToScreen } from './camera';
import { isoTileCenter, drawOutlineRect } from './selection-outline';
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';
import { TILE_SIZE } from '@/core/constants';
import { POI_ZONE_RULES } from '@/map/poi-zones';

/**
 * Map info overlays: a POI layer (zones-of-influence + labels) and a biome layer
 * (translucent fills, organic outlines, soft blend bands at borders). Both are
 * rendering-only — they never touch terrain tiles or the sim — and draw in raw
 * screen space (camera + zoom applied manually), like the selection outline.
 */

/** One accent per biome enum value; oceans are skipped (handled by water render). */
export const BIOME_COLORS: Record<string, string> = {
  beach: '#e8d9a0',
  mountain: '#9aa0a6',
  peak: '#d7dadb',
  ice: '#dff0f5',
  tundra: '#b9c4b0',
  boreal_forest: '#4f7a52',
  temperate_grassland: '#9ccb6a',
  temperate_forest: '#3f8f4f',
  scrubland: '#bcae6e',
  tropical_grassland: '#b6d36a',
  savanna: '#cdb867',
  tropical_forest: '#2f9e64',
  desert: '#e3c478',
  swamp: '#6a7b53',
  sacred_grove: '#7fe0a8',
};

const SKIP_BIOMES = new Set(['deep_ocean', 'ocean']);

function biomeColor(b: string): string { return BIOME_COLORS[b] ?? '#888888'; }

const ISO_HALF_W = ISO_TILE_W / 2;
const ISO_HALF_H = ISO_TILE_H / 2;

interface TileBounds { minTx: number; maxTx: number; minTy: number; maxTy: number; }

function visibleBounds(
  camera: Camera, mapW: number, mapH: number, viewW: number, viewH: number, mode: RenderMode,
): TileBounds {
  if (mode === 'iso') {
    // Iso visible-bounds inversion is fiddly; maps are small enough to iterate
    // the full extent. (A tighter cull can come with the RenderViewModel seam.)
    void camera; void viewW; void viewH;
    return { minTx: 0, maxTx: mapW - 1, minTy: 0, maxTy: mapH - 1 };
  }
  const minTx = Math.max(0, Math.floor(camera.x / TILE_SIZE));
  const minTy = Math.max(0, Math.floor(camera.y / TILE_SIZE));
  const maxTx = Math.min(mapW - 1, Math.ceil((camera.x + viewW / camera.zoom) / TILE_SIZE));
  const maxTy = Math.min(mapH - 1, Math.ceil((camera.y + viewH / camera.zoom) / TILE_SIZE));
  return { minTx, maxTx, minTy, maxTy };
}

/** Average two #rrggbb colors → #rrggbb (for blend bands at biome borders). */
function blend(a: string, b: string): string {
  const pa = parseHex(a), pb = parseHex(b);
  const m = (i: number) => Math.round((pa[i] + pb[i]) / 2).toString(16).padStart(2, '0');
  return `#${m(0)}${m(1)}${m(2)}`;
}
function parseHex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** Fill one tile cell (diamond in iso, square in topdown) at the given alpha. */
function fillCell(ctx: CanvasRenderingContext2D, tx: number, ty: number, camera: Camera, mode: RenderMode, color: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  if (mode === 'iso') {
    const { sx, sy } = isoTileCenter(tx, ty, camera);
    const hw = ISO_HALF_W * camera.zoom, hh = ISO_HALF_H * camera.zoom;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
    ctx.fill();
  } else {
    const { sx, sy } = topdownWorldToScreen(camera, tx, ty, TILE_SIZE);
    ctx.fillRect(sx, sy, TILE_SIZE * camera.zoom, TILE_SIZE * camera.zoom);
  }
  ctx.restore();
}

/** Stroke the shared edge between a cell and its differing neighbour (dx,dy ∈ {±1,0}). */
function strokeEdge(ctx: CanvasRenderingContext2D, tx: number, ty: number, dx: number, dy: number, camera: Camera, mode: RenderMode): void {
  if (mode === 'iso') {
    const { sx, sy } = isoTileCenter(tx, ty, camera);
    const hw = ISO_HALF_W * camera.zoom, hh = ISO_HALF_H * camera.zoom;
    const top = [sx, sy - hh], right = [sx + hw, sy], bottom = [sx, sy + hh], left = [sx - hw, sy];
    let a = top, b = right;
    if (dx === 1) { a = right; b = bottom; }       // neighbour down-right
    else if (dy === 1) { a = bottom; b = left; }    // down-left
    else if (dx === -1) { a = left; b = top; }      // up-left
    else if (dy === -1) { a = top; b = right; }     // up-right
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  } else {
    const { sx, sy } = topdownWorldToScreen(camera, tx, ty, TILE_SIZE);
    const s = TILE_SIZE * camera.zoom;
    ctx.beginPath();
    if (dx === 1) { ctx.moveTo(sx + s, sy); ctx.lineTo(sx + s, sy + s); }
    else if (dx === -1) { ctx.moveTo(sx, sy); ctx.lineTo(sx, sy + s); }
    else if (dy === 1) { ctx.moveTo(sx, sy + s); ctx.lineTo(sx + s, sy + s); }
    else if (dy === -1) { ctx.moveTo(sx, sy); ctx.lineTo(sx + s, sy); }
    ctx.stroke();
  }
}

const NEIGHBOURS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function drawBiomeLayer(
  ctx: CanvasRenderingContext2D,
  biomeMap: BiomeMap | null,
  camera: Camera,
  mode: RenderMode,
  viewW: number,
  viewH: number,
): void {
  if (!biomeMap) return;
  const { biomes, width, height } = biomeMap;
  const b = visibleBounds(camera, width, height, viewW, viewH, mode);

  for (let ty = b.minTy; ty <= b.maxTy; ty++) {
    for (let tx = b.minTx; tx <= b.maxTx; tx++) {
      const biome = biomes[ty * width + tx];
      if (!biome || SKIP_BIOMES.has(biome)) continue;
      const color = biomeColor(biome);
      fillCell(ctx, tx, ty, camera, mode, color, 0.16);

      // Border treatment: for each differing neighbour, soft blend band + outline.
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = tx + dx, ny = ty + dy;
        const nb = (nx >= 0 && ny >= 0 && nx < width && ny < height) ? biomes[ny * width + nx] : null;
        if (nb === biome) continue;            // same biome → interior, no border
        if (nb && SKIP_BIOMES.has(nb)) continue; // coastline handled by water render
        if (nb) fillCell(ctx, tx, ty, camera, mode, blend(color, biomeColor(nb)), 0.16); // blend band
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        strokeEdge(ctx, tx, ty, dx, dy, camera, mode);
        ctx.restore();
      }
    }
  }
}

export function drawPoiLayer(
  ctx: CanvasRenderingContext2D,
  pois: POI[] | null | undefined,
  camera: Camera,
  mode: RenderMode,
): void {
  if (!pois?.length) return;
  const GOLD = '#ffd24a';

  for (const poi of pois) {
    if (poi.region) {
      const { x_min, x_max, y_min, y_max } = poi.region;
      drawOutlineRect(
        ctx,
        { x: x_min, y: y_min, w: x_max - x_min + 1, h: y_max - y_min + 1 },
        camera, mode,
        { color: GOLD, alpha: 0.6, shadowBlur: 0, lineWidth: 1.5 },
      );
      label(ctx, poi.name ?? poi.id, (x_min + x_max) / 2 + 0.5, (y_min + y_max) / 2 + 0.5, camera, mode, GOLD);
    } else if (poi.position) {
      const radius = POI_ZONE_RULES[poi.type]?.radius.max ?? 4;
      ring(ctx, poi.position.x + 0.5, poi.position.y + 0.5, radius, camera, mode, GOLD);
      label(ctx, poi.name ?? poi.id, poi.position.x + 0.5, poi.position.y + 0.5, camera, mode, GOLD);
    }
  }
}

/** A tile-radius ring around a tile center: circle in topdown, ellipse in iso. */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, camera: Camera, mode: RenderMode, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (mode === 'iso') {
    const { sx, sy } = isoTileCenter(cx, cy, camera);
    ctx.ellipse(sx, sy, radius * ISO_HALF_W * camera.zoom, radius * ISO_HALF_H * camera.zoom, 0, 0, Math.PI * 2);
  } else {
    const { sx, sy } = topdownWorldToScreen(camera, cx, cy, TILE_SIZE);
    ctx.arc(sx, sy, radius * TILE_SIZE * camera.zoom, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, camera: Camera, mode: RenderMode, color: string): void {
  const { sx, sy } = mode === 'iso'
    ? isoTileCenter(cx, cy, camera)
    : topdownWorldToScreen(camera, cx, cy, TILE_SIZE);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, sx, sy);
  ctx.restore();
}
