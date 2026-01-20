/**
 * Small Gods - Map Editor
 *
 * Full-featured editor for World Seed manipulation:
 * - Click to select POIs, road endpoints, connections
 * - Drag to move elements
 * - Properties panel for editing
 * - Add/delete tools
 */

const editor = {
  enabled: false,
  mode: 'select', // 'select', 'move', 'add-poi', 'add-road-endpoint', 'add-connection'
  selection: null, // { type: 'poi'|'roadEndpoint'|'connection', id: string, data: object }
  dragging: false,
  dragStart: null,
  hoveredItem: null,
  showOverlay: true,
  showLabels: true,
  connectionStart: null, // For drawing connections between POIs
};

// POI types with their visual properties
const POI_VISUALS = {
  village: { icon: '🏘️', color: '#cd853f', radius: 12 },
  town: { icon: '🏛️', color: '#8b4513', radius: 14 },
  city: { icon: '🏰', color: '#4a4a4a', radius: 16 },
  castle: { icon: '⚔️', color: '#2c2c2c', radius: 14 },
  tower: { icon: '🗼', color: '#778899', radius: 10 },
  tavern: { icon: '🍺', color: '#daa520', radius: 8 },
  farm: { icon: '🌾', color: '#f5deb3', radius: 10 },
  forest: { icon: '🌲', color: '#228b22', radius: 20 },
  lake: { icon: '💧', color: '#4169e1', radius: 16 },
  mountain: { icon: '⛰️', color: '#696969', radius: 18 },
  ruins: { icon: '🏚️', color: '#8b8682', radius: 10 },
  cave: { icon: '🕳️', color: '#2f2f2f', radius: 8 },
  shrine: { icon: '⛩️', color: '#dc143c', radius: 8 },
  port: { icon: '⚓', color: '#4682b4', radius: 10 },
};

// Direction to position mapping for road endpoints
const DIRECTION_POSITIONS = {
  north: (w, h) => ({ x: Math.floor(w / 2), y: 0 }),
  south: (w, h) => ({ x: Math.floor(w / 2), y: h - 1 }),
  east: (w, h) => ({ x: w - 1, y: Math.floor(h / 2) }),
  west: (w, h) => ({ x: 0, y: Math.floor(h / 2) }),
  northeast: (w, h) => ({ x: w - 1, y: 0 }),
  northwest: (w, h) => ({ x: 0, y: 0 }),
  southeast: (w, h) => ({ x: w - 1, y: h - 1 }),
  southwest: (w, h) => ({ x: 0, y: h - 1 }),
};

/**
 * Initialize the editor
 */
function initEditor() {
  // Add editor event listeners to canvas
  const container = document.getElementById('canvasContainer');

  container.addEventListener('click', handleEditorClick);
  container.addEventListener('mousemove', handleEditorMouseMove);
  container.addEventListener('mousedown', handleEditorMouseDown);
  container.addEventListener('mouseup', handleEditorMouseUp);

  // Keyboard shortcuts
  document.addEventListener('keydown', handleEditorKeyDown);

  updateEditorUI();
}

/**
 * Toggle editor mode
 */
function toggleEditor() {
  editor.enabled = !editor.enabled;
  editor.selection = null;

  document.body.classList.toggle('editor-active', editor.enabled);
  updateEditorUI();
  redraw();
}

/**
 * Set editor tool/mode
 */
function setEditorMode(mode) {
  editor.mode = mode;
  editor.connectionStart = null;
  updateEditorUI();

  // Update cursor
  const container = document.getElementById('canvasContainer');
  switch (mode) {
    case 'select':
    case 'move':
      container.style.cursor = 'default';
      break;
    case 'add-poi':
    case 'add-road-endpoint':
      container.style.cursor = 'crosshair';
      break;
    case 'add-connection':
      container.style.cursor = 'pointer';
      break;
  }
}

