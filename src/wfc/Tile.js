/**
 * WFC Tile System - Extended Terrain
 *
 * Rich terrain variety with natural transitions:
 * - Water: deep, shallow, river, marsh, swamp
 * - Lowland: grass, meadow, glen, farm
 * - Forest: light woods, dense forest, pine forest
 * - Wetland: marsh, swamp, bog
 * - Highland: hills, rocky, cliffs, mountain, peak
 * - Structures: roads, buildings, special
 *
 * Each tile has a `segColor` for ADE20K ControlNet segmentation
 */

// ADE20K Segmentation Colors (RGB values the model recognizes)
const ADE20K = {
  TREE: '#04C803',        // [4, 200, 3] - forests
  GRASS: '#04FA07',       // [4, 250, 7] - grass, meadow
  WATER: '#3DE6FA',       // [61, 230, 250] - water, rivers
  SEA: '#0907E6',         // [9, 7, 230] - deep water
  MOUNTAIN: '#8FFF8C',    // [143, 255, 140] - mountains, peaks
  SAND: '#A09614',        // [160, 150, 20] - sand, beach
  ROAD: '#8C8C8C',        // [140, 140, 140] - paths, roads
  BUILDING: '#B47878',    // [180, 120, 120] - buildings
  EARTH: '#787846',       // [120, 120, 70] - dirt, ground
  ROCK: '#FF290A',        // [255, 41, 10] - rocky terrain
  WALL: '#787878',        // [120, 120, 120] - walls, structures
  FLOOR: '#503232',       // [80, 50, 50] - interior floor
  PLANT: '#28C828',       // [40, 200, 40] - farm fields
  SWAMP: '#404020'        // [64, 64, 32] - wetland
};

// === WATER TILES ===
const WATER_TILES = {
  deep_water: {
    id: 'deep_water',
    weight: 0.06,
    walkable: false,
    height: 0,
    color: '#1565C0',
    segColor: ADE20K.SEA,
    category: 'water'
  },
  shallow_water: {
    id: 'shallow_water',
    weight: 0.08,
    walkable: false,
    height: 0,
    color: '#42A5F5',
    segColor: ADE20K.WATER,
    category: 'water'
  },
  river: {
    id: 'river',
    weight: 0.05,
    walkable: false,
    height: 0,
    color: '#2196F3',
    segColor: ADE20K.WATER,
    category: 'water'
  }
};

// === WETLAND TILES ===
const WETLAND_TILES = {
  marsh: {
    id: 'marsh',
    weight: 0.05,
    walkable: true,
    height: 0,
    color: '#7CB342',
    segColor: ADE20K.SWAMP,
    category: 'wetland'
  },
  swamp: {
    id: 'swamp',
    weight: 0.05,
    walkable: true,
    height: 0,
    tree: true,
    treeType: 'swamp',
    color: '#558B2F',
    segColor: ADE20K.SWAMP,
    category: 'wetland'
  },
  bog: {
    id: 'bog',
    weight: 0.03,
    walkable: true,
    height: 0,
    color: '#4E342E',
    segColor: ADE20K.SWAMP,
    category: 'wetland'
  }
};

// === LOWLAND TILES ===
// Base weights before slider modifiers are applied
// Sliders multiply these to create the final balance
const LOWLAND_TILES = {
  sand: {
    id: 'sand',
    weight: 0.07,
    walkable: true,
    height: 0,
    color: '#FFD54F',
    segColor: ADE20K.SAND,
    category: 'shoreline'
  },
  grass: {
    id: 'grass',
    weight: 0.12,  // Base weight - slider will modify
    walkable: true,
    height: 0,
    color: '#66BB6A',
    segColor: ADE20K.GRASS,
    category: 'terrain'
  },
  meadow: {
    id: 'meadow',
    weight: 0.10,
    walkable: true,
    height: 0,
    flowers: true,
    color: '#9CCC65',
    segColor: ADE20K.GRASS,
    category: 'terrain'
  },
  glen: {
    id: 'glen',
    weight: 0.08,
    walkable: true,
    height: 0,
    color: '#81C784',
    segColor: ADE20K.GRASS,
    category: 'terrain'
  },
  scrubland: {
    id: 'scrubland',
    weight: 0.06,
    walkable: true,
    height: 0,
    color: '#AED581',
    segColor: ADE20K.EARTH,
    category: 'terrain'
  }
};

