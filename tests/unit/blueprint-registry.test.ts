// tests/unit/blueprint-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPartType, getPartType, listPartTypes,
  registerFeatureType, getFeatureType, _resetRegistryForTest, type PartType,
} from '@/blueprint/registry';

const stub: PartType = {
  type: 'stub',
  paramSchema: { h: { kind: 'number', default: 1 } },
  resolve: (p) => ({ params: { ...(p.params ?? {}) } }),
  toPrims: () => [],
  toCollision: () => [],
  toAnchors: () => [],
  toBrief: () => 'stub',
};

describe('blueprint registry', () => {
  beforeEach(() => _resetRegistryForTest());

  it('registers and retrieves a part type', () => {
    registerPartType(stub);
    expect(getPartType('stub')).toBe(stub);
  });

  it('lists registered part types (the agent capability catalogue)', () => {
    registerPartType(stub);
    expect(listPartTypes().map(p => p.type)).toContain('stub');
  });

  it('throws on an unknown part type', () => {
    expect(() => getPartType('ghost')).toThrow(/ghost/);
  });

  it('throws on duplicate registration', () => {
    registerPartType(stub);
    expect(() => registerPartType(stub)).toThrow(/already registered/);
  });

  it('returns undefined for an unknown feature type without throwing', () => {
    expect(getFeatureType('ghost')).toBeUndefined();
  });
});
