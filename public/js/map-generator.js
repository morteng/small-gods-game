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
    villageCount = 3,
    animated = false
  } = terrainOptions;

  // Store engine reference for animated rendering
  let currentEngine = null;

  try {
    // Check if WFC is available
    if (!window.WFC || !window.WFC.WFCEngine) {
      throw new Error('WFC engine not loaded. Using noise fallback.');
    }

    const engine = new window.WFC.WFCEngine(width, height, {
      seed,
      maxBacktracks: 300,
      animated: animated,
      stepsPerFrame: 500, // Maximum speed - do many steps per frame
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

        // Real-time rendering during animated generation
        if (animated && currentEngine && currentEngine.grid) {
          renderAnimatedProgress(currentEngine, width, height);
        }
      }
    });

    currentEngine = engine;

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
    debugLog('Terrain distribution:', distribution);

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

/**
 * Render WFC progress in real-time during animated generation
 * Shows detailed tiles as they are collapsed by the algorithm
 * Uses the same rendering as the final map for visual consistency
 */
function renderAnimatedProgress(engine, width, height) {
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const TileTypes = window.WFC?.TILES || {};

  // Constants for isometric rendering (same as renderer.js)
  const TILE_WIDTH = window.TILE_WIDTH || 32;
  const TILE_HEIGHT = window.TILE_HEIGHT || 16;
  const AI_SIZE = window.AI_SIZE || 1024;
  const TW2 = TILE_WIDTH / 2;
  const TH2 = TILE_HEIGHT / 2;

  // Calculate offsets (same as renderer.js)
  const mapCenterX = (width - 1) / 2;
  const mapCenterY = (height - 1) / 2;
  const centerIsoX = (mapCenterX - mapCenterY) * TW2;
  const centerIsoY = (mapCenterX + mapCenterY) * TH2;
  const ox = AI_SIZE / 2 - centerIsoX;
  const oy = AI_SIZE / 2 - centerIsoY;

  // Clear canvas
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Get current grid state
  const grid = engine.grid;
  if (!grid || !grid.cells) return;

  // Get drawTile function from renderer
  const drawTile = window.drawTile;
  const useDetailedRendering = typeof drawTile === 'function';

  // Render back to front for proper overlap
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid.cells[y]?.[x];
      if (!cell) continue;

      const ix = (x - y) * TW2 + ox;
      const iy = (x + y) * TH2 + oy;

      if (cell.collapsed) {
        const tileId = cell.getTile();
        const tt = TileTypes[tileId];

        if (useDetailedRendering && tt) {
          // Use full detailed tile rendering (trees, buildings, etc.)
          drawTile(ctx, ix, iy, TILE_WIDTH, TILE_HEIGHT, tt, { type: tileId, x, y });
        } else {
          // Fallback to simple diamond
          const color = tt?.color || '#888';
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(ix, iy - TH2);
          ctx.lineTo(ix + TW2, iy);
          ctx.lineTo(ix, iy + TH2);
          ctx.lineTo(ix - TW2, iy);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Uncollapsed cell - show as dark with subtle glow
        ctx.fillStyle = 'hsl(240, 50%, 12%)';
        ctx.beginPath();
        ctx.moveTo(ix, iy - TH2);
        ctx.lineTo(ix + TW2, iy);
        ctx.lineTo(ix, iy + TH2);
        ctx.lineTo(ix - TW2, iy);
        ctx.closePath();
        ctx.fill();

        // Subtle border for low-entropy cells (wave front)
        const possibleCount = cell.possibilities?.size || 0;
        if (possibleCount > 0 && possibleCount <= 5) {
          ctx.strokeStyle = 'rgba(100, 180, 255, 0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }
}
