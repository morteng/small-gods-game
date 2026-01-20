# AI Rendering Setup for Pixel Art Isometric Tilemaps

## Overview

This document defines the optimal setup for generating AI-rendered pixel art isometric tilemaps using cloud APIs (Replicate/fal.ai) with ControlNet segmentation and pixel art LoRAs.

---

## 1. Model Selection

### Primary: Replicate - fofr/sdxl-multi-controlnet-lora
**URL:** https://replicate.com/fofr/sdxl-multi-controlnet-lora

| Feature | Value |
|---------|-------|
| Cost | ~$0.017/run |
| GPU | Nvidia L40S |
| Time | ~18 seconds |
| ControlNets | Up to 3 simultaneous |
| LoRA Support | Yes (Replicate format) |
| Modes | txt2img, img2img, inpainting |

**Why this model:**
- Combines ControlNet + LoRA in single API call
- Supports segmentation-based conditioning
- Can load custom LoRAs from URLs
- Better structure preservation than vanilla img2img

### Alternative: fal.ai - fal-ai/sdxl-controlnet-union
**URL:** https://fal.ai/models/fal-ai/sdxl-controlnet-union

| Feature | Value |
|---------|-------|
| Control Types | openpose, depth, teed, canny, seg |
| LoRA Support | Yes (multiple) |
| Speed | Fast |

---

## 2. LoRA Configuration

### Pixel Art LoRA (Required)

**Pixel Art XL** - Best for isometric pixel art
```
Source: https://huggingface.co/nerijs/pixel-art-xl
File: pixel-art-xl.safetensors
Trigger: None required (trained without trigger)
```

**Optimal Settings:**
```javascript
{
  lora_url: "https://huggingface.co/nerijs/pixel-art-xl/resolve/main/pixel-art-xl.safetensors",
  lora_scale: 1.2,  // Strong for pronounced pixel art
}
```

### Alternative LoRAs

**Z Image Turbo Pixel Art** (Better dithering)
```
Source: https://huggingface.co/tarn59/pixel_art_style_z_image_turbo
File: pixel_art_style_z_image_turbo.safetensors
```

**Isometric Tile Map LoRA** (Direct isometric support)
```
Source: https://civitai.com/models/360113/stylexl-isometric-tile-map
Trigger: "isometric tile map"
```

---

## 3. Segmentation Map Configuration

### Current ADE20K Colors (Keep As-Is)
Your existing `segColor` definitions are correct for ControlNet seg models:

```javascript
const ADE20K = {
  TREE: '#04C803',      // Forests
  GRASS: '#04FA07',     // Grass, meadow
  WATER: '#3DE6FA',     // Water, rivers
  SEA: '#0907E6',       // Deep water
  MOUNTAIN: '#8FFF8C',  // Mountains, peaks
  SAND: '#A09614',      // Sand, beach
  ROAD: '#8C8C8C',      // Paths, roads
  BUILDING: '#B47878',  // Buildings
  EARTH: '#787846',     // Dirt, ground
  ROCK: '#FF290A',      // Rocky terrain
  WALL: '#787878',      // Walls
  FLOOR: '#503232',     // Interior floor
  PLANT: '#28C828',     // Farm fields
  SWAMP: '#404020'      // Wetland
};
```

### Segmentation Output Requirements
```javascript
{
  format: 'PNG',
  size: 1024,           // SDXL optimal
  background: '#000000', // Black
  mode: 'flat_diamond', // No shading, no height
}
```

---

## 4. Prompt Templates

### Base Prompt Structure
```javascript
const BASE_PROMPT = {
  style: "pixel art, 16-bit, retro game style",
  view: "top-down isometric view, 45 degree angle",
  quality: "clean pixels, sharp edges, no anti-aliasing, game asset",
  negative: "blurry, smooth, realistic, 3d render, photo, watermark, text, signature, anti-aliased, gradient"
};
```

### Terrain-Specific Prompts

