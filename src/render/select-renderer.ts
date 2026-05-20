// src/render/select-renderer.ts
import type { RenderContext } from '@/core/types';

const LS_KEY = 'smallgods.render.mode';

export type RenderFn = (ctx: CanvasRenderingContext2D, rc: RenderContext) => void;

export async function selectRenderer(): Promise<RenderFn> {
  let mode: 'topdown' | 'iso' = 'topdown';
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'iso') mode = 'iso';
  } catch {
    // localStorage may be unavailable (iframe with storage disabled etc.)
  }
  if (mode === 'iso') {
    const [{ createIsoRenderMap }, { loadIsoTerrainAtlas }] = await Promise.all([
      import('@/render/iso/iso-renderer'),
      import('@/render/iso/iso-atlas-loader'),
    ]);
    const atlas = await loadIsoTerrainAtlas();
    return createIsoRenderMap(atlas);
  }
  const mod = await import('@/render/renderer');
  return mod.renderMap;
}
