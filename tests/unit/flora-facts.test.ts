// tests/unit/flora-facts.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  deriveRecipe, deriveTrunkR, deriveGenParams,
  type Botanical, type FloraSpecies,
} from '@/flora/flora-species';
import { FLORA_FACTS } from '@/flora/flora-facts-data';
import {
  getFloraSpecies, allFloraSpecies, floraGenParams, registerFloraSpecies,
  resolveFloraSpecies, setFloraFactProvider, __resetFloraRuntime,
} from '@/flora/flora-registry';
import { branchPlantPartType, rockPartType } from '@/blueprint/parts/flora-branch';
import { FLORA_RECIPE_NAMES, buildFloraSkeleton, type FloraRecipeName } from '@/assetgen/geometry/flora/recipes';
import { createRng } from '@/core/rng';

const bot = (over: Partial<Botanical>): Botanical => ({
  habit: 'tree', matureHeight_m: { min: 10, max: 20 }, crownShape: 'rounded',
  leafType: 'broadleaf', leafPhenology: 'deciduous', ...over,
});

afterEach(() => __resetFloraRuntime());

describe('deriveRecipe — botanical habit/crown/leaf → L-system recipe', () => {
  it('weeping tree → willow', () => {
    expect(deriveRecipe(bot({ habit: 'tree', crownShape: 'weeping' }))).toBe('willow');
  });
  it('conical evergreen → pine', () => {
    expect(deriveRecipe(bot({ habit: 'tree', crownShape: 'conical', leafPhenology: 'evergreen', leafType: 'needle' }))).toBe('pine');
  });
  it('needle-leaved tree → pine regardless of crown', () => {
    expect(deriveRecipe(bot({ habit: 'tree', crownShape: 'irregular', leafType: 'needle', leafPhenology: 'evergreen' }))).toBe('pine');
  });
  it('rounded broadleaf tree → oak', () => {
    expect(deriveRecipe(bot({ habit: 'tree', crownShape: 'rounded' }))).toBe('oak');
  });
  it('shrub → shrub, fern → fern, herb → flower, grass → grass', () => {
    expect(deriveRecipe(bot({ habit: 'shrub' }))).toBe('shrub');
    expect(deriveRecipe(bot({ habit: 'fern' }))).toBe('fern');
    expect(deriveRecipe(bot({ habit: 'herb' }))).toBe('flower');
    // grass got its own blade-tussock recipe (was collapsed onto 'flower').
    expect(deriveRecipe(bot({ habit: 'grass' }))).toBe('grass');
  });
});

describe('deriveTrunkR', () => {
  it('uses measured trunk diameter (radius) when present', () => {
    const r = deriveTrunkR(bot({ trunkDiameter_m: { min: 0.4, max: 0.6 } }));
    expect(r).toBeCloseTo(0.25, 5);   // mid 0.5 → radius 0.25
  });
  it('falls back to a height-scaled heuristic and clamps to [0.02, 0.5]', () => {
    expect(deriveTrunkR(bot({ matureHeight_m: { min: 40, max: 40 } }))).toBe(0.5);       // 0.72 → clamp
    expect(deriveTrunkR(bot({ habit: 'herb', matureHeight_m: { min: 0.3, max: 0.3 } }))).toBe(0.02); // tiny → clamp
  });
});

describe('deriveGenParams', () => {
  it('plants get a recipe + trunkR; midpoint height', () => {
    const species: FloraSpecies = {
      id: 'x', identity: {} as never,
      botanical: bot({ matureHeight_m: { min: 20, max: 40 } }),
      ecology: {} as never, narrative: {} as never,
    };
    const g = deriveGenParams(species);
    expect(g.kind).toBe('plant');
    expect(g.recipe).toBe('oak');
    expect(g.heightM).toBe(30);
    expect(g.trunkR).toBeGreaterThan(0);
  });
  it('rocks get sizeM/jitter, no recipe', () => {
    const species: FloraSpecies = {
      id: 'r', identity: {} as never,
      botanical: bot({ habit: 'rock', matureHeight_m: { min: 1, max: 3 }, crownShape: 'none', leafType: 'none', leafPhenology: 'none' }),
      ecology: {} as never, narrative: {} as never,
    };
    const g = deriveGenParams(species);
    expect(g.kind).toBe('rock');
    expect(g.recipe).toBeUndefined();
    expect(g.sizeM).toBe(2);
    expect(g.jitter).toBe(0.35);
  });
  it('explicit generation overrides win', () => {
    const species: FloraSpecies = {
      id: 'r', identity: {} as never,
      botanical: bot({ habit: 'rock', matureHeight_m: { min: 1, max: 3 }, crownShape: 'none', leafType: 'none', leafPhenology: 'none' }),
      ecology: {} as never, narrative: {} as never, generation: { jitter: 0.6 },
    };
    expect(deriveGenParams(species).jitter).toBe(0.6);
  });
});

