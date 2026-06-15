// src/render/gpu/wgsl/shadow-wgsl.ts
//
// Cast-shadow pass for the raw-WebGPU scene — the GPU port of the PixiJS layer's
// projected/baked cast shadows (`pixi-entity-layer.ts::populateShadows`).
//
// Two shaders, two passes (see gpu-scene.ts):
//
//  1. ACCUMULATE (SHADOW_WGSL): each shadow is a *parallelogram* (four explicit
//     corners) — a skewed silhouette projected up the sun ray, or an
//     axis-aligned baked ground quad. The fragment samples the source texture's
//     ALPHA only and writes premultiplied black into a transparent offscreen
//     texture with src-over blending. Overlapping shadows therefore UNION (alpha
//     saturates toward 1) instead of stacking — the GPU equivalent of Pixi's
//     "all shadows in one container".
//
//  2. COMPOSITE (SHADOW_COMPOSITE_WGSL): a fullscreen triangle samples that
//     offscreen texture and lays it over the scene at a fixed alpha (0.32, the
//     same container alpha Pixi used) — so the union darkens the ground once,
//     never twice where shadows overlap.
//
// Corner order matches the unit quad (0,0)(1,0)(0,1)(1,1): cTop = (TL,TR) at the
// texture top (v0), cBot = (BL,BR) at the texture bottom (v1). The vertex shader
// bilinearly interpolates corners, so the SAME format serves the sheared
// silhouette and the rectangular baked quad.

export const SHADOW_WGSL = /* wgsl */ `
struct Globals { uViewport : vec2<f32>, _pad : vec2<f32> };
@group(0) @binding(0) var<uniform> G : Globals;

@group(1) @binding(0) var uSampler : sampler;
@group(1) @binding(1) var uTex     : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vUV : vec2<f32>,
};

@vertex
fn vsMain(
  @location(0) corner : vec2<f32>,   // unit quad 0..1
  @location(1) cTop   : vec4<f32>,   // TL.xy, TR.xy  (screen px)
  @location(2) cBot   : vec4<f32>,   // BL.xy, BR.xy  (screen px)
  @location(3) iUV    : vec4<f32>,   // u0, v0, u1, v1
) -> VSOut {
  let top = mix(cTop.xy, cTop.zw, corner.x);
  let bot = mix(cBot.xy, cBot.zw, corner.x);
  let px  = mix(top, bot, corner.y);
  let ndc = vec2<f32>(
    px.x / (G.uViewport.x * 0.5) - 1.0,
    1.0 - px.y / (G.uViewport.y * 0.5),
  );
  var out : VSOut;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  out.vUV = mix(iUV.xy, iUV.zw, corner);
  return out;
}

@fragment
fn fsMain(@location(0) vUV : vec2<f32>) -> @location(0) vec4<f32> {
  let a = textureSample(uTex, uSampler, vUV).a;
  // Premultiplied black; src-over blend unions overlapping shadows.
  return vec4<f32>(0.0, 0.0, 0.0, a);
}
`;

export const SHADOW_COMPOSITE_WGSL = /* wgsl */ `
// Scalar pads (NOT a vec3) so the struct stays 16 bytes — a vec3 member would
// force 16-byte alignment and bloat the struct to 32, mismatching the buffer.
struct CompGlobals { uAlpha : f32, _pad0 : f32, _pad1 : f32, _pad2 : f32 };
@group(0) @binding(0) var<uniform> C : CompGlobals;
@group(0) @binding(1) var uSampler : sampler;
@group(0) @binding(2) var uShadow  : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vUV : vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vi : u32) -> VSOut {
  // Oversized fullscreen triangle.
  var P = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0),
  );
  let p = P[vi];
  var out : VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.vUV = vec2<f32>(0.5 * p.x + 0.5, 0.5 - 0.5 * p.y);
  return out;
}

@fragment
fn fsMain(@location(0) vUV : vec2<f32>) -> @location(0) vec4<f32> {
  let s = textureSample(uShadow, uSampler, vUV);   // (0,0,0, union-alpha)
  // Premultiplied black at the capped container alpha; src-over darkens once.
  return vec4<f32>(0.0, 0.0, 0.0, s.a * C.uAlpha);
}
`;
