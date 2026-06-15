// src/render/gpu/wgsl/terrain-wgsl.ts
//
// R2d — WGSL for the GPU terrain pass: a flat-shaded, per-vertex-coloured
// heightfield mesh (NOT instanced, NOT textured — the opposite of the sprite
// pipeline). Vertices arrive in WORLD screen space (the pure `terrain-mesh.ts`
// stays camera-agnostic); the view transform (camera zoom + snapped offset ×
// DPR) is applied here from a uniform so no per-vertex CPU rebake is needed.
//
// Drawn FIRST in the frame at constant back-most depth (0) with depthCompare
// 'always' + no depth write: the index buffer is iso back-to-front, so painter
// order resolves terrain self-overlap (a lifted back hill over a front tile),
// and the entity pass (depthCompare 'greater', depths > 0) then draws over it.

export const TERRAIN_WGSL = /* wgsl */ `
struct TerrainGlobals {
  uViewport : vec2<f32>,   // target size in px
  _pad      : vec2<f32>,
  uXform    : vec4<f32>,   // sx, sy, ox, oy : screen = world * sxy + oxy
};

@group(0) @binding(0) var<uniform> G : TerrainGlobals;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vColor : vec3<f32>,
};

@vertex
fn vsMain(
  @location(0) world : vec2<f32>,   // world screen-space position
  @location(1) color : vec3<f32>,   // flat per-vertex tile colour
) -> VSOut {
  let px = world * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(
    px.x / (G.uViewport.x * 0.5) - 1.0,
    1.0 - px.y / (G.uViewport.y * 0.5),
  );
  var out : VSOut;
  out.pos = vec4<f32>(ndc, 0.0, 1.0);   // back-most depth; painter order via indices
  out.vColor = color;
  return out;
}

@fragment
fn fsMain(@location(0) vColor : vec3<f32>) -> @location(0) vec4<f32> {
  return vec4<f32>(vColor, 1.0);   // opaque ground
}
`;
