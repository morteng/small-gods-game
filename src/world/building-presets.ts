/**
 * Named descriptor presets — the open catalogue Fate, worldgen, and the editor
 * draw from. Add a building by adding one entry (and, if it needs its own
 * `kind`, an entity-kind def). The eight legacy templates are re-expressed here, plus shrine, guard_post, and the new yurt/longhouse archetypes.
 */
import type { BuildingDescriptor } from './building-descriptor';

export const BUILDING_PRESETS: Record<string, BuildingDescriptor> = {
  cottage: {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'gable', walls: 'wattle', roofMat: 'thatch',
    groundMaterial: 'packed_dirt', apron: { radius: 1, material: 'packed_dirt' },
    door: { x: 1, y: 2 },
    vents: [{ x: 2, y: 0, height: 0.8, kind: 'chimney', emit: 'smoke' }],
  },
  tavern: {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'rect', levels: 2, levelInset: 0, heightPerLevel: 1,
    roof: 'hip', walls: 'timber', roofMat: 'tile',
    groundMaterial: 'packed_dirt', apron: { radius: 1, material: 'packed_dirt' },
    door: { x: 1, y: 2 },
    vents: [{ x: 2, y: 0, height: 0.9, kind: 'chimney', emit: 'smoke' }],
  },
  market_stall: {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'lean_to', walls: 'timber', roofMat: 'thatch',
    door: { x: 0, y: 1 },
  },
  temple_small: {
    // Capped 4×4 → 3×3 so the true-size iso sprite (384px) fits PixelLab's gen
    // limit and renders 1:1. Door/vent moved inside the smaller footprint.
    category: 'religious', era: 'classical', footprint: { w: 3, h: 3 },
    plan: 'cross', levels: 1, levelInset: 0, heightPerLevel: 1.5,
    roof: 'hip', walls: 'stone', roofMat: 'tile',
    groundMaterial: 'flagstone', apron: { radius: 2, material: 'flagstone' },
    door: { x: 1, y: 2 },
    vents: [{ x: 1, y: 1, height: 0.5, kind: 'smokehole', emit: 'smoke' }],
  },
  farm_barn: {
    category: 'farm', era: 'medieval', footprint: { w: 3, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'gable', walls: 'timber', roofMat: 'wood',
    groundMaterial: 'dirt', door: { x: 1, y: 1 },
  },
  tower: {
    // heightPerLevel 1.5→1.0: a 3-storey tower at 1.5 is 456px tall (over
    // PixelLab's 400 limit); 1.0 keeps the full silhouette ≤384px for a 1:1 gen.
    category: 'military', era: 'medieval', footprint: { w: 2, h: 3 },
    plan: 'rect', levels: 3, levelInset: 0, heightPerLevel: 1.0,
    roof: 'flat', walls: 'stone', roofMat: 'slate',
    groundMaterial: 'flagstone', door: { x: 0, y: 2 },
  },
  castle_keep: {
    // Capped 4×4 → 3×3 and heightPerLevel 1.5→0.7 so the tall stepped silhouette
    // fits the 384px gen box (was 4×4 × 6 height-units → far over the limit).
    category: 'military', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'stepped', levels: 4, levelInset: 1, heightPerLevel: 0.7,
    roof: 'stepped', walls: 'stone', roofMat: 'slate',
    groundMaterial: 'flagstone', apron: { radius: 2, material: 'gravel' },
    door: { x: 1, y: 2 },
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
    vents: [{ x: 1, y: 1, height: 0.4, kind: 'smokehole', emit: 'smoke' }],
  },
  longhouse: {
    // Capped 5×2 → 4×2 (448px → 384px) to fit the 1:1 gen box while staying
    // elongated. Door/vent already inside the 4-wide footprint.
    category: 'residential', era: 'medieval', footprint: { w: 4, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'gable', walls: 'log', roofMat: 'thatch',
    groundMaterial: 'packed_dirt', door: { x: 2, y: 1 },
    vents: [{ x: 2, y: 0, height: 0.6, kind: 'smokehole', emit: 'smoke' }],
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

