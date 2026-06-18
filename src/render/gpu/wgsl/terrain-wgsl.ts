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
@group(0) @binding(3) var<storage, read> moisture    : array<f32>; // [0,1] per cell (T-A)
@group(0) @binding(4) var<storage, read> temperature : array<f32>; // [0,1] per cell (T-A)

fn cellIdx(cx : u32, cy : u32) -> u32 { return cy * u32(G.uGrid.x) + cx; }

// Cheap value noise for jittering material thresholds so edges wander (kills the
// flat contour rings / square biome borders that betray procedural terrain).
fn hash21(p : vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

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

// 4×4 ordered Bayer threshold, returns (value/16 - 0.5/16) ∈ ~[-0.5,0.5)/1. The
// scene renders into the LOW-RES (art-pixel) target, so the fragment's framebuffer
// coord IS the art-texel index — one dither cell per art pixel, upscaled crisply by
// the nearest blit. This is the "pixel-art way": gradients/band edges become an
// ordered stipple in art-pixel space instead of smooth ramps or hard contour lines.
fn bayer4(p : vec2<f32>) -> f32 {
  let ix = u32(i32(floor(p.x)) & 3);
  let iy = u32(i32(floor(p.y)) & 3);
  let i = iy * 4u + ix;
  var m = array<f32, 16>(
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0,
  );
  return (m[i] + 0.5) / 16.0 - 0.5;   // [-0.5, 0.5)
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let cx = min(u32(in.vGrid.x + 0.5), W - 1u);
  let cy = min(u32(in.vGrid.y + 0.5), H - 1u);
  let ci = cellIdx(cx, cy);
  let base = unpackColor(colors[ci]);            // biome albedo (the "ground" layer)

  let n = normalize(in.vNormal);
  let slope = clamp(1.0 - n.y, 0.0, 1.0);        // 0 flat → 1 vertical, free from normal

  // Shared-field reads: the material axis is computed downstream of the producers
  // (mountains/roads only wrote HEIGHT) so texturing stays consistent with biome.
  let elev = heights[ci];
  let seaLevel = G.uZParams.y;
  let aboveSea = elev - seaLevel;
  let moist = moisture[ci];
  let temp = temperature[ci];
  let jit = vnoise(in.vGrid * 0.35) - 0.5;       // [-0.5,0.5] threshold wander

  // Material WEIGHTS — each becomes a height-blend layer below.
  let wRock = smoothstep(0.42, 0.78, slope + jit * 0.18);                 // steep faces
  let wSnow = smoothstep(0.30, 0.16, temp + jit * 0.06)                   // cold + settles
            * smoothstep(0.45, 0.72, n.y);
  let sandBand = 0.05 + jit * 0.015;
  let wSand = step(0.0, aboveSea) * (1.0 - smoothstep(0.0, sandBand, aboveSea)); // shore band
  let wMud  = smoothstep(0.62, 0.92, moist)                              // wet low gentle ground
            * (1.0 - smoothstep(0.18, 0.40, slope))
            * (1.0 - smoothstep(0.06, 0.22, aboveSea));

  // Stylized material albedos (palette-tuned later via world-style).
  let ROCK = vec3<f32>(0.42, 0.40, 0.38);
  let SNOW = vec3<f32>(0.90, 0.93, 0.97);
  let SAND = vec3<f32>(0.80, 0.74, 0.55);
  let MUD  = vec3<f32>(0.30, 0.24, 0.17);

  // HEIGHT-BLEND composite (crisp, NOT linear-alpha mush): the biome base is the
  // ground layer at a constant height; each material pokes through where its weight
  // exceeds the running max within a transition band ("sand fills the cracks").
  let band = 0.12;
  let hGround = 0.34;
  let m = max(max(hGround, wRock), max(wSnow, max(wSand, wMud))) - band;
  let bG = max(hGround - m, 0.0);
  let bR = max(wRock   - m, 0.0);
  let bS = max(wSnow   - m, 0.0);
  let bA = max(wSand   - m, 0.0);
  let bM = max(wMud    - m, 0.0);
  let sum = bG + bR + bS + bA + bM + 1e-4;
  let albedo = (base * bG + ROCK * bR + SNOW * bS + SAND * bA + MUD * bM) / sum;

  // Wet-sand band (T-C shore coordination): damp + darken the land within a thin
  // strip just above the waterline so the water pass's contact-fade edge melts into
  // wet ground instead of a hard line. Land-only (step) — the bed under water keeps
  // its colour since the water pass draws over it.
  let wet = smoothstep(0.045, 0.0, aboveSea) * step(0.0, aboveSea);
  let shoreAlbedo = albedo * mix(1.0, 0.6, wet);

  // Ordered dither in ART-PIXEL space (in.pos = low-res target framebuffer coord).
  let dith = bayer4(in.pos.xy);

  // Banded diffuse so the lit relief stays pixel-art (matches the sprites). The
  // band threshold is dithered by ±½ a band so the boundary between two light
  // terraces becomes a 1-art-pixel ordered stipple instead of a hard contour ring.
  let ndl = max(dot(n, normalize(G.uSun.xyz)), 0.0);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5 + dith) / bands;
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;

  // Posterize the final colour to a fixed number of levels per channel, with the
  // SAME ordered dither applied before quantization — turns the height-blend /
  // biome gradients into a crisp dithered palette (no smooth mush) while keeping
  // the apparent colour range. Opaque output, no alpha blending.
  let LV = 16.0;
  let col = floor(shoreAlbedo * light * LV + 0.5 + dith) / LV;
  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
