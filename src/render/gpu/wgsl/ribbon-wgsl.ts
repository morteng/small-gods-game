// src/render/gpu/wgsl/ribbon-wgsl.ts
//
// Ribbon pass (roads-epic T7) — draws the swept road/river ribbon meshes from
// `ribbon-geometry.ts` as a terrain-following parametric surface. The vertex
// shader LIFTS each tile-space vertex onto the SAME terrain height buffer the
// terrain shader reads (bilinear, so the ribbon hugs the graded ground between
// cell centres) and iso-projects it with the SAME projection — so a ribbon sits
// exactly on the terrain it was grade-cut / carved into, with no per-frame CPU
// lift. The fragment shader sweeps surface detail across the parametric
// attributes the geometry baked: `across` (−1..+1 bank), `along` (arc length),
// width, tangent (flow dir) and speed.
//
// This slice shades ROADS (cobbles/dirt, banks feathered into the ground); the
// river fragment program (flow + foam) lands in R2, switched on the same pipeline
// by the per-ribbon tag + a `kind` uniform. Reuses the terrain TGlobals uniform
// (binding 0) + height buffer (binding 1) verbatim; binding 2 is a tiny ribbon
// params block (time for river flow; unused by roads).

export const RIBBON_WGSL = /* wgsl */ `
struct TGlobals {
  uViewport : vec2<f32>,
  uPad0     : vec2<f32>,
  uXform    : vec4<f32>,   // sx, sy, ox, oy
  uGrid     : vec2<f32>,   // cells: width, height
  uHalf     : vec2<f32>,   // iso half-tile px
  uZParams  : vec4<f32>,   // zPxPerM (exaggeration), seaLevel, reliefM, subsample
  uSun      : vec4<f32>,   // tile-space sun dir xyz, bands
  uAmbient  : vec4<f32>,   // ambient rgb, sun strength
};
struct RParams {
  uTime  : f32,
  uKind  : f32,            // 0 = road, 1 = river (R2)
  uPad   : vec2<f32>,
};

@group(0) @binding(0) var<uniform> G : TGlobals;
@group(0) @binding(1) var<storage, read> heights : array<f32>;
@group(0) @binding(2) var<uniform> R : RParams;

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
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
fn fbm(p : vec2<f32>) -> f32 {
  var v = 0.0; var amp = 0.5; var q = p;
  for (var k = 0u; k < 3u; k = k + 1u) {
    v = v + amp * vnoise(q);
    q = q * 2.03 + vec2<f32>(11.7, 4.3);
    amp = amp * 0.5;
  }
  return v;
}

// Bilinear normalised elevation at fractional tile pos (matches the terrain mesh
// between cell centres → the ribbon never floats above / sinks below the ground).
fn sampleElev(p : vec2<f32>) -> f32 {
  let W = i32(G.uGrid.x); let H = i32(G.uGrid.y);
  let fx = clamp(p.x, 0.0, f32(W - 1));
  let fy = clamp(p.y, 0.0, f32(H - 1));
  let x0 = i32(floor(fx)); let y0 = i32(floor(fy));
  let x1 = min(x0 + 1, W - 1); let y1 = min(y0 + 1, H - 1);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let h00 = heights[y0 * W + x0]; let h10 = heights[y0 * W + x1];
  let h01 = heights[y1 * W + x0]; let h11 = heights[y1 * W + x1];
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), ty);
}
fn heightPxAt(p : vec2<f32>) -> f32 {
  return (sampleElev(p) - G.uZParams.y) * G.uZParams.z * G.uZParams.x;
}

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vAcross  : f32,
  @location(1) vAlong   : f32,
  @location(2) vWidth   : f32,
  @location(3) vTangent : vec2<f32>,
  @location(4) vSpeed   : f32,
  @location(5) vTag     : vec2<f32>,
  @location(6) vGrid    : vec2<f32>,
};

@vertex
fn vsMain(
  @location(0) aPos : vec2<f32>,
  @location(1) aAcross : f32,
  @location(2) aAlong : f32,
  @location(3) aWidth : f32,
  @location(4) aTangent : vec2<f32>,
  @location(5) aSpeed : f32,
  @location(6) aTag : vec2<f32>,
) -> VSOut {
  let hPx = heightPxAt(aPos);
  // A hair of lift so the ribbon never z-fights the terrain it rides on.
  let scr = vec2<f32>((aPos.x - aPos.y) * G.uHalf.x, (aPos.x + aPos.y) * G.uHalf.y - hPx - 0.5);
  let dev = scr * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(dev.x / (G.uViewport.x * 0.5) - 1.0, 1.0 - dev.y / (G.uViewport.y * 0.5));
  // Spatial iso depth matched to the terrain pass; greater-equal lets the ribbon
  // win the tie at its own cells and draw ON the ground.
  let depth = clamp((aPos.x + aPos.y) / (G.uGrid.x + G.uGrid.y), 0.0, 0.999);

  var out : VSOut;
  out.pos = vec4<f32>(ndc, depth, 1.0);
  out.vAcross = aAcross;
  out.vAlong = aAlong;
  out.vWidth = aWidth;
  out.vTangent = aTangent;
  out.vSpeed = aSpeed;
  out.vTag = aTag;
  out.vGrid = aPos;
  return out;
}

// ── Road surface palette (tag.x: 0 dirt, 1 stone) ──
const DIRT  = vec3<f32>(0.37, 0.30, 0.20);
const DIRT2 = vec3<f32>(0.30, 0.24, 0.16);
const STONE = vec3<f32>(0.52, 0.49, 0.45);
const STONE2= vec3<f32>(0.40, 0.38, 0.35);
const MORTAR= vec3<f32>(0.24, 0.23, 0.21);

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let aa = abs(in.vAcross);
  // tag.x = road TIER (0 path · 1 rutted track · 2 packed road · 3 cobbled+curb).
  let tier = i32(in.vTag.x + 0.5);

  // Bank feather: fade the ribbon out so it melts into the ground. Cobbled roads
  // keep a harder edge (the curb) than trodden dirt paths.
  let ragged = (fbm(in.vGrid * 1.7) - 0.5) * 0.10;
  var edgeStart = 0.78;
  if (tier == 3) { edgeStart = 0.90; }
  if (tier == 0) { edgeStart = 0.62; }   // a path has no firm edge at all
  let alpha = smoothstep(1.0, edgeStart, aa + ragged);

  var col : vec3<f32>;
  if (tier == 3) {
    // Cobblestones laid along the ribbon (u = along, v = across); mortar lines
    // darken the cell borders, per-cell jitter breaks uniformity.
    let cellLen = 0.5;
    let u = in.vAlong / cellLen;
    let v = (in.vAcross * in.vWidth) / cellLen;
    let cell = floor(vec2<f32>(u, v));
    let f = fract(vec2<f32>(u, v)) - 0.5;
    let jitter = hash21(cell);
    let edge = max(abs(f.x), abs(f.y));
    let mortar = smoothstep(0.36, 0.46, edge);
    col = mix(mix(STONE2, STONE, jitter), MORTAR, mortar);
    col *= 0.92 + 0.16 * vnoise(in.vGrid * 6.0);
    // Raised stone CURB: a lighter dressed-stone band along each outer edge.
    let curb = smoothstep(0.72, 0.86, aa);
    col = mix(col, vec3<f32>(0.60, 0.58, 0.54), curb * 0.85);
  } else {
    // Dirt family. fbm mottling base; detail accretes with tier (usage/upkeep).
    let mottle = fbm(in.vGrid * 3.0);
    col = mix(DIRT2, DIRT, mottle);
    if (tier == 0) {
      // Foot PATH: a fainter, lighter trodden line, narrower already by geometry.
      col = mix(col, DIRT * 1.06, 0.35);
    }
    if (tier >= 1) {
      // Wheel RUTS either side of centre (deeper/darker on the busier road).
      let rutDepth = select(0.55, 0.7, tier == 1);
      let rut = smoothstep(0.12, 0.0, abs(aa - 0.45));
      col = mix(col, DIRT2 * 0.78, rut * rutDepth);
    }
    if (tier == 1) {
      // TRACK: a grassy median strip down the middle, only where traffic is light
      // (noise-gated patches) — the cart-track-with-a-green-spine look.
      let median = smoothstep(0.16, 0.03, aa);
      let grassy = smoothstep(0.5, 0.72, fbm(in.vGrid * 0.5));
      col = mix(col, vec3<f32>(0.31, 0.41, 0.20), median * grassy * 0.85);
    }
    if (tier == 2) {
      // Packed ROAD: a little pale gravel speckle for a maintained surface.
      col = mix(col, vec3<f32>(0.55, 0.50, 0.42), smoothstep(0.7, 0.95, vnoise(in.vGrid * 7.0)) * 0.25);
    }
  }

  // River branch (R2): kind is a runtime uniform so this can't be folded away —
  // it both reserves the flow shading and keeps binding 2 (RParams) live under the
  // auto bind-group layout. Roads run with uKind = 0, so this never triggers yet.
  if (R.uKind > 0.5) {
    let flow = fract(in.vAlong * 0.5 - R.uTime * (0.2 + in.vSpeed));
    col = mix(col, vec3<f32>(0.55, 0.70, 0.78), smoothstep(0.45, 0.5, flow) * 0.3);
  }

  // Flat banded lighting (ribbon rides graded ~level ground, normal ≈ up) so it
  // sits in the same light as the terrain without recomputing a normal.
  let ndl = max(G.uSun.y, 0.0) / max(length(G.uSun.xyz), 1e-3);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5) / bands;
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;

  return vec4<f32>(col * light * alpha, alpha);
}
`;
