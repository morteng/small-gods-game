/**
 * Building Template System
 *
 * Each template describes a building type: its footprint (in tiles),
 * walkability per cell, door position, sprite info, and gameplay category.
 *
 * Buildings are stored as BuildingInstance objects in GameMap.buildings.
 * The renderer draws them as colored rectangles until LPC building sprites
 * are downloaded and placed at public/sprites/buildings/.
 *
 * LPC assets to download (CC-BY-SA 3.0):
 *   [LPC] Thatched-roof Cottage — opengameart.org/content/lpc-thatched-roof-cottage
 *   [LPC] Medieval Village Decorations — opengameart.org/content/lpc-medieval-village-decorations
 */

import type { Era, ReligiousSignificance } from '@/core/types';

/** Building material type for AI generation color coding */
export type BuildingMaterial = 'wood' | 'stone' | 'brick' | 'thatch' | 'tile' | 'straw' | 'cob';

/** Roof style */
export type RoofType = 'gabled' | 'flat' | 'hipped' | 'thatched' | 'pyramid' | 'barrel_vault';

/** Floor plan layout */
export interface FloorPlan {
  /** Floor number (0 = ground) */
  level: number;
  /** Cells on this floor: true = interior, false = wall/structural */
  cells: boolean[][];
  /** Walkable cells (subset of interior, e.g., furniture placement) */
  walkable: boolean[][];
  /** Special features: stairs, fireplace, altar, etc. */
  features?: { x: number; y: number; type: string }[];
}

/** Material palette for AI image generation */
export interface MaterialPalette {
  primary: string;   // Hex color e.g., '#8B4513' (wood brown)
  secondary: string; // Trim, beams e.g., '#654321'
  roof: string;       // Roof color e.g., '#DAA520' (straw)
  accent: string;     // Doors, shutters e.g., '#800000' (dark red)
  label: string;       // Human label for UI / AI prompt e.g., "weathered oak"
}

/** Roof specification */
export interface RoofSpec {
  type: RoofType;
  overhangX: number; // Tiles overhang on left/right
  overhangY: number; // Tiles overhang on top/bottom
  /** Multi-story buildings: each level's roof (top-most is building roof) */
  levels?: { level: number; type: RoofType }[];
}

/** Generation hints for AI sprite creation */
export interface GenHints {
  /** Prompt prefix for PixelLab/Stable Diffusion */
  promptPrefix: string;
  /** Negative prompt (what to avoid) */
  negativePrompt?: string;
  /** Reference style tags */
  styleTags: string[];
}

/**
 * @deprecated Superseded by BuildingDescriptor (src/world/building-descriptor.ts).
 * TODO(building-descriptor-cleanup): delete this file + BUILDING_TEMPLATES once
 * nothing imports BuildingTemplate. See
 * docs/superpowers/plans/2026-06-05-parametric-building-CLEANUP.md.
 */
export interface BuildingTemplate {
  id: string;
  name: string;
  category: 'residential' | 'religious' | 'commercial' | 'military' | 'farm' | 'special';
  footprint: { w: number; h: number };
  
  /** Floor plans per level (ground = 0, upper = 1, etc.) */
  floors: FloorPlan[];
  /** Door tile relative to footprint top-left (ground floor) */
  doorCell: { x: number; y: number };
  
  /** Roof specification */
  roof: RoofSpec;
  
  /** Materials used (for sprite coloring + AI generation) */
  materials: {
    walls: BuildingMaterial;
    roof: BuildingMaterial;
    trim: BuildingMaterial;
  };
  /** Color palette for sprite generation / placeholder rendering */
  palette: MaterialPalette;
  
  /** Pixel offset of sprite from footprint top-left corner */
  spriteOffset: { x: number; y: number };
  /** Sprite pixel dimensions (may be taller than footprint for oblique view) */
  spriteSize: { w: number; h: number };
  /** Region in building atlas spritesheet (px) — unused until sprites added */
  atlasRegion: { x: number; y: number; w: number; h: number };
  /** Y-sort anchor = footprint bottom in tile units (relative to tileY) */
  sortYOffset: number;
  
