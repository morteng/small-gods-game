/**
 * WFC Tile System - Kenney Isometric Tileset
 *
 * Defines all tile types that map to the Kenney isometric tileset.
 *
 * COORDINATE SYSTEM (Kenney Convention):
 * =====================================
 * Visual directions on isometric diamond:
 *   - N (North) = top/back vertex of diamond
 *   - E (East)  = right vertex of diamond
 *   - S (South) = bottom/front vertex of diamond
 *   - W (West)  = left vertex of diamond
 *
 * Grid-to-Visual Mapping (90deg CW rotation):
 *   - Grid N (y-1) -> Visual E
 *   - Grid E (x+1) -> Visual S
 *   - Grid S (y+1) -> Visual W
 *   - Grid W (x-1) -> Visual N
 */

import type { TileDef } from '@/core/types';

// =============================================================================
// BASE SEMANTIC TILES (stored in map data)
// =============================================================================
export const BASE_TILES: Record<string, TileDef> = {
  grass: {
    id: 'grass',
    weight: 0.4,
    walkable: true,
    color: '#66BB6A',
    category: 'terrain'
  },
  water: {
    id: 'water',
    weight: 0.15,
    walkable: false,
    color: '#42A5F5',
    category: 'water'
  },
  road: {
    id: 'road',
    weight: 0.08,
    walkable: true,
    color: '#9E9E9E',
    category: 'road'
  },
  river: {
    id: 'river',
    weight: 0.08,
    walkable: false,
    color: '#2196F3',
    category: 'water'
  },
  dirt: {
    id: 'dirt',
    weight: 0.1,
    walkable: true,
    color: '#A1887F',
    category: 'terrain'
  },
  forest: {
    id: 'forest',
    weight: 0.15,
    walkable: true,
    color: '#2E7D32',
    category: 'terrain',
    tree: true
  },
  hill: {
    id: 'hill',
    weight: 0.04,
    walkable: true,
    color: '#8D6E63',
    category: 'terrain'
  },
  beach: {
    id: 'beach',
    weight: 0.05,
    walkable: true,
    color: '#D4B896',
    category: 'terrain'
  },
  lot: {
    id: 'lot',
    weight: 0.02,
    walkable: true,
    color: '#C4A484',
    category: 'building'
  }
};

// =============================================================================
// VISUAL VARIANT TILES (selected by Autotiler)
// =============================================================================

// Road variants
export const ROAD_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['ns', 'ew', 'ne', 'nw', 'se', 'sw', 'cross', 'full']) {
  ROAD_VARIANTS[`road_${dir}`] = {
    id: `road_${dir}`,
    walkable: true,
    color: '#9E9E9E',
    category: 'road',
    baseType: 'road'
  };
}
// T-junctions: named by which directions ARE connected (missing one)
for (const dir of ['nes', 'new', 'nsw', 'esw']) {
  ROAD_VARIANTS[`road_t_${dir}`] = {
    id: `road_t_${dir}`,
    walkable: true,
    color: '#9E9E9E',
    category: 'road',
    baseType: 'road'
  };
}
// End caps
for (const dir of ['n', 'e', 's', 'w']) {
  ROAD_VARIANTS[`road_end_${dir}`] = {
    id: `road_end_${dir}`,
    walkable: true,
    color: '#9E9E9E',
    category: 'road',
    baseType: 'road'
  };
}

// River variants
export const RIVER_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['ns', 'ew', 'ne', 'nw', 'se', 'sw']) {
  RIVER_VARIANTS[`river_${dir}`] = {
    id: `river_${dir}`,
    walkable: false,
    color: '#2196F3',
    category: 'water',
    baseType: 'river'
  };
}
// Banked river variants (with visible banks)
for (const dir of ['ns', 'ew', 'ne', 'nw', 'se', 'sw']) {
  RIVER_VARIANTS[`river_banked_${dir}`] = {
    id: `river_banked_${dir}`,
    walkable: false,
    color: '#2196F3',
    category: 'water',
    baseType: 'river'
  };
}

