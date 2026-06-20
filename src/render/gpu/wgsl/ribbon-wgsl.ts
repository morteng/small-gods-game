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
  uRiverLevel : f32,       // river water-level offset (normalised): drought < 0, flood > 0
  uPad   : f32,
};

@group(0) @binding(0) var<uniform> G : TGlobals;
@group(0) @binding(1) var<storage, read> heights : array<f32>;
@group(0) @binding(2) var<uniform> R : RParams;
// River WATER-SURFACE field (render-elevation space): river verts lift to THIS
// (the fill line just below the banks), not the carved bed; off-channel it equals
// the terrain, so the fragment's surface−terrain test discards the dry side and the
// waterline follows the real bank contour pixel-perfectly. Equals the height buffer
// on a world with no rivers (the host binds the heights buffer itself there).
@group(0) @binding(6) var<storage, read> riverSurf : array<f32>;
// Road-material atlas (prototype: hand-authored placeholder, img2img-generated later).
// One seamless layer per surface — 0 dirt · 1 cobble · 2 plank — albedo + a local-frame
// normal (RG bump, B up). The FS samples these for roads and lights the normal banded.
@group(0) @binding(3) var matSamp   : sampler;
@group(0) @binding(4) var albedoTex : texture_2d_array<f32>;
@group(0) @binding(5) var normalTex : texture_2d_array<f32>;

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
// Bilinear river water-surface elevation at a fractional tile pos (same lattice as
// sampleElev). Off-channel this equals the terrain, so depth = surf − bed ≤ 0 there.
fn sampleSurf(p : vec2<f32>) -> f32 {
  let W = i32(G.uGrid.x); let H = i32(G.uGrid.y);
  let fx = clamp(p.x, 0.0, f32(W - 1));
  let fy = clamp(p.y, 0.0, f32(H - 1));
  let x0 = i32(floor(fx)); let y0 = i32(floor(fy));
  let x1 = min(x0 + 1, W - 1); let y1 = min(y0 + 1, H - 1);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let s00 = riverSurf[y0 * W + x0]; let s10 = riverSurf[y0 * W + x1];
  let s01 = riverSurf[y1 * W + x0]; let s11 = riverSurf[y1 * W + x1];
  return mix(mix(s00, s10, tx), mix(s01, s11, tx), ty);
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
  // Bridge decks (road tag.y == BRIDGE_TAG ~ 0.25) carry their LEVEL deck elevation in
  // aSpeed; lift to that instead of the riverbed below, so the deck spans the water.
  // Rivers (tag.y == 1) lift to the WATER SURFACE (fill line), not the carved bed —
  // so the river sits in its channel instead of at the bottom of its own trench.
  let isBridge = aTag.y > 0.1 && aTag.y < 0.5;
  let isRiver = aTag.y > 0.5;
  var elev = sampleElev(aPos);
  if (isRiver) { elev = sampleSurf(aPos) + R.uRiverLevel; }   // drought/flood shift
  if (isBridge) { elev = aSpeed; }
  let hPx = (elev - G.uZParams.y) * G.uZParams.z * G.uZParams.x;
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

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let aa = abs(in.vAcross);

  // tag.y selects the feature program: 1 = river, 0 = road. uTime drives the river
  // flow (and keeps the RParams binding live under the auto bind-group layout).
  if (in.vTag.y > 0.5) {
    // ── RIVER ── flow advected ALONG the centerline (downstream by construction of
    // the traced polyline), depth-tinted across, with a depth-keyed shore foam.
    //
    // PIXEL-PERFECT WATERLINE: the water surface (riverSurf) and the carved bed
    // (heights) are both sampled per-fragment; depth = surf − bed. Off the channel
    // the surface equals the terrain, so depth ≤ 0 and the dry side is discarded —
    // the visible edge is the real bank contour, not the parametric ribbon edge.
    let bed = sampleElev(in.vGrid);
    let surf = sampleSurf(in.vGrid) + R.uRiverLevel;   // drought/flood shift
    let depthN = surf - bed;
    if (depthN <= 0.0) { discard; }
    let depthM = depthN * G.uZParams.z;            // uZParams.z = reliefM

    let dwn = in.vAlong - R.uTime * (0.3 + in.vSpeed * 0.7);
    let ripple = fbm(vec2<f32>(in.vAlong * 1.6 + dwn, in.vAcross * 3.0));
    // Depth tint: a DEEP teal thread runs mid-channel (real rivers are shallow, so
    // keying purely off depthM washes out — the across-coordinate guarantees a deep
    // current line) fading to a lighter margin at the banks.
    let center = smoothstep(1.0, 0.15, aa);              // 1 mid-channel → 0 at the bank
    let tDeep = max(clamp(depthM / 1.0, 0.0, 1.0), center * 0.85);
    var rcol = mix(vec3<f32>(0.21, 0.45, 0.49), vec3<f32>(0.05, 0.19, 0.27), tDeep);
    rcol = mix(rcol, rcol + vec3<f32>(0.04), ripple);
    let streak = smoothstep(0.62, 0.96, fract(dwn * 0.6));
    rcol += vec3<f32>(streak * 0.05);

    // SHORE FOAM keyed to real depth — a bright lapping lip in the last ~0.4 m before
    // the bank (where bed climbs to meet the surface), so foam hugs the true contour.
    let shoreFoam = smoothstep(0.45, 0.0, depthM) * (0.55 + 0.45 * ripple);
    // WHITEWATER over fast/steep reaches (carried in vSpeed), broken up by fbm.
    let white = smoothstep(0.9, 1.7, in.vSpeed)
              * smoothstep(0.45, 0.85, fbm(vec2<f32>(in.vAlong * 2.2 - R.uTime * (0.5 + in.vSpeed), in.vAcross * 2.0)));
    rcol = mix(rcol, vec3<f32>(0.86, 0.93, 0.96), max(shoreFoam * 0.7, white * 0.65));

    // ── RIVER-MOUTH SPLASH ── tag.x ramps 0→1 over the last stretch of a reach that
    // spills into still water. Churning, fast-animated spray that broadens across the
    // full channel and blooms to the lip — the river breaking into the lake/sea.
    let mouth = in.vTag.x;
    if (mouth > 0.001) {
      let churn = fbm(vec2<f32>(in.vAlong * 3.1 - R.uTime * 1.4, in.vAcross * 4.5 + R.uTime * 0.8));
      let spray = mouth * mouth * smoothstep(0.28, 0.85, churn);
      rcol = mix(rcol, vec3<f32>(0.90, 0.95, 0.98), clamp(spray, 0.0, 0.85));
    }
    // Soft outer fade at the parametric geometry edge as a backstop where the ribbon
    // overhangs a LOW bank the depth-clip doesn't catch (a floodplain). The terrain
    // clip above is the primary, crisp waterline.
    let rRagged = (fbm(in.vGrid * 1.7) - 0.5) * 0.06;
    let rAlpha = smoothstep(1.0, 0.86 - mouth * 0.08, aa + rRagged);
    let rNdl = max(G.uSun.y, 0.0) / max(length(G.uSun.xyz), 1e-3);
    let rBands = max(1.0, G.uSun.w);
    let rLight = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * (floor(rNdl * rBands + 0.5) / rBands);
    return vec4<f32>(rcol * rLight * rAlpha, rAlpha);
  }

  // tag.x = road TIER (0 path · 1 rutted track · 2 packed road · 3 cobbled+curb).
  let tier = i32(in.vTag.x + 0.5);
  let isBridge = in.vTag.y > 0.1 && in.vTag.y < 0.5;

  // Bank feather: fade the ribbon out so it melts into the ground. Cobbled roads
  // keep a harder edge (the curb) than trodden dirt paths; a bridge deck has a hard
  // plank edge over the void.
  let ragged = (fbm(in.vGrid * 1.7) - 0.5) * 0.10;
  var edgeStart = 0.78;
  if (tier == 3) { edgeStart = 0.90; }
  if (tier == 0) { edgeStart = 0.62; }   // a path has no firm edge at all
  if (isBridge) { edgeStart = 0.95; }
  let alpha = smoothstep(1.0, edgeStart, aa + ragged);

  // ── GENERATIVE ROAD MATERIAL (prototype) ── sample the seamless PBR atlas instead
  // of procedural surface noise: layer 0 dirt, 1 cobble, 2 plank. UV is metric-square
  // (along × across·width) so setts/boards stay round at any width; the repeat sampler
  // tiles it. textureSampleLevel (LOD 0, no mips) is safe after the river early-return.
  var layer = 0;                    // dirt — path / track / packed road
  if (tier == 3) { layer = 1; }     // cobble — stone road
  if (isBridge)  { layer = 2; }     // plank — bridge deck
  let uv = vec2<f32>(in.vAlong * 2.2, in.vAcross * in.vWidth * 2.2);
  var col = textureSampleLevel(albedoTex, matSamp, uv, layer, 0.0).rgb;

  // Normal-mapped banded lighting: decode the LOCAL-frame normal and rotate it into
  // tile space by the ribbon tangent (X across, Z along, Y up), then dot the sun — so
  // cobble domes & planks catch the light instead of reading dead flat.
  let nl = textureSampleLevel(normalTex, matSamp, uv, layer, 0.0).rgb * 2.0 - 1.0;
  let alongDir = vec3<f32>(in.vTangent.x, 0.0, in.vTangent.y);   // texture x → along
  let acrossDir = vec3<f32>(-in.vTangent.y, 0.0, in.vTangent.x); // texture y → across
  let nrm = normalize(nl.x * alongDir + nl.y * acrossDir + nl.z * vec3<f32>(0.0, 1.0, 0.0));
  let ndl = max(dot(nrm, normalize(G.uSun.xyz)), 0.0);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5) / bands;
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;
  col = col * light;

  // Edge features are geometry, not surface texture, so they stay procedural overlays.
  if (tier == 3 && !isBridge) {
    // Raised dressed-stone CURB along each outer edge of a cobbled road.
    let curb = smoothstep(0.72, 0.86, aa);
    col = mix(col, vec3<f32>(0.60, 0.58, 0.54) * light, curb * 0.85);
  }
  if (isBridge) {
    // Dressed-timber side RAILS at the deck edges.
    let rail = smoothstep(0.80, 0.94, aa);
    col = mix(col, vec3<f32>(0.33, 0.23, 0.14) * light, rail * 0.85);
  }

  return vec4<f32>(col * alpha, alpha);
}
`;
