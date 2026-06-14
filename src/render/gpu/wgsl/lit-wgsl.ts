// src/render/gpu/wgsl/lit-wgsl.ts
//
// R2b — WGSL port of the banded-PBR lit-sprite shader (`pixi/lit-shader.ts`).
// Held as an exported TS string (like `lit-shader.ts` holds its GLSL) so it is
// importable, structurally testable, and bundles without a raw-loader.
//
// The fragment math mirrors `banded-pbr.ts` (the executable reference) exactly:
// flat-normal fallback on mask ≤ 0.5, AO = mix(1, mat.G, mat.A), diffuse banded
// by floor(ndl·bands + 0.5)/bands, premultiplied output.
//
// Binding groups follow Pixi v8's WebGPU GpuProgram convention (group 0 global,
// group 1 local/mesh, group 2 custom resources). Pixi extracts the exact layout
// from this source via WGSL reflection; the precise binding indices are validated
// in-browser when the GpuProgram is constructed in R2c. Until then this is the
// canonical shader text, math-verified against `banded-pbr.ts`.

export const LIT_WGSL = /* wgsl */ `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};

struct LightUniforms {
  uAmbient: vec3<f32>,
  uSunDir: vec3<f32>,
  uSunColor: vec3<f32>,
  uBands: f32,
};

@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

@group(2) @binding(0) var<uniform> light : LightUniforms;
@group(2) @binding(1) var uAlbedo : texture_2d<f32>;
@group(2) @binding(2) var uAlbedoSampler : sampler;
@group(2) @binding(3) var uNormalMap : texture_2d<f32>;
@group(2) @binding(4) var uNormalSampler : sampler;
@group(2) @binding(5) var uMaterialMap : texture_2d<f32>;
@group(2) @binding(6) var uMaterialSampler : sampler;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
};

@vertex
fn vsMain(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
) -> VSOut {
  let mvp = globalUniforms.uProjectionMatrix
          * globalUniforms.uWorldTransformMatrix
          * localUniforms.uTransformMatrix;
  let pos = mvp * vec3<f32>(aPosition, 1.0);
  var out: VSOut;
  out.position = vec4<f32>(pos.xy, 0.0, 1.0);
  out.vUV = aUV;
  return out;
}

@fragment
fn fsMain(@location(0) vUV: vec2<f32>) -> @location(0) vec4<f32> {
  let albedo = textureSample(uAlbedo, uAlbedoSampler, vUV);

  let nrm = textureSample(uNormalMap, uNormalSampler, vUV);
  var n = vec3<f32>(0.0, 0.0, 1.0);
  if (nrm.a > 0.5) {
    n = normalize(nrm.rgb * 2.0 - 1.0);
  }

  let mat = textureSample(uMaterialMap, uMaterialSampler, vUV);
  let ao = mix(1.0, mat.g, mat.a);

  let ndl = max(dot(n, light.uSunDir), 0.0);
  let banded = floor(ndl * light.uBands + 0.5) / light.uBands;

  let lit = (light.uAmbient + light.uSunColor * banded) * ao;
  return vec4<f32>(albedo.rgb * lit, albedo.a);
}
`;
