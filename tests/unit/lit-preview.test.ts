// tests/unit/lit-preview.test.ts
// The offline lit preview must shade with the SHIPPED model — the whole point is that a dev
// render shows what the renderer will show. These pin the properties a preview is useless
// without: empty pixels stay empty, a lit surface is not the flat albedo, and a face turned
// away from the sun is darker than one facing it (form, which unlit massing has none of).
import { describe, it, expect } from 'vitest';
import { litRgba } from '@/assetgen/lit-preview';
import type { StructureResult } from '@/assetgen/compose';

/** A 1×1 "result" carrying one pixel of the given screen-space normal and alpha. */
function stub(normal: [number, number, number], alpha = 255): StructureResult {
  const enc = (v: number): number => Math.round((v * 0.5 + 0.5) * 255);
  const grey = new Uint8ClampedArray([180, 180, 180, alpha]);
  const nrm = new Uint8ClampedArray([enc(normal[0]), enc(normal[1]), enc(normal[2]), 255]);
  const mat = new Uint8ClampedArray([128, 255, 255, 0]);   // AO 1, fully rough, non-metal
  const emi = new Uint8ClampedArray(4);
  return { grey, normal: nrm, material: mat, emissive: emi, size: 1 } as unknown as StructureResult;
}

describe('litRgba — the offline preview uses the shipped lighting', () => {
  it('leaves fully transparent pixels untouched', () => {
    const out = litRgba(stub([0, 0, 1], 0));
    expect([...out]).toEqual([0, 0, 0, 0]);
  });

  it('shades an opaque pixel rather than copying the albedo through', () => {
    const out = litRgba(stub([0, 0, 1]));
    expect(out[3], 'stays opaque').toBe(255);
    expect(out[0], 'not the raw 180 albedo').not.toBe(180);
  });

  // The default sun points up-left-toward-camera; a face aimed at it must beat one aimed away.
  // This is exactly the signal an unlit dump destroys — without it a crenel gap and a solid
  // parapet are the same flat grey, which is how "the merlons are missing" got reported twice.
  it('gives a sunward face more light than a face turned away', () => {
    const lum = (n: [number, number, number]): number => {
      const o = litRgba(stub(n));
      return o[0] + o[1] + o[2];
    };
    expect(lum([-0.5, 0.65, 0.58])).toBeGreaterThan(lum([0.5, -0.65, 0.58]));
  });
});