// === FOREST TILES ===
// Base weights - slider multiplies these
// At 50% slider, forests and grass should be roughly balanced
const FOREST_TILES = {
  forest: {
    id: 'forest',
    weight: 0.08,  // Base weight - slider will modify
    walkable: true,
    height: 0,
    tree: true,
    color: '#2E7D32',
    segColor: ADE20K.TREE,
    category: 'forest'
  },
  dense_forest: {
    id: 'dense_forest',
    weight: 0.05,
    walkable: true,
    height: 0,
    tree: true,
    treeType: 'dense',
    color: '#1B5E20',
    segColor: ADE20K.TREE,
    category: 'forest'
  },
  pine_forest: {
    id: 'pine_forest',
    weight: 0.04,
    walkable: true,
    height: 0,
    tree: true,
    treeType: 'pine',
    color: '#33691E',
    segColor: ADE20K.TREE,
    category: 'forest'
  },
  dead_forest: {
    id: 'dead_forest',
    weight: 0.02,
    walkable: true,
    height: 0,
    tree: true,
    treeType: 'dead',
    color: '#5D4037',
    segColor: ADE20K.TREE,
    category: 'forest'
  }
};

// === HIGHLAND TILES ===
const HIGHLAND_TILES = {
  hills: {
    id: 'hills',
    weight: 0.08,
    walkable: true,
    height: 8,
    color: '#8D6E63',
    segColor: ADE20K.EARTH,
    category: 'highland'
  },
  rocky: {
    id: 'rocky',
    weight: 0.05,
    walkable: true,
    height: 6,
    color: '#9E9E9E',
    segColor: ADE20K.ROCK,
    category: 'highland'
  },
  cliffs: {
    id: 'cliffs',
    weight: 0.03,
    walkable: false,
    height: 16,
    color: '#757575',
    segColor: ADE20K.ROCK,
    category: 'highland'
  },
  mountain: {
    id: 'mountain',
    weight: 0.05,
    walkable: false,
    height: 24,
    color: '#78909C',
    segColor: ADE20K.MOUNTAIN,
    category: 'highland'
  },
  peak: {
    id: 'peak',
    weight: 0.02,
    walkable: false,
    height: 32,
    color: '#ECEFF1',
    segColor: ADE20K.MOUNTAIN,
    category: 'highland'
  }
};

// === STRUCTURE TILES ===
const STRUCTURE_TILES = {
  dirt_road: {
    id: 'dirt_road',
    weight: 0.03,
    walkable: true,
    height: 0,
    color: '#A1887F',
    segColor: ADE20K.ROAD,
    category: 'road'
  },
  stone_road: {
    id: 'stone_road',
    weight: 0.02,
    walkable: true,
    height: 0,
    color: '#9E9E9E',
    segColor: ADE20K.ROAD,
    category: 'road'
  },
  bridge: {
    id: 'bridge',
    weight: 0.01,
    walkable: true,
    height: 2,
    color: '#8D6E63',
    segColor: ADE20K.ROAD,
    category: 'road'
  },
  building_wood: {
    id: 'building_wood',
    weight: 0.02,
    walkable: false,
    height: 20,
    color: '#FF8A65',
    segColor: ADE20K.BUILDING,
    category: 'building'
  },
  building_stone: {
    id: 'building_stone',
    weight: 0.015,
    walkable: false,
    height: 25,
    color: '#90A4AE',
    segColor: ADE20K.BUILDING,
    category: 'building'
  },
  castle_wall: {
    id: 'castle_wall',
    weight: 0.008,
    walkable: false,
    height: 35,
    color: '#546E7A',
    segColor: ADE20K.WALL,
    category: 'building'
  },
  castle_tower: {
    id: 'castle_tower',
    weight: 0.004,
    walkable: false,
    height: 45,
    color: '#37474F',
    segColor: ADE20K.BUILDING,
    category: 'building'
  },
  ruins: {
    id: 'ruins',
    weight: 0.02,
    walkable: true,
    height: 8,
    color: '#A1887F',
    segColor: ADE20K.ROCK,
    category: 'special'
  },
  farm_field: {
    id: 'farm_field',
    weight: 0.03,
    walkable: true,
    height: 0,
    color: '#FFCC80',
    segColor: ADE20K.PLANT,
    category: 'farm'
  },
  orchard: {
    id: 'orchard',
    weight: 0.02,
    walkable: true,
    height: 0,
    tree: true,
    treeType: 'fruit',
    color: '#C5E1A5',
    segColor: ADE20K.TREE,
    category: 'farm'
  },
  market: {
    id: 'market',
    weight: 0.01,
    walkable: true,
    height: 0,
    color: '#FFB300',
    segColor: ADE20K.FLOOR,
    category: 'special'
  },
  dock: {
    id: 'dock',
    weight: 0.01,
    walkable: true,
    height: 0,
    color: '#BCAAA4',
    segColor: ADE20K.ROAD,
    category: 'special'
  },
  well: {
    id: 'well',
    weight: 0.008,
    walkable: true,
    height: 4,
    color: '#607D8B',
    segColor: ADE20K.ROCK,
    category: 'special'
  }
};

