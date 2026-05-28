// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';

const LS_KEY = 'smallgods.render.mode';

export type RenderMode = 'topdown' | 'iso';
export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

/** Read current render mode. URL param `?render=iso` overrides localStorage. */
export function readRenderMode(): RenderMode {
  try {
    const urlParam = new URLSearchParams(window.location.search).get('render');
    if (urlParam === 'iso') return 'iso';
    if (urlParam === 'topdown') return 'topdown';
    const v = localStorage.getItem(LS_KEY);
    if (v === 'iso') return 'iso';
    if (v === 'topdown') return 'topdown';
  } catch {
    // localStorage may be unavailable (iframe with storage disabled etc.)
  }
  return 'iso';
}

/** Flip the render mode in localStorage and reload the page. */
export function toggleRenderMode(): void {
  const next = readRenderMode() === 'iso' ? 'topdown' : 'iso';
  localStorage.setItem(LS_KEY, next);
  window.location.reload();
}

export async function selectRenderer(): Promise<RenderFn> {
  const mode = readRenderMode();
  if (mode === 'iso') {
    const { createIsoRenderMap } = await import('@/render/iso/iso-renderer');
    return createIsoRenderMap();
  }
  const mod = await import('@/render/renderer');
  return mod.renderMap;
}
