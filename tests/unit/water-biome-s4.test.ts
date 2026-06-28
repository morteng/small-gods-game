import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed } from '@/core/types';
import {
  WATER_BIOMES, classifyWaterCell, climateOf, getWaterBiome,
} from '@/water/water-biome';
import { buildWaterField, MESH_BAND_DILATE } from '@/render/gpu/water-field';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { clearHydrologyCache } from '@/world/hydrology-store';

describe('Water S4 — aquatic biomes', () => {
  it('classifies cells by climate × body kind, with a total fallback', () => {
    expect(classifyWaterCell(WaterType.Ocean, 'temperate')?.id).toBe('temperate-ocean');
    expect(classifyWaterCell(WaterType.Lake, 'temperate')?.id).toBe('temperate-lake');
    expect(classifyWaterCell(WaterType.River, 'temperate')?.id).toBe('temperate-river');
    expect(classifyWaterCell(WaterType.Lake, 'boreal')?.id).toBe('boreal-lake');
    expect(classifyWaterCell(WaterType.River, 'highland')?.id).toBe('highland-river');
    // No arid-ocean in the catalogue → falls back to the temperate variant.
    expect(classifyWaterCell(WaterType.Ocean, 'arid')?.id).toBe('temperate-ocean');
    expect(classifyWaterCell(WaterType.Dry, 'temperate')).toBeNull();
  });

  it('maps climate labels to bands', () => {
    expect(climateOf('boreal forest')).toBe('boreal');
    expect(climateOf('hot desert')).toBe('arid');
    expect(climateOf('alpine')).toBe('highland');
    expect(climateOf('temperate')).toBe('temperate');
    expect(climateOf(undefined)).toBe('temperate');
  });

  it('catalogue records are well-formed (colours in range, clarity 0..1, sourced)', () => {
    for (const b of WATER_BIOMES) {
      expect(getWaterBiome(b.id)).toBe(b);
      expect(b.clarity).toBeGreaterThan(0);
      expect(b.clarity).toBeLessThanOrEqual(1);
      for (const c of [...b.shallowColor, ...b.deepColor]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
      expect(b.sources.length).toBeGreaterThan(0);
      expect(b.keyFacts.length).toBeGreaterThan(0);
    }
  });

  it('populates per-cell biome colour + clarity on a generated world', async () => {
    clearHydrologyCache();
    const seed: WorldSeed = {
      name: 'test', size: { width: 64, height: 64 }, biome: 'temperate',
      pois: [], connections: [], constraints: [],
    };
    const { map } = await generateWithNoise(64, 64, 1, seed);
    const W = map.width;
    const wf = buildWaterField(map, {
      viewport: [800, 600], xform: { sx: 1, sy: 1, ox: 0, oy: 0 }, lighting: DEFAULT_LIGHTING,
    })!;
    // `dilateRiverColour` intentionally bleeds river biome colour into a MESH_BAND_DILATE
    // band of DRY cells around each river, so analytic-channel fragments always have a
    // non-zero colour neighbour to blend (kills the black bank wedges). Those painted dry
    // cells are never rendered as water — non-channel fragments discard — so the colour is
    // invisible. It does mean "dry ⇒ clarity 0" only holds OUTSIDE that band; exempt it.
    const rivers: Array<[number, number]> = [];
    for (let i = 0; i < wf.waterType.length; i++) {
      if (wf.waterType[i] === WaterType.River) rivers.push([i % W, (i / W) | 0]);
    }
    const inRiverBand = (i: number): boolean => {
      const x = i % W, y = (i / W) | 0;
      return rivers.some(([rx, ry]) => Math.abs(rx - x) <= MESH_BAND_DILATE && Math.abs(ry - y) <= MESH_BAND_DILATE);
    };
    let wet = 0, withColour = 0;
    for (let i = 0; i < wf.waterType.length; i++) {
      if (wf.waterType[i] === WaterType.Dry) {
        // Dry LAND away from any river carries no biome; the river-bank bleed band is exempt.
        if (!inRiverBand(i)) expect(wf.clarity[i]).toBe(0);
      } else {
        wet++;
        if (wf.shallow[i] !== 0 && wf.clarity[i] > 0) withColour++;
      }
    }
    expect(wet).toBeGreaterThan(0);
    expect(withColour).toBe(wet); // every wet cell got a biome palette + clarity
  });
});
