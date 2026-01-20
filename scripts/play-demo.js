#!/usr/bin/env node
/**
 * Small Gods - Integrated Demo
 *
 * Generates a complete game world with:
 * - Procedural map with villages, rivers, roads
 * - AI-painted overview map
 * - NPC sprites for each village
 * - Click-to-zoom capability (generates hi-res views)
 *
 * Usage:
 *   node scripts/play-demo.js [seed]
 *   --token=YOUR_TOKEN (or set REPLICATE_API_TOKEN)
 *   --skip-paint      Skip AI painting (faster, segment map only)
 *   --skip-npcs       Skip NPC generation
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const { MapSystem } = require('../src/map/MapSystem');
const { IsometricRenderer } = require('../src/map/IsometricRenderer');

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ||
  process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

const skipPaint = process.argv.includes('--skip-paint');
const skipNPCs = process.argv.includes('--skip-npcs');
const seed = parseInt(process.argv.find(a => /^\d+$/.test(a))) || Math.floor(Math.random() * 100000);

// Replicate API helper
async function replicatePredict(modelOwner, modelName, input, options = {}) {
  const { timeout = 120000 } = options;

  const modelResponse = await fetch(
    `https://api.replicate.com/v1/models/${modelOwner}/${modelName}`,
    { headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` } }
  );

  if (!modelResponse.ok) throw new Error(`Model error: ${await modelResponse.text()}`);
  const model = await modelResponse.json();
  const version = model.latest_version?.id;

  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input }),
  });

  if (!createResponse.ok) throw new Error(`Prediction error: ${await createResponse.text()}`);
  const prediction = await createResponse.json();

  let result = prediction;
  const startTime = Date.now();

  while (result.status !== 'succeeded' && result.status !== 'failed') {
    if (Date.now() - startTime > timeout) throw new Error('Timeout');
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('.');

    const pollResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` } }
    );
    result = await pollResponse.json();
  }

  if (result.status === 'failed') throw new Error(result.error || 'Failed');
  return result.output;
}

async function downloadImage(url) {
  const response = await fetch(url);
  return Buffer.from(await response.arrayBuffer());
}

// Generate painted map using SDXL
async function paintMap(imageBuffer, seed) {
  console.log('   Calling SDXL img2img...');

  const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

  const result = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: '89eb212b3d1366a83e949c12a4b45dfe6b6b313b594cb8268e864931ac9ffb16',
      input: {
        image: dataUrl,
        prompt: `Beautiful fantasy isometric game world map, highly detailed painterly illustration,
lush green grass meadows, magical dense forest with tall trees, crystal blue water lake,
sandy beaches, cozy medieval village with thatched cottages, dirt paths, warm golden sunlight,
Studio Ghibli art style, vibrant colors, professional game art, soft dreamy atmosphere`,
        negative_prompt: 'blurry, low quality, ugly, text, watermark, realistic photo, 3d render',
        prompt_strength: 0.75,
        guidance_scale: 8,
        num_inference_steps: 35,
        seed: seed,
        sizing_strategy: 'input_image',
        scheduler: 'K_EULER',
      }
    }),
  });

  const prediction = await result.json();
  let status = prediction;

  while (status.status !== 'succeeded' && status.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    process.stdout.write('.');
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` }
    });
    status = await poll.json();
  }
  console.log('');

  if (status.status === 'failed') throw new Error(status.error);
  return status.output[0];
}

// Generate NPC sprites
async function generateNPCs(villageCount) {
  const archetypes = [
    { prompt: 'medieval peasant farmer', name: 'peasant' },
    { prompt: 'wizard in blue robe with staff', name: 'wizard' },
    { prompt: 'town guard in armor with spear', name: 'guard' },
    { prompt: 'merchant trader with goods', name: 'merchant' },
    { prompt: 'village child playing', name: 'child' }
  ];

  const npcs = [];
  const needed = Math.min(villageCount * 2, archetypes.length);

  for (let i = 0; i < needed; i++) {
    const arch = archetypes[i];
    console.log(`   Generating ${arch.name}...`);

    try {
      const result = await replicatePredict('retro-diffusion', 'rd-animation', {
        prompt: arch.prompt,
        style: 'four_angle_walking',
        width: 48,
        height: 48,
        return_spritesheet: true
      });
      console.log(' done');

      const imageUrl = Array.isArray(result) ? result[0] : result;
      npcs.push({ ...arch, imageUrl, buffer: await downloadImage(imageUrl) });
    } catch (err) {
      console.log(` error: ${err.message}`);
    }
  }

  return npcs;
}

// Generate zoom view for a tile
async function generateZoomView(context) {
  const prompts = {
    village: 'isometric medieval village square, cobblestone, thatched cottages, market stalls, wooden carts',
    forest: 'isometric forest clearing, tall oak trees, dappled sunlight, mushrooms, moss rocks',
    water: 'isometric lake shore, crystal blue water, wooden dock, small boat, reeds',
    grass: 'isometric grass meadow, wildflowers, gentle hills, butterflies',
    road: 'isometric dirt road path, worn tracks, grass edges, signpost'
  };

  const prompt = prompts[context] || prompts.grass;

  console.log(`   Generating ${context} zoom view...`);
  const result = await replicatePredict('retro-diffusion', 'rd-plus', {
    prompt,
    style: 'isometric',
    width: 384,
    height: 384,
    num_images: 1
  });
  console.log(' done');

  return Array.isArray(result) ? result[0] : result;
}

// Composite NPCs onto the painted map
async function compositeNPCsOnMap(mapCanvas, npcs, mapSystem, renderer) {
  const ctx = mapCanvas.getContext('2d');

  // Calculate map offset (same as renderer)
  const targetSize = 1024;
  const actualWidth = (mapSystem.width + mapSystem.height) * (renderer.tileWidth / 2);
  const offsetX = (targetSize - actualWidth) / 2 + actualWidth / 2;
  const offsetY = (targetSize - (mapSystem.width + mapSystem.height) * (renderer.tileHeight / 2)) / 2;

  // Place NPCs near villages
  for (let i = 0; i < mapSystem.villages.length && i < npcs.length; i++) {
    const village = mapSystem.villages[i];
    const npc = npcs[i];

    // Find walkable tile near village
    let placed = false;
    for (let dy = -2; dy <= 2 && !placed; dy++) {
      for (let dx = -2; dx <= 2 && !placed; dx++) {
        const tile = mapSystem.getTile(village.x + dx, village.y + dy);
        if (tile && tile.walkable) {
          const screenPos = renderer.mapToScreen(village.x + dx, village.y + dy, offsetX, offsetY);

          // Load and draw NPC sprite (first frame)
          const npcImage = await loadImage(npc.buffer);
          const frameWidth = 48;
          const frameHeight = 48;

          // Draw scaled down to fit tile
          const scale = 0.6;
          ctx.drawImage(
            npcImage,
            0, 0, frameWidth, frameHeight,  // Source: first frame
            screenPos.x - frameWidth * scale / 2,
            screenPos.y - frameHeight * scale + renderer.tileHeight / 2,
            frameWidth * scale,
            frameHeight * scale
          );

          placed = true;
        }
      }
    }
  }

  return mapCanvas;
}

async function main() {
  if (!REPLICATE_TOKEN) {
    console.error('Error: REPLICATE_API_TOKEN not set');
    console.log('Use --token=YOUR_TOKEN or set environment variable');
    process.exit(1);
  }

  const outputDir = path.join(__dirname, '../output/demo');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + '  SMALL GODS - Integrated Demo'.padEnd(58) + '║');
  console.log('╠' + '═'.repeat(58) + '╣');
  console.log('║' + `  Seed: ${seed}`.padEnd(58) + '║');
  console.log('║' + `  Paint: ${!skipPaint}, NPCs: ${!skipNPCs}`.padEnd(58) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log('');

  // Step 1: Generate map
  console.log('1. Generating procedural map...');
  const mapSystem = new MapSystem(24, 18, seed);
  mapSystem.generate();
  console.log(`   Map: 24x18, Villages: ${mapSystem.villages.length}, Rivers: ${mapSystem.rivers.length}`);

  // Step 2: Render isometric segment map
  console.log('\n2. Rendering isometric map...');
  const renderer = new IsometricRenderer({ tileWidth: 64, tileHeight: 32 });
  let mapCanvas = renderer.render(mapSystem, { targetWidth: 1024, targetHeight: 1024, skyGradient: true });

  const segmentPath = path.join(outputDir, `segment_${seed}.png`);
  fs.writeFileSync(segmentPath, mapCanvas.toBuffer('image/png'));
  console.log(`   Saved: ${segmentPath}`);

  // Step 3: Generate NPCs
  let npcs = [];
  if (!skipNPCs) {
    console.log('\n3. Generating NPCs...');
    npcs = await generateNPCs(mapSystem.villages.length);
    console.log(`   Generated ${npcs.length} NPCs`);

    // Save spritesheets
    for (const npc of npcs) {
      const npcPath = path.join(outputDir, `npc_${npc.name}.png`);
      fs.writeFileSync(npcPath, npc.buffer);
    }
  }

  // Step 4: Paint map with AI
  let paintedMapUrl = null;
  if (!skipPaint) {
    console.log('\n4. AI painting map...');
    paintedMapUrl = await paintMap(mapCanvas.toBuffer('image/png'), seed);
    const paintedBuffer = await downloadImage(paintedMapUrl);
    const paintedPath = path.join(outputDir, `painted_${seed}.png`);
    fs.writeFileSync(paintedPath, paintedBuffer);
    console.log(`   Saved: ${paintedPath}`);

    // Load painted map for NPC compositing
    mapCanvas = createCanvas(1024, 1024);
    const ctx = mapCanvas.getContext('2d');
    const paintedImage = await loadImage(paintedBuffer);
    ctx.drawImage(paintedImage, 0, 0);
  }

  // Step 5: Composite NPCs onto map
  if (npcs.length > 0) {
    console.log('\n5. Placing NPCs on map...');
    mapCanvas = await compositeNPCsOnMap(mapCanvas, npcs, mapSystem, renderer);
    const finalPath = path.join(outputDir, `final_${seed}.png`);
    fs.writeFileSync(finalPath, mapCanvas.toBuffer('image/png'));
    console.log(`   Saved: ${finalPath}`);
  }

  // Step 6: Generate sample zoom views
  console.log('\n6. Generating zoom views...');
  const zoomContexts = ['village', 'forest', 'water'];
  const zoomViews = [];

  for (const context of zoomContexts) {
    try {
      const url = await generateZoomView(context);
      const buffer = await downloadImage(url);
      const zoomPath = path.join(outputDir, `zoom_${context}_${seed}.png`);
      fs.writeFileSync(zoomPath, buffer);
      zoomViews.push({ context, path: zoomPath });
    } catch (err) {
      console.log(`   ${context} error: ${err.message}`);
    }
  }

  // Step 7: Save game state
  console.log('\n7. Saving game state...');
  const gameState = {
    seed,
    map: mapSystem.serialize(),
    npcs: npcs.map(n => ({ name: n.name, prompt: n.prompt })),
    zoomViews: zoomViews.map(z => z.context),
    files: {
      segment: `segment_${seed}.png`,
      painted: skipPaint ? null : `painted_${seed}.png`,
      final: npcs.length > 0 ? `final_${seed}.png` : null,
      npcs: npcs.map(n => `npc_${n.name}.png`),
      zooms: zoomViews.map(z => `zoom_${z.context}_${seed}.png`)
    }
  };

  fs.writeFileSync(
    path.join(outputDir, `gamestate_${seed}.json`),
    JSON.stringify(gameState, null, 2)
  );

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('DEMO COMPLETE!');
  console.log('═'.repeat(60));
  console.log(`\nOutput directory: ${outputDir}`);
  console.log('\nGenerated files:');
  console.log(`  - Segment map: segment_${seed}.png`);
  if (!skipPaint) console.log(`  - Painted map: painted_${seed}.png`);
  if (npcs.length > 0) console.log(`  - Final (with NPCs): final_${seed}.png`);
  console.log(`  - NPCs: ${npcs.map(n => n.name).join(', ') || 'skipped'}`);
  console.log(`  - Zoom views: ${zoomViews.map(z => z.context).join(', ')}`);
  console.log(`  - Game state: gamestate_${seed}.json`);

  // Open output
  const { exec } = require('child_process');
  const mainFile = npcs.length > 0 ? `final_${seed}.png` : (skipPaint ? `segment_${seed}.png` : `painted_${seed}.png`);
  exec(`open "${path.join(outputDir, mainFile)}"`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
