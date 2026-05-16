import { describe, it, expect } from 'vitest';
import type { Entity, Region, SpriteRef } from '@/core/types';

describe('foundation types', () => {
  it('Entity has the spec-A shape', () => {
    const e: Entity = {
      id: 'e1',
      kind: 'oak_tree',
      x: 4.5,
      y: 7.5,
      properties: { variant: 'green' },
      tags: ['vegetation', 'forest'],
    };
    expect(e.id).toBe('e1');
    expect(e.kind).toBe('oak_tree');
    expect(e.x).toBe(4.5);
    expect(e.properties?.variant).toBe('green');
    expect(e.tags).toContain('vegetation');
  });

  it('Region has x/y/w/h tile coordinates', () => {
    const r: Region = { x: 0, y: 0, w: 16, h: 16 };
    expect(r.w).toBe(16);
  });

  it('SpriteRef supports atlas+region or fallback', () => {
    const atlased: SpriteRef = {
      atlas: 'lpc-terrain',
      region: { sx: 0, sy: 0, sw: 32, sh: 32 },
    };
    const fallback: SpriteRef = {
      fallbackColor: '#7ab06e',
      fallbackShape: 'circle',
    };
    expect(atlased.atlas).toBe('lpc-terrain');
    expect(fallback.fallbackShape).toBe('circle');
  });
});
