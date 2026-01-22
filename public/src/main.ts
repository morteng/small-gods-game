/**
 * Small Gods - Main Entry Point (TypeScript/ES Module Version)
 *
 * This module-based version provides the same functionality as the legacy
 * app.js but with proper ES modules, TypeScript, and a unified coordinate system.
 */

import { state, costs, DEFAULT_WORLD_SEED, PRICES } from './core/state';
import { TILE_WIDTH, TILE_HEIGHT, AI_SIZE, BG_COLOR } from './core/constants';
import {
  screenToCanvas,
  canvasToTile,
  getMapOffsets,
  isInCanvas,
  isInMap,
} from './core/coordinates';
import { InputManager } from './input/InputManager';
import type { GameMap, Point, Tile } from './types';

// Re-export types for use in other modules
export type { GameState, Camera, NPC, Tile, GameMap, Point } from './types';
export { state, costs, PRICES, DEFAULT_WORLD_SEED };
export { TILE_WIDTH, TILE_HEIGHT, AI_SIZE, BG_COLOR };
export {
  screenToCanvas,
  canvasToTile,
  getMapOffsets,
  isInCanvas,
  isInMap,
};

// Global TileTypes reference (from WFC system)
let TileTypes: Record<string, { color: string; walkable?: boolean; category?: string; height?: number; tree?: boolean; treeType?: string; flowers?: boolean; segColor?: string }>;

/**
 * Initialize the application
 */
export async function initApp(): Promise<void> {
  // Wait for DOM
  if (document.readyState === 'loading') {
    await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
  }

  // Get TileTypes from WFC
  TileTypes = window.WFC?.TILES || {};
  if (!TileTypes || Object.keys(TileTypes).length === 0) {
    console.error('WFC.TILES not loaded! Check script order in index.html');
  }

  // Setup slider value displays
  setupSliderListeners();

  // Setup canvas handlers with unified coordinate system
  setupCanvasHandlers();

  // Initialize editor if available
  if (typeof (window as unknown as Record<string, unknown>).initEditor === 'function') {
    (window as unknown as Record<string, () => void>).initEditor();
  }

  // Load world seed from storage or use default
  if (typeof (window as unknown as Record<string, unknown>).loadWorldSeedFromStorage === 'function') {
    const loaded = (window as unknown as Record<string, () => boolean>).loadWorldSeedFromStorage();
    if (!loaded) {
      state.worldSeed = JSON.parse(JSON.stringify(DEFAULT_WORLD_SEED));
    }
  } else {
    state.worldSeed = JSON.parse(JSON.stringify(DEFAULT_WORLD_SEED));
  }

  // Set WFC mode and update UI from world seed
  const genModeEl = document.getElementById('genMode') as HTMLSelectElement | null;
  if (genModeEl) {
    genModeEl.value = 'wfc';
  }

  if (state.worldSeed) {
    const widthEl = document.getElementById('mapWidth') as HTMLInputElement | null;
    const heightEl = document.getElementById('mapHeight') as HTMLInputElement | null;
    if (widthEl) widthEl.value = String(state.worldSeed.size?.width || 24);
    if (heightEl) heightEl.value = String(state.worldSeed.size?.height || 18);
  }

  // Generate the world
  await generateWorld();

  // Update costs display
  if (typeof (window as unknown as Record<string, unknown>).updateCosts === 'function') {
    (window as unknown as Record<string, () => void>).updateCosts();
  }
}

/**
 * Setup slider value display listeners
 */
function setupSliderListeners(): void {
  const villageSlider = document.getElementById('villageCount') as HTMLInputElement | null;
  const villageValue = document.getElementById('villageValue');
  if (villageSlider && villageValue) {
    villageSlider.addEventListener('input', () => {
      villageValue.textContent = villageSlider.value;
    });
  }

  const forestSlider = document.getElementById('forestDensity') as HTMLInputElement | null;
  const forestValue = document.getElementById('forestValue');
  if (forestSlider && forestValue) {
    forestSlider.addEventListener('input', () => {
      forestValue.textContent = forestSlider.value + '%';
    });
  }

  const waterSlider = document.getElementById('waterLevel') as HTMLInputElement | null;
  const waterValue = document.getElementById('waterValue');
  if (waterSlider && waterValue) {
    waterSlider.addEventListener('input', () => {
      waterValue.textContent = waterSlider.value + '%';
    });
  }
}

/**
 * Setup canvas handlers with unified coordinate system
 */
