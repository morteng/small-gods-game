/**
 * Test Map Generation - Complete pipeline
 *
 * This script:
 * 1. Generates a procedural segment map
 * 2. Sends it to Fal.ai ControlNet API
 * 3. Saves the painted result
 *
 * Usage:
 *   node test-map-generation.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Fal.ai API configuration
const FAL_API_KEY = process.env.FAL_KEY || 'cdc493d8-d227-4d35-a3db-e68bd477681e:2b8f05a83b898c023ead77c6d2aaee40';
const FAL_API_URL = 'https://fal.run/fal-ai/z-image/turbo/controlnet';

// Tile colors for segment map (must match what ControlNet expects)
const TILE_COLORS = {
  deep_water:     '#0066CC',
  shallow_water:  '#4A90D9',
  grass:          '#7CCD7C',
  forest:         '#228B22',
  sand:           '#F4D03F',
  dirt_road:      '#8B7355',
  stone_road:     '#808080',
  building_wood:  '#DEB887',
  building_stone: '#A9A9A9',
};

// Seeded random number generator
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }
  next() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  range(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// Simple noise function
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
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency, seed + i * 1000, 4) * amplitude;
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return value / maxValue;
}

/**
 * Generate a procedural map
 */
function generateMap(width, height, seed) {
  const rng = new SeededRandom(seed);
  const tiles = [];

  // Generate base terrain
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

      row.push(type);
    }
    tiles.push(row);
  }

  // Add village
  const villageX = rng.range(4, width - 5);
  const villageY = rng.range(4, height - 5);

  const buildingPositions = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [2, 1], [-2, 0], [1, 2]
  ];

  for (const [dx, dy] of buildingPositions) {
    const bx = villageX + dx;
    const by = villageY + dy;
    if (bx >= 0 && bx < width && by >= 0 && by < height) {
      if (tiles[by][bx] !== 'deep_water' && tiles[by][bx] !== 'shallow_water') {
        tiles[by][bx] = rng.next() > 0.3 ? 'building_wood' : 'building_stone';
      }
    }
  }

  // Add roads
  for (let y = villageY - 2; y <= villageY + 2; y++) {
    for (let x = villageX - 3; x <= villageX + 3; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        if (tiles[y][x] === 'grass' || tiles[y][x] === 'sand') {
          if (y === villageY || x === villageX) {
            tiles[y][x] = rng.next() > 0.3 ? 'dirt_road' : 'stone_road';
          }
        }
      }
    }
  }

  return tiles;
}

/**
 * Render segment map to canvas
 */
function renderSegmentMap(tiles, tileSize = 24) {
  const height = tiles.length;
  const width = tiles[0].length;

  const canvas = createCanvas(width * tileSize, height * tileSize);
  const ctx = canvas.getContext('2d');

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tileType = tiles[y][x];
      ctx.fillStyle = TILE_COLORS[tileType] || '#FF00FF';
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  return canvas;
}

/**
 * Call Fal.ai API
 */
async function generatePaintedMap(imageDataUrl, options = {}) {
  const {
    prompt = `Fantasy isometric world map, highly detailed painterly style,
      lush green grass, dense forests with tall trees, crystal clear blue water,
      sandy beaches, medieval village with wooden and stone buildings,
      dirt roads connecting buildings, magical atmosphere, warm golden daylight,
      cohesive art direction, professional game asset quality,
      Studio Ghibli inspired, whimsical yet grounded`,
    controlScale = 0.75,
    seed = Math.floor(Math.random() * 1000000),
  } = options;

  console.log('Calling Fal.ai API...');

  const requestBody = {
    prompt: prompt,
    image_url: imageDataUrl,
    controlnet_conditioning_scale: controlScale,
    seed: seed,
    num_inference_steps: 8,
    guidance_scale: 3.5,
  };

  const response = await fetch(FAL_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
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
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Main
 */
async function main() {
  const seed = Math.floor(Math.random() * 100000);
  const outputDir = path.join(__dirname, '../output');

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(50));
  console.log('Small Gods - AI Map Generation Test');
  console.log('='.repeat(50));
  console.log(`Seed: ${seed}`);
  console.log('');

  // Step 1: Generate procedural map
  console.log('1. Generating procedural map...');
  const tiles = generateMap(16, 12, seed);
  console.log(`   Map size: ${tiles[0].length}x${tiles.length}`);

  // Step 2: Render segment map
  console.log('2. Rendering segment map...');
  const segmentCanvas = renderSegmentMap(tiles);
  const segmentPath = path.join(outputDir, `segment_map_${seed}.png`);
  const segmentBuffer = segmentCanvas.toBuffer('image/png');
  fs.writeFileSync(segmentPath, segmentBuffer);
  console.log(`   Saved: ${segmentPath}`);

  // Step 3: Convert to data URL
  console.log('3. Preparing for API call...');
  const dataUrl = `data:image/png;base64,${segmentBuffer.toString('base64')}`;

  // Step 4: Call Fal.ai API
  console.log('4. Calling Fal.ai ControlNet API...');
  const startTime = Date.now();

  try {
    const result = await generatePaintedMap(dataUrl, {
      controlScale: 0.75,
      seed: seed,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Generation complete in ${elapsed}s`);

    if (result.images && result.images.length > 0) {
      // Step 5: Download result
      console.log('5. Downloading painted map...');
      const paintedPath = path.join(outputDir, `painted_map_${seed}.png`);
      await downloadImage(result.images[0].url, paintedPath);
      console.log(`   Saved: ${paintedPath}`);

      console.log('');
      console.log('='.repeat(50));
      console.log('SUCCESS!');
      console.log('='.repeat(50));
      console.log(`Segment map: ${segmentPath}`);
      console.log(`Painted map: ${paintedPath}`);
      console.log('');
      console.log('Open both files to compare the input and output.');

    } else {
      throw new Error('No image in response');
    }

  } catch (error) {
    console.error('');
    console.error('ERROR:', error.message);
    console.log('');
    console.log('The segment map was still saved. You can try:');
    console.log('1. Check your Fal.ai credits at https://fal.ai/dashboard/usage-billing/credits');
    console.log('2. Add credits if needed');
    console.log('3. Re-run this script');
    process.exit(1);
  }
}

main();
