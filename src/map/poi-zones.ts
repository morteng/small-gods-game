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

export interface ZoneRule {
  /** Radius of terrain influence in tiles */
  radius: { min: number; max: number };
  /** Tile types to flood-fill into the zone (cleared terrain base) */
  terrainFill?: string;
  /** Building templates to place in this zone (in priority order) */
  buildings: string[];
  /** Maximum number of buildings to place (random within range) */
  buildingCount: { min: number; max: number };
  /** Ground-level decorations (e.g. flower patches, fences) — future use */
  decorations: string[];
  /** Whether to carve internal settlement roads between buildings */
  internalRoads: boolean;
  /** Tile type for internal roads */
  internalRoadType: string;
  /** Clear trees/forest tiles inside zone before placing buildings */
  clearForest?: boolean;
  /** Tile types that buildings must be adjacent to (e.g. 'shallow_water' for docks) */
  adjacencyRequirement?: string;
  /** Road layout algorithm: 'linear' (single spine), 'branching' (main + side paths), 'grid' */
  roadLayout?: 'linear' | 'branching' | 'grid' | 'none';
}

/** Zone rules per POI type */
export const POI_ZONE_RULES: Record<string, ZoneRule> = {
  village: {
    radius: { min: 5, max: 8 },
    terrainFill: undefined,
    buildings: ['cottage', 'cottage', 'market_stall', 'tavern'],
    buildingCount: { min: 3, max: 8 },
    decorations: ['well', 'sign_post', 'bench', 'lamp'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    clearForest: true,
    roadLayout: 'branching',
  },
  city: {
    radius: { min: 6, max: 10 },
    terrainFill: undefined,
    buildings: ['tavern', 'market_stall', 'cottage'],
    buildingCount: { min: 5, max: 12 },
    decorations: ['lamp', 'bench'],
    internalRoads: true,
    internalRoadType: 'stone_road',
    clearForest: true,
    roadLayout: 'grid',
  },
  farm: {
    radius: { min: 3, max: 5 },
    terrainFill: 'farm_field',
    buildings: ['farm_barn'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['fence', 'crop_row'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    clearForest: true,
    roadLayout: 'linear',
  },
  temple: {
    radius: { min: 4, max: 6 },
    terrainFill: 'sacred_grove',
    buildings: ['temple_small'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['flower_patch', 'statue'],
    internalRoads: false,
    internalRoadType: 'stone_road',
    clearForest: false,
    roadLayout: 'none',
  },
  castle: {
    radius: { min: 6, max: 10 },
    terrainFill: undefined,
    buildings: ['castle_keep', 'tower'],
    buildingCount: { min: 1, max: 2 },
    decorations: ['banner', 'guard_post'],
    internalRoads: true,
    internalRoadType: 'stone_road',
    clearForest: true,
    roadLayout: 'linear',
  },
  mine: {
    radius: { min: 3, max: 5 },
    terrainFill: 'quarry',
    buildings: ['tower'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['rock_pile', 'cart'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    clearForest: false,
    roadLayout: 'none',
  },
  port: {
    radius: { min: 4, max: 6 },
    terrainFill: undefined,
    buildings: ['dock', 'market_stall'],
    buildingCount: { min: 1, max: 2 },
    decorations: ['crates', 'nets'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    clearForest: false,
    adjacencyRequirement: 'shallow_water',
    roadLayout: 'linear',
  },
  tavern: {
    radius: { min: 2, max: 3 },
    terrainFill: undefined,
    buildings: ['tavern'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['sign_post', 'bench'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    clearForest: false,
    roadLayout: 'none',
  },
  tower: {
    radius: { min: 2, max: 3 },
    terrainFill: undefined,
    buildings: ['tower'],
    buildingCount: { min: 1, max: 1 },
    decorations: [],
    internalRoads: false,
    internalRoadType: 'stone_road',
    clearForest: false,
    roadLayout: 'none',
  },
  ruins: {
    radius: { min: 3, max: 5 },
    terrainFill: undefined,
    buildings: ['cottage'],
    buildingCount: { min: 1, max: 3 },
    decorations: ['rubble', 'vine'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    clearForest: false,
    roadLayout: 'none',
  },
};

/** Get zone rule for a POI type, with fallback to empty rule */
export function getZoneRule(poiType: string): ZoneRule {
  return POI_ZONE_RULES[poiType] ?? {
    radius: { min: 1, max: 2 },
    buildings: ['cottage'],
    buildingCount: { min: 1, max: 1 },
    decorations: [],
    internalRoads: false,
    internalRoadType: 'dirt_road',
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
