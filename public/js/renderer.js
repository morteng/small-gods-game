/**
 * Small Gods - Isometric Renderer
 * Renders tiles with trees, flowers, and terrain features
 * All control images use same 1:1 tile scale
 */

// =============================================================================
// CONSTANTS (use shared constants if available, otherwise defaults)
// =============================================================================

const TILE_WIDTH = window.RENDER_CONFIG?.TILE_WIDTH || 32;
const TILE_HEIGHT = window.RENDER_CONFIG?.TILE_HEIGHT || 16;
const MAP_PADDING = 40;
const BG_COLOR = window.RENDER_CONFIG?.BG_COLOR || '#1a1a2e';
const AI_SIZE = window.SLICE_CONFIG?.SIZE || 512;

// Segmentation colors - use shared constants
const SEG_BACKGROUND = window.RENDER_CONFIG?.SEG_BACKGROUND || '#0907E6';
const DEFAULT_SEG_COLOR = window.RENDER_CONFIG?.DEFAULT_SEG_COLOR || '#04FA07';
const VISIBILITY_BUFFER = window.RENDER_CONFIG?.VISIBILITY_BUFFER || 50;
const VISIBILITY_BUFFER_TOP = window.RENDER_CONFIG?.VISIBILITY_BUFFER_TOP || 40;

// =============================================================================
// ISOMETRIC BOUNDS CALCULATION
// =============================================================================

/**
 * Calculate exact isometric bounds for a map
 * Returns the pixel dimensions and offsets for 1:1 rendering
 */
function getMapIsoBounds(map) {
  const W = map.width;
  const H = map.height;
  const tw = TILE_WIDTH;
  const th = TILE_HEIGHT;

  const minIsoX = -H * (tw / 2);
  const maxIsoX = W * (tw / 2);
  const minIsoY = 0;
  const baseMaxY = (W + H - 2) * (th / 2) + th;
  const objectPadding = 30;
  const maxIsoY = baseMaxY + objectPadding;

  const isoWidth = maxIsoX - minIsoX;
  const isoHeight = maxIsoY - minIsoY;

  return {
    minX: minIsoX,
    maxX: maxIsoX,
    minY: minIsoY,
    maxY: maxIsoY,
    width: Math.ceil(isoWidth),
    height: Math.ceil(isoHeight),
    offsetX: -minIsoX,
    offsetY: -minIsoY + objectPadding
  };
}

/**
 * Calculate centering offsets for a fixed-size canvas
 */
function getCenteringOffsets(map, canvasSize) {
  const mapCenterX = (map.width - 1) / 2;
  const mapCenterY = (map.height - 1) / 2;
  const centerIsoX = (mapCenterX - mapCenterY) * (TILE_WIDTH / 2);
  const centerIsoY = (mapCenterX + mapCenterY) * (TILE_HEIGHT / 2);
  return {
    offsetX: canvasSize / 2 - centerIsoX,
    offsetY: canvasSize / 2 - centerIsoY
  };
}

// =============================================================================
// SLICE CONFIGURATION
// =============================================================================

/**
 * Determine if slicing is needed and calculate slice configuration
 */
