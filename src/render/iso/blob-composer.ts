/**
 * Pure-function blob47 composer. Consumes a 5×3 primitive sheet (640×192)
 * and writes a 6×8 blob atlas (768×512) into the supplied target canvas.
 *
 * Algorithm: standard quadrant-minitile composition
 * (cr31.co.uk/stagecast/wang/blob). Each of 47 output cells is built from
 * 4 quadrant samples chosen from up to 5 primitive cells per quadrant,
 * keyed on (cardinal-1, cardinal-2, diagonal) neighbor bits.
 */
import { ISO_TILE_W, ISO_TILE_H } from './iso-constants';
import { BLOB_INDEX_MAP_FOR_TEST } from '@/map/blob-autotiler';

export const CELL_W = ISO_TILE_W;
export const CELL_H = ISO_TILE_H;
export const PRIMITIVE_COLS = 5;
export const PRIMITIVE_ROWS = 3;
export const PRIMITIVE_W = CELL_W * PRIMITIVE_COLS; // 640
export const PRIMITIVE_H = CELL_H * PRIMITIVE_ROWS; // 192
export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 8;
export const OUTPUT_W = CELL_W * ATLAS_COLS; // 768
export const OUTPUT_H = CELL_H * ATLAS_ROWS; // 512

// Primitive sheet cell coordinates (col, row).
const PRIM = {
  NW_OUTER: [0, 0], N_EDGE:  [1, 0], NE_OUTER:[2, 0],
  W_EDGE:   [0, 1], CENTER:  [1, 1], E_EDGE:  [2, 1], NW_INNER:[3, 1], NE_INNER:[4, 1],
  SW_OUTER: [0, 2], S_EDGE:  [1, 2], SE_OUTER:[2, 2], SW_INNER:[3, 2], SE_INNER:[4, 2],
} as const;

type Quadrant = 'TL' | 'TR' | 'BL' | 'BR';

/** Pick which primitive cell to source for one quadrant given its 3 neighbor bits. */
function pickPrimitive(quadrant: Quadrant, A: boolean, B: boolean, D: boolean): readonly [number, number] {
  if (!A && !B) {
    switch (quadrant) {
      case 'TL': return PRIM.NW_OUTER;
      case 'TR': return PRIM.NE_OUTER;
      case 'BL': return PRIM.SW_OUTER;
      case 'BR': return PRIM.SE_OUTER;
    }
  }
  if (!A && B) {
    return quadrant === 'TL' || quadrant === 'TR' ? PRIM.N_EDGE : PRIM.S_EDGE;
  }
  if (A && !B) {
    return quadrant === 'TL' || quadrant === 'BL' ? PRIM.W_EDGE : PRIM.E_EDGE;
  }
  if (!D) {
    switch (quadrant) {
      case 'TL': return PRIM.NW_INNER;
      case 'TR': return PRIM.NE_INNER;
      case 'BL': return PRIM.SW_INNER;
      case 'BR': return PRIM.SE_INNER;
    }
  }
  return PRIM.CENTER;
}

/** Extract the 3 neighbor bits a given quadrant needs from an 8-bit mask. */
function bitsFor(quadrant: Quadrant, mask: number): { A: boolean; B: boolean; D: boolean } {
  const N  = (mask & 0x01) !== 0;
  const NE = (mask & 0x02) !== 0;
  const E  = (mask & 0x04) !== 0;
  const SE = (mask & 0x08) !== 0;
  const S  = (mask & 0x10) !== 0;
  const SW = (mask & 0x20) !== 0;
  const W  = (mask & 0x40) !== 0;
  const NW = (mask & 0x80) !== 0;
  switch (quadrant) {
    case 'TL': return { A: N, B: W, D: NW };
    case 'TR': return { A: N, B: E, D: NE };
    case 'BL': return { A: S, B: W, D: SW };
    case 'BR': return { A: S, B: E, D: SE };
  }
}

