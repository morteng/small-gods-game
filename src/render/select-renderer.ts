// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';
// Type-only: erased at compile time, so this doesn't eagerly pull the GPU
// module into every bundle path — the actual GPU code is still loaded lazily
// below via a dynamic import, exactly as before.
import type { MetaRenderFn } from '@/render/gpu/gpu-render-frame';

export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;
export type { MetaRenderFn };

/** What `selectRenderer` hands back: the world-mode `render` closure (unchanged
 *  shape/behaviour) plus the meta-mode (world-less, title-screen) `renderMeta`
 *  closure (P1-C). `FrameRenderer`/the studio only ever destructure `render`,
 *  so this widening is backward compatible for every existing caller. */
export interface SelectedRenderers {
  render: RenderFn;
  renderMeta: MetaRenderFn;
}

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
 *
 * Returns `{ render, renderMeta }` (P1-C): `render` is the unchanged world-mode
 * `RenderFn`; `renderMeta` draws the world-less title-screen sky + UI. When
 * WebGPU is UNAVAILABLE, `renderMeta` is a no-op — the honest "WebGPU required"
 * message already comes from `render`'s fallback overlay, and meta mode has
 * nothing else to paint without a GPU scene.
 */
export async function selectRenderer(sceneCanvas?: HTMLCanvasElement): Promise<SelectedRenderers> {
  const { createGpuRenderMap } = await import('@/render/gpu/gpu-renderer');
  const { render, renderMeta } = await createGpuRenderMap({ canvas: sceneCanvas });
  return { render, renderMeta };
}
