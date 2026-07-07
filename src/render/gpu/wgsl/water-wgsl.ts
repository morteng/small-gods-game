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
// water. The waterline stays crisp (per-pixel terrain clip), but the body is
// DEPTH-KEYED TRANSPARENT — shallows show the bed through, saturating to opaque
// with depth (premultiplied-alpha blend; see the fragment tail).

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
  uWater    : vec4<f32>,   // time(s), shallowBand(m), foamBand(m), lakeLevelOffset(norm)
  uChannel  : vec4<f32>,   // river-channel grid: bucketTiles, nbx, nby, segCount
  uWindow   : vec4<f32>,   // mesh-cull window: tile origin x,y + cell span w,h
                           // (whole map ⇒ 0,0,W,H — the byte-identical default)
};

@group(0) @binding(0) var<uniform> G : WGlobals;
@group(0) @binding(1) var<storage, read> terrainH : array<f32>; // normalised elev (composed)
@group(0) @binding(2) var<storage, read> surfaceW : array<f32>; // water surface, −1 dry
@group(0) @binding(3) var<storage, read> wtype    : array<u32>; // 0 dry,1 ocean,2 lake,3 river
// binding 4: WET-CELL MESH list — packed (cellX | cellY<<16), one entry per quad. The CPU
// emits a quad only for water-or-river-band lattice cells, so the dry map interior costs no
// vertex work (was: a full-window grid that collapsed dry quads to degenerate triangles).
@group(0) @binding(4) var<storage, read> wetCells : array<u32>;
@group(0) @binding(5) var<storage, read> shallowC : array<u32>; // S4 biome shallow 0xAABBGGRR
@group(0) @binding(6) var<storage, read> deepC    : array<u32>; // S4 biome deep colour
@group(0) @binding(7) var<storage, read> clarity  : array<f32>; // S4 water clarity 0..1
@group(0) @binding(8) var<storage, read> shoreD   : array<f32>; // tiles from shore (0 = land)
// ── Analytic river channel (connectome-projected SDF geometry) ──────────────────
// rivers are no longer a per-cell classified band; they are the smooth offset curve
// of the centreline. ONE packed u32 buffer (to stay within the 8-storage-buffer
// budget) holds the CSR bucket index then the segments:
//   [bucketOffset : nbx*nby+1] [bucketSegs : R] [segments : segCount*8 (bitcast f32)]
// where R = bucketOffset[nbx*nby]. A fragment tests only its bucket's 1-4 segments
// (stride 8: ax,ay,bx,by,halfA,halfB,surfA,surfB). See river-channel-geometry.ts.
@group(0) @binding(9) var<storage, read> channel : array<u32>;

fn cellIdx(cx : u32, cy : u32) -> u32 { return cy * u32(G.uGrid.x) + cx; }
fn unpackRgb(rgba : u32) -> vec3<f32> {
  return vec3<f32>(f32(rgba & 0xFFu), f32((rgba >> 8u) & 0xFFu), f32((rgba >> 16u) & 0xFFu)) / 255.0;
}