// Shore variants (grass-to-water transition)
export const SHORE_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['n', 'e', 's', 'w']) {
  SHORE_VARIANTS[`shore_${dir}`] = {
    id: `shore_${dir}`,
    walkable: true,
    color: '#66BB6A',
    category: 'shore',
    baseType: 'grass'
  };
}
for (const dir of ['ne', 'nw', 'se', 'sw']) {
  SHORE_VARIANTS[`shore_corner_${dir}`] = {
    id: `shore_corner_${dir}`,
    walkable: true,
    color: '#66BB6A',
    category: 'shore',
    baseType: 'grass'
  };
}

// Water inner corners (land protruding into water)
export const WATER_INNER_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['ne', 'nw', 'se', 'sw']) {
  WATER_INNER_VARIANTS[`water_inner_${dir}`] = {
    id: `water_inner_${dir}`,
    walkable: false,
    color: '#42A5F5',
    category: 'water',
    baseType: 'water'
  };
}

// Beach variants (sand-to-water transition)
export const BEACH_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['n', 'e', 's', 'w']) {
  BEACH_VARIANTS[`beach_${dir}`] = {
    id: `beach_${dir}`,
    walkable: true,
    color: '#D4B896',
    category: 'beach',
    baseType: 'beach'
  };
}
for (const dir of ['ne', 'nw', 'se', 'sw']) {
  BEACH_VARIANTS[`beach_${dir}`] = {
    id: `beach_${dir}`,
    walkable: true,
    color: '#D4B896',
    category: 'beach',
    baseType: 'beach'
  };
  BEACH_VARIANTS[`beach_corner_${dir}`] = {
    id: `beach_corner_${dir}`,
    walkable: true,
    color: '#D4B896',
    category: 'beach',
    baseType: 'beach'
  };
}

// Hill variants (elevated terrain edges)
export const HILL_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['n', 'e', 's', 'w']) {
  HILL_VARIANTS[`hill_${dir}`] = {
    id: `hill_${dir}`,
    walkable: true,
    color: '#8D6E63',
    category: 'terrain',
    baseType: 'hill'
  };
}
for (const dir of ['ne', 'nw', 'se', 'sw']) {
  HILL_VARIANTS[`hill_${dir}`] = {
    id: `hill_${dir}`,
    walkable: true,
    color: '#8D6E63',
    category: 'terrain',
    baseType: 'hill'
  };
}

// Lot variants (building foundations)
export const LOT_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
  LOT_VARIANTS[`lot_${dir}`] = {
    id: `lot_${dir}`,
    walkable: true,
    color: '#C4A484',
    category: 'building',
    baseType: 'lot'
  };
}

// Bridge variants
export const BRIDGE_VARIANTS: Record<string, TileDef> = {
  bridge_ns: {
    id: 'bridge_ns',
    walkable: true,
    color: '#8B7355',
    category: 'bridge',
    baseType: 'bridge'
  },
  bridge_ew: {
    id: 'bridge_ew',
    walkable: true,
    color: '#8B7355',
    category: 'bridge',
    baseType: 'bridge'
  }
};

// Exit/boundary markers
export const EXIT_VARIANTS: Record<string, TileDef> = {};
for (const dir of ['n', 'e', 's', 'w']) {
  EXIT_VARIANTS[`exit_${dir}`] = {
    id: `exit_${dir}`,
    walkable: true,
    color: '#607D8B',
    category: 'boundary',
    baseType: 'exit'
  };
}

// Special variants
export const SPECIAL_VARIANTS: Record<string, TileDef> = {
  grass_whole: {
    id: 'grass_whole',
    walkable: true,
    color: '#66BB6A',
    category: 'terrain',
    baseType: 'grass'
  },
  dirt_double: {
    id: 'dirt_double',
    walkable: true,
    color: '#A1887F',
    category: 'terrain',
    baseType: 'dirt'
  }
};

