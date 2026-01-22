/**
 * AI Integration Constants
 * Shared configuration for AI painting and segmentation
 */

// =============================================================================
// ADE20K SEGMENTATION COLORS
// These are specific colors that ControlNet segmentation models understand
// =============================================================================

const ADE20K_COLORS = {
  TREE:      '#04C803',     // [4, 200, 3] - vegetation/trees
  GRASS:     '#04FA07',     // [4, 250, 7] - grass/lawn
  WATER:     '#3DE6FA',     // [61, 230, 250] - water/lake
  SEA:       '#0907E6',     // [9, 7, 230] - sea/ocean (background)
  MOUNTAIN:  '#8FFF8C',     // [143, 255, 140] - mountain
  SAND:      '#A09614',     // [160, 150, 20] - sand/beach
  ROAD:      '#8C8C8C',     // [140, 140, 140] - road/path
  BUILDING:  '#B47878',     // [180, 120, 120] - building/house
  EARTH:     '#787846',     // [120, 120, 70] - earth/dirt
  ROCK:      '#FF290A',     // [255, 41, 10] - rock/stone
  WALL:      '#787878',     // [120, 120, 120] - wall/fence
  FLOOR:     '#503232',     // [80, 50, 50] - floor
  PLANT:     '#28C828',     // [40, 200, 40] - plant/flower
  SWAMP:     '#404020'      // [64, 64, 32] - swamp/marsh
};

// =============================================================================
// RENDERING CONSTANTS
// =============================================================================

const RENDER_CONFIG = {
  // Tile dimensions for isometric rendering (1:1 pixel mapping)
  TILE_WIDTH: 32,
  TILE_HEIGHT: 16,

  // Background colors
  BG_COLOR: '#1a1a2e',              // Display background (dark blue)
  SEG_BACKGROUND: ADE20K_COLORS.SEA, // Segmentation background (ADE20K sea)

  // Default fallback colors
  DEFAULT_SEG_COLOR: ADE20K_COLORS.GRASS,  // Fallback for missing segColor

  // Visibility buffer for rendering optimization
  VISIBILITY_BUFFER: 50,
  VISIBILITY_BUFFER_TOP: 40
};

// =============================================================================
// SLICE CONFIGURATION
// =============================================================================

const SLICE_CONFIG = {
  SIZE: 512,           // Slice dimensions (512x512 for 1:1 pixel mapping)
  OVERLAP: 64,         // Overlap between adjacent slices for blending
  MAX_SINGLE_PASS: 1024  // Maximum dimension for single-pass generation
};

// =============================================================================
// AI MODEL CONFIGURATIONS
// =============================================================================

const AI_MODELS = {
  FLUX: {
    id: 'flux',
    name: 'FLUX.1 [dev]',
    description: 'High quality, artistic style. Segmentation can cause color artifacts.',
    endpoints: {
      img2img: 'fal-ai/flux-general/image-to-image',
      img2img_only: 'fal-ai/flux/dev/image-to-image'
    },
    defaults: {
      steps: 28,
      guidance: 3.5,
      strength: 0.65
    },
    controlnet: {
      type: 'easycontrols',  // Uses easycontrols array
      segMethod: 'seg',
      cannyMethod: 'canny'
    },
    cost: 0.025
  },

  SDXL: {
    id: 'sdxl',
    name: 'SDXL ControlNet Union',
    description: '⚠️ API issues - segmentation not working. Use FLUX instead.',
    disabled: true,  // API has bugs with segmentation_image_url parameter
    requiresCDN: true,
    endpoints: {
      img2img: 'fal-ai/sdxl-controlnet-union/image-to-image',
      txt2img: 'fal-ai/sdxl-controlnet-union'
    },
    defaults: {
      steps: 35,
      guidance: 7.5,
      strength: 0.85
    },
    controlnet: {
      type: 'direct',
      conditioningScale: 0.7
    },
    cost: 0.02
  }
};

// Legacy defaults (for backward compatibility)
const AI_DEFAULTS = {
  STEPS: 28,
  GUIDANCE: 3.5,
  STRENGTH: 0.65,
  COST_PER_RUN: 0.025
};

// =============================================================================
// CONTROL METHOD IDENTIFIERS
// =============================================================================

const CONTROL_METHODS = {
  SEGMENTATION: 'seg',
  CANNY: 'canny',
  DEPTH: 'depth',
  POSE: 'pose'
};

// =============================================================================
// EXPORTS
// =============================================================================

window.ADE20K_COLORS = ADE20K_COLORS;
window.RENDER_CONFIG = RENDER_CONFIG;
window.SLICE_CONFIG = SLICE_CONFIG;
window.AI_DEFAULTS = AI_DEFAULTS;
window.AI_MODELS = AI_MODELS;
window.CONTROL_METHODS = CONTROL_METHODS;

console.log('AI Constants loaded');
