// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';

const LS_KEY = 'smallgods.render.mode';

export type RenderMode = 'topdown' | 'iso' | 'gpu';
export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/** Read current render mode. URL param `?render=iso` overrides localStorage. */
export function readRenderMode(): RenderMode {
  try {
    const urlParam = new URLSearchParams(window.location.search).get('render');
    if (urlParam === 'iso') return 'iso';
    if (urlParam === 'topdown') return 'topdown';
    if (urlParam === 'gpu') return 'gpu';
    const v = localStorage.getItem(LS_KEY);
    if (v === 'iso') return 'iso';
    if (v === 'topdown') return 'topdown';
    if (v === 'gpu') return 'gpu';
  } catch {
    // localStorage may be unavailable (iframe with storage disabled etc.)
  }
  return 'gpu';
}

/**
 * Flip between the GPU default and the iso fallback, then reload.
 * (The legacy 'topdown' Canvas2D mode is deprecated and no longer offered here;
 * reach it explicitly with `?render=topdown` if needed.)
 */
export function toggleRenderMode(): void {
  const next = readRenderMode() === 'gpu' ? 'iso' : 'gpu';
  localStorage.setItem(LS_KEY, next);
  window.location.reload();
}

export async function selectRenderer(): Promise<RenderFn> {
  const mode = readRenderMode();
  if (mode === 'gpu') {
    // R2 — WebGPU/WGSL scene with a Canvas2D parity route-out (never a black screen).
    const { createGpuRenderMap } = await import('@/render/gpu/gpu-renderer');
    const { render } = await createGpuRenderMap();
    return render;
  }
  if (mode === 'iso') {
    const { createIsoRenderMap } = await import('@/render/iso/iso-renderer');
    return createIsoRenderMap();
  }
  const mod = await import('@/render/renderer');
  return mod.renderMap;
}
