// src/render/gpu/wgsl/structure-mesh-wgsl.ts
//
// Structure-mesh pass (3D-structure epic, S1). A depth-tested 3D pass for ground-anchored
// structural geometry (bridges first), sharing the TERRAIN globals + depth buffer so a
// structure interleaves with the heightfield instead of drawing as a flat billboard.
//
//  - VS: object verts arrive in WORLD tile/cube coords (footprint-placed, lift folded into z
//    by the field builder). It runs the SAME screen-space iso projection the terrain vertex
//    shader uses (worldToScreen: (fx-fy)*halfW, (fx+fy)*halfH - zPx), so register with terrain
//    and sprites is exact, and writes the SAME height-independent iso depth
//    clamp((fx+fy)/(W+H),0,0.999) — so masonry that plunges below the visible bed is occluded
//    by nearer terrain (founding) and structures resolve each other by true tile depth.
//  - FS: the terrain banded diffuse verbatim (floor(ndl*bands+0.5)/bands over the tile-space
//    sun) so structures shade under the same sun as the ground they stand on.
//
// Binds ONE group: the terrain globals uniform (uHalf, uZParams, uGrid, uXform, uViewport,
// uSun, uAmbient). No storage buffers, no per-draw uniform — placement is baked per vertex.
// NOTE: no backticks inside this template literal (they close the WGSL string).

export const STRUCTURE_MESH_WGSL = /* wgsl */ `
struct TGlobals {
  uViewport : vec2<f32>,
  uMode     : vec2<f32>,
  uXform    : vec4<f32>,   // sx, sy, ox, oy : device = world * sxy + oxy
  uGrid     : vec2<f32>,   // cells: width, height
  uHalf     : vec2<f32>,   // iso half-tile: halfW, halfH (px)
  uZParams  : vec4<f32>,   // zPxPerM, seaLevel, reliefM, subsample
  uSun      : vec4<f32>,   // tile-space sun dir xyz, bands
  uAmbient  : vec4<f32>,   // ambient rgb, sun strength
  uWindow   : vec4<f32>,
  uFlags    : vec4<f32>,
};
@group(0) @binding(0) var<uniform> G : TGlobals;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vNormal : vec3<f32>,
  @location(1) vAlbedo : vec3<f32>,
};

@vertex
fn vsMain(
  @location(0) inPos : vec3<f32>,     // world tile x, tile y, cube-unit z (lift folded in)
  @location(1) inNormal : vec3<f32>,  // terrain-frame normal (x east, y up, z south)
  @location(2) inAlbedo : vec3<f32>,  // rgb 0..1
) -> VSOut {
  let fx = inPos.x;
  let fy = inPos.y;
  // One cube-unit lifts by HEIGHT_UNIT_PX = ISO_TILE_H = 2 * halfH px (scale-contract.ts).
  let zPx = inPos.z * (G.uHalf.y * 2.0);
  let scr = vec2<f32>((fx - fy) * G.uHalf.x, (fx + fy) * G.uHalf.y - zPx);
  let dev = scr * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(dev.x / (G.uViewport.x * 0.5) - 1.0, 1.0 - dev.y / (G.uViewport.y * 0.5));
  // Height-independent iso depth from the GROUND-projected footprint tile, matching terrain
  // (terrain-wgsl.ts): nearer tiles (larger fx+fy) win, height never enters — so a footing
  // that drops below the bed is occluded by the nearer bank instead of drawing over it.
  let depth = clamp((fx + fy) / (G.uGrid.x + G.uGrid.y), 0.0, 0.999);
  var out : VSOut;
  out.pos = vec4<f32>(ndc, depth, 1.0);
  out.vNormal = inNormal;
  out.vAlbedo = inAlbedo;
  return out;
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.vNormal);
  let ndl = max(dot(n, normalize(G.uSun.xyz)), 0.0);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5) / bands;            // banded diffuse, like the ground
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;
  return vec4<f32>(in.vAlbedo * light, 1.0);
}
`;
