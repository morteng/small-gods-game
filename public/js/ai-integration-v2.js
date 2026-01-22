/**
 * Small Gods - AI Integration v2 (Refactored)
 * Multi-model support: FLUX.1 [dev] and SDXL ControlNet Union
 *
 * Features:
 * - img2img mode via image_url + strength
 * - Segmentation control (FLUX: easycontrols, SDXL: direct params)
 * - Canny edge detection
 * - Single-pass generation for maps ≤1024x1024
 * - Slice-based generation with overlap blending for larger maps
 */

// =============================================================================
// CONFIGURATION (uses shared constants when available)
// =============================================================================

// Current selected model (default: FLUX)
let currentModel = 'flux';

const AI_CONFIG = {
  provider: 'fal.ai',

  // Model-specific settings are loaded from AI_MODELS
  get model() {
    return window.AI_MODELS?.[currentModel.toUpperCase()] || window.AI_MODELS?.FLUX;
  },

  // Legacy endpoints (for backward compatibility)
  endpoint: 'fal-ai/flux-general/image-to-image',
  endpoint_img2img_only: 'fal-ai/flux/dev/image-to-image',

  cost_per_run: window.AI_DEFAULTS?.COST_PER_RUN || 0.025,

  generation: {
    size: window.SLICE_CONFIG?.SIZE || 512,
    maxSinglePass: window.SLICE_CONFIG?.MAX_SINGLE_PASS || 1024,
    steps: window.AI_DEFAULTS?.STEPS || 28,
    guidance: window.AI_DEFAULTS?.GUIDANCE || 3.5,
    strength: window.AI_DEFAULTS?.STRENGTH || 0.65
  },

  controlnet: {
    conditioningScale: 0.7,
    segmentation: {
      enabled: true,   // Enable by default for SDXL testing
      scale: 0.7
    },
    canny: {
      enabled: false,
      scale: 0.5
    }
  },

  lora: {
    url: null,
    scale: 0.8
  }
};

/**
 * Set the current AI model
 */
function setAIModel(modelId) {
  currentModel = modelId.toLowerCase();
  const model = AI_CONFIG.model;
  if (model) {
    // Update generation defaults from model config
    AI_CONFIG.generation.steps = model.defaults.steps;
    AI_CONFIG.generation.guidance = model.defaults.guidance;
    AI_CONFIG.generation.strength = model.defaults.strength;
    AI_CONFIG.cost_per_run = model.cost;

    // Update controlnet conditioning scale for SDXL
    if (model.controlnet?.conditioningScale) {
      AI_CONFIG.controlnet.conditioningScale = model.controlnet.conditioningScale;
    }

    console.log(`AI Model set to: ${model.name}`);
  }
}

/**
 * UI callback for model selection
 */
function updateAIModel() {
  const select = document.getElementById('aiModelSelect');
  const descEl = document.getElementById('modelDescription');
  if (select) {
    setAIModel(select.value);
    const model = AI_CONFIG.model;
    if (descEl && model) {
      descEl.textContent = model.description;
    }
    // Update UI sliders to match model defaults
    updateUIFromConfig();
  }
}

/**
 * Update UI sliders from current config
 */
function updateUIFromConfig() {
  const model = AI_CONFIG.model;
  if (!model) return;

  const strengthSlider = document.getElementById('i2iStrength');
  const strengthValue = document.getElementById('i2iStrengthValue');
  if (strengthSlider) {
    strengthSlider.value = Math.round(model.defaults.strength * 100);
    if (strengthValue) strengthValue.textContent = model.defaults.strength.toFixed(2);
  }

  const cnScaleSlider = document.getElementById('cnScale');
  const cnScaleValue = document.getElementById('cnScaleValue');
  const cnScale = model.controlnet?.conditioningScale || 0.7;
  if (cnScaleSlider) {
    cnScaleSlider.value = Math.round(cnScale * 100);
    if (cnScaleValue) cnScaleValue.textContent = cnScale.toFixed(2);
  }
}

// Use shared constants (access via RENDER_CONFIG to avoid global redeclaration)
const AI_OVERLAP = window.SLICE_CONFIG?.OVERLAP || 64;
const AI_CONTROL_METHODS = window.CONTROL_METHODS || { SEGMENTATION: 'seg', CANNY: 'canny' };

// =============================================================================
// PROMPT TEMPLATES
// =============================================================================

