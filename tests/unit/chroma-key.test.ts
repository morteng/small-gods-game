import { describe, it, expect } from 'vitest';
import { chromaKeyMagenta, CHROMA_RGB } from '@/render/chroma-key';

function px(...rgba: number[]): Uint8ClampedArray { return new Uint8ClampedArray(rgba); }

describe('chromaKeyMagenta', () => {
  it('keys pure magenta background to fully transparent', () => {
    const d = px(...CHROMA_RGB, 255);
    chromaKeyMagenta(d);
    expect(d[3]).toBe(0);
  });

  it('leaves warm building pixels fully opaque and unchanged', () => {
    const d = px(150, 100, 80, 255); // brown wall: green is not dominated by r+b
    chromaKeyMagenta(d);
    expect(d[3]).toBe(255);
    expect([d[0], d[1], d[2]]).toEqual([150, 100, 80]);
  });

  it('partially keys + despills an anti-aliased magenta fringe', () => {
    const d = px(200, 110, 200, 255); // mag = min(200,200)-110 = 90 → between T_EDGE..T_FULL
    chromaKeyMagenta(d);
    expect(d[3]).toBeGreaterThan(0);
    expect(d[3]).toBeLessThan(255);
    expect(d[0]).toBeLessThanOrEqual(110 + 30); // despilled toward green
    expect(d[2]).toBeLessThanOrEqual(110 + 30);
  });
});
