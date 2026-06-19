// src/render/gpu/wgsl/ocean-backdrop-wgsl.ts
//
// Infinite-ocean BACKDROP — a fullscreen pass drawn BEFORE terrain so the open sea
// extends past the edge of the map grid instead of stopping at a flat clear colour
// (the player was "only seeing the shader where the map tiles are"). Each pixel is
// inverse-projected onto the sea-level iso plane to recover its world tile position,
// then shaded with the SAME deep-water swell as the in-map ocean branch (water-wgsl)
// so the two meet seamlessly at the map boundary; the island's perimeter is dropped
// below sea level (terrain-field border falloff) so its rim sinks into this water
// with no visible cliff. Procedural only — no per-cell buffers, just the WGlobals
// uniform (projection + time + lighting). Terrain then loads over this and draws its
// grid, which covers the whole map rect, leaving the backdrop visible only OUTSIDE
// the island — i.e. open ocean to the horizon.
//
// NOTE: the noise/swell helpers are intentionally duplicated from water-wgsl.ts
// (kept in lock-step by the matching constants) rather than shared, so the working
// water shader is never destabilised by a refactor. If you tune WAVE_DIR / octave
// periods / speeds here, mirror them in water-wgsl's ocean branch (and vice-versa)
// to keep the boundary seamless.

export const OCEAN_BACKDROP_WGSL = /* wgsl */ `
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

const TWO_PI = 6.28318;
const WAVE_DIR = vec2<f32>(0.80, 0.60);
// The open sea continues UNCHANGED past the map: this is the in-map ocean's DEEP
// biome colour (temperate-ocean deepColor [0.06,0.27,0.42]), and water-wgsl
// saturates its far ocean to the same tone a little offshore, so the boundary
// between the map's ocean and this infinite backdrop is invisible. No fade — the
// sea just extends as far as needed.
const DEEP = vec3<f32>(0.06, 0.27, 0.42);

fn hash2(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2<f32>(1.0, 0.0));
  let c = hash2(i + vec2<f32>(0.0, 1.0));
  let d = hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p : vec2<f32>) -> f32 {
  var v = 0.0;
  var amp = 0.5;
  var q = p;
  for (var k = 0u; k < 3u; k = k + 1u) {
    v = v + amp * vnoise(q);
    q = q * 2.03 + vec2<f32>(11.7, 4.3);
    amp = amp * 0.5;
  }
  return v;
}
fn rot2(v : vec2<f32>, a : f32) -> vec2<f32> {
  let c = cos(a); let s = sin(a);
  return vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);
}

// Fullscreen triangle (no vertex buffer); fragment recovers world coords from the
// framebuffer position, so the VS only needs to cover the screen.
@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[vid], 0.0, 1.0);
}

@fragment
fn fsMain(@builtin(position) fragCoord : vec4<f32>) -> @location(0) vec4<f32> {
  // Invert the iso projection at the sea-level plane (hPx = 0 there). fragCoord.xy is
  // the device-pixel coordinate (= the water vertex shader's dev coord), so:
  //   scr = (dev − offset) / scale ;  a = scr.x/half.x = gx−gy ;  b = scr.y/half.y = gx+gy
  let scr = (fragCoord.xy - G.uXform.zw) / G.uXform.xy;
  let a = scr.x / G.uHalf.x;
  let b = scr.y / G.uHalf.y;
  let g = vec2<f32>((a + b) * 0.5, (b - a) * 0.5);   // world tile coords on the sea plane

  let t = G.uWater.x;
  let day = G.uAmbient.w;
  var color = DEEP * (G.uAmbient.xyz + vec3<f32>(day * 0.85));

  // Deep-water swell: same octave math as water-wgsl's ocean branch with refract=0
  // (no coast out here) → big majestic rolling swell + a medium crossing swell.
  let bend = (fbm(g * 0.02 + vec2<f32>(t * 0.008, 0.0)) - 0.5) * 0.7;
  let dir = rot2(WAVE_DIR, bend);
  let warpA = (fbm(g * 0.04 + vec2<f32>(t * 0.02, -t * 0.015)) - 0.5) * 3.0;
  let warpB = (fbm(g * 0.10 + vec2<f32>(-t * 0.03, t * 0.025)) - 0.5) * 1.8;
  let hA = sin((dot(g, dir) + warpA) * (TWO_PI / 22.0) - t * 0.30);
  let hB = sin((dot(g, rot2(dir, 0.6)) + warpB) * (TWO_PI / 9.0) - t * 0.62);
  let crest = clamp((hA * 0.55 + hB * 0.32) * 0.5 + 0.5, 0.0, 1.0);
  color += vec3<f32>(smoothstep(0.6, 0.97, crest) * 0.05);

  // Glints — irregular noise speckle drifting along the swell (no sine lattice).
  let gl = fbm(g * 0.7 - dir * (t * 0.5));
  color += vec3<f32>(smoothstep(0.82, 0.97, gl) * 0.045);

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
