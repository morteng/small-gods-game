// src/render/gpu/gpu-render-frame.ts
//
// R2d-integrate — the game frame through the WebGPU scene. The GPU now draws
// BOTH the terrain heightfield mesh (lifted geometry, R2d) AND the y-sorted
// entity draw list, composited onto an overlay WebGPU canvas that's blitted over
// the Canvas2D background device-pixel to device-pixel (the same blit the Pixi
// layer used). Only overlays remain on Canvas2D. (R2c-integrate first put the
// entities here over a Canvas2D terrain; R2d moved terrain onto the GPU too.)
//
// Draw list + terrain mesh are authored in WORLD coordinates; the scene bakes
// the camera's world→device transform (zoom + snapped offset × DPR) into the
// entity instances (CPU) and the terrain uniform (GPU).
//
// Parity: `poly`/`circle` fallback fills now draw on the GPU (`shape-geometry.ts`)
// and entities ride the terrain surface (foot-z lift, `terrain-lift.ts`), so the
// GPU path matches the Canvas2D/Pixi entity passes.

import type { RenderContext } from '@/core/types';
import type { RenderFn } from '@/render/select-renderer';
import { drawIsoOverlays } from '@/render/iso/iso-overlay';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import { visibleTileBounds } from '@/render/iso/iso-projection';
import { isLayerHidden } from '@/render/layer-visibility';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { buildTerrainField, type TerrainField } from '@/render/gpu/terrain-field';
import { buildWaterField, type WaterField } from '@/render/gpu/water-field';
import { getHydrologyResult } from '@/world/hydrology-store';
import { FlotsamSystem } from '@/water/water-flotsam';
import { drawWorldConnectome } from '@/render/connectome-overlay';
import type { GpuScene } from '@/render/gpu/gpu-scene';
import { getUiRuntime } from '@/render/ui/ui-runtime';

const BG_COLOR = '#1a1a24';

/** `?connectome` shows the whole-world graph overlay (POIs, roads, settlements). */
function connectomeRequested(): boolean {
  try { return new URLSearchParams(window.location.search).has('connectome'); }
  catch { return false; }
}

/**
 * Build the `?render=gpu` frame closure over a ready GpuScene and its overlay
 * canvas. The overlay is resized to the main canvas's device backing size each
 * frame; WebGPU tracks the canvas size, so its swap chain follows.
 */
export function buildGpuRenderFrame(scene: GpuScene, gpuCanvas: HTMLCanvasElement): RenderFn {
  const atlas = createNullAtlas();
  const showConnectome = connectomeRequested();
  const ui = getUiRuntime();
  // Cosmetic flow-advected particles (S6) — created on first frame from the map
  // seed, stepped by wall-clock delta (pure render, never the sim clock).
  let flotsam: FlotsamSystem | null = null;
  let lastFlotsamTime = 0;
  return function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { camera, canvasWidth, canvasHeight, map } = rc;
    const target = ctx.canvas;
    // The context carries an outer devicePixelRatio scale; recover it from the
    // backing-store size so the overlay and transform land on device pixels.
    const dpr = canvasWidth > 0 ? target.width / canvasWidth : 1;

    // Background only — terrain + entities both render on the GPU now (R2d).
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const z = camera.zoom;
    const bounds = visibleTileBounds(
      { originX: -camera.x, originY: -camera.y },
      canvasWidth / camera.zoom,
      canvasHeight / camera.zoom,
      { mapW: map.width, mapH: map.height },
    );

    const items = buildEntityDrawList(rc, bounds, {
      atlas, originX: 0, originY: 0, npcSheets: rc.npcSheets, treeSheets: rc.treeSheets,
    });

    // GPU terrain + entity passes → overlay canvas, composited identity (device→device).
    if (gpuCanvas.width !== target.width || gpuCanvas.height !== target.height) {
      gpuCanvas.width = target.width;
      gpuCanvas.height = target.height;
    }
    const lighting = rc.lighting ?? DEFAULT_LIGHTING;
    const offX = Math.round(-camera.x * z);
    const offY = Math.round(-camera.y * z);
    const xform = { sx: z * dpr, sy: z * dpr, ox: offX * dpr, oy: offY * dpr };

    // Buffer-driven terrain field (T1): the GPU generates + lifts the grid from
    // the height/colour storage buffers. Whole-map for now — chunk culling is T5.
    const terrain: TerrainField | null = isLayerHidden('terrain', rc.devMode)
      ? null
      : buildTerrainField(map, {
          viewport: [target.width, target.height],
          xform, lighting, devMode: rc.devMode,
        });

    // Water surface (S2): null when the layer is hidden, there's no terrain to
    // read depth from, or the world is dry. Ripple time is pure render (never the
    // sim clock), so a wall-clock seconds value is fine here.
    const timeSec = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.001;
    const water: WaterField | null = (terrain && !isLayerHidden('rivers', rc.devMode))
      ? buildWaterField(map, { viewport: [target.width, target.height], xform, lighting, timeSec })
      : null;

    // Flotsam/fauna (S6): step + emit cosmetic circles on the water surface.
    // Appended after the entity list so they composite over the water; the
    // renderer doesn't terrain-lift `circle` items, so they keep their surface z.
    let frameItems = items;
    if (water) {
      const hydro = getHydrologyResult(map);
      if (!flotsam) flotsam = new FlotsamSystem(map.seed);
      const dt = lastFlotsamTime > 0 ? timeSec - lastFlotsamTime : 0;
      lastFlotsamTime = timeSec;
      flotsam.step(map, hydro, dt);
      frameItems = [...items, ...flotsam.drawItems(map, hydro)];
    }

    const uiGroups = ui.frame(target.width, target.height, dpr);

    scene.renderFrame({ items: frameItems, lighting, terrain, water, w: target.width, h: target.height, xform, uiGroups });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(gpuCanvas, 0, 0);
    ctx.restore();

    drawIsoOverlays(ctx, rc);
    if (showConnectome) drawWorldConnectome(ctx, rc);
  };
}
