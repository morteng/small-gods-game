import { describe, it, expect } from 'vitest';
import { selectRenderer } from '@/render/select-renderer';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';

// P1-C — `selectRenderer` widened from `Promise<RenderFn>` to
// `Promise<{ render, renderMeta }>` (spec §3.1). Headless Node/jsdom has no
// `navigator.gpu`, so this suite can only exercise the WebGPU-UNAVAILABLE
// path — the honest "WebGPU required" `render` overlay plus a no-op
// `renderMeta` (meta mode has nothing to paint without a GPU scene). The
// live-GPU path (renderMeta actually drawing the sky + UI) is unreachable
// here by construction and is NOT asserted.
describe('selectRenderer — shape', () => {
  it('resolves { render, renderMeta } as functions when called for real '
    + '(jsdom has no navigator.gpu, so this naturally takes the unavailable path)', async () => {
    const { render, renderMeta } = await selectRenderer();
    expect(typeof render).toBe('function');
    expect(typeof renderMeta).toBe('function');
    // renderMeta must be safely callable and do nothing (no canvas/GPU device exists).
    expect(() => renderMeta({ nowMs: 0 })).not.toThrow();
  });

  it('the unavailable path (deterministically forced via the GpuRenderDeps probe seam '
    + 'gpu-renderer.ts exposes for exactly this) hands back a no-op renderMeta, never '
    + 'undefined/null', async () => {
    // selectRenderer has no deps parameter of its own — it forwards straight to
    // createGpuRenderMap, so pinning the shape at THAT seam is the deterministic way
    // to assert what selectRenderer's unavailable path resolves to, independent of
    // whether the test host happens to expose navigator.gpu.
    const { render, renderMeta, backend } = await createGpuRenderMap({ probe: () => false });
    expect(backend).toBe('unavailable');
    expect(typeof render).toBe('function');
    expect(typeof renderMeta).toBe('function');
    expect(() => renderMeta({ nowMs: 123 })).not.toThrow();
    // Real no-op: calling it does not attempt to touch a canvas/device.
    expect(renderMeta({ nowMs: 0 })).toBeUndefined();
  });

  it('a failed GPU scene build (adapter/device init throws) still hands back a safe, '
    + 'callable renderMeta alongside the honest "WebGPU required" render overlay', async () => {
    const { render, renderMeta, backend } = await createGpuRenderMap({
      probe: () => true,
      makeGpuScene: async () => { throw new Error('no adapter'); },
    });
    expect(backend).toBe('unavailable');
    expect(typeof render).toBe('function');
    expect(typeof renderMeta).toBe('function');
    expect(() => renderMeta({ nowMs: 0 })).not.toThrow();
  });
});
