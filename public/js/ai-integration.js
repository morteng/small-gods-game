/**
 * Small Gods - AI Integration (Replicate API)
 * Uses ControlNet Segmentation for terrain-aware map painting
 * and Retro Diffusion for NPC generation
 */

// API helpers
function getApiToken() {
  const token = document.getElementById('apiToken').value;
  if (!token) throw new Error('API token required');
  return token;
}

async function getModelVersion(modelPath, token) {
  console.log('Fetching model:', modelPath);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(`/api/replicate/v1/models/${modelPath}`, {
      headers: { 'Authorization': `Token ${token}` },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody = await res.text();
      console.error('Model fetch failed:', res.status, errorBody);
      throw new Error(`Failed to load model: ${res.status}`);
    }
    const model = await res.json();
    console.log('Model response:', model);
    if (!model.latest_version) throw new Error('Model version not available');
    return model.latest_version.id;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out - check server is running');
    }
    throw err;
  }
}

async function runPrediction(version, input, token, onStatus, retryCount = 0) {
  console.log('Starting prediction with version:', version);
  console.log('Input params:', Object.keys(input));

  const res = await fetch('/api/replicate/v1/predictions', {
    method: 'POST',
    headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, input })
  });

  console.log('Prediction HTTP status:', res.status);

  // Handle rate limiting with retry
  if (res.status === 429) {
    const errorData = await res.json().catch(() => ({}));
    const retryAfter = errorData.retry_after || 10;
    const maxRetries = 5;

    if (retryCount < maxRetries) {
      console.log(`Rate limited, waiting ${retryAfter}s before retry ${retryCount + 1}/${maxRetries}`);
      if (onStatus) onStatus(`rate limited, waiting ${retryAfter}s...`);
      await new Promise(r => setTimeout(r, (retryAfter + 1) * 1000));
      return runPrediction(version, input, token, onStatus, retryCount + 1);
    }
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.error('Prediction request failed:', res.status, errorText);
    throw new Error(`Prediction request failed (${res.status}): ${errorText}`);
  }

  let pred = await res.json();
  console.log('Prediction response:', JSON.stringify(pred, null, 2));

  if (pred.error) throw new Error(pred.error);
  if (!pred.id) throw new Error('Failed to start prediction - no ID in response');

  let pollCount = 0;
  const maxPolls = 90; // 3 minutes max

  while (pred.status !== 'succeeded' && pred.status !== 'failed') {
    if (++pollCount > maxPolls) {
      throw new Error('Prediction timed out after 3 minutes');
    }
    await new Promise(r => setTimeout(r, 2000));
    if (onStatus) onStatus(pred.status);
    console.log(`Poll ${pollCount}:`, pred.status);

    const poll = await fetch(`/api/replicate/v1/predictions/${pred.id}`, {
      headers: { 'Authorization': `Token ${token}` }
    });
    pred = await poll.json();
  }

  console.log('Prediction final status:', pred.status, pred.output ? 'has output' : 'no output');

  if (pred.status === 'failed') {
    console.error('Prediction failed:', pred.error, pred.logs);
    throw new Error(pred.error || 'Prediction failed');
  }
  return Array.isArray(pred.output) ? pred.output[0] : pred.output;
}

async function loadImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/**
 * Paint the world using SDXL img2img
 * Takes the segmentation map and transforms it while preserving layout
 */
