// src/render/iso/sprite-canvas.ts
// Crop a composeStructure grey buffer to its opaque bbox → a tight canvas sprite.
// Returns null where no 2D canvas is available (jsdom tests) — callers fall back.
import type { BBox } from '@/assetgen/render/fit';
import type { MountAnchorN } from '@/assetgen/compose';

export type SpriteCanvas = HTMLCanvasElement | OffscreenCanvas;

/** A raw, UN-premultiplied RGBA buffer + its dimensions. Used for DATA maps
 *  (e.g. the material map, whose alpha channel carries metallic, NOT coverage)
 *  that must NEVER round-trip through a 2D canvas: a canvas backing store is
 *  premultiplied, so any pixel with alpha≈0 has its RGB silently zeroed — which
 *  destroys the baked AO (G) and roughness (B) wherever metallic (A) is 0, i.e.
 *  almost everywhere. These upload straight to the GPU via `writeTexture`. */
export interface RawMap {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/**
 * A building sprite + its co-registered companion PBR maps (same crop as the
 * albedo, so UVs align by construction). `normal`/`material` feed the WebGL
 * layer's lit path (PBR Slice 3); absent maps degrade to unlit rendering.
 * `emissive` (RGB self-illumination, e.g. lit window panes) is added by the
 * shader scaled by the renderer's night factor; absent ⇒ no glow. Only present
 * when the sprite actually has emissive pixels (saves a black-texture upload).
 */
export interface SpritePack {
  /** Albedo as a 2D canvas (AI-art + compose-direct paths). Absent on the raw
   *  rehydration path, which carries {@link albedoData} instead — exactly one of
   *  the two is set. Use {@link packAlbedoSource} to read whichever is present. */
  albedo?: SpriteCanvas;
  /** Albedo as ALREADY-PREMULTIPLIED raw RGBA (cache rehydration path). Uploaded
   *  straight to the GPU via `writeTexture`, skipping the canvas `putImageData` +
   *  `copyExternalImageToTexture` round-trip whose only job was premultiply +
   *  a CanvasImageSource identity. Premultiplied at rehydration so the byte form
   *  matches what the canvas copy would have produced (see {@link premultiplyRgba}). */
  albedoData?: RawMap;
  normal?: SpriteCanvas;
  /** Normal map as raw RGBA — UN-premultiplied (the alpha is a flat-normal FLAG,
   *  not coverage; a>0 ⇒ use the encoded normal). Uploaded via `writeTexture`. */
  normalData?: RawMap;
  material?: SpriteCanvas;
  /** The material map as raw RGBA (preferred over `material` for GPU upload).
   *  See {@link RawMap}: the canvas form destroys AO/roughness where metallic=0. */
  materialData?: RawMap;
  emissive?: SpriteCanvas;
  /** Emissive (lit-pane self-illumination) as ALREADY-PREMULTIPLIED raw RGBA —
   *  premultiplied like the albedo (the shader scales it by the sampled alpha). */
  emissiveData?: RawMap;
  /** Geometry-baked ground cast shadow + its offset (px) from the albedo crop's
   *  top-left, so the runtime blits it on the ground under the sprite. */
  shadow?: { canvas: SpriteCanvas; dx: number; dy: number };
  /** Mount sockets projected onto the sprite, normalised (0..1) to the albedo crop — a
   *  sign/lamp/perch/smoke decoration or fauna pass reads these by role/`accepts`. Survives
   *  the img2img repaint because it's stored alongside the crop, not baked into pixels. */
  tags?: MountAnchorN[];
}

/**
 * One renderable piece of a barrier RUN: a composed lit {@link SpritePack} for a bounded
 * chunk of the polyline, plus the placement data the draw list needs. A long run (a town-wall
 * ring) decomposes into many pieces so each composes to a bounded sprite AND y-sorts at its
 * own iso depth (interleaving with the buildings it weaves past), exactly as the legacy
 * per-slab path did — but now lit like a building.
 *
 * Placement is exact (no footprint guess): `refX/refY` is a real z=0 world point (the chunk's
 * start), and `anchorNX/anchorNY` is that point's normalised position (0..1) inside the cropped
 * pack — so the sprite lands by mapping `worldToScreen(refX,refY)` onto `(anchorN·cropSize)`.
 */
export interface BarrierPiece {
  pack: SpritePack;
  refX: number; refY: number;        // world tile point the sprite anchors on (z=0)
  anchorNX: number; anchorNY: number; // normalised (0..1 of the crop) position of (refX,refY)
  sortX: number; sortY: number;       // y-sort anchor tile (the chunk's midpoint)
}

/** Discriminate a {@link RawMap} from a `CanvasImageSource` — the raw form carries
 *  a `.data` typed array; canvases/images do not. */
export function isRawMap(s: CanvasImageSource | RawMap): s is RawMap {
  return (s as RawMap).data instanceof Uint8ClampedArray;
}

/** The albedo GPU-upload source: the premultiplied {@link RawMap} on the raw
 *  rehydration path, else the canvas. Exactly one is present on a well-formed pack. */
export function packAlbedoSource(pack: SpritePack): CanvasImageSource | RawMap {
  return (pack.albedoData ?? pack.albedo) as CanvasImageSource | RawMap;
}

/** Intrinsic pixel size of a canvas/image OR a {@link RawMap} — the emitters read
 *  it to size the draw item regardless of which backing the pack carries. */
export function mapSize(s: CanvasImageSource | RawMap): { w: number; h: number } {
  if (isRawMap(s)) return { w: s.w, h: s.h };
  const a = s as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { w: a.naturalWidth || a.width || 0, h: a.naturalHeight || a.height || 0 };
}

/**
 * Premultiply a straight-alpha RGBA buffer in a fresh typed array — the raw-upload
 * equivalent of the old `putImageData` → `copyExternalImageToTexture(premultiply)`
 * round-trip, but with no canvas. Alpha=0 pixels zero their RGB (matching the
 * premultiplied canvas backing); alpha=255 pixels are copied verbatim (identity).
 * Rounds to nearest so the byte form matches what the canvas copy produced to
 * within ±1 at partial alphas (sprites are hard-alpha, so partials are edge-rare).
 * Used for ALBEDO and EMISSIVE only — normal/material must stay un-premultiplied.
 */
export function premultiplyRgba(src: Uint8ClampedArray, w: number, h: number): RawMap {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    const a = src[i + 3];
    if (a === 0) { out[i + 3] = 0; continue; }          // RGB already 0 from the fill
    if (a === 255) {
      out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = 255;
      continue;
    }
    // Round-half-up integer premultiply (branchless, no Math.round call): the
    // fast path (hard-alpha) covers the vast majority of a sprite's pixels; only
    // anti-aliased edge texels take this partial-alpha branch.
    out[i] = (src[i] * a + 127) / 255 | 0;
    out[i + 1] = (src[i + 1] * a + 127) / 255 | 0;
    out[i + 2] = (src[i + 2] * a + 127) / 255 | 0;
    out[i + 3] = a;
  }
  return { data: out, w, h };
}