/**
 * Build a reverse lookup: blobIndex (0..46) → a representative 8-bit mask
 * that maps to it. Picks the HIGHEST mask preimage for each blob index.
 *
 * Why highest: blobIndex N is produced at runtime by computeBlobMap for any
 * mask in the table where `BLOB_INDEX_MAP[mask] % 47 === N`. Many such masks
 * may exist per blob index (the % 47 reduction is many-to-one). The highest
 * mask tends to be the most-connected topology (most neighbor bits set),
 * which produces the visually richer art for a slot that will be sampled
 * by tiles in a variety of contexts. In particular, blob 7 ← mask 0xFF
 * (fully surrounded), so a fully-surrounded tile at runtime gets all-CENTER
 * quadrants — matching the visual expectation.
 */
function buildBlobIndexToMask(): Map<number, number> {
  const map = new Map<number, number>();
  for (let mask = 0; mask < 256; mask++) {
    const blobIndex = BLOB_INDEX_MAP_FOR_TEST[mask] % 47;
    map.set(blobIndex, mask); // overwrite — keeps the last (highest) mask seen
  }
  return map;
}

type Source = HTMLImageElement | OffscreenCanvas | ImageBitmap | HTMLCanvasElement;
type Surface = OffscreenCanvas | HTMLCanvasElement;

/**
 * Resolve a Source to something jsdom's drawImage will accept.
 * Real OffscreenCanvas supports transferToImageBitmap(); the jsdom test stub
 * exposes its backing HTMLCanvasElement through getContext('2d').canvas.
 */
function toDrawable(src: Source): CanvasImageSource {
  if (src instanceof HTMLCanvasElement || src instanceof HTMLImageElement) {
    return src;
  }
  // OffscreenCanvas (real or stub) — extract the underlying canvas via the
  // 2d context, which the jsdom test stub uses to expose its backing
  // HTMLCanvasElement.
  const maybeCtx = (src as OffscreenCanvas).getContext('2d') as
    | { canvas?: HTMLCanvasElement }
    | null;
  if (maybeCtx?.canvas) {
    return maybeCtx.canvas;
  }
  // Real browser OffscreenCanvas — accepted natively by drawImage.
  return src as unknown as CanvasImageSource;
}

export function composeBlob47Atlas(primitives: Source, target: Surface): void {
  const ctx = (target as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('composeBlob47Atlas: 2d context unavailable');
  ctx.clearRect(0, 0, OUTPUT_W, OUTPUT_H);
  const drawablePrimitives = toDrawable(primitives);

  const reverseLookup = buildBlobIndexToMask();
  const halfW = CELL_W / 2;
  const halfH = CELL_H / 2;

  // Note: BLOB_INDEX_MAP never produces blob indices 11, 27, 40, 41, 42, or 43,
  // so those atlas cells remain transparent by design. computeBlobMap never
  // emits these indices at runtime either.
  for (let blobIndex = 0; blobIndex <= 46; blobIndex++) {
    const mask = reverseLookup.get(blobIndex);
    if (mask === undefined) continue;
    const outCol = blobIndex % ATLAS_COLS;
    const outRow = Math.floor(blobIndex / ATLAS_COLS);
    const outX = outCol * CELL_W;
    const outY = outRow * CELL_H;

    const quadrants: Array<{ q: Quadrant; dx: number; dy: number }> = [
      { q: 'TL', dx: 0,     dy: 0 },
      { q: 'TR', dx: halfW, dy: 0 },
      { q: 'BL', dx: 0,     dy: halfH },
      { q: 'BR', dx: halfW, dy: halfH },
    ];

    for (const { q, dx, dy } of quadrants) {
      const { A, B, D } = bitsFor(q, mask);
      const [pCol, pRow] = pickPrimitive(q, A, B, D);
      const srcX = pCol * CELL_W + dx;
      const srcY = pRow * CELL_H + dy;
      ctx.drawImage(
        drawablePrimitives,
        srcX, srcY, halfW, halfH,
        outX + dx, outY + dy, halfW, halfH,
      );
    }
  }
}
