/**
 * Small Gods - Map Generator
 *
 * Two generation modes:
 * 1. Noise-based (legacy fallback)
 * 2. WFC-based with multi-phase generation (preferred)
 */

/**
 * Legacy noise-based generation (fallback)
 */
function generateMap(width, height, seed, options = {}) {
  const { villageCount = 3, forestDensity = 55, waterLevel = 35 } = options;
  const rng = new Random(seed);
  const tiles = [];
  const villages = [];

  const waterThresh = waterLevel / 100;
  const forestThresh = forestDensity / 100;

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const e = fractalNoise(x, y, seed);
      const m = fractalNoise(x, y, seed + 500);
      let type;
      if (e < waterThresh * 0.7) type = 'deep_water';
      else if (e < waterThresh) type = 'shallow_water';
      else if (e < waterThresh + 0.07) type = 'sand';
      else if (e < 0.75) type = m > (1 - forestThresh) ? 'forest' : 'grass';
      else type = 'grass';
      row.push({ type, x, y });
    }
    tiles.push(row);
  }

  for (let i = 0; i < villageCount; i++) {
    let vx, vy, tries = 0;
    do {
      vx = rng.int(4, width - 5);
      vy = rng.int(4, height - 5);
      tries++;
    } while (tries < 50 && (!tiles[vy]?.[vx] || !TileTypes[tiles[vy][vx].type]?.walkable));

    if (tries < 50) {
      villages.push({ x: vx, y: vy });
      [[0,0], [1,0], [-1,0], [0,1], [0,-1], [1,1], [-1,-1]].forEach(([dx, dy]) => {
        const bx = vx + dx, by = vy + dy;
        if (tiles[by]?.[bx] && TileTypes[tiles[by][bx].type]?.walkable) {
          tiles[by][bx].type = rng.next() > 0.3 ? 'building_wood' : 'building_stone';
        }
      });
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const t = tiles[vy+dy]?.[vx+dx];
          if (t && (t.type === 'grass' || t.type === 'sand') && (dy === 0 || dx === 0)) {
            t.type = 'dirt_road';
          }
        }
      }
    }
  }

  return { tiles, villages, width, height, seed };
}

/**
 * WFC-based generation with multi-phase approach
 * Phase 1: Natural terrain (water, forests, mountains, grass)
 * Phase 2: POI placement (villages, towers, farms)
 * Phase 3: Road carving (connecting POIs)
 */
async function generateWithWFC(width, height, seed, worldSeed, terrainOptions = {}) {
  setStatus('Initializing WFC engine...', 'loading');

  // Extract terrain options from sliders (0-100 scale)
  const {
    forestDensity = 50,
    waterLevel = 35,
    villageCount = 3
  } = terrainOptions;

  try {
    // Check if WFC is available
    if (!window.WFC || !window.WFC.WFCEngine) {
      throw new Error('WFC engine not loaded. Using noise fallback.');
    }

    const engine = new window.WFC.WFCEngine(width, height, {
      seed,
      maxBacktracks: 300,
      // Pass terrain options to engine
      terrainOptions: {
        forestDensity: forestDensity / 100,  // Convert to 0-1 scale
        waterLevel: waterLevel / 100,
        villageCount
      },
      onProgress: (p) => {
        if (p.message) {
          setStatus(p.message, 'loading');
        } else {
          setStatus(`WFC: ${Math.round(p.progress)}% complete...`, 'loading');
        }
      }
    });

    // Generate with world seed - the new API passes worldSeed to generate()
    const mapData = await engine.generate(worldSeed);

    if (!mapData.success) {
      console.warn('WFC generation had issues, using partial result');
    }

    // Log terrain distribution for debugging
    const distribution = {};
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const type = mapData.tiles[y][x].type;
        distribution[type] = (distribution[type] || 0) + 1;
      }
    }
    console.log('Terrain distribution:', distribution);

    return {
      tiles: mapData.tiles,
      villages: mapData.villages,
      width: mapData.width,
      height: mapData.height,
      seed,
      worldSeed,
      stats: mapData.stats
    };

  } catch (e) {
    console.error('WFC generation failed:', e);
    setStatus('WFC failed, using noise generation', 'error');
    return generateMap(width, height, seed, {});
  }
}
