// src/render/gpu/wgsl/lit-wgsl.ts
//
// R2c — WGSL for the raw-WebGPU instanced lit-sprite pipeline.
//
// The spike (`public/webgpu-spike.html`) proved RAW WebGPU instancing on this
// hardware (stepMode:'instance', one draw call), so the scene is hand-rolled
// WebGPU — not Pixi's custom-shader path. This shader is therefore structured
// for raw vertex-buffer instancing + explicit bind groups, NOT Pixi's uniform
// groups.
//
// Geometry: a unit quad (stepMode 'vertex') instanced once per sprite. Per-
// instance attributes (stepMode 'instance') give the destination rect, the UV
// sub-rect, and a painter-order depth (see instance-buffer.ts for the byte
// layout these @location indices must match).
//
// The DIFFUSE math mirrors `banded-pbr.ts` (the executable reference) exactly:
// hard alpha-cutout, flat-normal fallback on mask ≤ 0.5, AO = mix(1, mat.G,
// mat.A), diffuse banded by floor(ndl·bands + 0.5)/bands, premultiplied output.
// On top of that, a night-only EMISSIVE term (`uEmissiveMap.rgb · uNight`) fades
// in self-illumination (lit window panes) — absent from the TS reference, which
// models the daytime diffuse only; at uNight = 0 the two are identical.

export const LIT_WGSL = /* wgsl */ `
struct Globals {
  uViewport : vec2<f32>,   // target size in px (matches the draw list's dx/dy space)
  uBands    : f32,
  _pad0     : f32,
  uAmbient  : vec3<f32>,
  _pad1     : f32,
  uSunDir   : vec3<f32>,   // toward the light, screen space, normalized
  _pad2     : f32,
  uSunColor : vec3<f32>,
  uNight    : f32,         // 0 = day (no emissive), 1 = night (full window glow)
  uXform    : vec4<f32>,   // world→device affine: sx, sy, ox, oy (applied in VS)
};

@group(0) @binding(0) var<uniform> G : Globals;

@group(1) @binding(0) var uSampler     : sampler;
@group(1) @binding(1) var uAlbedo      : texture_2d<f32>;
@group(1) @binding(2) var uNormalMap   : texture_2d<f32>;
@group(1) @binding(3) var uMaterialMap : texture_2d<f32>;
@group(1) @binding(4) var uEmissiveMap : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vUV : vec2<f32>,
};

@vertex
fn vsMain(
  @location(0) corner : vec2<f32>,   // unit quad 0..1
  @location(1) iRect  : vec4<f32>,   // dx, dy, dw, dh  (WORLD px)
  @location(2) iUV    : vec4<f32>,   // u0, v0, u1, v1
  @location(3) iDepth : f32,         // painter-order depth, 0..1
) -> VSOut {
  // Instances are packed in WORLD px (camera-independent, so the static layer can
  // be packed once); the camera world→device affine is applied here in the VS.
  let world = iRect.xy + corner * iRect.zw;
  let px = world * G.uXform.xy + G.uXform.zw;
  // screen px (y down, origin top-left) → clip NDC (y up)
  let ndc = vec2<f32>(
    px.x / (G.uViewport.x * 0.5) - 1.0,
    1.0 - px.y / (G.uViewport.y * 0.5),
  );
  var out : VSOut;
  out.pos = vec4<f32>(ndc, iDepth, 1.0);
  out.vUV = mix(iUV.xy, iUV.zw, corner);
  return out;
}

@fragment
fn fsMain(@location(0) vUV : vec2<f32>) -> @location(0) vec4<f32> {
  let albedo = textureSample(uAlbedo, uSampler, vUV);
  if (albedo.a < 0.5) { discard; }   // hard pixel-art cutout, not soft AA

  let nrm = textureSample(uNormalMap, uSampler, vUV);
  var n = vec3<f32>(0.0, 0.0, 1.0);
  if (nrm.a > 0.5) {
    n = normalize(nrm.rgb * 2.0 - 1.0);
  }

  let mat = textureSample(uMaterialMap, uSampler, vUV);
  let ao = mix(1.0, mat.g, mat.a);

  let ndl = max(dot(n, G.uSunDir), 0.0);
  let banded = floor(ndl * G.uBands + 0.5) / G.uBands;

  let lit = (G.uAmbient + G.uSunColor * banded) * ao;
  // Self-illumination (lit window panes): added on top of the lit albedo and
  // faded in by the night factor, so panes are dark glass by day and glow at night.
  // Premultiplied: scale by alpha to stay consistent with the cutout output.
  let emissive = textureSample(uEmissiveMap, uSampler, vUV).rgb * G.uNight;
  return vec4<f32>(albedo.rgb * lit + emissive * albedo.a, albedo.a);
}
`;