// BAKED tiling noise atlas (noise-texture.ts) — one bilinear tap replaces the old
// hash+sin lattice fbm (~8 transcendental chains per call, 3-6 calls per fragment on
// the fill-bound water pass). Channels: R vnoise, G 2-octave fbm, B 3-octave fbm,
// A independent-seed 2-octave fbm (decorrelated — caustics/glitter). All channels are
// normalised to [0,1]; the old in-shader fbm topped out at 0.75, which silently
// dead-zoned every smoothstep(0.82,…) glint threshold tuned against it.
@group(0) @binding(10) var noiseTex : texture_2d<f32>;
@group(0) @binding(11) var noiseSmp : sampler;
const NOISE_INV_TILE = 1.0 / 64.0;   // 1 / NOISE_TILE_UNITS — keep in step with noise-texture.ts
fn fbm(p : vec2<f32>) -> f32 {
  return textureSampleLevel(noiseTex, noiseSmp, p * NOISE_INV_TILE, 0.0).g;
}
// The independent-seed channel — use for effects layered OVER fbm-warped motion so
// sparkle/caustics don't correlate with the swell warp.
fn fbm2b(p : vec2<f32>) -> f32 {
  return textureSampleLevel(noiseTex, noiseSmp, p * NOISE_INV_TILE, 0.0).a;
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

// Bilinearly sample the WATER-SURFACE height (the same way sampleTerrainH samples the
// bed), so the waterline (surface − bed crossing) is a SMOOTH sub-cell contour instead
// of the per-cell staircase the flat-per-cell surface produced. A DRY corner
// (surfaceW < 0) falls back to its bed height, so the interpolated plane ramps down to
// the ground at the bank — the depth crosses zero exactly at the real contour, at pixel
// resolution. Wet interior cells bilerp honest neighbouring surfaces (a river's
// downstream gradient, a lake's flat plane → still flat). De-jags rivers especially,
// whose cell-to-cell surface steps used to show as blocky banks.
fn sampleSurfaceW(gx : f32, gy : f32) -> f32 {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let fx = clamp(gx, 0.0, f32(W) - 1.001);
  let fy = clamp(gy, 0.0, f32(H) - 1.001);
  let x0 = u32(fx); let y0 = u32(fy);
  let x1 = min(x0 + 1u, W - 1u); let y1 = min(y0 + 1u, H - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let i00 = y0 * W + x0; let i10 = y0 * W + x1;
  let i01 = y1 * W + x0; let i11 = y1 * W + x1;
  var s00 = surfaceW[i00]; if (s00 < 0.0) { s00 = terrainH[i00]; }
  var s10 = surfaceW[i10]; if (s10 < 0.0) { s10 = terrainH[i10]; }
  var s01 = surfaceW[i01]; if (s01 < 0.0) { s01 = terrainH[i01]; }
  var s11 = surfaceW[i11]; if (s11 < 0.0) { s11 = terrainH[i11]; }
  return mix(mix(s00, s10, tx), mix(s01, s11, tx), ty);
}

// Per-fragment biome WATER COLOUR (shallow + deep), sampled SMOOTHLY at the fragment's
// true grid position with a DRY-TAP FALLBACK — the colour twin of sampleSurfaceW.
//
// Why: the per-cell colour buffers are 0 (black) on dry cells, and the colour used to
// come from vCell, a @interpolate(flat) per-VERTEX cell index. On the coarse drag-LOD
// mesh a single triangle spans many cells and takes its whole colour from the provoking
// vertex's cell — if that vertex sat on a dry (deep == 0) cell the entire triangle
// rendered solid BLACK, and as the LOD flipped which vertex provoked, river banks
// blinked. Depth is already evaluated per-fragment (sampleSurfaceW/cubicTerrainH), so a
// fragment can be wet (depth > 0) while its triangle's flat colour cell is dry. Sampling
// colour per-fragment from the fine buffer — and treating a 0 (dry) tap as a non-zero
// sibling so we never blend toward black — makes the colour LOD-independent and kills
// both the black patches and the bank blink.
struct WaterCol { shallow : vec3<f32>, deep : vec3<f32> }
fn blendNonzero4(a : vec3<f32>, b : vec3<f32>, c : vec3<f32>, d : vec3<f32>, tx : f32, ty : f32) -> vec3<f32> {
  // Any non-zero corner is the fallback for the dry (zero) ones.
  var fb = a;
  if (dot(fb, fb) <= 0.0) { fb = b; }
  if (dot(fb, fb) <= 0.0) { fb = c; }
  if (dot(fb, fb) <= 0.0) { fb = d; }
  var a2 = a; if (dot(a2, a2) <= 0.0) { a2 = fb; }
  var b2 = b; if (dot(b2, b2) <= 0.0) { b2 = fb; }
  var c2 = c; if (dot(c2, c2) <= 0.0) { c2 = fb; }
  var d2 = d; if (dot(d2, d2) <= 0.0) { d2 = fb; }
  return mix(mix(a2, b2, tx), mix(c2, d2, tx), ty);
}
// Scalar twin of sampleWaterCol for the CLARITY field: bilinear with a dry-tap
// fallback (dry cells hold 0). Reading clarity[ci] (the FLAT provoking-vertex cell)
// made the depth ramp + opacity constant per TRIANGLE — pale wedges near shore
// whenever the drag-LOD mesh coarsened and a triangle's provoking vertex was dry.
fn sampleClarity(gx : f32, gy : f32) -> f32 {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let fx = clamp(gx, 0.0, f32(W) - 1.001);
  let fy = clamp(gy, 0.0, f32(H) - 1.001);
  let x0 = u32(fx); let y0 = u32(fy);
  let x1 = min(x0 + 1u, W - 1u); let y1 = min(y0 + 1u, H - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  var a = clarity[y0 * W + x0]; var b = clarity[y0 * W + x1];
  var c = clarity[y1 * W + x0]; var d = clarity[y1 * W + x1];
  var fb = a;
  if (fb <= 0.0) { fb = b; }
  if (fb <= 0.0) { fb = c; }
  if (fb <= 0.0) { fb = d; }
  if (a <= 0.0) { a = fb; }
  if (b <= 0.0) { b = fb; }
  if (c <= 0.0) { c = fb; }
  if (d <= 0.0) { d = fb; }
  return mix(mix(a, b, tx), mix(c, d, tx), ty);
}

fn sampleWaterCol(gx : f32, gy : f32) -> WaterCol {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let fx = clamp(gx, 0.0, f32(W) - 1.001);
  let fy = clamp(gy, 0.0, f32(H) - 1.001);
  let x0 = u32(fx); let y0 = u32(fy);
  let x1 = min(x0 + 1u, W - 1u); let y1 = min(y0 + 1u, H - 1u);
  let tx = fx - f32(x0); let ty = fy - f32(y0);
  let i00 = y0 * W + x0; let i10 = y0 * W + x1;
  let i01 = y1 * W + x0; let i11 = y1 * W + x1;
  var out : WaterCol;
  out.shallow = blendNonzero4(unpackRgb(shallowC[i00]), unpackRgb(shallowC[i10]),
                              unpackRgb(shallowC[i01]), unpackRgb(shallowC[i11]), tx, ty);
  out.deep    = blendNonzero4(unpackRgb(deepC[i00]), unpackRgb(deepC[i10]),
                              unpackRgb(deepC[i01]), unpackRgb(deepC[i11]), tx, ty);
  return out;
}

// ── BICUBIC (Catmull-Rom) sampling for a PIXEL-PERFECT waterline ──────────────────
// Bilinear over a 1-value-per-tile field is only C0: the surface−bed zero-crossing
// kinks at every tile boundary, which reads as a faceted/jaggy waterline at zoom.
// Catmull-Rom interpolation is C1 — the crossing is a smooth curve across tile seams,
// so streams/rivers/lakes get a clean contour with no extra geometry. 16 taps, water
// fragments only. The DRY fallback (surfaceW < 0 → bed) is applied per-tap so the
// surface plane still ramps to the ground at the bank.
fn crSpline(p0 : f32, p1 : f32, p2 : f32, p3 : f32, t : f32) -> f32 {
  return 0.5 * ((2.0 * p1)
    + (-p0 + p2) * t
    + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
    + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t * t * t);
}
fn terrTap(ix : i32, iy : i32) -> f32 {
  let W = i32(G.uGrid.x); let H = i32(G.uGrid.y);
  let cx = clamp(ix, 0, W - 1); let cy = clamp(iy, 0, H - 1);
  return terrainH[u32(cy) * u32(W) + u32(cx)];
}
fn surfTap(ix : i32, iy : i32) -> f32 {
  let W = i32(G.uGrid.x); let H = i32(G.uGrid.y);
  let cx = clamp(ix, 0, W - 1); let cy = clamp(iy, 0, H - 1);
  let i = u32(cy) * u32(W) + u32(cx);
  let s = surfaceW[i];
  if (s < 0.0) { return terrainH[i]; }   // dry tap → bed, so the plane meets the bank
  return s;
}
fn cubicTerrainH(gx : f32, gy : f32) -> f32 {
  let x = floor(gx); let y = floor(gy);
  let tx = gx - x; let ty = gy - y;
  let ix = i32(x); let iy = i32(y);
  var col : array<f32, 4>;
  for (var r : i32 = 0; r < 4; r = r + 1) {
    let yy = iy - 1 + r;
    col[r] = crSpline(terrTap(ix - 1, yy), terrTap(ix, yy), terrTap(ix + 1, yy), terrTap(ix + 2, yy), tx);
  }
  return crSpline(col[0], col[1], col[2], col[3], ty);
}
fn cubicSurfaceW(gx : f32, gy : f32) -> f32 {
  let x = floor(gx); let y = floor(gy);
  let tx = gx - x; let ty = gy - y;
  let ix = i32(x); let iy = i32(y);
  var col : array<f32, 4>;
  for (var r : i32 = 0; r < 4; r = r + 1) {
    let yy = iy - 1 + r;
    col[r] = crSpline(surfTap(ix - 1, yy), surfTap(ix, yy), surfTap(ix + 1, yy), surfTap(ix + 2, yy), tx);
  }
  return crSpline(col[0], col[1], col[2], col[3], ty);
}

// ── ANALYTIC RIVER CHANNEL — distance to the connectome centreline ────────────────
// The CPU mirror is channelAt() in river-channel-geometry.ts (kept byte-for-byte in
// step so the wetness oracle, the tests, and this paint agree). For a fragment at tile
// (gx,gy): look up its bucket, test only that bucket's segments, keep the nearest. The
// SIGNED distance sd = dist - halfWidth is the smooth silhouette (sd < 0 inside); surf
// is the bank-referenced fill, flow the downstream unit tangent. hit=false when the
// world has no rivers (segCount 0) or no segment registers into this bucket.
struct Chan { hit : bool, sd : f32, surf : f32, flow : vec2<f32> };
fn segF(i : u32) -> f32 { return bitcast<f32>(channel[i]); }
fn channelAt(gx : f32, gy : f32) -> Chan {
  var r : Chan;
  r.hit = false; r.sd = 1e9; r.surf = -1.0; r.flow = vec2<f32>(0.0, 0.0);
  let segCount = u32(G.uChannel.w);
  if (segCount == 0u) { return r; }
  let bt  = G.uChannel.x;
  let nbx = u32(G.uChannel.y);
  let nby = u32(G.uChannel.z);
  let nb  = nbx * nby;
  let offLen  = nb + 1u;                       // bucketOffset region length
  let segBase = offLen + channel[nb];          // segments start after offsets + seg refs
  let bx = u32(clamp(floor(gx / bt), 0.0, f32(nbx) - 1.0));
  let by = u32(clamp(floor(gy / bt), 0.0, f32(nby) - 1.0));
  let b = by * nbx + bx;
  let start = channel[b];
  let end   = channel[b + 1u];
  var best = 1e9;
  var bestHalf = 0.0;
  var bestSurf = -1.0;
  var bestFlow = vec2<f32>(0.0, 0.0);
  for (var p = start; p < end; p = p + 1u) {
    let o = segBase + channel[offLen + p] * 8u;   // bucketSegs[p] → segment word offset
    let ax = segF(o);      let ay = segF(o + 1u);
    let bx2 = segF(o + 2u); let by2 = segF(o + 3u);
    let dx = bx2 - ax; let dy = by2 - ay;
    let len2 = dx * dx + dy * dy;
    var t = 0.0;
    if (len2 > 0.0) { t = clamp(((gx - ax) * dx + (gy - ay) * dy) / len2, 0.0, 1.0); }
    let cx = ax + t * dx; let cy = ay + t * dy;
    let d = length(vec2<f32>(gx - cx, gy - cy));
    if (d < best) {
      best = d;
      bestHalf = mix(segF(o + 4u), segF(o + 5u), t);
      bestSurf = mix(segF(o + 6u), segF(o + 7u), t);
      let fl = max(sqrt(len2), 1e-4);
      bestFlow = vec2<f32>(dx / fl, dy / fl);
    }
  }
  if (best >= 1e9) { return r; }
  r.hit = true;
  r.sd = best - bestHalf;
  r.surf = bestSurf;
  r.flow = bestFlow;
  return r;
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

  let quadIdx = vid / 6u;
  let vinq = vid % 6u;
  // WET-CELL MESH (sparse): one quad per water-or-river-band lattice cell, packed by the
  // CPU as cellX | (cellY<<16) — already window-culled + lattice-snapped, so the dry map
  // interior generates no vertices at all. The draw-gate below still trims the generous
  // river-band dilation precisely. (uWindow now drives only the CPU cull, not this loop.)
  let packed = wetCells[quadIdx];
  let cellX = min(packed & 0xffffu, W - 1u);
  let cellY = min(packed >> 16u, H - 1u);
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
  let gx = f32(cellX) + f32(corner.x) * f32(sub);
  let gy = f32(cellY) + f32(corner.y) * f32(sub);

  // DRAW-GATE. Ocean/lake/river-classified cells (wtype != 0) always draw. A cell the
  // raster calls DRY still draws when it falls inside the river BAND (within the channel
  // half-width + margin) so the analytic silhouette can extend past the old per-cell
  // mask — this is what un-staircases the river. Quads that are neither collapse to a
  // off-clip degenerate triangle (no fragments), so far-from-water cells cost nothing.
  let typ = wtype[ci];
  let cc = channelAt(f32(cellX) + f32(sub) * 0.5, f32(cellY) + f32(sub) * 0.5);
  let inBand = cc.hit && cc.sd < (f32(sub) + 2.0);
  if (typ == 0u && !inBand) {
    var deg : VSOut;
    deg.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);   // outside clip → culled, zero area
    deg.vGrid = vec2<f32>(0.0, 0.0);
    deg.vCell = ci;
    return deg;
  }

  // SMOOTH water surface, lifted per corner. Ocean (1) is the fixed datum; lake (2)
  // rides the drought/flood plane (uWater.w). Rivers + dry-band cells take the ANALYTIC
  // channel fill at the corner (the smooth bank-referenced surface from the connectome),
  // falling back to the bilinear per-cell surface only where the corner is out of band.
  // A shared corner resolves to one height in every quad, so the plane is continuous.
  var surf : f32;
  if (typ == 1u) {
    surf = sampleSurfaceW(gx, gy);
  } else if (typ == 2u) {
    surf = sampleSurfaceW(gx, gy) + G.uWater.w;
  } else {
    let cg = channelAt(gx, gy);
    if (cg.hit) { surf = cg.surf + G.uWater.w; }
    else { surf = sampleSurfaceW(gx, gy) + G.uWater.w; }
  }
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
// WP-M overview fill perf: shore distance (tiles) inside which ocean/lake fragments keep
// the BICUBIC pixel-perfect waterline clip; deeper water reads BILINEAR (a quarter of the
// storage bandwidth) since its large-positive depth never clips. Generous enough to cover
// the whole waterline band even under the zoom-coarsened mesh (flat cell index can trail
// the fragment by up to the subsample stride, ≤4), so the water/land boundary is untouched.
const SHORE_CUBIC_TILES = 6.0;

// ── RIVER MOTION + FOAM (R6 render polish) ────────────────────────────────────────
// Foam tone for river whitewater, bank rim and waterline lip (one colour → one read).
const RIVER_FOAM = vec3<f32>(0.92, 0.96, 0.98);
// Valve dual-phase flow advection: reset rate (cycles/s at unit flow speed) and the
// distance (in streak along-units) a single phase translates the noise downstream before
// it resets. Two phases run ½ cycle apart and are triangle-crossfaded, so the reset jump
// is always hidden behind the other (mid-travel) phase → clean marching flow, no smear.
const RIVER_FLOW_HZ = 0.10;
const RIVER_TRAVEL  = 6.0;
// Bank-foam reach (tiles) inward from the analytic channel edge (sd = 0): the soft "wet"
// waterline that melts the hard vector cutout into a lapping foam rim.
const RIVER_RIM_TILES = 0.55;
// Tiles inward over which the water colour deepens toward the channel centre (thalweg read).
const RIVER_DEEP_TILES = 2.5;

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let ci = in.vCell;
  let cellTyp = wtype[ci];

  // OCEAN (1) + LAKE (2) keep the per-cell path. RIVER is now ANALYTIC: a dry-band or
  // river-classified cell resolves its wetness, surface and flow from the connectome
  // channel geometry, so the silhouette is the smooth offset curve sd = 0, NOT the
  // per-cell classification edge (the staircase). Ocean/lake fold into the same scheme
  // in S4.
  var typ = cellTyp;
  var surfLvl : f32;
  var sdEdge : f32 = -1.0;                  // analytic signed distance (rivers); <0 inside
  var flowV : vec2<f32> = vec2<f32>(0.0, 0.0);

  // SHORE-GATED SAMPLING (WP-M — overview fill perf). The pixel-perfect waterline is a
  // BICUBIC (16-tap ×2 = 32 storage reads) clip of surface − bed at the sub-cell zero
  // crossing — but that crossing only exists within a few tiles of the bank. A DEEP-water
  // ocean/lake fragment (shore distance ≥ SHORE_CUBIC_TILES) has a large-positive depth
  // that never clips, so the exact contour there is irrelevant; a BILINEAR read (4-tap ×2
  // = 8 reads) gives a visually identical depth/tint at a quarter of the bandwidth. This
  // is the open-sea bulk of a watery overview — the fill-bound regime the water pass is
  // bandwidth-limited in (~80 storage reads/frag; round-3 found the pass memory-bound on
  // exactly these reads). shoreD reads 0 on land AND on the dry shore-dilation overhang
  // cells, so the ENTIRE waterline band stays bicubic → zero visible change at the
  // water/land boundary. Rivers (narrow, always near a bank) always keep bicubic.
  let shoreCell = shoreD[ci];
  let deepWater = (cellTyp == 1u || cellTyp == 2u) && shoreCell >= SHORE_CUBIC_TILES;

  if (cellTyp == 1u || cellTyp == 2u) {
    // PIXEL-PERFECT WATERLINE. The bed (terrainH) is bicubic, the surface bicubic, so
    // surface − bed crosses zero exactly where the terrain contour meets the water
    // plane — a C1 contour across tile seams. The one-ring shore dilation gives near-
    // bank dry cells a water plane so BOTH sides of the line are covered. Lakes ride the
    // drought/flood-shifted surface; ocean stays at its datum. Deep water skips to the
    // cheap bilinear surface (identical where nothing clips).
    if (deepWater) { surfLvl = sampleSurfaceW(in.vGrid.x, in.vGrid.y); }
    else { surfLvl = cubicSurfaceW(in.vGrid.x, in.vGrid.y); }
    if (cellTyp == 2u) { surfLvl = surfLvl + G.uWater.w; }
  } else {
    // RIVER / dry-band → analytic channel. The signed distance is a smooth (cell-grid-
    // free) function, so even a hard threshold gives a clean curve; the surface is the
    // bank-referenced fill the carve uses, so paint + erosion finally agree.
    let cg = channelAt(in.vGrid.x, in.vGrid.y);
    if (!cg.hit || cg.sd >= 0.0) { discard; }
    typ = 3u;
    surfLvl = cg.surf + G.uWater.w;
    sdEdge = cg.sd;
    flowV = cg.flow;
  }

  // Bed: bicubic near the bank (the waterline clip needs it), bilinear in deep water.
  var bedN : f32;
  if (deepWater) { bedN = sampleTerrainH(in.vGrid.x, in.vGrid.y); }
  else { bedN = cubicTerrainH(in.vGrid.x, in.vGrid.y); }
  let rawDepthN = surfLvl - bedN;
  if (rawDepthN <= 0.0) { discard; }
  let depthM = rawDepthN * G.uZParams.z;
  // Screen-space gradient of the analytic river distance, for the silhouette anti-alias
  // below. fwidth MUST be evaluated in UNIFORM control flow, so compute it here at the
  // fragment top level (ocean/lake hold sdEdge = -1, a constant → gradient 0, unused).
  let sdGrad = fwidth(sdEdge);
  // Screen-space gradient of depth — the OCEAN/LAKE waterline feather (R6). Their edge is
  // the depth zero-crossing, not an analytic SDF, so we key the last-pixel alpha ramp off
  // this instead of sdGrad. Same uniform-flow requirement → computed here beside sdGrad.
  let depthGrad = fwidth(depthM);

  // Depth tint (S4 biome shallow→deep), SMOOTH — clarity stretches the ramp so
  // clear water shows its bed further down. PER-CHANNEL Beer-Lambert absorption:
  // red extinguishes first, then green, so shallows glow turquoise and depth
  // saturates blue-first — a real water gradient, not a linear crossfade. Depth
  // varies with the real bed, so the gradient hugs the coast.
  let clar = sampleClarity(in.vGrid.x, in.vGrid.y);
  let absorb = vec3<f32>(3.0, 1.3, 0.7);
  let dNorm = depthM / mix(1.2, 5.0, clar);
  let tDeep = vec3<f32>(1.0) - exp(-dNorm * absorb);
  // Smooth, per-fragment biome colour (LOD-independent, never black at a bank). See
  // sampleWaterCol — this replaced the flat per-vertex vCell colour that black-patched.
  let wcol = sampleWaterCol(in.vGrid.x, in.vGrid.y);
  var color = mix(wcol.shallow, wcol.deep, tDeep);

  // WET-SHORE MARGIN (R6) — STILL BODIES (lake). The shallowest water takes the pale
  // shallow-biome tint, which against a dark bank (mud/rock) reads as a bright rim with a
  // hard contrast step — the "painted cutout" tell. A real waterline is DARKER at the very
  // edge (wet sediment, grazing view, less sky). Damp the shallowest ~0.4 m toward a muted
  // tone so the rim sits closer to the bank's value; the land→water transition softens
  // without touching the geometry, and the shelf still lightens just a little further out.
  // Scoped to typ != river: OCEAN reassigns colour from its own shoal shelf below (so this
  // is effectively lake-only), and a shallow BROOK is shallow across its WHOLE width — a
  // depth-keyed darkening would mud the entire channel, not just its bank. Rivers get their
  // bank read from the analytic-SDF rim (bankRim) instead.
  if (typ != 3u) {
    let wetMargin = smoothstep(0.42, 0.0, depthM);
    color = color * (1.0 - 0.24 * wetMargin);
  }

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

    // Saturate to the DEEP biome colour by SHORE DISTANCE, not just bed depth: the
    // open sea reaches a constant deep tone a little offshore regardless of how
    // shallow the noise seabed happens to be, so the far ocean matches the infinite
    // backdrop exactly (no bright shelf at the map edge) and the sea reads uniform
    // out to the horizon. Near shore the real depth tint + shallows still show.
    let shoreDeep = smoothstep(5.0, 26.0, shore);
    color = mix(wcol.shallow, wcol.deep, max(tDeep, vec3<f32>(shoreDeep)))
          * (G.uAmbient.xyz + vec3<f32>(day * 0.85));

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
    // and others stay quiet. PER-FRAGMENT via the smooth bilinear sampler — the old
    // central diff at ci (the FLAT provoking-vertex cell) made shoal constant per
    // TRIANGLE, and everything keyed off it (the swash run-line especially) stepped
    // in giant pale triangles whenever the drag-LOD mesh coarsened.
    let bgx = sampleTerrainH(g.x + 1.0, g.y) - sampleTerrainH(g.x - 1.0, g.y);
    let bgy = sampleTerrainH(g.x, g.y + 1.0) - sampleTerrainH(g.x, g.y - 1.0);
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

    // Sun-glitter: thresholded sparkle drifting along the swell. One decorrelated
    // atlas tap (the old ALU version was cut for cost — and its 0.82 threshold was
    // dead against the 0.75-max fbm anyway, so this is its first real appearance).
    // Warm-white, day-gated, and stronger toward open water so shallows stay soft.
    let gl = fbm2b(g * 0.7 - dir * (t * 0.5));
    color += vec3<f32>(1.0, 0.97, 0.86)
           * (smoothstep(0.88, 0.97, gl) * day * mix(0.06, 0.16, shoreDeep));

    // Faint sky sheen on the open sea — the ortho stand-in for the Fresnel-bright
    // far water: deep ocean leans a few percent toward the sky tone, which reads as
    // a reflective surface without any reflection pass.
    let sky = mix(vec3<f32>(0.09, 0.12, 0.20), vec3<f32>(0.52, 0.66, 0.80), day);
    color = mix(color, sky, 0.10 * shoreDeep);

    // SWASH run-up: a slow waterline that advances up the shelf and pulls back. The
    // throw is larger on gentle/long beaches (shoal) so wide shallows get a long wash;
    // steep shores barely move. (The trailing wet-band darkening was dropped — a second
    // pair of smoothsteps for a barely-visible effect; the swash sheet + foam stay.)
    let swash = sin(t * 0.55 + dot(g, dir) * 0.08 + warpA * 0.15) * 0.5 + 0.5; // 0..1, slow
    let runLine = (0.6 + 5.0 * shoal) * swash;          // tiles up the shelf the sheet reaches
    let sheet = smoothstep(runLine, runLine - 1.2, shore);   // 1 where the wash currently covers

    // Foam: the waterline lip + the breaking crest of each swell + the leading edge
    // of the swash sheet. Wider & brighter on shoaling, exposed coasts.
    let breakLine = smoothstep(3.0, 0.0, shore) * smoothstep(0.6, 1.0, crest) * mix(0.4, 1.0, exposure);
    let swashEdge = sheet * smoothstep(0.5, 1.0, swash) * (0.5 + 0.5 * shoal);
    let foam = max(max(lip, breakLine * 0.9), swashEdge * 0.8) * (0.6 + 0.4 * shoal + 0.0);
    color = mix(color, vec3<f32>(0.92, 0.96, 0.98), clamp(foam, 0.0, 1.0) * 0.85);

  } else if (typ == 2u) {
    // ---- LAKE -----------------------------------------------------------------
    // Calm sheet, but with a LEGIBLE shoreline so the lake reads as a water surface
    // and not a flat dark slab. Keyed to the SAME shore-distance field the ocean uses
    // (binding 8) — the BFS is seeded from every land cell, so it's valid inside lakes
    // too (distance to the lake bank). Still no shoreward swell rings (those read as a
    // central wave-maker) and no breaking surf — a still pond with a lapping rim.
    let shore = sampleShore(g.x, g.y);                  // tiles from the lake bank
    let nearShore = exp(-shore * 0.5);                  // tight rim — lakes are small

    // Shallow RIM: shelve up toward the shallow biome tone at the very edge, so the
    // bank reads as water lightening into the shallows rather than a hard dark border.
    let rimCol = wcol.shallow * (G.uAmbient.xyz + vec3<f32>(day * 0.85));
    color = mix(color, rimCol, nearShore * 0.5);

    // Faint uniform breeze-ripple (fades toward the still centre) + soft noise glints.
    let ripplePhase = dot(g, LAKE_DIR) * (TWO_PI / 5.5) + t * 0.7
                    + (fbm(g * 0.18 + vec2<f32>(t * 0.04, 0.0)) - 0.5) * 2.0;
    let ripple = sin(ripplePhase) * 0.5 + 0.5;
    color += vec3<f32>(smoothstep(0.6, 1.0, ripple) * 0.04);
    let lakeGl = fbm2b(g * 0.55 + vec2<f32>(t * 0.05, -t * 0.04));
    color += vec3<f32>(smoothstep(0.84, 0.97, lakeGl) * 0.05 * day);

    // Shore foam: a soft lapping band right at the bank (slow "breathing" so the edge
    // feels alive) plus the thin waterline lip. Much quieter than ocean surf.
    let lap = 0.5 + 0.5 * sin(t * 0.8 + (fbm(g * 0.3) - 0.5) * 3.0);
    let shoreFoam = smoothstep(1.4, 0.0, shore) * (0.35 + 0.25 * lap);
    color = mix(color, vec3<f32>(0.90, 0.95, 0.97), max(lip * 0.6, shoreFoam * 0.55));

  } else {
    // ---- RIVER ----------------------------------------------------------------
    // Streaks advected ALONG the ANALYTIC flow vector (the centreline tangent at the
    // nearest point). R6: motion via VALVE DUAL-PHASE flow advection (Vlachos 2010) —
    // two noise samples translated downstream, phase-offset ½ cycle, triangle-crossfaded,
    // so the streaks visibly MARCH downstream and bend around meanders WITHOUT the smear
    // a single ever-scrolling sample shows where the per-fragment flow basis rotates. Speed
    // + whitewater still scale with the local bed slope (height drop to the downstream cell).
    let fv = flowV;
    let W = u32(G.uGrid.x);
    let H = u32(G.uGrid.y);
    let cx = ci % W;
    let cy = ci / W;
    let dcx = u32(clamp(i32(cx) + i32(round(fv.x)), 0, i32(W) - 1));
    let dcy = u32(clamp(i32(cy) + i32(round(fv.y)), 0, i32(H) - 1));
    let drop = max(terrainH[ci] - terrainH[dcy * W + dcx], 0.0) * G.uZParams.z; // m over ~1 tile
    let speed = 0.6 + clamp(drop * 0.7, 0.0, 2.4);      // steep reaches run fast

    // Streak coordinate: stretched ALONG flow (×1.4), tight ACROSS (×2.6) → downstream lines.
    let along  = dot(g, fv);
    let across = dot(g, vec2<f32>(-fv.y, fv.x));
    let uv = vec2<f32>(along * 1.4, across * 2.6);
    // Dual-phase advection: each phase translates the sample downstream by RIVER_TRAVEL
    // along-units then resets; the two phases are ½ cycle apart and cross-faded by a
    // triangle weight, so the reset discontinuity is always masked by the other phase.
    let cyc = t * speed * RIVER_FLOW_HZ;
    let ph1 = fract(cyc);
    let ph2 = fract(cyc + 0.5);
    let s1 = fbm(uv - vec2<f32>(ph1 * RIVER_TRAVEL, 0.0));
    let s2 = fbm(uv - vec2<f32>(ph2 * RIVER_TRAVEL, 0.0));
    let stream = mix(s1, s2, abs(1.0 - 2.0 * ph1));
    color += vec3<f32>((stream - 0.5) * 0.10);          // visible flowing texture

    // CROSS-CHANNEL DEPTH READ. -sdEdge is the tiles-inward from the analytic bank; deepen
    // the colour toward the channel centre so the river reads as a body of water with a
    // thalweg, not a flat pale strip. Keyed to the SDF (not the shallow uniform carve), so
    // even a 1 m brook gets a legible light-margin → dark-centre gradient.
    let crossDeep = smoothstep(0.0, RIVER_DEEP_TILES, -sdEdge);
    color = mix(color, wcol.deep * (G.uAmbient.xyz + vec3<f32>(day * 0.85)), crossDeep * 0.45);

    // FOAM — RESTRAINED. The old river foamed off absolute depth (the lip term), but a brook is
    // shallow across its WHOLE width, so depth-foam whitened the entire channel — the
    // "painted white ribbon" tell. Foam is now keyed to the analytic BANK DISTANCE: a THIN
    // bright rim right at the edge (-sdEdge → 0), shimmered by the moving noise so it laps.
    // Whitewater is reserved for reaches that genuinely DROP (steep). Together they read as
    // a bank line + rapids, never a solid white surface.
    let bankRim = smoothstep(RIVER_RIM_TILES, 0.0, -sdEdge)
                * (0.55 + 0.45 * smoothstep(0.35, 0.85, stream));
    let whitewater = smoothstep(0.66, 1.0, stream) * smoothstep(0.7, 2.0, drop);
    let foam = max(bankRim * 0.34, whitewater * 0.75);
    color = mix(color, RIVER_FOAM, clamp(foam, 0.0, 1.0));
  }

  // CAUSTICS — shared by all three body types. Two decorrelated scrolling noise
  // sheets, min()-sharpened: the minima of two phase-shifted fields form thin bright
  // filaments (the classic cheap caustic), drifting against each other so the net
  // never reads static. Only in shallow, reasonably clear, day-lit water — exactly
  // where the bed shows through the depth-keyed alpha, so the light appears to dance
  // on the bed itself.
  let cShallow = smoothstep(2.4, 0.3, depthM) * mix(0.3, 1.0, clar) * day;
  if (cShallow > 0.004) {
    let c1 = fbm2b(g * 0.85 + vec2<f32>(t * 0.11, -t * 0.09));
    let c2 = fbm2b(g * 0.85 + vec2<f32>(29.0, 47.0) - vec2<f32>(t * 0.08, -t * 0.13));
    let fil = smoothstep(0.50, 0.80, min(c1, c2) * 1.5);
    color += vec3<f32>(0.10, 0.13, 0.12) * (fil * cShallow);
  }

  // Depth-keyed TRANSPARENCY so the bed shows through shallow water — riverbeds,
  // lake margins, sandy sea shallows. The pipeline blends premultiplied alpha
  // (src 'one'), so premultiply rgb by alpha. Foam/whitewater (near-white) keeps
  // full alpha so crests stay crisp; deep water saturates to opaque.
  let bedClear = mix(1.6, 3.2, clar);                   // metres of depth → opaque
  var wAlpha = clamp(0.28 + 0.72 * (depthM / bedClear), 0.28, 1.0);
  let foamy = smoothstep(0.80, 0.95, max(color.r, max(color.g, color.b)));
  wAlpha = clamp(max(wAlpha, foamy), 0.0, 1.0);
  // RIVER EDGE ANTI-ALIASING. The silhouette is the analytic curve sd = 0; feather the
  // last pixel of coverage by the screen-space gradient of sd (fwidth) so the bank is a
  // clean 1px edge rather than a hard alpha cliff. Uniform per quad (typ is flat), so
  // the derivative is well-defined. Ocean/lake keep their depth/foam alpha unchanged.
  if (typ == 3u) {
    let aa = clamp(-sdEdge / max(sdGrad, 1e-4), 0.0, 1.0);
    wAlpha = wAlpha * aa;
  } else {
    // OCEAN / LAKE waterline feather. The depth-keyed alpha had a hard floor (0.28) that
    // it dropped to zero across a single pixel at the shore — a jagged vector staircase
    // where land meets water (rivers already feathered via their SDF; ocean/lake didn't).
    // Ramp the last pixel of coverage by the screen-space depth gradient (the depth-field
    // twin of the SDF AA), so the boundary resolves as a clean sub-pixel edge. Foam near
    // the lip rides the same alpha, so the surf line softens into the shore too.
    let aa = clamp(depthM / max(depthGrad, 1e-4), 0.0, 1.0);
    wAlpha = wAlpha * aa;
  }
  let outC = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(outC * wAlpha, wAlpha);
}
`;
