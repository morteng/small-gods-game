/**
 * Small Gods - Isometric Renderer
 * Renders tiles with trees, flowers, and terrain features
 * All control images use same 1:1 tile scale
 */

// Rendering constants - fixed tile size for 1:1 scale
const TILE_WIDTH = 32;
const TILE_HEIGHT = 16;
const MAP_PADDING = 40;
const BG_COLOR = '#1a1a2e';
const AI_SIZE = 1024;  // Output size for AI models

// =============================================================================
// UNIFIED 1:1 SCALE RENDERING
// =============================================================================

/**
 * Calculate isometric position for a tile at 1:1 scale
 */
function getTileIsoPosition(x, y, centerX, centerY) {
  const ix = (x - y) * (TILE_WIDTH / 2);
  const iy = (x + y) * (TILE_HEIGHT / 2);
  // Offset to center the view
  return {
    x: ix + centerX,
    y: iy + centerY
  };
}

/**
 * Get the bounding box height extension for objects on a tile
 * Returns how many pixels above the tile center the object extends
 */
function getObjectExtent(tt, seed) {
  // Trees extend upward
  if (tt.tree) {
    if (tt.treeType === 'pine') {
      return 20; // Pine trees are taller
    } else if (tt.treeType === 'dead' || tt.treeType === 'swamp') {
      return 14; // Dead trees are shorter
    } else {
      return 16 + (seed % 6); // Regular trees
    }
  }

  // Buildings extend upward
  if (tt.category === 'building') {
    return 22 + (seed % 4); // Building + roof height
  }

  // Mountains extend upward significantly
  if (tt.id === 'mountain' || tt.id === 'peak') {
    return 26 + (seed % 8);
  }

  // Rocky terrain has small rocks
  if (tt.id === 'rocky' || tt.id === 'cliffs') {
    return 6;
  }

  // Reeds extend upward slightly
  if (tt.category === 'wetland' && !tt.tree) {
    return 10;
  }

  return 0; // No object extension
}

/**
 * Render segmentation map at 1:1 tile scale, centered on map
 * All tiles use fixed TILE_WIDTH x TILE_HEIGHT
 * Objects on tiles extend the segmentation area upward
 */
