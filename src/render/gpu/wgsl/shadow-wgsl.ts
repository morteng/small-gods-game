// src/render/gpu/wgsl/shadow-wgsl.ts
//
// Cast-shadow pass for the raw-WebGPU scene — the GPU port of the PixiJS layer's
// projected/baked cast shadows (`pixi-entity-layer.ts::populateShadows`).
//
// ONE shader, ONE pass, STENCIL-gated (see gpu-scene.ts). This replaced the
// earlier offscreen-accumulate + fullscreen-composite pair: on a fill-rate-bound
// iGPU the fullscreen composite (shading the WHOLE canvas every frame) was a
// measured bottleneck. Now each shadow parallelogram draws premultiplied black
// at the capped container alpha (0.32) DIRECTLY onto the scene colour target,
// and the stencil buffer guarantees each pixel darkens at most once — so
// overlapping shadows UNION instead of double-darkening, exactly like the old
// composite, but touching only shadow-covered pixels (never the full screen).
//
// Each shadow is a *parallelogram* (four explicit corners) — a skewed silhouette
// projected up the sun ray, or an axis-aligned baked ground quad. The fragment
// samples the source texture's ALPHA only; fully-transparent texels are
// `discard`ed so they neither darken nor mark the stencil (else a sprite's
// transparent border would block shadows there).
//
// Corner order matches the unit quad (0,0)(1,0)(0,1)(1,1): cTop = (TL,TR) at the
// texture top (v0), cBot = (BL,BR) at the texture bottom (v1). The vertex shader
// bilinearly interpolates corners, so the SAME format serves the sheared
// silhouette and the rectangular baked quad.

export const SHADOW_WGSL = /* wgsl */ `
// uXform = world→device transform (sx, sy, ox, oy). Shadow corners arrive in
// WORLD px now (L2: the static half is packed ONCE, camera-independent) and the
// camera bake happens here in the shader — exactly like the entity pass (uXform
// in lit-wgsl). A uniform scale preserves the screen-space shadow lean ratios.
struct Globals { uViewport : vec2<f32>, uAlpha : f32, _pad : f32, uXform : vec4<f32> };
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
  let world = mix(top, bot, corner.y);
  let px = world * G.uXform.xy + G.uXform.zw;   // world → device px
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
  // Transparent texels must not darken OR mark the stencil — discard them so a
  // sprite's transparent border doesn't block real shadow at that pixel.
  if (a < 0.04) { discard; }
  // Premultiplied black at the capped container alpha; the stencil (set in the
  // pipeline) makes overlapping shadows union instead of double-darkening.
  return vec4<f32>(0.0, 0.0, 0.0, a * G.uAlpha);
}
`;
