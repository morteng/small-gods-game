/**
 * WFC Engine - Multi-Phase Generation
 *
 * DESIGN: Uses a 3-phase approach for natural terrain generation:
 *
 * Phase 1: TERRAIN GENERATION
 *   - Generate natural terrain using only terrain tiles
 *   - Apply terrain zone biases from World Seed
 *   - Results in natural-looking landscape without structures
 *
 * Phase 2: POI PLACEMENT
 *   - Find suitable locations for POIs based on generated terrain
 *   - Place structures (buildings, roads) at POI locations
 *   - Respects terrain - won't place villages on mountains or in water
 *
 * Phase 3: ROAD CARVING
 *   - Connect POIs with roads using A* pathfinding
 *   - Creates natural road networks that follow terrain
 */

import { TileSet, TILES } from './tile';
import { Grid } from './grid';
import { Propagator } from './propagator';
import { Solver, createRNG } from './solver';
import type { SolveResult } from './solver';
import type { GameMap, WorldSeed, POI, Tile, TerrainOptions, BuildingInstance } from '@/core/types';
import { getBuildingTemplate } from '@/map/building-templates';

// Terrain weight constants
// Base weight range: slider value 0% gives MIN, 100% gives MIN + RANGE
export const TERRAIN_WEIGHTS = {
  // Base weight values
  MIN_WEIGHT: 0.02,           // Minimum weight when slider is at 0%
  MAX_GRASS_FOREST: 0.18,     // Maximum weight for grass/forest at extreme slider positions
  GRASS_FOREST_RANGE: 0.16,   // Weight range controlled by forestDensity slider
  WATER_RANGE: 0.14,          // Weight range controlled by waterLevel slider

  // Forest variant multipliers (relative to base forest weight)
  FOREST: {
    DENSE: 0.7,
    PINE: 0.6,
    DEAD: 0.2
  },

  // Open terrain multipliers (relative to base grass weight)
  GRASS: {
    MEADOW: 0.85,
    GLEN: 0.6,
    SCRUBLAND: 0.5
  },

  // Water variant multipliers (relative to base water weight)
  WATER: {
    SHALLOW: 1.1,
    RIVER: 0.7,
    MARSH: 0.5,
    SWAMP: 0.3,  // Uses (forestWeight + waterWeight) * this
    BOG: 0.4
  },

  // Highland weights
  HILLS: {
    BASE: 0.07,          // Base hill weight
    WATER_REDUCTION: 0.02, // Reduced by waterLevel * this
    ROCKY: 0.7,
    MOUNTAIN: 0.5,
    PEAK: 0.3,
    CLIFFS: 0.4
  },

  // Sand weights
  SAND: {
    BASE: 0.04,
    WATER_BONUS: 0.04    // Added: waterLevel * this
  }
};

interface EngineOptions {
  seed?: number;
  maxBacktracks?: number;
  onProgress?: ((info: { phase: string; progress: number; message: string }) => void) | null;
  animated?: boolean;
  animationDelay?: number;
  stepsPerFrame?: number;
  terrainOptions?: TerrainOptions;
}

// Tile data used during POI/road modification (mutable)
interface TileData {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  height: number;
  bridgeDirection?: string;
}

export class WFCEngine {
  width: number;
  height: number;
  options: {
    seed: number;
    maxBacktracks: number;
    onProgress: EngineOptions['onProgress'];
    animated: boolean;
    animationDelay: number;
    stepsPerFrame?: number;
    terrainOptions: TerrainOptions;
  };
  rng: () => number;
  tileSet: TileSet | null;
  grid: Grid | null;
  propagator: Propagator | null;
  solver: Solver | null;
  result: SolveResult | null;
  worldSeed: WorldSeed | null;
  finalTiles: TileData[][] | null;
  buildings: BuildingInstance[];

  static readonly WALKABLE_TERRAIN = ['grass', 'meadow', 'glen', 'scrubland', 'sand', 'forest', 'dense_forest', 'pine_forest', 'hills', 'farm_field', 'marsh'];
  static readonly WATER_TERRAIN = ['deep_water', 'shallow_water', 'river'];

  constructor(width: number, height: number, options: EngineOptions = {}) {
    this.width = width;
    this.height = height;
    this.options = {
      seed: options.seed || Date.now(),
      maxBacktracks: options.maxBacktracks || 500,
      onProgress: options.onProgress || null,
      animated: options.animated || false,
      animationDelay: options.animationDelay || 10,
      stepsPerFrame: options.stepsPerFrame,
      terrainOptions: options.terrainOptions || {
        forestDensity: 0.5,
        waterLevel: 0.35,
        villageCount: 3
      }
    };

    this.rng = createRNG(this.options.seed);
    this.tileSet = null;
    this.grid = null;
    this.propagator = null;
    this.solver = null;
    this.result = null;
    this.worldSeed = null;
    this.finalTiles = null;
    this.buildings = [];
  }

