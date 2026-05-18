import { describe, it, expect } from 'vitest';
import { composeBlob47Atlas, PRIMITIVE_W, PRIMITIVE_H, OUTPUT_W, OUTPUT_H, CELL_W, CELL_H } from '@/render/iso/blob-composer';

// jsdom doesn't implement OffscreenCanvas — stub it using a regular canvas
if (typeof (globalThis as any).OffscreenCanvas === 'undefined') {
  (globalThis as any).OffscreenCanvas = class {
    width: number;
    height: number;
    private _canvas: HTMLCanvasElement;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this._canvas = document.createElement('canvas');
      this._canvas.width = width;
      this._canvas.height = height;
    }
    getContext(type: string) {
      return this._canvas.getContext(type as '2d');
    }
  };
}

/**
 * Build a synthetic 5×3 primitive sheet where each cell is flat-filled with
 * a unique color. Lets the tests assert which primitive each output quadrant
 * was sourced from by sampling pixel color at known coords.
 */
function buildSyntheticPrimitiveSheet(): OffscreenCanvas {
  const sheet = new OffscreenCanvas(PRIMITIVE_W, PRIMITIVE_H);
  const ctx = sheet.getContext('2d')!;
  // 15 distinct colors — one per primitive cell.
  // (col, row, hexColor)
  const cells: Array<[number, number, string]> = [
    [0, 0, '#100000'], [1, 0, '#110000'], [2, 0, '#120000'], [3, 0, '#130000'], [4, 0, '#140000'],
    [0, 1, '#200000'], [1, 1, '#210000'], [2, 1, '#220000'], [3, 1, '#230000'], [4, 1, '#240000'],
    [0, 2, '#300000'], [1, 2, '#310000'], [2, 2, '#320000'], [3, 2, '#330000'], [4, 2, '#340000'],
  ];
  for (const [c, r, color] of cells) {
    ctx.fillStyle = color;
    ctx.fillRect(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
  }
  return sheet;
}

function pixelAt(canvas: OffscreenCanvas, x: number, y: number): string {
  const ctx = canvas.getContext('2d')!;
  const d = ctx.getImageData(x, y, 1, 1).data;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(d[0])}${h(d[1])}${h(d[2])}`;
}

describe('composeBlob47Atlas', () => {
  it('blob index 46 (fully surrounded) sources all 4 quadrants from center primitive', () => {
    const primitives = buildSyntheticPrimitiveSheet();
    const target = new OffscreenCanvas(OUTPUT_W, OUTPUT_H);
    composeBlob47Atlas(primitives, target);

    // Blob index 46 → col = 46 % 6 = 4, row = floor(46 / 6) = 7
    // Center primitive lives at (1, 1) → color #210000
    const cellX = (46 % 6) * CELL_W;
    const cellY = Math.floor(46 / 6) * CELL_H;
    // Sample one pixel inside each quadrant
    expect(pixelAt(target, cellX + 10,           cellY + 5)).toBe('#210000');         // TL
    expect(pixelAt(target, cellX + CELL_W - 10,  cellY + 5)).toBe('#210000');         // TR
    expect(pixelAt(target, cellX + 10,           cellY + CELL_H - 5)).toBe('#210000');// BL
    expect(pixelAt(target, cellX + CELL_W - 10,  cellY + CELL_H - 5)).toBe('#210000');// BR
  });
});