function getSliceConfig(map, aiSize = AI_SIZE) {
  const bounds = getMapIsoBounds(map);
  const padding = 20;
  const fullWidth = bounds.width + padding * 2;
  const fullHeight = bounds.height + padding * 2;

  if (fullWidth <= aiSize && fullHeight <= aiSize) {
    return {
      needsSlicing: false,
      slices: [{
        id: 0, x: 0, y: 0,
        width: aiSize, height: aiSize,
        srcX: 0, srcY: 0
      }],
      fullWidth: aiSize,
      fullHeight: aiSize,
      mapOffsetX: (aiSize - fullWidth) / 2 + padding + bounds.offsetX,
      mapOffsetY: (aiSize - fullHeight) / 2 + padding + bounds.offsetY
    };
  }

  const overlap = window.SLICE_CONFIG?.OVERLAP || 64;
  const sliceSize = aiSize;
  const effectiveSliceSize = sliceSize - overlap;

  const cols = Math.ceil(fullWidth / effectiveSliceSize);
  const rows = Math.ceil(fullHeight / effectiveSliceSize);
  const adjustedWidth = cols * effectiveSliceSize + overlap;
  const adjustedHeight = rows * effectiveSliceSize + overlap;

  const slices = [];
  let id = 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slices.push({
        id: id++, col, row,
        x: col * effectiveSliceSize,
        y: row * effectiveSliceSize,
        width: sliceSize,
        height: sliceSize,
        srcX: col * effectiveSliceSize,
        srcY: row * effectiveSliceSize
      });
    }
  }

  return {
    needsSlicing: true,
    slices, cols, rows, overlap,
    fullWidth: adjustedWidth,
    fullHeight: adjustedHeight,
    mapOffsetX: (adjustedWidth - fullWidth) / 2 + padding + bounds.offsetX,
    mapOffsetY: (adjustedHeight - fullHeight) / 2 + padding + bounds.offsetY
  };
}

// =============================================================================
// CORE RENDERING HELPERS (consolidated, no duplication)
// =============================================================================

/**
 * Get the bounding box height extension for objects on a tile
 */
function getObjectExtent(tt, seed) {
  if (tt.tree) {
    if (tt.treeType === 'pine') return 20;
    if (tt.treeType === 'dead' || tt.treeType === 'swamp') return 14;
    return 16 + (seed % 6);
  }
  if (tt.category === 'building') return 22 + (seed % 4);
  if (tt.id === 'mountain' || tt.id === 'peak') return 26 + (seed % 8);
  if (tt.id === 'rocky' || tt.id === 'cliffs') return 6;
  if (tt.category === 'wetland' && !tt.tree) return 10;
  return 0;
}

/**
 * Check if a tile is visible within a canvas region
 */
function isTileVisible(ix, iy, width, height) {
  return !(ix < -VISIBILITY_BUFFER || ix > width + VISIBILITY_BUFFER ||
           iy < -VISIBILITY_BUFFER - VISIBILITY_BUFFER_TOP || iy > height + VISIBILITY_BUFFER);
}

/**
 * Draw a flat isometric diamond shape
 */
