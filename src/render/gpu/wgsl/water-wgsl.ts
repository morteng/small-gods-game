// src/render/gpu/wgsl/water-wgsl.ts
//
// Water S2 — the one blended water pass shared by all body types (ocean / lake /
// river); the type is a per-cell attribute, not a separate pass. Mirrors the
// terrain shader's GPU-generated grid (no CPU vertex arrays) but:
//   - lifts each per-cell FLAT quad to the water SURFACE height (surfaceW), and
//   - reads the (composed, i.e. river-carved) terrain height buffer to compute
//     depth = surfaceW − terrainHeight — the one variable that drives colour,
//     shoreline foam, blend-vs-opaque, and (S5) caustics.
// Flow vectors animate a ripple-perturbed normal; lighting is banded to match the
// terrain + sprites. Drawn AFTER terrain, sharing its depth buffer (greater-equal,
// no depth write) so nearer terrain still occludes water; blended over the ground.

export const WATER_WGSL = /* wgsl */ `
struct WGlobals {
  uViewport : vec2<f32>,
  uPad0     : vec2<f32>,
  uXform    : vec4<f32>,   // sx, sy, ox, oy
  uGrid     : vec2<f32>,   // cells: width, height
  uHalf     : vec2<f32>,   // iso half-tile px
  uZParams  : vec4<f32>,   // zPxPerM, seaLevel, reliefM, subsample
  uSun      : vec4<f32>,   // tile-space sun dir xyz, bands
  uAmbient  : vec4<f32>,   // ambient rgb, sun strength
  uWater    : vec4<f32>,   // time(s), shallowBand(m), foamBand(m), flags
};

@group(0) @binding(0) var<uniform> G : WGlobals;
@group(0) @binding(1) var<storage, read> terrainH : array<f32>; // normalised elev (composed)
@group(0) @binding(2) var<storage, read> surfaceW : array<f32>; // water surface, −1 dry
@group(0) @binding(3) var<storage, read> wtype    : array<u32>; // 0 dry,1 ocean,2 lake,3 river
@group(0) @binding(4) var<storage, read> flow     : array<f32>; // 2 per cell (x,y)
@group(0) @binding(5) var<storage, read> shallowC : array<u32>; // S4 biome shallow 0xAABBGGRR
@group(0) @binding(6) var<storage, read> deepC    : array<u32>; // S4 biome deep colour
@group(0) @binding(7) var<storage, read> clarity  : array<f32>; // S4 water clarity 0..1

fn cellIdx(cx : u32, cy : u32) -> u32 { return cy * u32(G.uGrid.x) + cx; }
fn unpackRgb(rgba : u32) -> vec3<f32> {
  return vec3<f32>(f32(rgba & 0xFFu), f32((rgba >> 8u) & 0xFFu), f32((rgba >> 16u) & 0xFFu)) / 255.0;
}
fn liftPx(e : f32) -> f32 { return (e - G.uZParams.y) * G.uZParams.z * G.uZParams.x; }

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vGrid : vec2<f32>,
  @location(1) @interpolate(flat) vCell : u32,
};

@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> VSOut {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let sub = max(1u, u32(G.uZParams.w));
  let quadsPerRow = max(1u, W / sub);

  let quadIdx = vid / 6u;
  let vinq = vid % 6u;
  let qx = quadIdx % quadsPerRow;
  let qy = quadIdx / quadsPerRow;
  let cellX = min(qx * sub, W - 1u);
  let cellY = min(qy * sub, H - 1u);
  let ci = cellIdx(cellX, cellY);

  var corner = vec2<u32>(0u, 0u);
  switch vinq {
    case 0u: { corner = vec2<u32>(0u, 0u); }
    case 1u: { corner = vec2<u32>(1u, 0u); }
    case 2u: { corner = vec2<u32>(0u, 1u); }
    case 3u: { corner = vec2<u32>(1u, 0u); }
    case 4u: { corner = vec2<u32>(1u, 1u); }
    default: { corner = vec2<u32>(0u, 1u); }
  }
  // Flat per-cell quad: all four corners ride this cell's surface height, so
  // lakes are flat and wet/dry boundaries are clean (a quad is wholly wet or
  // wholly discarded in the fragment).
  let gx = f32(cellX) + f32(corner.x) * f32(sub);
  let gy = f32(cellY) + f32(corner.y) * f32(sub);
  let surf = surfaceW[ci];
  let hPx = liftPx(surf);

  let scr = vec2<f32>((gx - gy) * G.uHalf.x, (gx + gy) * G.uHalf.y - hPx);
  let dev = scr * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(dev.x / (G.uViewport.x * 0.5) - 1.0, 1.0 - dev.y / (G.uViewport.y * 0.5));
  let depth = clamp((gx + gy) / (G.uGrid.x + G.uGrid.y), 0.0, 0.999);

  var out : VSOut;
  out.pos = vec4<f32>(ndc, depth, 1.0);
  out.vGrid = vec2<f32>(gx, gy);
  out.vCell = ci;
  return out;
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let ci = in.vCell;
  let typ = wtype[ci];
  if (typ == 0u) { discard; }

  let surf = surfaceW[ci];
  let th = terrainH[ci];
  let depthN = max(surf - th, 0.0);
  let depthM = depthN * G.uZParams.z;   // ≈ metres of water column

  // S4 aquatic-biome palette + clarity. Clearer water reveals the bed deeper, so
  // the shallow→deep transition (and the opacity ramp below) stretches with it.
  let clar = clarity[ci];
  let depthScale = mix(1.5, 6.0, clar);            // m to reach "deep"
  let tDeep = clamp(depthM / depthScale, 0.0, 1.0);
  var color = mix(unpackRgb(shallowC[ci]), unpackRgb(deepC[ci]), tDeep);

  // Flow-advected ripple → perturbed normal. Still water (ocean/lake) gets a
  // gentle wind ripple; rivers streak along the flow vector.
  let t = G.uWater.x;
  let fv = vec2<f32>(flow[ci * 2u], flow[ci * 2u + 1u]);
  let along = dot(in.vGrid, normalize(fv + vec2<f32>(0.0001, 0.0)));
  let ripple = sin(in.vGrid.x * 1.7 + in.vGrid.y * 1.3 - t * 1.6)
             + 0.6 * sin(along * 2.3 - t * 3.0);
  let flowMag = clamp(length(fv), 0.0, 1.0);
  let amp = 0.12 + 0.18 * flowMag;
  let n = normalize(vec3<f32>(ripple * amp, 1.0, ripple * amp * 0.5));

  // Banded diffuse (matches terrain/sprites) + a small sun sparkle.
  let ndl = max(dot(n, normalize(G.uSun.xyz)), 0.0);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5) / bands;
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;
  color = color * light + vec3<f32>(pow(banded, 6.0) * 0.25);

  // Shoreline foam: bright band where the water is very shallow.
  let foamBand = G.uWater.z;
  if (depthM < foamBand) {
    let f = 1.0 - depthM / foamBand;
    color = mix(color, vec3<f32>(0.90, 0.95, 0.97), f * f * 0.8);
  }

  // Deep = opaque (no see-through), shallow = translucent over the bed. Clear
  // water (high clarity ⇒ larger depthScale ⇒ smaller tDeep) stays see-through
  // deeper, so you read the bed/caustics through it.
  var alpha = mix(0.5, 0.97, tDeep);
  if (depthM < foamBand) { alpha = max(alpha, 0.85); }
  return vec4<f32>(color * alpha, alpha); // premultiplied
}
`;
