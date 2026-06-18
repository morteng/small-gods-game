// src/render/gpu/wgsl/blit-wgsl.ts
//
// P-E — pixel-perfect upscale blit. The scene (terrain + water + shadows +
// entities) is rendered into a fixed low-res offscreen target so the art-pixel
// size is DEFINED there, decoupled from the window/device resolution. This pass
// nearest-upscales that target onto the swapchain.
//
// `uOffset` is the snap-then-offset remainder (in OUTPUT pixels): each frame the
// camera is snapped to the art-pixel grid and the sub-pixel remainder is applied
// here as a single screen-space sample shift — stable pixels under pan/zoom with
// NO per-entity re-pack (the structural half of the jerky-zoom fix). 0 = a plain
// nearest upscale.

export const BLIT_WGSL = /* wgsl */ `
struct Globals {
  uInvOut : vec2<f32>,   // 1 / output size (px)
  uOffset : vec2<f32>,   // sub-art-pixel sample shift, in output px
};

@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var tex  : texture_2d<f32>;
@group(0) @binding(2) var<uniform> g : Globals;

struct VsOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vi : u32) -> VsOut {
  // One oversized triangle covering the whole clip space.
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let xy = corners[vi];
  var o : VsOut;
  o.pos = vec4<f32>(xy, 0.0, 1.0);
  // Clip → texture UV (flip Y: clip +y is up, texture +v is down).
  o.uv = vec2<f32>((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return o;
}

@fragment
fn fsMain(i : VsOut) -> @location(0) vec4<f32> {
  let uv = i.uv + g.uOffset * g.uInvOut;
  return textureSample(tex, samp, uv);
}
`;
