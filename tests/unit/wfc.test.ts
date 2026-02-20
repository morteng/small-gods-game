/**
 * Unit tests for WFC (Wave Function Collapse) engine
 *
 * Tests core functionality:
 * - Grid initialization
 * - Cell collapse
 * - Constraint propagation
 * - Terrain generation
 * - Deterministic seeding
 *
 * Uses real WFC module imports (no duplicated test implementations).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cell } from '../../src/wfc/cell';
import { TileSet } from '../../src/wfc/tile';
import { Grid } from '../../src/wfc/grid';
import { Propagator } from '../../src/wfc/propagator';
import { Solver, createRNG } from '../../src/wfc/solver';
import { WFCEngine } from '../../src/wfc/engine';

/**
 * Helper: mock Math.random with a seeded RNG so that entropy noise
 * in Cell.getEntropy() is deterministic across test runs.
 */
function withSeededRandom(seed: number, fn: () => void): void {
  const rng = createRNG(seed);
  const origRandom = Math.random;
  Math.random = rng;
  try {
    fn();
  } finally {
    Math.random = origRandom;
  }
}

// ==========================================
// Tests
// ==========================================

describe('WFC Cell', () => {
  it('should initialize with all tile possibilities', () => {
    const allTiles = ['grass', 'water', 'forest'];
    const weights = { grass: 1, water: 1, forest: 1 };
    const cell = new Cell(0, 0, allTiles, weights);

    expect(cell.isCollapsed()).toBe(false);
    expect(cell.isValid()).toBe(true);
    expect(cell.getPossibilityCount()).toBe(3);
  });

  it('should collapse to a single tile', () => {
    const allTiles = ['grass', 'water', 'forest'];
    const weights = { grass: 1, water: 1, forest: 1 };
    const cell = new Cell(0, 0, allTiles, weights);

    cell.forceCollapse('water');

    expect(cell.isCollapsed()).toBe(true);
    expect(cell.getTile()).toBe('water');
    expect(cell.getPossibilityCount()).toBe(1);
  });

  it('should remove possibilities correctly', () => {
    const allTiles = ['grass', 'water', 'forest'];
    const weights = { grass: 1, water: 1, forest: 1 };
    const cell = new Cell(0, 0, allTiles, weights);

    const changed = cell.removePossibility('water');

    expect(changed).toBe(true);
    expect(cell.getPossibilityCount()).toBe(2);
    expect(cell.possibilities.has('water')).toBe(false);
  });

  it('should become invalid when all possibilities removed', () => {
    const allTiles = ['grass'];
    const weights = { grass: 1 };
    const cell = new Cell(0, 0, allTiles, weights);

    cell.removePossibility('grass');

    expect(cell.isValid()).toBe(false);
  });

  it('should calculate entropy based on weights', () => {
    const allTiles = ['grass', 'water'];
    const weights = { grass: 2, water: 1 };
    const cell = new Cell(0, 0, allTiles, weights);

    const entropy = cell.getEntropy();
    expect(entropy).toBeGreaterThan(0);
  });

  it('should clone correctly', () => {
    const allTiles = ['grass', 'water', 'forest'];
    const weights = { grass: 1, water: 1, forest: 1 };
    const cell = new Cell(0, 0, allTiles, weights);
    cell.removePossibility('water');

    const clone = cell.clone();

    expect(clone.x).toBe(cell.x);
    expect(clone.y).toBe(cell.y);
    expect(clone.getPossibilityCount()).toBe(2);
    expect(clone.possibilities.has('water')).toBe(false);

    // Modifying clone should not affect original
    clone.removePossibility('grass');
    expect(cell.possibilities.has('grass')).toBe(true);
  });
});

describe('WFC Grid', () => {
  let tileSet: TileSet;

  beforeEach(() => {
    tileSet = new TileSet();
  });

  it('should initialize with correct dimensions', () => {
    const grid = new Grid(8, 6, tileSet);

    expect(grid.width).toBe(8);
    expect(grid.height).toBe(6);
  });

  it('should get cell at valid position', () => {
    const grid = new Grid(4, 4, tileSet);
    const cell = grid.getCell(2, 3);

    expect(cell).not.toBeNull();
    expect(cell!.x).toBe(2);
    expect(cell!.y).toBe(3);
  });

  it('should return null for out-of-bounds position', () => {
    const grid = new Grid(4, 4, tileSet);

    expect(grid.getCell(-1, 0)).toBeNull();
    expect(grid.getCell(4, 0)).toBeNull();
    expect(grid.getCell(0, 4)).toBeNull();
  });

  it('should seed cell with specific tile', () => {
    const grid = new Grid(4, 4, tileSet);
    grid.seedCell(1, 1, 'grass');

    const cell = grid.getCell(1, 1);
    expect(cell!.isCollapsed()).toBe(true);
    expect(cell!.getTile()).toBe('grass');
  });

  it('should report correct progress', () => {
    const grid = new Grid(4, 4, tileSet);

    expect(grid.getProgress()).toBe(0);

    grid.seedCell(0, 0, 'grass');
    expect(grid.getProgress()).toBeCloseTo(100 / 16, 1);
  });

  it('should get neighbors correctly', () => {
    const grid = new Grid(4, 4, tileSet);
    const neighbors = grid.getNeighbors(1, 1);

    expect(neighbors.length).toBe(4);
    expect(neighbors.some(n => n.direction === 'north')).toBe(true);
    expect(neighbors.some(n => n.direction === 'south')).toBe(true);
    expect(neighbors.some(n => n.direction === 'east')).toBe(true);
    expect(neighbors.some(n => n.direction === 'west')).toBe(true);
  });

  it('should get fewer neighbors at edge', () => {
    const grid = new Grid(4, 4, tileSet);
    const neighbors = grid.getNeighbors(0, 0);

    expect(neighbors.length).toBe(2);
  });

  it('should save and restore state', () => {
    const grid = new Grid(4, 4, tileSet);
    grid.seedCell(0, 0, 'grass');

    grid.saveState();
    grid.seedCell(1, 1, 'water');

    expect(grid.getCell(1, 1)!.getTile()).toBe('water');

    grid.restoreState();
    expect(grid.getCell(1, 1)!.isCollapsed()).toBe(false);
    expect(grid.getCell(0, 0)!.getTile()).toBe('grass');
  });
});

