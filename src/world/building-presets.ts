/**
 * Named descriptor presets — the open catalogue Fate, worldgen, and the editor
 * draw from. Add a building by adding one entry (and, if it needs its own
 * `kind`, an entity-kind def). The nine legacy templates are re-expressed here.
 */
import type { BuildingDescriptor } from './building-descriptor';

export const BUILDING_PRESETS: Record<string, BuildingDescriptor> = {
  cottage: {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'gable', walls: 'wattle', roofMat: 'thatch',
    groundMaterial: 'packed_dirt', apron: { radius: 1, material: 'packed_dirt' },
    door: { x: 1, y: 2 },
  },
  tavern: {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'rect', levels: 2, levelInset: 0, heightPerLevel: 1,
    roof: 'hip', walls: 'timber', roofMat: 'tile',
    groundMaterial: 'packed_dirt', apron: { radius: 1, material: 'packed_dirt' },
    door: { x: 1, y: 2 },
  },
  market_stall: {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'lean_to', walls: 'timber', roofMat: 'thatch',
    door: { x: 0, y: 1 },
  },
  temple_small: {
    category: 'religious', era: 'classical', footprint: { w: 4, h: 4 },
    plan: 'cross', levels: 1, levelInset: 0, heightPerLevel: 1.5,
    roof: 'hip', walls: 'stone', roofMat: 'tile',
    groundMaterial: 'flagstone', apron: { radius: 2, material: 'flagstone' },
    door: { x: 1, y: 3 },
  },
  farm_barn: {
    category: 'farm', era: 'medieval', footprint: { w: 3, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'gable', walls: 'timber', roofMat: 'wood',
    groundMaterial: 'dirt', door: { x: 1, y: 1 },
  },
  tower: {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 3 },
    plan: 'rect', levels: 3, levelInset: 0, heightPerLevel: 1.5,
    roof: 'flat', walls: 'stone', roofMat: 'slate',
    groundMaterial: 'flagstone', door: { x: 0, y: 2 },
  },
  castle_keep: {
    category: 'military', era: 'medieval', footprint: { w: 4, h: 4 },
    plan: 'stepped', levels: 4, levelInset: 1, heightPerLevel: 1.5,
    roof: 'stepped', walls: 'stone', roofMat: 'slate',
    groundMaterial: 'flagstone', apron: { radius: 2, material: 'gravel' },
    door: { x: 1, y: 3 },
  },
  dock: {
    category: 'special', era: 'medieval', footprint: { w: 2, h: 3 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 0.2,
    roof: 'flat', walls: 'timber', roofMat: 'wood',
    groundMaterial: 'wood', door: { x: 0, y: 0 },
  },
  shrine: {
    category: 'religious', era: 'classical', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'gable', walls: 'stone', roofMat: 'tile',
    groundMaterial: 'flagstone', door: { x: 0, y: 1 },
  },
  guard_post: {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'hip', walls: 'timber', roofMat: 'wood',
    door: { x: 0, y: 1 },
  },
  // New archetypes the parametric system unlocks
  yurt: {
    category: 'residential', era: 'primordial', footprint: { w: 2, h: 2 },
    plan: 'round', levels: 1, levelInset: 0, heightPerLevel: 0.9,
    roof: 'domed', walls: 'hide', roofMat: 'hide',
    groundMaterial: 'dirt', door: { x: 0, y: 1 },
  },
  longhouse: {
    category: 'residential', era: 'medieval', footprint: { w: 5, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'gable', walls: 'log', roofMat: 'thatch',
    groundMaterial: 'packed_dirt', door: { x: 2, y: 1 },
  },
};

export function getPreset(name: string): BuildingDescriptor | undefined {
  return BUILDING_PRESETS[name];
}

/** Deep-cloned descriptor with overrides applied and `preset` stamped. */
export function synthesizeFromPreset(
  name: string, overrides: Partial<BuildingDescriptor> = {},
): BuildingDescriptor | undefined {
  const base = BUILDING_PRESETS[name];
  if (!base) return undefined;
  return { ...structuredClone(base), ...structuredClone(overrides), preset: name };
}

const POI_PRESET: Record<string, string> = {
  village: 'cottage', city: 'tavern', temple: 'temple_small', farm: 'farm_barn',
  castle: 'castle_keep', tower: 'tower', port: 'dock', tavern: 'tavern',
  market: 'market_stall', mine: 'tower', ruins: 'cottage',
};

export function presetForPoiType(poiType: string): string {
  return POI_PRESET[poiType] ?? 'cottage';
}
