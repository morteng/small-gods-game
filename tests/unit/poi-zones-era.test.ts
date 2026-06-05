import { describe, it, expect } from 'vitest';
import { presetsForEra } from '@/map/poi-zones';
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
