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
import { AdaptiveResolution } from '@/render/gpu/adaptive-resolution';
import { getUiRuntime } from '@/render/ui/ui-runtime';

const BG_COLOR = '#1a1a24';

/** `?connectome` shows the whole-world graph overlay (POIs, roads, settlements). */
function connectomeRequested(): boolean {
  try { return new URLSearchParams(window.location.search).has('connectome'); }
  catch { return false; }
}

/**
 * P-E — fixed art-pixel-size override (CSS px per art texel). `?px=N` PINS the
 * resolution (disables adaptation, for A/B and preference); absent ⇒ null, i.e.
 * the adaptive controller drives it (1:1, dropping to 2 only when fps sags).
 */
function artPixelOverride(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get('px');
    if (v !== null) { const n = Math.round(Number(v)); if (Number.isFinite(n) && n >= 1 && n <= 8) return n; }
  } catch { /* no window */ }
  return null;
}

/**
 * Build the `?render=gpu` frame closure over a ready GpuScene and its overlay
 * canvas. The overlay is resized to the main canvas's device backing size each
 * frame; WebGPU tracks the canvas size, so its swap chain follows.
 */
export function buildGpuRenderFrame(scene: GpuScene, gpuCanvas: HTMLCanvasElement): RenderFn {
  const atlas = createNullAtlas();
  const showConnectome = connectomeRequested();
  const fixedPx = artPixelOverride();
  const adaptive = new AdaptiveResolution();
  let lastFrameStart = 0;
  let fpsEma = 0;
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

    // P-E adaptive resolution: measure the real frame interval (wall-clock,
    // never the sim clock) and let the controller pick the art-pixel size — 1:1
    // until fps sags below ~30, then 2. A `?px=N` override pins it instead.
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const frameDt = lastFrameStart > 0 ? nowMs - lastFrameStart : 16.7;
    lastFrameStart = nowMs;
    const px = fixedPx ?? adaptive.step(frameDt);

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
    // P-E: render the scene into a low-res target (`S` device px per art texel,
    // integer for crisp nearest upscaling), then blit up to the device. The
    // world→target transform is divided by `S`; offsets are snapped to the art
    // texel grid in low-res space so pixels stay stable under pan/zoom.
    const S = Math.max(1, Math.round(px * dpr));
    const lowW = Math.max(1, Math.ceil(target.width / S));
    const lowH = Math.max(1, Math.ceil(target.height / S));
    const sLow = (z * dpr) / S;
    const offX = Math.round(-camera.x * z * dpr / S);
    const offY = Math.round(-camera.y * z * dpr / S);
    const xform = { sx: sLow, sy: sLow, ox: offX, oy: offY };

    // Buffer-driven terrain field (T1): the GPU generates + lifts the grid from
    // the height/colour storage buffers. Whole-map for now — chunk culling is T5.
    const terrain: TerrainField | null = isLayerHidden('terrain', rc.devMode)
      ? null
      : buildTerrainField(map, {
          viewport: [lowW, lowH],
          xform, lighting, devMode: rc.devMode,
        });

    // Water surface (S2): null when the layer is hidden, there's no terrain to
    // read depth from, or the world is dry. Ripple time is pure render (never the
    // sim clock), so a wall-clock seconds value is fine here.
    const timeSec = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.001;
    const water: WaterField | null = (terrain && !isLayerHidden('rivers', rc.devMode))
      ? buildWaterField(map, { viewport: [lowW, lowH], xform, lighting, timeSec })
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

    scene.renderFrame({
      items: frameItems, lighting, terrain, water,
      w: lowW, h: lowH, out: { w: target.width, h: target.height },
      xform, uiGroups,
    });

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(gpuCanvas, 0, 0);
    ctx.restore();

    drawIsoOverlays(ctx, rc);
    if (showConnectome) drawWorldConnectome(ctx, rc);

    // FPS + art-pixel-scale readout (top-right), smoothed so it doesn't jitter.
    const fps = 1000 / Math.max(1, frameDt);
    fpsEma = fpsEma > 0 ? fpsEma * 0.9 + fps * 0.1 : fps;
    drawPerfHud(ctx, canvasWidth, fpsEma, px, fixedPx !== null);
  };
}

/** Tiny top-right pill: "60 fps · px 1" (adaptive) or "· px 2 (fixed)". */
function drawPerfHud(
  ctx: CanvasRenderingContext2D, cssW: number, fps: number, px: number, fixed: boolean,
): void {
  const label = `${Math.round(fps)} fps · px ${px}${fixed ? ' (fixed)' : ''}`;
  ctx.save();
  ctx.font = '600 11px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const padX = 6;
  const w = ctx.measureText(label).width + padX * 2;
  const h = 18;
  const x = cssW - w - 8;
  const y = 8;
  ctx.fillStyle = 'rgba(10,12,20,0.62)';
  ctx.fillRect(x, y, w, h);
  // colour the rate: green ≥50, amber ≥30, red below.
  ctx.fillStyle = fps >= 50 ? '#7ee787' : fps >= 30 ? '#e3b341' : '#f85149';
  ctx.fillText(label, x + padX, y + h / 2 + 0.5);
  ctx.restore();
}
