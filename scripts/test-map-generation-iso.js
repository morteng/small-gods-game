/**
 * Test Map Generation - Isometric ControlNet Version
 *
 * This script:
 * 1. Generates a procedural map
 * 2. Renders it as an ISOMETRIC segment map (structure + colors)
 * 3. Sends to Fal.ai ControlNet API
 * 4. Saves the painted result
 *
 * The key insight: ControlNet needs BOTH the isometric structure
 * AND the color coding in the same image.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Fal.ai API configuration
const FAL_API_KEY = process.env.FAL_KEY || 'cdc493d8-d227-4d35-a3db-e68bd477681e:2b8f05a83b898c023ead77c6d2aaee40';
const FAL_API_URL = 'https://fal.run/fal-ai/z-image/turbo/controlnet';

// Segment colors - these tell ControlNet what each tile IS
const TILE_COLORS = {
  deep_water:     { fill: '#0055AA', top: '#0066CC', left: '#004488', right: '#0077DD' },
  shallow_water:  { fill: '#3388CC', top: '#4A90D9', left: '#2277BB', right: '#55AAEE' },
  grass:          { fill: '#44AA44', top: '#55CC55', left: '#338833', right: '#66DD66' },
  forest:         { fill: '#226622', top: '#228B22', left: '#114411', right: '#33AA33' },
  sand:           { fill: '#DDBB33', top: '#F4D03F', left: '#CCAA22', right: '#FFDD55' },
  dirt_road:      { fill: '#775533', top: '#8B6B4A', left: '#664422', right: '#996644' },
  stone_road:     { fill: '#666666', top: '#808080', left: '#555555', right: '#999999' },
  building_wood:  { fill: '#AA8855', top: '#DEB887', left: '#886633', right: '#CCAA77', height: 20 },
  building_stone: { fill: '#777777', top: '#A9A9A9', left: '#555555', right: '#999999', height: 20 },
};

// Seeded random
class SeededRandom {
  constructor(seed) { this.seed = seed; }
  next() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  range(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
}

// Noise functions
function noise2D(x, y, seed) {
  const rng = new SeededRandom(seed + x * 374761393 + y * 668265263);
  return rng.next();
}

function smoothNoise(x, y, seed, scale) {
  const xi = Math.floor(x / scale);
  const yi = Math.floor(y / scale);
  const xf = (x / scale) - xi;
  const yf = (y / scale) - yi;
  const n00 = noise2D(xi, yi, seed);
  const n10 = noise2D(xi + 1, yi, seed);
  const n01 = noise2D(xi, yi + 1, seed);
  const n11 = noise2D(xi + 1, yi + 1, seed);
  const nx0 = n00 * (1 - xf) + n10 * xf;
  const nx1 = n01 * (1 - xf) + n11 * xf;
  return nx0 * (1 - yf) + nx1 * yf;
}

function fractalNoise(x, y, seed, octaves = 4) {
  let value = 0, amplitude = 1, frequency = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency, seed + i * 1000, 4) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / maxValue;
}

/**
 * Generate procedural map data
 */
function generateMap(width, height, seed) {
  const rng = new SeededRandom(seed);
  const tiles = [];

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const elevation = fractalNoise(x, y, seed, 4);
      const moisture = fractalNoise(x, y, seed + 500, 3);

      let type;
      if (elevation < 0.3) {
        type = elevation < 0.2 ? 'deep_water' : 'shallow_water';
      } else if (elevation < 0.4) {
        type = 'sand';
      } else if (elevation < 0.75) {
        type = moisture > 0.5 ? 'forest' : 'grass';
      } else {
        type = 'grass';
      }

      row.push({ type, elevation });
    }
    tiles.push(row);
  }

  // Add village
  const villageX = rng.range(4, width - 5);
  const villageY = rng.range(4, height - 5);

  const buildingPositions = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [2, 1], [-2, 0], [1, 2], [-1, -2]
  ];

  for (const [dx, dy] of buildingPositions) {
    const bx = villageX + dx;
    const by = villageY + dy;
    if (bx >= 0 && bx < width && by >= 0 && by < height) {
      if (!tiles[by][bx].type.includes('water')) {
        tiles[by][bx].type = rng.next() > 0.3 ? 'building_wood' : 'building_stone';
      }
    }
  }

  // Add roads
  for (let y = villageY - 2; y <= villageY + 2; y++) {
    for (let x = villageX - 3; x <= villageX + 3; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        const t = tiles[y][x].type;
        if (t === 'grass' || t === 'sand') {
          if (y === villageY || x === villageX) {
            tiles[y][x].type = rng.next() > 0.3 ? 'dirt_road' : 'stone_road';
          }
        }
      }
    }
  }

  // Extend road to edge
  let roadY = villageY;
  for (let x = villageX + 3; x < width; x++) {
    const t = tiles[roadY][x].type;
    if (t === 'grass' || t === 'forest') {
      tiles[roadY][x].type = 'dirt_road';
    }
    if (rng.next() > 0.7) roadY += rng.range(-1, 1);
    roadY = Math.max(0, Math.min(height - 1, roadY));
  }

  return { tiles, villageCenter: { x: villageX, y: villageY } };
}

