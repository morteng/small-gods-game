import { describe, it, expect, vi } from 'vitest';
import { createGpuRenderMap, hasWebGpu } from '@/render/gpu/gpu-renderer';
import type { RenderFn } from '@/render/select-renderer';

const noop: RenderFn = () => {};

describe('R2a — GPU renderer capability routing', () => {
  it('routes to the Canvas2D fallback when WebGPU is absent', async () => {
    const makeFallback = vi.fn(async () => noop);
    const makeGpuScene = vi.fn(async () => noop);
    const { render, backend } = await createGpuRenderMap({
      probe: () => false,
      makeFallback,
      makeGpuScene,
    });
    expect(backend).toBe('canvas2d');
    expect(render).toBe(noop);
    expect(makeFallback).toHaveBeenCalledOnce();
    expect(makeGpuScene).not.toHaveBeenCalled(); // never build a GPU scene with no GPU
  });

  it('routes to Canvas2D when WebGPU is present but no GPU scene is wired yet (R2a)', async () => {
    const makeFallback = vi.fn(async () => noop);
    const { backend } = await createGpuRenderMap({ probe: () => true, makeFallback });
    expect(backend).toBe('canvas2d');
    expect(makeFallback).toHaveBeenCalledOnce();
  });

  it('uses the WebGPU scene when present and wired (R2c onward)', async () => {
    const gpuRender: RenderFn = () => {};
    const { render, backend } = await createGpuRenderMap({
      probe: () => true,
      makeFallback: async () => noop,
      makeGpuScene: async () => gpuRender,
    });
    expect(backend).toBe('webgpu');
    expect(render).toBe(gpuRender);
  });

  it('falls back to Canvas2D (never throws, never blanks) if GPU scene init fails', async () => {
    const { render, backend } = await createGpuRenderMap({
      probe: () => true,
      makeFallback: async () => noop,
      makeGpuScene: async () => {
        throw new Error('no adapter');
      },
    });
    expect(backend).toBe('canvas2d');
    expect(render).toBe(noop);
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
