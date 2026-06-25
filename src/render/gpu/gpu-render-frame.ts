// src/render/gpu/gpu-render-frame.ts
//
// R2d-integrate — the game frame through the WebGPU scene. The GPU draws BOTH the
// terrain heightfield mesh (lifted geometry, R2d) AND the y-sorted entity draw
// list STRAIGHT to `sceneCanvas`'s swap chain — the on-screen scene canvas. The
// old offscreen-canvas + per-frame `ctx.drawImage` composite onto a 2D main
// canvas is GONE (the "Canvas2D seam" collapse): a transparent Canvas2D overlay
// is stacked above the scene canvas for the few 2D overlays (perf HUD, connectome),
// so there's no copy between them. (R2c-integrate first put the entities over a
// Canvas2D terrain; R2d moved terrain onto the GPU; the seam collapse removed the blit.)
//
// Draw list + terrain mesh are authored in WORLD coordinates; the scene bakes
// the camera's world→device transform (zoom + snapped offset × DPR) into the
// entity instances (CPU) and the terrain uniform (GPU).
//
// Parity: `poly`/`circle` fallback fills now draw on the GPU (`shape-geometry.ts`)
// and entities ride the terrain surface (foot-z lift, `terrain-lift.ts`), so the
// GPU path matches the Canvas2D/Pixi entity passes.

import type { RenderContext } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import type { RenderFn } from '@/render/select-renderer';
import { drawIsoOverlays } from '@/render/iso/iso-overlay';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import { visibleTileBounds } from '@/render/iso/iso-projection';
import { isLayerHidden } from '@/render/layer-visibility';
import { buildEntityDrawList } from '@/render/iso/entity-draw-list';
import { StaticDrawListCache } from '@/render/gpu/static-draw-list-cache';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { buildTerrainField, zoomSuperSample, zoomCoarsenMaxQuads, type TerrainField } from '@/render/gpu/terrain-field';
import { buildDetailField } from '@/render/gpu/detail-field';
import { buildWaterField, type WaterField } from '@/render/gpu/water-field';
import { FlotsamLayer } from '@/render/gpu/flotsam-layer';
import { drawWorldConnectome } from '@/render/connectome-overlay';
import type { GpuScene } from '@/render/gpu/gpu-scene';
import { AdaptiveResolution } from '@/render/gpu/adaptive-resolution';
import { computeView, installRenderProfiler, frameTrace, type LastFrame } from '@/render/gpu/render-profiler';
import { getUiRuntime } from '@/render/ui/ui-runtime';

/** The canvas perf pill (fps + art-pixel scale) is DEV-only — it's the single FPS
 *  readout (the DOM `sg-fps` HUD was retired; no DOM chrome on the game surface). */
function perfHudRequested(): boolean {
  try { return new URLSearchParams(window.location.search).has('dev'); }
  catch { return false; }
}

/** `?connectome` shows the whole-world graph overlay (POIs, roads, settlements). */
function connectomeRequested(): boolean {
  try { return new URLSearchParams(window.location.search).has('connectome'); }
  catch { return false; }
}

/** `?nodetail` turns the adaptive sub-tile detail patches OFF (A/B + preference). */
function detailDisabled(): boolean {
  try { return new URLSearchParams(window.location.search).has('nodetail'); }
  catch { return false; }
}

/**
 * P-E — fixed art-pixel-size override (CSS px per art texel). `?px=N` PINS the
 * resolution (disables adaptation, for A/B and preference); absent ⇒ null, i.e.
 * the adaptive controller drives it — striving for 1:1 and only coarsening while
 * the rate sags below 30 fps, refining back as soon as there's ≥40 fps headroom.
 */
function artPixelOverride(): number | null {
  try {
    const v = new URLSearchParams(window.location.search).get('px');
    if (v !== null) { const n = Math.round(Number(v)); if (Number.isFinite(n) && n >= 1 && n <= 8) return n; }
  } catch { /* no window */ }
  return null;
}


/**
 * Build the game frame closure over a ready GpuScene and the on-screen SCENE
 * canvas it renders to. `ctx` (passed per frame) is the transparent 2D OVERLAY
 * canvas stacked above the scene canvas — the scene draws straight to its swap
 * chain, the overlay only carries the perf HUD + `?connectome` graph. The scene
 * canvas's device backing is kept in sync with the overlay each frame; WebGPU
 * tracks the canvas size, so the swap chain follows.
 */
