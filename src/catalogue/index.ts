/**
 * Fact catalogue — public API barrel. Import from `@/catalogue` rather than the
 * internal modules. The engine here is domain-neutral; content lives in `packs/`.
 */
export type {
  FactEntry,
  CatalogueKind,
  CoreCatalogueKind,
  Visibility,
  Applicability,
  Lod,
  ConstraintRef,
  SizeClass,
  RoomSlot,
  EntranceRule,
  HearthRule,
  BuildingTypeFields,
  RoomTypeFields,
  FixtureTypeFields,
  PortalTypeFields,
  MaterialFields,
  RoofCoveringFields,
  SmokeSystemFields,
  FrameTypeFields,
  TopologyFields,
  BarrierTypeFields,
  Era,
} from '@/catalogue/types';
export { CORE_KINDS } from '@/catalogue/types';

export { CatalogueRegistry, appliesTo, type QueryCtx } from '@/catalogue/registry';
export { validate, type Constraint, type Issue, type Severity, type ValidateResult } from '@/catalogue/constraints';
export {
  loadPack,
  registerFact,
  registerPack,
  catalogue,
  registeredConstraints,
  registeredGrammarRules,
  type FactPack,
  type GrammarRule,
} from '@/catalogue/pack';
export { loadDefaultPacks } from '@/catalogue/default-packs';
export { roleLadders, roleLaddersFromEntries } from '@/catalogue/derive';
