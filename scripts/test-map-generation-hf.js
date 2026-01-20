/**
 * Test Map Generation using Hugging Face Inference API
 *
 * This script:
 * 1. Generates a procedural segment map
 * 2. Sends it to Hugging Face ControlNet API
 * 3. Saves the painted result
 *
 * Setup:
 *   1. Get your HF token from https://huggingface.co/settings/tokens
 *   2. Set it as environment variable: export HF_TOKEN=your_token
 *   Or pass it as argument: node test-map-generation-hf.js --token=your_token
 *
 * Usage:
 *   node test-map-generation-hf.js
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

// Hugging Face API configuration
const HF_TOKEN = process.env.HF_TOKEN || process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

// ControlNet Segmentation model on HF
const HF_API_URL = 'https://api-inference.huggingface.co/models/lllyasviel/sd-controlnet-seg';

// Alternative: Use a Stable Diffusion model with img2img for simpler approach
const HF_SD_URL = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';

// Tile colors for segment map
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

// Noise functions (same as before)
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
 * Call Hugging Face Inference API with img2img
 * Note: HF's free inference API has limitations with ControlNet
 * This uses a simpler img2img approach
 */
async function generateWithHuggingFace(imageBuffer, prompt) {
  console.log('Calling Hugging Face API...');

  // Try the image-to-image endpoint
  const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-refiner-1.0', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        negative_prompt: 'blurry, low quality, distorted, text, watermark',
        num_inference_steps: 30,
        guidance_scale: 7.5,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF API error: ${response.status} - ${errorText}`);
  }

  // HF returns the image directly as blob
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Alternative: Use HF's dedicated ControlNet Space API
 */
async function generateWithControlNetSpace(imageBuffer, prompt) {
  console.log('Calling Hugging Face ControlNet Space...');

  // This would use the Gradio client for HF Spaces
  // For now, we'll use a direct approach

  const base64Image = imageBuffer.toString('base64');

  // Try using the diffusers pipeline API
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
        num_inference_steps: 30,
        guidance_scale: 7.5,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // Check if model is loading
    if (response.status === 503) {
      const data = JSON.parse(errorText);
      if (data.estimated_time) {
        console.log(`Model is loading, estimated time: ${data.estimated_time}s`);
        console.log('Waiting and retrying...');
        await new Promise(resolve => setTimeout(resolve, data.estimated_time * 1000 + 5000));
        return generateWithControlNetSpace(imageBuffer, prompt);
      }
    }

    throw new Error(`HF API error: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Simple text-to-image with the segment map as reference
 */
async function generateTextToImage(prompt) {
  console.log('Calling Hugging Face text-to-image API...');

  const response = await fetch('https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        negative_prompt: 'blurry, low quality, distorted, text, watermark, modern',
        num_inference_steps: 30,
        guidance_scale: 7.5,
        width: 512,
        height: 384,
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    // Check if model is loading
    if (response.status === 503) {
      try {
        const data = JSON.parse(errorText);
        if (data.estimated_time) {
          console.log(`Model is loading, estimated time: ${Math.ceil(data.estimated_time)}s`);
          console.log('Waiting and retrying...');
          await new Promise(resolve => setTimeout(resolve, (data.estimated_time + 5) * 1000));
          return generateTextToImage(prompt);
        }
      } catch (e) {
        // Not JSON, just throw
      }
    }

    throw new Error(`HF API error: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Main
 */
async function main() {
  if (!HF_TOKEN) {
    console.error('Error: HF_TOKEN not set');
    console.log('');
    console.log('Get your token from: https://huggingface.co/settings/tokens');
    console.log('Then run: export HF_TOKEN=your_token_here');
    console.log('Or: node test-map-generation-hf.js --token=your_token_here');
    process.exit(1);
  }

  const seed = Math.floor(Math.random() * 100000);
  const outputDir = path.join(__dirname, '../output');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('='.repeat(50));
  console.log('Small Gods - AI Map Generation (Hugging Face)');
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
  const segmentPath = path.join(outputDir, `segment_map_hf_${seed}.png`);
  const segmentBuffer = segmentCanvas.toBuffer('image/png');
  fs.writeFileSync(segmentPath, segmentBuffer);
  console.log(`   Saved: ${segmentPath}`);

  // Step 3: Generate with HF
  console.log('3. Calling Hugging Face API...');

  const prompt = `Fantasy isometric world map, highly detailed painterly style,
    top-down view, lush green grass fields, dense forests with trees,
    crystal clear blue water lake, sandy beach areas,
    medieval village with wooden and stone cottages,
    dirt paths connecting buildings, magical atmosphere,
    warm golden sunlight, professional game asset,
    Studio Ghibli inspired, cohesive art style`;

  const startTime = Date.now();

  try {
    // Using text-to-image as HF's free tier ControlNet support is limited
    const imageBuffer = await generateTextToImage(prompt);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   Generation complete in ${elapsed}s`);

    // Save result
    const paintedPath = path.join(outputDir, `painted_map_hf_${seed}.png`);
    fs.writeFileSync(paintedPath, imageBuffer);
    console.log(`   Saved: ${paintedPath}`);

    console.log('');
    console.log('='.repeat(50));
    console.log('SUCCESS!');
    console.log('='.repeat(50));
    console.log(`Segment map: ${segmentPath}`);
    console.log(`Painted map: ${paintedPath}`);
    console.log('');
    console.log('Note: HF free tier has limited ControlNet support.');
    console.log('The painted map is generated from prompt only.');
    console.log('For true ControlNet conditioning, use:');
    console.log('  - Fal.ai (test-map-generation.js)');
    console.log('  - HF Pro subscription');
    console.log('  - Self-hosted ComfyUI');

  } catch (error) {
    console.error('');
    console.error('ERROR:', error.message);

    if (error.message.includes('401')) {
      console.log('');
      console.log('Your HF token may be invalid or expired.');
      console.log('Get a new one from: https://huggingface.co/settings/tokens');
    }

    process.exit(1);
  }
}

main();
