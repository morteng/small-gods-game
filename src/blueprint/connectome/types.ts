/**
 * The connectome — a building (later: a settlement, a world) modelled as a GRAPH
 * rather than a bag of parts. Three scale-free primitives:
 *
 *   Zone    — a node: a room/space (or, at larger scale, a district/region).
 *   Portal  — an edge: a door/passage/window/stair (or a street/road).
 *   Fixture — a leaf in a zone: a hearth/oven/well; it emits + satisfies
 *             requirement tokens (the hearth emits 'smoke-egress').
 *
 * This file is content-free (the engine-purity guard enforces it). All ids
 * (zone.type, portal.type, fixture.type) are catalogue ids supplied by a pack.
 */
import type { CatalogueRegistry } from '@/catalogue/registry';
import type { Era } from '@/catalogue/types';
import type { Earthwork } from './earthworks';

/** Wall faces, reused from the blueprint vocabulary. */
export type WallFace = 'north' | 'south' | 'east' | 'west';

/**
 * The scale of a connectome — the same primitives nest from a niche up to the
 * whole world. OPEN string so a pack can add its own scales.
 *   'niche' ⊂ 'room' ⊂ 'building' ⊂ 'site' ⊂ 'district' ⊂ 'settlement' ⊂ 'region' ⊂ 'world'
 * A 'site' (premises/establishment/compound) groups a core building with its
 * auxiliaries, yard, fixtures and "wall (or not)" — see connectome/site.ts.
 */
export type ConnectomeScale =
  | 'niche' | 'room' | 'building' | 'site' | 'district' | 'settlement' | 'region' | 'world'
  | (string & {});

export interface Zone {
  id: string;
  type: string; // catalogue id — roomType at building scale, districtType at settlement scale, …
  fn?: string; // function tag ('living','service','animal','worship','market','residential',…)
  scale?: ConnectomeScale; // which layer this node lives on (defaults to the expansion's scale)
  // Building-layout specifics — present at room/building scale, omitted above it:
  bays?: number; // size along the run
  level?: number; // 0 = ground (vertical-stack uses this)
  tags?: string[];
  /**
   * When this node was built/last rebuilt. A stronghold is a PALIMPSEST — a stone
   * keep of one era can sit inside an earlier timber bailey — so era is per-Zone,
   * not per-complex. Omitted ⇒ inherits the expansion's era.
   */
  builtEra?: Era;
  rebuiltEra?: Era;
  /** Open extension bag: footprint, terrain affordance, population, wealth, … */
  attrs?: Record<string, unknown>;
}

/**
 * A linear structure — the boundary OF a zone (a ring) or a line ACROSS terrain (a
 * dyke/wall). Distinct from a Portal (an edge BETWEEN two zones): a barrier is the
 * edge of space itself. `encloses: null` marks a SPANNING barrier (Offa's Dyke,
 * Hadrian's Wall) — a defensive work with no zone it bounds.
 */
export interface Barrier {
  id: string;
  type: string; // catalogue barrierType id (palisade/curtain/rampart/ditch)
  encloses: string | null; // zone id it rings, or null for a spanning line
  ring?: number; // ring index inner→outer (0 = innermost) when enclosing
  builtEra?: Era;
  /** Open extension bag: defensibility, material, height, ring radius, line path, … */
  attrs?: Record<string, unknown>;
}

export interface Portal {
  id: string;
  type: string; // catalogue id — doorway/stair at building scale, street/road/bridge above it
  from: string | 'OUTSIDE';
  to: string;
  face?: WallFace; // for exterior building portals
  main?: boolean;
  /** Open extension bag: a road/river SPLINE path, width, gradient, gate state, … */
  attrs?: Record<string, unknown>;
}

export interface Fixture {
  id: string;
  type: string; // fixtureType id
  zoneId: string;
  requires?: string[]; // requirement tokens emitted (e.g. 'smoke-egress')
  satisfies?: string[]; // requirements fulfilled
  /** Open extension bag. */
  attrs?: Record<string, unknown>;
}

export interface Connectome {
  scale?: ConnectomeScale; // the scale this graph describes (a building, a settlement, …)
  zones: Zone[];
  portals: Portal[];
  fixtures: Fixture[];
  /** Linear structures — present at complex scale (rings + spanning works). */
  barriers?: Barrier[];
  /** Terrain deformations this graph projects onto the world heightfield. */
  earthworks?: Earthwork[];
  /** Where this graph came from — the source catalogue type + its topology. */
  source?: { type?: string; topology?: string };
}

/**
 * A terrain-affordance probe — the planned seam between the WFC terrain substrate
 * and the connectome. At settlement/world scale the grammar will ask the terrain
 * "is this buildable / water-adjacent / flat / what biome?" before placing a Zone,
 * and the resolve-down step will project Zone footprints + Portal (road/river)
 * paths back onto the terrain grid as masks. Building scale (this slice) leaves it
 * undefined. Kept here so the primitives never preclude it — see the design doc.
 */
export interface TerrainProbe {
  affordanceAt(x: number, y: number): Record<string, unknown>;
}

/** The deterministic context an expansion runs in. */
export interface ExpandCtx {
  era: Era;
  wealth?: string;
  region?: string;
  seed: number;
  registry: CatalogueRegistry;
  /** Optional terrain substrate, supplied at settlement/world scale (Slice 5+). */
  terrain?: TerrainProbe;
}
