// src/render/gpu/wgsl/water-wgsl.ts
//
// Water S2 — the one blended water pass shared by all body types (ocean / lake /
// river); the type is a per-cell attribute, not a separate pass. Mirrors the
// terrain shader's GPU-generated grid (no CPU vertex arrays) but:
//   - lifts each per-cell FLAT quad to the water SURFACE height (surfaceW), and
//   - reads the (composed, i.e. river-carved) terrain height buffer to compute
//     depth = surfaceW − terrainHeight — the one variable that drives colour,
//     shoreline foam, blend-vs-opaque, and (S5) caustics.
// The three body types use DIFFERENT motion systems (one branch each, uniform per
// quad since wtype is flat per cell):
//   - OCEAN: a global swell that travels in WAVE_DIR (so the open sea isn't radial),
//     warped by fbm value-noise so crests aren't uniform; near the coast the swell
//     refracts to run parallel to shore (shore-distance field) and breaks into foam,
//     with windward coasts (facing WAVE_DIR) rougher than lee shores. Deep water gets
//     a large slow swell + noisy glints (no sin-lattice grid).
//   - LAKE: calm — a gentle directional ripple + soft noise glints, NO concentric
//     shoreward swell (which read as a "wave generator in the middle") and no surf.
//   - RIVER: streaks advected ALONG the per-cell flow vector; scroll speed and
//     whitewater scale with the local bed slope (terrainH drop to the downstream
//     cell), so steep reaches run fast and foam up.
// Lighting is banded to match terrain + sprites. Drawn AFTER terrain, sharing its
// depth buffer (greater-equal, no depth write) so nearer terrain still occludes
// water. Opaque (crisp pixel-art waterline).

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
@group(0) @binding(8) var<storage, read> shoreD   : array<f32>; // tiles from shore (0 = land)

fn cellIdx(cx : u32, cy : u32) -> u32 { return cy * u32(G.uGrid.x) + cx; }
fn unpackRgb(rgba : u32) -> vec3<f32> {
  return vec3<f32>(f32(rgba & 0xFFu), f32((rgba >> 8u) & 0xFFu), f32((rgba >> 16u) & 0xFFu)) / 255.0;
}

// Cheap value noise (hash lattice + smooth interp) and a 3-octave fbm. Used to
// break up the regularity of the sine motion so the open sea reads organic rather
// than as a grid of glints. No textures, no neighbour buffer reads.
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

