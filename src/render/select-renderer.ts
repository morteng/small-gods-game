// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';

export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/**
 * Build the scene renderer. The game is WebGPU-only: the scene (terrain
 * heightfield + y-sorted entity draw list) renders on the raw-WebGPU path
 * (`gpu-renderer.ts` → `gpu-scene.ts`); the Canvas2D 2D context is used only for
 * UI/overlay compositing on top. The legacy Canvas2D/Pixi scene backends and the
 * `?render=` mode switch were retired in the WebGPU-only cut.
 */
export async function selectRenderer(): Promise<RenderFn> {
  const { createGpuRenderMap } = await import('@/render/gpu/gpu-renderer');
  const { render } = await createGpuRenderMap();
  return render;
}
