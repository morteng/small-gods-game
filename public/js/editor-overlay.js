/**
 * Small Gods - Editor Overlay Renderer
 *
 * Draws visual indicators on top of the map:
 * - Road paths with highlighting
 * - River indicators
 * - POI markers with icons and labels
 * - Road endpoint markers
 * - Selection highlights
 * - Connection lines
 */

/**
 * Draw all editor overlays
 */
function drawEditorOverlay(ctx) {
  if (!editor.enabled || !editor.showOverlay || !state.worldSeed) return;

  const { tw, th, ox, oy } = getMapOffsets(state.map);

  // Draw connections (roads between POIs)
  drawConnections(ctx, tw, th, ox, oy);

  // Draw road tiles highlight
  drawRoadHighlight(ctx, tw, th, ox, oy);

  // Draw POI markers
  drawPOIMarkers(ctx, tw, th, ox, oy);

  // Draw road endpoint markers
  drawRoadEndpointMarkers(ctx, tw, th, ox, oy);

  // Draw connection-in-progress line
  if (editor.mode === 'add-connection' && editor.connectionStart) {
    drawConnectionInProgress(ctx, tw, th, ox, oy);
  }
}

/**
 * Draw connection lines between POIs
 */
function drawConnections(ctx, tw, th, ox, oy) {
  const connections = state.worldSeed.connections || [];
  const pois = state.worldSeed.pois || [];

  ctx.strokeStyle = 'rgba(205, 133, 63, 0.6)';
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 5]);

  for (const conn of connections) {
    const fromPoi = pois.find(p => p.id === conn.from);
    const toPoi = pois.find(p => p.id === conn.to);

    if (!fromPoi || !toPoi) continue;

    const fromPos = getPOIPosition(fromPoi);
    const toPos = getPOIPosition(toPoi);

    if (!fromPos || !toPos) continue;

    const from = tileToScreen(fromPos.x, fromPos.y);
    const to = tileToScreen(toPos.x, toPos.y);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
}

/**
 * Highlight road tiles on the map
 */
function drawRoadHighlight(ctx, tw, th, ox, oy) {
  if (!state.map?.tiles) return;

  ctx.fillStyle = 'rgba(160, 82, 45, 0.3)';

  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const tile = state.map.tiles[y]?.[x];
      if (!tile) continue;

      if (['dirt_road', 'stone_road', 'bridge'].includes(tile.type)) {
        const screen = tileToScreen(x, y);
        drawTileHighlight(ctx, screen.x, screen.y, tw, th);
      }
    }
  }
}

/**
 * Draw a diamond-shaped tile highlight
 */
function drawTileHighlight(ctx, x, y, tw, th) {
  const hw = tw / 2, hh = th / 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + hw, y + hh);
  ctx.lineTo(x, y + th);
  ctx.lineTo(x - hw, y + hh);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draw POI markers
 */
function drawPOIMarkers(ctx, tw, th, ox, oy) {
  const pois = state.worldSeed.pois || [];

  for (const poi of pois) {
    const pos = getPOIPosition(poi);
    if (!pos) continue;

    const screen = tileToScreen(pos.x, pos.y);
    const visual = POI_VISUALS[poi.type] || { icon: '📍', color: '#888', radius: 10 };

    const isSelected = editor.selection?.type === 'poi' && editor.selection?.id === poi.id;
    const isHovered = editor.hoveredItem?.type === 'poi' && editor.hoveredItem?.id === poi.id;

    // Draw marker background
    const radius = visual.radius + (isHovered ? 4 : 0);

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = '#f093fb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y - 10, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Marker circle
    ctx.fillStyle = isHovered ? lightenColor(visual.color, 30) : visual.color;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y - 10, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon
    ctx.font = `${radius}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(visual.icon, screen.x, screen.y - 10);

    // Label
    if (editor.showLabels && poi.name) {
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(poi.name, screen.x, screen.y - radius - 18);
      ctx.fillText(poi.name, screen.x, screen.y - radius - 18);
    }
  }
}

/**
 * Draw road endpoint markers
 */
function drawRoadEndpointMarkers(ctx, tw, th, ox, oy) {
  const endpoints = state.worldSeed.roadEndpoints || [];

  for (const endpoint of endpoints) {
    const pos = endpoint.position || DIRECTION_POSITIONS[endpoint.direction]?.(state.map.width, state.map.height);
    if (!pos) continue;

    const screen = tileToScreen(pos.x, pos.y);

    const isSelected = editor.selection?.type === 'roadEndpoint' && editor.selection?.id === endpoint.direction;
    const isHovered = editor.hoveredItem?.type === 'roadEndpoint' && editor.hoveredItem?.id === endpoint.direction;

    // Arrow direction
    const angle = getDirectionAngle(endpoint.direction);

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = '#f093fb';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Marker background
    ctx.fillStyle = isHovered ? '#ff9800' : '#ff5722';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arrow
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(angle);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Label
    if (editor.showLabels) {
      ctx.font = 'bold 10px Arial';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.textAlign = 'center';
      const label = `→ ${endpoint.destination}`;
      ctx.strokeText(label, screen.x, screen.y - 22);
      ctx.fillText(label, screen.x, screen.y - 22);
    }
  }
}

/**
 * Draw connection line while creating a new connection
 */
function drawConnectionInProgress(ctx, tw, th, ox, oy) {
  if (!editor.connectionStart) return;

  const fromPoi = state.worldSeed.pois.find(p => p.id === editor.connectionStart.id);
  if (!fromPoi) return;

  const fromPos = getPOIPosition(fromPoi);
  if (!fromPos) return;

  const from = tileToScreen(fromPos.x, fromPos.y);

  // Draw line from start POI to cursor
  const container = document.getElementById('canvasContainer');
  const rect = container.getBoundingClientRect();

  // Get current mouse position (we'll need to track this)
  ctx.strokeStyle = '#f093fb';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 5]);

  // Draw a pulsing marker on the start POI
  ctx.beginPath();
  ctx.arc(from.x, from.y - 10, 20, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([]);

  // Show instruction
  ctx.font = 'bold 12px Arial';
  ctx.fillStyle = '#f093fb';
  ctx.textAlign = 'center';
  ctx.fillText('Click another POI to connect', from.x, from.y - 45);
}

/**
 * Get angle in radians for direction arrow
 */
function getDirectionAngle(direction) {
  const angles = {
    north: -Math.PI / 2,
    south: Math.PI / 2,
    east: 0,
    west: Math.PI,
    northeast: -Math.PI / 4,
    northwest: -3 * Math.PI / 4,
    southeast: Math.PI / 4,
    southwest: 3 * Math.PI / 4,
  };
  return angles[direction] || 0;
}

/**
 * Get position for a POI (handles both position and region)
 */
function getPOIPosition(poi) {
  if (poi.position) {
    return poi.position;
  }
  if (poi.region) {
    return {
      x: Math.floor((poi.region.x_min + (poi.region.x_max || poi.region.x_min + 5)) / 2),
      y: Math.floor((poi.region.y_min + (poi.region.y_max || poi.region.y_min + 5)) / 2)
    };
  }
  return null;
}

/**
 * Lighten a hex color
 */
function lightenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xFF) + amount);
  const b = Math.min(255, (num & 0xFF) + amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Modify redraw to include editor overlay
const originalRedraw = redraw;
redraw = function() {
  originalRedraw();

  // Draw editor overlay on top
  if (editor.enabled) {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    drawEditorOverlay(ctx);
  }
};

// Export
window.drawEditorOverlay = drawEditorOverlay;
window.getPOIPosition = getPOIPosition;
