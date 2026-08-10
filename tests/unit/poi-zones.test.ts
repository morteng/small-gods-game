import { describe, it, expect, vi, afterEach } from 'vitest';
import { getZoneRule, POI_ZONE_RULES } from '@/map/poi-zones';

describe('getZoneRule unknown-type guard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn for any of the ten authored POI types', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const type of Object.keys(POI_ZONE_RULES)) {
      getZoneRule(type);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once for an unrecognised POI type and still returns the zero-building fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rule = getZoneRule('gazebo-xyz');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('gazebo-xyz');
    expect(rule).toEqual({
      radius: { min: 1, max: 2 },
      buildings: [],
      buildingCount: { min: 0, max: 0 },
      decorations: [],
      internalRoads: false,
      internalRoadType: 'dirt_road',
      roadLayout: 'none',
    });
  });

  it('does not warn again for the same unknown type on a later call (memoised)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getZoneRule('hovel-abc');
    getZoneRule('hovel-abc');
    getZoneRule('hovel-abc');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('warns separately for a second, distinct unknown type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getZoneRule('shack-def');
    getZoneRule('shack-def');
    getZoneRule('another-unknown-ghi');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the deliberate studio-only "hamlet" type also hits the unknown-type fallback (and warns once)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rule = getZoneRule('hamlet');
    expect(rule.buildingCount).toEqual({ min: 0, max: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
