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
  'complexType', // a multi-building defended/planned complex (motte-and-bailey, town wall, …)
  'siteType', // an establishment/premises sub-graph: core building + yard + auxiliaries + fixtures (+ wall or not)
  'barrierType', // a linear structure: croft hedge/fence/wall + defensive palisade/curtain/rampart/ditch/dyke
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
  // ── Establishment / site-graph extensions (read by the `site` grammar; optional) ──
  /** Establishment function tags ('hospitality'|'craft'|'worship'|'agrarian'|…). */
  functions?: string[];
  /** Requirement tokens the establishment emits — a `site` derive resolves these to satisfiers. */
  requires?: string[];
  /** Requirement tokens this building SATISFIES as an auxiliary in a site (a stable satisfies 'stabling'). */
  satisfies?: string[];
  /**
   * Construction hint (layered-connectome Layer 1): the frameType id this building
   * PREFERS. A box-frame townhouse jetties and stacks; a cruck cottage doesn't. Omitted
   * ⇒ the structure subsystem DERIVES the frame from the wall material + era/region.
   */
  frame?: string;
  /**
   * Layered-connectome Layer 3b: this building stands on a stone UNDERCROFT — its ground
   * storey is a masonry base course carrying the (timber) upper floors (the burgage
   * townhouse). The FORM layer renders it only when the frame can bear masonry and the body
   * stacks ≥2 storeys; a cruck/stave cot never gets one. Omitted ⇒ no undercroft.
   */
  undercroft?: boolean;
  /**
   * Layered-connectome L3b (cellars): this building sinks a below-grade chamber — the named
   * roomType placed at `level:-1` (a church's CRYPT under the sanctum, a hall's cellar). The
   * connectome's cellar pass adds it only when the FRAME can bear masonry (a stone vault needs
   * a mass/box wall); a light cruck/stave frame gets none. Omitted ⇒ no cellar. Render-visible
   * only in the interior cutaway (a sub-grade floor plate); never changes the exterior massing.
   */
  cellar?: string;
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
  // ── Structural axis (layered-connectome Layer 1): the load system's geometric
  // consequences. A building's STRUCTURE subsystem (`blueprint/connectome/structure.ts`)
  // selects a frame from the wall material + era/region/wealth, then GATES the form:
  // what can jetty, how many storeys stack, how generously the walls may be opened. ──
  /** Wall materials this frame carries — the selection affinity (stone ⇒ mass-wall). */
  wallAffinity?: string[];
  /** Max load-bearing storeys this frame supports (box-frame town houses stack; cruck ≈ 1). */
  maxStoreys?: number;
  /** Max jetty overhang (tiles/storey). A TIMBER-FRAME phenomenon — 0 for mass-wall/cruck/stave. */
  jettyMax?: number;
  /** Bay module (tiles) the frame repeats on — the post/window rhythm (Layer 3 fabric). */
  bayModule?: number;
  /** Fenestration generosity the frame's walls permit (Layer 3 openings policy). */
  fenestration?: { maxPerFace?: number; spacing?: number };
  /**
   * Whether this frame can carry a masonry FLUE — an integral wall fireplace or an
   * inserted brick stack. Mass walls host the flue in their thickness; a box frame
   * takes a brick stack (the Tudor great-rebuilding); the lightest peasant frames
   * (cruck, stave) cannot, and vent through a ridge smokehole/louver however late or
   * rich the build (Layer 3 fabric: STRUCTURE gates the hearth's smoke egress).
   */
  flue?: boolean;
}

/** A topology names the interpreter that wires its zones into portals. */
export interface TopologyFields {
  interpreter: string; // grammar interpreter id ('tripartite-linear'|…)
}

/**
 * A linear structure — the connectome `Barrier` primitive's content facts. Two
 * families share one shape: the croft/settlement ENCLOSURES the live worldgen rings
 * around plots and built areas (hedge, paling fence, drystone wall, timber palisade,
 * town wall — grounded in metric dimensions, `src/world/enclosure.ts`), and the
 * defended-complex RINGS the `enclosure` grammar wraps around wards (palisade, rampart,
 * ditch, curtain wall, dyke — `blueprint/connectome/complex.ts`). `barrierKind` keys
 * the runtime barrier primitive (`BARRIER_DEFAULTS`); content stays content-free here.
 */