function renderSegmentationMap(map, outputSize = AI_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  // Fill background with deep ocean
  ctx.fillStyle = '#0907E6';  // ADE20K SEA color
  ctx.fillRect(0, 0, outputSize, outputSize);

  // Calculate map center in isometric space
  const mapCenterX = (map.width - 1) / 2;
  const mapCenterY = (map.height - 1) / 2;

  // Center of canvas - offset to center the map
  const centerIsoX = (mapCenterX - mapCenterY) * (TILE_WIDTH / 2);
  const centerIsoY = (mapCenterX + mapCenterY) * (TILE_HEIGHT / 2);

  // Offset to put map center at canvas center
  const offsetX = outputSize / 2 - centerIsoX;
  const offsetY = outputSize / 2 - centerIsoY;

  // Render each tile - draw in back-to-front order so objects overlap correctly
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const tt = TileTypes?.[tile.type];
      if (!tt) continue;

      // Use segColor for ControlNet, fall back to regular color
      const color = tt.segColor || tt.color || '#04FA07';

      // Calculate position at 1:1 scale
      const ix = (x - y) * (TILE_WIDTH / 2) + offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + offsetY;

      // Get object extent (how high objects extend above tile)
      const seed = (tile.x || x) * 1000 + (tile.y || y);
      const objectExtent = getObjectExtent(tt, seed);
      const heightPx = Math.min((tt.height || 0) / 4, 8);

      ctx.fillStyle = color;

      if (objectExtent > 0) {
        // Draw extended shape: base tile diamond + upward extension for object
        // The anchor point is at tile center (iy + th/2 - heightPx)
        const anchorY = iy + TILE_HEIGHT / 2 - heightPx;
        const objectTop = anchorY - objectExtent;
        const objectWidth = TILE_WIDTH * 0.6; // Object is narrower than tile

        ctx.beginPath();
        // Start at top-left of object bounds
        ctx.moveTo(ix - objectWidth / 2, objectTop);
        // Top edge of object
        ctx.lineTo(ix + objectWidth / 2, objectTop);
        // Right side down to tile right corner
        ctx.lineTo(ix + objectWidth / 2, iy);
        ctx.lineTo(ix + TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
        // Bottom of tile
        ctx.lineTo(ix, iy + TILE_HEIGHT);
        // Left side of tile
        ctx.lineTo(ix - TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
        // Up to left side of object
        ctx.lineTo(ix - objectWidth / 2, iy);
        ctx.closePath();
        ctx.fill();
      } else {
        // Draw flat diamond at fixed tile size (no object)
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.lineTo(ix + TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
        ctx.lineTo(ix, iy + TILE_HEIGHT);
        ctx.lineTo(ix - TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  return canvas;
}

/**
 * Render edge map at 1:1 tile scale (for canny ControlNet)
 * White outlines on black background, same positioning as segmentation
 */
function renderEdgeMap(map, outputSize = AI_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  // Black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, outputSize, outputSize);

  // Same centering calculation as segmentation
  const mapCenterX = (map.width - 1) / 2;
  const mapCenterY = (map.height - 1) / 2;
  const centerIsoX = (mapCenterX - mapCenterY) * (TILE_WIDTH / 2);
  const centerIsoY = (mapCenterX + mapCenterY) * (TILE_HEIGHT / 2);
  const offsetX = outputSize / 2 - centerIsoX;
  const offsetY = outputSize / 2 - centerIsoY;

  // Draw white outlines for each tile
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const ix = (x - y) * (TILE_WIDTH / 2) + offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + offsetY;

      // Draw diamond outline at fixed tile size
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ix + TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
      ctx.lineTo(ix, iy + TILE_HEIGHT);
      ctx.lineTo(ix - TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
      ctx.closePath();
      ctx.stroke();
    }
  }

  return canvas;
}

// =============================================================================
// DISPLAY RENDERING (with decorations) - Same 1024x1024 size as control images
// =============================================================================

function renderMap(map, outputSize = AI_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  // Same dark background as before
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, outputSize, outputSize);

  // Use same centering calculation as segmentation map
  const mapCenterX = (map.width - 1) / 2;
  const mapCenterY = (map.height - 1) / 2;
  const centerIsoX = (mapCenterX - mapCenterY) * (TILE_WIDTH / 2);
  const centerIsoY = (mapCenterX + mapCenterY) * (TILE_HEIGHT / 2);
  const offsetX = outputSize / 2 - centerIsoX;
  const offsetY = outputSize / 2 - centerIsoY;

  // Render back to front at 1:1 tile scale
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const tt = TileTypes?.[tile.type];
      if (!tt) continue;

      const ix = (x - y) * (TILE_WIDTH / 2) + offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + offsetY;

      drawTile(ctx, ix, iy, TILE_WIDTH, TILE_HEIGHT, tt, tile);
    }
  }

  return canvas;
}

function drawTile(ctx, ix, iy, tw, th, tt, tile) {
  const color = tt.color || '#808080';
  const dark = darken(color, 0.2);
  const light = lighten(color, 0.1);
  const height = tt.height || 0;
  const heightPx = Math.min(height / 4, 8); // Scale height to pixels

  // Top face
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ix, iy - heightPx);
  ctx.lineTo(ix + tw / 2, iy + th / 2 - heightPx);
  ctx.lineTo(ix, iy + th - heightPx);
  ctx.lineTo(ix - tw / 2, iy + th / 2 - heightPx);
  ctx.closePath();
  ctx.fill();

  // Left face (side)
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(ix - tw / 2, iy + th / 2 - heightPx);
  ctx.lineTo(ix, iy + th - heightPx);
  ctx.lineTo(ix, iy + th + 4);
  ctx.lineTo(ix - tw / 2, iy + th / 2 + 4);
  ctx.closePath();
  ctx.fill();

  // Right face (side)
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(ix + tw / 2, iy + th / 2 - heightPx);
  ctx.lineTo(ix, iy + th - heightPx);
  ctx.lineTo(ix, iy + th + 4);
  ctx.lineTo(ix + tw / 2, iy + th / 2 + 4);
  ctx.closePath();
  ctx.fill();

  // Draw decorations based on tile properties
  const seed = (tile.x || 0) * 1000 + (tile.y || 0);
  // Anchor point: center of tile top face (middle of the diamond)
  const anchorY = iy + th / 2 - heightPx;

  // Trees - anchor at tile center, tree grows upward from there
  if (tt.tree) {
    if (tt.treeType === 'pine') {
      drawPine(ctx, ix, anchorY, tw, seed);
    } else if (tt.treeType === 'dead' || tt.treeType === 'swamp') {
      drawDeadTree(ctx, ix, anchorY, tw, seed);
    } else {
      drawTree(ctx, ix, anchorY, tw, seed, tt.color);
    }
  }

  // Flowers - scatter around tile center
  if (tt.flowers) {
    drawFlowers(ctx, ix, anchorY, tw, th, seed);
  }

  // Buildings - anchor at tile center
  if (tt.category === 'building') {
    drawBuilding(ctx, ix, anchorY, tw, th, seed, tt.color);
  }

  // Water effects - at tile center
  if (tt.category === 'water') {
    drawWater(ctx, ix, anchorY, tw, th, seed);
  }

  // Wetland reeds - at tile center
  if (tt.category === 'wetland' && !tt.tree) {
    drawReeds(ctx, ix, anchorY, tw, th, seed);
  }

  // Mountain peaks - anchor at tile center
  if (tt.id === 'mountain' || tt.id === 'peak') {
    drawMountain(ctx, ix, anchorY, tw, seed);
  }

  // Rocky terrain - at tile center
  if (tt.id === 'rocky' || tt.id === 'cliffs') {
    drawRocks(ctx, ix, anchorY, tw, th, seed);
  }
}

