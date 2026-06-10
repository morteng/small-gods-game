import { describe, it, expect } from 'vitest';
import { chromaKeyMagenta, compositeOverChroma, CHROMA_RGB } from '@/render/chroma-key';

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

describe('compositeOverChroma', () => {
  it('fills fully transparent pixels with opaque chroma magenta', () => {
    const out = compositeOverChroma(px(0, 0, 0, 0));
    expect([...out]).toEqual([...CHROMA_RGB, 255]);
  });

  it('leaves opaque pixels untouched', () => {
    const out = compositeOverChroma(px(150, 100, 80, 255));
    expect([...out]).toEqual([150, 100, 80, 255]);
  });

  it('alpha-blends semi-transparent pixels over magenta and makes them opaque', () => {
    const out = compositeOverChroma(px(0, 255, 0, 128)); // half-green over magenta
    expect(out[3]).toBe(255);
    expect(out[0]).toBeGreaterThan(100); // picked up red from the magenta beneath
    expect(out[1]).toBeGreaterThan(100); // kept green from the source
  });

  it('does not mutate its input', () => {
    const src = px(0, 0, 0, 0);
    compositeOverChroma(src);
    expect(src[3]).toBe(0);
  });
});