/**
 * Convert screen coordinates to map tile coordinates
 */
function screenToTile(screenX, screenY) {
  const container = document.getElementById('canvasContainer');
  const rect = container.getBoundingClientRect();

  const x = (screenX - rect.left) / state.camera.zoom - state.camera.x;
  const y = (screenY - rect.top) / state.camera.zoom - state.camera.y;

  const { tw, th, ox, oy } = getMapOffsets(state.map);
  const mx = Math.floor(((x - ox) / (tw / 2) + (y - oy) / (th / 2)) / 2);
  const my = Math.floor(((y - oy) / (th / 2) - (x - ox) / (tw / 2)) / 2);

  return { x: mx, y: my };
}

/**
 * Convert map tile coordinates to screen coordinates
 */
function tileToScreen(tileX, tileY) {
  const { tw, th, ox, oy } = getMapOffsets(state.map);
  const ix = (tileX - tileY) * (tw / 2) + ox;
  const iy = (tileX + tileY) * (th / 2) + oy;
  return { x: ix, y: iy };
}

/**
 * Find item at screen position
 */
function findItemAtPosition(screenX, screenY) {
  if (!state.worldSeed) return null;

  const tile = screenToTile(screenX, screenY);
  const threshold = 3; // Tile distance threshold for selection

  // Check POIs
  for (const poi of state.worldSeed.pois || []) {
    const pos = poi.position || (poi.region ? {
      x: Math.floor((poi.region.x_min + (poi.region.x_max || poi.region.x_min + 5)) / 2),
      y: Math.floor((poi.region.y_min + (poi.region.y_max || poi.region.y_min + 5)) / 2)
    } : null);

    if (pos) {
      const dist = Math.abs(pos.x - tile.x) + Math.abs(pos.y - tile.y);
      if (dist <= threshold) {
        return { type: 'poi', id: poi.id, data: poi };
      }
    }
  }

  // Check road endpoints
  for (const endpoint of state.worldSeed.roadEndpoints || []) {
    const pos = endpoint.position || DIRECTION_POSITIONS[endpoint.direction]?.(state.map.width, state.map.height);
    if (pos) {
      const dist = Math.abs(pos.x - tile.x) + Math.abs(pos.y - tile.y);
      if (dist <= threshold) {
        return { type: 'roadEndpoint', id: endpoint.direction, data: endpoint };
      }
    }
  }

  return null;
}

/**
 * Handle editor click
 */
function handleEditorClick(e) {
  if (!editor.enabled || editor.dragging) return;

  const item = findItemAtPosition(e.clientX, e.clientY);

  switch (editor.mode) {
    case 'select':
    case 'move':
      editor.selection = item;
      updatePropertiesPanel();
      redraw();
      break;

    case 'add-poi':
      const tile = screenToTile(e.clientX, e.clientY);
      if (tile.x >= 0 && tile.x < state.map.width && tile.y >= 0 && tile.y < state.map.height) {
        showAddPOIDialog(tile);
      }
      break;

    case 'add-road-endpoint':
      addRoadEndpointAtEdge(e.clientX, e.clientY);
      break;

    case 'add-connection':
      if (item?.type === 'poi') {
        if (!editor.connectionStart) {
          editor.connectionStart = item;
        } else if (editor.connectionStart.id !== item.id) {
          addConnection(editor.connectionStart.id, item.id);
          editor.connectionStart = null;
        }
        redraw();
      }
      break;
  }
}

/**
 * Handle mouse move for hover effects and dragging
 */
