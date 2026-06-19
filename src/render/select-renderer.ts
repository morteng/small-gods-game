// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';

export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/**
 * Build the scene renderer. The game is WebGPU-only: the scene (terrain
 * heightfield + y-sorted entity draw list) renders on the raw-WebGPU path
 * (`gpu-renderer.ts` → `gpu-scene.ts`) STRAIGHT to `sceneCanvas`'s swap chain —
 * no offscreen copy. A transparent Canvas2D overlay stacked above it carries the
 * 2D overlays. The legacy Canvas2D/Pixi scene backends and the `?render=` mode
 * switch were retired in the WebGPU-only cut.
 *
 * `sceneCanvas` is the on-screen canvas WebGPU binds to; omit it (tests/headless)
 * and the GPU layer falls back to its own offscreen canvas.
 */
export async function selectRenderer(sceneCanvas?: HTMLCanvasElement): Promise<RenderFn> {
  const { createGpuRenderMap } = await import('@/render/gpu/gpu-renderer');
  const { render } = await createGpuRenderMap({ canvas: sceneCanvas });
  return render;
}
