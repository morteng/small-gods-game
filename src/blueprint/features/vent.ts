// src/blueprint/features/vent.ts
import type { FeatureType } from '../registry';

export const ventFeatureType: FeatureType = {
  type: 'vent',
  paramSchema: {
    kind: { kind: 'enum', values: ['chimney', 'smokehole', 'pipe'], default: 'chimney' },
    placement: { kind: 'enum', values: ['ridge', 'wall'], default: 'ridge' },
    t: { kind: 'number', min: 0, max: 1, default: 0.5 },
  },
  resolve: (f) => ({ params: { ...{ kind: 'chimney', placement: 'ridge', t: 0.5 }, ...(f.params ?? {}) } }),
  toBrief: (f) => `${f.params.kind as string} vent`,
};