describe('WFC TileSet', () => {
  it('should load all tiles', () => {
    const tileSet = new TileSet();
    const tiles = tileSet.getAllTileIds();

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles).toContain('grass');
    expect(tiles).toContain('water');
  });

  it('should have adjacency rules', () => {
    const tileSet = new TileSet();
    const grassNeighbors = tileSet.getNeighbors('grass');

    expect(grassNeighbors.length).toBeGreaterThan(0);
  });

  it('should have tile weights', () => {
    const tileSet = new TileSet();
    const weight = tileSet.getWeight('grass');

    expect(weight).toBeGreaterThan(0);
  });
});

describe('WFC Solver', () => {
  it('should solve a small grid', () => {
    const tileSet = new TileSet();
    const grid = new Grid(4, 4, tileSet);
    const propagator = new Propagator(grid, tileSet);
    const solver = new Solver(grid, propagator, { seed: 12345, maxBacktracks: 500 });

    const result = solver.solve();

    expect(result.success).toBe(true);
    expect(grid.isFullyCollapsed()).toBe(true);
  });

  it('should produce deterministic results with same seed', () => {
    const results: string[] = [];

    for (let i = 0; i < 2; i++) {
      // Mock Math.random with a fixed seed so entropy noise is deterministic
      withSeededRandom(777, () => {
        const tileSet = new TileSet();
        const grid = new Grid(4, 4, tileSet);
        const propagator = new Propagator(grid, tileSet);
        const solver = new Solver(grid, propagator, { seed: 42, maxBacktracks: 500 });
        solver.solve();

        const tiles: string[] = [];
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            tiles.push(grid.getCell(x, y)!.getTile()!);
          }
        }
        results.push(tiles.join(','));
      });
    }

    expect(results[0]).toBe(results[1]);
  });
});

describe('WFC Engine', () => {
  it('should generate terrain with given options', async () => {
    const engine = new WFCEngine(8, 8, {
      seed: 12345,
      terrainOptions: {
        forestDensity: 0.5,
        waterLevel: 0.3,
        villageCount: 0
      }
    });

    const map = await engine.generate(null);

    expect(map.width).toBe(8);
    expect(map.height).toBe(8);
    expect(map.tiles.length).toBe(8);
    expect(map.tiles[0].length).toBe(8);
  });

  it('should produce consistent maps with same seed', async () => {
    const maps: string[] = [];

    for (let i = 0; i < 2; i++) {
      // Mock Math.random for deterministic entropy noise
      const rng = createRNG(777);
      const origRandom = Math.random;
      Math.random = rng;

      try {
        const engine = new WFCEngine(6, 6, {
          seed: 99999,
          terrainOptions: {
            forestDensity: 0.5,
            waterLevel: 0.3,
            villageCount: 0
          }
        });

        const map = await engine.generate(null);
        const tileStr = map.tiles.flat().map(t => t.type).join(',');
        maps.push(tileStr);
      } finally {
        Math.random = origRandom;
      }
    }

    expect(maps[0]).toBe(maps[1]);
  });

  it('should respect POI terrain zones', async () => {
    const worldSeed = {
      name: 'test',
      size: { width: 8, height: 8 },
      biome: 'temperate',
      pois: [
        {
          id: 'test_lake',
          type: 'lake',
          region: { x_min: 2, x_max: 4, y_min: 2, y_max: 4 }
        }
      ],
      connections: [],
      constraints: []
    };

    const engine = new WFCEngine(8, 8, {
      seed: 12345,
      terrainOptions: {
        forestDensity: 0.3,
        waterLevel: 0.2,
        villageCount: 0
      }
    });

    const map = await engine.generate(worldSeed);

    // Check that water-related tiles appear in the lake region
    const waterTiles = ['deep_water', 'shallow_water', 'water'];
    let hasWaterInRegion = false;

    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) {
        if (waterTiles.includes(map.tiles[y][x].type)) {
          hasWaterInRegion = true;
          break;
        }
      }
    }

    expect(hasWaterInRegion).toBe(true);
  });
});