function drawDecoration(ctx, ix, iy, tw, th, deco, tile, tt) {
  const seed = (tile.x || 0) * 1000 + (tile.y || 0);

  if (deco === 'tree') {
    drawTree(ctx, ix, iy - 2, tw, seed, tt.color);
  } else if (deco === 'pine') {
    drawPine(ctx, ix, iy - 2, tw, seed);
  } else if (deco === 'dead_tree') {
    drawDeadTree(ctx, ix, iy - 2, tw, seed);
  } else if (deco === 'flower') {
    drawFlowers(ctx, ix, iy, tw, th, seed);
  } else if (deco === 'rock') {
    drawRocks(ctx, ix, iy, tw, th, seed);
  } else if (deco === 'reeds') {
    drawReeds(ctx, ix, iy, tw, th, seed);
  } else if (deco === 'building') {
    drawBuilding(ctx, ix, iy, tw, th, seed, tt.color);
  } else if (deco === 'water') {
    drawWater(ctx, ix, iy, tw, th, seed);
  } else if (deco === 'mountain') {
    drawMountain(ctx, ix, iy - 4, tw, seed);
  }
}

function drawTree(ctx, x, y, tw, seed, baseColor) {
  const h = 12 + (seed % 6);
  const trunkColor = '#5D4037';
  const leafColor = baseColor || '#228B22';

  ctx.fillStyle = trunkColor;
  ctx.fillRect(x - 2, y - h / 2, 4, h / 2 + 4);

  ctx.fillStyle = leafColor;
  ctx.beginPath();
  ctx.arc(x, y - h + 4, tw / 3 + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = darken(leafColor, 0.15);
  ctx.beginPath();
  ctx.arc(x - 3, y - h + 6, tw / 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPine(ctx, x, y, tw, seed) {
  const h = 16 + (seed % 6);
  ctx.fillStyle = '#4A3728';
  ctx.fillRect(x - 2, y - 4, 4, 8);

  ctx.fillStyle = '#1B5E20';
  for (let i = 0; i < 3; i++) {
    const w = (tw / 2) * (1 - i * 0.25);
    const yy = y - 4 - i * 5;
    ctx.beginPath();
    ctx.moveTo(x, yy - 6);
    ctx.lineTo(x + w, yy);
    ctx.lineTo(x - w, yy);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDeadTree(ctx, x, y, tw, seed) {
  ctx.strokeStyle = '#5D4037';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 14);
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x - 6, y - 14);
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x + 5, y - 12);
  ctx.stroke();
}

function drawFlowers(ctx, x, y, tw, th, seed) {
  const colors = ['#FF6B6B', '#FFE66D', '#4ECDC4', '#FF69B4', '#DDA0DD'];
  for (let i = 0; i < 3; i++) {
    const fx = x + ((seed + i * 7) % 12) - 6;
    const fy = y + ((seed + i * 3) % 8) - 2;
    ctx.fillStyle = colors[(seed + i) % colors.length];
    ctx.beginPath();
    ctx.arc(fx, fy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRocks(ctx, x, y, tw, th, seed) {
  ctx.fillStyle = '#757575';
  const rx = x + (seed % 8) - 4;
  const ry = y + (seed % 6) - 2;
  ctx.beginPath();
  ctx.ellipse(rx, ry, 4 + (seed % 3), 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#616161';
  ctx.beginPath();
  ctx.ellipse(rx - 1, ry + 1, 2, 1.5, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawReeds(ctx, x, y, tw, th, seed) {
  ctx.strokeStyle = '#8D6E63';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const rx = x + (i * 4) - 6;
    const h = 6 + (seed + i) % 4;
    ctx.beginPath();
    ctx.moveTo(rx, y + 2);
    ctx.quadraticCurveTo(rx + (i % 2 ? 2 : -2), y - h / 2, rx, y - h);
    ctx.stroke();
  }
}

function drawBuilding(ctx, x, y, tw, th, seed, baseColor) {
  const w = tw * 0.7;
  const h = 14 + (seed % 4);
  const wallColor = baseColor || '#D4A574';
  const roofColor = '#8B4513';

  // Walls
  ctx.fillStyle = wallColor;
  ctx.fillRect(x - w / 2, y - h, w, h);

  // Roof
  ctx.fillStyle = roofColor;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, y - h);
  ctx.lineTo(x, y - h - 8);
  ctx.lineTo(x + w / 2 + 2, y - h);
  ctx.closePath();
  ctx.fill();

  // Door
  ctx.fillStyle = '#5D4037';
  ctx.fillRect(x - 2, y - 6, 4, 6);

  // Window
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(x - w / 4 - 2, y - h + 3, 3, 3);
}

function drawWater(ctx, x, y, tw, th, seed) {
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  for (let i = 0; i < 2; i++) {
    const wx = x + ((seed + i * 5) % 10) - 5;
    const wy = y + ((seed + i * 3) % 6) - 1;
    ctx.beginPath();
    ctx.ellipse(wx, wy, 3, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMountain(ctx, x, y, tw, seed) {
  const h = 18 + (seed % 8);
  ctx.fillStyle = '#607D8B';
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + tw / 2, y);
  ctx.lineTo(x - tw / 2, y);
  ctx.closePath();
  ctx.fill();

  // Snow cap
  ctx.fillStyle = '#ECEFF1';
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + tw / 6, y - h + 6);
  ctx.lineTo(x - tw / 6, y - h + 6);
  ctx.closePath();
  ctx.fill();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function darken(hex, amount) {
  const rgb = hexToRgb(hex);
  return `rgb(${Math.floor(rgb.r * (1 - amount))},${Math.floor(rgb.g * (1 - amount))},${Math.floor(rgb.b * (1 - amount))})`;
}

function lighten(hex, amount) {
  const rgb = hexToRgb(hex);
  return `rgb(${Math.min(255, Math.floor(rgb.r * (1 + amount)))},${Math.min(255, Math.floor(rgb.g * (1 + amount)))},${Math.min(255, Math.floor(rgb.b * (1 + amount)))})`;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 128, g: 128, b: 128 };
}

function getMapOffsets(map) {
  const tw = TILE_WIDTH, th = TILE_HEIGHT;
  const isoWidth = (map.width + map.height) * (tw / 2);
  const isoHeight = (map.width + map.height) * (th / 2) + 50;
  const canvasWidth = isoWidth + MAP_PADDING * 2;
  const canvasHeight = isoHeight + MAP_PADDING * 2;
  const ox = canvasWidth / 2;
  const oy = MAP_PADDING + map.height * (th / 2);
  return { tw, th, ox, oy, canvasWidth, canvasHeight };
}

// Export for use in other files
window.renderMap = renderMap;
window.renderSegmentationMap = renderSegmentationMap;
window.renderEdgeMap = renderEdgeMap;
window.getMapOffsets = getMapOffsets;
window.TILE_WIDTH = TILE_WIDTH;
window.TILE_HEIGHT = TILE_HEIGHT;
window.AI_SIZE = AI_SIZE;