describe('curated fact-DB integrity', () => {
  it('has a healthy curated core (20–55 species)', () => {
    expect(FLORA_FACTS.length).toBeGreaterThanOrEqual(20);
    expect(FLORA_FACTS.length).toBeLessThanOrEqual(55);
  });
  it('ids are unique kebab-case slugs', () => {
    const ids = FLORA_FACTS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });
  it('every species cites a Wikipedia source and carries at least one key fact', () => {
    for (const s of FLORA_FACTS) {
      expect(s.narrative.keyFacts.length).toBeGreaterThan(0);
      expect(s.narrative.sources.length).toBeGreaterThan(0);
      expect(s.identity.wikipediaTitle.length).toBeGreaterThan(0);
    }
  });
  it('every plant derives a recipe in the part-type catalogue, within param bounds', () => {
    const branch = branchPlantPartType.paramSchema!;
    const hM = branch.heightM as { min: number; max: number };
    const tR = branch.trunkR as { min: number; max: number };
    for (const s of FLORA_FACTS) {
      const g = deriveGenParams(s);
      if (g.kind !== 'plant') continue;
      expect(FLORA_RECIPE_NAMES).toContain(g.recipe as FloraRecipeName);
      expect(g.heightM).toBeGreaterThanOrEqual(hM.min);
      expect(g.heightM).toBeLessThanOrEqual(hM.max);
      expect(g.trunkR!).toBeGreaterThanOrEqual(tR.min);
      expect(g.trunkR!).toBeLessThanOrEqual(tR.max);
    }
  });
  it('every rock derives sizeM/jitter within the rock part bounds', () => {
    const rock = rockPartType.paramSchema!;
    const sz = rock.sizeM as { min: number; max: number };
    const jt = rock.jitter as { min: number; max: number };
    for (const s of FLORA_FACTS) {
      const g = deriveGenParams(s);
      if (g.kind !== 'rock') continue;
      expect(g.sizeM!).toBeGreaterThanOrEqual(sz.min);
      expect(g.sizeM!).toBeLessThanOrEqual(sz.max);
      expect(g.jitter!).toBeGreaterThanOrEqual(jt.min);
      expect(g.jitter!).toBeLessThanOrEqual(jt.max);
    }
  });
  it('derived params actually grow a non-empty skeleton (derive → generate loop)', () => {
    const oak = deriveGenParams(getFloraSpecies('english-oak')!);
    const skel = buildFloraSkeleton({ recipe: oak.recipe!, heightTiles: oak.heightM / 2, baseRadius: oak.trunkR!, rng: createRng(1) });
    expect(skel.limbs.length).toBeGreaterThan(0);
  });
});

describe('flora-registry', () => {
  it('looks up curated species and lists them all', () => {
    expect(getFloraSpecies('scots-pine')?.identity.scientificName).toBe('Pinus sylvestris');
    expect(allFloraSpecies().length).toBe(FLORA_FACTS.length);
    expect(getFloraSpecies('nonexistent')).toBeUndefined();
  });
  it('floraGenParams memoizes (same object on repeat)', () => {
    const a = floraGenParams('weeping-willow');
    const b = floraGenParams('weeping-willow');
    expect(a).toBe(b);
    expect(a?.recipe).toBe('willow');
  });
  it('lazy-fill: a miss falls through to the provider, then is registered', async () => {
    expect(getFloraSpecies('rowan')).toBeUndefined();
    const rowan: FloraSpecies = {
      id: 'rowan', identity: { commonName: 'Rowan', scientificName: 'Sorbus aucuparia', family: 'Rosaceae', wikipediaTitle: 'Sorbus aucuparia' },
      botanical: bot({ matureHeight_m: { min: 8, max: 15 } }),
      ecology: { biome: ['highland'], nativeRange: ['Europe'] },
      narrative: { keyFacts: ['fetched'], sources: ['Sorbus aucuparia'] },
    };
    let calls = 0;
    setFloraFactProvider({ fetch: async () => { calls++; return rowan; } });
    const r1 = await resolveFloraSpecies('rowan');
    expect(r1?.id).toBe('rowan');
    expect(getFloraSpecies('rowan')).toBe(rowan);   // now synchronous
    await resolveFloraSpecies('rowan');             // cached → no second fetch
    expect(calls).toBe(1);
    expect(floraGenParams('rowan')?.recipe).toBe('oak');
  });
  it('registerFloraSpecies shadows the curated core for the same id', () => {
    registerFloraSpecies({ ...getFloraSpecies('english-oak')!, generation: { heightM: 5 } });
    expect(floraGenParams('english-oak')?.heightM).toBe(5);
  });
});
