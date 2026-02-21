/** Pixels per tile in the top-down renderer (LPC 32×32 tiles) */
export const TILE_SIZE = 32;

/** Canvas background color */
export const BG_COLOR = '#1a1a2e';

/** Tile type to display color mapping */
export const TILE_COLORS: Record<string, string> = {
  grass: '#66BB6A',
  water: '#42A5F5',
  deep_water: '#1565C0',
  shallow_water: '#64B5F6',
  road: '#9E9E9E',
  dirt_road: '#A1887F',
  stone_road: '#78909C',
  river: '#2196F3',
  dirt: '#A1887F',
  forest: '#2E7D32',
  dense_forest: '#1B5E20',
  pine_forest: '#33691E',
  dead_forest: '#5D4037',
  hill: '#8D6E63',
  hills: '#8D6E63',
  mountain: '#6D4C41',
  peak: '#4E342E',
  rocky: '#795548',
  cliffs: '#5D4037',
  beach: '#D4B896',
  sand: '#C8B560',
  lot: '#C4A484',
  bridge: '#8B7355',
  building_wood: '#A1887F',
  building_stone: '#78909C',
  castle_wall: '#546E7A',
  castle_tower: '#37474F',
  ruins: '#8D6E63',
  farm_field: '#AED581',
  orchard: '#7CB342',
  market: '#FFB74D',
  dock: '#8D6E63',
  well: '#90A4AE',
  meadow: '#81C784',
  glen: '#A5D6A7',
  scrubland: '#9E9D24',
  marsh: '#6D7B3E',
  swamp: '#4E6B3D',
  bog: '#5D6B3A',
  sacred_grove: '#A8D8A8',
  quarry: '#8B7B6B',
};

/** Native size of each tile in the Kenney spritesheet */
export const KENNEY_TILE_SIZE = 16;

/**
 * Maps autotiler visual variant IDs to Kenney Tiny Town tilemap coords.
 * Kenney tilemap: 12×11 grid, 16×16 tiles, at public/sprites/tiles/kenney-town.png
 *
 * Ground tiles (rows 0-3):
 *   Row 0: grass (3 variants), then sprite objects
 *   Row 1: dirt (3 variants), vegetation sprites
 *   Row 2: path/stone (3 variants), sand at col 3
 *   Row 3: mixed dirt cols 0-6, stone building starts col 7
 * Buildings (rows 3-6):
 *   Cols 0-6 rows 4-5: Blue-gray stone wall (90,105,136)
 *   Cols 8-11 rows 3-5: Brown wood wall (189,108,74)
 * Castle/stone floor (rows 8-9):
 *   Cols 0-6: Light blue-gray stone floor (192,203,220)
 */
