import { describe, it, expect, afterEach } from 'vitest';
import {
  floraSwayAmplitude, registerFloraSpecies, __resetFloraRuntime,
} from '@/flora/flora-registry';
import type { FloraSpecies, FloraHabit, Botanical } from '@/flora/flora-species';

/** Minimal valid species with a chosen habit + optional authored flexibility. */
function species(id: string, habit: FloraHabit, over: Partial<Botanical> = {}): FloraSpecies {
  return {
    id,
    identity: { commonName: id, scientificName: 'Genus species', family: 'Fam', wikipediaTitle: id },
    botanical: {
      habit, matureHeight_m: { min: 1, max: 2 }, crownShape: 'rounded',
      leafType: 'broadleaf', leafPhenology: 'deciduous', ...over,
    },
    ecology: { biome: ['temperate'], nativeRange: ['x'] },
    narrative: { keyFacts: [], sources: [] },
  };
}

describe('floraSwayAmplitude', () => {
  afterEach(() => __resetFloraRuntime());

  it('uses the authored botanical flexibility when present (clamped 0..1)', () => {
    registerFloraSpecies(species('whippy', 'tree', { flexibility: 0.7 }));
    registerFloraSpecies(species('over', 'tree', { flexibility: 1.5 }));
    registerFloraSpecies(species('under', 'tree', { flexibility: -0.3 }));
    expect(floraSwayAmplitude('whippy')).toBeCloseTo(0.7);
    expect(floraSwayAmplitude('over')).toBe(1);
    expect(floraSwayAmplitude('under')).toBe(0);
  });

  it('falls back to a per-habit default when flexibility is unauthored', () => {
    registerFloraSpecies(species('broadleaf', 'tree'));
    registerFloraSpecies(species('conifer', 'tree', { leafType: 'needle', leafPhenology: 'evergreen' }));
    registerFloraSpecies(species('bush', 'shrub'));
    registerFloraSpecies(species('weed', 'herb'));
    registerFloraSpecies(species('boulder', 'rock'));
    expect(floraSwayAmplitude('broadleaf')).toBe(0.35);
    expect(floraSwayAmplitude('conifer')).toBe(0.18); // needle trees barely stir
    expect(floraSwayAmplitude('bush')).toBe(0.55);
    expect(floraSwayAmplitude('weed')).toBe(0.8);
    expect(floraSwayAmplitude('boulder')).toBe(0); // rocks never sway
  });

  it('is 0 for an unknown species (rigid ⇒ the shader takes the no-motion path)', () => {
    expect(floraSwayAmplitude('does-not-exist')).toBe(0);
  });
});
