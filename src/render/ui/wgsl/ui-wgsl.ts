// src/render/ui/wgsl/ui-wgsl.ts
//
// UI quad pass (S1) — textured + tinted quads for the screen-space HUD. Runs as
// its own render pass AFTER the entity pass (no depth: painter order = submission
// order), `loadOp:'load'` over the scene colour. Output is premultiplied to match
// the surface's premultiplied src-over blend (`webgpu-context.ts`).
//
// `Solid` groups sample a 1×1 white texel so tint passes straight through; glyph
// /skin groups sample their atlas. Screen-space only in S1 — device px → NDC via
// the viewport uniform; world-anchored (zoom-tracking) labels get a view-proj
// matrix in S3.

export const UI_WGSL = /* wgsl */ `
struct Globals { uViewport : vec2<f32>, _pad : vec2<f32> };
@group(0) @binding(0) var<uniform> G : Globals;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var tex  : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv    : vec2<f32>,
  @location(1) color : vec4<f32>,
};

@vertex
fn vsMain(
  @location(0) xy    : vec2<f32>,  // device px, origin top-left
  @location(1) uv    : vec2<f32>,
  @location(2) color : vec4<f32>,  // straight RGBA 0..1
) -> VSOut {
  let ndc = vec2<f32>(
    xy.x / (G.uViewport.x * 0.5) - 1.0,
    1.0 - xy.y / (G.uViewport.y * 0.5),
  );
  var out : VSOut;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);
  out.uv = uv;
  out.color = color;
  return out;
}

@fragment
fn fsMain(
  @location(0) uv : vec2<f32>,
  @location(1) color : vec4<f32>,
) -> @location(0) vec4<f32> {
  let t = textureSample(tex, samp, uv);
  let c = color * t;
  // premultiply for the src-over blend
  return vec4<f32>(c.rgb * c.a, c.a);
}
`;
