// src/render/gpu/shadow-instance.ts
//
// Pure data half of the WebGPU cast-shadow pass (the GPU port of
// `pixi-entity-layer.ts::populateShadows`). Turns the neutral draw list into
// texture-batched shadow quads — no GPU, no DOM beyond reading image sizes — so
// the projection math is unit-testable.
//
// Each shadow is a parallelogram given by four corners (TL, TR, BL, BR):
//
//  - silhouette: a black copy of the sprite sheared up the sun ray. The
//    authoritative rule (from the Pixi class doc) is that a pixel `h` screen-px
//    above the foot line lands at `foot + h·(leanX, dropY)`. So the texture
//    bottom (v1) sits at the foot and the texture top (v0) projects up the ray
//    by the full sprite height.
//  - geometry: the pre-baked ground shadow sprite (`it.shadowSprite`) as an
//    axis-aligned rectangle at its foot-relative offset (a degenerate
//    parallelogram). Used when `shadowMode==='geometry'` and a baked shadow
//    exists; otherwise the item falls back to the silhouette.
//
// Corner/UV ordering matches the unit quad + shadow-wgsl.ts vertex shader.

import type { DrawItem } from '@/render/iso/draw-list';
import type { RawMap } from '@/render/iso/sprite-canvas';
import type { LightingState } from '@/render/lighting-state';
import { srcSize, type ViewTransform } from '@/render/gpu/instance-batch';

/** Container alpha for the composited shadow union (matches the Pixi layer). */
export const SHADOW_ALPHA = 0.32;

/** Floats per shadow instance: cTop(4) + cBot(4) + uv(4). */
export const SHADOW_INSTANCE_FLOATS = 12;
export const SHADOW_INSTANCE_STRIDE = SHADOW_INSTANCE_FLOATS * 4;

export interface ShadowInstance {
  /** TL.x, TL.y, TR.x, TR.y (screen/world px — texture top, v0). */
  cTop: [number, number, number, number];
  /** BL.x, BL.y, BR.x, BR.y (screen/world px — texture bottom, v1). */
  cBot: [number, number, number, number];
  /** u0, v0, u1, v1. */
  uv: [number, number, number, number];
}

/** One instanced shadow draw: a source texture (alpha-sampled) + its instances.
 *  The source may be a canvas/image OR a raw premultiplied {@link RawMap} (the
 *  rehydrated-albedo silhouette / raw geometry-shadow mask — only its alpha is read). */
export interface ShadowBatch {
  texture: CanvasImageSource | RawMap;
  instances: ShadowInstance[];
}

type ImageItem = DrawItem & { t: 'image' };

/** Ground displacement per screen px of height, derived from the SHADOW sun
 *  direction (`shadowDir ?? sunDir` — the day/night cycle pins shadows to the
 *  canonical sun while the shading direction sweeps). */
function sunLean(lighting: LightingState): { leanX: number; dropY: number; mag: number } {
  const dir = lighting.shadowDir ?? lighting.sunDir;
  const [sx, , sz] = dir;
  const sy = dir[1];
  const up = Math.max(0.2, sy);
  const damp = 0.8;
  const leanX = (-sx / up) * damp;          // screen-x per height px
  const dropY = (-sz / up) * 0.5 * damp;    // screen-y per height px (iso 2:1)
  return { leanX, dropY, mag: Math.hypot(leanX, dropY) };
}

/** Foot lift (px above the sprite bottom that is the ground-contact line). */
function footLift(it: ImageItem): number {
  return it.shadow?.footLift ?? (it.maps ? it.dw / 4 : 0);
}

/** UV sub-rect for an item's frame (whole image when no frame). A mirrored item
 *  (DrawItem.mirror) gets its u-range swapped so the silhouette matches the flip. */
function frameUV(it: ImageItem): [number, number, number, number] {
  const { w, h } = srcSize(it.src);
  let uv: [number, number, number, number] = [0, 0, 1, 1];
  if (it.frame && w > 0 && h > 0) {
    uv = [it.frame.sx / w, it.frame.sy / h, (it.frame.sx + it.frame.sw) / w, (it.frame.sy + it.frame.sh) / h];
  }
  if (it.mirror) { const t = uv[0]; uv[0] = uv[2]; uv[2] = t; }
  return uv;
}

/**
 * Build texture-batched shadow instances from a draw list. Returns `[]` when
 * shadows are off/disabled or the sun is too steep to cast a readable shadow.
 *
 * Corners are emitted in the SAME coordinate space as the draw items (world px);
 * pass the entity `xform` to bake the world→device transform in (uniform scale,
 * so the screen-space lean ratios survive unchanged).
 */