// =============================================================================
// COMBINED TILES DICTIONARY
// =============================================================================
export const TILES: Record<string, TileDef> = {
  ...BASE_TILES,
  ...ROAD_VARIANTS,
  ...RIVER_VARIANTS,
  ...SHORE_VARIANTS,
  ...WATER_INNER_VARIANTS,
  ...BEACH_VARIANTS,
  ...HILL_VARIANTS,
  ...LOT_VARIANTS,
  ...BRIDGE_VARIANTS,
  ...EXIT_VARIANTS,
  ...SPECIAL_VARIANTS
};

// =============================================================================
// ADJACENCY RULES (for base semantic types)
// =============================================================================
export const ADJACENCY: Record<string, string[]> = {
  grass: ['grass', 'water', 'road', 'river', 'dirt', 'forest', 'hill', 'beach', 'lot'],
  water: ['water', 'grass', 'river', 'dirt', 'beach'],
  road: ['road', 'grass', 'dirt', 'forest', 'lot'],
  river: ['river', 'water', 'grass', 'beach'],
  dirt: ['dirt', 'grass', 'road', 'water', 'forest', 'beach'],
  forest: ['forest', 'grass', 'road', 'dirt', 'hill'],
  hill: ['hill', 'grass', 'forest', 'dirt'],
  beach: ['beach', 'water', 'grass', 'dirt', 'river'],
  lot: ['lot', 'grass', 'road', 'dirt']
};

// =============================================================================
// DIRECTION OFFSETS
// =============================================================================
export interface Direction {
  dx: number;
  dy: number;
  name: string;
  visual: string;
}

export const DIRECTIONS: Direction[] = [
  { dx: 0, dy: -1, name: 'north', visual: 'e' },  // Grid N -> Visual E
  { dx: 1, dy: 0, name: 'east', visual: 's' },     // Grid E -> Visual S
  { dx: 0, dy: 1, name: 'south', visual: 'w' },    // Grid S -> Visual W
  { dx: -1, dy: 0, name: 'west', visual: 'n' }     // Grid W -> Visual N
];

// =============================================================================
// TILESET CLASS
// =============================================================================
export class TileSet {
  tiles: Record<string, TileDef>;
  adjacency: Record<string, string[]>;
  tileIds: string[];

  constructor() {
    this.tiles = { ...TILES };
    this.adjacency = { ...ADJACENCY };
    this.tileIds = Object.keys(this.tiles);
  }

  getAllTileIds(): string[] {
    return this.tileIds;
  }

  getTile(id: string): TileDef | undefined {
    return this.tiles[id];
  }

  getNeighbors(tileId: string): string[] {
    // Get base type for variant tiles
    const tile = this.tiles[tileId];
    const baseType = tile?.baseType || tileId;
    return this.adjacency[baseType] || [];
  }

  canBeAdjacent(tileA: string, tileB: string): boolean {
    const tileADef = this.tiles[tileA];
    const tileBDef = this.tiles[tileB];
    const baseA = tileADef?.baseType || tileA;
    const baseB = tileBDef?.baseType || tileB;
    const neighborsA = this.adjacency[baseA] || [];
    const neighborsB = this.adjacency[baseB] || [];
    return neighborsA.includes(baseB) && neighborsB.includes(baseA);
  }

  getWeight(tileId: string): number {
    return this.tiles[tileId]?.weight || 0.1;
  }

  /** Get all visual variants for a base tile type */
  getVariants(baseType: string): TileDef[] {
    return Object.values(this.tiles).filter(t => t.baseType === baseType);
  }

  /** Check if a tile ID is a visual variant (vs base semantic type) */
  isVariant(tileId: string): boolean {
    return this.tiles[tileId]?.baseType !== undefined;
  }
}
