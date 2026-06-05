import { describe, it, expect } from 'vitest';
import { ERAS, isEra, resolveSettlementEra } from '@/core/era';
import type { POI, WorldSeed } from '@/core/types';

const poi = (era?: string): POI => ({ id: 'p', type: 'village', era: era as POI['era'] });
const seed = (era?: string): WorldSeed =>
  ({ name: 'w', size: { width: 32, height: 24 }, biome: 'temperate',
     pois: [], connections: [], constraints: [], era: era as WorldSeed['era'] });

describe('isEra', () => {
  it('accepts every union member', () => {
    for (const e of ERAS) expect(isEra(e)).toBe(true);
  });
  it('rejects non-members and non-strings', () => {
    expect(isEra('stone_age')).toBe(false);
    expect(isEra(undefined)).toBe(false);
    expect(isEra(7)).toBe(false);
  });
});

describe('resolveSettlementEra', () => {
  it('prefers the POI era over the world era', () => {
    expect(resolveSettlementEra(poi('primordial'), seed('medieval'))).toBe('primordial');
  });
  it('falls back to the world era when the POI has none', () => {
    expect(resolveSettlementEra(poi(undefined), seed('ancient'))).toBe('ancient');
  });
  it('falls back to medieval when neither is set', () => {
    expect(resolveSettlementEra(poi(undefined), seed(undefined))).toBe('medieval');
    expect(resolveSettlementEra(poi(undefined), null)).toBe('medieval');
  });
  it('treats an invalid era as unset (coerces, never throws)', () => {
    expect(resolveSettlementEra(poi('bogus'), seed('ancient'))).toBe('ancient');
    expect(resolveSettlementEra(poi('bogus'), seed('also_bad'))).toBe('medieval');
  });
});
