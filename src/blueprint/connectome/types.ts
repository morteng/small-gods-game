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

/** Wall faces, reused from the blueprint vocabulary. */
export type WallFace = 'north' | 'south' | 'east' | 'west';

/**
 * The scale of a connectome — the same primitives nest from a niche up to the
 * whole world. OPEN string so a pack can add its own scales.
 *   'niche' ⊂ 'room' ⊂ 'building' ⊂ 'district' ⊂ 'settlement' ⊂ 'region' ⊂ 'world'
 */
export type ConnectomeScale =
  | 'niche' | 'room' | 'building' | 'district' | 'settlement' | 'region' | 'world'
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
  /** Open extension bag: footprint, terrain affordance, population, wealth, … */
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