// Bilinearly sample the shore-distance field at a continuous grid position, so
// swell crests (contours of constant distance) are smooth, not tile-blocky.
fn sampleShore(gx : f32, gy : f32) -> f32 {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let fx = clamp(gx, 0.0, f32(W) - 1.001);
  let fy = clamp(gy, 0.0, f32(H) - 1.001);
  let x0 = u32(fx); let y0 = u32(fy);
  let x1 = min(x0 + 1u, W - 1u); let y1 = min(y0 + 1u, H - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let s00 = shoreD[y0 * W + x0]; let s10 = shoreD[y0 * W + x1];
  let s01 = shoreD[y1 * W + x0]; let s11 = shoreD[y1 * W + x1];
  return mix(mix(s00, s10, tx), mix(s01, s11, tx), ty);
}

// Bilinearly sample the (composed) terrain height — used for a SMOOTH depth tint so
// the shallows fade continuously instead of flat per-cell diamonds (the bed varies
// tile-to-tile, and flat quads would otherwise show a grid of facets).
fn sampleTerrainH(gx : f32, gy : f32) -> f32 {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let fx = clamp(gx, 0.0, f32(W) - 1.001);
  let fy = clamp(gy, 0.0, f32(H) - 1.001);
  let x0 = u32(fx); let y0 = u32(fy);
  let x1 = min(x0 + 1u, W - 1u); let y1 = min(y0 + 1u, H - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let h00 = terrainH[y0 * W + x0]; let h10 = terrainH[y0 * W + x1];
  let h01 = terrainH[y1 * W + x0]; let h11 = terrainH[y1 * W + x1];
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), ty);
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

// OPAQUE pixel-art water. Shared base: a smooth depth tint (shallow→deep biome
// palette) so coastlines read. Then one of three motion systems by body type
// (uniform branch — wtype is flat per cell). The previous fragment quantised a
// single sin(x+y) into terraces, which (lines of constant x+y being iso-horizontal)
// painted the whole ocean with regular stripes. The cure here is to (a) never key
// motion off the raw x+y projection, (b) travel the open swell in a GLOBAL WAVE_DIR
// rather than radially out from every coast, and (c) warp every phase with fbm
// value-noise so no sine lattice or grid of glints survives.
const TWO_PI = 6.28318;
// Global ocean swell travel direction (unit). Open-sea crests run perpendicular to
// this and march along it; near the coast they bend to parallel the shore, and
// coasts facing INTO it (windward) break harder. (0.8,0.6) is already unit.
const WAVE_DIR = vec2<f32>(0.80, 0.60);
// Lake ripple direction (unit, deliberately not the ocean's) — lakes get a faint
// uniform breeze-ripple, never the shoreward swell rings.
const LAKE_DIR = vec2<f32>(0.60, -0.80);

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let ci = in.vCell;
  let typ = wtype[ci];
  if (typ == 0u) { discard; }

  // Smooth (bilinear) bed height → continuous depth, no per-cell diamond facets.
  let depthM = max(surfaceW[ci] - sampleTerrainH(in.vGrid.x, in.vGrid.y), 0.0) * G.uZParams.z;

  // Depth tint (S4 biome shallow→deep), SMOOTH — clarity stretches the ramp so
  // clear water shows its bed further down. Depth varies with the real bed, so the
  // gradient hugs the coast instead of making regular stripes.
  let clar = clarity[ci];
  let tDeep = clamp(depthM / mix(1.2, 5.0, clar), 0.0, 1.0);
  var color = mix(unpackRgb(shallowC[ci]), unpackRgb(deepC[ci]), tDeep);

  // Flat ambient+sun (water is smooth-shaded; only terrain/sprites get crisp bands).
  let day = G.uAmbient.w;
  color = color * (G.uAmbient.xyz + vec3<f32>(day * 0.85));

  let t = G.uWater.x;
  let g = in.vGrid;
  let foamBand = G.uWater.z;
  let lip = smoothstep(foamBand, 0.0, depthM);          // crisp waterline at any body

  if (typ == 1u) {
    // ---- OCEAN ----------------------------------------------------------------
    // Sum-of-octaves swell with shoaling refraction, BATHYMETRY-driven so the sea
    // varies around the island, plus a swash run-up at the waterline. The big swell
    // is long & slow ("majestic"); a medium swell crosses it; a shore chop appears
    // only near the coast. Each octave's phase crossfades from a DEEP-water
    // directional coordinate (waves travel in WAVE_DIR) to a SHORE-DISTANCE
    // coordinate near the coast (crests refract parallel to shore). The global
    // direction is SUBTLE and bent per-location by a slow fbm → a natural spread,
    // not one uniform marching grid. (Amplitude/period are grouped so a future
    // weather system can scale them.)
    let shore = sampleShore(g.x, g.y);                  // tiles from the coast (smooth)
    let nearShore = exp(-shore * 0.13);                 // 1 at coast → ~0 by ~15 tiles
    let refract = smoothstep(0.0, 1.0, nearShore);      // 0 deep → 1 at the waterline

    // Coast normal (offshore) from the shore-distance gradient — windward coasts
    // (facing the swell) get rougher water + harder breakers than lee shores.
    let sgx = sampleShore(g.x + 1.0, g.y) - sampleShore(g.x - 1.0, g.y);
    let sgy = sampleShore(g.x, g.y + 1.0) - sampleShore(g.x, g.y - 1.0);
    let coastN = normalize(vec2<f32>(sgx, sgy) + vec2<f32>(1e-4, 0.0));
    let exposure = clamp(-dot(coastN, WAVE_DIR), 0.0, 1.0);

    // BATHYMETRY: read the seabed slope from the terrain-height gradient. A GENTLE
    // (flat) bed = a long shallow shelf → waves shoal: they grow taller, slow down,
    // and break into more foam over a wider band. A steep drop-off stays calmer.
    // This varies naturally around the island, so some shores get big majestic surf
    // and others stay quiet.
    let W = u32(G.uGrid.x);
    let H = u32(G.uGrid.y);
    let cx = ci % W;
    let cy = ci / W;
    let xl = max(cx, 1u) - 1u;        let xr = min(cx + 1u, W - 1u);
    let yu = max(cy, 1u) - 1u;        let yd = min(cy + 1u, H - 1u);
    let bgx = terrainH[cy * W + xr] - terrainH[cy * W + xl];
    let bgy = terrainH[yd * W + cx] - terrainH[yu * W + cx];
    let bedSlope = length(vec2<f32>(bgx, bgy)) * G.uZParams.z;   // ~m drop over 2 tiles
    let shoal = exp(-bedSlope * 2.2);                   // 1 on a flat shelf → 0 steep

    // Per-location wobbled swell direction: a slow large-scale fbm bends WAVE_DIR by
    // up to ~±0.35 rad → directional SPREAD, not a single global vector.
    let bend = (fbm(g * 0.02 + vec2<f32>(t * 0.008, 0.0)) - 0.5) * 0.7;
    let dir = rot2(WAVE_DIR, bend);

    // Phase coordinate for an octave: deep water uses the planar distance along the
    // wobbled direction (waves travel in +dir); near shore it crossfades to −shore
    // (crests parallel the coast, marching toward land). Same −t·speed term in both
    // halves keeps the motion continuous through the blend. fbm warp breaks lattices.
    let warpA = (fbm(g * 0.04 + vec2<f32>(t * 0.02, -t * 0.015)) - 0.5) * 3.0;
    let warpB = (fbm(g * 0.10 + vec2<f32>(-t * 0.03, t * 0.025)) - 0.5) * 1.8;
    let sA = mix(dot(g, dir) + warpA, -shore + warpA, refract);
    let sB = mix(dot(g, rot2(dir, 0.6)) + warpB, -shore + warpB, refract);

    // Octave 1: big, long, slow rolling swell — the majestic open-sea motion.
    let hA = sin(sA * (TWO_PI / 22.0) - t * 0.30);
    // Octave 2: medium swell, a touch quicker, crossing the big one.
    let hB = sin(sB * (TWO_PI / 9.0) - t * 0.62);
    // Octave 3: short shore chop — only near the coast, and stronger on gentle shelves.
    let hC = sin((-shore + warpB) * (TWO_PI / 3.4) - t * 1.1) * nearShore * (0.5 + 0.5 * shoal);
    let waveH = hA * 0.55 + hB * 0.32 + hC * 0.5;
    let crest = clamp(waveH * 0.5 + 0.5, 0.0, 1.0);     // 0..1, blended crest field

    // Crest brightening — the lit tops of the blended swell. Taller on shoaling
    // shelves + windward coasts, so big-surf shores read brighter & more textured.
    let amp = mix(0.45, 1.0, exposure) * (0.7 + 0.6 * shoal);
    color += vec3<f32>(smoothstep(0.6, 0.97, crest) * (0.05 + 0.05 * nearShore) * amp);

    // Specular-ish glints: noise (NOT a sine lattice) drifting along the swell, only
    // in open water so they don't fight the shore foam.
    let gl = fbm(g * 0.7 - dir * (t * 0.5));
    color += vec3<f32>(smoothstep(0.82, 0.97, gl) * 0.045 * (1.0 - nearShore));

    // SWASH run-up: a slow waterline that advances up the shelf and pulls back. The
    // throw is larger on gentle/long beaches (shoal) so wide shallows get a long
    // wash; steep shores barely move. As the sheet retreats it leaves a brief WET
    // band (darkened shallow water) — the just-uncovered shore. The foam crest rides
    // the leading edge of the run-up.
    let swash = sin(t * 0.55 + dot(g, dir) * 0.08 + warpA * 0.15) * 0.5 + 0.5; // 0..1, slow
    let runLine = (0.6 + 5.0 * shoal) * swash;          // tiles up the shelf the sheet reaches
    let sheet = smoothstep(runLine, runLine - 1.2, shore);   // 1 where the wash currently covers
    let wet = clamp(smoothstep(runLine + 1.4, runLine, shore) - sheet, 0.0, 1.0) * shoal;
    color *= 1.0 - wet * 0.22;                           // darken the just-uncovered wet shore

    // Foam: the waterline lip + the breaking crest of each swell + the leading edge
    // of the swash sheet. Wider & brighter on shoaling, exposed coasts.
    let breakLine = smoothstep(3.0, 0.0, shore) * smoothstep(0.6, 1.0, crest) * mix(0.4, 1.0, exposure);
    let swashEdge = sheet * smoothstep(0.5, 1.0, swash) * (0.5 + 0.5 * shoal);
    let foam = max(max(lip, breakLine * 0.9), swashEdge * 0.8) * (0.6 + 0.4 * shoal + 0.0);
    color = mix(color, vec3<f32>(0.92, 0.96, 0.98), clamp(foam, 0.0, 1.0) * 0.85);

  } else if (typ == 2u) {
    // ---- LAKE -----------------------------------------------------------------
    // Calm sheet: a faint uniform breeze-ripple in LAKE_DIR + soft noise glints. No
    // shoreward swell (those concentric rings looked like a central wave maker) and
    // no surf — just a thin waterline lip.
    let ripplePhase = dot(g, LAKE_DIR) * (TWO_PI / 5.5) + t * 0.7
                    + (fbm(g * 0.18 + vec2<f32>(t * 0.04, 0.0)) - 0.5) * 2.0;
    let ripple = sin(ripplePhase) * 0.5 + 0.5;
    color += vec3<f32>(smoothstep(0.6, 1.0, ripple) * 0.04);
    let lakeGl = fbm(g * 0.55 + vec2<f32>(t * 0.05, -t * 0.04));
    color += vec3<f32>(smoothstep(0.82, 0.97, lakeGl) * 0.04);
    color = mix(color, vec3<f32>(0.92, 0.96, 0.98), lip * 0.6);

  } else {
    // ---- RIVER ----------------------------------------------------------------
    // Streaks advected ALONG the per-cell flow vector; speed + whitewater scale with
    // the local bed slope (height drop to the downstream cell).
    let fv = vec2<f32>(flow[ci * 2u], flow[ci * 2u + 1u]);
    let W = u32(G.uGrid.x);
    let H = u32(G.uGrid.y);
    let cx = ci % W;
    let cy = ci / W;
    let dcx = u32(clamp(i32(cx) + i32(round(fv.x)), 0, i32(W) - 1));
    let dcy = u32(clamp(i32(cy) + i32(round(fv.y)), 0, i32(H) - 1));
    let drop = max(terrainH[ci] - terrainH[dcy * W + dcx], 0.0) * G.uZParams.z; // m over ~1 tile
    let speed = 0.6 + clamp(drop * 0.7, 0.0, 2.4);      // steep reaches run fast

    // Coordinates along / across the flow → streaks stretched downstream, scrolling
    // at the slope-derived speed. fbm keeps the streaks broken up, not a sine comb.
    let along = dot(g, fv);
    let across = dot(g, vec2<f32>(-fv.y, fv.x));
    let stream = fbm(vec2<f32>(along * 1.4 - t * speed * 2.0, across * 2.6));
    color += vec3<f32>((stream - 0.5) * 0.10);

    // Whitewater: more foam where it is steep and fast; plus the bank waterline lip.
    let white = smoothstep(0.7, 1.0, stream) * smoothstep(0.4, 1.6, drop);
    color = mix(color, vec3<f32>(0.92, 0.96, 0.98), max(lip * 0.7, white * 0.7));
  }

  // Opaque — no transparency, crisp waterline (the pixel-art way).
  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
