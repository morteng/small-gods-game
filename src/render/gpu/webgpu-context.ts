/// <reference types="@webgpu/types" />
// src/render/gpu/webgpu-context.ts
//
// R2c — WebGPU device/context lifecycle, mirroring the proven spike
// (`public/webgpu-spike.html`): probe → adapter → device → configure canvas.
// Returns null on any unavailability so the caller routes out gracefully
// (during migration; the end state is a "WebGPU required" notice).

export interface GpuContext {
  device: GPUDevice;
  ctx: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement | OffscreenCanvas;
}

/**
 * Initialise WebGPU on a canvas. `alphaMode:'premultiplied'` so the scene can be
 * composited OVER the terrain (transparent clear shows terrain through gaps),
 * matching how the entity layer overlaid before.
 */
export async function initWebGpu(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<GpuContext | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  return { device, ctx, format, canvas };
}
