/**
 * Generate test segmentation maps for AI rendering experiments
 */
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

// ADE20K colors
const ADE20K = {
  TREE: '#04C803',
  GRASS: '#04FA07',
  WATER: '#3DE6FA',
  SEA: '#0907E6',
  MOUNTAIN: '#8FFF8C',
  SAND: '#A09614',
  ROAD: '#8C8C8C',
  BUILDING: '#B47878',
  EARTH: '#787846',
  ROCK: '#FF290A'
};

// Simple test map layout (isometric diamond pattern)
function generateTestMap(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  // Map dimensions in tiles
  const mapW = 24;
  const mapH = 18;

  // Tile size scaled to fit
  const tileW = size / (mapW + mapH) * 1.8;
  const tileH = tileW / 2;

  // Center offset
  const ox = size / 2;
  const oy = size / 2 - (mapH * tileH / 2);

  // Simple terrain pattern
  const terrain = [];
  for (let y = 0; y < mapH; y++) {
    terrain[y] = [];
    for (let x = 0; x < mapW; x++) {
      // Create varied terrain
      const distFromCenter = Math.sqrt(Math.pow(x - mapW/2, 2) + Math.pow(y - mapH/2, 2));
      const noise = Math.sin(x * 0.5) * Math.cos(y * 0.5);

      let color;
      if (distFromCenter > Math.min(mapW, mapH) * 0.45) {
        // Edges - water
        color = distFromCenter > Math.min(mapW, mapH) * 0.48 ? ADE20K.SEA : ADE20K.WATER;
      } else if (x >= 10 && x <= 14 && y >= 7 && y <= 11) {
        // Center village area
        if ((x + y) % 3 === 0) color = ADE20K.BUILDING;
        else if ((x + y) % 2 === 0) color = ADE20K.ROAD;
        else color = ADE20K.GRASS;
      } else if (noise > 0.3) {
        // Forest clusters
        color = ADE20K.TREE;
      } else if (noise < -0.3) {
        // Hills/mountains
        color = noise < -0.5 ? ADE20K.MOUNTAIN : ADE20K.EARTH;
      } else if (y < 3 || y > mapH - 4) {
        // Sand near water edges
        color = ADE20K.SAND;
      } else {
        // Default grass
        color = ADE20K.GRASS;
      }

      terrain[y][x] = color;
    }
  }

  // Add a road
  for (let i = 0; i < mapW; i++) {
    if (terrain[Math.floor(mapH/2)]) {
      terrain[Math.floor(mapH/2)][i] = ADE20K.ROAD;
    }
  }

  // Render isometric tiles
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const color = terrain[y][x];

      // Isometric position
      const ix = (x - y) * (tileW / 2) + ox;
      const iy = (x + y) * (tileH / 2) + oy;

      // Draw diamond
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + tileW / 2, iy + tileH / 2);
      ctx.lineTo(ix, iy + tileH);
      ctx.lineTo(ix - tileW / 2, iy + tileH / 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  return canvas;
}

// Generate test images
const outputDir = path.join(__dirname, 'test-renders');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const sizes = [512, 768, 1024];
for (const size of sizes) {
  const canvas = generateTestMap(size);
  const buffer = canvas.toBuffer('image/png');
  const filename = path.join(outputDir, `segmentation_${size}x${size}.png`);
  fs.writeFileSync(filename, buffer);
  console.log(`Generated: ${filename}`);
}

console.log('\nDone! Test images saved to test-renders/');
