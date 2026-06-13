// src/render/iso/sprite-canvas.ts
// Crop a composeStructure grey buffer to its opaque bbox → a tight canvas sprite.
// Returns null where no 2D canvas is available (jsdom tests) — callers fall back.
import type { BBox } from '@/assetgen/render/fit';

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * A building sprite + its co-registered companion PBR maps (same crop as the
 * albedo, so UVs align by construction). `normal`/`material` feed the WebGL
 * layer's lit path (PBR Slice 3); absent maps degrade to unlit rendering.
 * Emissive stays persisted in the caches but isn't decoded until Slice 5.
 */
export interface SpritePack {
  albedo: SpriteCanvas;
  normal?: SpriteCanvas;
  material?: SpriteCanvas;
  /** Geometry-baked ground cast shadow + its offset (px) from the albedo crop's
   *  top-left, so the runtime blits it on the ground under the sprite. */
  shadow?: { canvas: SpriteCanvas; dx: number; dy: number };
}

/** Build a tight canvas from a w×h RGBA buffer (e.g. the baked ground shadow). */
export function rgbaToCanvas(data: Uint8ClampedArray, w: number, h: number): SpriteCanvas | null {
  const c = makeCanvas(w, h);
  const ctx = c?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!c || !ctx) return null;
  ctx.putImageData(new ImageData(data as unknown as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c;
}

export function makeCanvas(w: number, h: number): SpriteCanvas | null {
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

/** Encode a full grey RGBA buffer as a PNG data-URI (img2img init image). Null in jsdom (no document). */
export function greyToDataUri(grey: Uint8ClampedArray, size: number): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.putImageData(new ImageData(grey as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return c.toDataURL('image/png');
}
