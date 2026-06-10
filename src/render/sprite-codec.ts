// Canvas-backed PNG codecs bridging the pure-buffer post-process pipeline
// (sprite-postprocess.ts) to the browser. Every function returns null where no
// canvas backend exists (jsdom tests) — callers fall back or skip persisting.
import type { Raster } from '@/render/sprite-postprocess';
import { makeCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';

/** Decode a PNG/image blob into a raw RGBA raster. */
export async function decodePngToRaster(blob: Blob): Promise<Raster | null> {
  if (typeof createImageBitmap === 'undefined') return null;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  const c = makeCanvas(bmp.width, bmp.height);
  const ctx = c?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!c || !ctx) return null;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { data: img.data, w: bmp.width, h: bmp.height };
}

/** Blit a raster onto a fresh canvas (the renderer's SpriteCanvas contract). */
export function rasterToSpriteCanvas(r: Raster): SpriteCanvas | null {
  if (typeof ImageData === 'undefined') return null; // jsdom: canvas stub without ImageData
  const c = makeCanvas(r.w, r.h);
  const ctx = c?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!c || !ctx) return null;
  ctx.putImageData(new ImageData(r.data as unknown as Uint8ClampedArray<ArrayBuffer>, r.w, r.h), 0, 0);
  return c;
}

/** Encode a raster as a PNG blob (for the IndexedDB art cache). */
export async function rasterToPngBlob(r: Raster): Promise<Blob | null> {
  const c = rasterToSpriteCanvas(r);
  if (!c) return null;
  if ('convertToBlob' in c) return (c as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  return new Promise<Blob | null>(res => (c as HTMLCanvasElement).toBlob(b => res(b), 'image/png'));
}
