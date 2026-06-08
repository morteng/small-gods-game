// tests/unit/blueprint-vent-window-features.test.ts
import { describe, it, expect } from 'vitest';
import { ventFeatureType } from '@/blueprint/features/vent';
import { windowFeatureType } from '@/blueprint/features/window';

const ctx = { seed: 0, materials: {} };

describe('vent feature', () => {
  it('defaults kind to chimney and placement to ridge', () => {
    const { params } = ventFeatureType.resolve({ type: 'vent' }, ctx);
    expect(params.kind).toBe('chimney');
    expect(params.placement).toBe('ridge');
  });
  it('keeps an explicit smokehole', () => {
    const { params } = ventFeatureType.resolve({ type: 'vent', params: { kind: 'smokehole' } }, ctx);
    expect(params.kind).toBe('smokehole');
  });
});

describe('window feature', () => {
  it('resolves and yields a brief phrase', () => {
    const r = windowFeatureType.resolve({ type: 'window', face: 'south' }, ctx);
    expect(r.params).toBeDefined();
    expect(windowFeatureType.toBrief({ id: 'w', type: 'window', face: 'south', params: r.params }, { materials: {}, footprint: { w: 2, h: 2 } })).toMatch(/window/);
  });
});
