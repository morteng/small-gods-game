import { describe, it, expect } from 'vitest';
import { getEntitySortY } from '@/render/renderer';
import type { Entity } from '@/core/types';

describe('remains rendering sort key', () => {
  it('a remains entity sorts at its own tile y (no crash, defined value)', () => {
    const remains: Entity = {
      id: 'tola', kind: 'remains', x: 5, y: 7,
      properties: { deathTick: 1, deathCause: 'old_age' } as unknown as Record<string, unknown>,
    };
    expect(getEntitySortY(remains)).toBe(7);
  });
});