/**
 * Render ISOMETRIC segment map
 * This combines the isometric structure with segment colors
 * The map fills the entire canvas with minimal margins
 */
function renderIsometricSegmentMap(mapData, targetWidth = 512, targetHeight = 384) {
  const { tiles } = mapData;
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;

  // Calculate tile size to fill the canvas
  // Isometric width = (mapWidth + mapHeight) * (tileWidth / 2)
  // Isometric height = (mapWidth + mapHeight) * (tileHeight / 2) + buildingHeight
  const maxBuildingHeight = 20;
  const margin = 10;

  // tileWidth and tileHeight have 2:1 ratio for isometric
  const availableWidth = targetWidth - margin * 2;
  const availableHeight = targetHeight - margin * 2 - maxBuildingHeight;

  const tileWidth = Math.floor(availableWidth / (mapWidth + mapHeight) * 2);
  const tileHeight = Math.floor(tileWidth / 2);

  // Recalculate actual dimensions
  const actualWidth = (mapWidth + mapHeight) * (tileWidth / 2);
  const actualHeight = (mapWidth + mapHeight) * (tileHeight / 2) + maxBuildingHeight;

  const canvas = createCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');

  // Sky/background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, targetHeight);
  gradient.addColorStop(0, '#87CEEB');
  gradient.addColorStop(1, '#E0F6FF');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // Center the map
  const offsetX = (targetWidth - actualWidth) / 2 + actualWidth / 2;
  const offsetY = (targetHeight - actualHeight) / 2;

  // Collect tiles with their render order
  const renderTiles = [];
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      renderTiles.push({ x, y, order: x + y });
    }
  }
  // Sort back to front
  renderTiles.sort((a, b) => a.order - b.order);

  // Draw each tile
  for (const pos of renderTiles) {
    const tile = tiles[pos.y][pos.x];
    const colors = TILE_COLORS[tile.type];

    // Convert to isometric coordinates
    const isoX = (pos.x - pos.y) * (tileWidth / 2) + offsetX;
    const isoY = (pos.x + pos.y) * (tileHeight / 2) + offsetY;

    drawIsometricTile(ctx, isoX, isoY, tileWidth, tileHeight, colors, tile.type);
  }

  return canvas;
}

/**
 * Draw a single isometric tile with segment colors
 */
function drawIsometricTile(ctx, x, y, width, height, colors, tileType) {
  const halfW = width / 2;
  const halfH = height / 2;
  const tileHeight = colors.height || 0;

  // If it's a building, draw the 3D box
  if (tileHeight > 0) {
    // Left face
    ctx.beginPath();
    ctx.moveTo(x - halfW, y + halfH);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height + tileHeight);
    ctx.lineTo(x - halfW, y + halfH + tileHeight);
    ctx.closePath();
    ctx.fillStyle = colors.left;
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Right face
    ctx.beginPath();
    ctx.moveTo(x + halfW, y + halfH);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height + tileHeight);
    ctx.lineTo(x + halfW, y + halfH + tileHeight);
    ctx.closePath();
    ctx.fillStyle = colors.right;
    ctx.fill();
    ctx.stroke();

    // Roof (top face, elevated)
    ctx.beginPath();
    ctx.moveTo(x, y - tileHeight + height);
    ctx.lineTo(x + halfW, y + halfH - tileHeight + height);
    ctx.lineTo(x, y + height - tileHeight + height);
    ctx.lineTo(x - halfW, y + halfH - tileHeight + height);
    ctx.closePath();
    ctx.fillStyle = colors.top;
    ctx.fill();
    ctx.stroke();

  } else {
    // Flat tile - draw diamond
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + halfW, y + halfH);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x - halfW, y + halfH);
    ctx.closePath();
    ctx.fillStyle = colors.top;
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Add simple indication for forests (darker spots)
    if (tileType === 'forest') {
      ctx.beginPath();
      ctx.arc(x, y + halfH, 4, 0, Math.PI * 2);
      ctx.fillStyle = colors.left;
      ctx.fill();
    }
  }
}

