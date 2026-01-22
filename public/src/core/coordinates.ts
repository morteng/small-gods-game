/**
 * Small Gods - Unified Coordinate System
 *
 * SINGLE SOURCE OF TRUTH for all coordinate conversions.
 * This ensures click detection and rendering use identical math.
 */

import { TILE_WIDTH, TILE_HEIGHT, AI_SIZE } from './constants';
import type { Point, GameMap, Camera, MapOffsets } from '../types';

/**
 * Get the center of the map in tile coordinates
 */
export function getMapCenter(map: GameMap): Point {
  return {
    x: (map.width - 1) / 2,
    y: (map.height - 1) / 2,
  };
}

/**
 * Calculate rendering offsets to center the map on canvas
 * This is the formula used by renderMap() and must be used by click handlers
 */
export function getOffsets(map: GameMap, outputSize: number = AI_SIZE): Point {
  const center = getMapCenter(map);
  const centerIsoX = (center.x - center.y) * (TILE_WIDTH / 2);
  const centerIsoY = (center.x + center.y) * (TILE_HEIGHT / 2);
  return {
    x: outputSize / 2 - centerIsoX,
    y: outputSize / 2 - centerIsoY,
  };
}

/**
 * Get map offsets with additional info (compatible with legacy getMapOffsets)
 */
export function getMapOffsets(map: GameMap, outputSize: number = AI_SIZE): MapOffsets {
  const offsets = getOffsets(map, outputSize);
  return {
    tw: TILE_WIDTH,
    th: TILE_HEIGHT,
    ox: offsets.x,
    oy: offsets.y,
    canvasWidth: outputSize,
    canvasHeight: outputSize,
  };
}

/**
 * Convert screen coordinates to canvas coordinates
 * Reverses the CSS transform: scale(zoom) translate(x, y)
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  camera: Camera,
  containerRect: DOMRect
): Point {
  return {
    x: (screenX - containerRect.left) / camera.zoom - camera.x,
    y: (screenY - containerRect.top) / camera.zoom - camera.y,
  };
}

/**
 * Convert canvas coordinates to tile coordinates
 * Uses inverse isometric transformation
 */
export function canvasToTile(canvasX: number, canvasY: number, map: GameMap): Point {
  const offset = getOffsets(map);
  const relX = canvasX - offset.x;
  const relY = canvasY - offset.y;

  // Inverse isometric transformation
  // Forward: ix = (x - y) * (tw/2), iy = (x + y) * (th/2)
  // Inverse: x = (ix/tw*2 + iy/th*2) / 2, y = (iy/th*2 - ix/tw*2) / 2
  return {
    x: Math.floor((relX / (TILE_WIDTH / 2) + relY / (TILE_HEIGHT / 2)) / 2),
    y: Math.floor((relY / (TILE_HEIGHT / 2) - relX / (TILE_WIDTH / 2)) / 2),
  };
}

/**
 * Convert tile coordinates to canvas coordinates
 * Uses isometric transformation
 */
export function tileToCanvas(tileX: number, tileY: number, map: GameMap): Point {
  const offset = getOffsets(map);
  return {
    x: (tileX - tileY) * (TILE_WIDTH / 2) + offset.x,
    y: (tileX + tileY) * (TILE_HEIGHT / 2) + offset.y,
  };
}

/**
 * Convert screen coordinates directly to tile coordinates
 * Convenience function combining screenToCanvas and canvasToTile
 */
export function screenToTile(
  screenX: number,
  screenY: number,
  camera: Camera,
  containerRect: DOMRect,
  map: GameMap
): Point {
  const canvas = screenToCanvas(screenX, screenY, camera, containerRect);
  return canvasToTile(canvas.x, canvas.y, map);
}

/**
 * Convert tile coordinates to screen coordinates
 * Convenience function for editor overlays
 */
export function tileToScreen(
  tileX: number,
  tileY: number,
  camera: Camera,
  containerRect: DOMRect,
  map: GameMap
): Point {
  const canvas = tileToCanvas(tileX, tileY, map);
  return {
    x: (canvas.x + camera.x) * camera.zoom + containerRect.left,
    y: (canvas.y + camera.y) * camera.zoom + containerRect.top,
  };
}

/**
 * Check if a point is within the canvas bounds
 */
export function isInCanvas(x: number, y: number, size: number = AI_SIZE): boolean {
  return x >= 0 && x < size && y >= 0 && y < size;
}

/**
 * Check if tile coordinates are within map bounds
 */
export function isInMap(tileX: number, tileY: number, map: GameMap): boolean {
  return tileX >= 0 && tileX < map.width && tileY >= 0 && tileY < map.height;
}

/**
 * Calculate isometric position for a tile at 1:1 scale (for rendering)
 */
export function getTileIsoPosition(x: number, y: number, centerX: number, centerY: number): Point {
  const ix = (x - y) * (TILE_WIDTH / 2);
  const iy = (x + y) * (TILE_HEIGHT / 2);
  return {
    x: ix + centerX,
    y: iy + centerY,
  };
}
