// src/render/gpu/wgsl/sky-backdrop-wgsl.ts
//
// Title-screen SKY BACKDROP (P1-C, meta mode) — modelled DIRECTLY on
// ocean-backdrop-wgsl.ts: the same fullscreen-triangle vertex trick, the same
// one-globals-uniform + noise-texture bind group shape (binding 0 = globals,
// 1 = noise texture, 2 = noise sampler). Unlike the ocean backdrop this pass
// has no camera and no world to inverse-project onto — meta mode runs BEFORE
// a world exists, so this is pure screen-space illustration keyed only on the
// viewport size and a wall-clock time.
//
// Content: a vertical parchment-horizon-to-dusk-sky gradient, two scrolling
// FBM cloud bands at different heights/speeds (parallax), and a soft godray
// cone whose angle drifts on a long (tens-of-seconds) period. Devotional /
// illuminated-manuscript mood — warm, restrained, no neon. This sits BEHIND
// the title screen's UI text, so every term is kept subtle (see the low
// intensity multipliers below); it must never fight legibility.
//
// Reuses the SAME baked tiling-noise atlas as the water/ocean-backdrop
// shaders (noise-texture.ts) rather than a new texture — one fullscreen pass,
// no dependent texture reads beyond the shared atlas (the render budget the
// UI v3 spec asks for).

export const SKY_BACKDROP_WGSL = /* wgsl */ `
struct SGlobals {
  uParams : vec4<f32>,   // viewport.x, viewport.y, timeSec, pad
};
@group(0) @binding(0) var<uniform> G : SGlobals;

// Shared tiling-noise atlas (noise-texture.ts) — the SAME texture the water +
// ocean-backdrop passes sample, so this pass adds no new texture upload.
@group(0) @binding(1) var noiseTex : texture_2d<f32>;
@group(0) @binding(2) var noiseSmp : sampler;
const NOISE_INV_TILE = 1.0 / 64.0;   // 1 / NOISE_TILE_UNITS (noise-texture.ts)
fn fbm(p : vec2<f32>) -> f32 {
  return textureSampleLevel(noiseTex, noiseSmp, p * NOISE_INV_TILE, 0.0).g;
}
fn fbmRich(p : vec2<f32>) -> f32 {
  return textureSampleLevel(noiseTex, noiseSmp, p * NOISE_INV_TILE, 0.0).b;
}
fn nearDeck(p : vec2<f32>) -> f32 {
  return smoothstep(0.50, 0.82, fbmRich(p));
}

// Fullscreen triangle (no vertex buffer); the fragment recovers screen-space
// position from the framebuffer coordinate, so the VS only needs to cover
// the viewport.
@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  return vec4<f32>(p[vid], 0.0, 1.0);
}

// Palette: a warm parchment horizon rising into a deeper dusk sky — restrained
// and devotional, not a saturated sunset poster.
const HORIZON = vec3<f32>(0.86, 0.72, 0.52);
const ZENITH  = vec3<f32>(0.16, 0.15, 0.27);
const CLOUD_TINT = vec3<f32>(0.95, 0.86, 0.72);

@fragment
fn fsMain(@builtin(position) fragCoord : vec4<f32>) -> @location(0) vec4<f32> {
  let viewport = max(G.uParams.xy, vec2<f32>(1.0, 1.0));
  let t = G.uParams.z;
  // fragCoord.y runs top (0) to bottom (viewport.y) in device pixels; the
  // horizon sits at the bottom of frame, so uv.y is the "how far down" term.
  let uv = fragCoord.xy / viewport;

  // Vertical gradient, eased so the warm band hugs the horizon instead of
  // spreading evenly across the frame (a flat lerp reads as a poster, not sky).
  let vertical = smoothstep(0.0, 1.0, pow(uv.y, 0.7));
  var color = mix(ZENITH, HORIZON, vertical);

  // Two scrolling FBM cloud bands, different heights and speeds — the far
  // band slower and fainter, the near band a touch quicker and bolder, so the
  // sky reads as layered rather than a single scrolling texture. The offsets
  // are in NOISE units; dividing by the band's world-scale gives the screen
  // speed: far ~1.2 px/s, near ~2.8 px/s — visible drift when watched, still
  // below what pulls the eye off the menu.
  let worldUv = uv * viewport;
  let farUv = worldUv * 0.02 + vec2<f32>(t * 0.024, 0.0);
  let farBand = smoothstep(0.12, 0.42, uv.y) * (1.0 - smoothstep(0.50, 0.80, uv.y));
  let farCloud = smoothstep(0.55, 0.85, fbm(farUv)) * farBand * 0.20;

  // Near deck: slow TRAVEL — we drift forward over these clouds, so their
  // features magnify from a vanishing point low in the frame. A naive zoom
  // grows without bound (precision death after minutes on the title screen),
  // so this is the seamless-zoom trick: TWO copies of the same noise field,
  // one octave apart in scale, cross-faded on a cycle. At the wrap the
  // incoming copy sits at exactly the scale + drift the outgoing one started
  // at, so the hand-off is invisible and t can run forever. One octave per
  // 44s (~1.6%/s growth) — felt as approach when watched, never a zoom reel.
  let travelPhase = fract(t / 44.0);
  let zoomA = exp2(travelPhase);
  let zoomB = exp2(travelPhase - 1.0);
  let focus = vec2<f32>(0.55, 0.70) * viewport;
  let travelDrift = vec2<f32>(t * 0.06, t * 0.008);
  let deckA = nearDeck((worldUv - focus) * (0.035 / zoomA) + travelDrift);
  let deckB = nearDeck((worldUv - focus) * (0.035 / zoomB) + travelDrift);
  let nearBand = smoothstep(0.28, 0.58, uv.y) * (1.0 - smoothstep(0.68, 0.94, uv.y));
  let nearCloud = mix(deckA, deckB, smoothstep(0.0, 1.0, travelPhase)) * nearBand * 0.28;

  color = mix(color, CLOUD_TINT, clamp(farCloud + nearCloud, 0.0, 1.0));

  // Godray cone: a soft light shaft from a point above the frame, its angle
  // drifting on a LONG period (tens of seconds) so the sky reads as living,
  // not looping. Additive and subtle — this sits BEHIND the title text.
  let source = vec2<f32>(0.30, -0.20) * viewport;
  let toPixel = normalize(fragCoord.xy - source);
  let driftAngle = sin(t * (6.28318 / 36.0)) * 0.22;
  let rayDir = normalize(vec2<f32>(sin(1.0 + driftAngle), cos(1.0 + driftAngle)));
  let align = dot(toPixel, rayDir);
  let ray = smoothstep(0.90, 0.999, align) * (1.0 - uv.y * 0.4);
  // A slow breathe on the shaft's intensity, off-period from the sweep so the
  // two never sync into an obvious loop. Stays within +-15% of the old level.
  let breathe = 0.85 + 0.15 * sin(t * (6.28318 / 23.0));
  color += vec3<f32>(1.0, 0.94, 0.80) * ray * 0.09 * breathe;

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
