import type { GameState } from '@/core/state';
import type { RenderContext, DevModeState } from '@/core/types';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { Viewport } from './viewport';
import { toRenderNpc } from '@/world/npc-helpers';

export interface RenderContextDeps {
  state: GameState;
  viewport: Viewport;
  sheets: Map<string, HTMLCanvasElement>;
  assets: AssetManager;
  decorationImages: DecorationImageCache;
  devMode: DevModeState;
}

/** Single source of truth for the per-frame RenderContext.
 *  `map` and `world` are asserted non-null — every caller guards both before calling.
 *  `npcs` is [] when no world exists yet (pre-generation). */
export function buildRenderContext(deps: RenderContextDeps): RenderContext {
  const { state, viewport, sheets, assets, decorationImages, devMode } = deps;
  return {
    map: state.map!,
    camera: state.camera,
    canvasWidth: viewport.width,
    canvasHeight: viewport.height,
    npcs: state.world ? state.world.query({ kind: 'npc' }).map(toRenderNpc) : [],
    npcSheets: sheets,
    visualMap: state.visualMap,
    blobMap: state.blobMap ?? null,
    tileAtlas: assets.getTileAtlas(),
    terrainSheets: assets.getTerrainSheets(),
    buildingSprites: assets.getBuildingSprites(),
    treeSheets: assets.getTreeSheets(),
    world: state.world!,
    showLabels: state.showLabels,
    showPoiMarkers: state.showPoiMarkers,
    generatedDecorations: state.generatedDecorations,
    resolveDecorationImage: (id: string) => decorationImages.get(id),
    devMode,
  };
}