/**
 * Also render a flat segment map for comparison
 */
function renderFlatSegmentMap(mapData, tileSize = 32) {
  const { tiles } = mapData;
  const height = tiles.length;
  const width = tiles[0].length;

  const canvas = createCanvas(width * tileSize, height * tileSize);
  const ctx = canvas.getContext('2d');

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y][x];
      const colors = TILE_COLORS[tile.type];
      ctx.fillStyle = colors.top;
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  return canvas;
}

/**
 * Call Fal.ai ControlNet API
 */
async function generatePaintedMap(imageDataUrl, options = {}) {
  const {
    prompt,
    controlScale = 0.8,
    seed = Math.floor(Math.random() * 1000000),
  } = options;

  console.log('   Calling Fal.ai API...');
  console.log(`   Control Scale: ${controlScale}`);
  console.log(`   Seed: ${seed}`);

  const response = await fetch(FAL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: prompt,
      image_url: imageDataUrl,
      controlnet_conditioning_scale: controlScale,
      seed: seed,
      num_inference_steps: 8,
      guidance_scale: 3.5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fal.ai API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Download image from URL
 */
async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Main
 */
async function main() {
  const seed = parseInt(process.argv[2]) || Math.floor(Math.random() * 100000);
  const outputDir = path.join(__dirname, '../output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('Small Gods - Isometric AI Map Generation');
  console.log('='.repeat(60));
  console.log(`Seed: ${seed}`);
  console.log('');

  // Step 1: Generate map
  console.log('1. Generating procedural map...');
  const mapData = generateMap(16, 12, seed);
  console.log(`   Size: 16x12, Village at (${mapData.villageCenter.x}, ${mapData.villageCenter.y})`);

  // Step 2: Render ISOMETRIC segment map
  console.log('2. Rendering isometric segment map...');
  const isoCanvas = renderIsometricSegmentMap(mapData);
  const isoPath = path.join(outputDir, `iso_segment_${seed}.png`);
  fs.writeFileSync(isoPath, isoCanvas.toBuffer('image/png'));
  console.log(`   Saved: ${isoPath}`);

  // Also save flat version for comparison
  const flatCanvas = renderFlatSegmentMap(mapData);
  const flatPath = path.join(outputDir, `flat_segment_${seed}.png`);
  fs.writeFileSync(flatPath, flatCanvas.toBuffer('image/png'));
  console.log(`   Also saved flat version: ${flatPath}`);

  // Step 3: Call API with isometric version
  console.log('3. Generating painted map from isometric input...');

  const prompt = `Beautiful fantasy isometric world map, highly detailed painterly illustration,
    lush green meadows, dense magical forests with tall pine trees,
    crystal clear blue lake water with gentle waves,
    sandy beaches along the shore,
    charming medieval village with thatched roof cottages and stone buildings,
    winding dirt paths between houses,
    warm golden afternoon sunlight casting soft shadows,
    whimsical Studio Ghibli art style, rich vibrant colors,
    professional game asset quality, cohesive fantasy atmosphere`;

  const dataUrl = `data:image/png;base64,${isoCanvas.toBuffer('image/png').toString('base64')}`;

  const startTime = Date.now();

  try {
    const result = await generatePaintedMap(dataUrl, {
      prompt,
      controlScale: 0.75,  // Balance between structure and creativity
      seed,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done in ${elapsed}s`);

    if (result.images && result.images.length > 0) {
      const paintedPath = path.join(outputDir, `painted_iso_${seed}.png`);
      await downloadImage(result.images[0].url, paintedPath);
      console.log(`   Saved: ${paintedPath}`);

      console.log('');
      console.log('='.repeat(60));
      console.log('SUCCESS!');
      console.log('='.repeat(60));
      console.log('');
      console.log('Generated files:');
      console.log(`  Input (iso segment):  ${isoPath}`);
      console.log(`  Input (flat segment): ${flatPath}`);
      console.log(`  Output (painted):     ${paintedPath}`);
      console.log('');

      // Open the files
      const { exec } = require('child_process');
      exec(`open "${isoPath}" "${paintedPath}"`);

    } else {
      throw new Error('No image returned');
    }

  } catch (error) {
    console.error('');
    console.error('ERROR:', error.message);
    console.log('');
    console.log('The segment maps were still saved. Check:');
    console.log(`  ${isoPath}`);
    console.log(`  ${flatPath}`);
    process.exit(1);
  }
}

main();
