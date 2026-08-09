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
    // With no canvas to paint on, meta mode degrades quietly rather than throwing.
    expect(() => renderMeta({ nowMs: 0 })).not.toThrow();
  });

  // The v0.1.0 Linux AppImage opened to a BLANK window on a box whose Electron
  // could not init WebGPU: meta mode (title screen, no world) was a no-op, and
  // world mode — where the message lived — is unreachable without a button the
  // dead renderer never drew. Both modes must speak.
  it('paints the WebGPU-required message in META mode (title screen, no world)', async () => {
    const ctx = mockCtx();
    const canvas = mockCanvas(ctx);
    const { renderMeta, backend } = await createGpuRenderMap({ probe: () => false, canvas });

    expect(backend).toBe('unavailable');
    renderMeta({ nowMs: 0 });
    const painted = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
    expect(painted.some(t => t.includes('WebGPU is required'))).toBe(true);
    // It fills a background too — a message over a transparent canvas is the same
    // blank window with extra steps.
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('paints in META mode when scene INIT fails too (adapter/device path)', async () => {
    const ctx = mockCtx();
    const canvas = mockCanvas(ctx);
    const { renderMeta } = await createGpuRenderMap({
      probe: () => true,
      canvas,
      makeGpuScene: async () => { throw new Error('no adapter'); },
    });
    renderMeta({ nowMs: 0 });
    const painted = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
    expect(painted.some(t => t.includes('WebGPU is required'))).toBe(true);
    expect(painted.some(t => t.includes('no adapter'))).toBe(true); // the reason, verbatim
  });

  it('degrades to a no-op when the canvas cannot give a 2D context', async () => {
    // A late-stage failure can leave the canvas already bound to webgpu, so
    // getContext('2d') returns null. Never throw inside the frame loop.
    const canvas = { width: 800, height: 600, getContext: vi.fn(() => null) } as unknown as HTMLCanvasElement;
    const { renderMeta } = await createGpuRenderMap({ probe: () => false, canvas });
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

function mockCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return { width: 800, height: 600, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
    fillStyle: '', textAlign: '', textBaseline: '', font: '',
  } as unknown as CanvasRenderingContext2D;
}

function mockRc(): RenderContext {
  return { canvasWidth: 800, canvasHeight: 600 } as unknown as RenderContext;
}