async function paintWorld() {
  console.log('paintWorld called');

  if (!state.map) {
    setStatus('Generate world first', 'error');
    return;
  }

  try {
    const token = getApiToken();
    setButtonLoading('btnPaint', true);

    const SIZE = 1024; // SDXL works best at 1024

    // Build prompt
    const basePrompt = state.worldSeed?.visualTheme ||
      'fantasy game world, lush green meadows, dark mysterious forest, crystal blue lake, cozy medieval village, winding dirt paths, misty mountains';
    const prompt = `top-down isometric fantasy game map, ${basePrompt}, detailed pixel art textures, game art style, vibrant saturated colors, sharp edges, no blur`;

    // Get model version
    setStatus('Loading SDXL model...', 'loading');
    const version = await getModelVersion('stability-ai/sdxl', token);
    console.log('Model version:', version);

    // Create segmentation map at SDXL size
    setStatus('Creating base map...', 'loading');
    const segCanvas = renderSegmentationMap(state.map, SIZE);
    console.log('Segmentation canvas:', segCanvas.width, 'x', segCanvas.height);

    const segUri = segCanvas.toDataURL('image/png');

    // Run SDXL in img2img mode
    setStatus('Painting map with SDXL (this takes ~60s)...', 'loading');
    const outputUrl = await runPrediction(version, {
      image: segUri,
      prompt: prompt,
      negative_prompt: 'blurry, low quality, distorted, ugly, bad art, watermark, text, signature, realistic photo, 3d render',
      prompt_strength: 0.65,  // Keep structure but transform style
      width: SIZE,
      height: SIZE,
      num_outputs: 1,
      num_inference_steps: 30,
      guidance_scale: 7.5,
      scheduler: 'K_EULER',
      seed: state.map.seed
    }, token, status => {
      setStatus(`Painting: ${status}`, 'loading');
    });

    costs.paint += PRICES.PAINT;
    updateCosts();

    // Load the result
    setStatus('Loading result...', 'loading');
    console.log('Output URL:', outputUrl);

    const paintedImg = await loadImage(outputUrl);
    console.log('Painted image:', paintedImg.width, 'x', paintedImg.height);

    // Create canvas at output size
    const paintedCanvas = document.createElement('canvas');
    paintedCanvas.width = paintedImg.width;
    paintedCanvas.height = paintedImg.height;
    const paintedCtx = paintedCanvas.getContext('2d');

    // Draw the AI result directly
    paintedCtx.drawImage(paintedImg, 0, 0);

    // Set result
    state.images.painted = paintedCanvas;
    state.images.final = paintedCanvas;
    updateTabStates();
    setLayer('painted');
    redraw();

    setStatus('Map painted! Cost: $' + PRICES.PAINT.toFixed(3), 'success');
    setTimeout(hideStatus, 3000);

  } catch (err) {
    console.error('Paint error:', err);
    console.error('Error stack:', err.stack);

    let errorMsg = err.message;
    if (errorMsg.includes('API token')) {
      errorMsg = 'Enter your Replicate API token in the left panel';
    } else if (errorMsg.includes('Failed to load model')) {
      errorMsg = 'Model not found - check Replicate API access';
    } else if (errorMsg.includes('401')) {
      errorMsg = 'Invalid API token - check your Replicate token';
    } else if (errorMsg.includes('402')) {
      errorMsg = 'Replicate billing issue - add payment method';
    } else if (errorMsg.includes('timed out') || errorMsg.includes('AbortError')) {
      errorMsg = 'Request timed out - check server is running on localhost';
    } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      errorMsg = 'Network error - check server is running (node server.js)';
    } else if (errorMsg.includes('403')) {
      errorMsg = 'Access denied - check your API token permissions';
    } else if (errorMsg.includes('404')) {
      errorMsg = 'Model not found on Replicate';
    } else if (errorMsg.includes('422')) {
      errorMsg = 'Invalid parameters - model rejected input';
    } else if (errorMsg.includes('500')) {
      errorMsg = 'Replicate server error - try again later';
    }

    setStatus('Paint failed: ' + errorMsg, 'error');
  } finally {
    setButtonLoading('btnPaint', false);
  }
}

/**
 * Generate NPC sprites using Retro Diffusion rd-animation
 */
