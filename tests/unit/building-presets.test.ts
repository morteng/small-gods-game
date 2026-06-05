import { describe, it, expect } from 'vitest';
import {
  BUILDING_PRESETS, getPreset, synthesizeFromPreset,
} from '@/world/building-presets';

describe('building-presets', () => {
  it('every preset is well-formed (footprint > 0, door inside footprint, levels >= 1)', () => {
    for (const [name, d] of Object.entries(BUILDING_PRESETS)) {
      expect(d.footprint.w, name).toBeGreaterThan(0);
      expect(d.footprint.h, name).toBeGreaterThan(0);
      expect(d.levels, name).toBeGreaterThanOrEqual(1);
      expect(d.door.x, name).toBeGreaterThanOrEqual(0);
      expect(d.door.x, name).toBeLessThan(d.footprint.w);
      expect(d.door.y, name).toBeGreaterThanOrEqual(0);
      expect(d.door.y, name).toBeLessThan(d.footprint.h);
    }
  });

  it('includes the eight legacy buildings plus shrine and guard_post', () => {
    for (const name of ['cottage', 'tavern', 'market_stall', 'temple_small',
                         'farm_barn', 'tower', 'castle_keep', 'dock', 'shrine', 'guard_post']) {
      expect(getPreset(name), name).toBeDefined();
    }
  });

  it('models a ziggurat-shaped keep and a round yurt', () => {
    expect(getPreset('castle_keep')!.plan).toBe('stepped');
    expect(getPreset('castle_keep')!.levelInset).toBeGreaterThan(0);
    expect(getPreset('yurt')!.plan).toBe('round');
    expect(getPreset('yurt')!.roof).toBe('domed');
  });

  it('synthesize clones (no shared mutable footprint) and applies overrides', () => {
    const a = synthesizeFromPreset('cottage')!;
    const b = synthesizeFromPreset('cottage', { footprint: { w: 5, h: 5 } })!;
    a.footprint.w = 99;
    expect(getPreset('cottage')!.footprint.w).toBe(3); // preset untouched
    expect(b.footprint.w).toBe(5);
    expect(b.preset).toBe('cottage');
  });

});
