/**
 * Small Gods - Core Constants
 */

// Rendering constants - fixed tile size for 1:1 scale
export const TILE_WIDTH = 32;
export const TILE_HEIGHT = 16;
export const MAP_PADDING = 40;
export const BG_COLOR = '#1a1a2e';
export const AI_SIZE = 1024;  // Output size for AI models

// Cost tracking
export const PRICES = {
  PAINT: 0.015,
  NPC: 0.003,
  ZOOM: 0.05,
} as const;
