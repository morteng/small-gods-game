// src/render/gpu/wgsl/shape-wgsl.ts
//
// Solid-colour shape pass — the GPU parity draw for the draw list's `poly` and
// `circle` items (barrier/building fallback fills, NPC fallback diamonds, tree
// trunks + canopies). Triangulated on the CPU (`shape-geometry.ts`) into device-
// pixel vertices carrying their painter-order depth + an RGBA colour.
//
// Runs in the SAME render pass + depth buffer as the lit entity pass (greater =
// front, depthWrite on), so shapes interleave with sprites by depth exactly as
// the Canvas2D path interleaves them in list order. Output is premultiplied to
// match the entity pass's premultiplied src-over blend.

export const SHAPE_WGSL = /* wgsl */ `
struct Globals { uViewport : vec2<f32>, _pad : vec2<f32> };
@group(0) @binding(0) var<uniform> G : Globals;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vColor : vec4<f32>,
};

@vertex
fn vsMain(
  @location(0) posDepth : vec3<f32>,  // x, y (device px), depth (0..1)
  @location(1) color    : vec4<f32>,  // straight RGBA 0..1
) -> VSOut {
  let ndc = vec2<f32>(
    posDepth.x / (G.uViewport.x * 0.5) - 1.0,
    1.0 - posDepth.y / (G.uViewport.y * 0.5),
  );
  var out : VSOut;
  out.pos = vec4<f32>(ndc, posDepth.z, 1.0);
  out.vColor = color;
  return out;
}

@fragment
fn fsMain(@location(0) vColor : vec4<f32>) -> @location(0) vec4<f32> {
  // Premultiply for the src-over blend the entity pass uses.
  return vec4<f32>(vColor.rgb * vColor.a, vColor.a);
}
`;
