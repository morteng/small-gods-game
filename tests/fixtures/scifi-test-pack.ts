/**
 * A deliberately alien content pack — proof that the catalogue + connectome engine
 * is domain-neutral. NOTHING medieval here; if this pack registers, validates, and
 * expands through the unchanged engine, the "supports any age incl. fantasy/sci-fi/
 * custom" requirement holds. Used by catalogue-domain-neutral.test.ts.
 */
import type { FactEntry, BuildingTypeFields, RoomTypeFields, PortalTypeFields, TopologyFields } from '@/catalogue/types';
import type { FactPack } from '@/catalogue/pack';

const buildingType: FactEntry<BuildingTypeFields> = {
  id: 'hab-module',
  kind: 'buildingType',
  pack: 'scifi-test',
  lod: { l0: 'an orbital habitation module', l1: ['ribbed hull', 'airlock', 'viewport'] },
  fields: {
    // reuses an existing structural topology id — interpreters are engine-shared
    topology: 'vertical-stack',
    roomProgram: [{ type: 'airlock', count: 1, bays: 1 }, { type: 'crew-deck', count: 2, bays: 1 }],
    entrance: { face: 's', sizeClass: 'human', portal: 'pressure-hatch' },
    hearthRule: { room: 'none' },
    sizeBays: [1, 3],
    defaultMaterials: { walls: 'titanium', roof: 'composite', ground: 'deckplate' },
  },
};

const rooms: FactEntry<RoomTypeFields>[] = [
  { id: 'airlock', kind: 'roomType', pack: 'scifi-test', lod: { l0: 'an airlock', l1: ['twin doors'] }, fields: { fn: 'circulation' } },
  { id: 'crew-deck', kind: 'roomType', pack: 'scifi-test', lod: { l0: 'a crew deck', l1: ['bunks'] }, fields: { fn: 'living', needsLight: true } },
];

const portal: FactEntry<PortalTypeFields> = {
  id: 'pressure-hatch',
  kind: 'portalType',
  pack: 'scifi-test',
  lod: { l0: 'a pressure hatch', l1: ['sealed', 'wheel lock'] },
  fields: { sizeClass: 'human', passable: true, widthHint: 1.0, heightHint: 2.0 },
};

// the pack may even add its own topology + (engine) interpreter; here it reuses one
const topology: FactEntry<TopologyFields> = {
  id: 'vertical-stack',
  kind: 'topology',
  pack: 'scifi-test',
  lod: { l0: 'stacked decks', l1: [] },
  fields: { interpreter: 'vertical-stack' },
};

export const scifiTestPack: FactPack = {
  name: 'scifi-test',
  entries: [buildingType, ...rooms, portal, topology] as unknown as FactEntry[],
  constraints: [],
  grammarRules: [],
};
