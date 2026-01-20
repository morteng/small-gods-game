/**
 * Test Map Generation using Replicate API with ControlNet-Seg
 *
 * This script uses jagilley/controlnet-seg which takes a colored segmentation
 * map and generates an image that follows the segment structure.
 *
 * Setup:
 *   1. Get your API token from https://replicate.com/account/api-tokens
 *   2. Set it: export REPLICATE_API_TOKEN=your_token
 *   Or pass it: node test-map-generation-replicate.js --token=your_token
 *
 * Cost: ~$0.0085 per run
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Replicate API configuration
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ||
  process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

// Segment colors - these define the semantic meaning for ControlNet
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
 * Generate procedural map
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

  return { tiles, villageCenter: { x: villageX, y: villageY } };
}

/**
 * Render isometric segment map
 */
function renderIsometricSegmentMap(mapData, targetWidth = 512, targetHeight = 512) {
  const { tiles } = mapData;
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;

  const maxBuildingHeight = 20;
  const margin = 10;

  const availableWidth = targetWidth - margin * 2;
  const availableHeight = targetHeight - margin * 2 - maxBuildingHeight;

  const tileWidth = Math.floor(availableWidth / (mapWidth + mapHeight) * 2);
  const tileHeight = Math.floor(tileWidth / 2);

  const actualWidth = (mapWidth + mapHeight) * (tileWidth / 2);
  const actualHeight = (mapWidth + mapHeight) * (tileHeight / 2) + maxBuildingHeight;

  const canvas = createCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');

  // Sky gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, targetHeight);
  gradient.addColorStop(0, '#87CEEB');
  gradient.addColorStop(1, '#E0F6FF');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const offsetX = (targetWidth - actualWidth) / 2 + actualWidth / 2;
  const offsetY = (targetHeight - actualHeight) / 2;

  const renderTiles = [];
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      renderTiles.push({ x, y, order: x + y });
    }
  }
  renderTiles.sort((a, b) => a.order - b.order);

  for (const pos of renderTiles) {
    const tile = tiles[pos.y][pos.x];
    const colors = TILE_COLORS[tile.type];
    const isoX = (pos.x - pos.y) * (tileWidth / 2) + offsetX;
    const isoY = (pos.x + pos.y) * (tileHeight / 2) + offsetY;
    drawIsometricTile(ctx, isoX, isoY, tileWidth, tileHeight, colors, tile.type);
  }

  return canvas;
}

function drawIsometricTile(ctx, x, y, width, height, colors, tileType) {
  const halfW = width / 2;
  const halfH = height / 2;
  const tileHeight = colors.height || 0;

  if (tileHeight > 0) {
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

    ctx.beginPath();
    ctx.moveTo(x + halfW, y + halfH);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + height + tileHeight);
    ctx.lineTo(x + halfW, y + halfH + tileHeight);
    ctx.closePath();
    ctx.fillStyle = colors.right;
    ctx.fill();
    ctx.stroke();

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

    if (tileType === 'forest') {
      ctx.beginPath();
      ctx.arc(x, y + halfH, 4, 0, Math.PI * 2);
      ctx.fillStyle = colors.left;
      ctx.fill();
    }
  }
}

/**
 * Call Replicate API with jagilley/controlnet-seg
 * This model takes a segmentation map and generates a matching image
 */
