/**
 * WFC Engine - Multi-Phase Generation
 *
 * DESIGN: Uses a 3-phase approach for natural terrain generation:
 *
 * Phase 1: TERRAIN GENERATION
 *   - Generate natural terrain using only terrain tiles (water, grass, forest, hills, mountains)
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

class WFCEngine {
  // Get class references (works in both Node.js and browser)
  static get TileSetClass() {
    return (typeof require !== 'undefined') ? require('./Tile').TileSet : window.WFC?.TileSet;
  }
  static get GridClass() {
    return (typeof require !== 'undefined') ? require('./Grid').Grid : window.WFC?.Grid;
  }
  static get PropagatorClass() {
    return (typeof require !== 'undefined') ? require('./Propagator').Propagator : window.WFC?.Propagator;
  }
  static get SolverClass() {
    return (typeof require !== 'undefined') ? require('./Solver').Solver : window.WFC?.Solver;
  }

  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.options = {
      seed: options.seed || Date.now(),
      maxBacktracks: options.maxBacktracks || 500,
      onProgress: options.onProgress || null,
      animated: options.animated || false,
      animationDelay: options.animationDelay || 10,
      // Terrain options from UI sliders (0-1 scale)
      terrainOptions: options.terrainOptions || {
        forestDensity: 0.5,
        waterLevel: 0.35,
        villageCount: 3
      }
    };

    // Create seeded RNG
    this.rng = this.createRNG(this.options.seed);

    // Will be initialized in generate()
    this.tileSet = null;
    this.grid = null;
    this.propagator = null;
    this.solver = null;
    this.result = null;
    this.worldSeed = null;
    this.finalTiles = null; // Store final tiles after POI/road modifications
  }

  createRNG(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Main generation entry point
   */
  async generate(worldSeed = null) {
    this.worldSeed = worldSeed;

    // Phase 1: Generate terrain
    if (this.options.onProgress) {
      this.options.onProgress({ phase: 'terrain', progress: 0, message: 'Generating terrain...' });
    }
    await this.generateTerrain();

    // Get tiles from grid - this will be modified by phases 2 and 3
    this.finalTiles = this.grid.toTileMap().tiles;

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

  /**
   * Phase 1: Generate natural terrain using WFC
   */
  async generateTerrain() {
    // Use terrain-only tile set for natural generation
    this.tileSet = new WFCEngine.TileSetClass(true); // terrainOnly = true
    this.grid = new WFCEngine.GridClass(this.width, this.height, this.tileSet);

    // Apply terrain zone biases from world seed FIRST (regional hints)
    if (this.worldSeed) {
      this.applyTerrainZones(this.worldSeed);
    }

    // Apply UI slider-based terrain modifiers LAST (user settings override)
    // This ensures sliders like "forest density = 0" actually work
    this.applyTerrainOptions();

    // Create propagator and solver
    this.propagator = new WFCEngine.PropagatorClass(this.grid, this.tileSet);
    this.solver = new WFCEngine.SolverClass(this.grid, this.propagator, {
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
      this.result = await this.solver.solveAnimated(this.options.animationDelay);
    } else {
      this.result = this.solver.solve();
    }

    if (!this.result.success) {
      console.warn('WFC terrain generation had issues, attempting recovery');
      this.recoverFromFailure();
    }
  }

  /**
   * Apply terrain zone biases based on World Seed POIs
   */
  applyTerrainZones(worldSeed) {
    if (!worldSeed.pois) return;

    for (const poi of worldSeed.pois) {
      // Handle region-based POIs (forests, mountains, lakes)
      if (poi.region) {
        const modifiers = this.getTerrainModifiers(poi.type, poi.density || 1.5);
        this.grid.applyRegionModifiers(poi.region, modifiers);

        // Seed some cells in the center of the region for stronger bias
        const cx = Math.floor((poi.region.x_min + (poi.region.x_max || poi.region.x_min)) / 2);
        const cy = Math.floor((poi.region.y_min + (poi.region.y_max || poi.region.y_min)) / 2);

        const seedTile = this.getTerrainSeedTile(poi.type);
        if (seedTile && cx < this.width && cy < this.height) {
          this.grid.seedCell(cx, cy, seedTile);
        }
      }

      // Handle position-based POIs - seed appropriate terrain nearby
      if (poi.position && poi.type === 'lake') {
        // Seed water at lake positions
        this.grid.seedCell(poi.position.x, poi.position.y, 'deep_water');
      }
    }

    // Apply biome modifiers
    if (worldSeed.biome) {
      this.applyBiomeModifiers(worldSeed.biome);
    }
  }

  /**
   * Get weight modifiers for terrain based on POI type
   */
  getTerrainModifiers(poiType, density) {
    const mods = {
      // Dense forest zone
      forest: {
        forest: 3.0 * density,
        dense_forest: 2.5 * density,
        pine_forest: 1.5 * density,
        glen: 1.2 * density,
        grass: 0.3,
        meadow: 0.4,
        hills: 0.8
      },
      // Lake/water zone
      lake: {
        deep_water: 4.0 * density,
        shallow_water: 3.0 * density,
        river: 1.5 * density,
        marsh: 1.2 * density,
        sand: 1.5 * density,
        grass: 0.2,
        forest: 0.1
      },
      // Mountain zone
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
      // Swamp/wetland zone
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
      // Desert zone
      desert: {
        sand: 4.0 * density,
        scrubland: 2.0 * density,
        rocky: 1.5 * density,
        grass: 0.1,
        forest: 0.05,
        deep_water: 0.1
      },
      // Plains/meadow zone
      plains: {
        grass: 2.5 * density,
        meadow: 3.0 * density,
        glen: 1.5 * density,
        scrubland: 1.2 * density,
        forest: 0.3,
        hills: 0.5,
        deep_water: 0.2
      },
      // Hills zone
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

  /**
   * Get a seed tile for POI type
   */
  getTerrainSeedTile(poiType) {
    const tiles = {
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

  /**
   * Apply biome-wide modifiers
   */
  applyBiomeModifiers(biome) {
    const mods = {
      temperate: { grass: 1.3, forest: 1.2, hills: 0.8, mountain: 0.6 },
      tropical: { forest: 1.5, shallow_water: 1.5, sand: 1.2, mountain: 0.4 },
      desert: { sand: 3.0, grass: 0.2, forest: 0.05, deep_water: 0.1 },
      arctic: { mountain: 1.5, hills: 1.2, grass: 0.6, forest: 0.4 },
      volcanic: { mountain: 2.5, hills: 1.8, grass: 0.5, forest: 0.3 },
      coastal: { shallow_water: 1.8, sand: 1.5, grass: 1.2, deep_water: 1.2 }
    };

    const modifiers = mods[biome] || {};
    this.grid.applyRegionModifiers(
      { x_min: 0, x_max: this.width - 1, y_min: 0, y_max: this.height - 1 },
      modifiers
    );
  }

  /**
   * Apply terrain options from UI sliders to all cells
   * SETS weights directly (not multiplicative) for precise slider control
   */
  applyTerrainOptions() {
    const { forestDensity, waterLevel } = this.options.terrainOptions;

    // Direct weight values based on sliders
    // forestDensity 0-1 controls forest vs grass balance
    // waterLevel 0-1 controls water amount
    //
    // At forestDensity 0%:   grass ~0.18, forest ~0.02
    // At forestDensity 50%:  grass ~0.10, forest ~0.10 (balanced)
    // At forestDensity 100%: grass ~0.02, forest ~0.18

    const forestWeight = 0.02 + (forestDensity * 0.16);  // 0.02 to 0.18
    const grassWeight = 0.18 - (forestDensity * 0.16);   // 0.18 to 0.02
    const waterWeight = 0.02 + (waterLevel * 0.14);      // 0.02 to 0.16

    // SET weights directly on all cells (replaces previous weights)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid.getCell(x, y);
        if (cell && !cell.isCollapsed()) {
          // Forest tiles
          if (cell.weights.forest !== undefined) cell.weights.forest = forestWeight;
          if (cell.weights.dense_forest !== undefined) cell.weights.dense_forest = forestWeight * 0.7;
          if (cell.weights.pine_forest !== undefined) cell.weights.pine_forest = forestWeight * 0.6;
          if (cell.weights.dead_forest !== undefined) cell.weights.dead_forest = forestWeight * 0.2;

          // Open terrain (inversely related to forest)
          if (cell.weights.grass !== undefined) cell.weights.grass = grassWeight;
          if (cell.weights.meadow !== undefined) cell.weights.meadow = grassWeight * 0.85;
          if (cell.weights.glen !== undefined) cell.weights.glen = grassWeight * 0.6;
          if (cell.weights.scrubland !== undefined) cell.weights.scrubland = grassWeight * 0.5;

          // Water tiles
          if (cell.weights.deep_water !== undefined) cell.weights.deep_water = waterWeight;
          if (cell.weights.shallow_water !== undefined) cell.weights.shallow_water = waterWeight * 1.1;
          if (cell.weights.river !== undefined) cell.weights.river = waterWeight * 0.7;
          if (cell.weights.marsh !== undefined) cell.weights.marsh = waterWeight * 0.5;
          if (cell.weights.swamp !== undefined) cell.weights.swamp = (forestWeight + waterWeight) * 0.3;
          if (cell.weights.bog !== undefined) cell.weights.bog = waterWeight * 0.4;

          // Highland (stable, slightly reduced by water)
          const hillWeight = 0.07 - (waterLevel * 0.02);
          if (cell.weights.hills !== undefined) cell.weights.hills = hillWeight;
          if (cell.weights.rocky !== undefined) cell.weights.rocky = hillWeight * 0.7;
          if (cell.weights.mountain !== undefined) cell.weights.mountain = hillWeight * 0.5;
          if (cell.weights.peak !== undefined) cell.weights.peak = hillWeight * 0.3;
          if (cell.weights.cliffs !== undefined) cell.weights.cliffs = hillWeight * 0.4;

          // Sand (more with water)
          if (cell.weights.sand !== undefined) cell.weights.sand = 0.04 + (waterLevel * 0.04);
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

  /**
   * Phase 2: Place POIs on generated terrain
   * Respects villageCount from terrain options to limit settlements
   */
  placePOIs(worldSeed, tiles) {
    if (!worldSeed.pois) return;

    const maxSettlements = this.options.terrainOptions.villageCount || 5;
    const settlementTypes = ['village', 'city', 'castle', 'farm', 'tavern', 'tower', 'port', 'ruins'];
    let settlementCount = 0;

    // Separate terrain POIs from settlement POIs
    const terrainPOIs = worldSeed.pois.filter(p =>
      ['forest', 'lake', 'mountain', 'swamp', 'plains', 'hills'].includes(p.type)
    );
    const settlementPOIs = worldSeed.pois.filter(p =>
      settlementTypes.includes(p.type)
    );

    // Process terrain POIs (no limit)
    for (const poi of terrainPOIs) {
      // Terrain zones are handled in phase 1, skip here
    }

    // Process settlement POIs (limited by slider)
    for (const poi of settlementPOIs) {
      if (settlementCount >= maxSettlements) {
        console.log(`Skipping POI ${poi.name} - village limit reached (${maxSettlements})`);
        continue;
      }

      let x, y;
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

      this.placePOIStructures(tiles, x, y, poi);
      settlementCount++;
    }

    console.log(`Placed ${settlementCount}/${maxSettlements} settlements`);
  }

  /**
   * Find a suitable spot for a POI type within a region
   */
  findSuitableSpot(tiles, region, poiType) {
    const suitableTerrain = {
      village: ['grass', 'sand'],
      city: ['grass'],
      castle: ['hills', 'grass'],
      farm: ['grass'],
      tavern: ['grass', 'sand'],
      tower: ['hills', 'mountain', 'grass'],
      port: ['sand', 'grass'], // needs water adjacent
      ruins: ['grass', 'forest', 'hills']
    };

    const allowed = suitableTerrain[poiType] || ['grass'];
    const xMin = region.x_min || 0;
    const xMax = region.x_max || this.width - 1;
    const yMin = region.y_min || 0;
    const yMax = region.y_max || this.height - 1;

    // Collect valid positions
    const candidates = [];
    for (let y = yMin; y <= yMax && y < this.height; y++) {
      for (let x = xMin; x <= xMax && x < this.width; x++) {
        if (tiles[y] && tiles[y][x] && allowed.includes(tiles[y][x].type)) {
          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Pick random candidate
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

  /**
   * Place structures for a POI at given location
   */
  placePOIStructures(tiles, cx, cy, poi) {
    const size = poi.size === 'large' ? 3 : poi.size === 'medium' ? 2 : 1;

    switch (poi.type) {
      case 'village':
        this.placeVillage(tiles, cx, cy, size);
        break;
      case 'city':
        this.placeCity(tiles, cx, cy, size);
        break;
      case 'castle':
        this.placeCastle(tiles, cx, cy, size);
        break;
      case 'farm':
        this.placeFarm(tiles, cx, cy, size);
        break;
      case 'tavern':
        this.placeTavern(tiles, cx, cy);
        break;
      case 'tower':
        this.placeTower(tiles, cx, cy);
        break;
      case 'ruins':
        this.placeRuins(tiles, cx, cy, size);
        break;
      case 'port':
        this.placePort(tiles, cx, cy);
        break;
    }
  }

  placeVillage(tiles, cx, cy, size) {
    const radius = size + 1;

    // Central road
    this.setTile(tiles, cx, cy, 'dirt_road');

    // Buildings around center
    const buildingSpots = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1]
    ];

    for (const [dx, dy] of buildingSpots) {
      const x = cx + dx, y = cy + dy;
      if (this.isValidPlacement(tiles, x, y, ['grass', 'sand', 'forest'])) {
        if (this.rng() > 0.3) {
          this.setTile(tiles, x, y, 'building_wood');
        } else {
          this.setTile(tiles, x, y, 'farm_field');
        }
      }
    }

    // Roads extending from village
    for (let d = 1; d <= radius; d++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const x = cx + dx * d, y = cy + dy * d;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'sand', 'forest'])) {
          this.setTile(tiles, x, y, 'dirt_road');
        }
      }
    }
  }

  placeCity(tiles, cx, cy, size) {
    const radius = size + 2;

    // Central market
    this.setTile(tiles, cx, cy, 'market');

    // Stone road cross
    for (let d = 1; d <= radius; d++) {
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const x = cx + dx * d, y = cy + dy * d;
        if (this.isValidPlacement(tiles, x, y, ['grass', 'sand'])) {
          this.setTile(tiles, x, y, 'stone_road');
        }
      }
    }

    // Stone buildings around center
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 1 && Math.abs(dx) + Math.abs(dy) <= 3) {
          const x = cx + dx, y = cy + dy;
          if (this.isValidPlacement(tiles, x, y, ['grass', 'sand']) && this.rng() > 0.3) {
            this.setTile(tiles, x, y, 'building_stone');
          }
        }
      }
    }
  }

  placeCastle(tiles, cx, cy, size) {
    // Central tower
    this.setTile(tiles, cx, cy, 'castle_tower');

    // Walls around
    const wallSpots = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1]
    ];

    for (const [dx, dy] of wallSpots) {
      this.setTile(tiles, cx + dx, cy + dy, 'castle_wall');
    }

    // Stone road approach
    for (let d = 2; d <= 3; d++) {
      this.setTile(tiles, cx, cy + d, 'stone_road');
    }
  }

  placeFarm(tiles, cx, cy, size) {
    // Farmhouse
    this.setTile(tiles, cx, cy, 'building_wood');

    // Fields around
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx, y = cy + dy;
        if (this.isValidPlacement(tiles, x, y, ['grass'])) {
          this.setTile(tiles, x, y, 'farm_field');
        }
      }
    }

    // Dirt road access
    this.setTile(tiles, cx, cy + 2, 'dirt_road');
  }

  placeTavern(tiles, cx, cy) {
    this.setTile(tiles, cx, cy, 'building_wood');
    this.setTile(tiles, cx, cy + 1, 'dirt_road');
  }

  placeTower(tiles, cx, cy) {
    this.setTile(tiles, cx, cy, 'building_stone');
    // Small clearing
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (this.isValidPlacement(tiles, cx + dx, cy + dy, ['grass', 'forest', 'hills'])) {
        this.setTile(tiles, cx + dx, cy + dy, 'grass');
      }
    }
  }

  placeRuins(tiles, cx, cy, size) {
    // Scattered stone buildings
    const spots = [[0, 0], [-1, 0], [1, 1], [0, -1]];
    for (const [dx, dy] of spots) {
      if (this.rng() > 0.3) {
        this.setTile(tiles, cx + dx, cy + dy, 'building_stone');
      }
    }
  }

  placePort(tiles, cx, cy) {
    // Find water adjacent spot
    this.setTile(tiles, cx, cy, 'dock');
    this.setTile(tiles, cx, cy - 1, 'building_wood');
    this.setTile(tiles, cx, cy + 1, 'dirt_road');
  }

  /**
   * Helper to set a tile safely
   */
  setTile(tiles, x, y, tileType) {
    if (y >= 0 && y < this.height && x >= 0 && x < this.width && tiles[y] && tiles[y][x]) {
      tiles[y][x].type = tileType;
      tiles[y][x].walkable = window.WFC?.TILES?.[tileType]?.walkable ??
                            (typeof require !== 'undefined' ? require('./Tile').TILES[tileType]?.walkable : true);
      tiles[y][x].height = window.WFC?.TILES?.[tileType]?.height ??
                          (typeof require !== 'undefined' ? require('./Tile').TILES[tileType]?.height : 0);
    }
  }

  /**
   * Check if we can place structure at location
   */
  isValidPlacement(tiles, x, y, allowedTypes) {
    if (y < 0 || y >= this.height || x < 0 || x >= this.width) return false;
    if (!tiles[y] || !tiles[y][x]) return false;
    return allowedTypes.includes(tiles[y][x].type);
  }

  /**
   * Phase 3: Carve roads between POIs
   */
  carveRoads(worldSeed, tiles) {
    if (!worldSeed.connections) return;

    // Build POI position lookup
    const poiPositions = {};
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
        this.carveRoad(tiles, fromPos.x, fromPos.y, toPos.x, toPos.y, conn.style || 'dirt');
      }
    }

    // Handle road endpoints (roads to edge of map)
    if (worldSeed.roadEndpoints) {
      for (const endpoint of worldSeed.roadEndpoints) {
        this.carveRoadToEdge(tiles, worldSeed.pois, endpoint);
      }
    }
  }

  /**
   * Carve a road between two points using simple A* or direct path
   */
  carveRoad(tiles, x1, y1, x2, y2, style) {
    const roadTile = style === 'stone' ? 'stone_road' : 'dirt_road';

    // Simple bresenham-like path with some natural variation
    let x = x1, y = y1;
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);

    let steps = 0;
    const maxSteps = this.width + this.height;

    while ((x !== x2 || y !== y2) && steps < maxSteps) {
      steps++;

      // Set road tile if terrain allows (most walkable terrain)
      const current = tiles[y]?.[x];
      if (current && ['grass', 'meadow', 'glen', 'scrubland', 'sand', 'forest', 'dense_forest', 'pine_forest', 'hills', 'farm_field', 'marsh'].includes(current.type)) {
        this.setTile(tiles, x, y, roadTile);
      }

      // Move toward target with some randomness for natural look
      if (this.rng() < 0.7) {
        // Move in primary direction
        if (Math.abs(x2 - x) >= Math.abs(y2 - y)) {
          x += dx;
        } else {
          y += dy;
        }
      } else {
        // Alternate direction
        if (Math.abs(x2 - x) < Math.abs(y2 - y)) {
          x += dx || (this.rng() > 0.5 ? 1 : -1);
        } else {
          y += dy || (this.rng() > 0.5 ? 1 : -1);
        }
      }

      // Clamp to bounds
      x = Math.max(0, Math.min(this.width - 1, x));
      y = Math.max(0, Math.min(this.height - 1, y));
    }
  }

  /**
   * Carve road from nearest POI to edge of map
   */
  carveRoadToEdge(tiles, pois, endpoint) {
    // Find nearest POI with a position
    let nearestPOI = null;
    let nearestDist = Infinity;

    // Determine edge coordinates based on direction
    let edgeX, edgeY;
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

    // Find nearest POI
    for (const poi of pois) {
      if (poi.position) {
        const dist = Math.abs(poi.position.x - edgeX) + Math.abs(poi.position.y - edgeY);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPOI = poi;
        }
      }
    }

    if (nearestPOI) {
      this.carveRoad(tiles, nearestPOI.position.x, nearestPOI.position.y, edgeX, edgeY, endpoint.style);
    }
  }

  /**
   * Attempt to recover from WFC failure by filling uncollapsed cells
   * with terrain based on neighbors
   */
  recoverFromFailure() {
    const fallbackTiles = ['grass', 'meadow', 'forest', 'hills', 'scrubland'];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid.getCell(x, y);
        if (!cell.isCollapsed()) {
          // Try to pick something compatible with neighbors
          const neighbors = this.grid.getNeighbors(x, y);
          let chosen = 'grass';

          for (const { cell: neighbor } of neighbors) {
            if (neighbor.isCollapsed()) {
              const neighborTile = neighbor.getTile();
              const compatible = this.tileSet.getNeighbors(neighborTile);
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

  /**
   * Get the generated map in standard format
   */
  getMap() {
    // Use finalTiles which includes POI and road modifications
    const tiles = this.finalTiles || this.grid.toTileMap().tiles;

    // Collect village locations from placed POIs
    const villages = [];
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
      tiles,
      width: this.width,
      height: this.height,
      villages,
      seed: this.options.seed,
      success: this.result?.success ?? true,
      worldSeed: this.worldSeed,
      stats: {
        iterations: this.result?.iterations || 0,
        backtracks: this.result?.backtracks || 0
      }
    };
  }

  // Legacy methods for compatibility
  seedCell(x, y, tileId) {
    if (this.grid) {
      this.grid.seedCell(x, y, tileId);
    }
  }

  seedCells(seeds) {
    for (const { x, y, tile } of seeds) {
      this.seedCell(x, y, tile);
    }
  }

  applyWorldSeed(worldSeed) {
    this.worldSeed = worldSeed;
  }

  getProgress() {
    return this.grid ? this.grid.getProgress() : 0;
  }

  debugPrint() {
    return this.grid ? this.grid.debugPrint() : '';
  }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WFCEngine };
} else {
  window.WFC = window.WFC || {};
  window.WFC.WFCEngine = WFCEngine;
}