export const TILE_SPRITE_MAP: Record<string, { col: number; row: number }> = {
  // === Grass and grass-based variants ===
  'grass':              { col: 0, row: 0 },
  'meadow':             { col: 1, row: 0 },
  'glen':               { col: 1, row: 0 },
  'farm_field':         { col: 2, row: 0 },
  'orchard':            { col: 2, row: 0 },

  // Shore variants (grass tile, autotiler provides edge variant ID)
  'shore_n':            { col: 0, row: 0 },
  'shore_e':            { col: 0, row: 0 },
  'shore_s':            { col: 0, row: 0 },
  'shore_w':            { col: 0, row: 0 },
  'shore_corner_ne':    { col: 0, row: 0 },
  'shore_corner_se':    { col: 0, row: 0 },
  'shore_corner_sw':    { col: 0, row: 0 },
  'shore_corner_nw':    { col: 0, row: 0 },

  // Hill variants (grass base)
  'hill':               { col: 0, row: 0 },
  'hill_n':             { col: 0, row: 0 },
  'hill_e':             { col: 0, row: 0 },
  'hill_s':             { col: 0, row: 0 },
  'hill_w':             { col: 0, row: 0 },
  'hill_ne':            { col: 0, row: 0 },
  'hill_se':            { col: 0, row: 0 },
  'hill_sw':            { col: 0, row: 0 },
  'hill_nw':            { col: 0, row: 0 },

  // === Dirt and path ===
  'dirt':               { col: 0, row: 1 },
  'dirt_road':          { col: 0, row: 1 },
  'scrubland':          { col: 1, row: 1 },

  // Lot/foundation variants (light dirt)
  'lot':                { col: 2, row: 1 },
  'lot_n':              { col: 2, row: 1 },
  'lot_e':              { col: 2, row: 1 },
  'lot_s':              { col: 2, row: 1 },
  'lot_w':              { col: 2, row: 1 },
  'lot_ne':             { col: 2, row: 1 },
  'lot_se':             { col: 2, row: 1 },
  'lot_sw':             { col: 2, row: 1 },
  'lot_nw':             { col: 2, row: 1 },

  // === Sand and beach ===
  'sand':               { col: 3, row: 2 },
  'beach':              { col: 3, row: 2 },
  'beach_n':            { col: 3, row: 2 },
  'beach_e':            { col: 3, row: 2 },
  'beach_s':            { col: 3, row: 2 },
  'beach_w':            { col: 3, row: 2 },
  'beach_corner_ne':    { col: 3, row: 2 },
  'beach_corner_se':    { col: 3, row: 2 },
  'beach_corner_sw':    { col: 3, row: 2 },
  'beach_corner_nw':    { col: 3, row: 2 },

  // === Buildings — use representative center tile ===
  'building_stone':     { col: 1, row: 4 },  // blue-gray stone wall
  'castle_wall':        { col: 2, row: 4 },  // darker stone
  'castle_tower':       { col: 0, row: 4 },  // darker stone variant
  'ruins':              { col: 0, row: 4 },  // dark stone

  'building_wood':      { col: 9, row: 3 },  // brown wood wall center
  'market':             { col: 9, row: 3 },  // treat like wood building

  // Stone floor (light blue-gray) — used for castle interior
  'well':               { col: 1, row: 8 },  // light stone
  'dock':               { col: 1, row: 8 },  // light stone floor

  // === New terrain types (Phase A+) ===
  'sacred_grove':       { col: 1, row: 0 },  // meadow grass (lighter than plain grass)
  'quarry':             { col: 0, row: 1 },  // dirt/earth

  // === Road directional variants (from autotiler) ===
  'road':               { col: 0, row: 2 },  // stone path
  'road_ns':            { col: 0, row: 2 },
  'road_ew':            { col: 0, row: 2 },
  'road_ne':            { col: 1, row: 2 },
  'road_nw':            { col: 1, row: 2 },
  'road_se':            { col: 1, row: 2 },
  'road_sw':            { col: 1, row: 2 },
  'road_end_n':         { col: 0, row: 2 },
  'road_end_e':         { col: 0, row: 2 },
  'road_end_s':         { col: 0, row: 2 },
  'road_end_w':         { col: 0, row: 2 },
  'road_t_nes':         { col: 2, row: 2 },
  'road_t_new':         { col: 2, row: 2 },
  'road_t_nsw':         { col: 2, row: 2 },
  'road_t_esw':         { col: 2, row: 2 },
  'road_cross':         { col: 2, row: 2 },

  // === Dirt road directional variants ===
  'dirt_road_ns':       { col: 0, row: 1 },
  'dirt_road_ew':       { col: 0, row: 1 },
  'dirt_road_ne':       { col: 1, row: 1 },
  'dirt_road_nw':       { col: 1, row: 1 },
  'dirt_road_se':       { col: 1, row: 1 },
  'dirt_road_sw':       { col: 1, row: 1 },
  'dirt_road_end_n':    { col: 0, row: 1 },
  'dirt_road_end_e':    { col: 0, row: 1 },
  'dirt_road_end_s':    { col: 0, row: 1 },
  'dirt_road_end_w':    { col: 0, row: 1 },
  'dirt_road_t_nes':    { col: 2, row: 1 },
  'dirt_road_t_new':    { col: 2, row: 1 },
  'dirt_road_t_nsw':    { col: 2, row: 1 },
  'dirt_road_t_esw':    { col: 2, row: 1 },
  'dirt_road_cross':    { col: 2, row: 1 },

  // === Bridge variants ===
  'bridge_ns':          { col: 0, row: 3 },
  'bridge_ew':          { col: 1, row: 3 },
  'stone_road':         { col: 0, row: 2 },
};

/** POI marker icons for the map overlay */
export const POI_ICONS: Record<string, { color: string; shape: 'circle' | 'triangle' | 'square' | 'diamond' }> = {
  village:    { color: '#FFD54F', shape: 'circle' },
  city:       { color: '#FF8A65', shape: 'square' },
  castle:     { color: '#EF5350', shape: 'diamond' },
  forest:     { color: '#66BB6A', shape: 'triangle' },
  lake:       { color: '#42A5F5', shape: 'circle' },
  mountain:   { color: '#8D6E63', shape: 'triangle' },
  farm:       { color: '#AED581', shape: 'square' },
  port:       { color: '#4FC3F7', shape: 'diamond' },
  ruins:      { color: '#A1887F', shape: 'square' },
  temple:     { color: '#CE93D8', shape: 'diamond' },
  mine:       { color: '#90A4AE', shape: 'square' },
  tavern:     { color: '#FFB74D', shape: 'circle' },
  tower:      { color: '#7E57C2', shape: 'triangle' },
  bridge:     { color: '#8D6E63', shape: 'square' },
  crossroads: { color: '#BDBDBD', shape: 'circle' },
};
