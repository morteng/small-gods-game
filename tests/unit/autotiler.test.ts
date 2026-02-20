/**
 * Unit tests for Autotiler module
 *
 * Tests core functionality:
 * - Visual variant selection for different tile types
 * - Neighbor extraction from tile grids
 * - Direction mask building and grid-to-visual rotation
 * - Shore, road, river, hill, beach, lot, and bridge variants
 */

import { describe, it, expect } from 'vitest';
import { Autotiler } from '@/map/autotiler';
import type { Neighbors } from '@/map/autotiler';
import type { Tile } from '@/core/types';

/** Helper to create a Neighbors object with defaults */
function neighbors(overrides: Partial<Neighbors> = {}): Neighbors {
  return { n: 'grass', e: 'grass', s: 'grass', w: 'grass', ...overrides };
}

/** Helper to build a small tile grid */
function makeTileGrid(types: string[][]): Tile[][] {
  return types.map((row, y) =>
    row.map((type, x) => ({ type, x, y, walkable: type !== 'water' }))
  );
}

// ==========================================
// Tile Type Predicates
// ==========================================

describe('Autotiler predicates', () => {
  it('isWater recognizes water and river', () => {
    expect(Autotiler.isWater('water')).toBe(true);
    expect(Autotiler.isWater('river')).toBe(true);
    expect(Autotiler.isWater('grass')).toBe(false);
    expect(Autotiler.isWater(null)).toBe(false);
  });

  it('isRoad recognizes road types', () => {
    expect(Autotiler.isRoad('road')).toBe(true);
    expect(Autotiler.isRoad('dirt_road')).toBe(true);
    expect(Autotiler.isRoad('road_ns')).toBe(true);
    expect(Autotiler.isRoad('grass')).toBe(false);
  });

  it('isBeach recognizes beach types', () => {
    expect(Autotiler.isBeach('beach')).toBe(true);
    expect(Autotiler.isBeach('beach_n')).toBe(true);
    expect(Autotiler.isBeach('grass')).toBe(false);
  });

  it('isLot recognizes lot types', () => {
    expect(Autotiler.isLot('lot')).toBe(true);
    expect(Autotiler.isLot('lot_ne')).toBe(true);
    expect(Autotiler.isLot('grass')).toBe(false);
  });
});

// ==========================================
// Direction Mask
// ==========================================

describe('Autotiler.buildGridMask', () => {
  it('builds correct mask for matching neighbors', () => {
    const n = neighbors({ n: 'water', s: 'water' });
    const mask = Autotiler.buildGridMask(n, t => t === 'water');
    // N=0001, S=0100 => 0101
    expect(mask).toBe(0b0101);
  });

  it('returns 0 when no neighbors match', () => {
    const n = neighbors();
    const mask = Autotiler.buildGridMask(n, t => t === 'water');
    expect(mask).toBe(0);
  });

  it('returns full mask when all match', () => {
    const n: Neighbors = { n: 'water', e: 'water', s: 'water', w: 'water' };
    const mask = Autotiler.buildGridMask(n, t => t === 'water');
    expect(mask).toBe(0b1111);
  });
});

describe('Autotiler.gridMaskToVisual', () => {
  it('rotates grid N to visual E', () => {
    // Grid N (0001) -> Visual E (0010)
    expect(Autotiler.gridMaskToVisual(0b0001)).toBe(0b0010);
  });

  it('rotates full mask to full mask', () => {
    expect(Autotiler.gridMaskToVisual(0b1111)).toBe(0b1111);
  });

  it('rotates grid E to visual S', () => {
    // Grid E (0010) -> Visual S (0100)
    expect(Autotiler.gridMaskToVisual(0b0010)).toBe(0b0100);
  });
});

// ==========================================
// Road Variants
// ==========================================