  /** Main generation entry point */
  async generate(worldSeed: WorldSeed | null = null): Promise<GameMap> {
    this.worldSeed = worldSeed;

    // Phase 1: Generate terrain
    if (this.options.onProgress) {
      this.options.onProgress({ phase: 'terrain', progress: 0, message: 'Generating terrain...' });
    }
    await this.generateTerrain();

    // Get tiles from grid - this will be modified by phases 2 and 3
    this.finalTiles = this.grid!.toTileMap().tiles as TileData[][];

    // Phase 2: Place POIs and structures
    if (worldSeed) {
      if (this.options.onProgress) {
        this.options.onProgress({ phase: 'pois', progress: 50, message: 'Placing settlements...' });
      }
      this.placePOIs(worldSeed, this.finalTiles);
    }

    // Phase 3: Carve roads
    if (worldSeed && worldSeed.connections) {
      if (this.options.onProgress) {
        this.options.onProgress({ phase: 'roads', progress: 75, message: 'Carving roads...' });
      }
      this.carveRoads(worldSeed, this.finalTiles);
    }

    if (this.options.onProgress) {
      this.options.onProgress({ phase: 'complete', progress: 100, message: 'Complete!' });
    }

    return this.getMap();
  }

  /** Phase 1: Generate natural terrain using WFC */
  private async generateTerrain(): Promise<void> {
    this.tileSet = new TileSet();
    this.grid = new Grid(this.width, this.height, this.tileSet);

    // Apply terrain zone biases from world seed FIRST (regional hints)
    if (this.worldSeed) {
      this.applyTerrainZones(this.worldSeed);
    }

    // Apply UI slider-based terrain modifiers LAST (user settings override)
    this.applyTerrainOptions();

    // Create propagator and solver
    this.propagator = new Propagator(this.grid, this.tileSet);
    this.solver = new Solver(this.grid, this.propagator, {
      maxBacktracks: this.options.maxBacktracks,
      seed: this.options.seed,
      onProgress: (p) => {
        if (this.options.onProgress) {
          this.options.onProgress({
            phase: 'terrain',
            progress: p.progress * 0.5, // First 50%
            message: `Terrain: ${Math.round(p.progress)}%`
          });
        }
      }
    });

    // Initial propagation from seeded cells
    this.propagator.propagateAll();

    // Solve
    if (this.options.animated) {
      this.result = await this.solver.solveAnimated(this.options.stepsPerFrame || 50);
    } else {
      this.result = this.solver.solve();
    }

    if (!this.result.success) {
      console.warn('WFC terrain generation had issues, attempting recovery');
      this.recoverFromFailure();
    }
  }

  /** Apply terrain zone biases based on World Seed POIs */
  private applyTerrainZones(worldSeed: WorldSeed): void {
    if (!worldSeed.pois) return;

    for (const poi of worldSeed.pois) {
      // Handle region-based POIs (forests, mountains, lakes)
      if (poi.region) {
        const modifiers = this.getTerrainModifiers(poi.type, 1.5);
        this.grid!.applyRegionModifiers(poi.region, modifiers);

        // Seed some cells in the center of the region for stronger bias
        const cx = Math.floor((poi.region.x_min + (poi.region.x_max || poi.region.x_min)) / 2);
        const cy = Math.floor((poi.region.y_min + (poi.region.y_max || poi.region.y_min)) / 2);

        const seedTile = this.getTerrainSeedTile(poi.type);
        if (seedTile && cx < this.width && cy < this.height) {
          this.grid!.seedCell(cx, cy, seedTile);
        }
      }

      // Handle position-based POIs - seed appropriate terrain nearby
      if (poi.position && poi.type === 'lake') {
        const size = poi.size === 'large' ? 3 : poi.size === 'medium' ? 2 : 1;
        const cx = poi.position.x;
        const cy = poi.position.y;

        for (let dy = -size; dy <= size; dy++) {
          for (let dx = -size; dx <= size; dx++) {
            const dist = Math.abs(dx) + Math.abs(dy);
            if (dist <= size + 1) {
              const x = cx + dx;
              const y = cy + dy;
              if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
                const tileType = dist <= size / 2 ? 'deep_water' : 'shallow_water';
                this.grid!.seedCell(x, y, tileType);
              }
            }
          }
        }
      }
    }

