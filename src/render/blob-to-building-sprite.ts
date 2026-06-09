// Decode a generated PNG blob → crop to its opaque bbox → downscale so the opaque
// content width equals the footprint diamond width. Returns a tight SpriteCanvas
// for drawIsoBuildingSpriteGenerated (centre/bottom anchor). Returns null when no
// canvas/createImageBitmap is available (jsdom) → caller falls back to grey.
import { ISO_TILE_W } from '@/render/iso/iso-constants';
import type { SpriteCanvas } from '@/render/iso/sprite-canvas';
import { chromaKeyMagenta } from '@/render/chroma-key';

export function buildingSpriteTargetWidth(footprint: { w: number; h: number }): number {
  return Math.round((footprint.w + footprint.h) * (ISO_TILE_W / 2));
}

function makeCanvas(w: number, h: number): SpriteCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return null;
}

export async function blobToBuildingSprite(blob: Blob, targetWidth: number): Promise<SpriteCanvas | null> {
  if (typeof createImageBitmap === 'undefined') return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  const w = bmp.width, h = bmp.height;
  const scratch = makeCanvas(w, h);
  const sctx = scratch?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!scratch || !sctx) return null;
  sctx.drawImage(bmp, 0, 0);

  // Key the solid magenta background out to alpha (the prompt forces that fill),
  // then write it back so both the bbox scan and the crop see the keyed pixels.
  const img = sctx.getImageData(0, 0, w, h);
  chromaKeyMagenta(img.data);
  sctx.putImageData(img, 0, 0);

  // Opaque bbox scan.
  const data = img.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null; // fully transparent
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const scale = targetWidth / cw;
  const outW = Math.max(1, Math.round(cw * scale)), outH = Math.max(1, Math.round(ch * scale));
  const out = makeCanvas(outW, outH);
  const octx = out?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!out || !octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(scratch as CanvasImageSource, minX, minY, cw, ch, 0, 0, outW, outH);
  return out;
}
