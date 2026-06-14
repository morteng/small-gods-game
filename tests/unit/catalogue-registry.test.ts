import { describe, it, expect } from 'vitest';
import { CatalogueRegistry, appliesTo } from '@/catalogue/registry';
import type { FactEntry } from '@/catalogue/types';

function entry(over: Partial<FactEntry> & Pick<FactEntry, 'id' | 'kind'>): FactEntry {
  return {
    pack: 'test',
    lod: { l0: over.id, l1: [] },
    fields: {},
    ...over,
  };
}

describe('CatalogueRegistry', () => {
  it('register + get round-trips; unknown get returns undefined', () => {
    const r = new CatalogueRegistry();
    r.register(entry({ id: 'cottage', kind: 'buildingType' }));
    expect(r.get('buildingType', 'cottage')?.id).toBe('cottage');
    expect(r.get('buildingType', 'nope')).toBeUndefined();
    expect(r.get('roomType', 'cottage')).toBeUndefined(); // kind-scoped
  });

  it('all(kind) lists entries of that kind only', () => {
    const r = new CatalogueRegistry();
    r.register(entry({ id: 'cottage', kind: 'buildingType' }));
    r.register(entry({ id: 'tavern', kind: 'buildingType' }));
    r.register(entry({ id: 'hall', kind: 'roomType' }));
    expect(r.all('buildingType').map((e) => e.id).sort()).toEqual(['cottage', 'tavern']);
    expect(r.all('roomType').map((e) => e.id)).toEqual(['hall']);
  });

  it('query filters by applicability era', () => {
    const r = new CatalogueRegistry();
    r.register(entry({ id: 'always', kind: 'material' }));
    r.register(entry({ id: 'medieval-only', kind: 'material', applicability: { eras: ['medieval'] } }));
    expect(r.query({ kind: 'material', era: 'ancient' }).map((e) => e.id)).toEqual(['always']);
    expect(r.query({ kind: 'material', era: 'medieval' }).map((e) => e.id).sort()).toEqual([
      'always',
      'medieval-only',
    ]);
    expect(r.query({ kind: 'material' }).length).toBe(2); // no era filter = all
  });

  it('later (kind,id) overrides earlier — last pack wins', () => {
    const r = new CatalogueRegistry();
    r.register(entry({ id: 'cob', kind: 'material', pack: 'a', lod: { l0: 'first', l1: [] } }));
    r.register(entry({ id: 'cob', kind: 'material', pack: 'b', lod: { l0: 'second', l1: [] } }));
    expect(r.get('material', 'cob')?.pack).toBe('b');
    expect(r.all('material').length).toBe(1);
  });

  it('appliesTo matches era + region + wealth axes (AND across axes)', () => {
    const e = entry({ id: 'x', kind: 'material', applicability: { eras: ['medieval'], wealth: ['rich'] } });
    expect(appliesTo(e, { era: 'medieval', wealth: 'rich' })).toBe(true);
    expect(appliesTo(e, { era: 'medieval', wealth: 'poor' })).toBe(false);
    expect(appliesTo(e, { era: 'ancient', wealth: 'rich' })).toBe(false);
    expect(appliesTo(e, {})).toBe(true); // no filters = matches
  });
});