function drawFlatDiamond(ctx, ix, iy) {
  ctx.beginPath();
  ctx.moveTo(ix, iy);
  ctx.lineTo(ix + TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
  ctx.lineTo(ix, iy + TILE_HEIGHT);
  ctx.lineTo(ix - TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw an extended shape for tiles with objects (trees, buildings, etc.)
 */
function drawExtendedShape(ctx, ix, iy, objectExtent, heightPx) {
  const anchorY = iy + TILE_HEIGHT / 2 - heightPx;
  const objectTop = anchorY - objectExtent;
  const objectWidth = TILE_WIDTH * 0.6;

  ctx.beginPath();
  ctx.moveTo(ix - objectWidth / 2, objectTop);
  ctx.lineTo(ix + objectWidth / 2, objectTop);
  ctx.lineTo(ix + objectWidth / 2, iy);
  ctx.lineTo(ix + TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
  ctx.lineTo(ix, iy + TILE_HEIGHT);
  ctx.lineTo(ix - TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
  ctx.lineTo(ix - objectWidth / 2, iy);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw a diamond outline for edge maps
 */
function drawDiamondOutline(ctx, ix, iy) {
  ctx.beginPath();
  ctx.moveTo(ix, iy);
  ctx.lineTo(ix + TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
  ctx.lineTo(ix, iy + TILE_HEIGHT);
  ctx.lineTo(ix - TILE_WIDTH / 2, iy + TILE_HEIGHT / 2);
  ctx.closePath();
  ctx.stroke();
}

// =============================================================================
// SEGMENTATION RENDERING (consolidated)
// =============================================================================

/**
 * Core segmentation rendering - used by all segmentation functions
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Object} map - Map data
 * @param {number} offsetX - X offset for positioning
 * @param {number} offsetY - Y offset for positioning
 * @param {number} [canvasWidth] - Canvas width for visibility culling (optional)
 * @param {number} [canvasHeight] - Canvas height for visibility culling (optional)
 */
function _renderSegmentationGeometry(ctx, map, offsetX, offsetY, canvasWidth, canvasHeight) {
  const shouldCull = canvasWidth !== undefined && canvasHeight !== undefined;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const tt = TileTypes?.[tile.type];
      if (!tt) continue;

      const ix = (x - y) * (TILE_WIDTH / 2) + offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + offsetY;

      // Visibility culling for sliced rendering
      if (shouldCull && !isTileVisible(ix, iy, canvasWidth, canvasHeight)) {
        continue;
      }

      // Color priority: segColor (ADE20K) > color > default
      const color = tt.segColor || tt.color || DEFAULT_SEG_COLOR;
      ctx.fillStyle = color;

      const seed = (tile.x || x) * 1000 + (tile.y || y);
      const objectExtent = getObjectExtent(tt, seed);
      const heightPx = Math.min((tt.height || 0) / 4, 8);

      if (objectExtent > 0) {
        drawExtendedShape(ctx, ix, iy, objectExtent, heightPx);
      } else {
        drawFlatDiamond(ctx, ix, iy);
      }
    }
  }
}

/**
 * Render segmentation map at fixed size (centered)
 */
function renderSegmentationMap(map, outputSize = AI_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = SEG_BACKGROUND;
  ctx.fillRect(0, 0, outputSize, outputSize);

  const { offsetX, offsetY } = getCenteringOffsets(map, outputSize);
  _renderSegmentationGeometry(ctx, map, offsetX, offsetY);

  return canvas;
}

/**
 * Render segmentation map at full resolution
 */
function renderSegmentationMapFullRes(map) {
  const bounds = getMapIsoBounds(map);
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = SEG_BACKGROUND;
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  _renderSegmentationGeometry(ctx, map, bounds.offsetX, bounds.offsetY);

  return canvas;
}

/**
 * Render segmentation for a single slice
 */
function renderSegmentationSlice(map, sliceConfig, sliceIndex) {
  const slice = sliceConfig.slices[sliceIndex];
  const canvas = document.createElement('canvas');
  canvas.width = slice.width;
  canvas.height = slice.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = SEG_BACKGROUND;
  ctx.fillRect(0, 0, slice.width, slice.height);

  const offsetX = sliceConfig.mapOffsetX - slice.x;
  const offsetY = sliceConfig.mapOffsetY - slice.y;

  _renderSegmentationGeometry(ctx, map, offsetX, offsetY, slice.width, slice.height);

  return canvas;
}

// =============================================================================
// EDGE MAP RENDERING (consolidated)
// =============================================================================

/**
 * Core edge rendering - used by all edge map functions
 */
function _renderEdgeGeometry(ctx, map, offsetX, offsetY, canvasWidth, canvasHeight) {
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;

  const shouldCull = canvasWidth !== undefined && canvasHeight !== undefined;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const ix = (x - y) * (TILE_WIDTH / 2) + offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + offsetY;

      if (shouldCull && !isTileVisible(ix, iy, canvasWidth, canvasHeight)) {
        continue;
      }

      drawDiamondOutline(ctx, ix, iy);
    }
  }
}

/**
 * Render edge map at fixed size (centered)
 */
function renderEdgeMap(map, outputSize = AI_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, outputSize, outputSize);

  const { offsetX, offsetY } = getCenteringOffsets(map, outputSize);
  _renderEdgeGeometry(ctx, map, offsetX, offsetY);

  return canvas;
}

/**
 * Render edge map at full resolution
 */
function renderEdgeMapFullRes(map) {
  const bounds = getMapIsoBounds(map);
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  _renderEdgeGeometry(ctx, map, bounds.offsetX, bounds.offsetY);

  return canvas;
}

/**
 * Render edge map for a single slice
 */
function renderEdgeMapSlice(map, sliceConfig, sliceIndex) {
  const slice = sliceConfig.slices[sliceIndex];
  const canvas = document.createElement('canvas');
  canvas.width = slice.width;
  canvas.height = slice.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, slice.width, slice.height);

  const offsetX = sliceConfig.mapOffsetX - slice.x;
  const offsetY = sliceConfig.mapOffsetY - slice.y;

  _renderEdgeGeometry(ctx, map, offsetX, offsetY, slice.width, slice.height);

  return canvas;
}

// =============================================================================
// BASE MAP RENDERING
// =============================================================================

/**
 * Render base map at fixed size (centered)
 */
function renderMap(map, outputSize = AI_SIZE) {
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, outputSize, outputSize);

  const { offsetX, offsetY } = getCenteringOffsets(map, outputSize);

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

/**
 * Render base map at full resolution
 */
function renderMapFullRes(map) {
  const bounds = getMapIsoBounds(map);
  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, bounds.width, bounds.height);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const tt = TileTypes?.[tile.type];
      if (!tt) continue;

      const ix = (x - y) * (TILE_WIDTH / 2) + bounds.offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + bounds.offsetY;

      drawTile(ctx, ix, iy, TILE_WIDTH, TILE_HEIGHT, tt, tile);
    }
  }

  return canvas;
}

