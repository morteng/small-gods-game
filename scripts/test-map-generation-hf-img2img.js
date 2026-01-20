/**
 * Test Map Generation using Hugging Face Inference API (img2img)
 *
 * This script:
 * 1. Generates a procedural segment map
 * 2. Uses HF's img2img API with the segment map as base
 * 3. Saves the painted result
 *
 * Setup:
 *   1. Get your HF token from https://huggingface.co/settings/tokens
 *   2. Set it as environment variable: export HF_TOKEN=your_token
 *   Or pass it as argument: node test-map-generation-hf-img2img.js --token=your_token
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Hugging Face API configuration
const HF_TOKEN = process.env.HF_TOKEN || process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

// Segment colors - match the iso version
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

  return { tiles, villageCenter: { x: villageX, y: villageY } };
}

/**
 * Render ISOMETRIC segment map
 */
function renderIsometricSegmentMap(mapData, targetWidth = 512, targetHeight = 384) {
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

  // Sky gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, targetHeight);
  gradient.addColorStop(0, '#87CEEB');
  gradient.addColorStop(1, '#E0F6FF');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // Center the map
  const offsetX = (targetWidth - actualWidth) / 2 + actualWidth / 2;
  const offsetY = (targetHeight - actualHeight) / 2;

  // Collect and sort tiles
  const renderTiles = [];
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      renderTiles.push({ x, y, order: x + y });
    }
  }
  renderTiles.sort((a, b) => a.order - b.order);

  // Draw tiles
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

    // Roof
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
 * Call Hugging Face img2img API
 */
