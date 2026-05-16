import { describe, it, expect } from 'vitest';
import { brushForBiome, brushForPoiType } from '@/world/brushes/index';
import { listBrushes } from '@/world/brushes';

describe('brush dispatch', () => {
  it('all 14 brushes are registered on import', () => {
    const names = listBrushes();
    for (const n of ['forest','dense_forest','pine_forest','scrubland','sacred_grove',
                     'coastal','hills','quarry','village','temple','farm','castle','dock','wilderness']) {
      expect(names).toContain(n);
    }
  });

  it('brushForBiome maps biome names to brush names', () => {
    expect(brushForBiome('temperate_forest')).toBe('forest');
    expect(brushForBiome('boreal_forest')).toBe('pine_forest');
    expect(brushForBiome('tropical_forest')).toBe('dense_forest');
    expect(brushForBiome('sacred_grove')).toBe('sacred_grove');
    expect(brushForBiome('scrubland')).toBe('scrubland');
    expect(brushForBiome('beach')).toBe('coastal');
    expect(brushForBiome('mountain')).toBe('hills');
    expect(brushForBiome('savanna')).toBe('scrubland');
    expect(brushForBiome('tundra')).toBe('hills');
  });

  it('brushForBiome returns null for ocean biomes', () => {
    expect(brushForBiome('deep_ocean')).toBeNull();
    expect(brushForBiome('ocean')).toBeNull();
  });

  it('brushForBiome returns null for unknown biomes', () => {
    expect(brushForBiome('not_a_real_biome')).toBeNull();
  });

  it('brushForPoiType maps POI types to brush names', () => {
    expect(brushForPoiType('village')).toBe('village');
    expect(brushForPoiType('city')).toBe('village');
    expect(brushForPoiType('temple')).toBe('temple');
    expect(brushForPoiType('farm')).toBe('farm');
    expect(brushForPoiType('castle')).toBe('castle');
    expect(brushForPoiType('port')).toBe('dock');
    expect(brushForPoiType('mine')).toBe('quarry');
    expect(brushForPoiType('ruins')).toBe('wilderness');
    expect(brushForPoiType('unknown_type_xyz')).toBe('wilderness');
  });
});