describe('Autotiler road variants', () => {
  it('returns road variant for road with road neighbors N and S', () => {
    const variant = Autotiler.getVisualVariant('road', neighbors({ n: 'road', s: 'road' }));
    expect(variant).toMatch(/^road_/);
  });

  it('returns road variant for isolated road', () => {
    const variant = Autotiler.getVisualVariant('road', neighbors());
    expect(variant).toMatch(/^road_/);
  });

  it('returns road cross when all neighbors are roads', () => {
    const variant = Autotiler.getVisualVariant('road', {
      n: 'road', e: 'road', s: 'road', w: 'road',
    });
    expect(variant).toBe('road_cross');
  });

  it('handles dirt_road same as road', () => {
    const variant = Autotiler.getVisualVariant('dirt_road', neighbors({ n: 'dirt_road', s: 'dirt_road' }));
    expect(variant).toMatch(/^road_|^bridge_/);
  });
});

// ==========================================
// Shore Variants
// ==========================================

describe('Autotiler shore variants', () => {
  it('returns shore variant for grass adjacent to water', () => {
    const variant = Autotiler.getVisualVariant('grass', neighbors({ n: 'water' }));
    expect(variant).toMatch(/shore/);
  });

  it('returns grass for grass surrounded by grass', () => {
    const variant = Autotiler.getVisualVariant('grass', neighbors());
    expect(variant).toBe('grass');
  });

  it('returns shore corner for two adjacent water neighbors', () => {
    const variant = Autotiler.getVisualVariant('grass', neighbors({ n: 'water', e: 'water' }));
    expect(variant).toMatch(/shore_corner/);
  });

  it('returns grass when more than 2 water neighbors (not handled as shore)', () => {
    const variant = Autotiler.getVisualVariant('grass', {
      n: 'water', e: 'water', s: 'water', w: 'grass',
    });
    // 3 water neighbors - shore only handles 1-2
    expect(variant).toBe('grass');
  });
});

// ==========================================
// Water Variants
// ==========================================

describe('Autotiler water variants', () => {
  it('returns water for water surrounded by water', () => {
    const variant = Autotiler.getVisualVariant('water', {
      n: 'water', e: 'water', s: 'water', w: 'water',
    });
    expect(variant).toBe('water');
  });

  it('returns water_inner for water with two perpendicular land neighbors', () => {
    const variant = Autotiler.getVisualVariant('water', neighbors({ n: 'grass', e: 'grass', s: 'water', w: 'water' }));
    expect(variant).toMatch(/water_inner/);
  });
});

// ==========================================
// River Variants
// ==========================================

describe('Autotiler river variants', () => {
  it('returns river variant for river tile', () => {
    const variant = Autotiler.getVisualVariant('river', neighbors({ n: 'water', s: 'water' }));
    expect(variant).toMatch(/^river_/);
  });
});

// ==========================================
// Hill Variants
// ==========================================

describe('Autotiler hill variants', () => {
  it('returns grass for hill surrounded by hills', () => {
    const variant = Autotiler.getVisualVariant('hill', {
      n: 'hill', e: 'hill', s: 'hill', w: 'hill',
    });
    expect(variant).toBe('grass');
  });

  it('returns hill variant for hill with one lower terrain neighbor', () => {
    const variant = Autotiler.getVisualVariant('hill', {
      n: 'grass', e: 'hill', s: 'hill', w: 'hill',
    });
    expect(variant).toMatch(/^hill_/);
  });
});

// ==========================================
// Beach Variants
// ==========================================

describe('Autotiler beach variants', () => {
  it('returns beach for beach with no water', () => {
    const variant = Autotiler.getVisualVariant('beach', neighbors());
    expect(variant).toBe('beach');
  });

  it('returns beach variant for beach next to water', () => {
    const variant = Autotiler.getVisualVariant('beach', neighbors({ n: 'water' }));
    expect(variant).toMatch(/^beach_/);
  });
});

// ==========================================
// Lot Variants
// ==========================================

