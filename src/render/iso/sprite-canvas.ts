// src/render/iso/sprite-canvas.ts
// Crop a composeStructure grey buffer to its opaque bbox → a tight canvas sprite.
// Returns null where no 2D canvas is available (jsdom tests) — callers fall back.
import type { BBox } from '@/assetgen/render/fit';

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): SpriteCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  return null;
}

export function greyToSpriteCanvas(grey: Uint8ClampedArray, size: number, bbox: BBox): SpriteCanvas | null {
  const full = makeCanvas(size, size);
  const fctx = full?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!full || !fctx) return null;
  fctx.putImageData(new ImageData(grey as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);

  const w = Math.max(1, Math.round(bbox.w));
  const h = Math.max(1, Math.round(bbox.h));
  const crop = makeCanvas(w, h);
  const cctx = crop?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!crop || !cctx) return null;
  cctx.imageSmoothingEnabled = false;
  cctx.drawImage(full as CanvasImageSource, Math.round(bbox.x), Math.round(bbox.y), w, h, 0, 0, w, h);
  return crop;
}