const TERRAIN_PROMPTS = {
  water: "crystal clear water, gentle ripples, reflective surface",
  deep_water: "deep ocean water, dark blue depths",
  shallow_water: "shallow turquoise water, sandy bottom visible",
  river: "flowing river, water current, stream",
  marsh: "marshy wetland, reeds, cattails",
  swamp: "dark swamp, murky water, moss",
  bog: "peat bog, dark water, mist",
  grass: "lush green grass, meadow",
  meadow: "flowering meadow, wildflowers",
  glen: "forest clearing, dappled sunlight",
  scrubland: "dry scrubland, sparse bushes",
  sand: "golden sand, beach",
  forest: "dense forest, green canopy, trees",
  dense_forest: "thick dark forest, overlapping trees",
  pine_forest: "evergreen pine forest, conifers",
  dead_forest: "dead forest, bare branches",
  hills: "rolling green hills, grassy slopes",
  rocky: "rocky terrain, boulders, stones",
  cliffs: "steep cliff face, layered rock",
  mountain: "mountain terrain, rocky peaks",
  peak: "snow-capped mountain peak",
  highland: "highland terrain, elevated",
  road: "dirt path, cobblestone road",
  building: "medieval cottage, stone walls",
  farm: "farmland, crop fields",
  terrain: "natural landscape",
  wetland: "wetland, marsh plants",
  shoreline: "coastal shoreline"
};

function buildPrompt(mapData, visualTheme = null) {
  const categoryCounts = {};
  const decorationFragments = new Set();

  if (mapData?.tiles) {
    for (const row of mapData.tiles) {
      for (const tile of row) {
        if (!tile) continue;
        const tileType = window.WFC?.TILES?.[tile.type] || window.TileTypes?.[tile.type];
        const category = tileType?.category || 'terrain';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;

        if (tile.decorations && window.DecorationRegistry) {
          for (const dec of tile.decorations) {
            const fragment = DecorationRegistry.getPromptFragment(dec.id);
            if (fragment) decorationFragments.add(fragment);
          }
        }
      }
    }
  }

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat]) => cat);

  const terrainDesc = topCategories
    .map(cat => TERRAIN_PROMPTS[cat])
    .filter(Boolean)
    .join(', ');

  const decorationDesc = Array.from(decorationFragments).slice(0, 5).join(', ');
  const theme = visualTheme || 'fantasy medieval world, vibrant colors';

  let fullPrompt = `pixel art, 16-bit retro game style, top-down isometric view, 45 degree angle, fantasy game map with ${terrainDesc}`;
  if (decorationDesc) fullPrompt += `, ${decorationDesc}`;
  fullPrompt += `, ${theme}, clean pixels, sharp edges, vibrant saturated colors, game asset, detailed pixel art textures`;

  return {
    prompt: fullPrompt,
    negative_prompt: 'blurry, smooth, realistic, 3d render, photo, watermark, text, anti-aliased, gradient, soft, modern, photograph, jpeg artifacts'
  };
}

// =============================================================================
// SHARED HELPERS (consolidated - no duplication)
// =============================================================================

/**
 * Create control canvases (base map + segmentation) for AI input
 */
function createControlCanvases(width, height, baseSource, segSource, srcX = 0, srcY = 0, srcWidth = null, srcHeight = null) {
  srcWidth = srcWidth || width;
  srcHeight = srcHeight || height;

  // Base map canvas
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = width;
  baseCanvas.height = height;
  const baseCtx = baseCanvas.getContext('2d');
  baseCtx.fillStyle = RENDER_CONFIG.BG_COLOR;
  baseCtx.fillRect(0, 0, width, height);

  if (baseSource) {
    baseCtx.drawImage(baseSource, srcX, srcY, srcWidth, srcHeight, 0, 0, srcWidth, srcHeight);
  }

  // Segmentation canvas
  const segCanvas = document.createElement('canvas');
  segCanvas.width = width;
  segCanvas.height = height;
  const segCtx = segCanvas.getContext('2d');
  segCtx.fillStyle = RENDER_CONFIG.SEG_BACKGROUND;
  segCtx.fillRect(0, 0, width, height);

  if (segSource) {
    segCtx.drawImage(segSource, srcX, srcY, srcWidth, srcHeight, 0, 0, srcWidth, srcHeight);
  }

  return { baseCanvas, segCanvas };
}

/**
 * Build the fal.ai API input object (model-aware)
 */
function buildFalInput(imageUrl, prompt, width, height, controls = {}) {
  const model = AI_CONFIG.model;
  const isSDXL = currentModel === 'sdxl';

  // Common parameters
  const input = {
    image_url: imageUrl,
    prompt: prompt,
    num_inference_steps: AI_CONFIG.generation.steps,
    guidance_scale: AI_CONFIG.generation.guidance,
    strength: AI_CONFIG.generation.strength,
    seed: state.map?.seed || Date.now(),
    sync_mode: true,
    enable_safety_checker: false
  };

  // Image size handling differs by model
  if (isSDXL) {
    // SDXL uses image_size as object or preset string
    input.image_size = { width, height };
  } else {
    // FLUX uses image_size object
    input.image_size = { width, height };
  }

  if (isSDXL) {
    // SDXL ControlNet Union: Direct parameters
    input.controlnet_conditioning_scale = AI_CONFIG.controlnet.conditioningScale;

    if (controls.segmentation?.enabled && controls.segmentation?.url) {
      input.segmentation_image_url = controls.segmentation.url;
      input.segmentation_preprocess = true;  // Let SDXL preprocess the image
    }

    if (controls.canny?.enabled && controls.canny?.url) {
      input.canny_image_url = controls.canny.url;
      input.canny_preprocess = true;  // Let SDXL preprocess the image
    }

    // SDXL supports negative prompts well
    input.negative_prompt = "blurry, low quality, distorted, deformed, ugly, bad anatomy";
  } else {
    // FLUX: easycontrols array
    const easycontrols = [];

    if (controls.segmentation?.enabled && controls.segmentation?.url) {
      easycontrols.push({
        control_method_url: AI_CONTROL_METHODS.SEGMENTATION,
        image_url: controls.segmentation.url,
        image_control_type: 'spatial',
        scale: AI_CONFIG.controlnet.segmentation.scale
      });
    }

    if (controls.canny?.enabled && controls.canny?.url) {
      easycontrols.push({
        control_method_url: AI_CONTROL_METHODS.CANNY,
        image_url: controls.canny.url,
        image_control_type: 'spatial',
        scale: AI_CONFIG.controlnet.canny.scale
      });
    }

    if (easycontrols.length > 0) {
      input.easycontrols = easycontrols;
    }

    // Add LoRA if configured (FLUX only)
    if (AI_CONFIG.lora.url) {
      input.loras = [{ path: AI_CONFIG.lora.url, scale: AI_CONFIG.lora.scale }];
    }
  }

  return input;
}

