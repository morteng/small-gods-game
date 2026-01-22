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
    const animated = document.getElementById('chkAnimated')?.checked || false;

    // Generate based on mode
    if (genMode === 'wfc') {
      // Use WFC generation with world seed and terrain options
      state.map = await generateWithWFC(width, height, seed, state.worldSeed, {
        forestDensity,
        waterLevel,
        villageCount,
        animated
      });
      setStatus('WFC generation complete!', 'success');
    } else {
      // Use noise-based generation
      state.map = generateMap(width, height, seed, { villageCount, forestDensity, waterLevel });
    }

    // Auto-place modular decorations (if system is loaded)
    if (typeof autoPlaceDecorations === 'function' && window.DecorationRegistry?.getAllIds()?.length > 0) {
      setStatus('Placing decorations...', 'loading');
      const decoStats = autoPlaceDecorations(state.map, state.worldSeed?.biome || 'temperate', seed);
      debugLog('Decorations placed:', decoStats);
    }

    // Render at full map resolution (map's actual isometric bounds)
    // AI_SIZE is only used when preparing slices for AI processing
    const bounds = getMapIsoBounds(state.map);
    state.images.segment = renderMapFullRes(state.map);
    state.controlImages.segmentation = renderSegmentationMapFullRes(state.map);
    state.controlImages.edge = renderEdgeMapFullRes(state.map);

    console.log(`Map rendered at ${bounds.width}x${bounds.height}, tiles: ${state.map.width}x${state.map.height}`);

    state.images.painted = null;
    state.images.final = null;
    state.npcs = [];

    updateStats();
    updateTabStates();
    updatePaintPrice();
    setLayer('map');
    updateNPCList();

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
    }
  });

  container.addEventListener('mousemove', e => {
    // Show tile coordinates if on map
    if (state.map && typeof screenToTile === 'function') {
      const tile = screenToTile(e.clientX, e.clientY);
      if (tile.x >= 0 && tile.x < state.map.width && tile.y >= 0 && tile.y < state.map.height) {
        document.getElementById('cursorPos').textContent = `Tile: ${tile.x}, ${tile.y}`;
      } else if (typeof screenToCanvas === 'function') {
        const canvas = screenToCanvas(e.clientX, e.clientY);
        document.getElementById('cursorPos').textContent = `${Math.round(canvas.x)}, ${Math.round(canvas.y)}`;
      }
    }

    if (state.camera.dragging) {
      // Check if we've moved enough to be considered a drag
      const isDragging = Math.abs(e.clientX - state.camera.startX) > 5 || Math.abs(e.clientY - state.camera.startY) > 5;
      if (isDragging) {
        container.style.cursor = 'grabbing';
      }

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
    container.style.cursor = 'default';

    // Skip tile info when editor is enabled (editor handles selection)
    if (editor?.enabled) {
      return;
    }

    // Show info on click (not drag)
    if (!wasDrag && state.map) {
      // Handle segmentation layer click - show segment color info
      if (state.layer === 'segmentation' && state.controlImages?.segmentation) {
        const { x: canvasX, y: canvasY } = screenToCanvas(e.clientX, e.clientY);

        if (canvasX >= 0 && canvasX < AI_SIZE && canvasY >= 0 && canvasY < AI_SIZE) {
          const segCanvas = state.controlImages.segmentation;
          const ctx = segCanvas.getContext('2d');
          const px = Math.floor(canvasX);
          const py = Math.floor(canvasY);

          if (px >= 0 && px < segCanvas.width && py >= 0 && py < segCanvas.height) {
            const pixel = ctx.getImageData(px, py, 1, 1).data;
            const hexColor = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
            showSegmentInfo(hexColor, px, py);
          }
        }
        return;
      }

      // Handle regular map click - show tile info using shared coordinate conversion
      if (typeof screenToTile === 'function') {
        const tile = screenToTile(e.clientX, e.clientY);
        if (tile.x >= 0 && tile.x < state.map.width && tile.y >= 0 && tile.y < state.map.height) {
          const tileData = state.map.tiles[tile.y]?.[tile.x];
          if (tileData) showTileInfo(tileData, tile.x, tile.y);
        }
      }
    }
  });

  container.addEventListener('mouseleave', () => {
    state.camera.dragging = false;
    container.style.cursor = 'default';
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Setup slider value displays
  const sliderConfig = [
    { input: 'villageCount', display: 'villageValue', suffix: '' },
    { input: 'forestDensity', display: 'forestValue', suffix: '%' },
    { input: 'waterLevel', display: 'waterValue', suffix: '%' }
  ];

  sliderConfig.forEach(({ input, display, suffix }) => {
    const slider = document.getElementById(input);
    const label = document.getElementById(display);
    if (slider && label) {
      slider.addEventListener('input', e => {
        label.textContent = e.target.value + suffix;
      });
    }
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