    // Apply biome modifiers
    if (worldSeed.biome) {
      this.applyBiomeModifiers(worldSeed.biome);
    }
  }

  /** Get weight modifiers for terrain based on POI type */
  private getTerrainModifiers(poiType: string, density: number): Record<string, number> {
    const mods: Record<string, Record<string, number>> = {
      forest: {
        forest: 3.0 * density,
        dense_forest: 2.5 * density,
        pine_forest: 1.5 * density,
        glen: 1.2 * density,
        grass: 0.3,
        meadow: 0.4,
        hills: 0.8
      },
      lake: {
        deep_water: 4.0 * density,
        shallow_water: 3.0 * density,
        river: 1.5 * density,
        marsh: 1.2 * density,
        sand: 1.5 * density,
        grass: 0.2,
        forest: 0.1
      },
      mountain: {
        mountain: 3.0 * density,
        peak: 2.0 * density,
        rocky: 2.5 * density,
        cliffs: 2.0 * density,
        hills: 1.8 * density,
        pine_forest: 1.2 * density,
        grass: 0.3,
        forest: 0.4
      },
      swamp: {
        swamp: 3.5 * density,
        marsh: 3.0 * density,
        bog: 2.5 * density,
        dead_forest: 2.0 * density,
        shallow_water: 1.5 * density,
        river: 1.2 * density,
        grass: 0.4,
        forest: 0.3
      },
      desert: {
        sand: 4.0 * density,
        scrubland: 2.0 * density,
        rocky: 1.5 * density,
        grass: 0.1,
        forest: 0.05,
        deep_water: 0.1
      },
      plains: {
        grass: 2.5 * density,
        meadow: 3.0 * density,
        glen: 1.5 * density,
        scrubland: 1.2 * density,
        forest: 0.3,
        hills: 0.5,
        deep_water: 0.2
      },
      hills: {
        hills: 3.0 * density,
        rocky: 2.0 * density,
        grass: 1.2 * density,
        glen: 1.5 * density,
        pine_forest: 1.0 * density,
        mountain: 0.8,
        forest: 0.6
      }
    };
    return mods[poiType] || {};
  }

  /** Get a seed tile for POI type */
  private getTerrainSeedTile(poiType: string): string | null {
    const tiles: Record<string, string> = {
      forest: 'dense_forest',
      lake: 'deep_water',
      mountain: 'mountain',
      hills: 'hills',
      swamp: 'swamp',
      desert: 'sand',
      plains: 'meadow'
    };
    return tiles[poiType] || null;
  }

  /** Apply biome-wide modifiers */
  private applyBiomeModifiers(biome: string): void {
    const mods: Record<string, Record<string, number>> = {
      temperate: { grass: 1.3, forest: 1.2, hills: 0.8, mountain: 0.6 },
      tropical: { forest: 1.5, shallow_water: 1.5, sand: 1.2, mountain: 0.4 },
      desert: { sand: 3.0, grass: 0.2, forest: 0.05, deep_water: 0.1 },
      arctic: { mountain: 1.5, hills: 1.2, grass: 0.6, forest: 0.4 },
      volcanic: { mountain: 2.5, hills: 1.8, grass: 0.5, forest: 0.3 },
      coastal: { shallow_water: 1.8, sand: 1.5, grass: 1.2, deep_water: 1.2 }
    };

    const modifiers = mods[biome] || {};
    this.grid!.applyRegionModifiers(
      { x_min: 0, x_max: this.width - 1, y_min: 0, y_max: this.height - 1 },
      modifiers
    );
  }

  /**
   * Apply terrain options from UI sliders to all cells.
   * SETS weights directly (not multiplicative) for precise slider control.
   */
  private applyTerrainOptions(): void {
    const { forestDensity, waterLevel } = this.options.terrainOptions;
    const TW = TERRAIN_WEIGHTS;

    const forestWeight = TW.MIN_WEIGHT + (forestDensity * TW.GRASS_FOREST_RANGE);
    const grassWeight = TW.MAX_GRASS_FOREST - (forestDensity * TW.GRASS_FOREST_RANGE);
    const waterWeight = TW.MIN_WEIGHT + (waterLevel * TW.WATER_RANGE);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid!.getCell(x, y);
        if (cell && !cell.isCollapsed()) {
          // Forest tiles
          if (cell.weights.forest !== undefined) cell.weights.forest = forestWeight;
          if (cell.weights.dense_forest !== undefined) cell.weights.dense_forest = forestWeight * TW.FOREST.DENSE;
          if (cell.weights.pine_forest !== undefined) cell.weights.pine_forest = forestWeight * TW.FOREST.PINE;
          if (cell.weights.dead_forest !== undefined) cell.weights.dead_forest = forestWeight * TW.FOREST.DEAD;

          // Open terrain (inversely related to forest)
          if (cell.weights.grass !== undefined) cell.weights.grass = grassWeight;
          if (cell.weights.meadow !== undefined) cell.weights.meadow = grassWeight * TW.GRASS.MEADOW;
          if (cell.weights.glen !== undefined) cell.weights.glen = grassWeight * TW.GRASS.GLEN;
          if (cell.weights.scrubland !== undefined) cell.weights.scrubland = grassWeight * TW.GRASS.SCRUBLAND;

          // Water tiles
          if (cell.weights.deep_water !== undefined) cell.weights.deep_water = waterWeight;
          if (cell.weights.shallow_water !== undefined) cell.weights.shallow_water = waterWeight * TW.WATER.SHALLOW;
          if (cell.weights.river !== undefined) cell.weights.river = waterWeight * TW.WATER.RIVER;
          if (cell.weights.marsh !== undefined) cell.weights.marsh = waterWeight * TW.WATER.MARSH;
          if (cell.weights.swamp !== undefined) cell.weights.swamp = (forestWeight + waterWeight) * TW.WATER.SWAMP;
          if (cell.weights.bog !== undefined) cell.weights.bog = waterWeight * TW.WATER.BOG;

          // Highland (stable, slightly reduced by water)
          const hillWeight = TW.HILLS.BASE - (waterLevel * TW.HILLS.WATER_REDUCTION);
          if (cell.weights.hills !== undefined) cell.weights.hills = hillWeight;
          if (cell.weights.rocky !== undefined) cell.weights.rocky = hillWeight * TW.HILLS.ROCKY;
          if (cell.weights.mountain !== undefined) cell.weights.mountain = hillWeight * TW.HILLS.MOUNTAIN;
          if (cell.weights.peak !== undefined) cell.weights.peak = hillWeight * TW.HILLS.PEAK;
          if (cell.weights.cliffs !== undefined) cell.weights.cliffs = hillWeight * TW.HILLS.CLIFFS;

          // Sand (more with water)
          if (cell.weights.sand !== undefined) cell.weights.sand = TW.SAND.BASE + (waterLevel * TW.SAND.WATER_BONUS);
        }
      }
    }

    console.log('Terrain weights:', {
      forestDensity: Math.round(forestDensity * 100) + '%',
      waterLevel: Math.round(waterLevel * 100) + '%',
      forest: forestWeight.toFixed(3),
      grass: grassWeight.toFixed(3),
      water: waterWeight.toFixed(3)
    });
  }

  /** Phase 2: Place POIs on generated terrain */
  private placePOIs(worldSeed: WorldSeed, tiles: TileData[][]): void {
    if (!worldSeed.pois) return;

    const maxSettlements = this.options.terrainOptions.villageCount || 5;
    const settlementTypes = ['village', 'city', 'castle', 'farm', 'tavern', 'tower', 'port', 'ruins'];
    let settlementCount = 0;

    // Separate terrain POIs from settlement POIs
    const settlementPOIs = worldSeed.pois.filter(p =>
      settlementTypes.includes(p.type)
    );

    // Process settlement POIs (limited by slider)
    for (const poi of settlementPOIs) {
      if (settlementCount >= maxSettlements) {
        console.log(`Skipping POI ${poi.name} - village limit reached (${maxSettlements})`);
        continue;
      }

      let x: number | undefined, y: number | undefined;
      if (poi.position) {
        x = poi.position.x;
        y = poi.position.y;
      } else if (poi.region) {
        const spot = this.findSuitableSpot(tiles, poi.region, poi.type);
        if (spot) {
          x = spot.x;
          y = spot.y;
          poi.position = { x, y };
        } else {
          continue;
        }
      } else {
        continue;
      }

      if (x !== undefined && y !== undefined) {
        this.placePOIStructures(tiles, x, y, poi);
        settlementCount++;
      }
    }

    console.log(`Placed ${settlementCount}/${maxSettlements} settlements`);
  }

  /** Find a suitable spot for a POI type within a region */
  private findSuitableSpot(
    tiles: TileData[][],
    region: { x_min: number; x_max: number; y_min: number; y_max: number },
    poiType: string
  ): { x: number; y: number } | null {
    const suitableTerrain: Record<string, string[]> = {
      village: ['grass', 'sand'],
      city: ['grass'],
      castle: ['hills', 'grass'],
      farm: ['grass'],
      tavern: ['grass', 'sand'],
      tower: ['hills', 'mountain', 'grass'],
      port: ['sand', 'grass'],
      ruins: ['grass', 'forest', 'hills']
    };

    const allowed = suitableTerrain[poiType] || ['grass'];
    const xMin = region.x_min || 0;
    const xMax = region.x_max || this.width - 1;
    const yMin = region.y_min || 0;
    const yMax = region.y_max || this.height - 1;

    const candidates: { x: number; y: number }[] = [];
    for (let y = yMin; y <= yMax && y < this.height; y++) {
      for (let x = xMin; x <= xMax && x < this.width; x++) {
        if (tiles[y] && tiles[y][x] && allowed.includes(tiles[y][x].type)) {
          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

  /** Place structures for a POI at given location */
  private placePOIStructures(tiles: TileData[][], cx: number, cy: number, poi: POI): void {
    const size = poi.size === 'large' ? 3 : poi.size === 'medium' ? 2 : 1;

    switch (poi.type) {
      case 'village': this.placeVillage(tiles, cx, cy, size, poi.id); break;
      case 'city': this.placeCity(tiles, cx, cy, size, poi.id); break;
      case 'castle': this.placeCastle(tiles, cx, cy, size, poi.id); break;
      case 'farm': this.placeFarm(tiles, cx, cy, size, poi.id); break;
      case 'tavern': this.placeTavern(tiles, cx, cy, poi.id); break;
      case 'tower': this.placeTower(tiles, cx, cy, poi.id); break;
      case 'ruins': this.placeRuins(tiles, cx, cy, size, poi.id); break;
      case 'port': this.placePort(tiles, cx, cy, poi.id); break;
      case 'temple': this.placeTemple(tiles, cx, cy, poi.id); break;
      case 'mine': this.placeMine(tiles, cx, cy, poi.id); break;
    }
  }

  private placeTemple(tiles: TileData[][], cx: number, cy: number, poiId?: string): void {
    this.registerBuilding(tiles, 'temple_small', cx - 2, cy - 2, poiId);
    // Sacred grove around temple
    for (let dy = -3; dy <= 5; dy++) {
      for (let dx = -3; dx <= 5; dx++) {
        const x = cx + dx, y = cy + dy;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'meadow', 'forest'])) {
          this.setTile(tiles, x, y, 'sacred_grove');
        }
      }
    }
    this.setTile(tiles, cx, cy + 3, 'stone_road');
  }

  private placeMine(tiles: TileData[][], cx: number, cy: number, poiId?: string): void {
    this.registerBuilding(tiles, 'tower', cx, cy, poiId);
    // Rocky terrain around mine
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, y = cy + dy;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'hills', 'rocky', 'forest'])) {
          this.setTile(tiles, x, y, 'quarry');
        }
      }
    }
    this.setTile(tiles, cx + 1, cy + 3, 'dirt_road');
  }

  /** Register a building instance and mark its footprint tiles as non-walkable */
  private registerBuilding(
    tiles: TileData[][],
    templateId: string,
    tileX: number,
    tileY: number,
    poiId?: string,
  ): BuildingInstance | null {
    const template = getBuildingTemplate(templateId);
    if (!template) return null;

    const id = `${poiId ?? 'anon'}-${templateId}-${this.buildings.length}`;
    const instance: BuildingInstance = { id, templateId, tileX, tileY, poiId, state: 'intact' };
    this.buildings.push(instance);

    // Mark footprint tiles as non-walkable per template walkableCells
    for (let dy = 0; dy < template.footprint.h; dy++) {
      for (let dx = 0; dx < template.footprint.w; dx++) {
        const walkable = template.walkableCells[dy]?.[dx] ?? false;
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (ty >= 0 && ty < this.height && tx >= 0 && tx < this.width && tiles[ty]?.[tx]) {
          tiles[ty][tx].type = walkable ? 'lot' : 'building_stone';
          tiles[ty][tx].walkable = walkable;
        }
      }
    }
    return instance;
  }

  private placeVillage(tiles: TileData[][], cx: number, cy: number, size: number, poiId?: string): void {
    const radius = size + 1;
    this.setTile(tiles, cx, cy, 'dirt_road');

    const buildingSpots: [number, number][] = [
      [-2, -2], [0, -2], [2, -2],
      [-2, 0],           [2, 0],
      [-2, 2],  [0, 2],  [2, 2]
    ];

    for (const [dx, dy] of buildingSpots) {
      const x = cx + dx, y = cy + dy;
      if (this.isValidPlacement(tiles, x, y, ['grass', 'sand', 'forest', 'meadow'])) {
        if (this.rng() > 0.3) {
          this.registerBuilding(tiles, 'cottage', x, y, poiId);
        } else {
          this.setTile(tiles, x, y, 'farm_field');
        }
      }
    }

    for (let d = 1; d <= radius; d++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
        const x = cx + dx * d, y = cy + dy * d;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'sand', 'forest', 'meadow'])) {
          this.setTile(tiles, x, y, 'dirt_road');
        }
      }
    }
  }

  private placeCity(tiles: TileData[][], cx: number, cy: number, size: number, poiId?: string): void {
    const radius = size + 2;
    this.setTile(tiles, cx, cy, 'market');

    for (let d = 1; d <= radius; d++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
        const x = cx + dx * d, y = cy + dy * d;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'sand'])) {
          this.setTile(tiles, x, y, 'stone_road');
        }
      }
    }

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2 && Math.abs(dx) + Math.abs(dy) <= 4) {
          const x = cx + dx, y = cy + dy;
          if (this.isValidPlacement(tiles, x, y, ['grass', 'sand']) && this.rng() > 0.3) {
            this.registerBuilding(tiles, 'tavern', x, y, poiId);
          }
        }
      }
    }
    // Market stall at center
    this.registerBuilding(tiles, 'market_stall', cx, cy, poiId);
  }

  private placeCastle(tiles: TileData[][], cx: number, cy: number, _size: number, poiId?: string): void {
    // Place keep at center
    this.registerBuilding(tiles, 'castle_keep', cx - 2, cy - 2, poiId);

    // Castle wall tiles around perimeter (legacy tile approach)
    const wallSpots: [number, number][] = [
      [-3, -3], [-2, -3], [-1, -3], [0, -3], [1, -3], [2, -3], [3, -3],
      [-3, 3],  [-2, 3],  [-1, 3],  [0, 3],  [1, 3],  [2, 3],  [3, 3],
      [-3, -2], [-3, -1], [-3, 0],  [-3, 1], [-3, 2],
      [3, -2],  [3, -1],  [3, 0],   [3, 1],  [3, 2],
    ];

    for (const [dx, dy] of wallSpots) {
      if (this.isValidPlacement(tiles, cx + dx, cy + dy, ['grass', 'sand', 'lot'])) {
        this.setTile(tiles, cx + dx, cy + dy, 'castle_wall');
      }
    }

    for (let d = 4; d <= 5; d++) {
      this.setTile(tiles, cx, cy + d, 'stone_road');
    }
  }

  private placeFarm(tiles: TileData[][], cx: number, cy: number, _size: number, poiId?: string): void {
    // Place barn
    this.registerBuilding(tiles, 'farm_barn', cx, cy, poiId);

    // Surround with farm fields
    for (let dy = -1; dy <= 3; dy++) {
      for (let dx = -3; dx <= 5; dx++) {
        const x = cx + dx, y = cy + dy;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'meadow'])) {
          this.setTile(tiles, x, y, 'farm_field');
        }
      }
    }

    this.setTile(tiles, cx + 1, cy + 3, 'dirt_road');
  }

  private placeTavern(tiles: TileData[][], cx: number, cy: number, poiId?: string): void {
    this.registerBuilding(tiles, 'tavern', cx, cy, poiId);
    this.setTile(tiles, cx + 1, cy + 3, 'dirt_road');
  }

  private placeTower(tiles: TileData[][], cx: number, cy: number, poiId?: string): void {
    this.registerBuilding(tiles, 'tower', cx, cy, poiId);
    for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [0, 3]] as [number, number][]) {
      if (this.isValidPlacement(tiles, cx + dx, cy + dy, ['grass', 'forest', 'hills', 'rocky'])) {
        this.setTile(tiles, cx + dx, cy + dy, 'grass');
      }
    }
  }

  private placeRuins(tiles: TileData[][], cx: number, cy: number, _size: number, poiId?: string): void {
    const spots: [number, number][] = [[0, 0], [-2, 0], [2, 2], [0, -2]];
    for (const [dx, dy] of spots) {
      if (this.rng() > 0.3) {
        const inst: BuildingInstance = {
          id: `${poiId ?? 'ruins'}-ruin-${this.buildings.length}`,
          templateId: 'cottage',
          tileX: cx + dx,
          tileY: cy + dy,
          poiId,
          state: 'ruined',
        };
        this.buildings.push(inst);
        this.setTile(tiles, cx + dx, cy + dy, 'building_stone');
      }
    }
  }

  private placePort(tiles: TileData[][], cx: number, cy: number, poiId?: string): void {
    this.registerBuilding(tiles, 'dock', cx, cy, poiId);
    this.registerBuilding(tiles, 'market_stall', cx - 3, cy - 1, poiId);
    this.setTile(tiles, cx + 1, cy + 3, 'dirt_road');
  }

  /** Helper to set a tile safely */
  private setTile(tiles: TileData[][], x: number, y: number, tileType: string): void {
    if (y >= 0 && y < this.height && x >= 0 && x < this.width && tiles[y] && tiles[y][x]) {
      tiles[y][x].type = tileType;
      tiles[y][x].walkable = TILES[tileType]?.walkable ?? true;
      tiles[y][x].height = 0;
    }
  }

  /** Check if we can place structure at location */
  private isValidPlacement(tiles: TileData[][], x: number, y: number, allowedTypes: string[]): boolean {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return false;
    if (!tiles[y] || !tiles[y][x]) return false;
    return allowedTypes.includes(tiles[y][x].type);
  }

  /** Phase 3: Carve roads and rivers between POIs */
  private carveRoads(worldSeed: WorldSeed, tiles: TileData[][]): void {
    if (!worldSeed.connections) return;

    // Build POI position lookup
    const poiPositions: Record<string, { x: number; y: number }> = {};
    for (const poi of worldSeed.pois) {
      if (poi.id && poi.position) {
        poiPositions[poi.id] = poi.position;
      }
    }

    // Carve each connection
    for (const conn of worldSeed.connections) {
      const fromPos = poiPositions[conn.from];
      const toPos = poiPositions[conn.to];

      if (fromPos && toPos) {
        if (conn.type === 'river') {
          if (conn.waypoints && conn.waypoints.length > 0) {
            this.carveRiverWithWaypoints(tiles, fromPos, toPos, conn.waypoints);
          } else {
            this.carveRiver(tiles, fromPos.x, fromPos.y, toPos.x, toPos.y);
          }
        } else {
          const style = conn.style || 'dirt';
          const autoBridge = conn.autoBridge !== false;

          if (conn.waypoints && conn.waypoints.length > 0) {
            this.carveRoadWithWaypoints(tiles, fromPos, toPos, conn.waypoints, style, autoBridge);
          } else {
            this.carveRoad(tiles, fromPos.x, fromPos.y, toPos.x, toPos.y, style, autoBridge);
          }
        }
      }
    }

    // Handle road endpoints (roads to edge of map)
    if (worldSeed.roadEndpoints) {
      for (const endpoint of worldSeed.roadEndpoints) {
        this.carveRoadToEdge(tiles, worldSeed.pois, endpoint);
      }
    }
  }

  /** Determine bridge direction based on path direction */
  private getBridgeDirection(prevX: number, prevY: number, _x: number, _y: number, nextX: number | undefined, nextY: number | undefined): string {
    const dx = (nextX !== undefined ? nextX - prevX : _x - prevX);
    const dy = (nextY !== undefined ? nextY - prevY : _y - prevY);
    return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
  }

  /** Carve a road between two points with optional auto-bridge */
  private carveRoad(tiles: TileData[][], x1: number, y1: number, x2: number, y2: number, style: string, autoBridge: boolean = true): void {
    const roadTile = style === 'stone' ? 'stone_road' : 'dirt_road';

    let x = x1, y = y1;
    let prevX = x1, prevY = y1;
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);

    let steps = 0;
    const maxSteps = this.width + this.height;

    while ((x !== x2 || y !== y2) && steps < maxSteps) {
      steps++;

      const current = tiles[y]?.[x];
      if (current) {
        if (WFCEngine.WALKABLE_TERRAIN.includes(current.type)) {
          this.setTile(tiles, x, y, roadTile);
        } else if (autoBridge && WFCEngine.WATER_TERRAIN.includes(current.type)) {
          this.setTile(tiles, x, y, 'bridge');
          const direction = this.getBridgeDirection(prevX, prevY, x, y, x2, y2);
          if (tiles[y][x]) {
            tiles[y][x].bridgeDirection = direction;
          }
        }
      }

      prevX = x;
      prevY = y;

      if (this.rng() < 0.7) {
        if (Math.abs(x2 - x) >= Math.abs(y2 - y)) {
          x += dx;
        } else {
          y += dy;
        }
      } else {
        if (Math.abs(x2 - x) < Math.abs(y2 - y)) {
          x += dx || (this.rng() > 0.5 ? 1 : -1);
        } else {
          y += dy || (this.rng() > 0.5 ? 1 : -1);
        }
      }

      x = Math.max(0, Math.min(this.width - 1, x));
      y = Math.max(0, Math.min(this.height - 1, y));
    }
  }

  /** Carve a road through a series of waypoints */
  private carveRoadWithWaypoints(
    tiles: TileData[][],
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    waypoints: { x: number; y: number }[],
    style: string,
    autoBridge: boolean = true
  ): void {
    const path = [fromPos, ...(waypoints || []), toPos];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      this.carveRoad(tiles, from.x, from.y, to.x, to.y, style, autoBridge);
    }
  }

  /** Carve a river between two points as water tiles */
  private carveRiver(tiles: TileData[][], x1: number, y1: number, x2: number, y2: number): void {
    let x = x1, y = y1;
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);

    let steps = 0;
    const maxSteps = this.width + this.height;

    while ((x !== x2 || y !== y2) && steps < maxSteps) {
      steps++;
      this.setTile(tiles, x, y, 'river');

      if (this.rng() < 0.6) {
        if (Math.abs(x2 - x) >= Math.abs(y2 - y)) {
          x += dx;
        } else {
          y += dy;
        }
      } else {
        if (Math.abs(x2 - x) < Math.abs(y2 - y)) {
          x += dx || (this.rng() > 0.5 ? 1 : -1);
        } else {
          y += dy || (this.rng() > 0.5 ? 1 : -1);
        }
      }

      x = Math.max(0, Math.min(this.width - 1, x));
      y = Math.max(0, Math.min(this.height - 1, y));
    }

    this.setTile(tiles, x2, y2, 'river');
  }

  /** Carve a river through waypoints */
  private carveRiverWithWaypoints(
    tiles: TileData[][],
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    waypoints: { x: number; y: number }[]
  ): void {
    const path = [fromPos, ...(waypoints || []), toPos];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      this.carveRiver(tiles, from.x, from.y, to.x, to.y);
    }
  }

  /** Carve road from nearest POI to edge of map */
  private carveRoadToEdge(tiles: TileData[][], pois: POI[], endpoint: { direction: string; style?: string }): void {
    let nearestPOI: POI | null = null;
    let nearestDist = Infinity;

    let edgeX: number, edgeY: number;
    switch (endpoint.direction) {
      case 'north': edgeX = Math.floor(this.width / 2); edgeY = 0; break;
      case 'south': edgeX = Math.floor(this.width / 2); edgeY = this.height - 1; break;
      case 'east': edgeX = this.width - 1; edgeY = Math.floor(this.height / 2); break;
      case 'west': edgeX = 0; edgeY = Math.floor(this.height / 2); break;
      case 'northeast': edgeX = this.width - 1; edgeY = 0; break;
      case 'northwest': edgeX = 0; edgeY = 0; break;
      case 'southeast': edgeX = this.width - 1; edgeY = this.height - 1; break;
      case 'southwest': edgeX = 0; edgeY = this.height - 1; break;
      default: return;
    }

    for (const poi of pois) {
      if (poi.position) {
        const dist = Math.abs(poi.position.x - edgeX) + Math.abs(poi.position.y - edgeY);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPOI = poi;
        }
      }
    }

    if (nearestPOI && nearestPOI.position) {
      this.carveRoad(tiles, nearestPOI.position.x, nearestPOI.position.y, edgeX, edgeY, endpoint.style || 'dirt');
    }
  }

  /** Attempt to recover from WFC failure by filling uncollapsed cells */
  private recoverFromFailure(): void {
    const fallbackTiles = ['grass', 'meadow', 'forest', 'hills', 'scrubland'];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid!.getCell(x, y);
        if (cell && !cell.isCollapsed()) {
          const neighbors = this.grid!.getNeighbors(x, y);
          let chosen = 'grass';

          for (const { cell: neighbor } of neighbors) {
            if (neighbor.isCollapsed()) {
              const neighborTile = neighbor.getTile()!;
              const compatible = this.tileSet!.getNeighbors(neighborTile);
              const options = compatible.filter(t => fallbackTiles.includes(t));
              if (options.length > 0) {
                chosen = options[Math.floor(this.rng() * options.length)];
                break;
              }
            }
          }

          cell.forceCollapse(chosen);
        }
      }
    }
  }

  /** Get the generated map in standard format */
  getMap(): GameMap {
    const tiles = this.finalTiles || this.grid!.toTileMap().tiles;

    // Collect village locations from placed POIs
    const villages: { x: number; y: number; name?: string; type: string }[] = [];
    if (this.worldSeed?.pois) {
      for (const poi of this.worldSeed.pois) {
        if (poi.position && ['village', 'city', 'castle', 'farm', 'tavern', 'tower', 'port', 'ruins'].includes(poi.type)) {
          villages.push({
            x: poi.position.x,
            y: poi.position.y,
            name: poi.name,
            type: poi.type
          });
        }
      }
    }

    return {
      tiles: tiles as Tile[][],
      width: this.width,
      height: this.height,
      villages,
      seed: this.options.seed,
      success: this.result?.success ?? true,
      worldSeed: this.worldSeed,
      stats: {
        iterations: this.result?.iterations || 0,
        backtracks: this.result?.backtracks || 0
      },
      buildings: this.buildings,
    };
  }

  // Legacy methods for compatibility
  seedCell(x: number, y: number, tileId: string): void {
    if (this.grid) {
      this.grid.seedCell(x, y, tileId);
    }
  }

  seedCells(seeds: { x: number; y: number; tile: string }[]): void {
    for (const { x, y, tile } of seeds) {
      this.seedCell(x, y, tile);
    }
  }

  applyWorldSeed(worldSeed: WorldSeed): void {
    this.worldSeed = worldSeed;
  }

  getProgress(): number {
    return this.grid ? this.grid.getProgress() : 0;
  }

  debugPrint(): string {
    return this.grid ? this.grid.debugPrint() : '';
  }
}
