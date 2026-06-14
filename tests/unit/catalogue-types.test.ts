import { describe, it, expect } from 'vitest';
import type {
  FactEntry,
  CatalogueKind,
  BuildingTypeFields,
  MaterialFields,
  SmokeSystemFields,
} from '@/catalogue/types';

describe('catalogue types', () => {
  it('a FactEntry round-trips with the required + optional fields', () => {
    const entry: FactEntry<BuildingTypeFields> = {
      id: 'cottage',
      kind: 'buildingType',
      pack: 'medieval-europe',
      applicability: { eras: ['medieval'] },
      lod: {
        l0: 'a single-room peasant dwelling',
        l1: ['mud walls', 'thatched roof', 'low eaves'],
        l2: 'A one-bay cruck-framed house with a central open hearth.',
      },
      fields: {
        topology: 'tripartite-linear',
        roomProgram: [{ type: 'hall', count: 1, bays: 1 }],
        entrance: { face: 's', sizeClass: 'human' },
        hearthRule: { room: 'hall', fixture: 'open-hearth' },
        sizeBays: [1, 2],
        defaultMaterials: { walls: 'cob', roof: 'thatch', ground: 'earth' },
      },
      provenance: ['https://en.wikipedia.org/wiki/Cottage'],
      visibility: 'geometry',
      tags: ['dwelling', 'rural'],
    };
    expect(entry.id).toBe('cottage');
    expect(entry.fields.roomProgram[0].type).toBe('hall');
    expect(entry.lod.l1).toContain('thatched roof');
  });

  it('CatalogueKind accepts the core kinds AND arbitrary pack-defined strings', () => {
    const core: CatalogueKind = 'buildingType';
    const custom: CatalogueKind = 'starshipDeckType';
    expect(core).toBe('buildingType');
    expect(custom).toBe('starshipDeckType');
  });

  it('cross-cutting field interfaces typecheck', () => {
    const mat: MaterialFields = { wealthLadder: ['cob', 'timber', 'stone'], rgb: '#8a7355' };
    const smoke: SmokeSystemFields = { egressFixture: 'louver', eras: ['medieval'] };
    expect(mat.wealthLadder?.[2]).toBe('stone');
    expect(smoke.egressFixture).toBe('louver');
  });
});
