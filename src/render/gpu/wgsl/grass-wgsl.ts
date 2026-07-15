// src/render/gpu/wgsl/grass-wgsl.ts
//
// Standing-grass billboard pass (vegetation-billboard epic, step 1: static ribbon;
// step 3: wind sway). Each instance is one upright ground-cover sprite (grass tuft /
// wildflower / pebble), drawn as a vertically-subdivided ribbon (GRASS_SEGMENTS
// quads) so the wind pass can bend it along its height. No per-vertex buffer — the
// ribbon is generated from @builtin(vertex_index); the instance carries the foot
// point (world-screen px, pre-camera), size, atlas cell, and a seed.
//
// Depth: drawn AFTER structures, BEFORE the entity depth-clear, sharing the terrain
// iso depth (greater-equal + write). The blade takes its FOOT depth, so terrain in
// front of the foot occludes the whole blade (far-hill grass hidden by the near hill)
// while terrain behind it is overdrawn. Alpha-tested + opaque (crisp pixel edges),
// so transparent texels don't write depth and block the blades behind them.
//
// Wind (step 3): a dedicated Globals uniform (packed by packGrassGlobals in
// gpu-scene.ts — the shared entity Globals has no time/wind slot). Each blade hinges
// at its planted foot (t=0, stiff) and carries full sway at the tip (t=1); a per-blade
// phase mixes the foot position and the instance seed so a patch sways as a rolling
// wave rather than in lockstep. Rocks stay rigid; flowers sway a little less than grass.

