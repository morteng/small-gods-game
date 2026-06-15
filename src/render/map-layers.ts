import type { Camera, BiomeMap, POI } from '@/core/types';
import { isoTileCenter, drawOutlineRect } from './selection-outline';
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';
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

function visibleBounds(mapW: number, mapH: number): TileBounds {
  // Iso visible-bounds inversion is fiddly; maps are small enough to iterate the
  // full extent. (A tighter cull can come with the RenderViewModel seam.)
  return { minTx: 0, maxTx: mapW - 1, minTy: 0, maxTy: mapH - 1 };
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

/** Fill one tile cell (iso diamond) at the given alpha. */
function fillCell(ctx: CanvasRenderingContext2D, tx: number, ty: number, camera: Camera, color: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const { sx, sy } = isoTileCenter(tx, ty, camera);
  const hw = ISO_HALF_W * camera.zoom, hh = ISO_HALF_H * camera.zoom;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Stroke the shared edge between a cell and its differing neighbour (dx,dy ∈ {±1,0}). */
function strokeEdge(ctx: CanvasRenderingContext2D, tx: number, ty: number, dx: number, dy: number, camera: Camera): void {
  const { sx, sy } = isoTileCenter(tx, ty, camera);
  const hw = ISO_HALF_W * camera.zoom, hh = ISO_HALF_H * camera.zoom;
  const top = [sx, sy - hh], right = [sx + hw, sy], bottom = [sx, sy + hh], left = [sx - hw, sy];
  let a = top, b = right;
  if (dx === 1) { a = right; b = bottom; }       // neighbour down-right
  else if (dy === 1) { a = bottom; b = left; }    // down-left
  else if (dx === -1) { a = left; b = top; }      // up-left
  else if (dy === -1) { a = top; b = right; }     // up-right
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
}

const NEIGHBOURS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function drawBiomeLayer(
  ctx: CanvasRenderingContext2D,
  biomeMap: BiomeMap | null,
  camera: Camera,
): void {
  if (!biomeMap) return;
  const { biomes, width, height } = biomeMap;
  const b = visibleBounds(width, height);

  for (let ty = b.minTy; ty <= b.maxTy; ty++) {
    for (let tx = b.minTx; tx <= b.maxTx; tx++) {
      const biome = biomes[ty * width + tx];
      if (!biome || SKIP_BIOMES.has(biome)) continue;
      const color = biomeColor(biome);
      fillCell(ctx, tx, ty, camera, color, 0.16);

      // Border treatment: for each differing neighbour, soft blend band + outline.
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = tx + dx, ny = ty + dy;
        const nb = (nx >= 0 && ny >= 0 && nx < width && ny < height) ? biomes[ny * width + nx] : null;
        if (nb === biome) continue;            // same biome → interior, no border
        if (nb && SKIP_BIOMES.has(nb)) continue; // coastline handled by water render
        if (nb) fillCell(ctx, tx, ty, camera, blend(color, biomeColor(nb)), 0.16); // blend band
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        strokeEdge(ctx, tx, ty, dx, dy, camera);
        ctx.restore();
      }
    }
  }
}

export function drawPoiLayer(
  ctx: CanvasRenderingContext2D,
  pois: POI[] | null | undefined,
  camera: Camera,
): void {
  if (!pois?.length) return;
  const GOLD = '#ffd24a';

  for (const poi of pois) {
    if (poi.region) {
      const { x_min, x_max, y_min, y_max } = poi.region;
      drawOutlineRect(
        ctx,
        { x: x_min, y: y_min, w: x_max - x_min + 1, h: y_max - y_min + 1 },
        camera,
        { color: GOLD, alpha: 0.6, shadowBlur: 0, lineWidth: 1.5 },
      );
      label(ctx, poi.name ?? poi.id, (x_min + x_max) / 2 + 0.5, (y_min + y_max) / 2 + 0.5, camera, GOLD);
    } else if (poi.position) {
      const radius = POI_ZONE_RULES[poi.type]?.radius.max ?? 4;
      ring(ctx, poi.position.x + 0.5, poi.position.y + 0.5, radius, camera, GOLD);
      label(ctx, poi.name ?? poi.id, poi.position.x + 0.5, poi.position.y + 0.5, camera, GOLD);
    }
  }
}

/** A tile-radius ring (iso ellipse) around a tile center. */
function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, camera: Camera, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const { sx, sy } = isoTileCenter(cx, cy, camera);
  ctx.ellipse(sx, sy, radius * ISO_HALF_W * camera.zoom, radius * ISO_HALF_H * camera.zoom, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, camera: Camera, color: string): void {
  const { sx, sy } = isoTileCenter(cx, cy, camera);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = color;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, sx, sy);
  ctx.restore();
}
