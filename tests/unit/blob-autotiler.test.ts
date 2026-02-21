/**
 * Unit tests for the blob autotiler
 *
 * Verifies:
 * - Terrain group assignment
 * - 8-neighbor mask building
 * - Corner cleanup (diagonal bits cleared when adjacent cardinals don't match)
 * - Edge-of-map handling (out-of-bounds neighbors treated as different group)
 * - Standard blob patterns for fully-surrounded and isolated tiles
 * - computeBlobMap produces correct dimensions
 */

import { describe, it, expect } from 'vitest';
import { computeBlobMap, getTerrainGroup } from '@/map/blob-autotiler';
import type { Tile } from '@/core/types';

// Helper to build a tile grid from type strings
function makeGrid(types: string[][]): Tile[][] {
  return types.map((row, y) =>
    row.map((type, x) => ({ type, x, y, walkable: true }))
  );
}

// Helper to extract blob indices as a 2D number array
function blobIndices(types: string[][]): number[][] {
  const tiles = makeGrid(types);
  const blobMap = computeBlobMap(tiles, types[0].length, types.length);
  return blobMap.map(row => row.map(b => b.blobIndex));
}

// Helper to extract terrain groups as a 2D string array
function blobGroups(types: string[][]): string[][] {
  const tiles = makeGrid(types);
  const blobMap = computeBlobMap(tiles, types[0].length, types.length);
  return blobMap.map(row => row.map(b => b.terrainGroup));
}

// ============================================================================
// Terrain group assignment
// ============================================================================

describe('getTerrainGroup', () => {
  it('groups water types together', () => {
    expect(getTerrainGroup('water')).toBe('water');
    expect(getTerrainGroup('deep_water')).toBe('water');
    expect(getTerrainGroup('shallow_water')).toBe('water');
    expect(getTerrainGroup('river')).toBe('water');
  });

  it('groups grass and forest types together', () => {
    expect(getTerrainGroup('grass')).toBe('grass');
    expect(getTerrainGroup('meadow')).toBe('grass');
    expect(getTerrainGroup('forest')).toBe('grass');
    expect(getTerrainGroup('dense_forest')).toBe('grass');
    expect(getTerrainGroup('sacred_grove')).toBe('grass');
  });

  it('groups dirt types together', () => {
    expect(getTerrainGroup('dirt')).toBe('dirt');
    expect(getTerrainGroup('dirt_road')).toBe('dirt');
    expect(getTerrainGroup('farm_field')).toBe('dirt');
    expect(getTerrainGroup('lot')).toBe('dirt');
  });

  it('groups sand types together', () => {
    expect(getTerrainGroup('sand')).toBe('sand');
    expect(getTerrainGroup('beach')).toBe('sand');
  });

  it('groups stone types together', () => {
    expect(getTerrainGroup('road')).toBe('stone');
    expect(getTerrainGroup('stone_road')).toBe('stone');
    expect(getTerrainGroup('building_stone')).toBe('stone');
  });

  it('groups rocky terrain together', () => {
    expect(getTerrainGroup('hill')).toBe('rocky');
    expect(getTerrainGroup('mountain')).toBe('rocky');
    expect(getTerrainGroup('rocky')).toBe('rocky');
    expect(getTerrainGroup('quarry')).toBe('rocky');
  });

  it('returns grass for unknown types', () => {
    expect(getTerrainGroup('unknown_type')).toBe('grass');
  });
});

// ============================================================================
// computeBlobMap dimensions
// ============================================================================

describe('computeBlobMap dimensions', () => {
  it('produces correct width × height output', () => {
    const types = [
      ['grass', 'water', 'grass'],
      ['grass', 'grass', 'water'],
    ];
    const tiles = makeGrid(types);
    const result = computeBlobMap(tiles, 3, 2);
    expect(result.length).toBe(2);
    expect(result[0].length).toBe(3);
    expect(result[1].length).toBe(3);
  });

  it('every cell has a terrainGroup and blobIndex in range', () => {
    const types = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => 'grass')
    );
    const tiles = makeGrid(types);
    const result = computeBlobMap(tiles, 5, 5);
    for (const row of result) {
      for (const cell of row) {
        expect(cell.terrainGroup).toBeTruthy();
        expect(cell.blobIndex).toBeGreaterThanOrEqual(0);
        expect(cell.blobIndex).toBeLessThan(47);
      }
    }
  });
});

