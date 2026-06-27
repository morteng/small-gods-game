import { describe, it, expect } from 'vitest';
import { cropRgba } from '@/render/iso/sprite-canvas';

// cropRgba exists because a 2D canvas is a PREMULTIPLIED surface: any material-map
// pixel with alpha≈0 (metallic=0, i.e. almost every non-metal) has its RGB — the
// baked AO (G) and roughness (B) — silently zeroed by putImageData/drawImage. The
// raw JS crop must preserve every channel verbatim so the data reaches the GPU.

function mk(size: number, fill: (i: number) => [number, number, number, number]): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b, a] = fill(i);
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = a;
  }
  return buf;
}

describe('cropRgba — data-channel survival (no premultiply)', () => {
  it('preserves G(AO)/B(rough) where A(metallic)=0 — the canvas path would zero them', () => {
    // material-like pixel: R=depth, G=AO=255, B=rough=180, A=metal=0
    const src = mk(4, () => [12, 255, 180, 0]);
    const out = cropRgba(src, 4, { x: 0, y: 0, w: 4, h: 4 });
    expect(out).not.toBeNull();
    expect(out!.w).toBe(4);
    expect(out!.h).toBe(4);
    // every pixel keeps its DATA channels despite alpha 0
    for (let i = 0; i < 16; i++) {
      expect(out!.data[i * 4]).toBe(12);
      expect(out!.data[i * 4 + 1]).toBe(255);
      expect(out!.data[i * 4 + 2]).toBe(180);
      expect(out!.data[i * 4 + 3]).toBe(0);
    }
  });

  it('crops to the integer bbox rect, co-registered with the canvas crop', () => {
    // distinct value per cell so we can verify the right window is lifted
    const src = mk(4, (i) => [i, i, i, 255]);
    const out = cropRgba(src, 4, { x: 1, y: 1, w: 2, h: 2 });
    // window (1,1)-(2,2): source indices 5,6,9,10
    expect([out!.data[0], out!.data[4], out!.data[8], out!.data[12]]).toEqual([5, 6, 9, 10]);
  });

  it('clamps an out-of-range rect, leaving outside pixels zero', () => {
    const src = mk(2, () => [9, 9, 9, 9]);
    const out = cropRgba(src, 2, { x: 1, y: 1, w: 3, h: 3 });
    expect(out!.w).toBe(3);
    expect(out!.h).toBe(3);
    // only the top-left pixel maps to source (1,1); the rest fall outside → 0
    expect([out!.data[0], out!.data[1], out!.data[2], out!.data[3]]).toEqual([9, 9, 9, 9]);
    expect(out!.data[4]).toBe(0); // (1,0) of crop → source x=2 (out of range)
  });
});
