import { describe, it, expect } from 'vitest';
import { validateWorldSeed } from '@/core/schema';
import type { WorldSeed } from '@/core/types';

function base(extra: Partial<WorldSeed> = {}): Partial<WorldSeed> {
  return { name: 'w', size: { width: 32, height: 24 }, biome: 'temperate',
           pois: [], connections: [], constraints: [], ...extra };
}

describe('world seed era validation', () => {
  it('accepts a valid world era', () => {
    expect(validateWorldSeed(base({ era: 'primordial' })).valid).toBe(true);
  });
  it('treats a missing world era as valid', () => {
    expect(validateWorldSeed(base()).valid).toBe(true);
  });
  it('rejects an invalid world era', () => {
    const r = validateWorldSeed(base({ era: 'stone_age' as WorldSeed['era'] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('era'))).toBe(true);
  });
  it('rejects an invalid POI era', () => {
    const r = validateWorldSeed(base({
      pois: [{ id: 'p', type: 'village', position: { x: 1, y: 1 }, era: 'bogus' as WorldSeed['era'] }],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('era'))).toBe(true);
  });
  it('accepts a valid POI era', () => {
    const r = validateWorldSeed(base({
      pois: [{ id: 'p', type: 'ruins', position: { x: 1, y: 1 }, era: 'ancient' }],
    }));
    expect(r.valid).toBe(true);
  });
});