/**
 * Render base map for a single slice
 */
function renderMapSlice(map, sliceConfig, sliceIndex) {
  const slice = sliceConfig.slices[sliceIndex];
  const canvas = document.createElement('canvas');
  canvas.width = slice.width;
  canvas.height = slice.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, slice.width, slice.height);

  const offsetX = sliceConfig.mapOffsetX - slice.x;
  const offsetY = sliceConfig.mapOffsetY - slice.y;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile) continue;

      const tt = TileTypes?.[tile.type];
      if (!tt) continue;

      const ix = (x - y) * (TILE_WIDTH / 2) + offsetX;
      const iy = (x + y) * (TILE_HEIGHT / 2) + offsetY;

      if (!isTileVisible(ix, iy, slice.width, slice.height)) {
        continue;
      }

      drawTile(ctx, ix, iy, TILE_WIDTH, TILE_HEIGHT, tt, tile);
    }
  }

  return canvas;
}

/**
 * Stitch painted slices back together
 */
function stitchSlices(paintedSlices, sliceConfig) {
  const canvas = document.createElement('canvas');
  canvas.width = sliceConfig.fullWidth;
  canvas.height = sliceConfig.fullHeight;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!sliceConfig.needsSlicing) {
    ctx.drawImage(paintedSlices[0], 0, 0);
    return canvas;
  }

  for (const slice of sliceConfig.slices) {
    const painted = paintedSlices[slice.id];
    if (!painted) continue;
    ctx.drawImage(painted, slice.x, slice.y);
  }

  return canvas;
}

// =============================================================================
// TILE DRAWING (with decorations)
// =============================================================================