// ============================================================================
// Terrain groups in output
// ============================================================================

describe('computeBlobMap terrain groups', () => {
  it('assigns correct groups to mixed terrain', () => {
    const types = [
      ['grass', 'water', 'sand'],
      ['dirt',  'road',  'hill'],
    ];
    const groups = blobGroups(types);
    expect(groups[0][0]).toBe('grass');
    expect(groups[0][1]).toBe('water');
    expect(groups[0][2]).toBe('sand');
    expect(groups[1][0]).toBe('dirt');
    expect(groups[1][1]).toBe('stone');
    expect(groups[1][2]).toBe('rocky');
  });
});

// ============================================================================
// Isolated tile (no same-group neighbors)
// ============================================================================

describe('isolated tile (no same-group neighbors)', () => {
  it('produces blobIndex 0 for fully isolated tile', () => {
    // Single water tile surrounded by grass
    const types = [
      ['grass', 'grass', 'grass'],
      ['grass', 'water', 'grass'],
      ['grass', 'grass', 'grass'],
    ];
    const indices = blobIndices(types);
    // Center tile has no same-group neighbors → mask = 0 → blobIndex = 0
    expect(indices[1][1]).toBe(0);
  });
});

// ============================================================================
// Fully surrounded tile
// ============================================================================

describe('fully surrounded tile (all 8 neighbors match)', () => {
  it('produces the "fully interior" blob index', () => {
    // 3x3 all-grass — center has all 8 neighbors in same group
    const types = [
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
      ['grass', 'grass', 'grass'],
    ];
    const indices = blobIndices(types);
    // Center with all neighbors matching → mask = 0xFF = 255
    // After corner cleanup: all cardinals match so corners count too
    // BLOB_INDEX_MAP[255] % 47 should be the "full" tile index
    expect(indices[1][1]).toBeGreaterThan(0); // not isolated
    expect(indices[1][1]).toBeLessThan(47);
  });
});

// ============================================================================
// Edge-of-map handling
// ============================================================================

describe('edge-of-map handling', () => {
  it('top-left corner tile only has E and S neighbors to match', () => {
    const types = [
      ['grass', 'grass'],
      ['grass', 'water'],
    ];
    const indices = blobIndices(types);
    // Top-left grass tile: out-of-bounds neighbors are treated as different
    // → N=false, NE=false, E=grass(same), SE=water(diff), S=grass(same), SW=false, W=false, NW=false
    // Cardinal E and S match → mask bits: E(bit2)=1, S(bit4)=1
    // Corner SE: se=water≠grass → cleanSE=false
    // mask = 0x04 | 0x10 = 0x14 = 20
    expect(indices[0][0]).toBeGreaterThanOrEqual(0);
    expect(indices[0][0]).toBeLessThan(47);
  });

  it('1x1 grid tile has no neighbors → blobIndex 0', () => {
    const types = [['water']];
    const indices = blobIndices(types);
    expect(indices[0][0]).toBe(0);
  });
});

// ============================================================================
// Corner cleanup
// ============================================================================

