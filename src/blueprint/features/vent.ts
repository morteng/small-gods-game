// src/blueprint/features/vent.ts
import type { FeatureType } from '../registry';

export const ventFeatureType: FeatureType = {
  type: 'vent',
  paramSchema: {
    kind: { kind: 'enum', values: ['chimney', 'smokehole', 'pipe', 'spire'], default: 'chimney' },
    placement: { kind: 'enum', values: ['ridge', 'wall'], default: 'ridge' },
    t: { kind: 'number', min: 0, max: 1, default: 0.5 },
    // -1 = the per-kind default (chimney 0.30 wide / 0.55 above ridge, etc.)
    width: { kind: 'number', min: -1, max: 1, default: -1 },
    height: { kind: 'number', min: -1, max: 2, default: -1 },
  },
  resolve: (f) => ({ params: { ...{ kind: 'chimney', placement: 'ridge', t: 0.5, width: -1, height: -1 }, ...(f.params ?? {}) } }),
  toBrief: (f) => `${f.params.kind as string} vent`,
};
