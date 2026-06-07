/**
 * floor-guide — rasterizes a building's footprint as a flat iso tile floor, for
 * use as a LOW-strength pixflux `init_image`. Unlike the (removed) massing/
 * scaffold guides — which handed the model a whole building to flatten — this is
 * the GROUND PLANE ONLY: the w×h grid of tile diamonds drawn at our exact 2:1
 * projection (ISO_TILE_W:ISO_TILE_H), at the true footprint scale, seated at the
 * frame's bottom-centre. It pins three things the text-only model gets subtly
 * wrong — projection ANGLE, footprint SIZE, and base POSITION — without dictating
 * the structure; the model draws the building rising from the floor.
 *
 * Geometry matches `drawIsoBuildingSprite`'s anchor exactly (tile CENTRES, south
 * tip at the bottom-centre), so the guide and the final blit register 1:1.
 *
 * Pure (returns an RGBA buffer; the Node gen script encodes it to PNG via pngjs),
 * so it stays bundle-safe and unit-testable without a canvas.
 */
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';

export interface FloorGuide {
  width: number;
  height: number;
  /** RGBA, row-major, length width*height*4. Transparent outside the floor. */
  data: Uint8ClampedArray;
}

/** Flat ground fill + a darker tile-edge rim (conveys the discrete w×h tiles). */
const GROUND: [number, number, number] = [156, 144, 120];
const EDGE: [number, number, number] = [108, 98, 80];
/** |dx|/halfW + |dy|/halfH in this band reads as the tile's edge, not its body. */
const EDGE_BAND = 0.88;

/**
 * Build the floor guide at the EXACT generation frame size (so it can be the
 * init_image). `fw`×`fh` is the footprint in tiles. The floor diamond block is
 * (fw+fh)·halfW wide × (fw+fh)·halfH tall and sits flush at the bottom, centred —
 * leaving the upper band (the building's rise) transparent.
 */
export function buildFloorGuide(frameW: number, frameH: number, fw: number, fh: number): FloorGuide {
  const halfW = ISO_TILE_W / 2;
  const halfH = ISO_TILE_H / 2;
  const data = new Uint8ClampedArray(frameW * frameH * 4); // all 0 → transparent

  // Place the footprint block: centre it horizontally, drop its south tip to the
  // bottom edge. Mirrors drawIsoBuildingSprite (tile centres; south tip = front
  // tile centre + halfH at the frame bottom).
  const ox = frameW / 2 - (fw - fh) * halfH;
  const oy = frameH - (fw + fh - 1) * halfH;

  for (let cx = 0; cx < fw; cx++) {
    for (let cy = 0; cy < fh; cy++) {
      const ccx = (cx - cy) * halfW + ox; // tile centre, frame px
      const ccy = (cx + cy) * halfH + oy;
      fillDiamond(data, frameW, frameH, ccx, ccy, halfW, halfH);
    }
  }
  return { width: frameW, height: frameH, data };
}

/** Rasterize one tile diamond centred at (ccx,ccy) into the RGBA buffer. */
function fillDiamond(
  data: Uint8ClampedArray, frameW: number, frameH: number,
  ccx: number, ccy: number, halfW: number, halfH: number,
): void {
  const x0 = Math.max(0, Math.floor(ccx - halfW));
  const x1 = Math.min(frameW - 1, Math.ceil(ccx + halfW));
  const y0 = Math.max(0, Math.floor(ccy - halfH));
  const y1 = Math.min(frameH - 1, Math.ceil(ccy + halfH));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const r = Math.abs(x + 0.5 - ccx) / halfW + Math.abs(y + 0.5 - ccy) / halfH;
      if (r > 1) continue; // outside the diamond
      const [cr, cg, cb] = r >= EDGE_BAND ? EDGE : GROUND;
      const i = (y * frameW + x) * 4;
      data[i] = cr; data[i + 1] = cg; data[i + 2] = cb; data[i + 3] = 255;
    }
  }
}
