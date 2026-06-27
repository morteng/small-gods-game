// src/render/gpu/banded-pbr.ts
//
// R2b — the banded-PBR per-pixel math as a pure, GPU-independent TS function.
//
// This is the SINGLE SOURCE OF TRUTH for the lighting model. The WGSL
// (`wgsl/lit-wgsl.ts`, the WebGPU scene path) mirrors it line-for-line. Keeping
// it here as executable TS lets us unit-test the model with fixtures (no GPU) and
// gives the in-browser pixel-diff parity check (R2c) a reference to diff against.
// (The old GLSL `pixi/lit-shader.ts` mirror was retired with the WebGPU-only
// renderer — there is now exactly one shader to keep in parity.)
//
// Co-registered inputs:
//  - albedo   premultiplied RGBA, 0..1
//  - normal   RGBA 0..1; rgb = screen-space normal encoded (v·0.5+0.5); a = geometry mask
//  - material R=depth G=AO B=rough A=metal, 0..1
// Where the normal mask alpha ≤ 0.5 (negotiation-band pixels painted beyond the
// silhouette) the pixel takes a flat toward-camera normal — neutral lighting
// instead of a garbage decode.
//
// K0e — the model now honours the B (roughness) and A (metallic) channels the
// surface engine writes: a banded Blinn-Phong specular glint, gated by gloss
// (1−roughness) so matte faces (rubble/thatch/plaster, rough≈1) catch ZERO
// highlight and only finished/smooth faces (polished ashlar, tar, gilt, flint,
// metal) glint. AO is now read straight from G at full strength — the old
// `mix(1, G, A)` gated occlusion by *metallic* (≈0 for every non-metal), which
// silently discarded the baked AO entirely.

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
 * Compute one lit, premultiplied output pixel. Mirrors the WGSL fragment:
 *   n        = mask>0.5 ? normalize(rgb·2−1) : (0,0,1)
 *   ao       = mat.G                                  // baked AO, full strength
 *   ndl      = max(dot(n, sunDir), 0)
 *   banded   = floor(ndl·bands + 0.5) / bands
 *   diffuse  = (ambient + sunColor·banded) · ao
 *   gloss    = 1 − mat.B                              // 0 = matte, 1 = mirror
 *   half     = normalize(sunDir + viewDir)            // viewDir = +z (toward camera)
 *   specRaw  = pow(max(dot(n,half),0), 2^(2+9·gloss)) · gloss · ao
 *   specBand = floor(specRaw·bands + 0.5) / bands
 *   specTint = mix(white, albedo, mat.A)              // metals tint the highlight
 *   out      = vec4(albedo·diffuse + sunColor·specBand·specTint·albedo.a, albedo.a)
 *
 * The specular term is GATED by gloss: matte surfaces (rough≈1) contribute exactly
 * zero, so the change is invisible on rubble/thatch/plaster and only adds a glint to
 * the finishes that lowered roughness (tar/gilt/polished) or smooth works (ashlar/flint).
 */
export function bandedPbrPixel(s: PbrSample, l: PbrLight): Vec4 {
  const n = decodeNormal(s.normal);
  const ao = s.material[1];                  // G — baked ambient occlusion (1 = open)
  const rough = s.material[2];               // B — roughness
  const metal = s.material[3];               // A — metallic
  const bands = Math.max(1, l.bands);

  // Diffuse — banded Lambert (unchanged shape).
  const ndl = Math.max(n[0] * l.sunDir[0] + n[1] * l.sunDir[1] + n[2] * l.sunDir[2], 0);
  const banded = Math.floor(ndl * bands + 0.5) / bands;
  const lr = (l.ambient[0] + l.sunColor[0] * banded) * ao;
  const lg = (l.ambient[1] + l.sunColor[1] * banded) * ao;
  const lb = (l.ambient[2] + l.sunColor[2] * banded) * ao;

  // Specular — banded Blinn-Phong glint, gated to zero on matte surfaces.
  const gloss = 1 - rough;
  const hx = l.sunDir[0], hy = l.sunDir[1], hz = l.sunDir[2] + 1; // half = sunDir + (0,0,1)
  const hl = Math.hypot(hx, hy, hz) || 1;
  const ndh = Math.max((n[0] * hx + n[1] * hy + n[2] * hz) / hl, 0);
  const specPower = Math.pow(2, 2 + 9 * gloss);              // rough→4 (broad) … mirror→2048 (tight)
  const specRaw = Math.pow(ndh, specPower) * gloss * ao;
  const specBand = Math.floor(specRaw * bands + 0.5) / bands;
  const stR = mix(1, s.albedo[0], metal);                   // dielectric = white sun; metal = albedo-tinted
  const stG = mix(1, s.albedo[1], metal);
  const stB = mix(1, s.albedo[2], metal);
  const a = s.albedo[3];
  return [
    s.albedo[0] * lr + l.sunColor[0] * specBand * stR * a,
    s.albedo[1] * lg + l.sunColor[1] * specBand * stG * a,
    s.albedo[2] * lb + l.sunColor[2] * specBand * stB * a,
    a,
  ];
}
