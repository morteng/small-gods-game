/**
 * Pure-function blob47 composer. Consumes a 5×3 primitive sheet (640×192)
 * and writes a 6×8 blob atlas (768×384) into the supplied target canvas.
 *
 * Algorithm: standard quadrant-minitile composition
 * (cr31.co.uk/stagecast/wang/blob). Each of 47 output cells is built from
 * 4 quadrant samples chosen from up to 5 primitive cells per quadrant,
 * keyed on (cardinal-1, cardinal-2, diagonal) neighbor bits.
 */

export const CELL_W = 128;
export const CELL_H = 64;
export const PRIMITIVE_COLS = 5;
export const PRIMITIVE_ROWS = 3;
export const PRIMITIVE_W = CELL_W * PRIMITIVE_COLS; // 640
export const PRIMITIVE_H = CELL_H * PRIMITIVE_ROWS; // 192
export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 8;
export const OUTPUT_W = CELL_W * ATLAS_COLS; // 768
export const OUTPUT_H = CELL_H * ATLAS_ROWS; // 384

/**
 * Surface the composer accepts. OffscreenCanvas in browser/tests;
 * a node-canvas Canvas (cast to this shape) in the baking script.
 */
type Surface = OffscreenCanvas | HTMLCanvasElement;
type Source = HTMLImageElement | OffscreenCanvas | ImageBitmap | HTMLCanvasElement;

export function composeBlob47Atlas(_primitives: Source, _target: Surface): void {
  throw new Error('not implemented');
}
