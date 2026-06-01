import { describe, it, expect } from 'vitest';
import { initNpcProps, REMAINS_KIND } from '@/world/npc-helpers';

describe('initNpcProps lineage defaults', () => {
  it('defaults birthTick to 0, parentIds to [], lineageId to ""', () => {
    const p = initNpcProps('Tola', 'farmer', 7);
    expect(p.birthTick).toBe(0);
    expect(p.parentIds).toEqual([]);
    expect(p.lineageId).toBe('');
  });
  it('does not set deathTick/deathCause for a living NPC', () => {
    const p = initNpcProps('Tola', 'farmer', 7);
    expect(p.deathTick).toBeUndefined();
    expect(p.deathCause).toBeUndefined();
  });
});

describe('REMAINS_KIND', () => {
  it('is the string "remains"', () => {
    expect(REMAINS_KIND).toBe('remains');
  });
});
