// src/render/gpu/gpu-renderer.ts
//
// Capability routing for the WebGPU scene renderer (the only scene renderer).
//
// The game is WebGPU-only: there is no Canvas2D/Pixi scene fallback. If WebGPU is
// unavailable (no `navigator.gpu`) or scene init fails (no adapter/device), we
// surface an honest "WebGPU required" message on the canvas instead of silently
// degrading — keeping one rendering path and no parity tax.

import type { RenderFn } from '@/render/select-renderer';
import type { RenderContext } from '@/core/types';

export type GpuBackend = 'webgpu' | 'unavailable';

/**
 * Synchronous capability probe: WebGPU object exposed on the navigator.
 * The async adapter/device request happens later, at scene init; a present
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
  /** Override the capability probe (tests). */
  probe?: () => boolean;
  /** Build the real WebGPU scene RenderFn. */
  makeGpuScene?: (canvas?: HTMLCanvasElement) => Promise<RenderFn>;
  /** The on-screen canvas WebGPU binds to. The scene renders straight to its swap
   *  chain (no offscreen copy). Omitted ⇒ an offscreen canvas is created (the old
   *  blit-onto-2D path, kept for the studio + any caller that lacks a live canvas). */
  canvas?: HTMLCanvasElement;
}

/**
 * Default GPU scene factory: bind WebGPU to the supplied on-screen canvas (or an
 * offscreen one when none is given), bring up the device, and build the frame
 * closure. Throws on any unavailability (no document, no adapter/device) so
 * `createGpuRenderMap` reports `unavailable`. In Node/jsdom there's no real
 * WebGPU, so this throws.
 */
async function defaultGpuScene(canvas?: HTMLCanvasElement): Promise<RenderFn> {
  if (typeof document === 'undefined') throw new Error('no document for GPU canvas');
  const target = canvas ?? document.createElement('canvas');
  const { initWebGpu } = await import('@/render/gpu/webgpu-context');
  const gpu = await initWebGpu(target);
  if (!gpu) throw new Error('WebGPU init returned null');
  const { GpuScene } = await import('@/render/gpu/gpu-scene');
  const { buildGpuRenderFrame } = await import('@/render/gpu/gpu-render-frame');
  return buildGpuRenderFrame(new GpuScene(gpu), target);
}

/** A RenderFn that paints an honest "WebGPU required" message — used when the
 *  GPU scene can't be built (no WebGPU support / init failure). */
function unavailableRenderFn(reason: string): RenderFn {
  return (ctx: CanvasRenderingContext2D, rc: RenderContext): void => {
    const { canvasWidth: w, canvasHeight: h } = rc;
    ctx.save();
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8e6f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('WebGPU is required to render this game.', w / 2, h / 2 - 12);
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillStyle = '#9a98a8';
    ctx.fillText(reason, w / 2, h / 2 + 12);
    ctx.restore();
  };
}

/**
 * Resolve the scene RenderFn and report which backend won. Builds the WebGPU
 * scene; on missing support or init failure returns the `unavailable` overlay
 * (never a black screen). The `backend` tag feeds the dev HUD / telemetry / tests.
 */
export async function createGpuRenderMap(
  deps: GpuRenderDeps = {},
): Promise<{ render: RenderFn; backend: GpuBackend }> {
  const probe = deps.probe ?? hasWebGpu;
  const makeGpuScene = deps.makeGpuScene ?? defaultGpuScene;

  if (!probe()) {
    return { render: unavailableRenderFn('This browser does not expose navigator.gpu.'), backend: 'unavailable' };
  }
  try {
    return { render: await makeGpuScene(deps.canvas), backend: 'webgpu' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'GPU initialisation failed.';
    return { render: unavailableRenderFn(reason), backend: 'unavailable' };
  }
}
