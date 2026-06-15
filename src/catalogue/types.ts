/**
 * Fact catalogue — domain-neutral type model (the single source of truth).
 *
 * THIS FILE CONTAINS NO CONTENT. No medieval strings, no preset ids, no closed
 * content enums. The engine knows only the SHAPE of a fact; every specific value
 * (room types, materials, topologies, the medieval rules) lives in a content pack
 * under `packs/`. New content = register an entry, never edit a union here.
 *
 * A `FactEntry` is one fact about one catalogue item at graduated levels of detail
 * (LOD): a one-line gloss, a short visible-trait list, an optional paragraph, plus
 * kind-specific structured fields. Entries are keyed `(kind, id)`; later packs
 * override earlier ones. The engine-purity guard test forbids content literals in
 * this directory.
 */
import type { Era } from '@/core/era';

export type { Era };

/**
 * Catalogue kinds the seed pack uses. OPEN: a pack may introduce its own kinds
 * ('starshipDeckType', 'spellSchool', …) without a type error — the `(string & {})`
 * member keeps editor autocomplete for the core kinds while admitting any string.
 */
export const CORE_KINDS = [
  'buildingType',
  'roomType',
  'fixtureType',
  'portalType',
  'material',
  'roofCovering',
  'smokeSystem',
  'frameType',
  'topology',
  'districtType', // seeded for the settlement connectome (Slice 5); inert until then
  'tradeType',
  'barrierType', // linear enclosure structures (hedge/fence/palisade/wall) — DC-3
] as const;

export type CoreCatalogueKind = (typeof CORE_KINDS)[number];
export type CatalogueKind = CoreCatalogueKind | (string & {});

/** How visible a fact is — gates whether it reaches geometry, the image prompt, or stays data. */
export type Visibility = 'geometry' | 'texture-prompt' | 'data-only';

/** When a fact applies. Omitted = always. All axes are AND-ed; within an axis, OR. */
export interface Applicability {
  eras?: Era[];
  regions?: string[];
  wealth?: string[];
}

/** A reference to a declarative constraint (resolved against the pack's constraint list). */
export type ConstraintRef = string;

/** Levels of description, coarse → fine. `l0` is always present. */
export interface Lod {
  l0: string; // one-line gloss
  l1: string[]; // short visible-trait list (feeds texture prompts)
  l2?: string; // paragraph: function / construction / layout (LLM grounding)
}

/** One fact about one catalogue item. `F` is the kind-specific structured payload (the L3). */
export interface FactEntry<F = Record<string, unknown>> {
  id: string;
  kind: CatalogueKind;
  pack: string;
  applicability?: Applicability;
  lod: Lod;
  fields: F;
  constraints?: ConstraintRef[];
  provenance?: string[];
  visibility?: Visibility;
  tags?: string[];
}

// ── Kind-specific field interfaces (the structured L3) ──────────────────────
// These describe the SHAPE of each kind's `fields`. They name no content values.

export type SizeClass = 'slit' | 'human' | 'cart' | 'grand';

/** One line of a building's room programme: which room, how many, how big. */
export interface RoomSlot {
  type: string; // roomType id
  count: number;
  bays: number; // size along the run
}

export interface EntranceRule {
  face?: string; // wall face id ('n'|'e'|'s'|'w' in the medieval pack)
  sizeClass: SizeClass;
  portal?: string; // optional explicit portalType id; else the grammar queries by sizeClass
  through?: boolean; // true ⇒ opposed doors (a through-passage: cross-passage, barn threshing floor)
}

export interface HearthRule {
  room: string | 'none'; // roomType id that gets heat, or 'none'
  fixture?: string; // fixtureType id of the hearth
}

export interface BuildingTypeFields {
  topology: string; // topology id (catalogue)
  roomProgram: RoomSlot[];
  entrance: EntranceRule;
  hearthRule: HearthRule;
  sizeBays: [number, number]; // min/max
  defaultMaterials: Record<string, string>; // { walls, roof, ground }
}

export interface RoomTypeFields {
  fn: string; // function tag: 'living'|'service'|'sleeping'|'animal'|'worship'|…
  needsLight?: boolean; // → exterior windows
  heatable?: boolean; // may host the hearth
  bays?: number; // typical size
}

export interface FixtureTypeFields {
  requires?: string[]; // requirement tokens emitted (e.g. 'smoke-egress')
  satisfies?: string[]; // requirements fulfilled
  placement?: string; // hint: 'ridge'|'wall'|'centre'|…
}

export interface PortalTypeFields {
  sizeClass: SizeClass;
  passable: boolean;
  widthHint?: number; // metres
  heightHint?: number; // metres
}

export interface MaterialFields {
  /** Which blueprint material role this sits on ('walls'|'roof'|'ground'). String = open. */
  role?: string;
  /** Position on its role's wealth ladder, poorest = 0. Derives the descriptor ladders. */
  rank?: number;
  wealthLadder?: string[]; // optional explicit full ladder (cross-cut convenience)
  regionAffinity?: string[];
  rgb?: string;
}

export interface RoofCoveringFields {
  pitch: number; // ridge rise fraction
  eave: number; // eave overhang fraction
}

export interface SmokeSystemFields {
  egressFixture: string; // fixtureType id that satisfies 'smoke-egress'
  eras: Era[]; // periods in which this egress is period-correct
  wealth?: string[]; // optional wealth gate (chimney = late + elite)
}

export interface FrameTypeFields {
  regionAffinity?: string[];
}

/** A topology names the interpreter that wires its zones into portals. */
export interface TopologyFields {
  interpreter: string; // grammar interpreter id ('tripartite-linear'|…)
}

/**
 * A linear enclosure structure (the connectome `Barrier` primitive's content
 * facts): hedge, paling fence, drystone field wall, timber palisade, stone town
 * wall. Grounds the realistic dimensions worldgen uses to place enclosure rings
 * around crofts and settlements (DC-3). `barrierKind` is an open string keying the
 * runtime barrier primitive (`BARRIER_DEFAULTS`); content stays content-free here.
 */
export interface BarrierTypeFields {
  barrierKind: string; // runtime BarrierKind ('hedge'|'fence'|'palisade'|'wall'|…)
  heightM: number; // crest height in metres
  thicknessTiles: number; // footprint thickness in tiles (1 = single-cell)
  material: string; // render material key ('hedge'|'timber'|'stone'|'earth')
  crenellated?: boolean;
  posts?: boolean;
  /** Which enclosure scale this suits: a single croft/lot yard or a whole settlement. */
  scale: 'croft' | 'settlement';
  /** Settlement-scale selection: smallest settlement (building count) this ring suits. */
  minBuildings?: number;
  /** Gate opening width in tiles where a road (or water) crosses the run. */
  gateWidthTiles: number;
}
