// Per-material PBR constants (metallic-roughness workflow), stylized for a medieval
// settlement. roughness/metallic in 0..1; emissive RGB 0..255. Window panes ('glass')
// carry a warm emissive so they glow at night (modulated by the renderer's night factor);
// every other material is non-emissive. Hearth/forge glow is a later slice.
import type { Mat, RGB } from '@/assetgen/types';

export interface MaterialPbr { roughness: number; metallic: number; emissive: RGB }

export const MATERIAL_PBR: Record<Mat, MaterialPbr> = {
  stone:   { roughness: 0.85, metallic: 0, emissive: [0, 0, 0] },
  timber:  { roughness: 0.70, metallic: 0, emissive: [0, 0, 0] },
  plaster: { roughness: 0.90, metallic: 0, emissive: [0, 0, 0] },
  thatch:  { roughness: 0.95, metallic: 0, emissive: [0, 0, 0] },
  tile:    { roughness: 0.50, metallic: 0, emissive: [0, 0, 0] },
  foliage: { roughness: 0.85, metallic: 0, emissive: [0, 0, 0] },
  bark:    { roughness: 0.90, metallic: 0, emissive: [0, 0, 0] },
  earth:   { roughness: 1.00, metallic: 0, emissive: [0, 0, 0] },
  metal:   { roughness: 0.35, metallic: 1, emissive: [0, 0, 0] },
  door:    { roughness: 0.70, metallic: 0, emissive: [0, 0, 0] },
  brick:   { roughness: 0.85, metallic: 0, emissive: [0, 0, 0] },
  // Window pane: smooth glazing + a warm hearth-light emissive. The renderer adds
  // emissive·nightFactor, so this is invisible by day and glows at dusk/night.
  glass:   { roughness: 0.15, metallic: 0, emissive: [255, 196, 120] },
};

export function materialPbr(m: Mat): MaterialPbr { return MATERIAL_PBR[m]; }