function handleEditorMouseMove(e) {
  if (!editor.enabled) return;

  if (editor.dragging && editor.selection) {
    const tile = screenToTile(e.clientX, e.clientY);

    // Clamp to map bounds
    tile.x = Math.max(0, Math.min(state.map.width - 1, tile.x));
    tile.y = Math.max(0, Math.min(state.map.height - 1, tile.y));

    // Update position based on selection type
    if (editor.selection.type === 'poi') {
      const poi = state.worldSeed.pois.find(p => p.id === editor.selection.id);
      if (poi) {
        if (poi.position) {
          poi.position = { x: tile.x, y: tile.y };
        } else if (poi.region) {
          // Move region center
          const oldCx = Math.floor((poi.region.x_min + (poi.region.x_max || poi.region.x_min)) / 2);
          const oldCy = Math.floor((poi.region.y_min + (poi.region.y_max || poi.region.y_min)) / 2);
          const dx = tile.x - oldCx;
          const dy = tile.y - oldCy;
          poi.region.x_min += dx;
          poi.region.y_min += dy;
          if (poi.region.x_max) poi.region.x_max += dx;
          if (poi.region.y_max) poi.region.y_max += dy;
        }
        editor.selection.data = poi;
      }
    } else if (editor.selection.type === 'roadEndpoint') {
      const endpoint = state.worldSeed.roadEndpoints.find(r => r.direction === editor.selection.id);
      if (endpoint) {
        endpoint.position = { x: tile.x, y: tile.y };
        // Update direction based on position
        endpoint.direction = getDirectionFromPosition(tile.x, tile.y, state.map.width, state.map.height);
        editor.selection.data = endpoint;
      }
    }

    updatePropertiesPanel();
    redraw();
  } else {
    // Hover effect
    const item = findItemAtPosition(e.clientX, e.clientY);
    if (item !== editor.hoveredItem) {
      editor.hoveredItem = item;
      redraw();
    }
  }
}

/**
 * Handle mouse down for drag start
 */
function handleEditorMouseDown(e) {
  if (!editor.enabled || editor.mode === 'add-poi' || editor.mode === 'add-road-endpoint') return;

  const item = findItemAtPosition(e.clientX, e.clientY);
  if (item && (editor.mode === 'move' || editor.mode === 'select')) {
    editor.selection = item;
    editor.dragging = true;
    editor.dragStart = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  }
}

/**
 * Handle mouse up for drag end
 */
function handleEditorMouseUp(e) {
  if (editor.dragging) {
    editor.dragging = false;
    saveWorldSeedToStorage();
    updatePropertiesPanel();
  }
}

/**
 * Handle keyboard shortcuts
 */
function handleEditorKeyDown(e) {
  if (!editor.enabled) return;

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (editor.selection) {
        deleteSelection();
        e.preventDefault();
      }
      break;
    case 'Escape':
      editor.selection = null;
      editor.connectionStart = null;
      updatePropertiesPanel();
      redraw();
      break;
    case '1':
      setEditorMode('select');
      break;
    case '2':
      setEditorMode('move');
      break;
    case '3':
      setEditorMode('add-poi');
      break;
    case '4':
      setEditorMode('add-road-endpoint');
      break;
    case '5':
      setEditorMode('add-connection');
      break;
  }
}

/**
 * Get direction name from edge position
 */
function getDirectionFromPosition(x, y, w, h) {
  const isTop = y < h / 4;
  const isBottom = y > h * 3 / 4;
  const isLeft = x < w / 4;
  const isRight = x > w * 3 / 4;

  if (isTop && isLeft) return 'northwest';
  if (isTop && isRight) return 'northeast';
  if (isBottom && isLeft) return 'southwest';
  if (isBottom && isRight) return 'southeast';
  if (isTop) return 'north';
  if (isBottom) return 'south';
  if (isLeft) return 'west';
  if (isRight) return 'east';
  return 'north';
}

/**
 * Add a road endpoint at the nearest edge
 */
