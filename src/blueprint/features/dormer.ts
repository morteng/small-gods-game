// src/blueprint/features/dormer.ts
// A gabled dormer on the host wing's camera-facing roof slope. Like `vent`, it is
// NOT an opening — geometry is built in solids.ts (buildingFacets → dormerSolids)
// from BuildingFeatures.dormers; the img2img pass paints the dormer's window.
import type { FeatureType } from '../registry';

export const dormerFeatureType: FeatureType = {
  type: 'dormer',
  paramSchema: {
    t: { kind: 'number', min: 0, max: 1, default: 0.5, doc: 'fraction along the ridge (0..1) where the dormer sits' },
    width: { kind: 'number', min: 0.3, max: 1.2, default: 0.5, doc: 'dormer width in tiles' },
  },
  resolve: (f) => ({ params: { ...{ t: 0.5, width: 0.5 }, ...(f.params ?? {}) } }),
  toBrief: () => 'gabled dormer window',
};
