/**
 * renderMassingToImage — renders a building's parametric massing to a PNG for
 * use as a pixflux `init_image` (img2img guidance).
 *
 * The massing already encodes correct iso projection, exact footprint, material
 * colours, and a door on the right face — exactly the three things text-only
 * generation gets wrong. Feeding it as init_image makes the generated sprite
 * respect projection + footprint + door, and its colours double as the palette
 * anchor. Anchored to match `drawIsoBuildingSprite` (bottom at the south tip,
 * centred horizontally) so the guidance and the final blit register.
 */
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { worldToScreen } from '@/render/iso/iso-projection';
import { drawIsoBuildingMassing } from '@/render/iso/iso-building';
import { buildingMassing } from '@/render/building-massing-model';
import type { IsoDrawCtx } from '@/render/iso/iso-sprites';
import type { BuildingDescriptor } from '@/world/building-descriptor';

export interface GuidanceSize { width: number; height: number }

/** Distinct door-marker colour the model latches onto for door placement. */
const DOOR_MARKER = '#ff2bd6';

/**
 * Origin that centres the footprint diamond horizontally and anchors its south
 * tip near the canvas bottom — the same anchor `drawIsoBuildingSprite` uses, so
 * guidance and final sprite occupy the same region.
 */
export function guidanceOrigin(
  d: BuildingDescriptor, size: GuidanceSize,
): { originX: number; originY: number } {
  const { w, h } = d.footprint;
  const contentW = (w + h) * (ISO_TILE_W / 2);
  return {
    originX: (size.width - contentW) / 2 + h * (ISO_TILE_W / 2),
    originY: size.height - (w + h) * (ISO_TILE_H / 2),
  };
}

/**
 * Footprint tile grid on the ground plane — the proportion/scale reference. The
 * model reads it as "this building occupies a w×h iso footprint", so a 5×2
 * longhouse renders wide and a 3×3 cottage square. Drawn first, under the mass.
 */
export function drawFootprintGrid(
  ctx: CanvasRenderingContext2D, d: BuildingDescriptor, originX: number, originY: number,
): void {
  const { w, h } = d.footprint;
  for (let tx = 0; tx < w; tx++) {
    for (let ty = 0; ty < h; ty++) {
      const n = worldToScreen(tx, ty, 0, originX, originY);
      const e = worldToScreen(tx + 1, ty, 0, originX, originY);
      const s = worldToScreen(tx + 1, ty + 1, 0, originX, originY);
      const wc = worldToScreen(tx, ty + 1, 0, originX, originY);
      ctx.beginPath();
      ctx.moveTo(n.sx, n.sy); ctx.lineTo(e.sx, e.sy);
      ctx.lineTo(s.sx, s.sy); ctx.lineTo(wc.sx, wc.sy); ctx.closePath();
      ctx.fillStyle = 'rgba(150,160,180,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,100,120,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

/** Draw the footprint grid + massing + a door marker on the functional cell. */
export function drawMassingGuidance(
  ctx: CanvasRenderingContext2D, d: BuildingDescriptor, size: GuidanceSize,
): void {
  const { originX, originY } = guidanceOrigin(d, size);
  const dc = { ctx, originX, originY } as unknown as IsoDrawCtx;
  drawFootprintGrid(ctx, d, originX, originY);
  drawIsoBuildingMassing(dc, buildingMassing(d), 0, 0);

  // Door marker on the functional cell (already on the correct face).
  const door = worldToScreen(d.door.x + 0.5, d.door.y + 0.5, 0, originX, originY);
  ctx.fillStyle = DOOR_MARKER;
  ctx.fillRect(Math.round(door.sx - 5), Math.round(door.sy - 14), 10, 14);
}

/**
 * Browser wrapper: render the guidance to a canvas and return the base64 PNG
 * (no data-URI prefix), suitable for `PixelLabGenerateOpts.initImage`. Accepts
 * a canvas factory for headless/test use.
 */
export function renderMassingToImage(
  d: BuildingDescriptor,
  size: GuidanceSize,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): string {
  const canvas = makeCanvas();
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('renderMassingToImage: 2d context unavailable');
  drawMassingGuidance(ctx, d, size);
  const url = canvas.toDataURL('image/png');
  return url.split(',')[1] ?? '';
}
