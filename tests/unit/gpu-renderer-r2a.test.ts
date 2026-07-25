import { describe, it, expect, vi } from 'vitest';
import { createGpuRenderMap, hasWebGpu } from '@/render/gpu/gpu-renderer';
import type { RenderFn } from '@/render/select-renderer';
import type { RenderContext } from '@/core/types';

describe('R2a — GPU renderer capability routing', () => {
  it('reports an unavailable backend when WebGPU is absent (no GPU scene built)', async () => {
    const makeGpuScene = vi.fn(async () => ({ render: (() => {}) as RenderFn, renderMeta: () => {} }));
    const { render, renderMeta, backend } = await createGpuRenderMap({
      probe: () => false,
      makeGpuScene,
    });
    expect(backend).toBe('unavailable');
    expect(makeGpuScene).not.toHaveBeenCalled(); // never build a GPU scene with no GPU
    // The unavailable render fn paints an honest message — it must not throw.
    expect(() => render(mockCtx(), mockRc())).not.toThrow();
    // No GPU scene ⇒ nothing for meta mode to paint either; the no-op must not throw.
    expect(() => renderMeta({ nowMs: 0 })).not.toThrow();
  });

  it('uses the WebGPU scene when present and wired', async () => {
    const gpuRender: RenderFn = () => {};
    const gpuRenderMeta = () => {};
    const { render, renderMeta, backend } = await createGpuRenderMap({
      probe: () => true,
      makeGpuScene: async () => ({ render: gpuRender, renderMeta: gpuRenderMeta }),
    });
    expect(backend).toBe('webgpu');
    expect(render).toBe(gpuRender);
    expect(renderMeta).toBe(gpuRenderMeta);
  });

  it('reports unavailable (never throws, never blanks) if GPU scene init fails', async () => {
    const { render, backend } = await createGpuRenderMap({
      probe: () => true,
      makeGpuScene: async () => {
        throw new Error('no adapter');
      },
    });
    expect(backend).toBe('unavailable');
    expect(() => render(mockCtx(), mockRc())).not.toThrow();
  });

  it('hasWebGpu detects presence/absence on a navigator-like object', () => {
    expect(hasWebGpu({ gpu: {} })).toBe(true);
    expect(hasWebGpu({ gpu: null })).toBe(false);
    expect(hasWebGpu({})).toBe(false);
    expect(hasWebGpu(undefined)).toBe(false);
    // jsdom default navigator has no `gpu` — the real-world fallback case.
    expect(hasWebGpu()).toBe(false);
  });
});

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    fillStyle: '', textAlign: '', textBaseline: '', font: '',
  } as unknown as CanvasRenderingContext2D;
}

function mockRc(): RenderContext {
  return { canvasWidth: 800, canvasHeight: 600 } as unknown as RenderContext;
}
