import { describe, it, expect } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack } from '@/catalogue/pack';
import { validate } from '@/catalogue/constraints';
import { medievalEuropePack } from '@/catalogue/packs/medieval-europe';
import { buildRoleLadders, MEDIEVAL_MATERIALS } from '@/catalogue/packs/medieval-europe/materials';
import { buildingRefsExist } from '@/catalogue/packs/medieval-europe/constraints';
import { BUILDING_BLUEPRINTS } from '@/blueprint/presets';

function loadedRegistry(): CatalogueRegistry {
  const r = new CatalogueRegistry();
  loadPack(medievalEuropePack, r);
  return r;
}

describe('medieval-europe pack', () => {
  it('meets the seed-content minimums', () => {
    const r = loadedRegistry();
    expect(r.all('buildingType').length).toBeGreaterThanOrEqual(14);
    expect(r.all('roomType').length).toBeGreaterThanOrEqual(40);
    expect(r.all('fixtureType').length).toBeGreaterThanOrEqual(38);
    expect(r.all('portalType').length).toBeGreaterThanOrEqual(18);
    expect(r.all('material').length).toBeGreaterThanOrEqual(15);
    expect(r.all('topology').length).toBe(5); // + enclosure (defended-complex grammar)
    expect(r.all('smokeSystem').length).toBeGreaterThanOrEqual(4);
    expect(r.all('barrierType').length).toBeGreaterThanOrEqual(6); // DC-1 defensive linears
    expect(r.all('complexType').length).toBeGreaterThanOrEqual(3); // motte-and-bailey, ringwork, town wall
  });

  it('validate() over every buildingType returns zero errors (all refs resolve)', () => {
    const r = loadedRegistry();
    const errors = r
      .all('buildingType')
      .flatMap((e) => validate(e as never, [buildingRefsExist as never], r).issues)
      .filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('every existing building/prop preset resolves to a buildingType entry', () => {
    const r = loadedRegistry();
    const presetIds = Object.entries(BUILDING_BLUEPRINTS)
      .filter(([, bp]) => bp.class === 'building')
      .map(([id]) => id);
    const missing = presetIds.filter((id) => !r.get('buildingType', id));
    expect(missing).toEqual([]);
  });

  it('material role ladders reproduce the canonical descriptor ladders', () => {
    const ladders = buildRoleLadders(MEDIEVAL_MATERIALS);
    expect(ladders.walls).toEqual(['mud', 'wattle', 'timber', 'brick', 'stone']);
    expect(ladders.roof).toEqual(['thatch', 'wood', 'shingle', 'tile', 'slate']);
    expect(ladders.ground).toEqual(['dirt', 'packed_dirt', 'gravel', 'cobble', 'flagstone']);
  });

  it('smoke timeline: no chimney before late+rich medieval', () => {
    const r = loadedRegistry();
    const chimney = r.get('smokeSystem', 'wall-chimney');
    expect(chimney?.fields.eras).not.toContain('ancient');
    expect(chimney?.fields.eras).not.toContain('classical');
    expect(chimney?.fields.wealth).toContain('rich');
  });
});