/**
 * Run a fal.ai prediction
 */
async function runFalPrediction(endpoint, input) {
  console.log('[fal.ai] POST', endpoint);

  const res = await fetch(`/api/fal/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[fal.ai] Error:', res.status, err);
    throw new Error(`Prediction failed (${res.status}): ${err}`);
  }

  const result = await res.json();

  if (result.error) {
    throw new Error(result.error);
  }

  if (result.images?.[0]?.url) {
    console.log('[fal.ai] Got image:', result.images[0].width, 'x', result.images[0].height);
    return result.images[0].url;
  }

  throw new Error('No image in response');
}

/**
 * Upload image to fal.ai CDN (for SDXL which requires HTTP URLs)
 * @param {string} dataUrl - Base64 data URL of the image
 * @param {string} filename - Name for the uploaded file
 * @returns {Promise<string>} - Public HTTP URL of the uploaded image
 */
async function uploadToFalCDN(dataUrl, filename = 'image.png') {
  console.log('[fal CDN] Uploading:', filename, `(${Math.round(dataUrl.length / 1024)}KB)`);

  const response = await fetch('/api/fal/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataUrl,
      filename,
      contentType: 'image/png'
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`CDN upload failed: ${err}`);
  }

  const result = await response.json();
  console.log('[fal CDN] Uploaded:', result.url);
  return result.url;
}

/**
 * Prepare control images for the current model
 * For SDXL: uploads to CDN and returns HTTP URLs
 * For FLUX: returns data URIs directly
 */
async function prepareControlImages(baseUri, segUri, edgeUri) {
  const isSDXL = currentModel === 'sdxl';

  if (!isSDXL) {
    // FLUX accepts data URIs directly
    return { baseUrl: baseUri, segUrl: segUri, edgeUrl: edgeUri };
  }

  // SDXL requires HTTP URLs - upload to fal.ai CDN
  console.log('[SDXL] Uploading images to fal.ai CDN...');

  const uploads = await Promise.all([
    uploadToFalCDN(baseUri, 'base_map.png'),
    segUri ? uploadToFalCDN(segUri, 'segmentation.png') : null,
    edgeUri ? uploadToFalCDN(edgeUri, 'edge.png') : null
  ]);

  return {
    baseUrl: uploads[0],
    segUrl: uploads[1],
    edgeUrl: uploads[2]
  };
}

/**
 * Load an image from URL
 */
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
 * Save painted image
 */
async function savePaintedImage(canvas, filename) {
  const dataUrl = canvas.toDataURL('image/png');

  try {
    const response = await fetch('/api/save-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, dataUrl })
    });
    if (response.ok) {
      console.log(`Saved: output/${filename}`);
      return;
    }
  } catch (err) {
    // Fall through to download
  }

  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

/**
 * Track cost and update UI
 */
function trackCost() {
  costs.paint = (costs.paint || 0) + AI_CONFIG.cost_per_run;
  updateCosts();
}

/**
 * Get control settings from config
 */
function getControlSettings() {
  const useSegmentation = AI_CONFIG.controlnet.segmentation.enabled;
  const useCanny = AI_CONFIG.controlnet.canny.enabled;
  const useControls = useSegmentation || useCanny;

  return { useSegmentation, useCanny, useControls };
}

/**
 * Get the appropriate endpoint based on model and control settings
 */
function getEndpoint(useControls) {
  const model = AI_CONFIG.model;
  const isSDXL = currentModel === 'sdxl';

  if (isSDXL) {
    // SDXL always uses the same img2img endpoint (controls are direct params)
    return model.endpoints.img2img;
  } else {
    // FLUX: use general endpoint if controls needed, otherwise img2img_only
    return useControls ? model.endpoints.img2img : model.endpoints.img2img_only;
  }
}

// =============================================================================
// PROMPT PREVIEW
// =============================================================================

function showPromptPreview(prompt, negativePrompt, modeInfo) {
  console.log('=== AI Generation ===');
  console.log('Prompt:', prompt);
  console.log('Mode:', modeInfo);

  const previewEl = document.getElementById('promptPreview');
  if (previewEl) {
    previewEl.innerHTML = `
      <div class="prompt-preview">
        <h4>Prompt Preview</h4>
        <div class="prompt-section">
          <label>Positive:</label>
          <div class="prompt-text">${prompt}</div>
        </div>
        <div class="prompt-section">
          <label>Negative:</label>
          <div class="prompt-text negative">${negativePrompt}</div>
        </div>
        <div class="prompt-section">
          <label>Mode:</label>
          <div class="prompt-text controlnet">${modeInfo}</div>
        </div>
      </div>
    `;
    previewEl.style.display = 'block';
  }
}

// =============================================================================
// MAIN PAINT FUNCTION - Smart routing
// =============================================================================

/**
 * Main paint entry point - automatically chooses best method
 */
async function paintWorldV2() {
  if (!state.map) {
    setStatus('Generate world first', 'error');
    return;
  }

  const bounds = window.getMapIsoBounds?.(state.map);
  if (!bounds) {
    setStatus('Could not calculate map bounds', 'error');
    return;
  }

  const MAX_SINGLE = AI_CONFIG.generation.maxSinglePass;

  console.log(`paintWorldV2: Map ${bounds.width}x${bounds.height}, max single: ${MAX_SINGLE}`);

  if (bounds.width <= MAX_SINGLE && bounds.height <= MAX_SINGLE) {
    console.log('Using SINGLE-PASS generation');
    await paintMapSinglePass(bounds);
  } else {
    console.log('Using SLICE-BASED generation');
    await paintMapSliced();
  }
}

// =============================================================================
// SINGLE-PASS GENERATION
// =============================================================================

/**
 * Single-pass generation for maps ≤1024x1024
 */
async function paintMapSinglePass(bounds) {
  setButtonLoading('btnPaint', true);

  // Clear stale slice overlay
  sliceState.overlayVisible = false;
  removeSliceOverlay();

  try {
    const { prompt, negative_prompt } = buildPrompt(state.map, state.worldSeed?.visualTheme);
    const { useSegmentation, useCanny, useControls } = getControlSettings();

    // Calculate square size (pad to largest dimension)
    const squareSize = Math.min(AI_CONFIG.generation.maxSinglePass, Math.max(bounds.width, bounds.height));
    const offsetX = Math.floor((squareSize - bounds.width) / 2);
    const offsetY = Math.floor((squareSize - bounds.height) / 2);

    console.log(`Single-pass: ${bounds.width}x${bounds.height} → ${squareSize}x${squareSize}`);

    setStatus('Creating input images...', 'loading');

    // Create padded canvases
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = squareSize;
    baseCanvas.height = squareSize;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.fillStyle = RENDER_CONFIG.BG_COLOR;
    baseCtx.fillRect(0, 0, squareSize, squareSize);
    if (state.images.segment) {
      baseCtx.drawImage(state.images.segment, offsetX, offsetY);
    }

    const segCanvas = document.createElement('canvas');
    segCanvas.width = squareSize;
    segCanvas.height = squareSize;
    const segCtx = segCanvas.getContext('2d');
    segCtx.fillStyle = RENDER_CONFIG.SEG_BACKGROUND;
    segCtx.fillRect(0, 0, squareSize, squareSize);
    if (state.controlImages?.segmentation) {
      segCtx.drawImage(state.controlImages.segmentation, offsetX, offsetY);
    }

    const edgeCanvas = document.createElement('canvas');
    edgeCanvas.width = squareSize;
    edgeCanvas.height = squareSize;
    const edgeCtx = edgeCanvas.getContext('2d');
    edgeCtx.fillStyle = '#000000';
    edgeCtx.fillRect(0, 0, squareSize, squareSize);
    if (state.controlImages?.edge) {
      edgeCtx.drawImage(state.controlImages.edge, offsetX, offsetY);
    }

    const baseUri = baseCanvas.toDataURL('image/png');
    const segUri = segCanvas.toDataURL('image/png');
    const edgeUri = edgeCanvas.toDataURL('image/png');

    const modelName = AI_CONFIG.model?.name || 'FLUX';
    const modeInfo = useControls
      ? `${modelName} single-pass + controls (seg: ${useSegmentation}, canny: ${useCanny})`
      : `${modelName} single-pass img2img ${squareSize}x${squareSize}`;
    showPromptPreview(prompt, negative_prompt, modeInfo);

    // For SDXL, upload images to CDN first (required for HTTP URLs)
    const isSDXL = currentModel === 'sdxl';
    let imageUrls;
    if (isSDXL && (useSegmentation || useCanny)) {
      setStatus('Uploading images to fal.ai CDN...', 'loading');
      imageUrls = await prepareControlImages(baseUri, useSegmentation ? segUri : null, useCanny ? edgeUri : null);
    } else {
      imageUrls = { baseUrl: baseUri, segUrl: segUri, edgeUrl: edgeUri };
    }

    setStatus(`Generating ${squareSize}x${squareSize}...`, 'loading');

    // Build API input with consistent control settings
    const input = buildFalInput(imageUrls.baseUrl, prompt, squareSize, squareSize, {
      segmentation: { enabled: useSegmentation, url: imageUrls.segUrl },
      canny: { enabled: useCanny, url: imageUrls.edgeUrl }
    });

    const endpoint = getEndpoint(useControls);
    const outputUrl = await runFalPrediction(endpoint, input);

    trackCost();

    setStatus('Loading result...', 'loading');
    const paintedImg = await loadImage(outputUrl);

    // Crop back to actual bounds
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = bounds.width;
    finalCanvas.height = bounds.height;
    const ctx = finalCanvas.getContext('2d');
    ctx.drawImage(paintedImg, offsetX, offsetY, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);

    state.images.painted = finalCanvas;
    state.images.final = finalCanvas;

    // Save
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    savePaintedImage(finalCanvas, `painted_${state.map.seed}_${timestamp}.png`);

    updateTabStates();
    setLayer('painted');
    redraw();

    setStatus(`Painted! Cost: $${AI_CONFIG.cost_per_run.toFixed(3)}`, 'success');
    setTimeout(hideStatus, 3000);

  } catch (err) {
    console.error('Paint error:', err);
    setStatus('Paint failed: ' + err.message, 'error');
  } finally {
    setButtonLoading('btnPaint', false);
  }
}

// =============================================================================
// SLICE-BASED GENERATION
// =============================================================================

const sliceState = {
  slices: [],
  overlayVisible: false,
  selectedSlice: null
};

/**
 * Slice-based generation for maps >1024x1024
 */
async function paintMapSliced() {
  setButtonLoading('btnPaint', true);

  try {
    calculateSlices();
    sliceState.overlayVisible = true;
    drawSliceOverlay();

    setStatus(`Painting ${sliceState.slices.length} slices...`, 'loading');

    for (let i = 0; i < sliceState.slices.length; i++) {
      const slice = sliceState.slices[i];
      setStatus(`Painting slice ${i + 1}/${sliceState.slices.length}...`, 'loading');
      await paintSlice(slice.id);
    }

    setStatus('All slices complete!', 'success');
    setTimeout(hideStatus, 3000);

  } catch (err) {
    console.error('Sliced paint error:', err);
    setStatus('Paint failed: ' + err.message, 'error');
  } finally {
    setButtonLoading('btnPaint', false);
  }
}

/**
 * Calculate slices for map
 */
function calculateSlices() {
  if (!state.map) return [];

  const bounds = window.getMapIsoBounds?.(state.map);
  if (!bounds) return [];

  const SIZE = AI_CONFIG.generation.size;
  const STEP = SIZE - AI_OVERLAP;
  const slices = [];
  let row = 0;

  for (let y = 0; y < bounds.height; y += STEP) {
    let col = 0;
    for (let x = 0; x < bounds.width; x += STEP) {
      const sliceWidth = Math.min(SIZE, bounds.width - x);
      const sliceHeight = Math.min(SIZE, bounds.height - y);

      if (sliceWidth > AI_OVERLAP && sliceHeight > AI_OVERLAP) {
        slices.push({
          id: `slice_${row}_${col}`,
          row, col, x, y,
          width: sliceWidth,
          height: sliceHeight,
          painted: null,
          status: 'pending'
        });
      }
      col++;
    }
    row++;
  }

  console.log(`Map requires ${slices.length} slices (${bounds.width}x${bounds.height})`);
  sliceState.slices = slices;
  return slices;
}

/**
 * Paint a single slice
 */
async function paintSlice(sliceId) {
  const slice = sliceState.slices.find(s => s.id === sliceId);
  if (!slice || slice.status === 'rendering') return;

  slice.status = 'rendering';
  drawSliceOverlay();

  try {
    const SIZE = AI_CONFIG.generation.size;
    const { prompt } = buildPrompt(state.map, state.worldSeed?.visualTheme);
    const { useSegmentation, useCanny, useControls } = getControlSettings();

    // Create slice canvases
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = SIZE;
    baseCanvas.height = SIZE;
    const baseCtx = baseCanvas.getContext('2d');
    baseCtx.fillStyle = RENDER_CONFIG.BG_COLOR;
    baseCtx.fillRect(0, 0, SIZE, SIZE);

    if (state.images.segment) {
      baseCtx.drawImage(state.images.segment, slice.x, slice.y, slice.width, slice.height, 0, 0, slice.width, slice.height);
    }

    // Add outpainting context from adjacent painted slices
    addOutpaintingContext(baseCtx, slice);

    const segCanvas = document.createElement('canvas');
    segCanvas.width = SIZE;
    segCanvas.height = SIZE;
    const segCtx = segCanvas.getContext('2d');
    segCtx.fillStyle = RENDER_CONFIG.SEG_BACKGROUND;
    segCtx.fillRect(0, 0, SIZE, SIZE);

    if (state.controlImages?.segmentation) {
      segCtx.drawImage(state.controlImages.segmentation, slice.x, slice.y, slice.width, slice.height, 0, 0, slice.width, slice.height);
    }

    const edgeCanvas = document.createElement('canvas');
    edgeCanvas.width = SIZE;
    edgeCanvas.height = SIZE;
    const edgeCtx = edgeCanvas.getContext('2d');
    edgeCtx.fillStyle = '#000000';
    edgeCtx.fillRect(0, 0, SIZE, SIZE);

    if (state.controlImages?.edge) {
      edgeCtx.drawImage(state.controlImages.edge, slice.x, slice.y, slice.width, slice.height, 0, 0, slice.width, slice.height);
    }

    const baseUri = baseCanvas.toDataURL('image/png');
    const segUri = segCanvas.toDataURL('image/png');
    const edgeUri = edgeCanvas.toDataURL('image/png');

    // For SDXL, upload images to CDN first (required for HTTP URLs)
    const isSDXL = currentModel === 'sdxl';
    let imageUrls;
    if (isSDXL && (useSegmentation || useCanny)) {
      imageUrls = await prepareControlImages(baseUri, useSegmentation ? segUri : null, useCanny ? edgeUri : null);
    } else {
      imageUrls = { baseUrl: baseUri, segUrl: segUri, edgeUrl: edgeUri };
    }

    // Build API input with SAME control settings as single-pass (consistency fix)
    const input = buildFalInput(imageUrls.baseUrl, prompt, SIZE, SIZE, {
      segmentation: { enabled: useSegmentation, url: imageUrls.segUrl },
      canny: { enabled: useCanny, url: imageUrls.edgeUrl }
    });

    const endpoint = getEndpoint(useControls);
    const outputUrl = await runFalPrediction(endpoint, input);

    const paintedImg = await loadImage(outputUrl);

    const paintedCanvas = document.createElement('canvas');
    paintedCanvas.width = SIZE;
    paintedCanvas.height = SIZE;
    paintedCanvas.getContext('2d').drawImage(paintedImg, 0, 0, SIZE, SIZE);

    slice.painted = paintedCanvas;
    slice.status = 'complete';

    trackCost();
    compositeSlices();
    drawSliceOverlay();

    setStatus(`Slice ${slice.row},${slice.col} complete!`, 'success');

  } catch (err) {
    console.error('Slice paint error:', err);
    slice.status = 'pending';
    drawSliceOverlay();
    setStatus(`Slice failed: ${err.message}`, 'error');
  }
}

/**
 * Add outpainting context from adjacent painted slices
 */
function addOutpaintingContext(ctx, slice) {
  // Left slice
  const leftSlice = sliceState.slices.find(s => s.row === slice.row && s.col === slice.col - 1);
  if (leftSlice?.painted) {
    const srcX = leftSlice.width - AI_OVERLAP;
    ctx.drawImage(leftSlice.painted, srcX, 0, AI_OVERLAP, leftSlice.height, 0, 0, AI_OVERLAP, slice.height);
  }

  // Above slice
  const aboveSlice = sliceState.slices.find(s => s.row === slice.row - 1 && s.col === slice.col);
  if (aboveSlice?.painted) {
    const srcY = aboveSlice.height - AI_OVERLAP;
    ctx.drawImage(aboveSlice.painted, 0, srcY, aboveSlice.width, AI_OVERLAP, 0, 0, slice.width, AI_OVERLAP);
  }

  // Diagonal slice
  const diagSlice = sliceState.slices.find(s => s.row === slice.row - 1 && s.col === slice.col - 1);
  if (diagSlice?.painted) {
    const srcX = diagSlice.width - AI_OVERLAP;
    const srcY = diagSlice.height - AI_OVERLAP;
    ctx.drawImage(diagSlice.painted, srcX, srcY, AI_OVERLAP, AI_OVERLAP, 0, 0, AI_OVERLAP, AI_OVERLAP);
  }
}

/**
 * Composite all painted slices with alpha blending (FIXED gradient direction)
 */
function compositeSlices() {
  const bounds = window.getMapIsoBounds?.(state.map);
  if (!bounds) return;

  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');

  // Start with base map
  if (state.images.segment) {
    ctx.drawImage(state.images.segment, 0, 0);
  }

  const BLEND_SIZE = AI_OVERLAP;

  // Sort slices for consistent layering
  const sortedSlices = [...sliceState.slices].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  for (const slice of sortedSlices) {
    if (!slice.painted) continue;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = slice.width;
    tempCanvas.height = slice.height;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.drawImage(slice.painted, 0, 0, slice.width, slice.height);

    // FIX: Correct gradient direction for alpha blending
    // For destination-out: alpha 1 = erase, alpha 0 = keep
    // We want to FADE the edge (erase at edge, keep inside)
    if (slice.col > 0) {
      const gradient = tempCtx.createLinearGradient(0, 0, BLEND_SIZE, 0);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');  // Erase at left edge
      gradient.addColorStop(1, 'rgba(0,0,0,0)');  // Keep inside
      tempCtx.globalCompositeOperation = 'destination-out';
      tempCtx.fillStyle = gradient;
      tempCtx.fillRect(0, 0, BLEND_SIZE, slice.height);
      tempCtx.globalCompositeOperation = 'source-over';
    }

    if (slice.row > 0) {
      const gradient = tempCtx.createLinearGradient(0, 0, 0, BLEND_SIZE);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');  // Erase at top edge
      gradient.addColorStop(1, 'rgba(0,0,0,0)');  // Keep inside
      tempCtx.globalCompositeOperation = 'destination-out';
      tempCtx.fillStyle = gradient;
      tempCtx.fillRect(0, 0, slice.width, BLEND_SIZE);
      tempCtx.globalCompositeOperation = 'source-over';
    }

    ctx.drawImage(tempCanvas, slice.x, slice.y);
  }

  state.images.painted = canvas;
  state.images.final = canvas;
  updateTabStates();
}

// =============================================================================
// SLICE OVERLAY UI
// =============================================================================

function toggleSliceOverlay() {
  sliceState.overlayVisible = !sliceState.overlayVisible;
  if (sliceState.overlayVisible) {
    calculateSlices();
    drawSliceOverlay();
  } else {
    removeSliceOverlay();
  }
}

function drawSliceOverlay() {
  removeSliceOverlay();

  const canvas = document.getElementById('gameCanvas');
  if (!canvas || sliceState.slices.length === 0) return;

  const overlay = document.createElement('div');
  overlay.id = 'sliceOverlay';

  for (const slice of sliceState.slices) {
    const div = document.createElement('div');
    div.className = 'slice-region';
    div.dataset.sliceId = slice.id;

    const isPainted = slice.painted;
    const isRendering = slice.status === 'rendering';

    div.style.cssText = `
      position: absolute;
      left: ${slice.x}px;
      top: ${slice.y}px;
      width: ${slice.width}px;
      height: ${slice.height}px;
      border: 2px solid ${isPainted ? '#4CAF50' : '#FF9800'};
      background: ${isPainted ? 'rgba(76, 175, 80, 0.1)' : 'rgba(255, 152, 0, 0.15)'};
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
      color: white;
      text-shadow: 0 0 4px black;
      box-sizing: border-box;
    `;

    div.innerHTML = `<span>${slice.row},${slice.col}<br>${isPainted ? '✓' : isRendering ? '⏳' : 'Click'}</span>`;
    div.addEventListener('click', () => paintSlice(slice.id));

    overlay.appendChild(div);
  }

  canvas.parentNode.insertBefore(overlay, canvas.nextSibling);

  function syncOverlay() {
    const style = window.getComputedStyle(canvas);
    overlay.style.cssText = `
      position: absolute;
      left: ${canvas.offsetLeft}px;
      top: ${canvas.offsetTop}px;
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      pointer-events: none;
      z-index: 100;
      transform-origin: ${style.transformOrigin};
      transform: ${style.transform};
    `;
  }

  syncOverlay();
  const observer = new MutationObserver(syncOverlay);
  observer.observe(canvas, { attributes: true, attributeFilter: ['style'] });
  overlay._observer = observer;
}

function removeSliceOverlay() {
  const existing = document.getElementById('sliceOverlay');
  if (existing) {
    if (existing._observer) existing._observer.disconnect();
    existing.remove();
  }
}

// =============================================================================
// CONTROL IMAGE MANAGEMENT
// =============================================================================

function generateControlImages() {
  if (!state.map) return null;

  // Use cached if available
  if (state.controlImages?.segmentation && state.controlImages?.edge) {
    console.log('Using cached control images');
    updateControlImagePreviews();
    return state.controlImages;
  }

  const SIZE = AI_CONFIG.generation.size;

  // Generate fresh control images
  console.log('Generating control images...');

  if (typeof renderSegmentationMap === 'function') {
    state.controlImages.segmentation = renderSegmentationMap(state.map, SIZE);
  }

  if (typeof renderEdgeMap === 'function') {
    state.controlImages.edge = renderEdgeMap(state.map, SIZE);
  }

  updateControlImagePreviews();
  console.log(`Control images generated at ${SIZE}x${SIZE}`);

  return state.controlImages;
}

function updateControlImagePreviews() {
  const container = document.getElementById('controlImagePreviews');
  if (!container) return;

  container.innerHTML = '';

  const images = [
    { key: 'segmentation', label: 'Segmentation', desc: 'ADE20K colors' },
    { key: 'edge', label: 'Edge', desc: 'Canny edges' }
  ];

  for (const img of images) {
    const canvas = state.controlImages?.[img.key];
    if (!canvas) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'control-image-item';

    const label = document.createElement('div');
    label.className = 'control-image-label';
    label.textContent = img.label;

    const preview = document.createElement('canvas');
    preview.width = 150;
    preview.height = 150;
    preview.className = 'control-image-preview';
    preview.title = img.desc;

    const pctx = preview.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.drawImage(canvas, 0, 0, 150, 150);

    preview.onclick = () => downloadControlImage(img.key, img.label);

    wrapper.appendChild(label);
    wrapper.appendChild(preview);
    container.appendChild(wrapper);
  }
}

function downloadControlImage(key, label) {
  const canvas = state.controlImages?.[key];
  if (!canvas) return;

  const link = document.createElement('a');
  link.download = `${label.toLowerCase()}_map_${state.map?.seed || 'unknown'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// =============================================================================
// UI CONTROL FUNCTIONS
// =============================================================================

function updateScaleLabel(type) {
  const labelMap = {
    seg: { slider: 'segScale', label: 'segScaleValue' },
    canny: { slider: 'cannyScale', label: 'cannyScaleValue' },
    i2i: { slider: 'i2iStrength', label: 'i2iStrengthValue' },
    cn: { slider: 'cnScale', label: 'cnScaleValue' }
  };

  const mapping = labelMap[type];
  if (!mapping) return;

  const slider = document.getElementById(mapping.slider);
  const label = document.getElementById(mapping.label);
  if (slider && label) {
    label.textContent = (slider.value / 100).toFixed(2);
  }
}

function updateControlNetConfig() {
  const segCheckbox = document.getElementById('chkSegmentation');
  const cannyCheckbox = document.getElementById('chkCanny');

  if (segCheckbox) AI_CONFIG.controlnet.segmentation.enabled = segCheckbox.checked;
  if (cannyCheckbox) AI_CONFIG.controlnet.canny.enabled = cannyCheckbox.checked;

  const segScale = document.getElementById('segScale');
  const cannyScale = document.getElementById('cannyScale');
  const i2iStrength = document.getElementById('i2iStrength');
  const cnScale = document.getElementById('cnScale');

  if (segScale) AI_CONFIG.controlnet.segmentation.scale = segScale.value / 100;
  if (cannyScale) AI_CONFIG.controlnet.canny.scale = cannyScale.value / 100;
  if (i2iStrength) AI_CONFIG.generation.strength = i2iStrength.value / 100;
  if (cnScale) AI_CONFIG.controlnet.conditioningScale = cnScale.value / 100;

  console.log('Config updated:', {
    seg: AI_CONFIG.controlnet.segmentation,
    canny: AI_CONFIG.controlnet.canny,
    strength: AI_CONFIG.generation.strength
  });
}

function initControlNetUI() {
  const segCheckbox = document.getElementById('chkSegmentation');
  const cannyCheckbox = document.getElementById('chkCanny');

  if (segCheckbox) segCheckbox.checked = AI_CONFIG.controlnet.segmentation.enabled;
  if (cannyCheckbox) cannyCheckbox.checked = AI_CONFIG.controlnet.canny.enabled;

  const segScale = document.getElementById('segScale');
  const cannyScale = document.getElementById('cannyScale');
  const i2iStrength = document.getElementById('i2iStrength');
  const cnScale = document.getElementById('cnScale');

  if (segScale) { segScale.value = AI_CONFIG.controlnet.segmentation.scale * 100; updateScaleLabel('seg'); }
  if (cannyScale) { cannyScale.value = AI_CONFIG.controlnet.canny.scale * 100; updateScaleLabel('canny'); }
  if (i2iStrength) { i2iStrength.value = AI_CONFIG.generation.strength * 100; updateScaleLabel('i2i'); }
  if (cnScale) { cnScale.value = (AI_CONFIG.controlnet.conditioningScale || 0.6) * 100; updateScaleLabel('cn'); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initControlNetUI);
} else {
  setTimeout(initControlNetUI, 0);
}

// =============================================================================
// EXPORTS
// =============================================================================

window.paintWorld = paintWorldV2;
window.paintWorldV2 = paintWorldV2;
window.paintMapSinglePass = paintMapSinglePass;
window.paintMapSliced = paintMapSliced;
window.AI_CONFIG = AI_CONFIG;
window.buildPrompt = buildPrompt;
window.generateControlImages = generateControlImages;
window.updateControlImagePreviews = updateControlImagePreviews;
window.downloadControlImage = downloadControlImage;
window.showPromptPreview = showPromptPreview;
window.updateControlNetConfig = updateControlNetConfig;
window.initControlNetUI = initControlNetUI;
window.updateScaleLabel = updateScaleLabel;
window.toggleSliceOverlay = toggleSliceOverlay;
window.calculateSlices = calculateSlices;
window.paintSlice = paintSlice;
window.paintAllSlices = paintMapSliced;
window.sliceState = sliceState;

// Model selection
window.setAIModel = setAIModel;
window.updateAIModel = updateAIModel;
window.updateUIFromConfig = updateUIFromConfig;
window.currentModel = currentModel;

// CDN upload (for SDXL)
window.uploadToFalCDN = uploadToFalCDN;
window.prepareControlImages = prepareControlImages;

console.log('AI Integration v2 loaded (multi-model: FLUX + SDXL with CDN upload)');
