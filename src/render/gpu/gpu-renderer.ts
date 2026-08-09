// src/render/gpu/gpu-renderer.ts
//
// Capability routing for the WebGPU scene renderer (the only scene renderer).
//
// The game is WebGPU-only: there is no Canvas2D/Pixi scene fallback. If WebGPU is
// unavailable (no `navigator.gpu`) or scene init fails (no adapter/device), we
// surface an honest "WebGPU required" message on the canvas instead of silently
// degrading — keeping one rendering path and no parity tax.

import type { RenderFn } from '@/render/select-renderer';
import type { MetaRenderFn } from '@/render/gpu/gpu-render-frame';
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
  /** Build the real WebGPU scene's render + meta-render pair. */
  makeGpuScene?: (canvas?: HTMLCanvasElement) => Promise<{ render: RenderFn; renderMeta: MetaRenderFn }>;
  /** The on-screen canvas WebGPU binds to. The scene renders straight to its swap
   *  chain (no offscreen copy). Omitted ⇒ an offscreen canvas is created (the old
   *  blit-onto-2D path, kept for the studio + any caller that lacks a live canvas). */
  canvas?: HTMLCanvasElement;
}

/**
 * Default GPU scene factory: bind WebGPU to the supplied on-screen canvas (or an
 * offscreen one when none is given), bring up the device, and build the frame
 * closures. Throws on any unavailability (no document, no adapter/device) so
 * `createGpuRenderMap` reports `unavailable`. In Node/jsdom there's no real
 * WebGPU, so this throws.
 */
async function defaultGpuScene(canvas?: HTMLCanvasElement): Promise<{ render: RenderFn; renderMeta: MetaRenderFn }> {
  if (typeof document === 'undefined') throw new Error('no document for GPU canvas');
  const target = canvas ?? document.createElement('canvas');
  const { initWebGpu } = await import('@/render/gpu/webgpu-context');
  const gpu = await initWebGpu(target);
  // This string is shown to the PLAYER (it becomes the overlay's reason line), so
  // it names the usual cause rather than the internal symptom. The desktop build
  // ships Dawn, but Dawn still needs a working Vulkan driver underneath it.
  if (!gpu) throw new Error('No GPU adapter available — on Linux this usually means no working Vulkan driver.');
  const { GpuScene } = await import('@/render/gpu/gpu-scene');
  const { buildGpuRenderFrame } = await import('@/render/gpu/gpu-render-frame');
  return buildGpuRenderFrame(new GpuScene(gpu), target);
}

/** The honest "WebGPU required" notice, painted into a 2D context. Shared by BOTH
 *  render modes so neither can silently lose it. */
function paintUnavailable(ctx: CanvasRenderingContext2D, w: number, h: number, reason: string): void {
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
}

/** A RenderFn that paints an honest "WebGPU required" message — used when the
 *  GPU scene can't be built (no WebGPU support / init failure). */
function unavailableRenderFn(reason: string): RenderFn {
  return (ctx: CanvasRenderingContext2D, rc: RenderContext): void => {
    paintUnavailable(ctx, rc.canvasWidth, rc.canvasHeight, reason);
  };
}

/**
 * A `MetaRenderFn` that paints the SAME message on the scene canvas.
 *
 * This used to be a no-op, on the reasoning that world mode's overlay already
 * carried the message — but meta mode (title screen, no world) is the FIRST thing
 * a launch paints, and world mode is unreachable from it: starting a world needs a
 * button that a dead renderer never drew. So a machine without WebGPU showed a
 * BLANK window and no explanation (reported 2026-08-09 as a white screen on the
 * v0.1.0 Linux AppImage — Electron bundles Dawn, but Dawn still needs a working
 * Vulkan driver). The message belongs on whichever mode is actually on screen.
 *
 * Painting 2D on the scene canvas is safe here: `initWebGpu` only binds a webgpu
 * context AFTER the adapter and device resolve, so both real failure modes (no
 * `navigator.gpu`; `requestAdapter()` → null) return with the canvas untouched.
 * If a later-stage failure did bind it, `getContext('2d')` returns null and we
 * degrade to the old no-op rather than throwing in the frame loop.
 */
function unavailableRenderMetaFn(reason: string, canvas?: HTMLCanvasElement): MetaRenderFn {
  return (): void => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    paintUnavailable(ctx, canvas.width, canvas.height, reason);
  };
}

/**
 * Resolve the scene render + meta-render pair and report which backend won.
 * Builds the WebGPU scene; on missing support or init failure BOTH modes get the
 * honest "WebGPU required" overlay — never a black or blank screen, and never a
 * silent one. The `backend` tag feeds the dev HUD / telemetry / tests.
 */
export async function createGpuRenderMap(
  deps: GpuRenderDeps = {},
): Promise<{ render: RenderFn; renderMeta: MetaRenderFn; backend: GpuBackend }> {
  const probe = deps.probe ?? hasWebGpu;
  const makeGpuScene = deps.makeGpuScene ?? defaultGpuScene;

  if (!probe()) {
    const reason = 'This browser does not expose navigator.gpu.';
    return {
      render: unavailableRenderFn(reason),
      renderMeta: unavailableRenderMetaFn(reason, deps.canvas),
      backend: 'unavailable',
    };
  }
  try {
    const { render, renderMeta } = await makeGpuScene(deps.canvas);
    return { render, renderMeta, backend: 'webgpu' };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'GPU initialisation failed.';
    return {
      render: unavailableRenderFn(reason),
      renderMeta: unavailableRenderMetaFn(reason, deps.canvas),
      backend: 'unavailable',
    };
  }
}
