// src/render/gpu/banded-pbr.ts
//
// R2b — the banded-PBR per-pixel math as a pure, GPU-independent TS function.
//
// This is the SINGLE SOURCE OF TRUTH for the lighting model. Both the GLSL
// (`pixi/lit-shader.ts`, the current WebGL path) and the WGSL (`wgsl/lit-wgsl.ts`,
// the R2 WebGPU path) mirror it line-for-line. Keeping it here as executable TS
// lets us unit-test the model with fixtures (no GPU) and gives the in-browser
// pixel-diff parity check (R2c) a reference to diff against.
//
// Co-registered inputs, exactly as `lit-shader.ts` documents:
//  - albedo   premultiplied RGBA, 0..1
//  - normal   RGBA 0..1; rgb = screen-space normal encoded (v·0.5+0.5); a = geometry mask
//  - material R=depth G=AO B=rough A=metal, 0..1
// Where the normal mask alpha ≤ 0.5 (negotiation-band pixels painted beyond the
// silhouette) the pixel takes a flat toward-camera normal and AO 1 — neutral
// lighting instead of a garbage decode.

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface PbrSample {
  /** Premultiplied albedo RGBA, 0..1. */
  albedo: Vec4;
  /** Normal map RGBA, 0..1 (rgb encoded normal, a = geometry mask). */
  normal: Vec4;
  /** Material RGBA: R=depth G=AO B=rough A=metal, 0..1. */
  material: Vec4;
}

export interface PbrLight {
  ambient: Vec3;
  /** Direction TOWARD the light, screen space, normalized. */
  sunDir: Vec3;
  sunColor: Vec3;
  /** Diffuse quantization band count (clamped to ≥1, matching the shaders). */
  bands: number;
}

function decodeNormal(n: Vec4): Vec3 {
  if (n[3] > 0.5) {
    const x = n[0] * 2 - 1;
    const y = n[1] * 2 - 1;
    const z = n[2] * 2 - 1;
    const len = Math.hypot(x, y, z) || 1;
    return [x / len, y / len, z / len];
  }
  return [0, 0, 1]; // flat, toward camera
}

/** mix(a, b, t) = a·(1−t) + b·t — GLSL/WGSL `mix` semantics. */
function mix(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/**
 * Compute one lit, premultiplied output pixel. Mirrors the GLSL/WGSL fragment:
 *   n      = mask>0.5 ? normalize(rgb·2−1) : (0,0,1)
 *   ao     = mix(1, mat.G, mat.A)
 *   ndl    = max(dot(n, sunDir), 0)
 *   banded = floor(ndl·bands + 0.5) / bands
 *   light  = (ambient + sunColor·banded) · ao
 *   out    = vec4(albedo.rgb · light, albedo.a)   // stays premultiplied
 */
export function bandedPbrPixel(s: PbrSample, l: PbrLight): Vec4 {
  const n = decodeNormal(s.normal);
  const ao = mix(1, s.material[1], s.material[3]);
  const ndl = Math.max(n[0] * l.sunDir[0] + n[1] * l.sunDir[1] + n[2] * l.sunDir[2], 0);
  const bands = Math.max(1, l.bands);
  const banded = Math.floor(ndl * bands + 0.5) / bands;
  const lr = (l.ambient[0] + l.sunColor[0] * banded) * ao;
  const lg = (l.ambient[1] + l.sunColor[1] * banded) * ao;
  const lb = (l.ambient[2] + l.sunColor[2] * banded) * ao;
  return [s.albedo[0] * lr, s.albedo[1] * lg, s.albedo[2] * lb, s.albedo[3]];
}
