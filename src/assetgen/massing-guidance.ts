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

/** Draw the massing plus a door marker on the functional door cell. */
export function drawMassingGuidance(
  ctx: CanvasRenderingContext2D, d: BuildingDescriptor, size: GuidanceSize,
): void {
  const { originX, originY } = guidanceOrigin(d, size);
  const dc = { ctx, originX, originY } as unknown as IsoDrawCtx;
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
