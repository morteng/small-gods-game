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
  | 'roads'
  | 'rivers'
  | 'npcs'
  | 'buildings'
  | 'vegetation'
  | 'props'
  | 'terrainFeatures'
  | 'decorations'
  | 'remains';

/** All layers, in display order. The panel and the reset path iterate this. */
export const RENDER_LAYERS: RenderLayer[] = [
  'terrain', 'roads', 'rivers', 'npcs', 'buildings', 'vegetation',
  'props', 'terrainFeatures', 'decorations', 'remains',
];

/** The boolean DevModeState keys that gate render layers. */
export type RenderLayerFlag =
  | 'showTerrain' | 'showRoads' | 'showRivers' | 'showNpcs' | 'showBuildings'
  | 'showVegetation' | 'showProps' | 'showTerrainFeatures' | 'showDecorations'
  | 'showRemains';

const LAYER_FLAG: Record<RenderLayer, RenderLayerFlag> = {
  terrain: 'showTerrain',
  roads: 'showRoads',
  rivers: 'showRivers',
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

/**
 * Classify a terrain tile.type into a toggleable terrain sub-layer, or null if it
 * is plain ground. Roads (incl. dirt/stone roads + bridges) and rivers are real
 * tile types painted with their own colors; these let the panel hide them while
 * leaving the rest of the terrain intact. Lakes/ocean ('water', 'shallow_water',
 * 'deep_water') are NOT rivers — they ride the base terrain layer.
 */
export function tileRenderLayer(tileType: string): 'roads' | 'rivers' | null {
  if (
    tileType === 'road' || tileType === 'bridge' ||
    tileType.startsWith('road_') || tileType.startsWith('dirt_road') ||
    tileType.startsWith('stone_road') || tileType.startsWith('bridge_')
  ) {
    return 'roads';
  }
  if (tileType === 'river' || tileType.startsWith('river_')) return 'rivers';
  return null;
}

/** The tile.type to paint instead when a terrain sub-layer (road/river) is hidden. */
export const HIDDEN_TILE_FALLBACK = 'grass';

/**
 * Resolve which tile.type a terrain pass should actually paint, honoring the
 * road/river sub-layer toggles. Returns the original type, or the ground fallback
 * when that tile's sub-layer is hidden (so hiding roads/rivers reveals ground
 * rather than leaving a hole).
 */
export function effectiveTileType(tileType: string, devMode?: DevModeState): string {
  const layer = tileRenderLayer(tileType);
  if (layer && isLayerHidden(layer, devMode)) return HIDDEN_TILE_FALLBACK;
  return tileType;
}