export function buildGpuRenderFrame(scene: GpuScene, sceneCanvas: HTMLCanvasElement): RenderFn {
  const atlas = createNullAtlas();
  const showConnectome = connectomeRequested();
  const fixedPx = artPixelOverride();
  const adaptive = new AdaptiveResolution();
  let lastFrameStart = 0;
  let fpsEma = 0;
  const showPerfHud = perfHudRequested();   // dev-only single FPS pill
  const ui = getUiRuntime();

  // Deterministic profiler state: the most-recent frame's inputs (so the bench
  // can rebuild fields per art-pixel size) + a guard that pauses the live loop
  // while a profile runs, giving it exclusive GPU access for clean numbers.
  let lastFrame: LastFrame | null = null;
  let profiling = false;
  installRenderProfiler(scene, () => lastFrame, (on) => { profiling = on; });

  // Static (camera-independent) draw layer, cached — built UNCULLED once and reused
  // across pan/zoom so the ~293ms/frame rebuild over ~10k flora the profiler found
  // is paid once, not per frame. `window.__invalidateDrawCache()` is the manual/seam
  // escape hatch the dirty-region substrate (docs) will drive.
  const staticCache = new StaticDrawListCache();
  (window as unknown as { __invalidateDrawCache?: () => void }).__invalidateDrawCache =
    () => staticCache.invalidate();
  // Cosmetic flow-advected particles (S6), owning their own seed + step timing.
  const flotsam = new FlotsamLayer();
  return function renderMap(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    if (profiling) return; // a profile run owns the GPU; skip the live frame
    const { camera, canvasWidth, canvasHeight, map } = rc;
    // `target` is the SCENE canvas (the WebGPU swap chain we render into); `ctx` is
    // the transparent 2D overlay above it. They share a device-pixel backing size.
    const target = sceneCanvas;
    // The overlay ctx carries an outer devicePixelRatio scale; recover it from the
    // backing-store size so the transform lands on device pixels.
    const dpr = canvasWidth > 0 ? target.width / canvasWidth : 1;

    // Target is TRUE 1:1 (one art texel per CSS px). The adaptive controller holds
    // that 1:1 steady-state and only TEMPORARILY drops the raster resolution to
    // keep pan/zoom responsive on a slow machine, refining back to 1:1 once the
    // frame budget recovers — it's a responsiveness fallback, not a quality knob.
    // `?px=N` pins a fixed size for A/B + the deterministic profiler.
    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    const frameDt = lastFrameStart > 0 ? nowMs - lastFrameStart : 16.7;
    lastFrameStart = nowMs;
    const px = fixedPx ?? adaptive.step(frameDt);

    // Wipe the transparent overlay so last frame's HUD/connectome don't smear; the
    // GPU scene (which clears to deep-ocean) shows through everywhere the overlay
    // doesn't draw. No background fill here — that's the scene's clear colour now.
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const tPhase0 = performance.now();
    const bounds = visibleTileBounds(
      { originX: -camera.x, originY: -camera.y },
      canvasWidth / camera.zoom,
      canvasHeight / camera.zoom,
      { mapW: map.width, mapH: map.height },
    );
    const ic = { atlas, originX: 0, originY: 0, npcSheets: rc.npcSheets };

    // Static layer (flora/buildings/deco/roads) is camera-independent and changes
    // only when the world does — the cache builds it UNCULLED once and reuses it,
    // so the ~293ms/frame rebuild over ~10k flora the profiler found is paid once.
    // Its array identity is stable across reuse (a new array only when the world
    // changed), so the scene can key the instance pack off it. The moving NPC layer
    // is re-emitted cheaply every frame and appended (it draws over static — exact
    // depth interleave is a follow-up).
    const staticList: DrawItem[] = staticCache.get(rc, map, ic);
    const npcItems = buildEntityDrawList(rc, bounds, ic, { only: 'npcs' });
    const tDrawList = performance.now();

    // GPU terrain + entity passes render straight to the scene canvas's swap chain
    // (sized by Game.resize). No offscreen canvas, no per-frame composite.
    const lighting = rc.lighting ?? DEFAULT_LIGHTING;
    // P-E: render the scene into a low-res target (`S` device px per art texel,
    // integer for crisp nearest upscaling), then blit up to the device. The
    // world→target transform is divided by `S`; offsets are snapped to the art
    // texel grid in low-res space so pixels stay stable under pan/zoom.
    const { lowW, lowH, xform } = computeView(px, camera, dpr, target.width, target.height);

    // ZOOM-LOD (Slice 2): one mesh subdivision for BOTH terrain + water this frame, so
    // their shared grid keeps waterlines aligned. Zoomed in → finer mesh (smooth banks),
    // zoomed out → 1 quad/tile. A studio `terrainSuper` override pins it for A/B.
    const superSample = rc.devMode?.terrainSuper ?? zoomSuperSample(map.width, map.height, xform.sx);
    // Zoom-out half of the LOD: a shared quad cap so terrain + water coarsen to the SAME
    // subsample when a tile is sub-pixel-ish (one quad/tile is then wasted geometry, and
    // the water pass is primitive-bound — a large win at no visible cost). Pinned super
    // (studio A/B) keeps the full mesh so the override stays honest.
    const meshMaxQuads = rc.devMode?.terrainSuper != null
      ? undefined
      : zoomCoarsenMaxQuads(map.width, map.height, xform.sx);

    // Buffer-driven terrain field (T1): the GPU generates + lifts the grid from
    // the height/colour storage buffers. VIEWPORT MESH CULL (T5): emit only the quads
    // under the visible-tile rect (the ±2 slack absorbs the half-tile iso offset +
    // coarsen-lattice snap; `buildTerrainField` adds the down-screen lift margin for
    // tall peaks). `bounds` clamps to the map, so at fit-zoom this IS the whole map.
    const terrainWindow = {
      minTx: bounds.minTx - 2, minTy: bounds.minTy - 2,
      maxTx: bounds.maxTx + 2, maxTy: bounds.maxTy + 2,
    };
    const terrain: TerrainField | null = isLayerHidden('terrain', rc.devMode)
      ? null
      : buildTerrainField(map, {
          viewport: [lowW, lowH],
          xform, lighting, devMode: rc.devMode,
          terrainMode: rc.devMode?.terrainMode,
          superSample, maxQuads: meshMaxQuads, window: terrainWindow,
          // DIR-A: author-placed lakes paint their beds damp too (studio editing).
          connectomeWater: rc.connectomeWater,
        });
    // Adaptive sub-tile detail patches (the px4-3-2-1 idea): a finer instanced mesh
    // with GENUINE analytic relief, overlaid ONLY on the hot regions (coast/carve/
    // slope). Always on now (was zoom ≥ 2) so the road/river carve banks keep their
    // refined mesh at every zoom; the field is memoised per map and covers only the
    // hot regions, and `?nodetail` is the escape hatch. Sub-pixel at extreme
    // overview — the adaptive art-pixel resolution absorbs the cost.
    const detail = (terrain && !detailDisabled())
      ? buildDetailField(map, rc.connectomeWater)
      : null;
    const tTerrain = performance.now();

    // Water surface (S2): null when the layer is hidden, there's no terrain to
    // read depth from, or the world is dry. Ripple time is pure render (never the
    // sim clock), so a wall-clock seconds value is fine here.
    const timeSec = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.001;
    // Inland water level (drought/flood): shifts river + lake surfaces. Sea is fixed.
    const waterLevelM = rc.waterLevelM ?? 0;
    // Sea & lakes: gated by its own `showWater` flag (nulling it also drops the
    // ocean backdrop, since both key off hasWater) — distinct from the river ribbon.
    const waterOn = rc.devMode?.showWater !== false && !isLayerHidden('rivers', rc.devMode);
    // VIEWPORT MESH CULL (T5, water half): the water pass is the dominant primitive-bound
    // cost at gameplay zoom — ~104k full-map quads/frame, nearly all off-screen (the pass
    // measured ~49 ms / ~15 fps on a gen-8 iGPU zoomed into a settlement). Water sits on
    // the flat sea-level plane, so the visible-tile rect (`bounds`, screen corners inverse-
    // projected onto z=0) is an EXACT cull window — no height-lift margin needed. A couple
    // of tiles of slack absorb the half-tile iso offset + the coarsen-lattice snap; `bounds`
    // already clamps to the map, so at fit-zoom the window IS the whole map (byte-identical).
    const waterWindow = {
      minTx: bounds.minTx - 2, minTy: bounds.minTy - 2,
      maxTx: bounds.maxTx + 2, maxTy: bounds.maxTy + 2,
    };
    const water: WaterField | null = (terrain && waterOn)
      ? buildWaterField(map, {
          viewport: [lowW, lowH], xform, lighting, timeSec, waterLevelM,
          // Same zoom-LOD grid as terrain (Slice 2) — aligned waterlines.
          superSample, maxQuads: meshMaxQuads, window: waterWindow,
          // Localized per-basin level (climate W-B) — rain filling one lake.
          lakeOffsetM: rc.lakeOffsetM,
          // Per-cell standing water (W-E) — a god flooding a plain.
          floodOffsetM: rc.floodOffsetM,
          // DIR-A: author-placed connectome lakes render as real still water.
          connectomeWater: rc.connectomeWater,
          // Studio realtime: analytic river channel from the LIVE edited network, so a
          // dragged node re-projects the smooth silhouette instantly (game path: omit →
          // memoised geometry).
          riverChannel: rc.riverChannel,
        })
      : null;

    // RIBBONS RETIRED (2026-06-25): roads are no longer drawn as ribbons (the road/river
    // ribbon pass was removed as tech debt). A road IS the terrain — carved by
    // `road-deformation` and textured by the terrain shader from the analytic road
    // feature geometry (pavedness by distance) + the material-exemplar atlas (dirt →
    // cobble). Bridges over water
    // will return as 3D-modelled, img2img'd structures sited as a PLACE
    // (river-crossings-generative-sites), like buildings/trees. Rivers render through the
    // per-cell water pass.

    // Flotsam/fauna (S6): step + emit cosmetic circles on the water surface.
    // Appended after the entity list so they composite over the water; the
    // renderer doesn't terrain-lift `circle` items, so they keep their surface z.
    let dynamicItems: readonly DrawItem[] = npcItems;
    if (water) dynamicItems = [...npcItems, ...flotsam.items(map, timeSec)];

    // Studio mode renders the bare scene (terrain + entities) — no game HUD/minimap
    // and no built-in iso/connectome overlays; the studio owns its own 2D overlay.
    const chrome = !(rc as { studioNoChrome?: boolean }).studioNoChrome;
    const uiGroups = chrome ? ui.frame(target.width, target.height, dpr) : [];
    const tFields = performance.now();

    scene.renderFrame({
      items: dynamicItems, staticItems: staticList, lighting, terrain, detail, water,
      w: lowW, h: lowH, out: { w: target.width, h: target.height },
      xform, uiGroups,
      ...(chrome ? null : { passes: { ui: false } }),
    });
    const tRender = performance.now();

    // Capture inputs for the deterministic profiler (rebuilds fields per px).
    lastFrame = {
      rc, dpr, targetW: target.width, targetH: target.height,
      items: dynamicItems, staticItems: staticList,
    };

    // No composite: the scene is already on screen (its own swap chain). The 2D
    // overlays draw straight onto the transparent overlay ctx above it.
    const tComposite = performance.now();

    if (chrome) {
      drawIsoOverlays(ctx, rc);
      if (showConnectome) drawWorldConnectome(ctx, rc);
    }
    const tOverlay = performance.now();

    // Live-frame phase breakdown (free when the trace is off).
    frameTrace.record({
      drawList: tDrawList - tPhase0,
      terrain: tTerrain - tDrawList,
      water: tFields - tTerrain,
      render: tRender - tFields,
      composite: tComposite - tRender,
      overlay: tOverlay - tComposite,
      total: tOverlay - tPhase0,
    });

    // FPS + art-pixel-scale readout (top-right), smoothed so it doesn't jitter.
    // Dev-only — the single FPS counter (the DOM HUD was removed).
    const fps = 1000 / Math.max(1, frameDt);
    fpsEma = fpsEma > 0 ? fpsEma * 0.9 + fps * 0.1 : fps;
    if (showPerfHud) drawPerfHud(ctx, canvasWidth, fpsEma, px, fixedPx !== null);
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
