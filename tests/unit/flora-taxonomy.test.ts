// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { deriveGenParams, deriveGenerator, taxon, type Botanical } from '@/flora/flora-species';
import { getFloraSpecies } from '@/flora/flora-registry';

const tree = (over: Partial<Botanical>): Botanical => ({
  habit: 'tree', matureHeight_m: { min: 10, max: 20 }, crownShape: 'rounded',
  leafType: 'broadleaf', leafPhenology: 'deciduous', ...over,
});

describe('flora generator derivation', () => {
  it('routes conifers to space colonization, broadleaf to proctree, small plants to lsystem', () => {
    expect(deriveGenerator(tree({ leafType: 'needle', leafPhenology: 'evergreen', crownShape: 'conical' }))).toBe('spacecol');
    expect(deriveGenerator(tree({ crownShape: 'spreading' }))).toBe('proctree');
    expect(deriveGenerator(tree({ crownShape: 'weeping' }))).toBe('proctree');
    expect(deriveGenerator({ ...tree({}), habit: 'shrub' })).toBe('proctree');
    expect(deriveGenerator({ ...tree({}), habit: 'fern' })).toBe('lsystem');
    expect(deriveGenerator({ ...tree({}), habit: 'grass' })).toBe('lsystem');
  });

  it('deriveGenParams carries generator + crownShape onto plant params', () => {
    const oak = getFloraSpecies('english-oak')!;
    const g = deriveGenParams(oak);
    expect(g.kind).toBe('plant');
    expect(g.generator).toBe('proctree');
    expect(g.crownShape).toBe(oak.botanical.crownShape);
  });
});

describe('taxonomy', () => {
  it('parses a binomial when genus/species are not given explicitly', () => {
    const t = taxon({ commonName: 'English oak', scientificName: 'Quercus robur', family: 'Fagaceae', wikipediaTitle: 'Quercus robur' });
    expect(t.genus).toBe('Quercus');
    expect(t.species).toBe('robur');
    expect(t.cultivar).toBeUndefined();
  });

  it('honours an explicit cultivar — a particular kind within a species', () => {
    const weeping = getFloraSpecies('weeping-birch')!;
    const t = taxon(weeping.identity);
    expect(t.genus).toBe('Betula');
    expect(t.species).toBe('pendula');
    expect(t.cultivar).toBe('Youngii');
  });

  it('silver and weeping birch share a species but get distinct geometry generators', () => {
    const silver = getFloraSpecies('silver-birch')!;
    const weeping = getFloraSpecies('weeping-birch')!;
    expect(taxon(silver.identity).species).toBe(taxon(weeping.identity).species); // both pendula
    // …yet the weeping cultivar's crownShape routes its geometry differently.
    expect(silver.botanical.crownShape).not.toBe(weeping.botanical.crownShape);
    expect(deriveGenParams(weeping).crownShape).toBe('weeping');
  });
});