function setupCanvasHandlers(): void {
  const container = document.getElementById('canvasContainer');
  if (!container) {
    console.error('Canvas container not found');
    return;
  }

  // Wheel zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = e.deltaY > 0 ? 0.9 : 1.1;
    state.camera.zoom = Math.max(0.5, Math.min(4, state.camera.zoom * d));
    updateTransform();
    updateMinimap();
  }, { passive: false });

  // Mouse down - start dragging
  container.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      state.camera.dragging = true;
      state.camera.lastX = e.clientX;
      state.camera.lastY = e.clientY;
      state.camera.startX = e.clientX;
      state.camera.startY = e.clientY;
    }
  });

  // Mouse move - update cursor position and handle dragging
  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    // Use unified coordinate system
    const canvas = screenToCanvas(e.clientX, e.clientY, state.camera, rect);

    // Show tile coordinates if on map
    const cursorPosEl = document.getElementById('cursorPos');
    if (state.map && isInCanvas(canvas.x, canvas.y)) {
      const tile = canvasToTile(canvas.x, canvas.y, state.map);
      if (isInMap(tile.x, tile.y, state.map)) {
        if (cursorPosEl) cursorPosEl.textContent = `Tile: ${tile.x}, ${tile.y}`;
      } else {
        if (cursorPosEl) cursorPosEl.textContent = `${Math.round(canvas.x)}, ${Math.round(canvas.y)}`;
      }
    } else {
      if (cursorPosEl) cursorPosEl.textContent = `${Math.round(canvas.x)}, ${Math.round(canvas.y)}`;
    }

    // Handle dragging
    if (state.camera.dragging) {
      const isDragging = Math.abs(e.clientX - state.camera.startX) > 5 ||
                         Math.abs(e.clientY - state.camera.startY) > 5;
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

  // Mouse up - handle click
  container.addEventListener('mouseup', (e) => {
    const wasDrag = Math.abs(e.clientX - state.camera.startX) > 5 ||
                    Math.abs(e.clientY - state.camera.startY) > 5;
    state.camera.dragging = false;
    container.style.cursor = 'default';

    // Show info on click (not drag)
    if (!wasDrag && state.map) {
      const rect = container.getBoundingClientRect();
      const canvas = screenToCanvas(e.clientX, e.clientY, state.camera, rect);

      if (!isInCanvas(canvas.x, canvas.y)) return;

      // Handle segmentation layer click
      if (state.layer === 'segmentation' && state.controlImages?.segmentation) {
        handleSegmentationClick(canvas.x, canvas.y);
        return;
      }

      // Handle regular map click
      const tile = canvasToTile(canvas.x, canvas.y, state.map);
      if (isInMap(tile.x, tile.y, state.map)) {
        const tileData = state.map.tiles[tile.y]?.[tile.x];
        if (tileData) {
          showTileInfo(tileData, tile.x, tile.y);
        }
      }
    }
  });

  // Mouse leave
  container.addEventListener('mouseleave', () => {
    state.camera.dragging = false;
    container.style.cursor = 'default';
  });
}

/**
 * Handle click on segmentation layer
 */
function handleSegmentationClick(canvasX: number, canvasY: number): void {
  const segCanvas = state.controlImages?.segmentation;
  if (!segCanvas) return;

  const ctx = segCanvas.getContext('2d');
  if (!ctx) return;

  const px = Math.floor(canvasX);
  const py = Math.floor(canvasY);

  if (px >= 0 && px < segCanvas.width && py >= 0 && py < segCanvas.height) {
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hexColor = '#' + [pixel[0], pixel[1], pixel[2]]
      .map(c => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

    if (typeof (window as unknown as Record<string, unknown>).showSegmentInfo === 'function') {
      (window as unknown as Record<string, (hex: string, x: number, y: number) => void>).showSegmentInfo(hexColor, px, py);
    }
  }
}

/**
 * Show tile info panel
 */
function showTileInfo(tile: Tile, x: number, y: number): void {
  if (typeof (window as unknown as Record<string, unknown>).showTileInfo === 'function') {
    (window as unknown as Record<string, (tile: Tile, x: number, y: number) => void>).showTileInfo(tile, x, y);
  }
}

/**
 * Update CSS transform
 */
function updateTransform(): void {
  if (typeof (window as unknown as Record<string, unknown>).updateTransform === 'function') {
    (window as unknown as Record<string, () => void>).updateTransform();
  } else {
    const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
    if (canvas) {
      canvas.style.transform = `scale(${state.camera.zoom}) translate(${state.camera.x}px, ${state.camera.y}px)`;
    }
    const zoomEl = document.getElementById('zoomLevel');
    if (zoomEl) {
      zoomEl.textContent = Math.round(state.camera.zoom * 100) + '%';
    }
  }
}

/**
 * Update minimap
 */
function updateMinimap(): void {
  if (typeof (window as unknown as Record<string, unknown>).updateMinimap === 'function') {
    (window as unknown as Record<string, () => void>).updateMinimap();
  }
}

/**
 * Generate world
 */
async function generateWorld(): Promise<void> {
  if (typeof (window as unknown as Record<string, unknown>).generateWorld === 'function') {
    await (window as unknown as Record<string, () => Promise<void>>).generateWorld();
  }
}

// Auto-initialize when module is loaded directly
if (typeof window !== 'undefined') {
  // Export to window for compatibility with legacy code
  (window as unknown as Record<string, unknown>).initAppModule = initApp;
  (window as unknown as Record<string, unknown>).stateModule = state;
  (window as unknown as Record<string, unknown>).costsModule = costs;
  (window as unknown as Record<string, unknown>).getMapOffsetsModule = getMapOffsets;
  (window as unknown as Record<string, unknown>).screenToCanvasModule = screenToCanvas;
  (window as unknown as Record<string, unknown>).canvasToTileModule = canvasToTile;
}