```javascript
const TERRAIN_PROMPTS = {
  // === WATER ===
  water: "crystal blue water, gentle ripples, pixel art water texture, shimmering surface",
  deep_water: "deep ocean blue water, darker tones, mysterious depths, pixel waves",
  river: "flowing river water, current lines, stream banks, pixel water flow",

  // === WETLAND ===
  marsh: "marshy wetland, reeds, muddy water, cattails, swamp grass, damp earth",
  swamp: "dark swamp, murky water, twisted trees, hanging moss, foggy",
  bog: "peat bog, dark brown water, dead grass, mist, desolate",

  // === LOWLAND ===
  grass: "lush green grass, meadow, lawn texture, small grass blades",
  meadow: "flowering meadow, wildflowers, colorful blooms, tall grass",
  glen: "forest clearing, dappled light, soft grass, peaceful",
  scrubland: "dry scrubland, sparse vegetation, dusty earth, desert brush",
  sand: "golden sand, beach texture, dunes, coastal sand",

  // === FOREST ===
  forest: "dense forest, deciduous trees, green canopy, oak trees, woodland",
  dense_forest: "thick dark forest, overlapping canopy, mysterious woods",
  pine_forest: "evergreen pine forest, conifer trees, needle carpet, alpine",
  dead_forest: "dead forest, bare branches, fallen trees, grey bark, haunted",

  // === HIGHLAND ===
  hills: "rolling hills, grassy slopes, gentle elevation, highland meadow",
  rocky: "rocky terrain, scattered boulders, stone outcrops, grey rocks",
  cliffs: "steep cliff face, vertical rock wall, layered stone, dramatic",
  mountain: "mountain peak, rocky summit, alpine terrain, jagged rocks",
  peak: "snow-capped peak, mountain top, white snow, highest point",

  // === STRUCTURES ===
  dirt_road: "dirt path, worn trail, wagon tracks, dusty road",
  stone_road: "cobblestone road, paved path, grey stones, well-maintained",
  bridge: "wooden bridge, planks, rope rails, crossing",
  building_wood: "wooden cottage, thatched roof, timber walls, medieval house",
  building_stone: "stone building, masonry walls, tile roof, sturdy structure",
  castle_wall: "castle fortification, battlements, grey stone wall, defensive",
  castle_tower: "castle tower, tall spire, watchtower, medieval fortress",
  ruins: "ancient ruins, crumbling stone, overgrown, mysterious relics",
  farm_field: "crop field, planted rows, golden wheat, farmland",
  orchard: "fruit orchard, apple trees, organized rows, harvest",
  market: "market square, stalls, colorful awnings, bustling",
  dock: "wooden dock, pier planks, mooring posts, waterfront",
  well: "stone well, bucket, rope, village center"
};
```

### Prompt Builder Function

```javascript
function buildPrompt(mapData, visualTheme = null) {
  // Analyze dominant terrain types
  const terrainCounts = {};
  for (const row of mapData.tiles) {
    for (const tile of row) {
      const category = TILES[tile.type]?.category || 'terrain';
      terrainCounts[category] = (terrainCounts[category] || 0) + 1;
    }
  }

  // Get top 3 terrain types
  const topTerrains = Object.entries(terrainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  // Build terrain descriptions
  const terrainDesc = topTerrains
    .map(t => TERRAIN_PROMPTS[t] || '')
    .filter(Boolean)
    .join(', ');

  // Custom theme override
  const themeDesc = visualTheme ||
    'fantasy medieval world, vibrant colors, magical atmosphere';

  return {
    prompt: [
      BASE_PROMPT.style,
      BASE_PROMPT.view,
      `fantasy game map featuring ${terrainDesc}`,
      themeDesc,
      BASE_PROMPT.quality
    ].join(', '),

    negative_prompt: BASE_PROMPT.negative
  };
}
```

---

## 5. API Configuration

### Replicate API Call (fofr/sdxl-multi-controlnet-lora)

```javascript
async function paintMapWithLoRA(segmentationCanvas, mapData) {
  const SIZE = 1024;
  const token = getApiToken();

  // Build prompts
  const { prompt, negative_prompt } = buildPrompt(
    mapData,
    mapData.worldSeed?.visualTheme
  );

  // Convert canvas to data URI
  const segUri = segmentationCanvas.toDataURL('image/png');

  // Get model version
  const version = await getModelVersion('fofr/sdxl-multi-controlnet-lora', token);

  const input = {
    // Image input (segmentation map)
    image: segUri,

    // Prompts
    prompt: prompt,
    negative_prompt: negative_prompt,

    // LoRA - Pixel Art XL
    lora_url: "https://huggingface.co/nerijs/pixel-art-xl/resolve/main/pixel-art-xl.safetensors",
    lora_scale: 1.0,

    // ControlNet settings
    controlnet_1: "seg",  // Segmentation
    controlnet_1_image: segUri,
    controlnet_1_conditioning_scale: 0.85,
    controlnet_1_start: 0.0,
    controlnet_1_end: 0.9,

    // Generation settings
    width: SIZE,
    height: SIZE,
    num_inference_steps: 25,
    guidance_scale: 7.0,

    // img2img settings (structure preservation)
    prompt_strength: 0.75,  // Higher = more creative, lower = more structure

    // Reproducibility
    seed: mapData.seed,

    // Quality
    refine: "no_refiner",  // Skip refiner for pixel art
    scheduler: "K_EULER"
  };

  return runPrediction(version, input, token, onStatus);
}
```

### fal.ai Alternative

