// src/blueprint/features/vent.ts
import type { FeatureType } from '../registry';

export const ventFeatureType: FeatureType = {
  type: 'vent',
  paramSchema: {
    kind: { kind: 'enum', values: ['chimney', 'smokehole', 'pipe', 'spire'], default: 'chimney',
      doc: 'stack type: brick chimney, low capped smokehole, thin metal pipe, or a stone steeple (spire)' },
    placement: { kind: 'enum', values: ['ridge', 'wall'], default: 'ridge',
      doc: 'ride the roof ridge (interior stack) or climb an exterior wall (fireplace stack)' },
    side: { kind: 'enum', values: ['front', 'back'], default: 'front',
      doc: "for placement:'ridge' — which slope the stack pierces (front = camera-facing, back = far slope)" },
    t: { kind: 'number', min: 0, max: 1, default: 0.5, doc: 'fraction along the ridge/wall (0..1) where the stack sits' },
    width: { kind: 'number', min: -1, max: 1, default: -1, doc: 'stack width (tiles); -1 = the per-kind default' },
    height: { kind: 'number', min: -1, max: 2, default: -1, doc: 'height above the ridge/eave (tiles); -1 = the per-kind default' },
    material: { kind: 'enum', values: ['default', 'stone', 'brick'], default: 'default',
      doc: "override the stack material; 'default' = the per-kind default (brick chimney, timber smokehole)" },
  },
  resolve: (f) => ({ params: { ...{ kind: 'chimney', placement: 'ridge', side: 'front', t: 0.5, width: -1, height: -1, material: 'default' }, ...(f.params ?? {}) } }),
  toBrief: (f) => `${f.params.kind as string} vent`,
};