describe('Autotiler lot variants', () => {
  it('returns lot for interior lot (all lot neighbors)', () => {
    const variant = Autotiler.getVisualVariant('lot', {
      n: 'lot', e: 'lot', s: 'lot', w: 'lot',
    });
    expect(variant).toBe('lot');
  });

  it('returns lot edge variant for lot with non-lot neighbor', () => {
    const variant = Autotiler.getVisualVariant('lot', neighbors({ n: 'lot', e: 'lot', s: 'lot' }));
    expect(variant).toMatch(/^lot_/);
  });
});

// ==========================================
// Bridge Variants
// ==========================================

describe('Autotiler bridge variants', () => {
  it('returns bridge when road has perpendicular water', () => {
    // Road connecting N-S with water on E-W
    const variant = Autotiler.getVisualVariant('road', {
      n: 'road', e: 'water', s: 'road', w: 'water',
    });
    expect(variant).toMatch(/^bridge_/);
  });
});

// ==========================================
// Forest
// ==========================================

describe('Autotiler forest', () => {
  it('returns grass for forest tiles (trees are decorations)', () => {
    const variant = Autotiler.getVisualVariant('forest', neighbors());
    expect(variant).toBe('grass');
  });
});

// ==========================================
// getNeighbors
// ==========================================

describe('Autotiler.getNeighbors', () => {
  const grid = makeTileGrid([
    ['grass', 'water', 'forest'],
    ['road',  'dirt',  'hill'],
    ['beach', 'lot',   'river'],
  ]);

  it('returns correct neighbors for interior tile', () => {
    const n = Autotiler.getNeighbors(grid, 1, 1, 3, 3);
    expect(n.n).toBe('water');
    expect(n.e).toBe('hill');
    expect(n.s).toBe('lot');
    expect(n.w).toBe('road');
  });

  it('returns null for out-of-bounds neighbors at corner', () => {
    const n = Autotiler.getNeighbors(grid, 0, 0, 3, 3);
    expect(n.n).toBeNull();
    expect(n.w).toBeNull();
    expect(n.e).toBe('water');
    expect(n.s).toBe('road');
  });

  it('returns null for out-of-bounds neighbors at bottom-right', () => {
    const n = Autotiler.getNeighbors(grid, 2, 2, 3, 3);
    expect(n.e).toBeNull();
    expect(n.s).toBeNull();
    expect(n.n).toBe('hill');
    expect(n.w).toBe('lot');
  });
});

// ==========================================
// computeVisualMap
// ==========================================

describe('Autotiler.computeVisualMap', () => {
  it('produces a visual map of correct dimensions', () => {
    const tiles = makeTileGrid([
      ['grass', 'grass'],
      ['grass', 'water'],
    ]);
    const result = Autotiler.computeVisualMap({ tiles, width: 2, height: 2 });

    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result![0].length).toBe(2);
  });

  it('returns null for null input', () => {
    expect(Autotiler.computeVisualMap(null as any)).toBeNull();
  });

  it('marks grass next to water as shore', () => {
    const tiles = makeTileGrid([
      ['grass', 'water'],
      ['grass', 'grass'],
    ]);
    const result = Autotiler.computeVisualMap({ tiles, width: 2, height: 2 });

    // Top-left grass has water to the east
    expect(result![0][0]).toMatch(/shore/);
  });
});

// ==========================================
// Utilities
// ==========================================

describe('Autotiler.countBits', () => {
  it('counts zero bits', () => {
    expect(Autotiler.countBits(0)).toBe(0);
  });

  it('counts single bits', () => {
    expect(Autotiler.countBits(0b0001)).toBe(1);
    expect(Autotiler.countBits(0b1000)).toBe(1);
  });

  it('counts multiple bits', () => {
    expect(Autotiler.countBits(0b1010)).toBe(2);
    expect(Autotiler.countBits(0b1111)).toBe(4);
  });
});