export interface BarrierTypeFields {
  barrierKind: string; // runtime BarrierKind ('hedge'|'fence'|'palisade'|'wall'|…)
  heightM: number; // crest height in metres
  thicknessTiles: number; // footprint thickness in tiles (1 = single-cell)
  material: string; // render material key ('hedge'|'timber'|'stone'|'earth')
  crenellated?: boolean;
  posts?: boolean;
  /**
   * Which enclosure scale this suits. `croft`/`settlement` feed the LIVE worldgen
   * enclosure picker (`src/world/enclosure.ts`); `complex` barriers are the rings of a
   * defended complex (`blueprint/connectome/complex.ts`) and are deliberately INVISIBLE
   * to that picker, so adding them never perturbs croft/settlement enclosure.
   */
  scale: 'croft' | 'settlement' | 'complex';
  /** Settlement-scale selection: smallest settlement (building count) this ring suits. */
  minBuildings?: number;
  /** Gate opening width in tiles where a road (or water) crosses the run. */
  gateWidthTiles: number;
  // ── Defended-complex extensions (how the ring grammar reads a barrier) ──────────
  /** How the world realises it: built fabric (`wall`) vs an earthwork (`bank`/`ditch`). */
  kind?: 'wall' | 'bank' | 'ditch' | (string & {});
  /** 0..1 — how hard the ring is to cross (the complex grammar's defensive term). */
  defensibility?: number;
  /** Metres — height hint for a complex ring (parallels `heightM`, kept for the DC vocab). */
  heightHint?: number;
}

// ── Complex scale: a defended/planned multi-building work (Slice DC-1) ───────────

/** One ring of a defended complex: a barrier + how many gates pierce it. */
export interface RingSlot {
  barrier: string; // barrierType id
  radius: number; // relative ring radius (innermost smallest)
  gates: number; // controlled gate portals through this ring
  gatePortal?: string; // explicit portalType id for the gate; else queried by sizeClass
}

/** One ward of a defended complex: a district zone inside a ring, holding buildings. */
export interface WardSlot {
  type: string; // districtType id (the ward's function — bailey, motte-top, …)
  ring: number; // index into the complex's `rings` this ward sits inside
  buildings?: string[]; // buildingType ids placed in this ward
  fixtures?: string[]; // fixtureType ids placed in this ward (e.g. the well — siege water)
  core?: boolean; // the high-point refuge ward (its building sits on the motte)
}

export interface ComplexTypeFields {
  topology: string; // topology id — 'enclosure' for defended perimeters
  wards: WardSlot[];
  rings: RingSlot[];
  /** Optional earthwork programme (motte/ditch/rampart sizing); omitted ⇒ no earthworks. */
  earthworks?: {
    motteHeight?: number;
    motteTopRadius?: number;
    slope?: number;
    rampartHeight?: number;
    rampartWidth?: number;
    ditchWidth?: number;
  };
  /** Siting hint: the motte height the design wants (feeds siteSelect/deriveEarthworks). */
  desiredHeight?: number;
}

// ── Site scale: an establishment/premises sub-graph (E1) ─────────────────────────

/** One auxiliary building in an authored site recipe + the role it fills. */
export interface SiteBuildingSlot {
  type: string; // buildingType id
  role?: string; // 'core' | 'auxiliary' (default 'auxiliary')
  satisfies?: string[]; // requirement tokens this slot fills in the site
}

/**
 * A site/establishment recipe: a CORE building plus the yard, auxiliaries, fixtures
 * and "wall (or not)" that make it a place rather than a lone footprint. `topology`
 * names the site interpreter (`yard`/`freestanding`/`procession`/`derive` —
 * blueprint/connectome/site.ts). Authoring is optional: with no recipe the `derive`
 * topology synthesises a plausible site from the core's `functions`/`requires` tags.
 */
export interface SiteTypeFields {
  topology: string; // site interpreter id ('yard'|'freestanding'|'derive'|…)
  core: string; // buildingType id — the establishment's core leaf
  /** Authored auxiliary buildings (e.g. a stable, a brewhouse) — `yard` topology. */
  buildings?: SiteBuildingSlot[];
  /** Authored ground/façade fixtures (sign, bench, well) by fixtureType id. */
  fixtures?: string[];
  /** Yard topology: the court the core fronts onto. `barrier` present ⇒ walled court. */
  yard?: { barrier?: string };
}