export function buildShadowBatches(
  items: readonly DrawItem[],
  lighting: LightingState,
  xform?: ViewTransform,
): ShadowBatch[] {
  const mode = lighting.shadowMode ?? 'silhouette';
  if (!lighting.enabled || mode === 'off') return [];

  const { leanX, dropY, mag } = sunLean(lighting);
  if (mag <= 0.05) return [];

  const byTexture = new Map<CanvasImageSource | RawMap, ShadowBatch>();
  const push = (texture: CanvasImageSource | RawMap, inst: ShadowInstance): void => {
    let batch = byTexture.get(texture);
    if (!batch) { batch = { texture, instances: [] }; byTexture.set(texture, batch); }
    batch.instances.push(inst);
  };

  for (const raw of items) {
    if (raw.t !== 'image') continue;
    const it = raw as ImageItem;
    if (it.noShadow) continue;

    // geometry: prefer the baked ground shadow (axis-aligned rect); other modes
    // and items without a baked shadow take the projected silhouette below.
    if (mode === 'geometry' && it.shadowSprite) {
      const { w, h } = srcSize(it.shadowSprite.src);
      // A mirrored sprite does NOT mirror its baked ground shadow: the bake
      // integrates the sun's throw, so reflecting it about the foot centre put
      // the shadow on the WRONG side of the sun — half the trees cast west and
      // half north-east (user report 2026-07-19). The unmirrored blob is the
      // wrong silhouette for a flipped sprite but the right direction, and for
      // soft organic shadows direction is the only thing the eye checks.
      const x0 = it.dx + it.dw / 2 + it.shadowSprite.dx;
      const y0 = it.dy + it.dh + it.shadowSprite.dy;
      push(it.shadowSprite.src, {
        cTop: [x0, y0, x0 + w, y0],
        cBot: [x0, y0 + h, x0 + w, y0 + h],
        uv: [0, 0, 1, 1],
      });
      continue;
    }

    // silhouette: texture bottom at the foot, top sheared up the sun ray by dh.
    const fy = it.dy + it.dh - footLift(it);
    const tlx = it.dx + it.dh * leanX;
    const tly = fy + it.dh * dropY;
    push(it.src, {
      cTop: [tlx, tly, tlx + it.dw, tly],
      cBot: [it.dx, fy, it.dx + it.dw, fy],
      uv: frameUV(it),
    });
  }

  const batches = [...byTexture.values()];
  if (xform) for (const b of batches) for (const inst of b.instances) applyXform(inst, xform);
  return batches;
}

/** Bake a world→device transform into a shadow instance's corners, in place. */
function applyXform(inst: ShadowInstance, xf: ViewTransform): void {
  inst.cTop = [
    inst.cTop[0] * xf.sx + xf.ox, inst.cTop[1] * xf.sy + xf.oy,
    inst.cTop[2] * xf.sx + xf.ox, inst.cTop[3] * xf.sy + xf.oy,
  ];
  inst.cBot = [
    inst.cBot[0] * xf.sx + xf.ox, inst.cBot[1] * xf.sy + xf.oy,
    inst.cBot[2] * xf.sx + xf.ox, inst.cBot[3] * xf.sy + xf.oy,
  ];
}

/** Pack shadow instances into the interleaved vertex buffer (12 floats each). */
export function packShadowInstances(instances: readonly ShadowInstance[]): Float32Array {
  const buf = new Float32Array(instances.length * SHADOW_INSTANCE_FLOATS);
  for (let i = 0; i < instances.length; i++) {
    const it = instances[i];
    const o = i * SHADOW_INSTANCE_FLOATS;
    buf[o] = it.cTop[0]; buf[o + 1] = it.cTop[1]; buf[o + 2] = it.cTop[2]; buf[o + 3] = it.cTop[3];
    buf[o + 4] = it.cBot[0]; buf[o + 5] = it.cBot[1]; buf[o + 6] = it.cBot[2]; buf[o + 7] = it.cBot[3];
    buf[o + 8] = it.uv[0]; buf[o + 9] = it.uv[1]; buf[o + 10] = it.uv[2]; buf[o + 11] = it.uv[3];
  }
  return buf;
}

/** Total shadow draw calls (one per texture bucket) the list would issue. */
export function shadowDrawCalls(batches: readonly ShadowBatch[]): number {
  return batches.filter(b => b.instances.length > 0).length;
}