const TILES = {
  ...WATER_TILES,
  ...WETLAND_TILES,
  ...LOWLAND_TILES,
  ...FOREST_TILES,
  ...HIGHLAND_TILES,
  ...STRUCTURE_TILES
};

// === ADJACENCY RULES ===
// Natural terrain flow - each tile lists what can be adjacent
const ADJACENCY = {
  // --- WATER ---
  deep_water: ['deep_water', 'shallow_water'],
  shallow_water: ['deep_water', 'shallow_water', 'river', 'sand', 'marsh', 'dock', 'bridge'],
  river: ['shallow_water', 'river', 'marsh', 'grass', 'meadow', 'bridge', 'swamp'],

  // --- WETLAND ---
  marsh: ['shallow_water', 'river', 'marsh', 'swamp', 'grass', 'meadow', 'bog'],
  swamp: ['marsh', 'swamp', 'bog', 'river', 'dead_forest', 'grass'],
  bog: ['marsh', 'swamp', 'bog', 'dead_forest', 'scrubland'],

  // --- SHORELINE ---
  sand: ['shallow_water', 'sand', 'grass', 'scrubland', 'dirt_road', 'dock', 'rocky'],

  // --- LOWLAND ---
  grass: ['shallow_water', 'river', 'sand', 'marsh', 'grass', 'meadow', 'glen', 'scrubland',
          'forest', 'hills', 'dirt_road', 'farm_field', 'building_wood', 'well', 'orchard'],
  meadow: ['river', 'marsh', 'grass', 'meadow', 'glen', 'forest', 'pine_forest',
           'hills', 'dirt_road', 'farm_field', 'orchard'],
  glen: ['grass', 'meadow', 'glen', 'forest', 'pine_forest', 'hills', 'rocky', 'ruins'],
  scrubland: ['sand', 'grass', 'scrubland', 'rocky', 'hills', 'bog', 'dead_forest', 'dirt_road'],

  // --- FOREST ---
  forest: ['grass', 'meadow', 'glen', 'forest', 'dense_forest', 'pine_forest',
           'hills', 'dirt_road', 'building_wood', 'ruins'],
  dense_forest: ['forest', 'dense_forest', 'pine_forest', 'hills', 'swamp'],
  pine_forest: ['meadow', 'glen', 'forest', 'dense_forest', 'pine_forest', 'hills', 'rocky', 'mountain'],
  dead_forest: ['swamp', 'bog', 'scrubland', 'dead_forest', 'rocky', 'ruins'],

  // --- HIGHLAND ---
  hills: ['grass', 'meadow', 'glen', 'scrubland', 'forest', 'pine_forest',
          'hills', 'rocky', 'mountain', 'dirt_road', 'building_stone', 'castle_wall', 'ruins'],
  rocky: ['sand', 'glen', 'scrubland', 'pine_forest', 'dead_forest',
          'hills', 'rocky', 'cliffs', 'mountain', 'ruins'],
  cliffs: ['rocky', 'cliffs', 'mountain', 'peak'],
  mountain: ['pine_forest', 'hills', 'rocky', 'cliffs', 'mountain', 'peak', 'castle_wall'],
  peak: ['cliffs', 'mountain', 'peak'],

  // --- ROADS ---
  dirt_road: ['grass', 'meadow', 'scrubland', 'sand', 'forest', 'hills',
              'dirt_road', 'stone_road', 'building_wood', 'bridge', 'farm_field', 'market', 'dock', 'well', 'orchard'],
  stone_road: ['grass', 'dirt_road', 'stone_road', 'building_stone', 'castle_wall', 'market', 'well'],
  bridge: ['dirt_road', 'shallow_water', 'river', 'grass', 'sand', 'marsh'],

  // --- BUILDINGS ---
  building_wood: ['grass', 'meadow', 'dirt_road', 'building_wood', 'farm_field', 'forest', 'well', 'orchard'],
  building_stone: ['grass', 'hills', 'dirt_road', 'stone_road', 'building_stone', 'castle_wall'],
  castle_wall: ['mountain', 'hills', 'stone_road', 'castle_wall', 'castle_tower', 'building_stone'],
  castle_tower: ['castle_wall'],
  ruins: ['grass', 'glen', 'forest', 'dead_forest', 'hills', 'rocky', 'ruins'],

  // --- SPECIAL ---
  farm_field: ['grass', 'meadow', 'dirt_road', 'farm_field', 'building_wood', 'orchard', 'well'],
  orchard: ['grass', 'meadow', 'farm_field', 'orchard', 'dirt_road', 'building_wood'],
  market: ['grass', 'stone_road', 'dirt_road', 'building_wood', 'building_stone'],
  dock: ['shallow_water', 'sand', 'dirt_road', 'building_wood', 'grass'],
  well: ['grass', 'dirt_road', 'building_wood', 'farm_field', 'stone_road']
};

