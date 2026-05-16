import { describe, it, expect } from 'vitest';
import { entityKinds, getEntityKindDef } from '@/world/entity-kinds';

describe('entity-kinds catalog', () => {
  it('exports a non-empty registry', () => {
    expect(entityKinds.size).toBeGreaterThanOrEqual(40);
  });

  it('has the building kinds referenced by BUILDING_TEMPLATES', () => {
    expect(entityKinds.has('cottage')).toBe(true);
    expect(entityKinds.has('tavern')).toBe(true);
    expect(entityKinds.has('temple_small')).toBe(true);
    expect(entityKinds.has('farm_barn')).toBe(true);
    expect(entityKinds.has('castle_keep')).toBe(true);
    expect(entityKinds.has('dock')).toBe(true);
  });

  it('has the tree kinds emitted by the forest brush', () => {
    expect(entityKinds.has('oak_tree')).toBe(true);
    expect(entityKinds.has('pine_tree')).toBe(true);
    expect(entityKinds.has('dead_tree')).toBe(true);
  });

  it('has the POI-zone prop kinds', () => {
    for (const k of ['well', 'fence', 'statue', 'banner', 'crate', 'market_awning', 'flower_patch']) {
      expect(entityKinds.has(k)).toBe(true);
    }
  });

  it('every kind has at least sprite atlas OR fallbackColor', () => {
    for (const def of entityKinds.values()) {
      const hasSprite = !!(def.sprite.atlas && def.sprite.region);
      const hasFallback = !!def.sprite.fallbackColor;
      expect(hasSprite || hasFallback).toBe(true);
    }
  });

  it('every kind has a category and defaultTags', () => {
    for (const def of entityKinds.values()) {
      expect(['building', 'vegetation', 'prop', 'terrain-feature']).toContain(def.category);
      expect(Array.isArray(def.defaultTags)).toBe(true);
    }
  });

  it('getEntityKindDef throws on unknown kind', () => {
    expect(() => getEntityKindDef('not_a_real_kind_12345')).toThrow();
  });
});
