// Per-material PBR constants (metallic-roughness workflow), stylized for a medieval
// settlement. roughness/metallic in 0..1; emissive RGB 0..255 (all black for now —
// window/hearth glow is painted from anchors in a later slice, not a material property).
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
};

export function materialPbr(m: Mat): MaterialPbr { return MATERIAL_PBR[m]; }