function drawTile(ctx, ix, iy, tw, th, tt, tile) {
  const color = tt.color || '#808080';
  const dark = darken(color, 0.2);
  const light = lighten(color, 0.1);
  const height = tt.height || 0;
  const heightPx = Math.min(height / 4, 8);

  // Top face
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ix, iy - heightPx);
  ctx.lineTo(ix + tw / 2, iy + th / 2 - heightPx);
  ctx.lineTo(ix, iy + th - heightPx);
  ctx.lineTo(ix - tw / 2, iy + th / 2 - heightPx);
  ctx.closePath();
  ctx.fill();

  // Left face
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(ix - tw / 2, iy + th / 2 - heightPx);
  ctx.lineTo(ix, iy + th - heightPx);
  ctx.lineTo(ix, iy + th + 4);
  ctx.lineTo(ix - tw / 2, iy + th / 2 + 4);
  ctx.closePath();
  ctx.fill();

  // Right face
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(ix + tw / 2, iy + th / 2 - heightPx);
  ctx.lineTo(ix, iy + th - heightPx);
  ctx.lineTo(ix, iy + th + 4);
  ctx.lineTo(ix + tw / 2, iy + th / 2 + 4);
  ctx.closePath();
  ctx.fill();

  // Draw decorations
  const seed = (tile.x || 0) * 1000 + (tile.y || 0);
  const anchorY = iy + th / 2 - heightPx;

  if (tt.tree) {
    if (tt.treeType === 'pine') drawPine(ctx, ix, anchorY, tw, seed);
    else if (tt.treeType === 'dead' || tt.treeType === 'swamp') drawDeadTree(ctx, ix, anchorY, tw, seed);
    else drawTree(ctx, ix, anchorY, tw, seed, tt.color);
  }

  if (tt.flowers) drawFlowers(ctx, ix, anchorY, tw, th, seed);
  if (tt.category === 'building') drawBuilding(ctx, ix, anchorY, tw, th, seed, tt.color);
  if (tt.category === 'water') drawWater(ctx, ix, anchorY, tw, th, seed);
  if (tt.category === 'wetland' && !tt.tree) drawReeds(ctx, ix, anchorY, tw, th, seed);
  if (tt.id === 'mountain' || tt.id === 'peak') drawMountain(ctx, ix, anchorY, tw, seed);
  if (tt.id === 'rocky' || tt.id === 'cliffs') drawRocks(ctx, ix, anchorY, tw, th, seed);
}

// =============================================================================
// DECORATION DRAWING FUNCTIONS
// =============================================================================

function drawTree(ctx, x, y, tw, seed, baseColor) {
  const h = 12 + (seed % 6);
  ctx.fillStyle = '#5D4037';
  ctx.fillRect(x - 2, y - h / 2, 4, h / 2 + 4);
  ctx.fillStyle = baseColor || '#228B22';
  ctx.beginPath();
  ctx.arc(x, y - h + 4, tw / 3 + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = darken(baseColor || '#228B22', 0.15);
  ctx.beginPath();
  ctx.arc(x - 3, y - h + 6, tw / 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPine(ctx, x, y, tw, seed) {
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
  ctx.fillStyle = baseColor || '#D4A574';
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = '#8B4513';
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - 2, y - h);
  ctx.lineTo(x, y - h - 8);
  ctx.lineTo(x + w / 2 + 2, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5D4037';
  ctx.fillRect(x - 2, y - 6, 4, 6);
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

function getMapOffsets(map, outputSize = AI_SIZE) {
  const { offsetX, offsetY } = getCenteringOffsets(map, outputSize);
  return {
    tw: TILE_WIDTH,
    th: TILE_HEIGHT,
    ox: offsetX,
    oy: offsetY,
    canvasWidth: outputSize,
    canvasHeight: outputSize
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

// Constants
window.TILE_WIDTH = TILE_WIDTH;
window.TILE_HEIGHT = TILE_HEIGHT;
window.AI_SIZE = AI_SIZE;

// Utilities
window.getMapIsoBounds = getMapIsoBounds;
window.getSliceConfig = getSliceConfig;
window.getMapOffsets = getMapOffsets;
window.getObjectExtent = getObjectExtent;

// Base map rendering
window.renderMap = renderMap;
window.renderMapFullRes = renderMapFullRes;
window.renderMapSlice = renderMapSlice;

// Segmentation rendering
window.renderSegmentationMap = renderSegmentationMap;
window.renderSegmentationMapFullRes = renderSegmentationMapFullRes;
window.renderSegmentationSlice = renderSegmentationSlice;

// Edge map rendering
window.renderEdgeMap = renderEdgeMap;
window.renderEdgeMapFullRes = renderEdgeMapFullRes;
window.renderEdgeMapSlice = renderEdgeMapSlice;

// Slice stitching
window.stitchSlices = stitchSlices;

// Tile drawing
window.drawTile = drawTile;

console.log('Renderer loaded (consolidated, ~240 lines reduced)');
