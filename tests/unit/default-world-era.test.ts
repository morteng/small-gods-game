import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateWorldSeed } from '@/core/schema';
import { resolveSettlementEra } from '@/core/era';
import { getZoneRule, presetsForEra } from '@/map/poi-zones';
import type { WorldSeed, POI } from '@/core/types';

const seed = JSON.parse(
  readFileSync('public/data/worlds/default.json', 'utf-8'),
) as WorldSeed;

const poi = (id: string): POI => seed.pois.find(p => p.id === id)!;
const rosterFor = (id: string): string[] =>
  presetsForEra(getZoneRule(poi(id).type), resolveSettlementEra(poi(id), seed));

describe('default world recipe', () => {
  it('validates and declares a world era', () => {
    expect(validateWorldSeed(seed).valid).toBe(true);
    expect(seed.era).toBe('medieval');
  });

  it('has a primordial yurt camp that renders yurts', () => {
    const camp = poi('hollow_camp');
    expect(camp.type).toBe('village');
    expect(resolveSettlementEra(camp, seed)).toBe('primordial');
    expect(rosterFor('hollow_camp')).toContain('yurt');
  });

  it('has a mine that renders a guard post', () => {
    expect(poi('ironvein_mine').type).toBe('mine');
    expect(rosterFor('ironvein_mine')).toContain('guard_post');
  });

  it('flags the ancient ruins so they render a shrine', () => {
    for (const id of ['forest_ruins', 'swamp_shrine']) {
      expect(resolveSettlementEra(poi(id), seed)).toBe('ancient');
      expect(rosterFor(id)).toContain('shrine');
    }
  });

  it('places no buildings on terrain POIs', () => {
    for (const id of ['crystal_lake', 'murkmire_swamp', 'eastern_peaks']) {
      expect(getZoneRule(poi(id).type).buildingCount.max).toBe(0);
    }
  });
});
