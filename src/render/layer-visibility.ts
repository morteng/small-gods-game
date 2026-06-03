import type { DevModeState, Entity } from '@/core/types';
import { tryGetEntityKindDef } from '@/world/entity-kinds';

/**
 * A toggleable render layer. Each maps to a `show…` flag on DevModeState and is
 * drawn unless that flag is explicitly `false` (default: shown). These are the
 * base scene categories the Debug Overlays panel exposes — distinct from the
 * info overlays (heatmaps, biome/POI layers) which default OFF.
 */
export type RenderLayer =
  | 'terrain'
  | 'npcs'
  | 'buildings'
  | 'vegetation'
  | 'props'
  | 'terrainFeatures'
  | 'decorations'
  | 'remains';

/** All layers, in display order. The panel and the reset path iterate this. */
export const RENDER_LAYERS: RenderLayer[] = [
  'terrain', 'npcs', 'buildings', 'vegetation',
  'props', 'terrainFeatures', 'decorations', 'remains',
];

/** The boolean DevModeState keys that gate render layers. */
export type RenderLayerFlag =
  | 'showTerrain' | 'showNpcs' | 'showBuildings' | 'showVegetation'
  | 'showProps' | 'showTerrainFeatures' | 'showDecorations' | 'showRemains';

const LAYER_FLAG: Record<RenderLayer, RenderLayerFlag> = {
  terrain: 'showTerrain',
  npcs: 'showNpcs',
  buildings: 'showBuildings',
  vegetation: 'showVegetation',
  props: 'showProps',
  terrainFeatures: 'showTerrainFeatures',
  decorations: 'showDecorations',
  remains: 'showRemains',
};

/** The DevModeState flag key that controls a layer (for panel wiring). */
export function layerFlag(layer: RenderLayer): RenderLayerFlag {
  return LAYER_FLAG[layer];
}

/** A layer is hidden only when its flag is explicitly false (undefined ⇒ shown). */
export function isLayerHidden(layer: RenderLayer, devMode?: DevModeState): boolean {
  return devMode?.[LAYER_FLAG[layer]] === false;
}

/** Map a world entity to the render layer it belongs to. */
export function entityLayer(e: Entity): RenderLayer {
  if (e.kind === 'npc') return 'npcs';
  if (e.kind === 'remains') return 'remains';
  const cat = tryGetEntityKindDef(e.kind)?.category;
  switch (cat) {
    case 'building': return 'buildings';
    case 'vegetation': return 'vegetation';
    case 'terrain-feature': return 'terrainFeatures';
    case 'prop': return 'props';
    default: return 'props'; // unknown kinds ride with props
  }
}

/** Whether a world entity should be skipped given the current layer toggles. */
export function isEntityHidden(e: Entity, devMode?: DevModeState): boolean {
  return isLayerHidden(entityLayer(e), devMode);
}
