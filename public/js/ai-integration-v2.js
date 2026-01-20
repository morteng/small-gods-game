/**
 * Small Gods - AI Integration v2
 * SDXL ControlNet Union Pipeline via fal.ai
 *
 * Uses fal.ai's SDXL ControlNet Union which supports:
 * - Semantic segmentation ControlNet (ADE20K)
 * - Canny edge ControlNet
 * - img2img mode with ControlNets
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const AI_CONFIG = {
  provider: 'fal.ai',

  // Endpoints
  endpoint: 'fal-ai/sdxl-controlnet-union/image-to-image',  // img2img + controlnet
  endpoint_img2img_only: 'fal-ai/fast-sdxl/image-to-image', // img2img only (no controlnet)
  endpoint_t2i_controlnet: 'fal-ai/sdxl-controlnet-union',  // text-to-image + controlnet (fallback)

  cost_per_run: 0.02,

  generation: {
    size: 1024,
    steps: 30,
    guidance: 7.5,
    strength: 0.65  // img2img strength (lower = preserve more structure)
  },

  // ControlNet settings
  // Testing: segmentation with preprocess: true
  controlnet: {
    conditioningScale: 0.6,  // Overall ControlNet influence
    segmentation: {
      enabled: true,   // Testing with preprocess: true
      preprocess: true,  // Changed from false - API docs say default is true
      scale: 0.7
    },
    canny: {
      enabled: false,  // Disabled per user request
      preprocess: true,
      scale: 0.5
    }
  },

  // LoRA settings
  lora: {
    url: null,
    scale: 0.8
  }
};

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
  if (mapData?.tiles) {
    for (const row of mapData.tiles) {
      for (const tile of row) {
        if (!tile) continue;
        const tileType = window.WFC?.TILES?.[tile.type] || window.TileTypes?.[tile.type];
        const category = tileType?.category || 'terrain';
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
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

  const theme = visualTheme || 'fantasy medieval world, vibrant colors';

  return {
    prompt: `pixel art, 16-bit retro game style, top-down isometric view, 45 degree angle, fantasy game map with ${terrainDesc}, ${theme}, clean pixels, sharp edges, vibrant saturated colors, game asset, detailed pixel art textures`,
    negative_prompt: 'blurry, smooth, realistic, 3d render, photo, watermark, text, anti-aliased, gradient, soft, modern, photograph, jpeg artifacts'
  };
}

// =============================================================================
// CONTROL IMAGE GENERATION & PREVIEW
// =============================================================================

function generateControlImages() {
  if (!state.map) {
    console.warn('No map to generate control images from');
    return null;
  }

  const SIZE = AI_CONFIG.generation.size;

  // Generate segmentation map (color-coded terrain)
  const segCanvas = renderSegmentationMap(state.map, SIZE);
  state.controlImages.segmentation = segCanvas;

  // Generate edge map (tile outlines for canny ControlNet)
  const edgeCanvas = renderEdgeMap(state.map, SIZE);
  state.controlImages.edge = edgeCanvas;

  updateControlImagePreviews();
  console.log(`Control images generated at ${SIZE}x${SIZE}`);

  return state.controlImages;
}

function updateControlImagePreviews() {
  const container = document.getElementById('controlImagePreviews');
  if (!container) return;

  container.innerHTML = '';

  const images = [
    { key: 'segmentation', label: 'Segmentation', desc: 'ADE20K color-coded terrain' },
    { key: 'edge', label: 'Edge', desc: 'Tile boundaries for canny' }
  ];

  for (const img of images) {
    const canvas = state.controlImages[img.key];
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
  const canvas = state.controlImages[key];
  if (!canvas) return;

  const link = document.createElement('a');
  link.download = `${label.toLowerCase()}_map_${state.map?.seed || 'unknown'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// =============================================================================
// API HELPERS
// =============================================================================

async function runFalPrediction(endpoint, input) {
  console.log('[fal.ai] POST', endpoint);

  const res = await fetch(`/api/fal/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[fal.ai] Error:', err);
    throw new Error(`Prediction failed (${res.status}): ${err}`);
  }

  const result = await res.json();
  if (result.error) throw new Error(result.error);
  if (result.images?.[0]?.url) return result.images[0].url;
  throw new Error('No image in response');
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

// =============================================================================
// PROMPT PREVIEW
// =============================================================================

function showPromptPreview(prompt, negativePrompt, modeInfo) {
  console.log('=== AI Generation ===');
  console.log('Prompt:', prompt);
  console.log('Mode:', modeInfo);
  console.log('=====================');

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
// MAIN PAINT FUNCTION
// =============================================================================

async function paintWorldV2() {
  if (!state.map) {
    setStatus('Generate world first', 'error');
    return;
  }

  setButtonLoading('btnPaint', true);

  try {
    const SIZE = AI_CONFIG.generation.size;
    const { prompt, negative_prompt } = buildPrompt(state.map, state.worldSeed?.visualTheme);

    setStatus('Creating control images...', 'loading');

    // Generate all images at 1024x1024
    const baseMapCanvas = renderMap(state.map, SIZE);
    const baseMapUri = baseMapCanvas.toDataURL('image/png');

    const segCanvas = renderSegmentationMap(state.map, SIZE);
    const segUri = segCanvas.toDataURL('image/png');

    const edgeCanvas = renderEdgeMap(state.map, SIZE);
    const edgeUri = edgeCanvas.toDataURL('image/png');

    // Determine mode
    const useSegmentation = AI_CONFIG.controlnet.segmentation.enabled;
    const useCanny = AI_CONFIG.controlnet.canny.enabled;
    const useControlNets = useSegmentation || useCanny;

    // Build mode info for preview
    const modeInfo = useControlNets
      ? `img2img + ControlNet (seg: ${useSegmentation}, canny: ${useCanny})`
      : 'img2img only';
    showPromptPreview(prompt, negative_prompt, modeInfo);

    setStatus('Sending to fal.ai...', 'loading');

    // Build request - the image-to-image endpoint accepts both img2img AND controlnets
    const input = {
      image_url: baseMapUri,
      prompt: prompt,
      negative_prompt: negative_prompt,
      image_size: 'square_hd',
      num_inference_steps: AI_CONFIG.generation.steps,
      guidance_scale: AI_CONFIG.generation.guidance,
      strength: AI_CONFIG.generation.strength,
      seed: state.map.seed
    };

    // Add ControlNets if enabled
    if (useControlNets) {
      input.controlnet_conditioning_scale = AI_CONFIG.controlnet.conditioningScale;
    }

    if (useSegmentation) {
      // Official fal.ai parameter name
      input.segmentation_image_url = segUri;
      input.segmentation_preprocess = AI_CONFIG.controlnet.segmentation.preprocess;
      // Per-controlnet scale (if API supports it)
      input.segmentation_conditioning_scale = AI_CONFIG.controlnet.segmentation.scale;
    }

    if (useCanny) {
      input.canny_image_url = edgeUri;
      input.canny_preprocess = AI_CONFIG.controlnet.canny.preprocess;
      // Per-controlnet scale (if API supports it)
      input.canny_conditioning_scale = AI_CONFIG.controlnet.canny.scale;
    }

    // Add LoRA if configured
    if (AI_CONFIG.lora.url) {
      input.loras = [{ path: AI_CONFIG.lora.url, scale: AI_CONFIG.lora.scale }];
    }

    // Select endpoint
    const endpoint = useControlNets ? AI_CONFIG.endpoint : AI_CONFIG.endpoint_img2img_only;

    console.log('Request to:', endpoint);
    console.log('Keys:', Object.keys(input));
    console.log('Has segmentation_image_url:', !!input.segmentation_image_url);
    console.log('segmentation_image_url length:', input.segmentation_image_url?.length || 0);
    console.log('Full input (truncated URLs):', JSON.stringify({
      ...input,
      image_url: input.image_url?.substring(0, 50) + '...',
      segmentation_image_url: input.segmentation_image_url?.substring(0, 50) + '...',
      canny_image_url: input.canny_image_url?.substring(0, 50) + '...'
    }, null, 2));

    setStatus(`Generating via fal.ai (~30s)...`, 'loading');
    const outputUrl = await runFalPrediction(endpoint, input);

    // Track cost
    costs.paint = (costs.paint || 0) + AI_CONFIG.cost_per_run;
    updateCosts();

    // Load and display result
    setStatus('Loading result...', 'loading');
    const paintedImg = await loadImage(outputUrl);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = paintedImg.width;
    finalCanvas.height = paintedImg.height;
    finalCanvas.getContext('2d').drawImage(paintedImg, 0, 0);

    state.images.painted = finalCanvas;
    state.images.final = finalCanvas;
    updateTabStates();
    setLayer('painted');
    redraw();

    setStatus(`Map painted! Cost: $${AI_CONFIG.cost_per_run.toFixed(3)}`, 'success');
    setTimeout(hideStatus, 3000);

  } catch (err) {
    console.error('Paint error:', err);
    setStatus('Paint failed: ' + err.message, 'error');
  } finally {
    setButtonLoading('btnPaint', false);
  }
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
  // Checkboxes
  const segCheckbox = document.getElementById('chkSegmentation');
  const cannyCheckbox = document.getElementById('chkCanny');

  if (segCheckbox) {
    AI_CONFIG.controlnet.segmentation.enabled = segCheckbox.checked;
  }
  if (cannyCheckbox) {
    AI_CONFIG.controlnet.canny.enabled = cannyCheckbox.checked;
  }

  // Scales
  const segScale = document.getElementById('segScale');
  const cannyScale = document.getElementById('cannyScale');
  const i2iStrength = document.getElementById('i2iStrength');
  const cnScale = document.getElementById('cnScale');

  if (segScale) {
    AI_CONFIG.controlnet.segmentation.scale = segScale.value / 100;
  }
  if (cannyScale) {
    AI_CONFIG.controlnet.canny.scale = cannyScale.value / 100;
  }
  if (i2iStrength) {
    AI_CONFIG.generation.strength = i2iStrength.value / 100;
  }
  if (cnScale) {
    AI_CONFIG.controlnet.conditioningScale = cnScale.value / 100;
  }

  console.log('ControlNet config updated:', {
    segmentation: { enabled: AI_CONFIG.controlnet.segmentation.enabled, scale: AI_CONFIG.controlnet.segmentation.scale },
    canny: { enabled: AI_CONFIG.controlnet.canny.enabled, scale: AI_CONFIG.controlnet.canny.scale },
    i2iStrength: AI_CONFIG.generation.strength,
    conditioningScale: AI_CONFIG.controlnet.conditioningScale
  });
}

// Initialize UI to match config on page load
function initControlNetUI() {
  // Checkboxes
  const segCheckbox = document.getElementById('chkSegmentation');
  const cannyCheckbox = document.getElementById('chkCanny');

  if (segCheckbox) {
    segCheckbox.checked = AI_CONFIG.controlnet.segmentation.enabled;
  }
  if (cannyCheckbox) {
    cannyCheckbox.checked = AI_CONFIG.controlnet.canny.enabled;
  }

  // Sliders
  const segScale = document.getElementById('segScale');
  const cannyScale = document.getElementById('cannyScale');
  const i2iStrength = document.getElementById('i2iStrength');
  const cnScale = document.getElementById('cnScale');

  if (segScale) {
    segScale.value = AI_CONFIG.controlnet.segmentation.scale * 100;
    updateScaleLabel('seg');
  }
  if (cannyScale) {
    cannyScale.value = AI_CONFIG.controlnet.canny.scale * 100;
    updateScaleLabel('canny');
  }
  if (i2iStrength) {
    i2iStrength.value = AI_CONFIG.generation.strength * 100;
    updateScaleLabel('i2i');
  }
  if (cnScale) {
    const scale = AI_CONFIG.controlnet.conditioningScale || 0.6;
    cnScale.value = scale * 100;
    updateScaleLabel('cn');
  }
}

// Call init after DOM is ready
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
window.AI_CONFIG = AI_CONFIG;
window.buildPrompt = buildPrompt;
window.generateControlImages = generateControlImages;
window.updateControlImagePreviews = updateControlImagePreviews;
window.downloadControlImage = downloadControlImage;
window.showPromptPreview = showPromptPreview;
window.updateControlNetConfig = updateControlNetConfig;
window.initControlNetUI = initControlNetUI;
window.updateScaleLabel = updateScaleLabel;

console.log('AI Integration v2 loaded - fal.ai SDXL ControlNet Union');
