import type { GameState } from '@/core/state';
import type { RenderContext, DevModeState, Entity } from '@/core/types';
import type { AssetManager } from '@/render/asset-manager';
import type { DecorationImageCache } from '@/render/decoration-image-cache';
import type { ArtResolver } from '@/render/art-resolver';
import type { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { ParametricPlantSource } from '@/render/parametric-plant-source';
import type { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import type { Viewport } from './viewport';
import { toRenderNpc } from '@/world/npc-helpers';
import { DEFAULT_LIGHTING, LIGHTING_OFF } from '@/render/lighting-state';

export interface RenderContextDeps {
  state: GameState;
  viewport: Viewport;
  sheets: Map<string, HTMLCanvasElement>;
  assets: AssetManager;
  decorationImages: DecorationImageCache;
  artResolver: ArtResolver;
  buildingArtResolver: ArtResolver;
  parametricBuildingSource: ParametricBuildingSource;
  parametricPlantSource: ParametricPlantSource;
  generatedBuildingArtSource?: GeneratedBuildingArtSource;
  devMode: DevModeState;
}

/** Single source of truth for the per-frame RenderContext.
 *  `map` and `world` are asserted non-null — every caller guards both before calling.
 *  `npcs` is [] when no world exists yet (pre-generation). */
export function buildRenderContext(deps: RenderContextDeps): RenderContext {
  const { state, viewport, sheets, assets, decorationImages, artResolver, buildingArtResolver, parametricBuildingSource, parametricPlantSource, generatedBuildingArtSource, devMode } = deps;
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
    resolveParametricBuildingArt: (entity: Entity) => {
      const s = parametricBuildingSource.peek(entity);
      if (s) return s;
      parametricBuildingSource.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveParametricPlantArt: (kind: string) => {
      const s = parametricPlantSource.peek(kind);
      if (s) return s;
      parametricPlantSource.warm(kind); // fire-and-forget; never blocks the frame
      return null;
    },
    resolveGeneratedBuildingArt: (entity: Entity) => {
      const src = generatedBuildingArtSource;
      if (!src) return null;
      const s = src.peek(entity);
      if (s) return s;
      src.warm(entity); // fire-and-forget; never blocks the frame
      return null;
    },
    lighting: devMode.lighting === 'off' ? LIGHTING_OFF : DEFAULT_LIGHTING,
    devMode,
  };
}
