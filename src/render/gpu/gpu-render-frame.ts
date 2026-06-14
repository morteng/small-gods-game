// src/render/gpu/gpu-render-frame.ts
//
// R2c-integrate — the first REAL game frame through the WebGPU scene. Mirrors
// `createIsoRenderMap` exactly, swapping ONLY the entity executor: terrain and
// overlays stay on Canvas2D (terrain becomes GPU geometry in R2d), while the
// y-sorted entity draw list is rendered by `GpuScene` onto an overlay WebGPU
// canvas and composited device-pixel to device-pixel — the same blit the Pixi
// layer used (`iso-renderer.ts`), so placement parity holds by construction.
//
// The draw list is authored in WORLD coordinates; the scene bakes the camera's
// world→device transform (zoom + snapped offset, times DPR) into the instances.
//
// Known gap (R2e): `poly`/`circle` passthrough items (barrier fills, NPC
// fallback diamonds) aren't drawn by the GPU scene yet — image entities
// (buildings, NPCs, trees, decorations) are the bulk and render here.

import type { RenderContext } from '@/core/types';
import type { RenderFn } from '@/render/select-renderer';
import { drawIsoTerrain } from '@/render/iso/iso-terrain';
import { drawIsoOverlays } from '@/render/iso/iso-overlay';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import { visibleTileBounds } from '@/render/iso/iso-projection';
import { isLayerHidden } from '@/render/layer-visibility';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import type { GpuScene } from '@/render/gpu/gpu-scene';

const BG_COLOR = '#1a1a24';

/**
 * Build the `?render=gpu` frame closure over a ready GpuScene and its overlay
 * canvas. The overlay is resized to the main canvas's device backing size each
 * frame; WebGPU tracks the canvas size, so its swap chain follows.
 */
export function buildGpuRenderFrame(scene: GpuScene, gpuCanvas: HTMLCanvasElement): RenderFn {
  const atlas = createNullAtlas();
  return function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { camera, canvasWidth, canvasHeight, map } = rc;
    const target = ctx.canvas;
    // The context carries an outer devicePixelRatio scale; recover it from the
    // backing-store size so the overlay and transform land on device pixels.
    const dpr = canvasWidth > 0 ? target.width / canvasWidth : 1;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Terrain on Canvas2D under the same pixel-snapped world transform as iso.
    ctx.save();
    const z = camera.zoom;
    ctx.scale(z, z);
    ctx.translate(Math.round(-camera.x * z) / z, Math.round(-camera.y * z) / z);

    const bounds = visibleTileBounds(
      { originX: -camera.x, originY: -camera.y },
      canvasWidth / camera.zoom,
      canvasHeight / camera.zoom,
      { mapW: map.width, mapH: map.height },
    );
    if (!isLayerHidden('terrain', rc.devMode)) {
      drawIsoTerrain(ctx, { map, bounds, originX: 0, originY: 0, devMode: rc.devMode });
    }

    const items = buildEntityDrawList(rc, bounds, {
      atlas, originX: 0, originY: 0, npcSheets: rc.npcSheets, treeSheets: rc.treeSheets,
    });
    ctx.restore();

    // GPU entity pass → overlay canvas, then composite identity (device→device).
    if (gpuCanvas.width !== target.width || gpuCanvas.height !== target.height) {
      gpuCanvas.width = target.width;
      gpuCanvas.height = target.height;
    }
    const lighting = rc.lighting ?? DEFAULT_LIGHTING;
    const offX = Math.round(-camera.x * z);
    const offY = Math.round(-camera.y * z);
    scene.render(items, lighting, target.width, target.height, {
      sx: z * dpr, sy: z * dpr, ox: offX * dpr, oy: offY * dpr,
    });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(gpuCanvas, 0, 0);
    ctx.restore();

    drawIsoOverlays(ctx, rc);
  };
}