function addRoadEndpointAtEdge(screenX, screenY) {
  const tile = screenToTile(screenX, screenY);
  const direction = getDirectionFromPosition(tile.x, tile.y, state.map.width, state.map.height);

  // Check if endpoint already exists for this direction
  if (state.worldSeed.roadEndpoints?.some(r => r.direction === direction)) {
    setStatus('Road endpoint already exists in this direction', 'error');
    return;
  }

  const endpoint = {
    direction,
    position: { x: tile.x, y: tile.y },
    destination: 'Unknown Lands',
    description: 'A road leading to distant places.',
    style: 'dirt'
  };

  if (!state.worldSeed.roadEndpoints) {
    state.worldSeed.roadEndpoints = [];
  }
  state.worldSeed.roadEndpoints.push(endpoint);

  editor.selection = { type: 'roadEndpoint', id: direction, data: endpoint };
  saveWorldSeedToStorage();
  regenerateMap();
  updatePropertiesPanel();
}

/**
 * Show dialog for adding a new POI
 */
function showAddPOIDialog(tile) {
  const types = Object.keys(POI_VISUALS);
  const type = prompt(`Enter POI type:\n${types.join(', ')}`, 'village');
  if (!type || !types.includes(type)) return;

  const name = prompt('Enter POI name:', `New ${type}`);
  if (!name) return;

  const id = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();

  const poi = {
    id,
    type,
    name,
    position: { x: tile.x, y: tile.y },
    size: 'medium',
    description: `A ${type} called ${name}.`,
    visualStyle: `${type} in a fantasy setting`
  };

  if (!state.worldSeed.pois) {
    state.worldSeed.pois = [];
  }
  state.worldSeed.pois.push(poi);

  editor.selection = { type: 'poi', id, data: poi };
  saveWorldSeedToStorage();
  regenerateMap();
  updatePropertiesPanel();
}

/**
 * Add connection between two POIs
 */
function addConnection(fromId, toId) {
  // Check if connection already exists
  const exists = state.worldSeed.connections?.some(
    c => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
  );

  if (exists) {
    setStatus('Connection already exists', 'error');
    return;
  }

  const connection = {
    from: fromId,
    to: toId,
    type: 'road',
    style: 'dirt',
    description: 'A path between locations'
  };

  if (!state.worldSeed.connections) {
    state.worldSeed.connections = [];
  }
  state.worldSeed.connections.push(connection);

  saveWorldSeedToStorage();
  regenerateMap();
  setStatus('Connection added', 'success');
}

/**
 * Delete current selection
 */
function deleteSelection() {
  if (!editor.selection) return;

  if (editor.selection.type === 'poi') {
    state.worldSeed.pois = state.worldSeed.pois.filter(p => p.id !== editor.selection.id);
    // Also remove connections to this POI
    state.worldSeed.connections = (state.worldSeed.connections || []).filter(
      c => c.from !== editor.selection.id && c.to !== editor.selection.id
    );
  } else if (editor.selection.type === 'roadEndpoint') {
    state.worldSeed.roadEndpoints = state.worldSeed.roadEndpoints.filter(
      r => r.direction !== editor.selection.id
    );
  }

  editor.selection = null;
  saveWorldSeedToStorage();
  regenerateMap();
  updatePropertiesPanel();
}

/**
 * Regenerate map with current world seed
 */
async function regenerateMap() {
  await generateWorld();
}

/**
 * Update the properties panel with current selection
 */
