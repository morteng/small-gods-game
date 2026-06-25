// src/render/gpu/render-profiler.ts
//
// Deterministic GPU bench for the WebGPU scene. gen-8 iGPUs (our floor) do NOT
// expose `timestamp-query`, so per-pass cost is attributed by ABLATION: render a
// FIXED scene with each pass toggled off and diff against the all-on baseline,
// timing total work via `queue.onSubmittedWorkDone()` (CPU encode vs GPU exec are
// separated by GpuScene.profile). The live loop is paused while a run is in
// flight so the bench has exclusive GPU access → low-noise numbers.
//
// Exposed as `window.__renderProfile(opts?)` for the console / Playwright MCP, so
// the same harness runs headless AND on a player's machine — the only honest way
// to find the bottleneck on hardware we can't introspect.

import type { RenderContext } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';
import type { GpuScene } from '@/render/gpu/gpu-scene';
import { buildTerrainField, zoomSuperSample, zoomCoarsenMaxQuads } from '@/render/gpu/terrain-field';
import { buildWaterField } from '@/render/gpu/water-field';
import { visibleTileBounds } from '@/render/iso/iso-projection';
import { isLayerHidden } from '@/render/layer-visibility';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';

/** The most-recent rendered frame's inputs — enough to rebuild fields per px.
 *  `items` is the per-frame dynamic layer; `staticItems` is the cached static
 *  layer (so the bench measures the SAME static-bundle path the live loop uses). */
export interface LastFrame {
  rc: RenderContext;
  dpr: number;
  targetW: number;
  targetH: number;
  items: readonly DrawItem[];
  staticItems?: readonly DrawItem[];
}

/**
 * P-E view math: art-pixel size `px` → low-res scene dims + world→low-res xform +
 * output (swapchain) dims. `S` = integer device px per art texel (crisp nearest
 * scaling), offsets snapped to the texel grid. Shared by the hot path and the
 * bench so they agree exactly.
 */
export function computeView(
  px: number, camera: { x: number; y: number; zoom: number }, dpr: number,
  targetW: number, targetH: number,
): {
  lowW: number; lowH: number;
  xform: { sx: number; sy: number; ox: number; oy: number };
  out: { w: number; h: number };
} {
  const z = camera.zoom;
  const S = Math.max(1, Math.round(px * dpr));
  const lowW = Math.max(1, Math.ceil(targetW / S));
  const lowH = Math.max(1, Math.ceil(targetH / S));
  const sLow = (z * dpr) / S;
  return {
    lowW, lowH,
    xform: {
      sx: sLow, sy: sLow,
      ox: Math.round(-camera.x * z * dpr / S),
      oy: Math.round(-camera.y * z * dpr / S),
    },
    out: { w: targetW, h: targetH },
  };
}

export interface ProfileRow {
  label: string; cpuMs: number; gpuMs: number; totalMs: number; fps: number;
}

/**
 * Live-frame phase accumulator. The render bench (GpuScene.profile) isolates the
 * GPU work but EXCLUDES per-frame CPU the live loop pays every frame: draw-list
 * build, terrain/water field build, the Canvas2D composite of the GPU canvas, and
 * overlays. This captures those from the real loop — including while the camera
 * zooms and content streams in — which is where the felt frame rate actually
 * lives. `record()` early-returns when off, so it's free on the hot path.
 */
export const frameTrace = {
  on: false,
  n: 0,
  sums: {} as Record<string, number>,
  max: {} as Record<string, number>,
  record(phases: Record<string, number>): void {
    if (!this.on) return;
    this.n++;
    for (const k in phases) {
      this.sums[k] = (this.sums[k] ?? 0) + phases[k];
      this.max[k] = Math.max(this.max[k] ?? 0, phases[k]);
    }
  },
  reset(): void { this.n = 0; this.sums = {}; this.max = {}; },
  report(): { frames: number; avgMs: Record<string, number>; maxMs: Record<string, number>; avgFps: number } {
    const avgMs: Record<string, number> = {};
    const maxMs: Record<string, number> = {};
    const r = (x: number) => Math.round(x * 100) / 100;
    for (const k in this.sums) avgMs[k] = r(this.sums[k] / Math.max(1, this.n));
    for (const k in this.max) maxMs[k] = r(this.max[k]);
    return { frames: this.n, avgMs, maxMs, avgFps: avgMs.total ? Math.round(1000 / avgMs.total * 10) / 10 : 0 };
  },
};

type PassToggles = Parameters<GpuScene['renderFrame']>[0]['passes'];

/**
 * Run the standard matrix on the captured frame: a px sweep (1–4) to separate
 * fill-rate from CPU cost, plus per-pass ablation at px2 to attribute GPU cost.
 * Returns one row per variant (sorted as issued) — read it from the console /
 * Playwright. `frames`/`warmup` tune the averaging.
 */