async function generateNPCs() {
  if (!state.map) {
    setStatus('Generate world first', 'error');
    return;
  }

  try {
    const token = getApiToken();
    setButtonLoading('btnNPCs', true);

    const archetypes = [
      { prompt: 'pixel art medieval peasant farmer, simple clothes, straw hat', name: 'Peasant', color: '#8B4513' },
      { prompt: 'pixel art wizard in blue robe, white beard, magic staff', name: 'Wizard', color: '#4169E1' },
      { prompt: 'pixel art town guard in armor, helmet, spear', name: 'Guard', color: '#708090' }
    ];

    state.npcs = [];
    let npcCost = 0;
    const count = Math.min(archetypes.length, state.map.villages.length);

    for (let i = 0; i < count; i++) {
      const arch = archetypes[i];
      const village = state.map.villages[i];
      setStatus(`Generating ${arch.name}...`, 'loading');

      let sprite = null;
      try {
        const version = await getModelVersion('retro-diffusion/rd-animation', token);
        const outputUrl = await runPrediction(version, {
          prompt: arch.prompt,
          style: 'four_angle_walking',
          width: 48,
          height: 48,
          return_spritesheet: true
        }, token);

        npcCost += PRICES.NPC;
        sprite = await loadImage(outputUrl);
      } catch (e) {
        console.log('NPC sprite failed, using placeholder:', e.message);
      }

      // Find walkable position near village
      let px = village.x, py = village.y;
      outer: for (let d = 1; d < 5; d++) {
        for (let dx = -d; dx <= d; dx++) {
          for (let dy = -d; dy <= d; dy++) {
            const tx = village.x + dx, ty = village.y + dy;
            if (state.map.tiles[ty]?.[tx] && TileTypes[state.map.tiles[ty][tx].type]?.walkable) {
              px = tx; py = ty;
              break outer;
            }
          }
        }
      }

      state.npcs.push({
        ...arch, sprite,
        x: px, y: py, tx: px, ty: py,
        frame: 0, dir: 0, moving: false
      });
    }

    costs.npcs += npcCost;
    updateCosts();
    updateNPCList();
    updateStats();

    if (state.images.painted) state.images.final = state.images.painted;
    updateTabStates();
    redraw();

    setStatus(`Generated ${state.npcs.length} NPCs! Cost: $${npcCost.toFixed(3)}`, 'success');
    setTimeout(hideStatus, 3000);

  } catch (err) {
    console.error('NPC generation error:', err);
    let errorMsg = err.message;
    if (errorMsg.includes('API token')) {
      errorMsg = 'Enter your Replicate API token in the left panel';
    } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
      errorMsg = 'Network error - check server is running (node server.js)';
    } else if (errorMsg.includes('401')) {
      errorMsg = 'Invalid API token';
    }
    setStatus('NPC generation failed: ' + errorMsg, 'error');
  } finally {
    setButtonLoading('btnNPCs', false);
  }
}

/**
 * Generate a detailed zoom view for a specific tile (currently disabled in UI)
 */
async function generateZoomView(tileType, x, y) {
  const preview = document.getElementById('zoomPreview');
  if (!preview) return;

  try {
    const token = getApiToken();
    preview.innerHTML = `<div class="placeholder">Generating ${tileType}...</div>`;

    const prompts = {
      grass: 'isometric pixel art grass meadow, wildflowers, gentle hills, 16-bit',
      forest: 'isometric pixel art forest clearing, tall trees, dappled sunlight, 16-bit',
      building_wood: 'isometric pixel art medieval village, wooden cottages, thatched roof, 16-bit',
      building_stone: 'isometric pixel art medieval castle, stone walls, tower, 16-bit',
      deep_water: 'isometric pixel art lake, crystal blue water, ripples, 16-bit',
      shallow_water: 'isometric pixel art shallow water, reeds, lily pads, 16-bit',
      sand: 'isometric pixel art sandy beach, seashells, dunes, 16-bit',
      dirt_road: 'isometric pixel art dirt road, wagon tracks, grass edges, 16-bit',
      hills: 'isometric pixel art rolling hills, boulders, grass, 16-bit',
      mountain: 'isometric pixel art mountain peak, rocky cliffs, snow cap, 16-bit'
    };

    const version = await getModelVersion('retro-diffusion/rd-plus', token);
    const outputUrl = await runPrediction(version, {
      prompt: prompts[tileType] || prompts.grass,
      style: 'isometric',
      width: 384,
      height: 384,
      num_images: 1
    }, token);

    costs.zoom += PRICES.ZOOM;
    updateCosts();

    preview.innerHTML = `<img src="${outputUrl}" alt="${tileType}" /><div style="font-size:9px;color:#666;padding:4px;">${tileType} (${x},${y}) - $${PRICES.ZOOM.toFixed(3)}</div>`;

  } catch (err) {
    preview.innerHTML = `<div class="placeholder" style="color:#f5576c;">Error: ${err.message}</div>`;
  }
}
