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
 * Get visual style for a connection type
 */
function getConnectionStyle(type, style) {
  const styles = {
    road: {
      color: 'rgba(205, 133, 63, 0.7)',  // Brown
      width: 3,
      dash: [5, 5]
    },
    river: {
      color: 'rgba(65, 105, 225, 0.7)',  // Blue
      width: 4,
      dash: []  // Solid
    },
    wall: {
      color: 'rgba(128, 128, 128, 0.7)', // Gray
      width: 3,
      dash: [2, 4]  // Dotted
    }
  };

  const baseStyle = styles[type] || styles.road;

  // Modify for stone road
  if (style === 'stone') {
    baseStyle.color = 'rgba(128, 128, 128, 0.7)';
  }

  return baseStyle;
}

/**
 * Draw connection lines between POIs with waypoint support
 */
function drawConnections(ctx, tw, th, ox, oy) {
  const connections = state.worldSeed.connections || [];
  const pois = state.worldSeed.pois || [];

  for (const conn of connections) {
    const fromPoi = pois.find(p => p.id === conn.from);
    const toPoi = pois.find(p => p.id === conn.to);

    if (!fromPoi || !toPoi) continue;

    const fromPos = getPOIPosition(fromPoi);
    const toPos = getPOIPosition(toPoi);

    if (!fromPos || !toPos) continue;

    // Get connection style
    const connStyle = getConnectionStyle(conn.type || 'road', conn.style);

    // Build path points: [fromPos, ...waypoints, toPos]
    const pathPoints = [fromPos, ...(conn.waypoints || []), toPos];

    // Convert to screen coordinates
    const screenPoints = pathPoints.map(p => tileToScreen(p.x, p.y));

    // Check if this connection is being edited
    const isEditing = editor.mode === 'edit-path' && editor.editingPath &&
      editor.editingPath.from === conn.from && editor.editingPath.to === conn.to;

    // Draw the path
    ctx.strokeStyle = isEditing ? '#f093fb' : connStyle.color;
    ctx.lineWidth = isEditing ? connStyle.width + 1 : connStyle.width;
    ctx.setLineDash(connStyle.dash);

    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();

    // Draw waypoint handles when editing this connection
    if (isEditing && editor.pathWaypoints) {
      drawWaypointHandles(ctx, editor.pathWaypoints);
    }
  }

  ctx.setLineDash([]);
}

/**
 * Draw circular handles at each waypoint for editing
 */
function drawWaypointHandles(ctx, waypoints) {
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const screen = tileToScreen(wp.x, wp.y);

    const isSelected = editor.selectedWaypoint === i;
    const isHovered = editor.hoveredWaypoint === i;

    // Draw handle
    const radius = isSelected ? 8 : (isHovered ? 7 : 6);
    const fillColor = isSelected ? '#f093fb' : (isHovered ? '#ff9800' : '#ffffff');

    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw index number
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isSelected || isHovered ? '#fff' : '#333';
    ctx.fillText(String(i + 1), screen.x, screen.y);
  }
}

/**
 * Find a connection at screen position (for clicking on lines)
 * Takes clientX, clientY from mouse event
 */
function findConnectionAtPosition(clientX, clientY, threshold = 10) {
  if (!state.worldSeed) return null;
  if (typeof screenToCanvas !== 'function') return null;

  // Convert client coordinates to canvas coordinates
  const { x: canvasX, y: canvasY } = screenToCanvas(clientX, clientY);

  const connections = state.worldSeed.connections || [];
  const pois = state.worldSeed.pois || [];

  for (const conn of connections) {
    const fromPoi = pois.find(p => p.id === conn.from);
    const toPoi = pois.find(p => p.id === conn.to);

    if (!fromPoi || !toPoi) continue;

    const fromPos = getPOIPosition(fromPoi);
    const toPos = getPOIPosition(toPoi);

    if (!fromPos || !toPos) continue;

    // Build path points
    const pathPoints = [fromPos, ...(conn.waypoints || []), toPos];

    // Check distance to each segment
    for (let i = 0; i < pathPoints.length - 1; i++) {
      const p1 = tileToScreen(pathPoints[i].x, pathPoints[i].y);
      const p2 = tileToScreen(pathPoints[i + 1].x, pathPoints[i + 1].y);

      const dist = pointToSegmentDistance(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);
      if (dist < threshold) {
        return { connection: conn, segmentIndex: i };
      }
    }
  }

  return null;
}

/**
 * Calculate distance from a point to a line segment
 */
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;

  if (len2 === 0) {
    // Segment is a point
    return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
  }

  // Project point onto line
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));

  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;

  return Math.sqrt((px - nearestX) * (px - nearestX) + (py - nearestY) * (py - nearestY));
}

/**
 * Find waypoint at position for editing
 */
function findWaypointAtPosition(screenX, screenY, waypoints, threshold = 15) {
  if (!waypoints) return null;

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const screen = tileToScreen(wp.x, wp.y);
    const dist = Math.sqrt((screenX - screen.x) ** 2 + (screenY - screen.y) ** 2);

    if (dist < threshold) {
      return i;
    }
  }

  return null;
}

/**
 * Insert a waypoint at a position on the path
 * Takes clientX, clientY from mouse event
 */
function insertWaypointAtPosition(waypoints, fromPos, toPos, clientX, clientY) {
  if (typeof screenToCanvas !== 'function') return waypoints || [];

  // Convert client coordinates to canvas coordinates
  const { x: canvasX, y: canvasY } = screenToCanvas(clientX, clientY);

  // Build full path
  const path = [fromPos, ...(waypoints || []), toPos];

  // Find which segment was clicked
  let insertIndex = waypoints ? waypoints.length : 0;
  let minDist = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = tileToScreen(path[i].x, path[i].y);
    const p2 = tileToScreen(path[i + 1].x, path[i + 1].y);
    const dist = pointToSegmentDistance(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);

    if (dist < minDist) {
      minDist = dist;
      // Insert after the first point of this segment
      // i=0 means insert at waypoint index 0
      // i=1 means insert at waypoint index 1
      insertIndex = i;
    }
  }

  // Convert client to tile position using screenToTile (which takes client coords)
  const tile = screenToTile(clientX, clientY);

  // Insert new waypoint
  const newWaypoints = [...(waypoints || [])];
  newWaypoints.splice(insertIndex, 0, { x: tile.x, y: tile.y });

  return newWaypoints;
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

  // Draw pulsing marker on the start POI
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
window.getConnectionStyle = getConnectionStyle;
window.findConnectionAtPosition = findConnectionAtPosition;
window.findWaypointAtPosition = findWaypointAtPosition;
window.insertWaypointAtPosition = insertWaypointAtPosition;
window.pointToSegmentDistance = pointToSegmentDistance;