export const GRASS_WGSL = /* wgsl */ `
struct GGlobals {
  uViewport : vec2<f32>,
  uBands    : f32,
  _p0       : f32,
  uAmbient  : vec3<f32>,
  _p1       : f32,
  uSunDir   : vec3<f32>,
  _p2       : f32,
  uSunColor : vec3<f32>,
  uNight    : f32,
  uXform    : vec4<f32>,   // sx, sy, ox, oy : device = worldScreen * sxy + oxy
  uTime     : f32,
  _p3       : f32,
  _p4       : f32,
  _p5       : f32,
  uWind     : vec4<f32>,   // dirX, dirZ, strength (world px), freq (rad/s)
};

@group(0) @binding(0) var<uniform> G : GGlobals;
@group(0) @binding(1) var clutterTex  : texture_2d<f32>;
@group(0) @binding(2) var clutterSamp : sampler;

const SEG : u32 = 4u;

// Travelling gust wave: a band of stronger wind marches across the field along the
// wind direction, so the meadow ripples in rolling gusts rather than swaying uniformly.
const WAVE_FREQ   : f32 = 0.0055;  // rad per screen-px along wind (gust wavelength ~1100 px)
const WAVE_SPEED  : f32 = 1.15;    // rad/s the gust front marches across the ground
const BREEZE_FLOOR: f32 = 0.5;     // residual breeze between gust crests — always visibly alive
// SEAWEED current drift (category 4): a slow, always-on sway independent of surface wind —
// underwater fronds wave in the current even in still air. Direction is the drift, amplitude
// the tip throw (screen px). Slower + rounder than the meadow's flutter, the way kelp moves.
const WEED_DIR : vec2<f32> = vec2<f32>(0.82, 0.34);
const WEED_AMP : f32 = 6.0;

struct VOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv    : vec2<f32>,
  @location(1) shade : f32,        // base self-shadow → tip lit
  @location(2) tint  : vec3<f32>,  // per-blade colour jitter (breaks tiling)
  @location(3) @interpolate(flat) weed : f32,   // 1 = seaweed → submerged underwater tint
};

@vertex
fn vsMain(
  @builtin(vertex_index) vid : u32,
  @location(1) iA  : vec4<f32>,   // footX, footY, depth, size
  @location(2) iUV : vec4<f32>,   // u0, v0, u1, v1
  @location(3) iP  : vec4<f32>,   // width, seed, category, bendK
) -> VOut {
  let row  = vid >> 1u;                 // 0 .. SEG (base → tip)
  let side = vid & 1u;                  // 0 left, 1 right
  let t    = f32(row) / f32(SEG);       // 0 base .. 1 tip

  let width    = iP.x;
  let seed     = iP.y;
  let category = iP.z;                  // 0 grass, 1 flower, 2 rock, 3 reed, 4 seaweed, 5 wrack
  let stiff    = iP.w;                  // per-category wind stiffness (0 floppy grass .. 0.85 stiff reed)
  let sx = (f32(side) - 0.5) * width;   // rectangular billboard (constant width)
  let sy = -iA.w * t;                   // rise up-screen toward the tip

  // Wind sway (step 3), now PER-CATEGORY via the instance stiffness (iP.w):
  //  • floppy grass (stiff≈0.1) hinges LOW (bends from t=0.30) with lively flutter;
  //  • a TALL REED (stiff≈0.85) is rigid — it hinges HIGH (only the top third moves),
  //    flutters little, and leans instead as a coherent whole-stalk sway;
  //  • rocks (category 2) AND wrack (category 5, beach shells/debris) never move.
  // Strength still pulses in GUSTS that roll across the field as a travelling wave.
  let isStatic = select(0.0, 1.0, (category > 1.5 && category < 2.5) || category > 4.5);
  let isWeed   = select(0.0, 1.0, category > 3.5 && category < 4.5);   // seaweed → current drift
  let notRock  = 1.0 - isStatic;
  let hinge    = mix(0.30, 0.62, stiff);               // stiffer → bends higher up the blade
  // Floppy grass bends from a PLANTED base (shear along the blade — reads as organic sway).
  // Stiff sprites (flowers, reeds) instead TRANSLATE as a NEAR-RIGID whole (bendW→1 for all t,
  // so almost NO shear): a compact bright bloom NODS as one piece rather than smearing into a
  // diagonal streak across a sheared ribbon. The rigidity ramps in fast over stiff∈[0.2,0.6],
  // so grass (0.12) stays floppy while flowers (0.55) and reeds (0.85) go rigid.
  let rigid    = smoothstep(0.20, 0.60, stiff);
  let bendW    = mix(smoothstep(hinge, 1.0, t), 1.0, rigid);
  let ampScale = notRock * (1.0 - 0.5 * stiff);        // stiff reeds sway with less amplitude
  let windDir  = normalize(vec2<f32>(G.uWind.x, G.uWind.y) + vec2<f32>(1e-5, 0.0));

  // Gust front: phase advances along the wind direction (foot projected onto windDir) and
  // marches with time, so a crest of stronger wind sweeps the meadow; floored by a residual breeze.
  let along     = dot(iA.xy, windDir);
  let gustFront = pow(0.5 + 0.5 * sin(along * WAVE_FREQ - G.uTime * WAVE_SPEED), 1.6);
  let gustEnv   = BREEZE_FLOOR + (1.0 - BREEZE_FLOOR) * gustFront;

  // Fast per-blade flutter (DAMPED for stiff reeds) + a slow coherent whole-stalk sway that
  // GROWS with stiffness, so a reed bed leans together like real reeds rather than fluttering.
  let phase      = dot(iA.xy, vec2<f32>(0.06, 0.05)) + seed * 6.28318;
  let flutterAmt = mix(1.0, 0.35, stiff);
  let flutter    = (sin(G.uTime * G.uWind.w + phase) + 0.16 * sin(G.uTime * G.uWind.w * 2.7 + phase * 1.9)) * flutterAmt;
  // Coherent whole-stalk sway is STIFFNESS-weighted: negligible for floppy grass (which
  // already moves via flutter), dominant for stiff reeds. Keeps grass from over-leaning
  // into streaks while giving reeds their slow lean.
  let sway       = sin(G.uTime * 0.7 + along * WAVE_FREQ) * stiff * 0.9;
  let bend       = (flutter + sway) * gustEnv * ampScale;
  // A tiny idle sway, independent of wind strength, so a still scene never freezes.
  let idle     = sin(G.uTime * 0.9 + phase * 1.3) * 0.12 * notRock;

  let windOfs = windDir * (G.uWind.z * bendW * bend + idle * bendW);
  let windLean = G.uWind.z * bendW * abs(bend) * 0.15;  // leans rather than stretches

  // SEAWEED current drift: floppy shear from LOW on the frond (bends most at the tip), a slow
  // rounded sway with a cross-harmonic so a bed drifts organically — NOT the wind path, so it
  // waves underwater regardless of surface breeze. Selected in over the land wind offset.
  let weedBendW = smoothstep(0.10, 1.0, t);
  let weedPhase = dot(iA.xy, vec2<f32>(0.05, 0.045)) + seed * 6.28318;
  let weedSway  = sin(G.uTime * 0.55 + weedPhase) + 0.4 * sin(G.uTime * 0.9 + weedPhase * 1.7);
  let weedOfs   = WEED_DIR * (weedBendW * weedSway * WEED_AMP);

  let ofs  = select(windOfs, weedOfs, isWeed > 0.5);
  let lean = select(windLean, weedBendW * abs(weedSway) * 0.5, isWeed > 0.5);

  let scr = iA.xy + vec2<f32>(sx + ofs.x, sy + ofs.y + lean);
  let dev = scr * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(dev.x / (G.uViewport.x * 0.5) - 1.0, 1.0 - dev.y / (G.uViewport.y * 0.5));

  var uu = mix(iUV.x, iUV.z, f32(side));
  if (seed > 0.5) { uu = mix(iUV.z, iUV.x, f32(side)); }   // per-blade horizontal mirror
  let vv = mix(iUV.w, iUV.y, t);                            // base = v1 (bottom), tip = v0 (top)

  // Per-blade colour jitter from the seed — a subtle brightness + hue wobble so a patch of
  // the same sprite never reads as a repeating stamp (the non-repeating pattern magic).
  let tint = vec3<f32>(0.90 + 0.16 * fract(seed * 7.31),
                       0.93 + 0.12 * fract(seed * 3.7),
                       0.86 + 0.14 * fract(seed * 5.1));

  var o : VOut;
  o.pos   = vec4<f32>(ndc, iA.z, 1.0);
  o.uv    = vec2<f32>(uu, vv);
  o.shade = mix(0.62, 0.93, t);
  o.tint  = tint;
  o.weed  = isWeed;
  return o;
}

@fragment
fn fsMain(i : VOut) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(clutterTex, clutterSamp, i.uv, 0.0);
  if (c.a < 0.35) { discard; }                             // alpha test → crisp opaque edge
  let light = G.uAmbient + G.uSunColor * 0.9;
  var rgb = c.rgb * i.shade * i.tint * light;
  // SEAWEED submerged read: the frond draws over the water surface (pass order), so tint it as if
  // seen THROUGH water — a teal-blue cast that deepens toward the base (near the seabed, where the
  // light has fallen off), lightening toward the tip (nearer the surface). Red/amber algae goes
  // muddy-green at depth, exactly as warm light is absorbed first underwater. Reads as submerged.
  if (i.weed > 0.5) {
    let depthT = clamp((i.shade - 0.62) / 0.31, 0.0, 1.0);            // 0 base(deep) .. 1 tip(surface)
    let tealCast = mix(vec3<f32>(0.52, 0.80, 0.96), vec3<f32>(0.90, 0.98, 1.0), depthT);
    rgb = rgb * tealCast * mix(0.55, 1.0, depthT);
  }
  return vec4<f32>(rgb, 1.0);
}
`;
