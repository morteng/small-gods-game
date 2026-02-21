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

export interface BuildingTemplate {
  id: string;
  name: string;
  category: 'residential' | 'religious' | 'commercial' | 'military' | 'farm' | 'special';
  footprint: { w: number; h: number };
  /** Per-cell walkability (row-major, false = wall/blocked) */
  walkableCells: boolean[][];
  /** Door tile relative to footprint top-left */
  doorCell: { x: number; y: number };
  /** Pixel offset of sprite from footprint top-left corner */
  spriteOffset: { x: number; y: number };
  /** Sprite pixel dimensions (may be taller than footprint for oblique view) */
  spriteSize: { w: number; h: number };
  /** Region in building atlas spritesheet (px) — unused until sprites added */
  atlasRegion: { x: number; y: number; w: number; h: number };
  /** Y-sort anchor = footprint bottom in tile units (relative to tileY) */
  sortYOffset: number;
}

export const BUILDING_TEMPLATES: BuildingTemplate[] = [
  {
    id: 'cottage',
    name: 'Cottage',
    category: 'residential',
    footprint: { w: 3, h: 3 },
    walkableCells: [
      [false, false, false],
      [false, true,  false],
      [false, true,  false],
    ],
    doorCell: { x: 1, y: 2 },
    spriteOffset: { x: 0, y: -32 }, // sprite taller than footprint
    spriteSize: { w: 96, h: 128 },
    atlasRegion: { x: 0, y: 0, w: 96, h: 128 },
    sortYOffset: 3,
  },
  {
    id: 'temple_small',
    name: 'Temple',
    category: 'religious',
    footprint: { w: 4, h: 4 },
    walkableCells: [
      [false, false, false, false],
      [false, true,  true,  false],
      [false, true,  true,  false],
      [false, true,  true,  false],
    ],
    doorCell: { x: 1, y: 3 },
    spriteOffset: { x: 0, y: -32 },
    spriteSize: { w: 128, h: 160 },
    atlasRegion: { x: 96, y: 0, w: 128, h: 160 },
    sortYOffset: 4,
  },
  {
    id: 'farm_barn',
    name: 'Barn',
    category: 'farm',
    footprint: { w: 3, h: 2 },
    walkableCells: [
      [false, false, false],
      [true,  true,  true],
    ],
    doorCell: { x: 1, y: 1 },
    spriteOffset: { x: 0, y: -16 },
    spriteSize: { w: 96, h: 96 },
    atlasRegion: { x: 224, y: 0, w: 96, h: 96 },
    sortYOffset: 2,
  },
  {
    id: 'market_stall',
    name: 'Market',
    category: 'commercial',
    footprint: { w: 2, h: 2 },
    walkableCells: [
      [false, false],
      [true,  true],
    ],
    doorCell: { x: 0, y: 1 },
    spriteOffset: { x: 0, y: -16 },
    spriteSize: { w: 64, h: 80 },
    atlasRegion: { x: 320, y: 0, w: 64, h: 80 },
    sortYOffset: 2,
  },
  {
    id: 'tavern',
    name: 'Tavern',
    category: 'commercial',
    footprint: { w: 3, h: 3 },
    walkableCells: [
      [false, false, false],
      [false, true,  false],
      [true,  true,  true],
    ],
    doorCell: { x: 1, y: 2 },
    spriteOffset: { x: 0, y: -32 },
    spriteSize: { w: 96, h: 128 },
    atlasRegion: { x: 384, y: 0, w: 96, h: 128 },
    sortYOffset: 3,
  },
  {
    id: 'tower',
    name: 'Tower',
    category: 'military',
    footprint: { w: 2, h: 3 },
    walkableCells: [
      [false, false],
      [false, false],
      [true,  true],
    ],
    doorCell: { x: 0, y: 2 },
    spriteOffset: { x: 0, y: -64 },
    spriteSize: { w: 64, h: 160 },
    atlasRegion: { x: 480, y: 0, w: 64, h: 160 },
    sortYOffset: 3,
  },
  {
    id: 'castle_keep',
    name: 'Keep',
    category: 'military',
    footprint: { w: 4, h: 4 },
    walkableCells: [
      [false, false, false, false],
      [false, true,  true,  false],
      [false, true,  true,  false],
      [true,  true,  true,  true],
    ],
    doorCell: { x: 1, y: 3 },
    spriteOffset: { x: 0, y: -64 },
    spriteSize: { w: 128, h: 192 },
    atlasRegion: { x: 544, y: 0, w: 128, h: 192 },
    sortYOffset: 4,
  },
  {
    id: 'dock',
    name: 'Dock',
    category: 'special',
    footprint: { w: 2, h: 3 },
    walkableCells: [
      [true,  true],
      [true,  true],
      [true,  true],
    ],
    doorCell: { x: 0, y: 0 },
    spriteOffset: { x: 0, y: 0 },
    spriteSize: { w: 64, h: 96 },
    atlasRegion: { x: 672, y: 0, w: 64, h: 96 },
    sortYOffset: 3,
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
