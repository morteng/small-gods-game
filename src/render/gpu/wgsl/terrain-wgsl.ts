// src/render/gpu/wgsl/terrain-wgsl.ts
//
// T1 (buffer-driven GPU terrain) — architecture adapted from icegame's
// iso_mesh.wgsl, simplified for our banded pixel-art look + screen-space iso.
// See docs/superpowers/specs/2026-06-15-terrain-rendering-system-design.md.
//
//  - The mesh is GENERATED in the vertex shader from @builtin(vertex_index) + a
//    HEIGHT storage buffer — no CPU vertex arrays, no per-frame rebuild. The
//    height buffer is the heightAt = base (+) deformations field; the sibling
//    sessions' deformation channel writes it, the GPU reads it.
//  - NORMALS are computed in-shader from 4 neighbour heights (central
//    differences) -> smooth lighting, no skirts, no cracks (continuous surface).
//  - Adaptive SUBSAMPLE LOD caps the quad count on big maps.
//  - Projection stays SCREEN-SPACE ISO (height -> screen-y lift) so terrain and
//    billboard sprites share one space; a spatial iso depth makes the lifted
//    surface self-occlude (own depth pass, never mixed with the entity scheme).
//  - Lighting is BANDED (quantised n.sun) like the sprites. Material layers
//    (snow/ice/water/mud) arrive in T3 via per-cell climate buffers; this slice
//    is biome colour only.

export const TERRAIN_WGSL = /* wgsl */ `
struct TGlobals {
  uViewport : vec2<f32>,
  uPad0     : vec2<f32>,
  uXform    : vec4<f32>,   // sx, sy, ox, oy : device = world * sxy + oxy
  uGrid     : vec2<f32>,   // cells: width, height
  uHalf     : vec2<f32>,   // iso half-tile: halfW, halfH (px)
  uZParams  : vec4<f32>,   // zPxPerM, seaLevel, reliefM, subsample
  uSun      : vec4<f32>,   // tile-space sun dir xyz, bands
  uAmbient  : vec4<f32>,   // ambient rgb, sun strength
};

@group(0) @binding(0) var<uniform> G : TGlobals;
@group(0) @binding(1) var<storage, read> heights : array<f32>; // normalised elev [0,1], row-major
@group(0) @binding(2) var<storage, read> colors  : array<u32>; // 0xAABBGGRR per cell

fn cellIdx(cx : u32, cy : u32) -> u32 { return cy * u32(G.uGrid.x) + cx; }

// Screen-px lift of a cell from its normalised elevation.
fn heightPx(cx : u32, cy : u32) -> f32 {
  let e = heights[cellIdx(cx, cy)];
  return (e - G.uZParams.y) * G.uZParams.z * G.uZParams.x;
}

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vNormal : vec3<f32>,
  @location(1) vGrid   : vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> VSOut {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let sub = max(1u, u32(G.uZParams.w));
  let quadsPerRow = max(1u, W / sub);

  let quadIdx = vid / 6u;
  let vertInQuad = vid % 6u;
  let qx = quadIdx % quadsPerRow;
  let qy = quadIdx / quadsPerRow;

  var corner = vec2<u32>(0u, 0u);
  switch vertInQuad {
    case 0u: { corner = vec2<u32>(0u, 0u); }
    case 1u: { corner = vec2<u32>(1u, 0u); }
    case 2u: { corner = vec2<u32>(0u, 1u); }
    case 3u: { corner = vec2<u32>(1u, 0u); }
    case 4u: { corner = vec2<u32>(1u, 1u); }
    default: { corner = vec2<u32>(0u, 1u); }
  }
  let gx = min(qx * sub + corner.x * sub, W - 1u);
  let gy = min(qy * sub + corner.y * sub, H - 1u);

  let hPx = heightPx(gx, gy);

  // Normal from neighbour heights (central differences); tile space x=east,
  // y=up, z=south. Flat ground gives (0,1,0). sub scales the up term so slope
  // magnitude is independent of subsample spacing.
  var normal = vec3<f32>(0.0, 1.0, 0.0);
  if (gx > 0u && gx < W - 1u && gy > 0u && gy < H - 1u) {
    let hl = heightPx(gx - 1u, gy);
    let hr = heightPx(gx + 1u, gy);
    let hu = heightPx(gx, gy - 1u);
    let hd = heightPx(gx, gy + 1u);
    normal = normalize(vec3<f32>(-(hr - hl) * 0.5, f32(sub) * G.uHalf.y, -(hd - hu) * 0.5));
  }

  // Screen-space iso projection (matches worldToScreen); height lifts -y.
  let fx = f32(gx);
  let fy = f32(gy);
  let scr = vec2<f32>((fx - fy) * G.uHalf.x, (fx + fy) * G.uHalf.y - hPx);
  let dev = scr * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(dev.x / (G.uViewport.x * 0.5) - 1.0, 1.0 - dev.y / (G.uViewport.y * 0.5));

  // Spatial iso depth in [0,1): larger (fx+fy) = more in front (depthCompare
  // 'greater'). Terrain owns its depth pass, so this never mixes with the
  // entity index-depth scheme.
  let depth = clamp((fx + fy) / (G.uGrid.x + G.uGrid.y), 0.0, 0.999);

  var out : VSOut;
  out.pos = vec4<f32>(ndc, depth, 1.0);
  out.vNormal = normal;
  out.vGrid = vec2<f32>(fx, fy);
  return out;
}

fn unpackColor(rgba : u32) -> vec3<f32> {
  let r = f32(rgba & 0xFFu) / 255.0;
  let g = f32((rgba >> 8u) & 0xFFu) / 255.0;
  let b = f32((rgba >> 16u) & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let cx = min(u32(in.vGrid.x + 0.5), W - 1u);
  let cy = min(u32(in.vGrid.y + 0.5), H - 1u);
  let base = unpackColor(colors[cellIdx(cx, cy)]);

  // Banded diffuse so the lit relief stays pixel-art (matches the sprites).
  let n = normalize(in.vNormal);
  let ndl = max(dot(n, normalize(G.uSun.xyz)), 0.0);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5) / bands;
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;
  return vec4<f32>(base * light, 1.0);
}
`;
