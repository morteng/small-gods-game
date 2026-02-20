/** Pixels per tile in the top-down renderer */
export const TILE_SIZE = 16;

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

/** Cost tracking for AI generation calls */
export const PRICES = {
  fluxDev: 0.025,       // per image
  birefnet: 0.0,        // free
  totalSpent: 0,
};