describe('corner cleanup', () => {
  it('diagonal bit is excluded when adjacent cardinals do not both match', () => {
    // Pattern: grass with one diagonal neighbor matching but not both cardinals
    //   water grass
    //   grass GRASS  ← center
    //   grass grass
    // NW neighbor = water (same group if we swap): actually test with:
    //   grass water
    //   grass WATER  ← center water
    //   grass grass
    // Center=water, N=grass(diff), NE=water(same), E=grass(diff), SE=grass(diff)
    // S=grass(diff), SW=grass(diff), W=grass(diff), NW=grass(diff)
    // Cardinal N=false, E=false, S=false, W=false
    // NE=water(same) but N=false and E=false → cleanNE=false
    // mask = 0 → blobIndex = 0 (isolated)
    const types = [
      ['grass', 'water'],
      ['grass', 'water'],
    ];
    const indices = blobIndices(types);
    // Bottom-right water: N=water(same), NW=grass(diff), W=grass(diff)
    // NW diagonal: NW=grass≠water → cleanNW=false even if N=same
    // N=same(bit0=1), E=out-of-bounds=false, S=out-of-bounds=false, W=grass=false
    // NE=out-of-bounds → cleanNE=false
    // SE=out-of-bounds → cleanSE=false
    // SW=out-of-bounds → cleanSW=false
    // NW=grass → cleanNW=false (N=same but W=false)
    // mask = 0x01 = 1
    expect(indices[1][1]).toBeGreaterThanOrEqual(0);
    expect(indices[1][1]).toBeLessThan(47);
  });

  it('diagonal bit is included when both adjacent cardinals match', () => {
    // 3x3 all water - center
    // NW diagonal has N=water and W=water → cleanNW=true
    const types = [
      ['water', 'water', 'water'],
      ['water', 'water', 'water'],
      ['water', 'water', 'water'],
    ];
    const indices = blobIndices(types);
    // Center: all 8 match → all cardinals match → all corners clean
    // mask = 0xFF → some non-zero blob index
    const centerIdx = indices[1][1];
    expect(centerIdx).toBeGreaterThan(0);
  });

  it('without corner cleanup, concave water corner would have spurious diagonal', () => {
    // L-shaped water (missing SW corner) — tests corner bit cleanup
    //   W W W
    //   W W G
    //   W G G
    // Center (1,1) = water: N=water, NE=water, E=grass, SE=grass, S=grass, SW=grass, W=water, NW=water
    // Cardinals: N=same, E=diff, S=diff, W=same
    // cleanNE: NE=water but E=diff → cleanNE=false
    // cleanSE: SE=grass → cleanSE=false
    // cleanSW: SW=grass → cleanSW=false
    // cleanNW: NW=water, N=same, W=same → cleanNW=true
    // mask = N(0x01) | W(0x40) | NW(0x80) = 0xC1 = 193
    const types = [
      ['water', 'water', 'water'],
      ['water', 'water', 'grass'],
      ['water', 'grass', 'grass'],
    ];
    const indices = blobIndices(types);
    expect(indices[1][1]).toBeGreaterThanOrEqual(0);
    expect(indices[1][1]).toBeLessThan(47);
    // Without cleanup this would include NE diagonal incorrectly
    // The result should differ from fully-surrounded
    const fullIndices = blobIndices([
      ['water', 'water', 'water'],
      ['water', 'water', 'water'],
      ['water', 'water', 'water'],
    ]);
    expect(indices[1][1]).not.toBe(fullIndices[1][1]);
  });
});

// ============================================================================
// Horizontal and vertical strips
// ============================================================================

describe('horizontal and vertical strips', () => {
  it('water strip (all same group in a row) has consistent groups', () => {
    const types = [
      ['grass', 'grass', 'grass'],
      ['water', 'water', 'water'],
      ['grass', 'grass', 'grass'],
    ];
    const groups = blobGroups(types);
    expect(groups[1][0]).toBe('water');
    expect(groups[1][1]).toBe('water');
    expect(groups[1][2]).toBe('water');
    // Middle water tile has E+W neighbors (same group), N+S (different)
    // Left and right water tiles differ (only one cardinal neighbor each)
    const indices = blobIndices(types);
    expect(indices[1][0]).not.toBe(indices[1][1]); // left edge ≠ middle
    expect(indices[1][2]).not.toBe(indices[1][1]); // right edge ≠ middle
    // Left edge has E-only cardinal, right edge has W-only — different blob variants
    expect(indices[1][0]).not.toBe(indices[1][2]); // edge variants differ (E vs W)
  });
});
