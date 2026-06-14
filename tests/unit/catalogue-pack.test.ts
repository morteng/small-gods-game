import { describe, it, expect } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack, registerFact, registerPack, catalogue, type FactPack } from '@/catalogue/pack';
import type { FactEntry } from '@/catalogue/types';

function entry(id: string, kind: string, pack = 'test'): FactEntry {
  return { id, kind, pack, lod: { l0: id, l1: [] }, fields: {} };
}

const tinyPack: FactPack = {
  name: 'tiny',
  entries: [entry('cottage', 'buildingType', 'tiny'), entry('hall', 'roomType', 'tiny')],
  constraints: [{ id: 'noop', severity: 'warn', check: () => true, message: '' }],
  grammarRules: [],
};

describe('FactPack loader + agent seam', () => {
  it('loadPack registers every entry into a target registry', () => {
    const r = new CatalogueRegistry();
    loadPack(tinyPack, r);
    expect(r.get('buildingType', 'cottage')?.pack).toBe('tiny');
    expect(r.get('roomType', 'hall')).toBeDefined();
    expect(r.size).toBe(2);
  });

  it('a later pack overrides an overlapping (kind,id)', () => {
    const r = new CatalogueRegistry();
    loadPack(tinyPack, r);
    loadPack(
      { name: 'override', entries: [entry('cottage', 'buildingType', 'override')], constraints: [], grammarRules: [] },
      r,
    );
    expect(r.get('buildingType', 'cottage')?.pack).toBe('override');
  });

  it('registerFact / registerPack operate on the default singleton', () => {
    registerFact(entry('starship-bridge', 'buildingType', 'agent'));
    expect(catalogue.get('buildingType', 'starship-bridge')?.pack).toBe('agent');
    registerPack({ name: 'agent-pack', entries: [entry('airlock', 'roomType', 'agent')], constraints: [], grammarRules: [] });
    expect(catalogue.get('roomType', 'airlock')).toBeDefined();
  });
});
