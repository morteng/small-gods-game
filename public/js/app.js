/**
 * Small Gods - Main Application
 */

async function generateWorld() {
  try {
    setButtonLoading('btnGenerate', true);
    setStatus('Generating world...', 'loading');

    // Read all parameters from UI
    const seed = parseInt(document.getElementById('seedInput').value) || Date.now();
    const width = parseInt(document.getElementById('mapWidth').value) || 24;
    const height = parseInt(document.getElementById('mapHeight').value) || 18;
    const villageCount = parseInt(document.getElementById('villageCount').value) || 3;
    const forestDensity = parseInt(document.getElementById('forestDensity').value) || 55;
    const waterLevel = parseInt(document.getElementById('waterLevel').value) || 35;
    const genMode = document.getElementById('genMode').value;

    // Generate based on mode
    if (genMode === 'wfc') {
      // Use WFC generation with world seed and terrain options
      state.map = await generateWithWFC(width, height, seed, state.worldSeed, {
        forestDensity,
        waterLevel,
        villageCount
      });
      setStatus('WFC generation complete!', 'success');
    } else {
      // Use noise-based generation
      state.map = generateMap(width, height, seed, { villageCount, forestDensity, waterLevel });
    }

    state.images.segment = renderMap(state.map);
    state.images.painted = null;
    state.images.final = null;
    state.npcs = [];

    updateStats();
    updateTabStates();
    updatePaintPrice();
    setLayer('map');
    updateNPCList();

    // Generate control images for LoRA preview
    if (typeof generateControlImages === 'function') {
      generateControlImages();
    }

    // Center map on screen after generation
    setTimeout(centerMap, 50);

    const modeLabel = genMode === 'wfc' ? 'WFC' : 'Noise';
    setStatus(`World generated! (${width}x${height}, ${modeLabel})`, 'success');
    setTimeout(hideStatus, 2000);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  } finally {
    setButtonLoading('btnGenerate', false);
  }
}

function setupCanvasHandlers() {
  const container = document.getElementById('canvasContainer');

  container.addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.deltaY > 0 ? 0.9 : 1.1;
    state.camera.zoom = Math.max(0.5, Math.min(4, state.camera.zoom * d));
    updateTransform();
    updateMinimap();
  }, { passive: false });

  container.addEventListener('mousedown', e => {
    if (e.button === 0) {
      state.camera.dragging = true;
      state.camera.lastX = e.clientX;
      state.camera.lastY = e.clientY;
      state.camera.startX = e.clientX;
      state.camera.startY = e.clientY;
      container.style.cursor = 'grabbing';
    }
  });

  container.addEventListener('mousemove', e => {
    const rect = container.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / state.camera.zoom - state.camera.x);
    const y = Math.round((e.clientY - rect.top) / state.camera.zoom - state.camera.y);
    document.getElementById('cursorPos').textContent = `${x}, ${y}`;

    if (state.camera.dragging) {
      const dx = (e.clientX - state.camera.lastX) / state.camera.zoom;
      const dy = (e.clientY - state.camera.lastY) / state.camera.zoom;
      state.camera.x += dx;
      state.camera.y += dy;
      state.camera.lastX = e.clientX;
      state.camera.lastY = e.clientY;
      updateTransform();
      updateMinimap();
    }
  });

  container.addEventListener('mouseup', e => {
    const wasDrag = Math.abs(e.clientX - state.camera.startX) > 5 || Math.abs(e.clientY - state.camera.startY) > 5;
    state.camera.dragging = false;
    container.style.cursor = 'grab';

    // Show tile info on click (not drag)
    if (!wasDrag && state.map) {
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.camera.zoom - state.camera.x;
      const y = (e.clientY - rect.top) / state.camera.zoom - state.camera.y;
      const { tw, th, ox, oy } = getMapOffsets(state.map);
      const mx = Math.floor(((x - ox) / (tw/2) + (y - oy) / (th/2)) / 2);
      const my = Math.floor(((y - oy) / (th/2) - (x - ox) / (tw/2)) / 2);
      if (mx >= 0 && mx < state.map.width && my >= 0 && my < state.map.height) {
        const tile = state.map.tiles[my]?.[mx];
        if (tile) showTileInfo(tile, mx, my);
      }
    }
  });

  container.addEventListener('mouseleave', () => {
    state.camera.dragging = false;
    container.style.cursor = 'grab';
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Slider value displays
  document.getElementById('villageCount').addEventListener('input', e => {
    document.getElementById('villageValue').textContent = e.target.value;
  });
  document.getElementById('forestDensity').addEventListener('input', e => {
    document.getElementById('forestValue').textContent = e.target.value + '%';
  });
  document.getElementById('waterLevel').addEventListener('input', e => {
    document.getElementById('waterValue').textContent = e.target.value + '%';
  });

  // Setup canvas handlers
  setupCanvasHandlers();

  // Initialize the map editor
  initEditor();

  // Load world seed from storage or use default
  if (!loadWorldSeedFromStorage()) {
    state.worldSeed = JSON.parse(JSON.stringify(DEFAULT_WORLD_SEED));
  }

  // Set WFC mode and update UI from world seed
  document.getElementById('genMode').value = 'wfc';
  if (state.worldSeed) {
    document.getElementById('mapWidth').value = state.worldSeed.size?.width || 24;
    document.getElementById('mapHeight').value = state.worldSeed.size?.height || 18;
  }

  // Generate the world
  await generateWorld();
  updateCosts();
});