```javascript
async function paintMapFalAI(segmentationCanvas, mapData) {
  const { prompt, negative_prompt } = buildPrompt(mapData);
  const segUri = segmentationCanvas.toDataURL('image/png');

  const response = await fetch('https://fal.run/fal-ai/sdxl-controlnet-union', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: prompt,
      negative_prompt: negative_prompt,

      // ControlNet
      control_image_url: segUri,
      control_type: "seg",
      controlnet_conditioning_scale: 0.85,

      // LoRAs
      loras: [{
        path: "https://huggingface.co/nerijs/pixel-art-xl/resolve/main/pixel-art-xl.safetensors",
        scale: 1.0
      }],

      // Generation
      image_size: { width: 1024, height: 1024 },
      num_inference_steps: 25,
      guidance_scale: 7.0,
      seed: mapData.seed
    })
  });

  const result = await response.json();
  return result.images[0].url;
}
```

---

## 6. Output Format & Post-Processing

### Raw Output
```
Format: PNG
Size: 1024x1024
Color depth: 24-bit RGB
```

### Pixel Art Post-Processing (Critical!)

The LoRA produces pixel-art-style images but at full resolution. For authentic pixel art:

```javascript
function postProcessPixelArt(sourceCanvas, downscaleFactor = 8) {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const dw = sw / downscaleFactor;
  const dh = sh / downscaleFactor;

  // Step 1: Downscale with NEAREST NEIGHBOR
  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = dw;
  smallCanvas.height = dh;
  const smallCtx = smallCanvas.getContext('2d');
  smallCtx.imageSmoothingEnabled = false;  // Critical!
  smallCtx.drawImage(sourceCanvas, 0, 0, dw, dh);

  // Step 2: Upscale back for display (still nearest neighbor)
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = sw;
  finalCanvas.height = sh;
  const finalCtx = finalCanvas.getContext('2d');
  finalCtx.imageSmoothingEnabled = false;  // Critical!
  finalCtx.drawImage(smallCanvas, 0, 0, sw, sh);

  return {
    display: finalCanvas,   // 1024x1024 with pixel-perfect scaling
    native: smallCanvas     // 128x128 true pixel art
  };
}
```

### Recommended Downscale Factors
| Map Size | Tile Size | Downscale | Native Output |
|----------|-----------|-----------|---------------|
| 16x16 | 64px | 8x | 128x128 |
| 24x24 | 42px | 8x | 128x128 |
| 32x32 | 32px | 4x | 256x256 |

---

## 7. Complete Rendering Pipeline

```
┌─────────────────┐
│  WFC Generate   │
│   (Tile.js)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Render Seg Map │
│  (ADE20K colors)│
│   1024x1024     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  AI Generation (Replicate/fal.ai)  │
│  - ControlNet: Segmentation        │
│  - LoRA: Pixel Art XL              │
│  - Prompt: terrain-aware           │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Post-Process    │
│ (8x downscale)  │
│ Nearest Neighbor│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Final Output   │
│  128x128 native │
│  1024x1024 disp │
└─────────────────┘
```

---

## 8. Configuration Object

```javascript
const AI_CONFIG = {
  // Provider selection
  provider: 'replicate',  // 'replicate' | 'fal'

  // Model
  replicate: {
    model: 'fofr/sdxl-multi-controlnet-lora',
    cost_per_run: 0.017
  },
  fal: {
    model: 'fal-ai/sdxl-controlnet-union',
    cost_per_run: 0.01
  },

  // LoRA
  lora: {
    url: 'https://huggingface.co/nerijs/pixel-art-xl/resolve/main/pixel-art-xl.safetensors',
    scale: 1.0,
    name: 'Pixel Art XL'
  },

  // ControlNet
  controlnet: {
    type: 'seg',  // segmentation
    conditioning_scale: 0.85,
    start: 0.0,
    end: 0.9
  },

  // Generation
  generation: {
    size: 1024,
    steps: 25,
    guidance: 7.0,
    prompt_strength: 0.75,
    scheduler: 'K_EULER'
  },

  // Post-processing
  postprocess: {
    enabled: true,
    downscale: 8,
    interpolation: 'nearest'
  }
};
```

---

## 9. Cost Estimation

| Operation | Replicate | fal.ai |
|-----------|-----------|--------|
| Map paint (with LoRA) | $0.017 | ~$0.01 |
| NPC sprite (Retro Diffusion) | $0.003 | - |
| Tile detail zoom | $0.05 | ~$0.03 |

**Per session estimate:** $0.05-0.10 for full map + NPCs

---

## 10. Migration Checklist

- [ ] Update `ai-integration.js` to use `fofr/sdxl-multi-controlnet-lora`
- [ ] Add LoRA URL parameter to API calls
- [ ] Switch from img2img to ControlNet seg mode
- [ ] Update prompts with terrain-aware builder
- [ ] Add post-processing downscale step
- [ ] Test with existing segmentation maps
- [ ] Update cost tracking ($0.017 vs $0.015)
