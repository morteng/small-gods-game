import { describe, it, expect } from 'vitest';
import { bandedPbrPixel, type PbrSample, type PbrLight } from '@/render/gpu/banded-pbr';
import { LIT_WGSL } from '@/render/gpu/wgsl/lit-wgsl';
import { LIT_FRAGMENT } from '@/render/pixi/lit-shader';

// Encode a screen-space normal (v) into the map's RGBA (v·0.5+0.5, mask alpha).
function encodeNormal(v: [number, number, number], mask = 1): PbrSample['normal'] {
  return [v[0] * 0.5 + 0.5, v[1] * 0.5 + 0.5, v[2] * 0.5 + 0.5, mask];
}

const FLAT = encodeNormal([0, 0, 1]); // toward camera
const AO_NONE: PbrSample['material'] = [0, 1, 0, 0]; // ao 1, no metal weight

const sun: PbrLight = { ambient: [0.2, 0.2, 0.2], sunDir: [0, 0, 1], sunColor: [0.8, 0.8, 0.8], bands: 4 };

function close(a: number, b: number, eps = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe('R2b — banded-PBR reference math', () => {
  it('full sun on a camera-facing pixel = ambient + full sun, ao 1', () => {
    const out = bandedPbrPixel({ albedo: [0.6, 0.6, 0.6, 1], normal: FLAT, material: AO_NONE }, sun);
    // ndl=1 → banded=1 → light=(0.2+0.8)=1.0 → albedo unchanged
    close(out[0], 0.6);
    close(out[1], 0.6);
    close(out[2], 0.6);
    close(out[3], 1);
  });

  it('quantizes the diffuse term into bands (0.6·ndl)', () => {
    // a normal whose dot with (0,0,1) is exactly 0.6
    const tilt = encodeNormal([0, Math.sqrt(1 - 0.6 * 0.6), 0.6]);
    const at4 = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: tilt, material: AO_NONE }, sun);
    // bands=4: floor(0.6*4+0.5)/4 = floor(2.9)/4 = 0.5 → light=0.2+0.8*0.5=0.6
    close(at4[0], 0.6);
    const at1 = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: tilt, material: AO_NONE }, { ...sun, bands: 1 });
    // bands=1: floor(0.6+0.5)=1 → light=0.2+0.8=1.0
    close(at1[0], 1.0);
  });

  it('bands clamp to ≥1 (bands=0 behaves as 1)', () => {
    const a = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: FLAT, material: AO_NONE }, { ...sun, bands: 0 });
    const b = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: FLAT, material: AO_NONE }, { ...sun, bands: 1 });
    close(a[0], b[0]);
  });

  it('AO = mix(1, mat.G, mat.A): full metal weight applies G, halving output', () => {
    const out = bandedPbrPixel(
      { albedo: [1, 1, 1, 1], normal: FLAT, material: [0, 0.5, 0, 1] }, // ao=0.5
      sun,
    );
    close(out[0], 0.5); // light 1.0 × ao 0.5
  });

  it('mask alpha ≤ 0.5 falls back to a flat camera-facing normal (ignores rgb)', () => {
    const garbage = bandedPbrPixel(
      { albedo: [1, 1, 1, 1], normal: [0.9, 0.1, 0.1, 0], material: AO_NONE }, // a=0
      sun,
    );
    const flat = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: FLAT, material: AO_NONE }, sun);
    close(garbage[0], flat[0]);
  });

  it('keeps the output premultiplied: alpha passes through, rgb scaled by light only', () => {
    const out = bandedPbrPixel(
      { albedo: [0.3, 0.3, 0.3, 0.5], normal: FLAT, material: AO_NONE },
      { ...sun, sunColor: [0, 0, 0] }, // ambient-only 0.2
    );
    close(out[0], 0.3 * 0.2);
    close(out[3], 0.5); // alpha untouched
  });
});

describe('R2b — WGSL/GLSL parity with the reference', () => {
  it('WGSL holds the same load-bearing operations as the reference math', () => {
    expect(LIT_WGSL).toContain('nrm.a > 0.5');                  // mask fallback
    expect(LIT_WGSL).toContain('normalize(nrm.rgb * 2.0 - 1.0)'); // normal decode
    expect(LIT_WGSL).toContain('mix(1.0, mat.g, mat.a)');         // AO
    expect(LIT_WGSL).toContain('floor(ndl * light.uBands + 0.5) / light.uBands'); // banding
    expect(LIT_WGSL).toContain('albedo.rgb * lit');              // premultiplied output
  });

  it('WGSL mirrors the GLSL fragment’s banding + AO expressions', () => {
    // GLSL reference (the live WebGL path) and WGSL must not drift apart.
    expect(LIT_FRAGMENT).toContain('floor(ndl * uBands + 0.5) / uBands');
    expect(LIT_FRAGMENT).toContain('mix(1.0, mat.g, mat.a)');
    expect(LIT_FRAGMENT).toContain('nrm.a > 0.5');
  });
});
