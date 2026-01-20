/**
 * Test Map Generation using SDXL Multi-ControlNet with img2img
 *
 * This uses fofr/sdxl-multi-controlnet-lora with the segment map as input
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ||
  process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

// Same tile colors and map generation as before
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

class SeededRandom {
  constructor(seed) { this.seed = seed; }
  next() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  range(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
}

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

function renderIsometricSegmentMap(mapData, targetWidth = 1024, targetHeight = 1024) {
  const { tiles } = mapData;
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;

  const maxBuildingHeight = 20;
  const margin = 20;

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
      ctx.arc(x, y + halfH, 6, 0, Math.PI * 2);
      ctx.fillStyle = colors.left;
      ctx.fill();
    }
  }
}

async function generateWithSDXL(imageDataUrl, prompt, options = {}) {
  const {
    promptStrength = 0.65, // Lower = more faithful to input, higher = more creative
    guidanceScale = 7.5,
    numInferenceSteps = 30,
    seed = Math.floor(Math.random() * 1000000),
  } = options;

  console.log('   Creating prediction with SDXL img2img...');
  console.log(`   Prompt strength: ${promptStrength}`);
  console.log(`   Guidance: ${guidanceScale}`);

  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: '89eb212b3d1366a83e949c12a4b45dfe6b6b313b594cb8268e864931ac9ffb16',
      input: {
        image: imageDataUrl,
        prompt: prompt,
        negative_prompt: 'blurry, low quality, distorted, text, watermark, modern, realistic photo, 3d render',
        prompt_strength: promptStrength,
        guidance_scale: guidanceScale,
        num_inference_steps: numInferenceSteps,
        seed: seed,
        width: 1024,
        height: 1024,
        sizing_strategy: 'input_image',
        scheduler: 'K_EULER',
      }
    }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Replicate API error: ${createResponse.status} - ${errorText}`);
  }

  const prediction = await createResponse.json();
  console.log(`   Prediction ID: ${prediction.id}`);

  let result = prediction;
  let dots = 0;
  while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled') {
    await new Promise(r => setTimeout(r, 2000));
    dots++;
    process.stdout.write(`\r   Waiting${'.'.repeat(dots % 4).padEnd(3)}`);

    const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` },
    });
    result = await pollResponse.json();
  }
  console.log('');

  if (result.status === 'failed') {
    throw new Error(`Generation failed: ${result.error || 'Unknown error'}`);
  }

  return result.output;
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function main() {
  if (!REPLICATE_TOKEN) {
    console.error('Error: REPLICATE_API_TOKEN not set');
    process.exit(1);
  }

  const seed = parseInt(process.argv.find(a => /^\d+$/.test(a))) || Math.floor(Math.random() * 100000);
  const outputDir = path.join(__dirname, '../output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('Small Gods - SDXL img2img Map Generation');
  console.log('='.repeat(60));
  console.log(`Seed: ${seed}`);
  console.log('');

  console.log('1. Generating procedural map...');
  const mapData = generateMap(16, 12, seed);
  console.log(`   Size: 16x12, Village at (${mapData.villageCenter.x}, ${mapData.villageCenter.y})`);

  console.log('2. Rendering isometric segment map...');
  const canvas = renderIsometricSegmentMap(mapData, 1024, 1024);
  const segmentPath = path.join(outputDir, `sdxl_segment_${seed}.png`);
  const imageBuffer = canvas.toBuffer('image/png');
  fs.writeFileSync(segmentPath, imageBuffer);
  console.log(`   Saved: ${segmentPath}`);

  console.log('3. Calling SDXL img2img API...');

  const prompt = `Beautiful fantasy isometric world map painting, highly detailed illustration,
lush green meadows, dense magical forests with tall trees, crystal blue lake,
sandy beaches, medieval village with thatched cottages and stone buildings,
dirt paths, warm golden sunlight, Studio Ghibli art style, vibrant colors,
professional game asset, fantasy atmosphere, painterly style, soft lighting`;

  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;
  const startTime = Date.now();

  try {
    const outputUrls = await generateWithSDXL(dataUrl, prompt, {
      promptStrength: 0.6,
      guidanceScale: 7.5,
      seed: seed,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done in ${elapsed}s`);

    if (outputUrls && outputUrls.length > 0) {
      const paintedPath = path.join(outputDir, `sdxl_painted_${seed}.png`);
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

      const { exec } = require('child_process');
      exec(`open "${segmentPath}" "${paintedPath}"`);
    }

  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  }
}

main();
