// src/render/gpu/instance-batch.ts
//
// R2c (data half) — bucket the neutral draw list into instanced batches.
//
// The Canvas2D / WebGL backends draw the y-sorted draw list one `drawImage` per
// item. The WebGPU scene instead draws ONE instanced call per texture bucket
// (the spec's "≤ N draw calls, not one-per-instance"). Painter order is preserved
// without per-item sorting by encoding each item's list index as a monotonic
// `depth`: the scene runs a depth test where a LARGER depth draws in front, so
// out-of-order instanced batches composite identically to the sequential blit.
// Legal because the sprites are hard alpha-cutouts (alpha-test), per the spec.
//
// Pure data transformation — no GPU, no DOM beyond reading `.width`/`.height`
// off the image sources — so the bucketing + draw-call count are unit-testable.

import type { DrawItem } from '@/render/iso/draw-list';

/** Per-instance attributes: a destination quad + its UV sub-rect + depth. */
export interface InstanceAttrs {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  /** UV sub-rect in the texture (0..1); whole image = (0,0)-(1,1). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Painter-order depth in (0,1), monotonically increasing with list index. */
  depth: number;
}

/** One instanced draw: a texture (+ optional PBR maps) and its instances. */
export interface InstanceBatch {
  texture: CanvasImageSource;
  normal?: CanvasImageSource;
  material?: CanvasImageSource;
  /** True when normal+material are present ⇒ the lit WGSL path; else flat blit. */
  lit: boolean;
  instances: InstanceAttrs[];
}

/** Read intrinsic pixel size off any CanvasImageSource (img/canvas/bitmap). */
export function srcSize(s: CanvasImageSource): { w: number; h: number } {
  const a = s as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  const w = a.naturalWidth || a.videoWidth || a.width || 0;
  const h = a.naturalHeight || a.videoHeight || a.height || 0;
  return { w, h };
}

/**
 * Group the image items of a draw list into texture-keyed instanced batches.
 *
 * - Buckets by `src` identity (same SpritePack albedo ⇒ one batch; NPC sheet
 *   frames share one src and differ only by UV).
 * - Buckets are kept in first-seen order (stable, deterministic).
 * - `depth` encodes the item's position in the original y-sorted list.
 * - A batch is `lit` iff every item in it carries both companion maps; mixed
 *   buckets (some lit, some not) are rare in practice — we mark the batch lit
 *   only when the first item that created it had maps, and keep maps from it.
 *
 * Non-image items (`poly`/`circle` — barrier fills, NPC fallback shapes) are not
 * textured; they are returned via `passthrough` for the scene to draw separately.
 */
export function buildInstanceBatches(items: readonly DrawItem[]): {
  batches: InstanceBatch[];
  passthrough: DrawItem[];
} {
  const batches: InstanceBatch[] = [];
  const byTexture = new Map<CanvasImageSource, InstanceBatch>();
  const passthrough: DrawItem[] = [];
  const count = items.length;

  items.forEach((it, i) => {
    if (it.t !== 'image') {
      passthrough.push(it);
      return;
    }
    const depth = (i + 1) / (count + 1); // strictly in (0,1), increasing with order

    let batch = byTexture.get(it.src);
    if (!batch) {
      batch = {
        texture: it.src,
        normal: it.maps?.normal,
        material: it.maps?.material,
        lit: !!(it.maps?.normal && it.maps?.material),
        instances: [],
      };
      byTexture.set(it.src, batch);
      batches.push(batch);
    }

    const { w, h } = srcSize(it.src);
    let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
    if (it.frame && w > 0 && h > 0) {
      u0 = it.frame.sx / w;
      v0 = it.frame.sy / h;
      u1 = (it.frame.sx + it.frame.sw) / w;
      v1 = (it.frame.sy + it.frame.sh) / h;
    }
    batch.instances.push({ dx: it.dx, dy: it.dy, dw: it.dw, dh: it.dh, u0, v0, u1, v1, depth });
  });

  return { batches, passthrough };
}

/** Draw-call count for the entity instanced pass: one per texture bucket. */
export function instancedDrawCalls(batches: readonly InstanceBatch[]): number {
  return batches.length;
}

/**
 * World→device affine for the entity pass: `screen = world * s + o`. The draw
 * list is authored in WORLD coordinates (the Canvas2D/Pixi paths apply the same
 * camera transform on the context/stage); the GPU shader wants device pixels, so
 * the scene bakes this transform into the instance rects before packing. Mirrors
 * `isoStageTransform` (scale = zoom, offset = round(-cam·zoom)) times the DPR.
 */
export interface ViewTransform {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/** Apply a world→device transform to a batch's instance rects, in place. */
export function applyViewTransform(batch: InstanceBatch, xf: ViewTransform): void {
  for (const it of batch.instances) {
    it.dx = it.dx * xf.sx + xf.ox;
    it.dy = it.dy * xf.sy + xf.oy;
    it.dw *= xf.sx;
    it.dh *= xf.sy;
  }
}
