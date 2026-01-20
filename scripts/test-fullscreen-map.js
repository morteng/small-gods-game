#!/usr/bin/env node
/**
 * Small Gods - Fullscreen Map Generation Test
 *
 * Tests the enhanced map system with:
 * - Fullscreen map generation
 * - Obstacles and buildings
 * - A* pathfinding
 * - Road/river autotiling
 * - Optional AI painting via Replicate
 *
 * Usage:
 *   node scripts/test-fullscreen-map.js [seed] [--paint]
 */

const fs = require('fs');
const path = require('path');
const { MapSystem, TileTypes } = require('../src/map/MapSystem');
const { IsometricRenderer } = require('../src/map/IsometricRenderer');

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ||
  process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

const shouldPaint = process.argv.includes('--paint');
const seed = parseInt(process.argv.find(a => /^\d+$/.test(a))) || Math.floor(Math.random() * 100000);

async function generatePaintedMap(imageBuffer, prompt, options = {}) {
  if (!REPLICATE_TOKEN) {
    console.log('   No REPLICATE_API_TOKEN set, skipping AI painting');
    return null;
  }

  const {
    promptStrength = 0.7,
    guidanceScale = 8,
    numInferenceSteps = 35,
    seed = Math.floor(Math.random() * 1000000),
  } = options;

  console.log('   Creating Replicate prediction...');
  console.log(`   Prompt strength: ${promptStrength}`);

  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: '89eb212b3d1366a83e949c12a4b45dfe6b6b313b594cb8268e864931ac9ffb16',
      input: {
        image: dataUrl,
        prompt: prompt,
        negative_prompt: 'blurry, low quality, ugly, text, watermark, realistic photo, 3d render, modern, photograph',
        prompt_strength: promptStrength,
        guidance_scale: guidanceScale,
        num_inference_steps: numInferenceSteps,
        seed: seed,
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
    process.stdout.write(`\r   Processing${'.'.repeat(dots % 4).padEnd(3)}`);

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
  const outputDir = path.join(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('═'.repeat(60));
  console.log('Small Gods - Enhanced Map System Test');
  console.log('═'.repeat(60));
  console.log(`Seed: ${seed}`);
  console.log(`AI Painting: ${shouldPaint ? 'Enabled' : 'Disabled (use --paint to enable)'}`);
  console.log('');

  // Step 1: Generate map using new MapSystem
  console.log('1. Generating map with enhanced MapSystem...');
  const mapWidth = 24;
  const mapHeight = 18;

  const mapSystem = new MapSystem(mapWidth, mapHeight, seed);
  mapSystem.generate();

  console.log(`   Map size: ${mapWidth}x${mapHeight} tiles`);
  console.log(`   Villages: ${mapSystem.villages.length}`);
  console.log(`   Rivers: ${mapSystem.rivers.length}`);
  console.log(`   Roads: ${mapSystem.roads.length}`);

  // Step 2: Test pathfinding
  console.log('');
  console.log('2. Testing A* pathfinding...');

  // Find walkable start and end points
  let startPoint = null;
  let endPoint = null;

  // Use village centers if available, otherwise find walkable tiles
  if (mapSystem.villages.length >= 2) {
    // Find walkable tiles near first village
    const v1 = mapSystem.villages[0];
    for (let dy = -3; dy <= 3 && !startPoint; dy++) {
      for (let dx = -3; dx <= 3 && !startPoint; dx++) {
        const tile = mapSystem.getTile(v1.x + dx, v1.y + dy);
        if (tile && tile.walkable) {
          startPoint = { x: v1.x + dx, y: v1.y + dy };
        }
      }
    }

    // Find walkable tiles near second village
    const v2 = mapSystem.villages[1];
    for (let dy = -3; dy <= 3 && !endPoint; dy++) {
      for (let dx = -3; dx <= 3 && !endPoint; dx++) {
        const tile = mapSystem.getTile(v2.x + dx, v2.y + dy);
        if (tile && tile.walkable) {
          endPoint = { x: v2.x + dx, y: v2.y + dy };
        }
      }
    }
  }

  // Fallback to corners
  if (!startPoint) startPoint = { x: 2, y: 2 };
  if (!endPoint) endPoint = { x: mapWidth - 3, y: mapHeight - 3 };

  console.log(`   Finding path from (${startPoint.x},${startPoint.y}) to (${endPoint.x},${endPoint.y})...`);

  const startTime = Date.now();
  const foundPath = mapSystem.findPath(startPoint.x, startPoint.y, endPoint.x, endPoint.y);
  const pathTime = Date.now() - startTime;

  if (foundPath) {
    console.log(`   ✓ Path found: ${foundPath.length} steps in ${pathTime}ms`);

    // Calculate total movement cost
    let totalCost = 0;
    for (const p of foundPath) {
      totalCost += mapSystem.getMovementCost(p.x, p.y);
    }
    console.log(`   Total movement cost: ${totalCost.toFixed(2)}`);
  } else {
    console.log(`   ✗ No path found (${pathTime}ms)`);
  }

  // Step 3: Render isometric map
  console.log('');
  console.log('3. Rendering isometric map...');

  const renderer = new IsometricRenderer({
    tileWidth: 64,
    tileHeight: 32,
    showGrid: false
  });

  // Render to 1024x1024 for AI painting compatibility
  const targetSize = 1024;
  const canvas = renderer.render(mapSystem, {
    targetWidth: targetSize,
    targetHeight: targetSize,
    skyGradient: true
  });

  // Draw path on the map if found
  if (foundPath) {
    const ctx = canvas.getContext('2d');
    const actualWidth = (mapWidth + mapHeight) * (renderer.tileWidth / 2);
    const actualHeight = (mapWidth + mapHeight) * (renderer.tileHeight / 2);
    const offsetX = (targetSize - actualWidth) / 2 + actualWidth / 2;
    const offsetY = (targetSize - actualHeight) / 2;

    renderer.renderPath(ctx, foundPath, mapSystem, offsetX, offsetY, 'rgba(255,200,0,0.7)');
  }

  const segmentFilePath = path.join(outputDir, `fullscreen_segment_${seed}.png`);
  const imageBuffer = canvas.toBuffer('image/png');
  fs.writeFileSync(segmentFilePath, imageBuffer);
  console.log(`   Saved: ${segmentFilePath}`);

  // Step 4: Generate tile statistics
  console.log('');
  console.log('4. Map statistics:');

  const tileStats = {};
  let walkableCount = 0;
  let obstacleCount = 0;

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const tile = mapSystem.getTile(x, y);
      const typeName = tile.type.id;
      tileStats[typeName] = (tileStats[typeName] || 0) + 1;

      if (tile.walkable) walkableCount++;
      if (tile.hasObstacle) obstacleCount++;
    }
  }

  const totalTiles = mapWidth * mapHeight;
  console.log(`   Total tiles: ${totalTiles}`);
  console.log(`   Walkable: ${walkableCount} (${((walkableCount/totalTiles)*100).toFixed(1)}%)`);
  console.log(`   Obstacles: ${obstacleCount}`);
  console.log('   Terrain breakdown:');

  for (const [type, count] of Object.entries(tileStats).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / totalTiles) * 100).toFixed(1);
    console.log(`     ${type}: ${count} (${pct}%)`);
  }

  // Step 5: AI painting (optional)
  if (shouldPaint) {
    console.log('');
    console.log('5. AI painting with SDXL...');

    const prompt = `Beautiful fantasy isometric game world map, highly detailed painterly illustration,
lush green grass meadows with wildflowers, magical dense forest with tall detailed trees,
crystal clear blue water lake with gentle reflections, sandy beaches with fine detail,
cozy medieval village with thatched roof cottages and stone buildings,
winding dirt paths and cobblestone roads connecting locations,
warm golden hour sunlight with soft shadows, Studio Ghibli art style,
vibrant saturated colors, professional game art, soft dreamy atmosphere,
top-down isometric perspective, cohesive fantasy world design`;

    try {
      const outputUrls = await generatePaintedMap(imageBuffer, prompt, {
        promptStrength: 0.75,
        guidanceScale: 8,
        seed: seed
      });

      if (outputUrls && outputUrls.length > 0) {
        const paintedFilePath = path.join(outputDir, `fullscreen_painted_${seed}.png`);
        await downloadImage(outputUrls[0], paintedFilePath);
        console.log(`   Saved: ${paintedFilePath}`);

        // Open both images
        const { exec } = require('child_process');
        exec(`open "${segmentFilePath}" "${paintedFilePath}"`);
      }
    } catch (error) {
      console.error('   Paint error:', error.message);
    }
  } else {
    // Just open the segment map
    const { exec } = require('child_process');
    exec(`open "${segmentFilePath}"`);
  }

  // Step 6: Save map data
  console.log('');
  console.log('5. Saving map data...');

  const mapDataFilePath = path.join(outputDir, `map_data_${seed}.json`);
  const mapData = {
    ...mapSystem.serialize(),
    path: foundPath,
    statistics: {
      totalTiles,
      walkableCount,
      obstacleCount,
      tileStats
    }
  };
  fs.writeFileSync(mapDataFilePath, JSON.stringify(mapData, null, 2));
  console.log(`   Saved: ${mapDataFilePath}`);

  console.log('');
  console.log('═'.repeat(60));
  console.log('Complete!');
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
