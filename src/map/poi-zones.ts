/**
 * POI Zone-of-Influence Rules
 *
 * Each POI type generates thematic terrain + buildings + decorations in its
 * surrounding area during world generation (WFCEngine Phase 2b).
 *
 * Zone rules are descriptive — actual tile placement happens in WFCEngine
 * via the placeVillage / placeFarm / placeTemple etc. methods. This module
 * provides configuration for those methods.
 */

import type { Era } from '@/core/types';

export interface ZoneRule {
  /** Radius of terrain influence in tiles */
  radius: { min: number; max: number };
  /** Building templates to place in this zone (in priority order) */
  buildings: string[];
  /** Per-era roster overlay; absent eras fall back to `buildings`. */
  buildingsByEra?: Partial<Record<Era, string[]>>;
  /** Maximum number of buildings to place (random within range) */
  buildingCount: { min: number; max: number };
  /** Ground-level decorations (e.g. flower patches, fences) — future use */
  decorations: string[];
  /** Whether to carve internal settlement roads between buildings */
  internalRoads: boolean;
  /** Tile type for internal roads */
  internalRoadType: string;
  /** Tile types that buildings must be adjacent to (e.g. 'shallow_water' for docks) */
  adjacencyRequirement?: string;
  /** Road layout algorithm: 'linear' (single spine), 'branching' (main + side paths), 'grid' */
  roadLayout?: 'linear' | 'branching' | 'grid' | 'none';
}

/** Zone rules per POI type */
export const POI_ZONE_RULES: Record<string, ZoneRule> = {
  village: {
    radius: { min: 5, max: 8 },
    // S2: a parish church (sacred focus) appears early; a manor hall once the village
    // is large enough. The roster is consumed round-robin, so order = appearance order;
    // guaranteed center-first anchoring of these foci is S3 (nucleated grammar).
    // E4: a working village also carries its trades — a smithy and a communal bakehouse
    // (catalogue buildingTypes with no pinned preset; geometry comes from the generative
    // catalogue→fold bridge). They join the non-focus fill pool.
    buildings: ['cottage', 'parish-church', 'cottage', 'longhouse', 'manor', 'market_stall', 'smithy', 'tavern', 'bakehouse'],
    buildingsByEra: {
      primordial: ['yurt', 'yurt', 'yurt', 'longhouse'],
      ancient: ['longhouse', 'longhouse', 'cottage', 'shrine'],
    },
    // A village is a real cluster, not a hamlet of three: the base count (before the POI
    // size scale in building-placer) reaches far enough into the round-robin roster to plat
    // the manor + a trade or two even at medium size. A `large` village (×1.8) bustles
    // (~9–18) yet still reads smaller than a large city (~9–21). The lowest roll stays a
    // believable small village, not two cottages.
    buildingCount: { min: 5, max: 10 },
    decorations: ['well', 'sign_post', 'bench', 'lamp'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    roadLayout: 'branching',
  },
  city: {
    radius: { min: 6, max: 10 },
    // E4: a town supports a denser spread of trades than a village — an inn for travellers
    // plus smith, baker and brewer (all generative catalogue types via the fold bridge). Its
    // dwellings are burgage TOWNHOUSES — a jettied box-frame upper over a stone undercroft
    // (L3b), the urban upgrade of the cottage — clustered on the street with the trades.
    buildings: ['townhouse', 'tavern', 'market_stall', 'townhouse', 'inn', 'smithy', 'townhouse', 'bakehouse', 'brewhouse'],
    buildingCount: { min: 5, max: 12 },
    decorations: ['lamp', 'bench'],
    internalRoads: true,
    internalRoadType: 'stone_road',
    roadLayout: 'grid',
  },
  farm: {
    radius: { min: 3, max: 5 },
    buildings: ['farm_barn'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['fence', 'crop_row'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    roadLayout: 'linear',
  },
  temple: {
    radius: { min: 4, max: 6 },
    buildings: ['temple_small', 'shrine'],
    buildingsByEra: {
      primordial: ['shrine'],
      ancient: ['shrine', 'temple_small'],
    },
    buildingCount: { min: 1, max: 2 },
    decorations: ['flower_patch', 'statue'],
    internalRoads: false,
    internalRoadType: 'stone_road',
    roadLayout: 'none',
  },
  castle: {
    radius: { min: 6, max: 10 },
    buildings: ['castle_keep', 'manor', 'tower', 'guard_post'],
    buildingCount: { min: 1, max: 2 },
    decorations: ['banner', 'guard_post'],
    internalRoads: true,
    internalRoadType: 'stone_road',
    roadLayout: 'linear',
  },
  mine: {
    radius: { min: 3, max: 5 },
    buildings: ['guard_post'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['rock_pile', 'cart'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    roadLayout: 'none',
  },
  port: {
    radius: { min: 4, max: 6 },
    buildings: ['dock', 'market_stall'],
    buildingsByEra: { primordial: ['dock'] },
    buildingCount: { min: 1, max: 2 },
    decorations: ['crates', 'nets'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    adjacencyRequirement: 'shallow_water',
    roadLayout: 'linear',
  },
  tavern: {
    radius: { min: 2, max: 3 },
    buildings: ['tavern'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['sign_post', 'bench'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    roadLayout: 'none',
  },
  tower: {
    radius: { min: 2, max: 3 },
    buildings: ['tower'],
    buildingCount: { min: 1, max: 1 },
    decorations: [],
    internalRoads: false,
    internalRoadType: 'stone_road',
    roadLayout: 'none',
  },
  ruins: {
    radius: { min: 3, max: 5 },
    buildings: ['shrine'],
    buildingsByEra: { ancient: ['shrine', 'temple_small'] },
    buildingCount: { min: 1, max: 3 },
    decorations: ['rubble', 'vine'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    roadLayout: 'none',
  },
};

/** Get zone rule for a POI type, with fallback to empty rule */
export function getZoneRule(poiType: string): ZoneRule {
  return POI_ZONE_RULES[poiType] ?? {
    radius: { min: 1, max: 2 },
    buildings: [],
    buildingCount: { min: 0, max: 0 },
    decorations: [],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    roadLayout: 'none',
  };
}

/**
 * Internal settlement road planner.
 * Given a list of building positions and their door cells, carves dirt_road
 * tiles from each door to the nearest existing road or to the settlement center.
 *
 * Returns a list of path segments: [{from, to}]
 */
export interface RoadSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function planSettlementRoads(
  buildingDoors: { x: number; y: number }[],
  center: { x: number; y: number },
): RoadSegment[] {
  if (buildingDoors.length === 0) return [];
  return buildingDoors.map(door => ({ from: door, to: center }));
}

/** Building roster for a zone rule at a given era; falls back to `buildings`. */
export function presetsForEra(rule: ZoneRule, era: Era): string[] {
  return rule.buildingsByEra?.[era] ?? rule.buildings;
}