function updatePropertiesPanel() {
  const panel = document.getElementById('propertiesPanel');
  if (!panel) return;

  if (!editor.selection) {
    panel.innerHTML = '<div class="empty-state">Select an object to edit</div>';
    return;
  }

  const data = editor.selection.data;
  let html = '';

  if (editor.selection.type === 'poi') {
    html = `
      <div class="prop-header">${POI_VISUALS[data.type]?.icon || '📍'} ${data.name}</div>
      <div class="prop-group">
        <label>Name</label>
        <input type="text" value="${data.name}" onchange="updateSelectionProp('name', this.value)" />
      </div>
      <div class="prop-group">
        <label>Type</label>
        <select onchange="updateSelectionProp('type', this.value)">
          ${Object.keys(POI_VISUALS).map(t => `<option value="${t}" ${t === data.type ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="prop-group">
        <label>Position</label>
        <div class="prop-row">
          <input type="number" value="${data.position?.x || 0}" onchange="updateSelectionProp('position.x', parseInt(this.value))" style="width:50%" />
          <input type="number" value="${data.position?.y || 0}" onchange="updateSelectionProp('position.y', parseInt(this.value))" style="width:50%" />
        </div>
      </div>
      <div class="prop-group">
        <label>Description</label>
        <textarea onchange="updateSelectionProp('description', this.value)">${data.description || ''}</textarea>
      </div>
      <div class="prop-group">
        <label>Visual Style</label>
        <textarea onchange="updateSelectionProp('visualStyle', this.value)">${data.visualStyle || ''}</textarea>
      </div>
      <button class="btn-danger" onclick="deleteSelection()">Delete POI</button>
    `;
  } else if (editor.selection.type === 'roadEndpoint') {
    html = `
      <div class="prop-header">🛤️ Road to ${data.destination}</div>
      <div class="prop-group">
        <label>Direction</label>
        <select onchange="updateSelectionProp('direction', this.value)">
          ${['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']
            .map(d => `<option value="${d}" ${d === data.direction ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div class="prop-group">
        <label>Destination</label>
        <input type="text" value="${data.destination}" onchange="updateSelectionProp('destination', this.value)" />
      </div>
      <div class="prop-group">
        <label>Style</label>
        <select onchange="updateSelectionProp('style', this.value)">
          <option value="dirt" ${data.style === 'dirt' ? 'selected' : ''}>Dirt Road</option>
          <option value="stone" ${data.style === 'stone' ? 'selected' : ''}>Stone Road</option>
        </select>
      </div>
      <div class="prop-group">
        <label>Description</label>
        <textarea onchange="updateSelectionProp('description', this.value)">${data.description || ''}</textarea>
      </div>
      <button class="btn-danger" onclick="deleteSelection()">Delete Endpoint</button>
    `;
  }

  panel.innerHTML = html;
}

/**
 * Update a property on the current selection
 */
function updateSelectionProp(path, value) {
  if (!editor.selection) return;

  const parts = path.split('.');
  let obj = editor.selection.data;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;

  // Special handling for direction change on road endpoint
  if (editor.selection.type === 'roadEndpoint' && path === 'direction') {
    editor.selection.id = value;
  }

  saveWorldSeedToStorage();
  regenerateMap();
}

/**
 * Update editor UI (toolbar, panels)
 */
function updateEditorUI() {
  const toolbar = document.getElementById('editorToolbar');
  if (toolbar) {
    toolbar.classList.toggle('show', editor.enabled);
  }

  const propsPanel = document.getElementById('editorPropsPanel');
  if (propsPanel) {
    propsPanel.classList.toggle('show', editor.enabled);
  }

  // Update tool buttons
  document.querySelectorAll('.editor-tool').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === editor.mode);
  });

  // Update toggle button
  const toggleBtn = document.getElementById('btnToggleEditor');
  if (toggleBtn) {
    toggleBtn.textContent = editor.enabled ? 'Exit Editor' : 'Edit Map';
    toggleBtn.classList.toggle('btn-primary', editor.enabled);
    toggleBtn.classList.toggle('btn-secondary', !editor.enabled);
  }

  // Update properties panel
  updatePropertiesPanel();
}

// Export for global access
window.editor = editor;
window.initEditor = initEditor;
window.toggleEditor = toggleEditor;
window.setEditorMode = setEditorMode;
window.deleteSelection = deleteSelection;
window.updateSelectionProp = updateSelectionProp;
window.POI_VISUALS = POI_VISUALS;
window.DIRECTION_POSITIONS = DIRECTION_POSITIONS;
window.tileToScreen = tileToScreen;
window.screenToTile = screenToTile;