async function runMatrix(
  scene: GpuScene, lf: LastFrame, frames: number, warmup: number,
): Promise<ProfileRow[]> {
  const { rc, dpr, targetW, targetH } = lf;
  const map = rc.map;
  const camera = rc.camera;
  const lighting = rc.lighting ?? DEFAULT_LIGHTING;

  const build = (px: number, passes?: PassToggles): Parameters<GpuScene['renderFrame']>[0] => {
    const { lowW, lowH, xform, out } = computeView(px, camera, dpr, targetW, targetH);
    // Mirror the live frame's zoom-LOD so the bench measures the REAL mesh (the live
    // loop coarsens terrain + water when zoomed out — without this the bench always
    // rebuilt the full subsample-1 grid and over-reported the water pass).
    const superSample = rc.devMode?.terrainSuper ?? zoomSuperSample(map.width, map.height, xform.sx);
    const maxQuads = rc.devMode?.terrainSuper != null
      ? undefined
      : zoomCoarsenMaxQuads(map.width, map.height, xform.sx);
    const terrain = isLayerHidden('terrain', rc.devMode)
      ? null
      : buildTerrainField(map, { viewport: [lowW, lowH], xform, lighting, devMode: rc.devMode, superSample, maxQuads });
    // Mirror the live frame's WATER viewport cull (gpu-render-frame): build the water mesh
    // over the visible tile window only, else the bench rebuilds the full-map mesh and over-
    // reports the (now culled) water pass — the same trap the zoom-LOD mirror above fixes.
    const cw = targetW / dpr, chh = targetH / dpr;
    const b = visibleTileBounds(
      { originX: -camera.x, originY: -camera.y }, cw / camera.zoom, chh / camera.zoom,
      { mapW: map.width, mapH: map.height },
    );
    const window = { minTx: b.minTx - 2, minTy: b.minTy - 2, maxTx: b.maxTx + 2, maxTy: b.maxTy + 2 };
    const water = (terrain && !isLayerHidden('rivers', rc.devMode))
      ? buildWaterField(map, { viewport: [lowW, lowH], xform, lighting, timeSec: 0, superSample, maxQuads, window })
      : null;
    return { items: lf.items, staticItems: lf.staticItems, lighting, terrain, water, w: lowW, h: lowH, out, xform, passes };
  };

  const variants: { label: string; opts: Parameters<GpuScene['renderFrame']>[0] }[] = [
    { label: 'px1 (all)', opts: build(1) },
    { label: 'px2 (all)', opts: build(2) },
    { label: 'px3 (all)', opts: build(3) },
    { label: 'px4 (all)', opts: build(4) },
    { label: 'px2 -water', opts: build(2, { water: false }) },
    { label: 'px2 -shadows', opts: build(2, { shadows: false }) },
    { label: 'px2 -entities', opts: build(2, { entities: false }) },
    { label: 'px2 -terrain&water', opts: build(2, { terrain: false }) },
    { label: 'px2 bare (clear+blit+ui)', opts: build(2, { terrain: false, water: false, shadows: false, entities: false }) },
  ];
  return scene.profile(variants, frames, warmup);
}

/**
 * Attach `window.__renderProfile(opts?)`. `getLastFrame` returns the captured
 * inputs (null until the first frame); `setProfiling(true/false)` pauses/resumes
 * the live loop around the run.
 */
export function installRenderProfiler(
  scene: GpuScene,
  getLastFrame: () => LastFrame | null,
  setProfiling: (on: boolean) => void,
): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __renderProfile?: unknown; __renderTrace?: unknown;
    __game?: { newWorld?: () => void; regenerate?: () => void };
  };

  // Isolated GPU bench: px sweep + per-pass ablation on the captured frame.
  w.__renderProfile = async (opts?: { frames?: number; warmup?: number }): Promise<ProfileRow[] | { error: string }> => {
    const lf = getLastFrame();
    if (!lf) return { error: 'no frame captured yet — let the game render first' };
    setProfiling(true);
    try {
      const rows = await runMatrix(scene, lf, opts?.frames ?? 30, opts?.warmup ?? 8);
      return rows.map(r => ({
        label: r.label,
        cpuMs: Math.round(r.cpuMs * 100) / 100,
        gpuMs: Math.round(r.gpuMs * 100) / 100,
        totalMs: Math.round(r.totalMs * 100) / 100,
        fps: Math.round(r.fps * 10) / 10,
      }));
    } finally {
      setProfiling(false);
    }
  };

  // Live-frame phase trace over a scripted scenario (the loop keeps running and
  // records each frame's phase breakdown). `zoom` oscillates the camera; `load`
  // triggers a fresh worldgen mid-run so "zooming during content load" is
  // measured, not hand-waved. Resolves with averaged + worst-case phase ms.
  w.__renderTrace = async (
    opts?: { ms?: number; zoom?: boolean; load?: boolean },
  ): Promise<ReturnType<typeof frameTrace.report> | { error: string }> => {
    const lf = getLastFrame();
    if (!lf) return { error: 'no frame captured yet — let the game render first' };
    const cam = lf.rc.camera;
    const ms = opts?.ms ?? 2500;
    const zoom = opts?.zoom ?? true;
    const startZoom = cam.zoom;
    frameTrace.reset();
    frameTrace.on = true;
    if (opts?.load) { w.__game?.newWorld?.(); w.__game?.regenerate?.(); }
    return new Promise(resolve => {
      const t0 = performance.now();
      const tick = (): void => {
        const t = (performance.now() - t0) / ms;
        // Oscillate zoom 0.5×–2.5× of the starting zoom (a full pinch sweep).
        if (zoom) cam.zoom = startZoom * (1 + 0.75 * Math.sin(t * Math.PI * 2)) + 0.001;
        if (t >= 1) {
          frameTrace.on = false;
          if (zoom) cam.zoom = startZoom;
          resolve(frameTrace.report());
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  };
}