async function generateWithHuggingFace(imageBuffer, prompt, options = {}) {
  const {
    strength = 0.7, // How much to transform (0-1, higher = more creative, less faithful)
    negativePrompt = 'blurry, low quality, distorted, text, watermark, modern, realistic photo',
    steps = 25,
    guidanceScale = 7.5,
  } = options;

  console.log('   Calling Hugging Face API...');
  console.log(`   Strength: ${strength}`);
  console.log(`   Steps: ${steps}`);

  const base64Image = imageBuffer.toString('base64');

  // Using SDXL Refiner for img2img (it's designed to work with input images)
  // Note: The free HF API may be slow or have limitations
  const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-refiner-1.0', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        negative_prompt: negativePrompt,
        num_inference_steps: steps,
        guidance_scale: guidanceScale,
        strength: strength,
      },
      // Note: The free inference API may not support all img2img params
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // Check for model loading
    if (response.status === 503) {
      try {
        const data = JSON.parse(errorText);
        if (data.estimated_time) {
          console.log(`   Model loading, wait ~${Math.ceil(data.estimated_time)}s...`);
          await new Promise(r => setTimeout(r, (data.estimated_time + 3) * 1000));
          return generateWithHuggingFace(imageBuffer, prompt, options);
        }
      } catch (e) {}
    }

    throw new Error(`HF API error: ${response.status} - ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Alternative: Use a ControlNet model on HF
 */
async function generateWithControlNet(imageBuffer, prompt) {
  console.log('   Calling Hugging Face ControlNet...');

  const base64Image = imageBuffer.toString('base64');

  // This uses the segmentation ControlNet
  const response = await fetch('https://api-inference.huggingface.co/models/lllyasviel/control_v11p_sd15_seg', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {
        prompt: prompt,
        image: base64Image,
      },
      parameters: {
        num_inference_steps: 25,
        guidance_scale: 7.5,
        controlnet_conditioning_scale: 0.8,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    if (response.status === 503) {
      try {
        const data = JSON.parse(errorText);
        if (data.estimated_time) {
          console.log(`   Model loading, wait ~${Math.ceil(data.estimated_time)}s...`);
          await new Promise(r => setTimeout(r, (data.estimated_time + 3) * 1000));
          return generateWithControlNet(imageBuffer, prompt);
        }
      } catch (e) {}
    }

    throw new Error(`HF ControlNet error: ${response.status} - ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Main
 */
async function main() {
  if (!HF_TOKEN) {
    console.error('Error: HF_TOKEN not set');
    console.log('');
    console.log('Get your token from: https://huggingface.co/settings/tokens');
    console.log('Then run: export HF_TOKEN=your_token');
    console.log('Or: node test-map-generation-hf-img2img.js --token=your_token');
    process.exit(1);
  }

  const seed = parseInt(process.argv[2]) || Math.floor(Math.random() * 100000);
  const outputDir = path.join(__dirname, '../output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(60));
  console.log('Small Gods - HuggingFace Map Generation');
  console.log('='.repeat(60));
  console.log(`Seed: ${seed}`);
  console.log('');

  // Step 1: Generate map
  console.log('1. Generating procedural map...');
  const mapData = generateMap(16, 12, seed);
  console.log(`   Size: 16x12, Village at (${mapData.villageCenter.x}, ${mapData.villageCenter.y})`);

  // Step 2: Render isometric segment map
  console.log('2. Rendering isometric segment map...');
  const canvas = renderIsometricSegmentMap(mapData);
  const segmentPath = path.join(outputDir, `hf_segment_${seed}.png`);
  const imageBuffer = canvas.toBuffer('image/png');
  fs.writeFileSync(segmentPath, imageBuffer);
  console.log(`   Saved: ${segmentPath}`);

  // Step 3: Generate with HuggingFace
  console.log('3. Calling HuggingFace API...');

  const prompt = `Beautiful fantasy isometric world map, highly detailed painterly illustration,
    lush green meadows and fields, dense magical forests with tall pine trees,
    crystal clear blue lake water with gentle waves, sandy beaches,
    charming medieval village with thatched roof cottages and stone buildings,
    winding dirt paths between houses, warm golden afternoon sunlight,
    Studio Ghibli art style, rich vibrant colors, professional game art`;

  const startTime = Date.now();

  try {
    // Try ControlNet first (may not work on free tier)
    let imageResult;
    try {
      imageResult = await generateWithControlNet(imageBuffer, prompt);
    } catch (controlNetError) {
      console.log(`   ControlNet unavailable: ${controlNetError.message.slice(0, 100)}`);
      console.log('   Falling back to text-to-image...');

      // Fall back to simple text-to-image
      const t2iResponse = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt + ', isometric view, top-down perspective',
          parameters: {
            negative_prompt: 'blurry, low quality, text, watermark',
            num_inference_steps: 25,
            guidance_scale: 7.5,
            width: 512,
            height: 384,
          }
        }),
      });

      if (!t2iResponse.ok) {
        const errorText = await t2iResponse.text();

        if (t2iResponse.status === 503) {
          const data = JSON.parse(errorText);
          if (data.estimated_time) {
            console.log(`   Model loading, wait ~${Math.ceil(data.estimated_time)}s...`);
            await new Promise(r => setTimeout(r, (data.estimated_time + 3) * 1000));

            const retryResponse = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                inputs: prompt + ', isometric view, top-down perspective',
                parameters: {
                  negative_prompt: 'blurry, low quality, text, watermark',
                  num_inference_steps: 25,
                  guidance_scale: 7.5,
                  width: 512,
                  height: 384,
                }
              }),
            });

            if (!retryResponse.ok) {
              throw new Error(`Retry failed: ${retryResponse.status}`);
            }
            imageResult = Buffer.from(await retryResponse.arrayBuffer());
          } else {
            throw new Error(`HF API error: ${t2iResponse.status} - ${errorText}`);
          }
        } else {
          throw new Error(`HF API error: ${t2iResponse.status} - ${errorText}`);
        }
      } else {
        imageResult = Buffer.from(await t2iResponse.arrayBuffer());
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Done in ${elapsed}s`);

    // Save result
    const paintedPath = path.join(outputDir, `hf_painted_${seed}.png`);
    fs.writeFileSync(paintedPath, imageResult);
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
    console.log('Note: HuggingFace free tier may not support true ControlNet.');
    console.log('The painted map may be generated from prompt only.');

    // Open files
    const { exec } = require('child_process');
    exec(`open "${segmentPath}" "${paintedPath}"`);

  } catch (error) {
    console.error('');
    console.error('ERROR:', error.message);
    console.log('');
    console.log('The segment map was still saved:');
    console.log(`  ${segmentPath}`);
    process.exit(1);
  }
}

main();