/** True if an emissive RGBA buffer has any self-illuminated (non-black) pixel. */
export function hasEmissivePixels(buf: Uint8ClampedArray): boolean {
  for (let i = 0; i < buf.length; i += 4) {
    if (buf[i] > 0 || buf[i + 1] > 0 || buf[i + 2] > 0) return true;
  }
  return false;
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

/** Crop a full-`size` RGBA data buffer to the opaque `bbox` as a raw {@link RawMap},
 *  WITHOUT a 2D canvas — so DATA channels survive (no premultiply). Mirrors the
 *  integer-rect crop `greyToSpriteCanvas` performs, so the result stays co-registered
 *  pixel-for-pixel with the canvas-cropped albedo/normal. Clamps the source rect to
 *  the buffer; out-of-range pixels stay zero. */
export function cropRgba(src: Uint8ClampedArray, size: number, bbox: BBox): RawMap | null {
  const w = Math.max(1, Math.round(bbox.w));
  const h = Math.max(1, Math.round(bbox.h));
  const ox = Math.round(bbox.x), oy = Math.round(bbox.y);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= size) continue;
    for (let x = 0; x < w; x++) {
      const sx = ox + x;
      if (sx < 0 || sx >= size) continue;
      const so = (sy * size + sx) * 4, di = (y * w + x) * 4;
      out[di] = src[so]; out[di + 1] = src[so + 1]; out[di + 2] = src[so + 2]; out[di + 3] = src[so + 3];
    }
  }
  return { data: out, w, h };
}

/** Encode a full grey RGBA buffer as a PNG data-URI (img2img init image). Null in jsdom (no document). */
export function greyToDataUri(grey: Uint8ClampedArray, size: number): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.putImageData(new ImageData(grey as unknown as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return c.toDataURL('image/png');
}