// Direction offsets for 4-way adjacency
const DIRECTIONS = [
  { dx: 0, dy: -1, name: 'north' },
  { dx: 1, dy: 0, name: 'east' },
  { dx: 0, dy: 1, name: 'south' },
  { dx: -1, dy: 0, name: 'west' }
];

// Terrain-only tiles for phase 1 generation (no structures)
const TERRAIN_ONLY_IDS = [
  // Water
  'deep_water', 'shallow_water', 'river',
  // Wetland
  'marsh', 'swamp', 'bog',
  // Lowland
  'sand', 'grass', 'meadow', 'glen', 'scrubland',
  // Forest
  'forest', 'dense_forest', 'pine_forest', 'dead_forest',
  // Highland
  'hills', 'rocky', 'cliffs', 'mountain', 'peak'
];

// Terrain-only adjacency (symmetric - if A->B then B->A)
// Built to ensure WFC doesn't get stuck
const TERRAIN_ADJACENCY = {
  // Water cluster
  deep_water: ['deep_water', 'shallow_water'],
  shallow_water: ['deep_water', 'shallow_water', 'river', 'sand', 'marsh', 'grass'],
  river: ['shallow_water', 'river', 'marsh', 'grass', 'meadow', 'swamp', 'forest'],

  // Wetland cluster
  marsh: ['shallow_water', 'river', 'marsh', 'swamp', 'grass', 'meadow', 'bog', 'forest', 'dead_forest'],
  swamp: ['river', 'marsh', 'swamp', 'bog', 'dead_forest', 'grass', 'forest', 'dense_forest'],
  bog: ['marsh', 'swamp', 'bog', 'dead_forest', 'scrubland', 'grass'],

  // Shoreline
  sand: ['shallow_water', 'sand', 'grass', 'scrubland', 'rocky', 'meadow'],

  // Lowland hub - connects everything
  grass: ['shallow_water', 'river', 'sand', 'marsh', 'swamp', 'bog', 'grass', 'meadow', 'glen', 'scrubland', 'forest', 'dense_forest', 'pine_forest', 'dead_forest', 'hills', 'rocky'],
  meadow: ['river', 'sand', 'marsh', 'grass', 'meadow', 'glen', 'scrubland', 'forest', 'dense_forest', 'pine_forest', 'hills'],
  glen: ['grass', 'meadow', 'glen', 'scrubland', 'forest', 'dense_forest', 'pine_forest', 'hills', 'rocky'],
  scrubland: ['sand', 'grass', 'meadow', 'glen', 'scrubland', 'rocky', 'hills', 'bog', 'dead_forest', 'forest'],

  // Forest cluster
  forest: ['river', 'marsh', 'swamp', 'grass', 'meadow', 'glen', 'scrubland', 'forest', 'dense_forest', 'pine_forest', 'hills', 'rocky'],
  dense_forest: ['swamp', 'grass', 'meadow', 'glen', 'forest', 'dense_forest', 'pine_forest', 'hills'],
  pine_forest: ['grass', 'meadow', 'glen', 'forest', 'dense_forest', 'pine_forest', 'hills', 'rocky', 'mountain'],
  dead_forest: ['marsh', 'swamp', 'bog', 'scrubland', 'grass', 'dead_forest', 'rocky'],

  // Highland cluster
  hills: ['grass', 'meadow', 'glen', 'scrubland', 'forest', 'dense_forest', 'pine_forest', 'hills', 'rocky', 'mountain', 'cliffs'],
  rocky: ['sand', 'grass', 'glen', 'scrubland', 'forest', 'pine_forest', 'dead_forest', 'hills', 'rocky', 'cliffs', 'mountain'],
  cliffs: ['hills', 'rocky', 'cliffs', 'mountain', 'peak'],
  mountain: ['pine_forest', 'hills', 'rocky', 'cliffs', 'mountain', 'peak'],
  peak: ['cliffs', 'mountain', 'peak']
};

