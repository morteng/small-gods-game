/**
 * Small Gods - UI Utilities
 */

function updateCosts() {
  try {
    const total = costs.paint + costs.npcs + costs.zoom;
    console.log('Updating costs:', costs, 'Total:', total);

    const paintEl = document.getElementById('costPaint');
    const npcsEl = document.getElementById('costNPCs');
    const zoomEl = document.getElementById('costZoom');
    const totalEl = document.getElementById('costTotal');

    if (paintEl) paintEl.textContent = '$' + costs.paint.toFixed(3);
    if (npcsEl) npcsEl.textContent = '$' + costs.npcs.toFixed(3);
    if (zoomEl) zoomEl.textContent = '$' + costs.zoom.toFixed(3);
    if (totalEl) totalEl.textContent = '$' + total.toFixed(3);
  } catch (e) {
    console.error('Error updating costs:', e);
  }
}

function setStatus(msg, type = 'loading') {
  const box = document.getElementById('statusBox');
  box.textContent = msg;
  box.className = `status show ${type}`;
}

function hideStatus() {
  document.getElementById('statusBox').className = 'status';
}

function setButtonLoading(id, loading) {
  const btn = document.getElementById(id);
  if (loading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner"></div> Working...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.originalText || btn.innerHTML;
  }
}

function updateStats() {
  if (!state.map) return;
  const total = state.map.width * state.map.height;
  let walkable = 0;
  for (const row of state.map.tiles) {
    for (const t of row) {
      if (TileTypes[t.type]?.walkable) walkable++;
    }
  }
  document.getElementById('statTiles').textContent = total;
  document.getElementById('statVillages').textContent = state.map.villages.length;
  document.getElementById('statNPCs').textContent = state.npcs.length;
  document.getElementById('statWalkable').textContent = Math.round(walkable / total * 100) + '%';
}

function setLayer(layer) {
  // Check if layer is available
  if (layer === 'painted' && !state.images.painted) {
    showMessage('Click "AI Paint Map" to generate painted version', 'Paint Map (~$0.02)', () => paintWorld());
    return;
  }
  if (layer === 'final' && !state.images.final) {
    showMessage('Generate NPCs to see the final view with characters', 'Generate NPCs (~$0.01/ea)', () => generateNPCs());
    return;
  }
  if (layer === 'segmentation' && !state.controlImages.segmentation) {
    showMessage('Generate a world first to see segmentation map');
    return;
  }
  if (layer === 'edge' && !state.controlImages.edge) {
    showMessage('Generate a world first to see edge map');
    return;
  }

  hideMessage();
  state.layer = layer;
  document.querySelectorAll('.layer-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.layer === layer);
  });
  redraw();
}

function updateTabStates() {
  const paintedTab = document.querySelector('[data-layer="painted"]');
  const finalTab = document.querySelector('[data-layer="final"]');
  if (paintedTab) paintedTab.classList.toggle('disabled', !state.images.painted);
  if (finalTab) finalTab.classList.toggle('disabled', !state.images.final);
}

function showMessage(text, btnText, btnAction) {
  const msg = document.getElementById('canvasMessage');
  const msgText = document.getElementById('messageText');
  const msgBtn = document.getElementById('messageBtn');

  msgText.textContent = text;
  msg.classList.add('show');

  if (btnText && btnAction) {
    msgBtn.textContent = btnText;
    msgBtn.style.display = 'block';
    msgBtn.onclick = () => { hideMessage(); btnAction(); };
  } else {
    msgBtn.style.display = 'none';
  }
}

function hideMessage() {
  document.getElementById('canvasMessage').classList.remove('show');
}

function updateTransform() {
  const canvas = document.getElementById('gameCanvas');
  canvas.style.transform = `scale(${state.camera.zoom}) translate(${state.camera.x}px, ${state.camera.y}px)`;
  document.getElementById('zoomLevel').textContent = Math.round(state.camera.zoom * 100) + '%';
}

function zoomIn() {
  state.camera.zoom = Math.min(4, state.camera.zoom * 1.25);
  updateTransform();
  updateMinimap();
}

function zoomOut() {
  state.camera.zoom = Math.max(0.5, state.camera.zoom / 1.25);
  updateTransform();
  updateMinimap();
}

function resetZoom() {
  state.camera.zoom = 1;
  state.camera.x = 0;
  state.camera.y = 0;
  updateTransform();
  updateMinimap();
}

function centerMap() {
  const container = document.getElementById('canvasContainer');
  const canvas = document.getElementById('gameCanvas');

  if (!container || !canvas) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;

  // Calculate zoom to fit the map with some padding
  const scaleX = containerWidth / canvasWidth;
  const scaleY = containerHeight / canvasHeight;
  state.camera.zoom = Math.min(scaleX, scaleY) * 0.9;
  state.camera.zoom = Math.max(0.5, Math.min(4, state.camera.zoom));

  // Center the map
  state.camera.x = (containerWidth / state.camera.zoom - canvasWidth) / 2;
  state.camera.y = (containerHeight / state.camera.zoom - canvasHeight) / 2;

  updateTransform();
  updateMinimap();
}

