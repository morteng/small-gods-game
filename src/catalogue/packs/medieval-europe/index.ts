/**
 * medieval-europe — the default content pack. Assembles every kind's entries plus
 * the constraints and grammar rules into one `FactPack`. This is the ONLY place the
 * seed content is bundled; the engine imports nothing from here except through
 * `loadDefaultPacks()`.
 */
import type { FactEntry } from '@/catalogue/types';
import type { FactPack } from '@/catalogue/pack';

import { MEDIEVAL_BUILDING_TYPES } from './building-types';
import { MEDIEVAL_ROOM_TYPES } from './room-types';
import { MEDIEVAL_FIXTURE_TYPES } from './fixture-types';
import { MEDIEVAL_PORTAL_TYPES } from './portal-types';
import { MEDIEVAL_MATERIALS } from './materials';
import { MEDIEVAL_ROOF_COVERINGS } from './roof-coverings';
import { MEDIEVAL_SMOKE_SYSTEMS } from './smoke-systems';
import { MEDIEVAL_FRAME_TYPES } from './frame-types';
import { MEDIEVAL_TOPOLOGIES } from './topologies';
import { MEDIEVAL_DISTRICT_TYPES } from './districts';
import { MEDIEVAL_TRADE_TYPES } from './trades';
import { MEDIEVAL_BARRIER_TYPES } from './barrier-types';
import { MEDIEVAL_COMPLEX_TYPES } from './complex-types';
import { MEDIEVAL_CONSTRAINTS } from './constraints';
import { MEDIEVAL_GRAMMAR_RULES } from './grammar';

const ENTRIES = [
  ...MEDIEVAL_BUILDING_TYPES,
  ...MEDIEVAL_ROOM_TYPES,
  ...MEDIEVAL_FIXTURE_TYPES,
  ...MEDIEVAL_PORTAL_TYPES,
  ...MEDIEVAL_MATERIALS,
  ...MEDIEVAL_ROOF_COVERINGS,
  ...MEDIEVAL_SMOKE_SYSTEMS,
  ...MEDIEVAL_FRAME_TYPES,
  ...MEDIEVAL_TOPOLOGIES,
  ...MEDIEVAL_DISTRICT_TYPES,
  ...MEDIEVAL_TRADE_TYPES,
  ...MEDIEVAL_BARRIER_TYPES,
  ...MEDIEVAL_COMPLEX_TYPES,
] as unknown as FactEntry[];

export const medievalEuropePack: FactPack = {
  name: 'medieval-europe',
  entries: ENTRIES,
  constraints: MEDIEVAL_CONSTRAINTS,
  grammarRules: MEDIEVAL_GRAMMAR_RULES,
};
