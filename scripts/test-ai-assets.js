#!/usr/bin/env node
/**
 * Small Gods - AI Asset Generation Test
 *
 * Tests the AI asset generation pipeline:
 * - NPC generation with rd-animation
 * - Zoom view generation with rd-plus
 * - Scene segmentation with SAM 2
 *
 * Usage:
 *   node scripts/test-ai-assets.js [--npc] [--zoom] [--all]
 *   --token=YOUR_TOKEN (or set REPLICATE_API_TOKEN env var)
 */

const fs = require('fs');
const path = require('path');

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ||
  process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

const runNPC = process.argv.includes('--npc') || process.argv.includes('--all');
const runZoom = process.argv.includes('--zoom') || process.argv.includes('--all');
const runAll = process.argv.includes('--all') || (!runNPC && !runZoom);

async function replicatePredict(modelOwner, modelName, input) {
  // First, get the latest version
  const modelResponse = await fetch(
    `https://api.replicate.com/v1/models/${modelOwner}/${modelName}`,
    { headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` } }
  );

  if (!modelResponse.ok) {
    throw new Error(`Failed to get model: ${await modelResponse.text()}`);
  }

  const model = await modelResponse.json();
  const version = model.latest_version?.id;

  if (!version) {
    throw new Error('No version found for model');
  }

  // Create prediction
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version, input }),
  });

  if (!createResponse.ok) {
    throw new Error(`Prediction failed: ${await createResponse.text()}`);
  }

  const prediction = await createResponse.json();

  // Poll for result
  let result = prediction;
  let dots = 0;

  while (result.status !== 'succeeded' && result.status !== 'failed') {
    await new Promise(r => setTimeout(r, 2000));
    dots++;
    process.stdout.write(`\r   Processing${'.'.repeat(dots % 4).padEnd(3)}`);

    const pollResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { 'Authorization': `Token ${REPLICATE_TOKEN}` } }
    );
    result = await pollResponse.json();
  }
  console.log('');

  if (result.status === 'failed') {
    throw new Error(`Prediction failed: ${result.error}`);
  }

  return result.output;
}

async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  return buffer;
}

async function testNPCGeneration() {
  console.log('\n' + '═'.repeat(50));
  console.log('Testing NPC Generation (rd-animation)');
  console.log('═'.repeat(50));

  const npcs = [
    { prompt: 'medieval peasant farmer with pitchfork', name: 'peasant' },
    { prompt: 'wizard in blue robe with staff', name: 'wizard' },
    { prompt: 'town guard in chainmail with spear', name: 'guard' }
  ];

  const outputDir = path.join(__dirname, '../output/npcs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const npc of npcs) {
    console.log(`\nGenerating: ${npc.name}`);
    console.log(`   Prompt: ${npc.prompt}`);

    try {
      const result = await replicatePredict('retro-diffusion', 'rd-animation', {
        prompt: npc.prompt,
        style: 'four_angle_walking',
        width: 48,
        height: 48,
        return_spritesheet: true
      });

      const imageUrl = Array.isArray(result) ? result[0] : result;
      const outputPath = path.join(outputDir, `${npc.name}_spritesheet.png`);

      await downloadImage(imageUrl, outputPath);
      console.log(`   ✓ Saved: ${outputPath}`);
    } catch (error) {
      console.error(`   ✗ Error: ${error.message}`);
    }
  }

  return outputDir;
}

async function testZoomViewGeneration() {
  console.log('\n' + '═'.repeat(50));
  console.log('Testing Zoom View Generation (rd-plus)');
  console.log('═'.repeat(50));

  const views = [
    {
      prompt: 'isometric medieval village square, cobblestone, thatched cottages, market stalls, wooden carts',
      name: 'village_square',
      style: 'isometric'
    },
    {
      prompt: 'isometric forest clearing, tall oak trees, dappled sunlight, mushrooms, moss covered rocks',
      name: 'forest_clearing',
      style: 'isometric'
    },
    {
      prompt: 'isometric lake shore, crystal blue water, wooden dock, small boat, reeds',
      name: 'lake_shore',
      style: 'isometric'
    }
  ];

  const outputDir = path.join(__dirname, '../output/zoom_views');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const generatedViews = [];

  for (const view of views) {
    console.log(`\nGenerating: ${view.name}`);
    console.log(`   Prompt: ${view.prompt.substring(0, 50)}...`);

    try {
      const result = await replicatePredict('retro-diffusion', 'rd-plus', {
        prompt: view.prompt,
        style: view.style,
        width: 384,
        height: 384,
        num_images: 1
      });

      const imageUrl = Array.isArray(result) ? result[0] : result;
      const outputPath = path.join(outputDir, `${view.name}.png`);

      await downloadImage(imageUrl, outputPath);
      console.log(`   ✓ Saved: ${outputPath}`);

      generatedViews.push({ ...view, imageUrl, outputPath });
    } catch (error) {
      console.error(`   ✗ Error: ${error.message}`);
    }
  }

  return generatedViews;
}

async function testSegmentation(imageUrl, imageName) {
  console.log('\n' + '═'.repeat(50));
  console.log('Testing Segmentation (SAM 2)');
  console.log('═'.repeat(50));

  console.log(`\nSegmenting: ${imageName}`);

  const outputDir = path.join(__dirname, '../output/segmentation');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    const result = await replicatePredict('meta', 'sam-2', {
      image: imageUrl,
      points_per_side: 32,
      pred_iou_thresh: 0.88,
      stability_score_thresh: 0.95,
      use_m2m: true
    });

    // SAM 2 returns combined_mask and individual masks
    if (result.combined_mask) {
      const combinedPath = path.join(outputDir, `${imageName}_combined_mask.png`);
      await downloadImage(result.combined_mask, combinedPath);
      console.log(`   ✓ Combined mask saved: ${combinedPath}`);
    }

    // Save a few individual masks
    if (result.individual_masks && result.individual_masks.length > 0) {
      console.log(`   Found ${result.individual_masks.length} individual masks`);

      const maxMasks = Math.min(5, result.individual_masks.length);
      for (let i = 0; i < maxMasks; i++) {
        const maskPath = path.join(outputDir, `${imageName}_mask_${i}.png`);
        await downloadImage(result.individual_masks[i], maskPath);
      }
      console.log(`   ✓ Saved first ${maxMasks} individual masks`);
    }

    return result;
  } catch (error) {
    console.error(`   ✗ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  if (!REPLICATE_TOKEN) {
    console.error('Error: REPLICATE_API_TOKEN not set');
    console.log('Set environment variable or use --token=YOUR_TOKEN');
    process.exit(1);
  }

  console.log('═'.repeat(60));
  console.log('Small Gods - AI Asset Generation Test');
  console.log('═'.repeat(60));
  console.log(`Tests: NPC=${runNPC || runAll}, Zoom=${runZoom || runAll}`);

  let zoomViews = [];

  // Test NPC generation
  if (runNPC || runAll) {
    await testNPCGeneration();
  }

  // Test zoom view generation
  if (runZoom || runAll) {
    zoomViews = await testZoomViewGeneration();

    // If we have zoom views, test segmentation on one of them
    if (zoomViews.length > 0) {
      await testSegmentation(zoomViews[0].imageUrl, zoomViews[0].name);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('Complete!');
  console.log('═'.repeat(60));
  console.log('\nGenerated files in:');
  console.log('  - output/npcs/');
  console.log('  - output/zoom_views/');
  console.log('  - output/segmentation/');

  // Open output folder
  const { exec } = require('child_process');
  exec('open output/');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
