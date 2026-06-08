// src/blueprint/features/window.ts
import type { FeatureType } from '../registry';

export const windowFeatureType: FeatureType = {
  type: 'window',
  paramSchema: {
    style: { kind: 'enum', values: ['plain', 'shuttered', 'arched'], default: 'plain' },
  },
  resolve: (f) => ({ params: { style: (f.params?.style as string) ?? 'plain' } }),
  toBrief: (f) => `${f.params.style as string} window`,
};