  /** Default era for this building type */
  era: Era;
  /** Default religious significance */
  religiousSignificance: ReligiousSignificance;
  
  /** AI generation hints */
  genHints: GenHints;
}

export const BUILDING_TEMPLATES: BuildingTemplate[] = [
  {
    id: 'cottage',
    name: 'Cottage',
    category: 'residential',
    footprint: { w: 3, h: 3 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false, false],
          [false, true,  false],
          [false, true,  false],
        ],
        walkable: [
          [false, false, false],
          [false, true,  false],
          [false, true,  false],
        ],
        features: [{ x: 1, y: 2, type: 'door' }],
      },
    ],
    doorCell: { x: 1, y: 2 },
    roof: { type: 'thatched', overhangX: 1, overhangY: 1 },
    materials: { walls: 'wood', roof: 'thatch', trim: 'wood' },
    palette: {
      primary: '#8B4513',   // Weathered wood brown
      secondary: '#654321', // Dark beam
      roof: '#DAA520',     // Golden straw
      accent: '#800000',   // Dark red door
      label: 'weathered oak with thatch',
    },
    spriteOffset: { x: -16, y: -32 },
    spriteSize: { w: 128, h: 128 },
    atlasRegion: { x: 0, y: 0, w: 128, h: 128 },
    sortYOffset: 3,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'medieval cottage, thatched roof, timber frame',
      negativePrompt: 'modern, concrete, metal roof',
      styleTags: ['medieval', 'rustic', 'timber-frame', 'thatched-roof'],
    },
  },
  {
    id: 'temple_small',
    name: 'Temple',
    category: 'religious',
    footprint: { w: 4, h: 4 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false, false, false],
          [false, true,  true,  false],
          [false, true,  true,  false],
          [false, true,  true,  false],
        ],
        walkable: [
          [false, false, false, false],
          [false, true,  true,  false],
          [false, true,  true,  false],
          [false, true,  true,  false],
        ],
        features: [{ x: 1, y: 3, type: 'door' }, { x: 2, y: 1, type: 'altar' }],
      },
    ],
    doorCell: { x: 1, y: 3 },
    roof: { type: 'gabled', overhangX: 1, overhangY: 1 },
    materials: { walls: 'stone', roof: 'tile', trim: 'stone' },
    palette: {
      primary: '#808080',   // Grey stone
      secondary: '#696969', // Dim grey trim
      roof: '#8B0000',     // Dark red tile
      accent: '#FFD700',   // Gold accents
      label: 'grey stone with red tile roof',
    },
    spriteOffset: { x: 0, y: -32 },
    spriteSize: { w: 128, h: 160 },
    atlasRegion: { x: 96, y: 0, w: 128, h: 160 },
    sortYOffset: 4,
    era: 'classical',
    religiousSignificance: 'sacred',
    genHints: {
      promptPrefix: 'small stone temple, gabled tile roof, classical',
      negativePrompt: 'modern, thatched, wooden',
      styleTags: ['classical', 'stone', 'temple', 'gabled-roof'],
    },
  },
  {
    id: 'farm_barn',
    name: 'Barn',
    category: 'farm',
    footprint: { w: 3, h: 2 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false, false],
          [true,  true,  true],
        ],
        walkable: [
          [false, false, false],
          [true,  true,  true],
        ],
        features: [{ x: 1, y: 1, type: 'door' }],
      },
    ],
    doorCell: { x: 1, y: 1 },
    roof: { type: 'barrel_vault', overhangX: 1, overhangY: 0 },
    materials: { walls: 'wood', roof: 'tile', trim: 'wood' },
    palette: {
      primary: '#A0522D',   // Sienna wood
      secondary: '#8B4513', // Saddle brown
      roof: '#696969',     // Dim grey metal
      accent: '#8B4513',   // Brown door
      label: 'red barn with grey roof',
    },
    spriteOffset: { x: 0, y: -16 },
    spriteSize: { w: 96, h: 96 },
    atlasRegion: { x: 224, y: 0, w: 96, h: 96 },
    sortYOffset: 2,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'farm barn, barrel vault roof, weathered wood',
      negativePrompt: 'stone, modern, thatched',
      styleTags: ['farm', 'barn', 'rustic', 'barrel-roof'],
    },
  },
  {
    id: 'market_stall',
    name: 'Market Stall',
    category: 'commercial',
    footprint: { w: 2, h: 2 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false],
          [true,  true],
        ],
        walkable: [
          [false, false],
          [true,  true],
        ],
        features: [{ x: 0, y: 1, type: 'door' }],
      },
    ],
    doorCell: { x: 0, y: 1 },
    roof: { type: 'flat', overhangX: 1, overhangY: 1 },
    materials: { walls: 'wood', roof: 'thatch', trim: 'wood' },
    palette: {
      primary: '#DEB887',   // Burlywood
      secondary: '#D2691E', // Chocolate
      roof: '#F4A460',     // Sandy brown
      accent: '#8B4513',   // Saddle brown
      label: 'light wood market stall',
    },
    spriteOffset: { x: 0, y: -16 },
    spriteSize: { w: 64, h: 80 },
    atlasRegion: { x: 320, y: 0, w: 64, h: 80 },
    sortYOffset: 2,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'market stall, canvas roof, wooden counter',
      negativePrompt: 'stone, permanent, house',
      styleTags: ['market', 'stall', 'canvas-roof', 'commercial'],
    },
  },
  {
    id: 'tavern',
    name: 'Tavern',
    category: 'commercial',
    footprint: { w: 3, h: 3 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false, false],
          [false, true,  false],
          [true,  true,  true],
        ],
        walkable: [
          [false, false, false],
          [false, true,  false],
          [true,  true,  true],
        ],
        features: [{ x: 1, y: 2, type: 'door' }, { x: 2, y: 1, type: 'fireplace' }],
      },
    ],
    doorCell: { x: 1, y: 2 },
    roof: { type: 'hipped', overhangX: 1, overhangY: 1 },
    materials: { walls: 'wood', roof: 'tile', trim: 'brick' },
    palette: {
      primary: '#CD853F',   // Peru (warm wood)
      secondary: '#8B0000', // Dark red brick
      roof: '#2F4F4F',   // Dark slate grey
      accent: '#FF4500',   // Orange red door
      label: 'timber tavern with tiled roof',
    },
    spriteOffset: { x: 0, y: -32 },
    spriteSize: { w: 96, h: 128 },
    atlasRegion: { x: 384, y: 0, w: 96, h: 128 },
    sortYOffset: 3,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'medieval tavern, hipped tile roof, timber and brick',
      negativePrompt: 'stone, castle, thatched',
      styleTags: ['tavern', 'timber', 'hipped-roof', 'medieval'],
    },
  },
  {
    id: 'tower',
    name: 'Tower',
    category: 'military',
    footprint: { w: 2, h: 3 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false],
          [false, false],
          [true,  true],
        ],
        walkable: [
          [false, false],
          [false, false],
          [true,  true],
        ],
        features: [{ x: 0, y: 2, type: 'door' }],
      },
      {
        level: 1,
        cells: [
          [true,  true],
          [true,  true],
          [false, false],
        ],
        walkable: [
          [true,  true],
          [true,  true],
          [false, false],
        ],
        features: [{ x: 0, y: 0, type: 'stairs' }],
      },
    ],
    doorCell: { x: 0, y: 2 },
    roof: { type: 'pyramid', overhangX: 0, overhangY: 0 },
    materials: { walls: 'stone', roof: 'stone', trim: 'stone' },
    palette: {
      primary: '#708090',   // Slate grey
      secondary: '#696969', // Dim grey
      roof: '#556B2F',     // Dark olive green (mossy)
      accent: '#8B4513',   // Brown door
      label: 'rough stone tower',
    },
    spriteOffset: { x: 0, y: -64 },
    spriteSize: { w: 64, h: 160 },
    atlasRegion: { x: 480, y: 0, w: 64, h: 160 },
    sortYOffset: 3,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'stone watchtower, pyramid roof, medieval fortification',
      negativePrompt: 'wood, thatched, house',
      styleTags: ['tower', 'stone', 'fortification', 'pyramid-roof'],
    },
  },
  {
    id: 'castle_keep',
    name: 'Castle Keep',
    category: 'military',
    footprint: { w: 4, h: 4 },
    floors: [
      {
        level: 0,
        cells: [
          [false, false, false, false],
          [false, true,  true,  false],
          [false, true,  true,  false],
          [true,  true,  true,  true],
        ],
        walkable: [
          [false, false, false, false],
          [false, true,  true,  false],
          [false, true,  true,  false],
          [true,  true,  true,  true],
        ],
        features: [{ x: 1, y: 3, type: 'door' }],
      },
      {
        level: 1,
        cells: [
          [false, false, false, false],
          [false, true,  true,  false],
          [false, true,  true,  false],
          [false, false, false, false],
        ],
        walkable: [
          [false, false, false, false],
          [false, true,  true,  false],
          [false, true,  true,  false],
          [false, false, false, false],
        ],
        features: [{ x: 1, y: 0, type: 'stairs' }],
      },
    ],
    doorCell: { x: 1, y: 3 },
    roof: { type: 'hipped', overhangX: 1, overhangY: 1 },
    materials: { walls: 'stone', roof: 'tile', trim: 'stone' },
    palette: {
      primary: '#A9A9A9',   // Dark grey stone
      secondary: '#808080', // Grey trim
      roof: '#8B0000',     // Dark red tile
      accent: '#FFD700',   // Gold accents
      label: 'fortified stone keep with red tile',
    },
    spriteOffset: { x: 0, y: -64 },
    spriteSize: { w: 128, h: 192 },
    atlasRegion: { x: 544, y: 0, w: 128, h: 192 },
    sortYOffset: 4,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'castle keep, stone walls, hipped tile roof, medieval fortification',
      negativePrompt: 'wood, thatched, modern',
      styleTags: ['castle', 'stone', 'fortification', 'hipped-roof'],
    },
  },
  {
    id: 'dock',
    name: 'Dock',
    category: 'special',
    footprint: { w: 2, h: 3 },
    floors: [
      {
        level: 0,
        cells: [
          [true,  true],
          [true,  true],
          [true,  true],
        ],
        walkable: [
          [true,  true],
          [true,  true],
          [true,  true],
        ],
        features: [{ x: 0, y: 0, type: 'door' }],
      },
    ],
    doorCell: { x: 0, y: 0 },
    roof: { type: 'flat', overhangX: 0, overhangY: 0 },
    materials: { walls: 'wood', roof: 'wood', trim: 'wood' },
    palette: {
      primary: '#DEB887',   // Burlywood (weathered wood)
      secondary: '#8B4513', // Saddle brown
      roof: '#DEB887',     // Same as walls
      accent: '#000080',   // Navy blue (sea markers)
      label: 'weathered wooden dock',
    },
    spriteOffset: { x: 0, y: 0 },
    spriteSize: { w: 64, h: 96 },
    atlasRegion: { x: 672, y: 0, w: 64, h: 96 },
    sortYOffset: 3,
    era: 'medieval',
    religiousSignificance: 'neutral',
    genHints: {
      promptPrefix: 'wooden dock, pilings, weathered planks, waterfront',
      negativePrompt: 'stone, roof, house, modern',
      styleTags: ['dock', 'wooden', 'waterfront', 'pilings'],
    },
  },
];

/** Look up a template by ID */
export function getBuildingTemplate(id: string): BuildingTemplate | undefined {
  return BUILDING_TEMPLATES.find(t => t.id === id);
}

/** Select appropriate template ID for a POI type */
export function getTemplateFotPoiType(poiType: string): string {
  switch (poiType) {
    case 'village': return 'cottage';
    case 'city':    return 'tavern';
    case 'temple':  return 'temple_small';
    case 'farm':    return 'farm_barn';
    case 'castle':  return 'castle_keep';
    case 'tower':   return 'tower';
    case 'port':    return 'dock';
    case 'tavern':  return 'tavern';
    case 'market':  return 'market_stall';
    default:        return 'cottage';
  }
}
