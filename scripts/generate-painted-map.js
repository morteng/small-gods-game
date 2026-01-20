/**
 * Generate Painted Map using Fal.ai ControlNet API
 *
 * This script takes a segment map and generates a painted version using AI.
 *
 * Usage:
 *   node generate-painted-map.js [segment-map-path] [output-path]
 *
 * Example:
 *   node generate-painted-map.js ../prototypes/segment_map.png ./painted_map.png
 */

const fs = require('fs');
const path = require('path');

// Fal.ai API configuration
const FAL_API_KEY = process.env.FAL_KEY || 'cdc493d8-d227-4d35-a3db-e68bd477681e:2b8f05a83b898c023ead77c6d2aaee40';
const FAL_API_URL = 'https://fal.run/fal-ai/z-image/turbo/controlnet';

// Default prompt for fantasy isometric maps
const DEFAULT_PROMPT = `Fantasy isometric world map, highly detailed painterly style,
lush green grass, dense forests with tall trees, crystal clear blue water,
sandy beaches, medieval village with wooden and stone buildings,
dirt roads connecting buildings, magical atmosphere, warm golden daylight,
cohesive art direction, professional game asset quality,
Studio Ghibli inspired, whimsical yet grounded`;

/**
 * Convert an image file to base64 data URL
 */
function imageToBase64(filePath) {
  const absolutePath = path.resolve(filePath);
  const imageBuffer = fs.readFileSync(absolutePath);
  const base64 = imageBuffer.toString('base64');
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Save base64 image data to file
 */
function saveBase64Image(base64Data, outputPath) {
  // Remove data URL prefix if present
  const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(outputPath, buffer);
  console.log(`Saved painted map to: ${outputPath}`);
}

/**
 * Download image from URL and save to file
 */
async function downloadImage(url, outputPath) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Saved painted map to: ${outputPath}`);
}

/**
 * Generate painted map using Fal.ai ControlNet API
 */
async function generatePaintedMap(segmentMapPath, options = {}) {
  const {
    prompt = DEFAULT_PROMPT,
    controlScale = 0.75,
    seed = Math.floor(Math.random() * 1000000),
  } = options;

  console.log('Loading segment map...');
  const imageDataUrl = imageToBase64(segmentMapPath);

  console.log('Calling Fal.ai API...');
  console.log(`  - Prompt: ${prompt.substring(0, 50)}...`);
  console.log(`  - Control Scale: ${controlScale}`);
  console.log(`  - Seed: ${seed}`);

  const requestBody = {
    prompt: prompt,
    image_url: imageDataUrl,
    controlnet_conditioning_scale: controlScale,
    seed: seed,
    num_inference_steps: 8, // Turbo model uses fewer steps
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

  const result = await response.json();

  if (result.images && result.images.length > 0) {
    return {
      success: true,
      imageUrl: result.images[0].url,
      seed: result.seed || seed,
    };
  } else {
    throw new Error('No image returned from API');
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  // Default paths
  let segmentMapPath = args[0] || './segment_map.png';
  let outputPath = args[1] || './painted_map.png';

  // Check if segment map exists
  if (!fs.existsSync(segmentMapPath)) {
    console.error(`Error: Segment map not found at ${segmentMapPath}`);
    console.log('\nUsage: node generate-painted-map.js [segment-map-path] [output-path]');
    console.log('\nTo generate a segment map:');
    console.log('  1. Open http://localhost:8765/map-generator.html');
    console.log('  2. Click "Download Segment Map PNG"');
    console.log('  3. Run this script with the downloaded file path');
    process.exit(1);
  }

  console.log('='.repeat(50));
  console.log('Small Gods - AI Map Painter');
  console.log('='.repeat(50));
  console.log(`Input:  ${segmentMapPath}`);
  console.log(`Output: ${outputPath}`);
  console.log('');

  try {
    const startTime = Date.now();

    const result = await generatePaintedMap(segmentMapPath, {
      prompt: DEFAULT_PROMPT,
      controlScale: 0.75,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nGeneration complete in ${elapsed}s`);
    console.log(`Seed: ${result.seed}`);

    // Download and save the image
    await downloadImage(result.imageUrl, outputPath);

    console.log('\n✓ Success! Open the painted map to see the result.');

  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
main();
