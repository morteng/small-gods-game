import { describe, it, expect } from 'vitest';
import { presetsForEra, getZoneRule, POI_ZONE_RULES } from '@/map/poi-zones';
import type { ZoneRule } from '@/map/poi-zones';

const rule = (extra: Partial<ZoneRule> = {}): ZoneRule => ({
  radius: { min: 2, max: 3 },
  buildings: ['cottage', 'tavern'],
  buildingCount: { min: 1, max: 2 },
  decorations: [],
  internalRoads: false,
  internalRoadType: 'dirt_road',
  ...extra,
});

describe('presetsForEra', () => {
  it('returns the era variant when present', () => {
    const r = rule({ buildingsByEra: { primordial: ['yurt'] } });
    expect(presetsForEra(r, 'primordial')).toEqual(['yurt']);
  });
  it('falls back to buildings when the era key is absent', () => {
    const r = rule({ buildingsByEra: { primordial: ['yurt'] } });
    expect(presetsForEra(r, 'medieval')).toEqual(['cottage', 'tavern']);
  });
  it('falls back to buildings when buildingsByEra is undefined', () => {
    expect(presetsForEra(rule(), 'ancient')).toEqual(['cottage', 'tavern']);
  });
});

describe('authored era rosters', () => {
  it('village primordial roster is yurt-based', () => {
    const r = presetsForEra(POI_ZONE_RULES.village, 'primordial');
    expect(r).toContain('yurt');
    expect(r).not.toContain('cottage');
  });
  it('village medieval default includes a longhouse', () => {
    expect(presetsForEra(POI_ZONE_RULES.village, 'medieval')).toContain('longhouse');
  });
  it('temple default pairs a temple with a shrine', () => {
    expect(presetsForEra(POI_ZONE_RULES.temple, 'medieval')).toEqual(['temple_small', 'shrine']);
  });
  it('castle default includes a guard post', () => {
    expect(presetsForEra(POI_ZONE_RULES.castle, 'medieval')).toContain('guard_post');
  });
  it('mine places a guard post, not a tower', () => {
    expect(POI_ZONE_RULES.mine.buildings).toEqual(['guard_post']);
  });
  it('ruins default to a shrine; ancient ruins add a temple', () => {
    expect(presetsForEra(POI_ZONE_RULES.ruins, 'medieval')).toEqual(['shrine']);
    expect(presetsForEra(POI_ZONE_RULES.ruins, 'ancient')).toContain('temple_small');
  });
});

describe('non-settlement POI fallback', () => {
  it('places zero buildings for an unknown POI type', () => {
    const r = getZoneRule('lake');
    expect(r.buildingCount.max).toBe(0);
    expect(r.buildings).toEqual([]);
    expect(r.roadLayout).toBe('none');
  });
});