async function generateWithControlNetSeg(imageDataUrl, prompt, options = {}) {
  const {
    numSamples = 1,
    imageResolution = 512,
    ddimSteps = 20,
    scale = 9,
    eta = 0,
    aPrompt = 'best quality, extremely detailed',
    nPrompt = 'longbody, lowres, bad anatomy, bad hands, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
  } = options;

  console.log('   Creating prediction with controlnet-seg...');
  console.log(`   Resolution: ${imageResolution}`);
  console.log(`   Steps: ${ddimSteps}`);

  // Create prediction
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // jagilley/controlnet-seg model
      version: 'f967b165f4cd2e151d11e7450a8214e5d22ad2007f042f2f891ca3981dbfba0d',
      input: {
        image: imageDataUrl,
        prompt: prompt,
        num_samples: String(numSamples),
        image_resolution: String(imageResolution),
        ddim_steps: ddimSteps,
        scale: scale,
        eta: eta,
        a_prompt: aPrompt,
        n_prompt: nPrompt,
      }
    }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Replicate API error: ${createResponse.status} - ${errorText}`);
  }

  const prediction = await createResponse.json();
  console.log(`   Prediction ID: ${prediction.id}`);
  console.log(`   Status: ${prediction.status}`);

  // Poll for completion
  let result = prediction;
  let dots = 0;
  while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled') {
    await new Promise(r => setTimeout(r, 2000));
    dots++;
    process.stdout.write(`\r   Waiting${'.'.repeat(dots % 4).padEnd(3)}`);

    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: {
        'Authorization': `Token ${REPLICATE_TOKEN}`,
      },
    });

    if (!pollResponse.ok) {
      throw new Error(`Poll error: ${pollResponse.status}`);
    }

    result = await pollResponse.json();
  }
  console.log('');

  if (result.status === 'failed') {
    throw new Error(`Generation failed: ${result.error || 'Unknown error'}`);
  }

  if (result.status === 'canceled') {
    throw new Error('Generation was canceled');
  }

  return result.output;
}

/**
 * Download image
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
  if (!REPLICATE_TOKEN) {
    console.error('Error: REPLICATE_API_TOKEN not set');
    console.log('');
    console.log('Get your token from: https://replicate.com/account/api-tokens');
    console.log('Then run: export REPLICATE_API_TOKEN=your_token');
    console.log('Or: node test-map-generation-replicate.js --token=your_token');
    process.exit(1);
  }

  const seed = parseInt(process.argv.find(a => !a.startsWith('--') && !a.includes('node') && !a.includes('.js'))) ||
               Math.floor(Math.random() * 100000);
  const outputDir = path.join(__dirname, '../output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('Small Gods - Replicate ControlNet-Seg Map Generation');
  console.log('='.repeat(60));
  console.log(`Seed: ${seed}`);
  console.log('');

  // Step 1: Generate map
  console.log('1. Generating procedural map...');
  const mapData = generateMap(16, 12, seed);
  console.log(`   Size: 16x12, Village at (${mapData.villageCenter.x}, ${mapData.villageCenter.y})`);

  // Step 2: Render segment map
  console.log('2. Rendering isometric segment map...');
  const canvas = renderIsometricSegmentMap(mapData, 512, 512);
  const segmentPath = path.join(outputDir, `replicate_segment_${seed}.png`);
  const imageBuffer = canvas.toBuffer('image/png');
  fs.writeFileSync(segmentPath, imageBuffer);
  console.log(`   Saved: ${segmentPath}`);

  // Step 3: Generate with Replicate ControlNet-Seg
  console.log('3. Calling Replicate ControlNet-Seg API...');

  // Prompt describing the fantasy map - the colors guide the structure
  const prompt = `Beautiful fantasy isometric world map, highly detailed painterly illustration,
lush green meadows and fields, dense magical forests with tall pine trees,
crystal clear blue lake water with gentle waves, sandy beaches along the shore,
charming medieval village with thatched roof cottages and stone buildings,
winding dirt paths between houses, warm golden afternoon sunlight casting soft shadows,
whimsical Studio Ghibli art style, rich vibrant colors, professional game asset quality,
cohesive fantasy atmosphere, top-down isometric perspective`;

  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const startTime = Date.now();

  try {
    const outputUrls = await generateWithControlNetSeg(dataUrl, prompt, {
      imageResolution: 512,
      ddimSteps: 20,
      scale: 9,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done in ${elapsed}s`);

    if (outputUrls && outputUrls.length > 0) {
      // The model returns an array, first is the output image
      const paintedPath = path.join(outputDir, `replicate_painted_${seed}.png`);
      await downloadImage(outputUrls[0], paintedPath);
      console.log(`   Saved: ${paintedPath}`);

      console.log('');
      console.log('='.repeat(60));
      console.log('SUCCESS!');
      console.log('='.repeat(60));
      console.log('');
      console.log('Generated files:');
      console.log(`  Segment map: ${segmentPath}`);
      console.log(`  Painted map: ${paintedPath}`);
      console.log('');
      console.log(`Cost: ~$0.0085`);

      // Open files on macOS
      const { exec } = require('child_process');
      exec(`open "${segmentPath}" "${paintedPath}"`);

    } else {
      throw new Error('No output from Replicate');
    }

  } catch (error) {
    console.error('');
    console.error('ERROR:', error.message);
    console.log('');
    console.log('The segment map was saved:');
    console.log(`  ${segmentPath}`);

    if (error.message.includes('402') || error.message.includes('Payment')) {
      console.log('');
      console.log('You may need to add billing info at https://replicate.com/account/billing');
    }

    process.exit(1);
  }
}

main();