class TileSet {
  constructor(terrainOnly = false) {
    this.terrainOnly = terrainOnly;

    if (terrainOnly) {
      this.tiles = {};
      for (const id of TERRAIN_ONLY_IDS) {
        this.tiles[id] = TILES[id];
      }
      this.adjacency = { ...TERRAIN_ADJACENCY };
    } else {
      this.tiles = { ...TILES };
      this.adjacency = { ...ADJACENCY };
    }

    this.tileIds = Object.keys(this.tiles);
  }

  getAllTileIds() {
    return this.tileIds;
  }

  getTile(id) {
    return this.tiles[id];
  }

  getNeighbors(tileId) {
    return this.adjacency[tileId] || [];
  }

  canBeAdjacent(tileA, tileB) {
    const neighborsA = this.adjacency[tileA] || [];
    const neighborsB = this.adjacency[tileB] || [];
    return neighborsA.includes(tileB) && neighborsB.includes(tileA);
  }

  getWeight(tileId) {
    return this.tiles[tileId]?.weight || 0.1;
  }

  getTilesByCategory(category) {
    return this.tileIds.filter(id => this.tiles[id].category === category);
  }

  getModifiedWeights(modifiers = {}) {
    const weights = {};
    for (const id of this.tileIds) {
      weights[id] = this.tiles[id].weight * (modifiers[id] || 1);
    }
    return weights;
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TileSet, TILES, ADJACENCY, DIRECTIONS, TERRAIN_ONLY_IDS, TERRAIN_ADJACENCY, ADE20K };
} else {
  window.WFC = window.WFC || {};
  window.WFC.TileSet = TileSet;
  window.WFC.TILES = TILES;
  window.WFC.ADJACENCY = ADJACENCY;
  window.WFC.DIRECTIONS = DIRECTIONS;
  window.WFC.TERRAIN_ONLY_IDS = TERRAIN_ONLY_IDS;
  window.WFC.TERRAIN_ADJACENCY = TERRAIN_ADJACENCY;
  window.WFC.ADE20K = ADE20K;
}