function showTileInfo(tile, x, y) {
  const panel = document.getElementById('tileInfoPanel');
  if (!panel) return;

  const tileData = TileTypes?.[tile.type] || {};

  // Find if this tile is part of a POI
  let poiInfo = null;
  if (state.worldSeed?.pois) {
    for (const poi of state.worldSeed.pois) {
      if (poi.position && poi.position.x === x && poi.position.y === y) {
        poiInfo = poi;
        break;
      }
    }
  }

  // Find if there's an NPC on this tile
  const npcHere = state.npcs.find(n => Math.floor(n.x) === x && Math.floor(n.y) === y);

  panel.innerHTML = `
    <div class="tile-info-header">
      <div class="tile-color" style="background:${tileData.color || '#666'}"></div>
      <div class="tile-name">${tile.type.replace(/_/g, ' ')}</div>
    </div>
    <div class="tile-info-grid">
      <div class="info-row">
        <span class="label">Position</span>
        <span class="value">${x}, ${y}</span>
      </div>
      <div class="info-row">
        <span class="label">Walkable</span>
        <span class="value">${tileData.walkable ? 'Yes' : 'No'}</span>
      </div>
      <div class="info-row">
        <span class="label">Category</span>
        <span class="value">${tileData.category || 'terrain'}</span>
      </div>
      ${tileData.height ? `<div class="info-row"><span class="label">Height</span><span class="value">${tileData.height}</span></div>` : ''}
      ${tileData.tree ? `<div class="info-row"><span class="label">Tree Type</span><span class="value">${tileData.treeType || 'standard'}</span></div>` : ''}
      ${tileData.flowers ? `<div class="info-row"><span class="label">Features</span><span class="value">Flowers</span></div>` : ''}
    </div>
    ${poiInfo ? `
    <div class="tile-info-section">
      <div class="section-title">Point of Interest</div>
      <div class="info-row"><span class="label">Name</span><span class="value">${poiInfo.name}</span></div>
      <div class="info-row"><span class="label">Type</span><span class="value">${poiInfo.type}</span></div>
      ${poiInfo.description ? `<div class="poi-desc">${poiInfo.description}</div>` : ''}
    </div>` : ''}
    ${npcHere ? `
    <div class="tile-info-section">
      <div class="section-title">NPC Present</div>
      <div class="info-row"><span class="label">Name</span><span class="value">${npcHere.name}</span></div>
    </div>` : ''}
  `;

  // Store selected tile for potential editing
  state.selectedTile = { x, y, tile };
}

function updatePaintPrice() {
  const priceEl = document.getElementById('paintPrice');
  if (priceEl) {
    priceEl.textContent = `~$${PRICES.PAINT.toFixed(2)}`;
  }
}

function updateNPCList() {
  const list = document.getElementById('npcList');
  if (state.npcs.length === 0) {
    list.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No NPCs yet</div>';
    return;
  }

  list.innerHTML = '';
  for (const npc of state.npcs) {
    const card = document.createElement('div');
    card.className = 'npc-card';

    if (npc.sprite) {
      const c = document.createElement('canvas');
      c.width = 48;
      c.height = 48;
      c.getContext('2d').drawImage(npc.sprite, 0, 0, 48, 48, 0, 0, 48, 48);
      card.appendChild(c);
    } else {
      const d = document.createElement('div');
      d.style.cssText = `width:32px;height:32px;background:${npc.color};border-radius:50%;margin:0 auto;`;
      card.appendChild(d);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = npc.name;
    card.appendChild(name);
    list.appendChild(card);
  }
}

/**
 * Redraw the main canvas with current layer
 */
function redraw() {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  // Get the appropriate image based on current layer
  let img = null;
  switch (state.layer) {
    case 'map':
      img = state.images.segment;  // The decorated map
      break;
    case 'segmentation':
      img = state.controlImages?.segmentation;  // Flat color control image
      break;
    case 'edge':
      img = state.controlImages?.edge;  // Edge outline control image
      break;
    case 'painted':
      img = state.images.painted;
      break;
    case 'final':
      img = state.images.final || state.images.painted;
      break;
    default:
      img = state.images.segment;
  }

  if (!img) {
    ctx.fillStyle = BG_COLOR || '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  // Resize canvas to match image
  canvas.width = img.width;
  canvas.height = img.height;

  // Draw the base image
  ctx.drawImage(img, 0, 0);

  // Draw NPCs on top if showing final layer
  if ((state.layer === 'final' || state.layer === 'painted') && state.npcs?.length > 0) {
    drawNPCs(ctx);
  }

  updateMinimap();
}

/**
 * Draw NPCs on the canvas
 */
function drawNPCs(ctx) {
  const { tw, th, ox, oy } = getMapOffsets(state.map);

  for (const npc of state.npcs) {
    const ix = (npc.x - npc.y) * (tw / 2) + ox;
    const iy = (npc.x + npc.y) * (th / 2) + oy;

    if (npc.sprite) {
      // Draw sprite
      ctx.drawImage(npc.sprite, 0, 0, 48, 48, ix - 24, iy - 40, 48, 48);
    } else {
      // Draw placeholder circle
      ctx.fillStyle = npc.color || '#FF0000';
      ctx.beginPath();
      ctx.arc(ix, iy - 8, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Update the minimap with current view
 */
function updateMinimap() {
  const miniCanvas = document.getElementById('minimapCanvas');
  if (!miniCanvas) return;

  const ctx = miniCanvas.getContext('2d');
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);

  // Get current displayed image
  let img = state.images.painted || state.images.segment;
  if (!img) return;

  // Draw scaled version
  const scale = Math.min(miniCanvas.width / img.width, miniCanvas.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const x = (miniCanvas.width - w) / 2;
  const y = (miniCanvas.height - h) / 2;

  ctx.drawImage(img, x, y, w, h);

  // Draw viewport rectangle
  const container = document.getElementById('canvasContainer');
  if (container && state.camera) {
    const viewW = container.clientWidth / state.camera.zoom;
    const viewH = container.clientHeight / state.camera.zoom;
    const viewX = -state.camera.x;
    const viewY = -state.camera.y;

    ctx.strokeStyle = '#f5576c';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      x + viewX * scale,
      y + viewY * scale,
      viewW * scale,
      viewH * scale
    );
  }
}

// Export for global access
window.redraw = redraw;
window.updateMinimap = updateMinimap;
