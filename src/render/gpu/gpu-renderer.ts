// src/render/gpu/gpu-renderer.ts
//
// R2a — capability routing for the `?render=gpu` path (unified-renderer epic).
//
// The GPU scene itself (instanced WGSL lit quads + per-vertex-z terrain) lands in
// R2b–R2e. This slice is the *foundation*: probe WebGPU and decide which RenderFn
// backs `?render=gpu`. The load-bearing guarantee from the spec — "no-WebGPU clients
// get the existing unlit Canvas2D path, never a black screen" — lives here and is
// fully testable with no GPU present (jsdom has no `navigator.gpu`).

import type { RenderFn } from '@/render/select-renderer';

export type GpuBackend = 'webgpu' | 'canvas2d';

/**
 * Synchronous capability probe: WebGPU object exposed on the navigator.
 * The async adapter/device request happens later, at scene init (R2c); a present
 * `navigator.gpu` is necessary but not sufficient, so scene init still guards.
 */
export function hasWebGpu(
  nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined,
): boolean {
  return (
    !!nav &&
    typeof nav === 'object' &&
    'gpu' in nav &&
    (nav as { gpu?: unknown }).gpu != null
  );
}

export interface GpuRenderDeps {
  /** Override the capability probe (tests / a forced-fallback dev toggle). */
  probe?: () => boolean;
  /** Build the Canvas2D parity fallback RenderFn (the iso path). */
  makeFallback?: () => Promise<RenderFn>;
  /**
   * Build the real WebGPU scene RenderFn. Absent until R2c is wired — until then
   * even a WebGPU-capable client routes to the parity path so `main` never breaks.
   */
  makeGpuScene?: () => Promise<RenderFn>;
}

async function defaultFallback(): Promise<RenderFn> {
  const { createIsoRenderMap } = await import('@/render/iso/iso-renderer');
  return createIsoRenderMap();
}

/**
 * Default GPU scene factory (R2c): create an overlay canvas, bring up WebGPU,
 * and build the real frame closure. Throws on any unavailability so
 * `createGpuRenderMap` routes to the Canvas2D parity path (never a black
 * screen). In Node/jsdom there's no real WebGPU, so this throws → fallback.
 */
async function defaultGpuScene(): Promise<RenderFn> {
  if (typeof document === 'undefined') throw new Error('no document for GPU canvas');
  const canvas = document.createElement('canvas');
  const { initWebGpu } = await import('@/render/gpu/webgpu-context');
  const gpu = await initWebGpu(canvas);
  if (!gpu) throw new Error('WebGPU init returned null');
  const { GpuScene } = await import('@/render/gpu/gpu-scene');
  const { buildGpuRenderFrame } = await import('@/render/gpu/gpu-render-frame');
  return buildGpuRenderFrame(new GpuScene(gpu), canvas);
}

/**
 * Resolve the RenderFn for `?render=gpu` and report which backend won.
 *
 * Routes to the Canvas2D fallback when WebGPU is absent or if GPU scene
 * construction throws (no adapter/device/document) — guaranteeing a drawn frame
 * in every case. The `backend` tag feeds the dev HUD / telemetry / tests.
 */
export async function createGpuRenderMap(
  deps: GpuRenderDeps = {},
): Promise<{ render: RenderFn; backend: GpuBackend }> {
  const probe = deps.probe ?? hasWebGpu;
  const makeFallback = deps.makeFallback ?? defaultFallback;
  const makeGpuScene = deps.makeGpuScene ?? defaultGpuScene;

  if (!probe()) {
    return { render: await makeFallback(), backend: 'canvas2d' };
  }
  try {
    return { render: await makeGpuScene(), backend: 'webgpu' };
  } catch {
    // Any GPU init failure (adapter/device/shader/no-document) must never blank
    // the screen — route to the Canvas2D parity path during migration.
    return { render: await makeFallback(), backend: 'canvas2d' };
  }
}
