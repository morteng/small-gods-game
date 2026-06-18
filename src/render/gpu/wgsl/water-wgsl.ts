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

// Terrain (bed) slope magnitude at a cell, normalised-height units — S3 drives
// waterfall/rapids whitewater where the bed is steep under fast flow.
fn bedSlope(cx : u32, cy : u32) -> f32 {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  if (cx == 0u || cy == 0u || cx >= W - 1u || cy >= H - 1u) { return 0.0; }
  let hl = terrainH[cellIdx(cx - 1u, cy)];
  let hr = terrainH[cellIdx(cx + 1u, cy)];
  let hu = terrainH[cellIdx(cx, cy - 1u)];
  let hd = terrainH[cellIdx(cx, cy + 1u)];
  return length(vec2<f32>((hr - hl) * 0.5, (hd - hu) * 0.5));
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
  let W = u32(G.uGrid.x);
  let cx = ci % W;
  let cy = ci / W;
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

  // Flow-advected ripple → perturbed normal. Scale is sub-to-~1-tile (a coarser
  // scale read as big slabs, not water). STILL water (ocean/lake) gets a gentle
  // crosshatch wind ripple; FLOWING water (rivers) gets wavefronts PERPENDICULAR
  // to the flow vector that scroll downstream, so the current direction is
  // legible. The normal tilts directionally (cos → gradient), not isotropically.
  let t = G.uWater.x;
  let fv = vec2<f32>(flow[ci * 2u], flow[ci * 2u + 1u]);
  let flowMag = clamp(length(fv), 0.0, 1.0);
  let fdir = select(vec2<f32>(1.0, 0.0), fv / max(flowMag, 1e-4), flowMag > 1e-3);
  let RP = 6.0;                          // ripple spatial freq (~1-tile wavelength)
  let along = dot(in.vGrid, fdir);       // distance measured along the flow
  let windX = cos(in.vGrid.x * RP - t * 1.4);
  let windY = cos(in.vGrid.y * RP * 0.85 + t * 1.1);
  let stream = cos(along * RP * 1.3 - t * 5.0); // travels downstream along fdir
  let amp = 0.10 + 0.24 * flowMag;
  let nx = mix(windX * 0.6, stream * fdir.x, flowMag) * amp;
  let nz = mix(windY * 0.6, stream * fdir.y, flowMag) * amp;
  let n = normalize(vec3<f32>(nx, 1.0, nz));

  // Smooth diffuse + tight sun glint. Water is specular — the terrain's hard
  // floor-band quantization here produced ugly flat dark slabs; a smooth ndl
  // ramp shimmers instead.
  let sunDir = normalize(G.uSun.xyz);
  let ndl = max(dot(n, sunDir), 0.0);
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * ndl;

  // W-D: procedural sky-gradient reflection masked by Fresnel. View is ~straight
  // down in tile space (ortho iso) so dot(N,V)=n.y — flat water reflects little
  // (you see into the depth), tilted ripples catch the sky. A cheap stand-in until
  // the skydome's deriveSkyState feeds real sky colours; dims at night via uAmbient.w.
  let skyAmt = G.uAmbient.w;
  let refl = reflect(vec3<f32>(0.0, -1.0, 0.0), n);
  let zenith  = vec3<f32>(0.33, 0.50, 0.72) * (0.4 + 0.6 * skyAmt);
  let horizon = vec3<f32>(0.66, 0.78, 0.90) * (0.4 + 0.6 * skyAmt);
  let sky = mix(horizon, zenith, clamp(refl.y, 0.0, 1.0));
  let fresnel = pow(1.0 - clamp(n.y, 0.0, 1.0), 4.0) * 0.5;
  color = mix(color * light, sky, fresnel);

  // W-D: soft specular highlight + a SHARP thresholded sun-glitter that sparkles
  // on the ripple ridges (the normals already scatter it into many points).
  let glint = pow(ndl, 32.0) * skyAmt;
  let glitter = smoothstep(0.965, 0.995, max(dot(sunDir, refl), 0.0)) * skyAmt;
  color = color + vec3<f32>(glint * 0.35 + glitter * 0.6);

  // Shoreline foam: bright band where the water is very shallow.
  let foamBand = G.uWater.z;
  if (depthM < foamBand) {
    let f = 1.0 - depthM / foamBand;
    color = mix(color, vec3<f32>(0.90, 0.95, 0.97), f * f * 0.8);
  }

  // S5 caustics — an animated light-net on the bed, only where it's visible
  // (shallow + clear) and sunlit. Faded by depth (out past the clarity reach),
  // by clarity, and by sun strength (G.uAmbient.w → 0 at night). Warped by the
  // flow vector so river caustics drift downstream. A cheap summed-sine net, not
  // a light-transport sim.
  let causticReach = depthScale * 0.6;
  let cfade = clamp(1.0 - depthM / max(causticReach, 0.001), 0.0, 1.0);
  let sun = G.uAmbient.w;
  if (cfade > 0.0 && sun > 0.0) {
    // Two summed-sine nets at different scale/drift, combined with min() so only
    // filaments where BOTH fire survive — sharpens the caustic net + hides tiling.
    let cw = in.vGrid * 3.0 - fv * t * 1.2;   // finer net, drifting downstream
    let cnet = sin(cw.x * 2.0 + t * 1.3) + sin(cw.y * 2.3 - t * 1.1) + sin((cw.x + cw.y) * 1.7 + t * 1.7);
    let cw2 = in.vGrid * 4.7 + fv * t * 0.7;
    let cnet2 = sin(cw2.x * 2.0 - t * 1.1) + sin(cw2.y * 2.3 + t * 1.5) + sin((cw2.x - cw2.y) * 1.7 - t * 1.3);
    let caustic = min(pow(max(cnet * 0.33, 0.0), 2.0), pow(max(cnet2 * 0.33, 0.0), 2.0));
    color += vec3<f32>(caustic * cfade * clar * sun * 0.8);
  }

  // Deep = opaque (no see-through), shallow = translucent over the bed. Clear
  // water (high clarity ⇒ larger depthScale ⇒ smaller tDeep) stays see-through
  // deeper, so you read the bed/caustics through it. A CONTACT fade ramps the
  // shallowest lip toward transparent (T-C) so the waterline melts into the
  // terrain's wet-sand band instead of a hard edge; foam fades with it.
  let contact = smoothstep(0.0, foamBand, depthM);
  var alpha = mix(0.5, 0.97, tDeep) * contact;
  if (depthM < foamBand) { alpha = max(alpha, 0.82 * contact); }

  // S3 dynamics — whitewater where fast flow meets a steep bed (waterfalls,
  // rapids, the churn at obstructions/merges). Faster, higher-frequency churn
  // than the ambient ripple; lifts both colour and opacity.
  let rapids = clamp(flowMag * bedSlope(cx, cy) * 36.0, 0.0, 1.0);
  if (rapids > 0.0) {
    let churn = 0.5 + 0.5 * sin(in.vGrid.x * 4.3 + in.vGrid.y * 3.7 - t * 6.0);
    color = mix(color, vec3<f32>(0.93, 0.96, 0.98), rapids * (0.55 + 0.45 * churn));
    alpha = max(alpha, 0.72 + 0.24 * rapids);
  }

  return vec4<f32>(color * alpha, alpha); // premultiplied
}
`;
