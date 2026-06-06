import type { GameState } from '@/core/state';
import type { RenderContext, DevModeState, Entity } from '@/core/types';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { ArtResolver } from '@/render/art-resolver';
import type { Viewport } from './viewport';
import { toRenderNpc } from '@/world/npc-helpers';

export interface RenderContextDeps {
  state: GameState;
  viewport: Viewport;
  sheets: Map<string, HTMLCanvasElement>;
  assets: AssetManager;
  decorationImages: DecorationImageCache;
  artResolver: ArtResolver;
  buildingArtResolver: ArtResolver;
  devMode: DevModeState;
}

/** Single source of truth for the per-frame RenderContext.
 *  `map` and `world` are asserted non-null — every caller guards both before calling.
 *  `npcs` is [] when no world exists yet (pre-generation). */
export function buildRenderContext(deps: RenderContextDeps): RenderContext {
  const { state, viewport, sheets, assets, decorationImages, artResolver, buildingArtResolver, devMode } = deps;
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
    resolveEntityArt: (entity: Entity) => {
      const id = artResolver.peek(entity);
      if (id) return decorationImages.get(id);
      artResolver.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveBuildingArt: (entity: Entity) => {
      const id = buildingArtResolver.peek(entity);
      if (id) return decorationImages.get(id); // shared kind-agnostic image cache
      buildingArtResolver.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    devMode,
  };
}
