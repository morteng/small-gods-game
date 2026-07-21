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
  uMode     : vec2<f32>,   // x: display mode enum (0 textured … 5 normals); y: reserved
  uXform    : vec4<f32>,   // sx, sy, ox, oy : device = world * sxy + oxy
  uGrid     : vec2<f32>,   // cells: width, height
  uHalf     : vec2<f32>,   // iso half-tile: halfW, halfH (px)
  uZParams  : vec4<f32>,   // zPxPerM, seaLevel, reliefM, subsample
  uSun      : vec4<f32>,   // tile-space sun dir xyz, bands
  uAmbient  : vec4<f32>,   // ambient rgb, sun strength
  uWindow   : vec4<f32>,   // viewport-cull mesh window: oxTile, oyTile, spanW, spanH (tiles)
  uFlags    : vec4<f32>,   // x: ground colour-texture enable (1; ?groundtex=off => 0);
                           // y: pxScale (approx S/dpr, the dynamic-resolution px factor) —
                           // divides the screen-space derivative footprint so ground LOD/
                           // fade depends on camera zoom alone, never the resolution tier
                           // (px1..px4 read identical ground colour at a fixed camera);
                           // zw reserved
};

@group(0) @binding(0) var<uniform> G : TGlobals;
@group(0) @binding(1) var<storage, read> heights : array<f32>; // normalised elev [0,1], row-major
@group(0) @binding(2) var<storage, read> colors  : array<u32>; // 0xAABBGGRR per cell
@group(0) @binding(3) var<storage, read> moisture    : array<f32>; // [0,1] per cell (T-A)
@group(0) @binding(4) var<storage, read> temperature : array<f32>; // [0,1] per cell (T-A)
// Binding 5 is the detail-patch fine-height buffer (detail pipeline only) — keep it free
// here. The road FEATURE geometry rides binding 6 (shared by the terrain + detail passes):
// an analytic, self-describing segment buffer (feature-geometry.ts) the fragment evaluates
// for pavedness by DISTANCE to the smooth centreline — no per-cell field, no 2 m grid.
@group(0) @binding(6) var<storage, read> roadFeat : array<u32>;
// Material-exemplar atlas (Slice 1): one seamless tileable swatch per material, layer
// index = MATERIAL_LAYER in material-exemplar.ts (grass0 dirt1 rock2 sand3 snow4 mud5
// road_dirt6 road_gravel7 road_cobble8). Sampled with a REPEAT sampler at tile-space UV.
@group(0) @binding(7) var matAtlas : texture_2d_array<f32>;
@group(0) @binding(8) var matSamp  : sampler;
// BAKED tiling noise atlas (noise-texture.ts, shared with the water + backdrop passes).
// R = single-octave value noise — the terrain jitter channel. One bilinear tap replaces
// the old in-shader hash21+sin lattice vnoise (4 transcendental hashes + bilinear mix
// per call, paid by EVERY terrain fragment for the threshold wander) — on the fill-bound
// overview the texture units are idle while ALU is the bottleneck.
@group(0) @binding(9) var noiseTex : texture_2d<f32>;
@group(0) @binding(10) var noiseSmp : sampler;
const NOISE_INV_TILE = 1.0 / 64.0;   // 1 / NOISE_TILE_UNITS — keep in step with noise-texture.ts
// (The harvested ground-cover CLUTTER atlas that used to bind here at 11/12 is retired:
// ground cover is now the UPRIGHT billboard pass, grass-scatter.ts / passGrass. The old
// in-shader flat-decal scatter smeared tall sprites into iso diagonal streaks.)
// Seamless BASE-GROUND texture-patch ARRAY (real harvested top-down swatches, repeat sampler):
// 11 layers — open ground (0 lush grass · 1 bare dust · 2 pebble gravel · 3 dry parched grass),
// 4 shallow seabed, beaches (5 white shell-sand · 6 grey shingle), drylands (7 desert dune ·
// 8 cracked hardpan), 9 fresh snow, 10 forest-floor litter. The shader SPLATS them terrain-aware
// keyed on the climate fields (wetness/temp/slope/depth). Only the LUSH grass is mean-normalised
// (biome stays its hue authority); every other swatch keeps its OWN real colour so drying ground
// genuinely turns dusty, a hot coast turns white-sand, a deep tile turns to seabed — not a tint.
@group(0) @binding(11) var groundTex  : texture_2d_array<f32>;
@group(0) @binding(12) var groundSamp : sampler;
const GROUND_GRASS_MEAN   : vec3<f32> = vec3<f32>(0.2046, 0.3363, 0.1911);  // avg RGB of grass.png
const GROUND_REPEAT_TILES : f32 = 1.25;  // one swatch repeat spans ~1.25 world tiles (~2.5 m) — fine grain
const GROUND_LAYER_GRASS       : i32 = 0;
const GROUND_LAYER_DUST        : i32 = 1;
const GROUND_LAYER_PEBBLE      : i32 = 2;
const GROUND_LAYER_DRY         : i32 = 3;
const GROUND_LAYER_SEABED      : i32 = 4;
const GROUND_LAYER_SAND_WHITE  : i32 = 5;
const GROUND_LAYER_SHINGLE     : i32 = 6;
const GROUND_LAYER_DUNE        : i32 = 7;
const GROUND_LAYER_HARDPAN     : i32 = 8;
const GROUND_LAYER_SNOW        : i32 = 9;
const GROUND_LAYER_LITTER      : i32 = 10;

// Sample one ground-patch layer with a gentle domain warp + a light second octave so the
// ~5-tile repeat never reads as a stamp while the crisp primary detail survives.
// fwGrid = the pixel footprint of \`grid\` (fwidth of whatever the caller passes, INCLUDING
// any frequency multiplier) — it selects the mip whose texel density matches the screen, so
// the 512px swatches finally RESOLVE at gameplay zoom instead of decimating mip-0 detail
// into aliased grit (the "splatmaps never show at 1:1" bug; the texture now carries a full
// CPU-built pyramid — gpu-scene loadGroundTexture).
fn groundPatch(layer : i32, grid : vec2<f32>, fwGrid : f32, warp : f32, mixW : f32) -> vec3<f32> {
  let uv0 = grid / GROUND_REPEAT_TILES + vec2<f32>(warp, warp * 0.6);
  let uv1 = grid / (GROUND_REPEAT_TILES * 2.3) + vec2<f32>(0.37, 0.61);
  let texels = fwGrid / GROUND_REPEAT_TILES * f32(textureDimensions(groundTex).x);
  let maxLod = f32(textureNumLevels(groundTex) - 1u);
  // −0.7 sharpen bias: exact trilinear leaves the fine-repeat swatches a shade soft at
  // gameplay zoom (≈LOD 4 — "terrain texture looks very blended"); biasing under one
  // mip restores grain punch with negligible pan shimmer at these densities.
  let lod0 = clamp(log2(max(texels, 1e-4)) - 0.7, 0.0, maxLod);
  let lod1 = clamp(lod0 - 1.2, 0.0, maxLod);            // the /2.3 octave is coarser per px
  let s0 = textureSampleLevel(groundTex, groundSamp, uv0, layer, lod0).rgb;
  let s1 = textureSampleLevel(groundTex, groundSamp, uv1, layer, lod1).rgb;
  return mix(s0, s1, mixW);   // crisp primary, light second octave breaks the repeat (mean-agnostic)
}

// How many world tiles one exemplar repeat spans (1 tile = 2 m). ~2.5 tiles → a 64px
// swatch over ~5 m reads chunky-but-legible under the banded sun.
const MAT_TILES : f32 = 2.5;

fn matSample(layer : i32, uv : vec2<f32>) -> vec3<f32> {
  return textureSample(matAtlas, matSamp, uv, layer).rgb;
}

// Real COLOUR of one exemplar layer with EXPLICIT LOD (no derivative builtin), so it is
// legal inside the NON-uniform zoom-fade branch — used by the ground splat for the dust /
// sand / pebble layers that need their true swatch colour, not the mean-normalised grain.
fn matColor(layer : i32, uv : vec2<f32>, lod : f32) -> vec3<f32> {
  let maxLod = f32(textureNumLevels(matAtlas) - 1u);
  return textureSampleLevel(matAtlas, matSamp, uv, layer, min(lod, maxLod)).rgb;
}

// Mean-normalised COLOUR detail of one exemplar layer (Slice 2 ground texture):
// the swatch sample divided by the swatch's own overall mean — the 1×1 top mip,
// which for these toroidal swatches IS the exact mean. The result averages to
// vec3(1), so multiplying a biome colour by it adds the swatch's local grain +
// chroma variation WITHOUT shifting the average hue: the per-cell biome colour
// field stays the authority (volcanic, farmland, wear and dev tints all survive).
// Explicit-LOD sampling only (no derivative builtin), so callers may gate it
// behind NON-uniform branches — the zoom fade skips it entirely at overview.
fn matDetail(layer : i32, uv : vec2<f32>, lod : f32) -> vec3<f32> {
  let maxLod = f32(textureNumLevels(matAtlas) - 1u);
  let s = textureSampleLevel(matAtlas, matSamp, uv, layer, min(lod, maxLod)).rgb;
  let m = textureSampleLevel(matAtlas, matSamp, uv, layer, maxLod).rgb;
  return s / max(m, vec3<f32>(1e-3));
}

// Cheap 2D hash in [0,1). Grass can afford a couple of these per fragment (unlike the
// per-fragment threshold wander, which uses the baked noise texture for perf) because it
// only runs at gameplay zoom on grass-dominant ground.
fn gHash(p : vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}

// Analytic pixel-art GRASS: directional blade striations rising up-screen, each blade lit
// from tip (bright) to base (self-shadow AO), with per-blade hue jitter. Returns an albedo
// multiplier that grains the biome colour (same contract as matDetail). No true silhouette
// height yet — the tip/base gradient gives IMPLIED height + self-shadow; a shell pass can
// add real poke-above height later. Blade frame on the flat ground: up-screen is -(fx+fy),
// across is (fx-fy), so blades stand vertically in the iso view.
fn analyticGrass(fx : f32, fy : f32) -> vec3<f32> {
  // Blade frame on the flat ground: across (fx-fy) runs screen-RIGHT (× ISO_TILE_W/2),
  // up (fx+fy) runs screen-DOWN (× ISO_TILE_H/2). Blades stand screen-vertical, rooted at
  // the base (larger up, down-screen) with the tip pointing up-screen (smaller up).
  let across = fx - fy;
  let up     = fx + fy;
  let COLF = 5.0;                                  // blade columns per across-unit (thin blades)
  let ROWF = 1.9;                                  // blade-cell bands per up-unit
  let col  = across * COLF;
  let ci   = floor(col);
  let cf   = fract(col);                           // 0..1 within the column
  // Per-column CONTINUOUS phase so blade baselines do NOT line up across columns — this is
  // what breaks the quilted-grid read and makes the sward organic. (The old version shared
  // one row lattice for every column, which is why it looked like bubble-wrap on a diamond.)
  let colPhase = gHash(vec2<f32>(ci, 0.0)) * 3.17;
  let up2  = up * ROWF + colPhase;
  let rowB = floor(up2);
  let uCell = fract(up2);                          // 0 at cell TOP (tip side) .. 1 at base
  let seed = vec2<f32>(ci, rowB);
  let h1   = gHash(seed);
  let hgt  = 0.55 + 0.4 * h1;                      // blade height as a fraction of the cell
  let cx    = 0.5 + (gHash(seed + vec2<f32>(7.0, 0.0)) - 0.5) * 0.7;   // centre jitter
  let halfW = 0.22 + 0.14 * gHash(seed + vec2<f32>(19.0, 0.0));        // thin blade half-width
  let inX   = step(abs(cf - cx), halfW);           // HARD edge (pixel-art, no AA smear)
  let base0 = 1.0 - hgt;                            // only the lower hgt of the cell is blade
  let inY   = step(base0, uCell);
  let tipT  = clamp((uCell - base0) / max(hgt, 1e-3), 0.0, 1.0);       // 0 tip .. 1 base
  let shade = mix(1.26, 0.60, tipT);              // bright tip .. base self-shadow AO
  let hj  = gHash(seed + vec2<f32>(41.0, 3.0));
  let hue = mix(vec3<f32>(0.90, 1.05, 0.94), vec3<f32>(1.12, 1.02, 0.82), hj);  // cool..warm green
  let blade = inX * inY;
  return mix(vec3<f32>(0.88, 0.91, 0.85), hue * shade, blade);  // gaps = packed ground
}

fn cellIdx(cx : u32, cy : u32) -> u32 { return cy * u32(G.uGrid.x) + cx; }

fn unpackColor(rgba : u32) -> vec3<f32> {
  let r = f32(rgba & 0xFFu) / 255.0;
  let g = f32((rgba >> 8u) & 0xFFu) / 255.0;
  let b = f32((rgba >> 16u) & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

// ── Bilinear field sampling (kills the per-cell DIAMOND look) ────────────────
// The biome colour + material scalars used to be read from the NEAREST cell
// (round vGrid), so every cell painted as a flat iso-diamond and biome borders
// stepped along the grid. Sampling them BILINEARLY at the continuous fragment
// position (the same way the height buffer already lifts geometry) dissolves the
// diamonds into smooth gradients — terrain texturing now reads at pixel
// resolution over the coarse cell grid, no subdivision needed.
struct BiCell { x0 : u32, y0 : u32, x1 : u32, y1 : u32, tx : f32, ty : f32 }
fn biCell(fx : f32, fy : f32) -> BiCell {
  let W = u32(G.uGrid.x); let H = u32(G.uGrid.y);
  let px = clamp(fx, 0.0, f32(W - 1u));
  let py = clamp(fy, 0.0, f32(H - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  var o : BiCell;
  o.x0 = x0; o.y0 = y0;
  o.x1 = min(x0 + 1u, W - 1u); o.y1 = min(y0 + 1u, H - 1u);
  o.tx = px - f32(x0); o.ty = py - f32(y0);
  return o;
}
fn sampleScalarBi(b : BiCell, fld : ptr<storage, array<f32>, read>) -> f32 {
  let W = u32(G.uGrid.x);
  let s00 = (*fld)[b.y0 * W + b.x0]; let s10 = (*fld)[b.y0 * W + b.x1];
  let s01 = (*fld)[b.y1 * W + b.x0]; let s11 = (*fld)[b.y1 * W + b.x1];
  return mix(mix(s00, s10, b.tx), mix(s01, s11, b.tx), b.ty);
}
fn sampleColorBi(b : BiCell) -> vec3<f32> {
  let W = u32(G.uGrid.x);
  let c00 = unpackColor(colors[b.y0 * W + b.x0]); let c10 = unpackColor(colors[b.y0 * W + b.x1]);
  let c01 = unpackColor(colors[b.y1 * W + b.x0]); let c11 = unpackColor(colors[b.y1 * W + b.x1]);
  return mix(mix(c00, c10, b.tx), mix(c01, c11, b.tx), b.ty);
}

// Road pavedness as an ANALYTIC feature field: the carriageway is no longer a per-cell
// scalar (which could only resolve the edge to ±½ tile — the "zig-zag roads" artifact),
// but the distance to the smooth Catmull-Rom centreline, evaluated per fragment. We read
// the self-describing road-feature buffer (4-word header [bucketTiles,nbx,nby,segCount],
// then the CSR bucket index, then the segments), test only this fragment's bucket, and
// take the MAX of paved·fade over its segments (fade = 1 inside the core, → 0 at the
// half-width). Byte-equivalent to roadPavednessAt() in feature-geometry.ts.
fn rfF(i : u32) -> f32 { return bitcast<f32>(roadFeat[i]); }
// Everything the path-biome treatment needs from ONE bucket walk:
//   paved — max paved·fade over the covering segments (byte-equivalent to the old
//           roadPavedEdge .x / the CPU roadPavednessAt mirror).
//   edge  — inside depth in TILES = max(half − d) ≈ distance to the road's OUTER
//           boundary (the kerb-outline coordinate).
//   d/half — the winning segment's centreline distance + half-width, the lateral
//           coordinate the wheel-rut / crown-strip bands are drawn in.
//   verge — min(d − half) over the near segments: 0-at-the-edge growing outward
//           (negative inside), the coordinate for pebbly verge spill OUTSIDE the
//           ribbon. Segments register in buckets out to half+0.5 (reach), so the
//           verge coordinate is valid ~half a tile beyond the surface.
//   near  — max UNfaded pavedness among near segments — gates verge dressing by
//           the road's tier even where the faded pavedness is already 0.
struct RoadInfo {
  paved : f32,
  edge  : f32,
  d     : f32,
  half  : f32,
  verge : f32,
  near  : f32,
}
fn roadInfo(fx : f32, fy : f32) -> RoadInfo {
  var out : RoadInfo;
  out.paved = 0.0; out.edge = 0.0; out.d = 9.0; out.half = 1.0; out.verge = 9.0; out.near = 0.0;
  let segCount = roadFeat[3];
  if (segCount == 0u) { return out; }
  let bt  = f32(roadFeat[0]);
  let nbx = roadFeat[1];
  let nby = roadFeat[2];
  let nb  = nbx * nby;
  let offBase = 4u;                              // bucketOffset starts after the header
  let refBase = offBase + nb + 1u;               // bucketSegs start
  let segBase = refBase + roadFeat[offBase + nb]; // segments start (R = bucketOffset[nb])
  let bx = u32(clamp(floor(fx / bt), 0.0, f32(nbx) - 1.0));
  let by = u32(clamp(floor(fy / bt), 0.0, f32(nby) - 1.0));
  let b = by * nbx + bx;
  let start = roadFeat[offBase + b];
  let end   = roadFeat[offBase + b + 1u];
  for (var p = start; p < end; p = p + 1u) {
    let o = segBase + roadFeat[refBase + p] * 8u;
    let ax = rfF(o); let ay = rfF(o + 1u);
    let bx2 = rfF(o + 2u); let by2 = rfF(o + 3u);
    let dx = bx2 - ax; let dy = by2 - ay;
    let len2 = dx * dx + dy * dy;
    var t = 0.0;
    if (len2 > 0.0) { t = clamp(((fx - ax) * dx + (fy - ay) * dy) / len2, 0.0, 1.0); }
    let cx = ax + t * dx; let cy = ay + t * dy;
    let d = length(vec2<f32>(fx - cx, fy - cy));
    let half = mix(rfF(o + 4u), rfF(o + 5u), t);
    let paved = mix(rfF(o + 6u), rfF(o + 7u), t);
    out.verge = min(out.verge, d - half);
    if (d <= half + 0.5) { out.near = max(out.near, paved); }
    if (d <= half) {
      let core = half * 0.7;
      let fade = select((half - d) / max(half - core, 1e-4), 1.0, d <= core);
      out.paved = max(out.paved, paved * fade);
      // Lateral coordinate = MIN distance over covering segments — the distance to the
      // polyline as a whole. Taking it from the pavedness winner instead (first-covering
      // segment on ties) read the RADIAL cap distance near every joint, and the rut band
      // traced a chain of rings down the road (arcs of radius rutOff around each vertex).
      if (d < out.d) { out.d = d; out.half = half; }
      out.edge = max(out.edge, half - d);   // distance inside this segment's boundary
    }
  }
  return out;
}

// Value noise for jittering material thresholds so edges wander (kills the flat
// contour rings / square biome borders that betray procedural terrain). Now a single
// baked-atlas tap (explicit LOD so callers may sit in non-uniform flow); same [0,1]
// range and lattice frequency as the old in-shader hash21+sin version — the wander
// is a different (but statistically identical) realization.
fn vnoise(p : vec2<f32>) -> f32 {
  return textureSampleLevel(noiseTex, noiseSmp, p * NOISE_INV_TILE, 0.0).r;
}

// ── Analytic road materials (Step 2) ─────────────────────────────────────────
// Cobble + gravel are evaluated PER-PIXEL in continuous world space instead of
// sampling a baked 64px swatch — so the feature size is set directly in world
// units (no fixed-px resolution ceiling, no tiling seam ever) and the high-freq
// detail BAND-LIMITS against the pixel footprint (fwTiles) so it fades to a
// flat tone as you zoom out instead of shimmering ("octaves read as faceting").
// An integer bit-hash (not a sin-based lattice hash) keeps the cell field artefact-free
// at the large coordinates these sub-tile cell grids reach.
fn hashI(p : vec2<i32>) -> f32 {
  var n = (u32(p.x) * 1597334677u) ^ (u32(p.y) * 3812015801u);
  n = (n ^ (n >> 16u)) * 2246822519u;
  n = n ^ (n >> 13u);
  return f32(n & 0xffffffu) / f32(0xffffff);
}
// Voronoi over a unit cell grid. Returns .x = F1 (nearest centre dist), .y = its
// hash, .z = F2−F1 (edge proximity — the polygonal seam / grout). 3×3 search.
fn vorCell(uv : vec2<f32>, jitter : f32) -> vec3<f32> {
  let ip = floor(uv);
  let fp = uv - ip;
  var f1 = 8.0; var f2 = 8.0; var hbest = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let g = vec2<f32>(f32(ox), f32(oy));
      let id = vec2<i32>(ip) + vec2<i32>(ox, oy);
      let hx = hashI(id);
      let hy = hashI(id + vec2<i32>(7, 3));
      let centre = g + vec2<f32>(0.5, 0.5) + (vec2<f32>(hx, hy) - 0.5) * jitter;
      let d = length(centre - fp);
      if (d < f1) { f2 = f1; f1 = d; hbest = hx; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3<f32>(f1, hbest, f2 - f1);
}
// Footprint→detail fade: 1 when a cell spans many px, →0 once a cell shrinks
// below the pixel footprint (IQ band-limiting).
fn detailLod(cellFw : f32) -> f32 { return clamp(smoothstep(1.1, 0.55, cellFw), 0.0, 1.0); }

// Cobbled carriageway. uvTiles = world position in tiles, fwTiles = its pixel
// footprint (both passed in so no derivative builtin runs in non-uniform flow).
fn analyticCobble(uvTiles : vec2<f32>, fwTiles : vec2<f32>) -> vec3<f32> {
  let settTiles = 0.15;                       // 0.30 m setts / 2 m-per-tile
  let uv = uvTiles / settTiles;
  let cellFw = max(fwTiles.x, fwTiles.y) / settTiles;
  let v = vorCell(uv, 0.7);
  let lod = detailLod(cellFw);
  // Grout = F2−F1 seam, kept ~constant screen width and AA'd; fades out (lod) when
  // a sett drops below a pixel so it averages to stone instead of aliasing.
  let groutW = 0.07;
  let aa = max(cellFw, 1e-4);
  let grout = (1.0 - smoothstep(groutW - aa, groutW + aa, v.z)) * lod;
  let dome = (1.0 - smoothstep(0.0, 0.5, v.x)) * lod;     // brighter sett crown
  let tone = 0.50 + 0.13 * v.y;
  let stone = tone * (0.85 + 0.15 * dome);
  let lit = mix(stone, 0.22, grout);                      // grout darkens
  return vec3<f32>(lit, lit * 0.98, lit * 0.94);
}
// Loose gravel — small jittered chips, no mortar; chips fade to packed tone at range.
fn analyticGravel(uvTiles : vec2<f32>, fwTiles : vec2<f32>) -> vec3<f32> {
  let chipTiles = 0.05;                        // 0.10 m chips
  let uv = uvTiles / chipTiles;
  let cellFw = max(fwTiles.x, fwTiles.y) / chipTiles;
  let v = vorCell(uv, 0.9);
  let lod = detailLod(cellFw);
  let t = min(1.0, v.x / 0.5);
  let dome = sqrt(max(0.0, 1.0 - t * t)) * lod;
  let tone = 0.42 + 0.16 * v.y;
  let val = tone * (0.7 + 0.3 * dome);
  return vec3<f32>(val, val * 0.95, val * 0.86);
}
// Scattered pebble STONES on open ground — analytic like the road gravel, because a
// baked swatch cannot survive gameplay-zoom minification (at 1:1 the pebble layer sits
// ~4 mips deep and every stone averages into speckle — the "very blended" read).
// Each Voronoi cell carries a stone only where its hash clears the density gate, so
// coverage is per-stone: a distinct AA'd dome with its own size, grey tone and warm/cool
// cast, and the living ground completely untouched between stones. Returns rgb + coverage.
fn analyticPebbles(uvTiles : vec2<f32>, fwTiles : vec2<f32>, density : f32) -> vec4<f32> {
  let stoneTiles = 0.14;                       // ~0.28 m cells → fist-to-cobble stones
  let uv = uvTiles / stoneTiles;
  let cellFw = max(fwTiles.x, fwTiles.y) / stoneTiles;
  let v = vorCell(uv, 0.9);
  let lod = detailLod(cellFw);
  let has = step(1.0 - density, v.y);          // sparse: only some cells grow a stone
  let r = 0.20 + 0.22 * fract(v.y * 7.31);     // per-stone size (small pebble → cobble)
  let aa = max(cellFw, 0.07);
  let body = 1.0 - smoothstep(r - aa, r + aa, v.x);
  let t = min(1.0, v.x / max(r, 1e-3));
  let dome = sqrt(max(0.0, 1.0 - t * t));      // rounded top-lit crown
  let tone = (0.40 + 0.24 * fract(v.y * 5.17)) * (0.68 + 0.32 * dome);
  let warm = fract(v.y * 3.77);                // per-stone warm/cool mineral cast
  let rgb = vec3<f32>(tone * mix(0.94, 1.05, warm), tone, tone * mix(1.08, 0.90, warm));
  return vec4<f32>(rgb, body * has * lod);
}
// Stratified cliff face. The old version was uniform ~1 m Voronoi facets, which on a
// big face read as flat grey mush (user report: the rocky-cliff texture is not great).
// Three world-scaled, band-limited ingredients now compose the face:
//  1. BEDDING: tonal strata keyed on ABSOLUTE elevation (metres), noise-warped so the
//     beds undulate along the landform's contours like real sedimentary layering —
//     soft dark partings between beds, and a per-bed tone + warm/cool sway so
//     neighbouring beds actually separate. Fades out when a bed goes sub-pixel.
//  2. JOINTING: the Voronoi facets stay, enlarged to ~1.6 m blocks with crevice
//     seams — the vertical fracture that breaks the bedding into a face. Each block
//     also shifts the bed phase slightly (v.y), so strata step at joints (faulting).
//  3. GRAIN: the fine surface noise, unchanged.
fn analyticRock(uvTiles : vec2<f32>, fwTiles : vec2<f32>) -> vec3<f32> {
  let facetTiles = 0.8;                        // ~1.6 m jointing blocks / 2 m-per-tile
  let uv = uvTiles / facetTiles;
  let cellFw = max(fwTiles.x, fwTiles.y) / facetTiles;
  let v = vorCell(uv, 0.8);
  let lod = detailLod(cellFw);
  let grain = (vnoise(uvTiles * 3.2) - 0.5) * lod;          // fine surface grain (~0.31 m)
  let aa = max(cellFw, 1e-4);
  // Facet crevices (F2−F1 edge). Softened three ways so they read as hairline
  // cracks in stone rather than a scale net: darkness eased below, faded with the
  // same detail LOD as the grain (a far face falls back to tone variation, never
  // the web), and modulated per-cell so only some joints are open at all.
  let seamOpen = 0.35 + 0.65 * vnoise(floor(uv) * 0.71 + vec2<f32>(3.1, 17.9));
  let seam = (1.0 - smoothstep(0.05, 0.05 + aa, v.z)) * lod * seamOpen;

  // Bedding coordinate: metres of elevation, warped low-frequency, block-faulted.
  let elevM = (heightAtF(uvTiles.x, uvTiles.y) - G.uZParams.y) * G.uZParams.z;
  let warp = (vnoise(uvTiles * 0.35 + vec2<f32>(13.7, 71.3)) - 0.5) * 1.6;
  let bedsPerM = 1.1;
  let bandC = elevM * bedsPerM + warp + v.y * 0.35;
  let bandI = floor(bandC);
  let bandT = fract(bandC);
  // Band-limit: beds are only visible on faces, where elevation climbs ~2 m per
  // tile — approximate the bed-space footprint from that and fade before shimmer.
  let bandFw = max(fwTiles.x, fwTiles.y) * 2.0 * bedsPerM;
  let bedLod = (1.0 - smoothstep(0.25, 0.7, bandFw)) * lod;
  let bedR = vnoise(vec2<f32>(bandI * 0.37 + 4.2, 7.7));    // per-bed random, stable along the bed
  let parting = smoothstep(0.0, 0.18, min(bandT, 1.0 - bandT));
  let bedTone = mix(1.0, 0.74 + 0.40 * bedR, bedLod);       // thick lit beds vs recessive ones
  let bedSeam = mix(1.0, mix(0.60, 1.0, parting), bedLod);  // soft dark parting seam

  let tone = (0.46 + 0.10 * v.y + 0.09 * grain) * bedTone * bedSeam;
  let shade = mix(1.0, 0.68, seam);
  let lit = tone * shade;
  // Warm sediment vs cool grey sway per bed, so a face is not one monotone grey.
  let wc = (vnoise(vec2<f32>(bandI * 0.61 + 9.1, 3.3)) * 2.0 - 1.0) * bedLod;
  return vec3<f32>(lit * (1.05 + 0.06 * wc), lit, lit * (0.93 - 0.05 * wc));
}

// Hypsometric tint ramp: lowland green → tan → brown → snow, keyed by the
// above-sea elevation fraction t∈[0,1]. Used by the 'hypsometric' display mode
// and as the base fill for the 'contour' (vector topo) mode.
fn hypsoRamp(t : f32) -> vec3<f32> {
  let c0 = vec3<f32>(0.36, 0.52, 0.30); // lowland green
  let c1 = vec3<f32>(0.78, 0.74, 0.45); // dry tan
  let c2 = vec3<f32>(0.52, 0.39, 0.27); // upland brown
  let c3 = vec3<f32>(0.95, 0.96, 0.98); // snow cap
  let u = clamp(t, 0.0, 1.0);
  if (u < 0.34) { return mix(c0, c1, u / 0.34); }
  if (u < 0.67) { return mix(c1, c2, (u - 0.34) / 0.33); }
  return mix(c2, c3, (u - 0.67) / 0.33);
}

// Screen-px lift of a cell from its normalised elevation.
fn heightPx(cx : u32, cy : u32) -> f32 {
  let e = heights[cellIdx(cx, cy)];
  return (e - G.uZParams.y) * G.uZParams.z * G.uZParams.x;
}

// Bilinear elevation at a CONTINUOUS tile coord — the vertex-stage sampler for
// sub-tile mesh subdivision. At integer coords it returns the exact cell height,
// so the supersample=1 path stays byte-identical to the per-cell heightPx.
fn heightAtF(fx : f32, fy : f32) -> f32 {
  let W = u32(G.uGrid.x); let H = u32(G.uGrid.y);
  let px = clamp(fx, 0.0, f32(W - 1u));
  let py = clamp(fy, 0.0, f32(H - 1u));
  let x0 = u32(floor(px)); let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, W - 1u); let y1 = min(y0 + 1u, H - 1u);
  let tx = px - f32(x0); let ty = py - f32(y0);
  let h00 = heights[y0 * W + x0]; let h10 = heights[y0 * W + x1];
  let h01 = heights[y1 * W + x0]; let h11 = heights[y1 * W + x1];
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), ty);
}
fn heightPxF(fx : f32, fy : f32) -> f32 {
  return (heightAtF(fx, fy) - G.uZParams.y) * G.uZParams.z * G.uZParams.x;
}

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vNormal : vec3<f32>,
  @location(1) vGrid   : vec2<f32>,
  // Local mesh spacing in TILES per quad edge — set by whichever pass drew this
  // vertex (coarse terrain: sub/sup; a detail patch: 1/SUPER). The wireframe mode
  // reads it so each pass's lines trace ITS real triangulation, so a refined
  // detail region shows its higher resolution rather than the coarse spacing.
  @location(2) vStep   : f32,
};

@vertex
fn vsMain(@builtin(vertex_index) vid : u32) -> VSOut {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  let sub = max(1u, u32(G.uZParams.w));   // coarsen LOD (auto, big maps)
  let sup = max(1u, u32(G.uMode.y));      // subdivide (manual; 1 = one quad/tile)
  // VIEWPORT CULL (T5): the mesh spans only the visible tile window (origin + span,
  // both snapped to the sub lattice CPU-side so the sampled cells are unchanged).
  // Default window [0,0,W,H] => ox0=0, spanW=W => byte-identical to the un-culled mesh.
  let ox0 = u32(G.uWindow.x);
  let oy0 = u32(G.uWindow.y);
  let spanW = max(1u, u32(G.uWindow.z));
  let quadsPerRow = max(1u, (spanW / sub) * sup);

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
  // CONTINUOUS tile coordinate. Each quad edge spans sub/sup tiles, so sup>1
  // subdivides each tile into a finer lattice; sampled bilinearly off the per-cell
  // height buffer. At sup=1 the coords are integers and heightPxF is exact, so the
  // mesh is byte-identical to the per-cell path.
  let stepT = f32(sub) / f32(sup);
  let fx = min(f32(ox0) + (f32(qx) + f32(corner.x)) * stepT, f32(W - 1u));
  let fy = min(f32(oy0) + (f32(qy) + f32(corner.y)) * stepT, f32(H - 1u));

  let hPx = heightPxF(fx, fy);

  // Normal from neighbour heights (central differences); tile space x=east,
  // y=up, z=south. Flat ground gives (0,1,0). Both terms sample at a FIXED
  // ±1-tile spacing regardless of LOD, so the normal — and every material
  // threshold derived from it (rock/snow smoothsteps) — is a pure function of
  // world position. Scaling the up-term by \`sub\` flattened normals at coarse
  // LODs and made snow coverage blink across zoom levels.
  var normal = vec3<f32>(0.0, 1.0, 0.0);
  if (fx > 0.5 && fx < f32(W - 1u) - 0.5 && fy > 0.5 && fy < f32(H - 1u) - 0.5) {
    let hl = heightPxF(fx - 1.0, fy);
    let hr = heightPxF(fx + 1.0, fy);
    let hu = heightPxF(fx, fy - 1.0);
    let hd = heightPxF(fx, fy + 1.0);
    normal = normalize(vec3<f32>(-(hr - hl) * 0.5, G.uHalf.y, -(hd - hu) * 0.5));
  }

  // Screen-space iso projection (matches worldToScreen); height lifts -y.
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
  out.vStep = stepT;          // coarse-terrain quad spacing (tiles per edge)
  return out;
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);
  // Bilinear sample EVERY per-cell field at the continuous fragment position, so
  // the biome colour + material bands cross-fade smoothly instead of snapping to
  // iso-diamond cell borders. ci (nearest) is kept only for the seabed cull.
  let bc = biCell(in.vGrid.x, in.vGrid.y);
  let cx = bc.x0;
  let cy = bc.y0;
  let ci = cellIdx(cx, cy);
  let biome = sampleColorBi(bc);                 // biome albedo (the "ground" layer)

  let n = normalize(in.vNormal);
  let slope = clamp(1.0 - n.y, 0.0, 1.0);        // 0 flat → 1 vertical, free from normal

  // Shared-field reads: the material axis is computed downstream of the producers
  // (mountains/roads only wrote HEIGHT) so texturing stays consistent with biome.
  let elev = sampleScalarBi(bc, &heights);
  let seaLevel = G.uZParams.y;
  let aboveSea = elev - seaLevel;

  // DEEP-SEABED CULL: where the bed is well below the waterline the water pass is
  // already fully opaque-deep over it, so the seabed is invisible anyway — but its
  // sunk geometry would poke out below the flat sea sheet on the camera-facing map
  // edges as a hard rim. Discard it: the uniform infinite-ocean backdrop + water
  // surface fill that screen area instead, so the bottom map edges fully vanish.
  if (seaLevel - elev > 0.10) { discard; }
  // Climate fields BILINEAR like every other per-cell field — these were the last
  // nearest-cell reads, and every weight keyed on them (snow, mud, desert, forest
  // floor, beach character) stepped at tile borders: the snowline rendered the
  // tile grid ("you can clearly see the terrain tiles in the blend").
  let moist = sampleScalarBi(bc, &moisture);
  let temp = sampleScalarBi(bc, &temperature);
  let jit = vnoise(in.vGrid * 0.35) - 0.5;       // [-0.5,0.5] threshold wander

  // Absolute elevation in METRES above sea — hoisted here (was only computed later,
  // by the snow-altitude weight) so the ground splat below can use it too: a real
  // physical quantity, not the [0,1] relief fraction, so it means the same thing at
  // any world relief setting (a low-relief world never reads as "upland" from the
  // fraction alone).
  let metresAS = aboveSea * G.uZParams.z;

  // ── ARIDITY: the coherent macro driver the dry/dust splat below is retethered to.
  // Real landform signals — NOT a free-floating noise field — decide where ground
  // reads dry: climate dryness (moisture), CONVEX/STEEP ground shedding water
  // (slopeDry), and dry rocky UPLANDS (elevDry). Both new terms fade in well below
  // where the rock/scree bands themselves kick in (wRock/wScree start at slope 0.30;
  // wSnowAlt's altitude cap starts at 22.5 m) — so this is a genuinely different,
  // EARLIER band: the drying shoulder before the scree, the parched plateau before
  // the peak. Noise (bareField/jit, below) only breaks up this field's edges now —
  // it no longer manufactures dry blotches out of nothing on lush, flat, wet ground.
  let dry       = 1.0 - moist;
  let slopeDry  = smoothstep(0.06, 0.26, slope);
  let elevDry   = smoothstep(9.0, 27.0, metresAS);
  let aridity   = clamp(dry * 0.62 + slopeDry * 0.22 + elevDry * 0.22, 0.0, 1.0);

  // ── Road surface as a CONTEXT BLEND of the ground layer ──────────────────────
  // The carved carriageway replaces grass with its material albedo (packed earth →
  // cobble), ramped by pavedness. This is folded into the GROUND layer BEFORE the
  // material composite, so snow/mud/wet/rock still poke through by their own weights
  // — a snowy road, a muddy track — with no road-specific branch. Where a road is
  // overgrown, feature-geometry.ts already fades the pavedness, so the biome grass
  // returns and the wilderness reclaims it (the first instance of the engine-wide
  // object↔terrain contextual blend).
  // Tile-space UV for the material exemplars (REPEAT sampler tiles them seamlessly).
  let muv = in.vGrid / MAT_TILES;
  // Tile-space pixel footprint, taken ONCE in uniform control flow so the analytic
  // road materials can band-limit (and be guarded by a branch) without a derivative
  // builtin running in non-uniform flow.
  //
  // PX-INVARIANCE: fwidth() is measured in the low-res backing target, so its raw
  // value is proportional to S/(z*dpr) — it carries the dynamic-resolution px factor,
  // not just camera zoom. Divide by uFlags.y (pxScale ~= S/dpr ~= px) so the footprint
  // depends on camera zoom z ALONE: a world tile always spans z*ISO_TILE_W CSS px
  // regardless of which px tier is rendering it. Every downstream consumer (fwG,
  // fwTexels, groundPatch's mip/lod0, texFade, detailLod, and the analytic AA terms
  // in analyticCobble/Gravel/Pebbles/Rock) derives from this one value, so normalizing
  // here makes px1..px4 select the same mip / same fade / same detail at a fixed
  // camera — while a genuine camera zoom-out still recedes detail, since z still varies.
  let fwTiles = fwidth(in.vGrid) / max(G.uFlags.y, 1e-4);
  // Shared domain-warp + footprint fade for ALL ground-patch texturing (open-ground splat,
  // beaches, snow, seabed). Hoisted to uniform flow so fwidth is taken once and every
  // downstream ground-patch sample uses explicit-LOD (legal in the non-uniform texFade branch
  // and reusable in the submarine section below). texFade decays every patch to the flat biome
  // colour as a texel shrinks past the pixel footprint (no fizz + the px1 overview perf guard).
  let gwarp = (vnoise(in.vGrid * 0.045 + vec2<f32>(3.0, 9.0)) - 0.5) * 0.18;
  let fwG = max(fwTiles.x, fwTiles.y);   // grid-space footprint for groundPatch mip selection
  let fwTexels = max(fwTiles.x, fwTiles.y) / MAT_TILES * f32(textureDimensions(matAtlas).x);
  let texFade = smoothstep(4.0, 1.0, fwTexels);

  let rInfo = roadInfo(in.vGrid.x, in.vGrid.y);
  let road = rInfo.paved;           // pavedness (dirt 0.2 · gravel 0.45 · cobble 0.75 · paved 1.0)
  let roadEdgeDepth = rInfo.edge;   // tiles inside the road's outer boundary
  // Road-vs-land blend. The blend STRENGTH scales with pavedness: a dirt track blends
  // ~0.45 of its packed-earth swatch (grass shows through, a packed-earth desire path),
  // gravel rises, cobble/paved go fully opaque. A narrow edge smoothstep keeps the
  // sub-tile boundary soft for every tier — and the boundary itself is RAGGED now: a
  // low-frequency wobble shifts where the feather crosses zero, so a track's edge
  // wanders in and out of the grass instead of tracing the SDF's clean parallel line
  // (nothing in nature draws an offset curve). Gated on road presence so off-road
  // fragments can't wobble INTO phantom pavedness.
  let edgeWob = (vnoise(in.vGrid * 1.9 + vec2<f32>(41.0, 7.0)) - 0.5) * step(0.001, road);
  let roadMix = smoothstep(0.0, 0.08, road + edgeWob * 0.07)
              * mix(0.45, 1.0, smoothstep(0.20, 0.75, road));
  // Packed DIRT stays a baked low-relief swatch (layer 6), sampled here in UNIFORM
  // control flow (implicit-derivative texture LOD); the road albedo itself is built
  // AFTER the ground splat below, so the crown strip can reclaim the living grass.
  let dirtA = matSample(6, muv);
  // ── Per-biome COLOUR ground texture (Slice 2 of the material-exemplar epic) ──
  // Open ground samples the exemplar atlas as full COLOUR: climate picks the ground
  // CHARACTER (whose grain — grass on moist temperate ground, dirt as it dries, sand
  // in hot drylands; snow/mud/rock still overlay via their own weights below), while
  // the BIOME COLOUR FIELD STAYS THE HUE AUTHORITY — each swatch is normalised by its
  // own mean (matDetail), so what multiplies the biome colour is only the swatch's
  // LOCAL deviation with mean ≈ 1: a green field stays exactly as green on average.
  // Band-limited: texFade decays the texture to today's flat biome colour as a texel
  // shrinks past the pixel footprint (mips keep the in-between alias-free), and the
  // whole block is SKIPPED at overview (explicit-LOD samples make the non-uniform
  // branch legal) so the fill-bound px1 path pays ~nothing. Uniform-flag branch:
  // \`?groundtex=off\` (uFlags.x = 0) restores the pre-Slice-2 grayscale grain for A/B.
  var ground = biome;
  if (G.uFlags.x > 0.5) {
    if (texFade > 0.0) {
      // GROUND-PATCH SPLAT under the billboards: four real harvested swatches — lush grass,
      // dry parched grass, bare dust, pebble gravel — blended terrain-AWARE, retethered to
      // the ARIDITY driver above (climate + slope + elevation) rather than a free-floating
      // noise field. Wet/vegetated/hollow → lush grass; drying shoulder → parched grass;
      // driest & steepest/highest → bare dust; worn clumps → pebbles speckled over. The
      // earthy patches keep their REAL colour so drying ground genuinely turns dusty/pebbly,
      // not a tint of the green.
      let gvar  = vnoise(in.vGrid * 0.09 + vec2<f32>(5.0, 2.0));
      // bareField is now a PATCHINESS modulator, not an independent driver: its
      // contribution SCALES WITH aridity (patchy below), so it can only redistribute
      // dry mass that the landform already put there — it can no longer conjure a
      // bare patch out of nothing on lush, flat, wet ground (the old blotchy read).
      let bareField = vnoise(in.vGrid * 0.06 + vec2<f32>(17.0, 4.0));
      // MACRO SWARD DRIFT: a ~45-tile field sweeping the meadow through deep cool
      // green, fresh mid-green and warm straw — the large-scale tonal patchiness a
      // real sward has (grazing, soil, drainage) and the single biggest thing that
      // separates a painted meadow from a flat green fill. It also nudges the
      // parched-grass threshold so the straw drifts genuinely DRY at their hearts.
      let sward = vnoise(in.vGrid * 0.022 + vec2<f32>(9.0, 23.0));
      let patchy = bareField * (0.20 + 0.60 * aridity);

      // Splat weights (jittered thresholds so borders wander off the tile grid). Mirrored
      // EXACTLY (this wDust formula only) by the CPU dust01() in render/dust-mask.ts, which
      // vegetation placement gates against — keep the two in lockstep.
      let wDust  = smoothstep(0.48, 0.82, aridity * 0.62 + patchy + jit * 0.14);       // bare earth
      let wDry   = smoothstep(0.30, 0.62, aridity + jit * 0.12 + (sward - 0.5) * 0.20) * (1.0 - wDust);  // parched grass
      let wGrass = max(1.0 - wDust - wDry, 0.0);                                     // lush default

      // Lush grass: mean-normalised so the BIOME stays the hue authority; a patchy olive↔fresh
      // tint (gvar, fine) times the macro drift palette (sward, broad) gives the many-greens
      // meadow. Dust/dry keep their own real earthy colour.
      let swardTint = select(
        mix(vec3<f32>(0.82, 0.98, 0.86), vec3<f32>(1.0, 1.0, 1.0), sward * 2.0),
        mix(vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(1.16, 1.08, 0.80), sward * 2.0 - 1.0),
        sward >= 0.5);
      let gTint    = mix(vec3<f32>(0.90, 1.04, 0.86), vec3<f32>(1.06, 1.0, 0.90), gvar) * swardTint;
      let grassRaw = groundPatch(GROUND_LAYER_GRASS, in.vGrid, fwG, gwarp, 0.28 + 0.16 * gvar);
      let grassCol = biome * clamp(grassRaw / GROUND_GRASS_MEAN, vec3<f32>(0.55), vec3<f32>(1.7)) * gTint;
      let dryCol   = groundPatch(GROUND_LAYER_DRY,  in.vGrid, fwG, gwarp, 0.22);
      let dustCol  = groundPatch(GROUND_LAYER_DUST, in.vGrid, fwG, gwarp * 0.7, 0.20);
      var gnd = grassCol * wGrass + dryCol * wDry + dustCol * wDust;

      // PATH VERGE: a road sheds worn ground into the grass beside it — pebbly dust
      // spilling ~a third of a tile past the ribbon's edge, strongest right at the
      // boundary and on better-built (higher-tier) roads. rInfo.verge is the analytic
      // distance OUTSIDE the carriageway (negative inside, so the spill also dresses
      // the ground showing through a semi-transparent dirt track); rInfo.near gates by
      // tier even where the faded pavedness is already zero. This is what makes a path
      // read as a TRAVELLED thing at 1:1 — margins of kicked gravel, not a clean stripe.
      let vergeW = smoothstep(0.35, 0.02, max(rInfo.verge, 0.0))
                 * smoothstep(0.10, 0.40, rInfo.near);
      // The verge BED stays the harvested swatch (a dusty-gravel tint under the stones)…
      if (vergeW > 0.0) {
        let pebRaw = groundPatch(GROUND_LAYER_PEBBLE, in.vGrid * 1.8, fwG * 1.8, gwarp, 0.15);
        gnd = mix(gnd, mix(dustCol, pebRaw, 0.45), vergeW * 0.55);
      }
      // …but the STONES themselves are analytic Voronoi domes (the swatch mip-crushed to
      // translucent speckle at gameplay zoom). Clump field drives stone DENSITY, denser on
      // dry/worn ground and on verges; coverage is per-stone and opaque, so pebbles read as
      // individual rocks with living ground between them. Faded before overview (sub-pixel).
      let pebClump = smoothstep(0.38, 0.72, vnoise(in.vGrid * 0.5 + vec2<f32>(21.0, 8.0)));
      let pebDen = clamp(pebClump * (0.14 + 0.60 * dry) + 0.85 * vergeW, 0.0, 0.9)
                 * smoothstep(0.45, 0.20, fwG);
      if (pebDen > 0.01) {
        let peb = analyticPebbles(in.vGrid, fwTiles, pebDen);
        gnd = mix(gnd, peb.rgb, peb.a);
      }

      // DESERT: hot + genuinely arid ground → warm wind-rippled dune sand, with cracked hardpan
      // (dry clay playa) showing through the bare-field flats. Keyed on the climate fields (no
      // biome id needed) — matches classifyBiome's Desert cell (hot, dry).
      let hot     = smoothstep(0.60, 0.80, temp);
      let arid    = smoothstep(0.70, 0.92, dry);
      let desertW = hot * arid;
      let duneCol = groundPatch(GROUND_LAYER_DUNE,    in.vGrid,       fwG, gwarp, 0.20);
      let hardCol = groundPatch(GROUND_LAYER_HARDPAN, in.vGrid * 1.2, fwG * 1.2, gwarp, 0.16);
      let desertCol = mix(duneCol, hardCol, smoothstep(0.52, 0.80, bareField) * 0.75);
      gnd = mix(gnd, desertCol, desertW);

      // FOREST FLOOR: cool-to-temperate, WET, gentle ground → leaf-litter/moss over dark humus.
      // Gated ABOVE the grass moisture zone, away from hot climates and steep faces, so open
      // meadow (moderate moisture) stays green — this only dresses genuinely damp woodland ground.
      let forestW = smoothstep(0.66, 0.86, moist)
                  * smoothstep(0.62, 0.42, temp)
                  * (1.0 - smoothstep(0.20, 0.42, slope))
                  * smoothstep(0.02, 0.10, aboveSea)
                  * (1.0 - desertW);
      let litterCol = groundPatch(GROUND_LAYER_LITTER, in.vGrid * 1.3, fwG * 1.3, gwarp, 0.24);
      gnd = mix(gnd, litterCol, clamp(forestW, 0.0, 0.85));

      ground = mix(biome, gnd, texFade);
    }
  } else {
    // Pre-Slice-2 look: grass exemplar's grayscale detail (luminance / mean) only.
    let groundDetail = clamp(dot(matSample(0, muv), vec3<f32>(0.3333)) / 0.5, 0.72, 1.28);
    ground = biome * groundDetail;
  }

  // ── Road surface albedo (the PATH BIOME) ─────────────────────────────────────
  // The full packed-dirt → gravel → cobble spectrum driven by pavedness (tier
  // anchors dirt 0.2 · gravel 0.45 · cobble 0.75, dimmed by condition·overgrowth —
  // a worn road drifts down the ladder on its own). GRAVEL and COBBLE are analytic
  // (per-pixel, world-scaled, band-limited); the Voronoi cost is gated behind road
  // presence. On top of the surface, three marks of actual TRAVEL:
  //  · WHEEL RUTS — two darker compacted bands at cart gauge (~1.44 m), straight
  //    where the road runs but wobbling a hand-width like real ruts, fading out on
  //    engineered cobble and at overview zoom.
  //  · CROWN STRIP — between the ruts on dirt/gravel tiers the living grass splat
  //    survives as a tufty central ridge (wagons kill the wheel lines, hooves thin
  //    the middle, grass keeps the crown) — THE two-track country lane read.
  //  · KERB — the crisp colour-defined edge line, now only on engineered tiers
  //    (gravel and up); a dirt track keeps its ragged organic boundary instead.
  var roadAlb = dirtA;
  if (roadMix > 0.0) {
    let gravelA = analyticGravel(in.vGrid, fwTiles);
    let cobbleA = analyticCobble(in.vGrid, fwTiles);
    let upper = road >= 0.45;                      // above the gravel anchor?
    roadAlb = select(
      mix(dirtA,   gravelA, smoothstep(0.20, 0.45, road)),   // dirt → gravel
      mix(gravelA, cobbleA, smoothstep(0.45, 0.78, road)),   // gravel → cobble
      upper);
    // Lateral coordinate with a light wander so the ruts are not laser-parallel.
    let dJit = rInfo.d + (vnoise(in.vGrid * 1.3 + vec2<f32>(57.0, 13.0)) - 0.5) * 0.05;
    let gaugeFade = smoothstep(0.30, 0.14, fwG);   // gameplay zooms only (sub-px at overview)
    let rutOff = min(0.36, rInfo.half * 0.62);     // half-gauge, squeezed on narrow tracks
    let rutAA = max(0.055, fwG * 1.6);
    let rutMask = (1.0 - smoothstep(0.045, 0.045 + rutAA, abs(dJit - rutOff)))
                * (1.0 - smoothstep(0.55, 0.78, road))        // cobble loses its ruts
                * step(0.24, rInfo.half) * gaugeFade;
    roadAlb = roadAlb * mix(vec3<f32>(1.0), vec3<f32>(0.78, 0.74, 0.70), rutMask);
    let crownMask = (1.0 - smoothstep(rutOff * 0.20, rutOff * 0.55, dJit))
                  * (1.0 - smoothstep(0.26, 0.48, road))      // dirt tier only
                  * step(0.24, rInfo.half) * gaugeFade;
    roadAlb = mix(roadAlb, ground * vec3<f32>(0.94, 1.02, 0.90), crownMask * 0.62);
    let edgeAA = max(max(fwTiles.x, fwTiles.y), 1e-4);
    let edgeLine = (1.0 - smoothstep(0.0, edgeAA, roadEdgeDepth))
                 * smoothstep(0.28, 0.50, road);
    roadAlb = roadAlb * mix(1.0, 0.85, edgeLine);
  }
  let base = mix(ground, roadAlb, roadMix);

  // Material WEIGHTS — each becomes a height-blend layer below.
  let wRock = smoothstep(0.42, 0.78, slope + jit * 0.18);                 // steep faces
  // Scree apron: loose weathered gravel in the band BETWEEN sward and cliff paint —
  // the transition ring under every rock face, so vegetation does not butt straight
  // against painted stone. Hands over to rock as wRock saturates (the 1-wRock term);
  // never a standalone field on gentle ground (band starts above the cover slopes).
  // The band ITSELF now shares the ARIDITY driver: a dry, upland shoulder sheds scree
  // at gentler slopes than a lush lowland does (a real dry plateau/alpine tableland
  // gravels over well short of a true cliff) — ties the loose-stone apron to the SAME
  // climate+slope+elevation story as the dust/dry ground splat above, instead of scree
  // being a pure-geometry band indifferent to what kind of country it's in.
  let screeLo = mix(0.30, 0.16, aridity);
  let screeHi = mix(0.48, 0.34, aridity);
  let wScree = smoothstep(screeLo, screeHi, slope + jit * 0.18) * (1.0 - wRock);
  // Snow: cold ground (latitude/lapse) OR a permanent high-altitude cap. The
  // elevation snowline gives every great peak a white crown regardless of climate
  // (aboveSea ≈ 0.47 ≈ elev 0.82 = upper mountain, full by ≈ 0.58 = the summit);
  // both settle on flatter ground so steep faces stay bare rock.
  let wSnowCold = smoothstep(0.30, 0.16, temp + jit * 0.06);
  // The altitude cap only forms where the high ground is also COOL: a great peak in a
  // cold/temperate latitude crowns white, but a hot-country summit (a desert cinder
  // cone, altitude-cooled to ~0.44 yet far from polar) stays bare. Without this gate
  // the snowline dusted the volcano and read as an alpine mountain dropped on the desert.
  // Keyed on ABSOLUTE metres above sea (aboveSea·reliefM), NOT the [0,1] fraction — so a
  // low-relief world never snow-caps a 7 m bump (the fraction crossed the line; metres don't).
  // Calibrated to the old fraction at default relief 48 m (0.47→22.6 m, 0.58→27.8 m).
  // (metresAS is hoisted above, alongside aridity — the same physical quantity the
  // ground splat's elevDry term reads, so a hot-country summit that stays snow-free via
  // wSnowCold/wSnowAlt's temperature gate still reads dry/rocky via aridity instead of
  // flat green — no more bare green volcano tips.)
  let wSnowAlt  = smoothstep(22.5, 28.0, metresAS + jit * 1.5)
                * smoothstep(0.45, 0.33, temp + jit * 0.04);
  let wSnow = max(wSnowCold, wSnowAlt) * smoothstep(0.42, 0.70, n.y);
  let sandBand = 0.05 + jit * 0.015;
  let wSand = step(0.0, aboveSea) * (1.0 - smoothstep(0.0, sandBand, aboveSea)); // shore band
  let wMud  = smoothstep(0.62, 0.92, moist)                              // wet low gentle ground
            * (1.0 - smoothstep(0.18, 0.40, slope))
            * (1.0 - smoothstep(0.06, 0.22, aboveSea));

  // Material albedos = sampled exemplar swatches (Slice 1). The img2img pipeline upgrades
  // these same tiles later; today they're the procedural grey-init. Layer indices match
  // MATERIAL_LAYER (snow4 sand3 mud5). ROCK is now ANALYTIC (per-pixel, world-scaled,
  // band-limited — analyticRock above), gated behind its weight so the Voronoi only runs on
  // rock faces; the baked rock swatch (layer 2) stays in the atlas as the img2img grey-init.
  var ROCK = vec3<f32>(0.42, 0.40, 0.37);
  if (wRock > 0.0) { ROCK = analyticRock(in.vGrid, fwTiles); }
  // Scree = the road-gravel chip field, cooled from its warm track tone toward the
  // neutral grey of the rock it weathered off; gated so the Voronoi only runs on aprons.
  var SCREE = vec3<f32>(0.40, 0.40, 0.41);
  if (wScree > 0.0) {
    let g = analyticGravel(in.vGrid, fwTiles);
    SCREE = vec3<f32>(g.x * 0.88, g.y * 0.92, g.z * 1.04);
  }
  // Snow = the harvested fresh-snow swatch (drift bumps + sparkle + the odd rock tip), not the
  // flat procedural grey-init — real character on every white crown and cold plain.
  let SNOW = groundPatch(GROUND_LAYER_SNOW, in.vGrid * 1.2, fwG * 1.2, gwarp, 0.25);
  // BEACH character keys on climate + shore steepness (field-classifiable, no biome id): tropical
  // WHITE shell-sand on hot coasts, temperate TAN sand (procedural default) on mild ones, grey
  // SHINGLE where the strand is steep/rocky. Fed into the shore-band material weight (wSand) below.
  let tanSand   = matSample(3, muv);
  let whiteSand = groundPatch(GROUND_LAYER_SAND_WHITE, in.vGrid * 1.4, fwG * 1.4, gwarp, 0.20);
  let shingle   = groundPatch(GROUND_LAYER_SHINGLE,    in.vGrid * 1.1, fwG * 1.1, gwarp, 0.18);
  let hotCoast   = smoothstep(0.56, 0.76, temp);
  let steepCoast = smoothstep(0.34, 0.58, slope);
  var SAND = mix(tanSand, whiteSand, hotCoast);
  SAND = mix(SAND, shingle, steepCoast);
  let MUD  = matSample(5, muv);

  // HEIGHT-BLEND composite (crisp, NOT linear-alpha mush): the biome base is the
  // ground layer at a constant height; each material pokes through where its weight
  // exceeds the running max within a transition band ("sand fills the cracks").
  let band = 0.12;
  let hGround = 0.34;
  let m = max(max(hGround, wRock), max(wSnow, max(wSand, max(wMud, wScree)))) - band;
  let bG = max(hGround - m, 0.0);
  let bR = max(wRock   - m, 0.0);
  let bS = max(wSnow   - m, 0.0);
  let bA = max(wSand   - m, 0.0);
  let bM = max(wMud    - m, 0.0);
  let bC = max(wScree  - m, 0.0);
  let sum = bG + bR + bS + bA + bM + bC + 1e-4;
  let albedo = (base * bG + ROCK * bR + SNOW * bS + SAND * bA + MUD * bM + SCREE * bC) / sum;

  // Wet-sand band (T-C shore coordination): damp + darken the land within a thin
  // strip just above the waterline so the water pass's contact-fade edge melts into
  // wet ground instead of a hard line. Land-only (step) — the bed under water keeps
  // its colour since the water pass draws over it.
  let wet = smoothstep(0.045, 0.0, aboveSea) * step(0.0, aboveSea);
  let shoreBase = albedo * mix(1.0, 0.6, wet);
  // Ground-cover clutter is now the UPRIGHT billboard pass (grass-scatter.ts / passGrass),
  // which faces the camera. The old in-shader scatterClutter stamped the SAME sprites as
  // FLAT tile-space decals — a tall reed/flower laid flat reads in iso as a diagonal streak
  // (seen from top, not side), so it is retired here; the base albedo passes straight through.
  let shoreAlbedo = shoreBase;

  // Banded diffuse so the lit relief stays pixel-art (matches the sprites).
  let ndl = max(dot(n, normalize(G.uSun.xyz)), 0.0);
  let bands = max(1.0, G.uSun.w);
  let banded = floor(ndl * bands + 0.5) / bands;
  let light = G.uAmbient.xyz + vec3<f32>(G.uAmbient.w) * banded;

  // ── DISPLAY MODE (uMode.x) ───────────────────────────────────────────────────
  // 0 textured (default) · 1 contour (vector topo) · 2 hypsometric · 3 biome ·
  // 4 slope · 5 normals. The detail-patch pass shares this fragment, so the mode
  // applies to the fine patches identically.
  let mode = u32(G.uMode.x + 0.5);
  if (mode == 6u) {                                  // WIREFRAME — the real mesh grid
    // Lines at the actual quad edges: vertices sit at multiples of THIS pass's mesh
    // spacing (vStep tiles), so drawing where vGrid/vStep crosses an integer traces
    // the rendered triangulation — coarse terrain at sub/sup, a detail patch at its
    // finer 1/SUPER. fwidth keeps the line a constant screen width at any zoom.
    let stepT = max(in.vStep, 1e-4);
    let gu = in.vGrid.x / stepT;
    let gv = in.vGrid.y / stepT;
    let du = min(fract(gu), 1.0 - fract(gu)) / max(fwidth(gu), 1e-4);
    let dv = min(fract(gv), 1.0 - fract(gv)) / max(fwidth(gv), 1e-4);
    let lineMask = 1.0 - clamp(min(du, dv), 0.0, 1.0);
    // Bare MESH — no biome texture. Dark background; the lines themselves are shaded
    // by the banded relief light so the 3D form still reads. Finer passes (detail
    // patches at 1/SUPER) therefore draw visibly denser lines over the same dark.
    let bg = vec3<f32>(0.045, 0.055, 0.075);
    let wireCol = vec3<f32>(0.45, 0.95, 0.70) * (0.30 + 0.70 * banded);
    return vec4<f32>(mix(bg, wireCol, lineMask), 1.0);
  }
  if (mode == 5u) {                                  // NORMALS — geometry debug, unlit
    return vec4<f32>(n * 0.5 + vec3<f32>(0.5), 1.0);
  }
  if (mode == 4u) {                                  // SLOPE — flat→steep ramp, unlit
    let s = clamp(slope * 2.2, 0.0, 1.0);
    let lo = mix(vec3<f32>(0.16, 0.42, 0.20), vec3<f32>(0.85, 0.72, 0.20), clamp(s / 0.5, 0.0, 1.0));
    let col = mix(lo, vec3<f32>(0.88, 0.20, 0.14), clamp((s - 0.5) / 0.5, 0.0, 1.0));
    return vec4<f32>(col, 1.0);
  }
  let aboveFrac = clamp(aboveSea / max(1.0 - seaLevel, 1e-3), 0.0, 1.0);
  var modeAlbedo = shoreAlbedo;                      // 0 textured (default)
  if (mode == 1u) {                                  // CONTOUR — vector topographic map
    let metres = aboveSea * G.uZParams.z;            // reliefM metres above sea
    let spacing = 8.0;                               // minor contour interval (m)
    let cu = metres / spacing;
    let edge = min(fract(cu), 1.0 - fract(cu)) / max(fwidth(cu), 1e-4);
    let minor = 1.0 - clamp(edge, 0.0, 1.0);         // screen-constant fine line
    let iu = metres / (spacing * 5.0);               // bold index contour every 5th
    let iedge = min(fract(iu), 1.0 - fract(iu)) / max(fwidth(iu), 1e-4);
    let index = 1.0 - clamp(iedge, 0.0, 1.0);
    let lineMask = max(minor * 0.55, index);
    modeAlbedo = mix(hypsoRamp(aboveFrac), vec3<f32>(0.12, 0.10, 0.08), lineMask);
  } else if (mode == 2u) {                           // HYPSOMETRIC — elevation ramp
    modeAlbedo = hypsoRamp(aboveFrac);
  } else if (mode == 3u) {                           // BIOME — flat region colour
    modeAlbedo = base;
  }

  // SUBMARINE FADE-TO-DARK: the terrain sinks into darkness as it descends below the
  // waterline, away from the island — so the seabed (and the map's outer rim where
  // the heightfield grid ends) dissolves into the depths instead of showing a lit
  // edge. The ocean surface above stays uniform and infinite (water/backdrop pass);
  // this only darkens the GROUND beneath it, fully hiding the bottom map edges. Land
  // above the waterline is untouched.
  let depthBelow = max(seaLevel - elev, 0.0);
  let submerge = smoothstep(0.0, 0.22, depthBelow);    // 0 at shore → ~1 a few m down
  // SEABED: the shallow submerged bottom shows a real sandy/seagrass bed near shore (rippled sand,
  // seagrass tufts, coral nubs) instead of the darkened land colour, fading out as it deepens.
  // Textured display mode only; deep water still darkens to the abyss via submerge below.
  var bedAlbedo = modeAlbedo;
  if (mode == 0u && G.uFlags.x > 0.5 && depthBelow > 0.0) {
    let seabedTex  = groundPatch(GROUND_LAYER_SEABED, in.vGrid * 1.3, fwG * 1.3, gwarp, 0.22);
    let shallowVis = (1.0 - smoothstep(0.0, 0.14, depthBelow)) * texFade;   // near-shore + band-limited
    bedAlbedo = mix(modeAlbedo, seabedTex, clamp(shallowVis, 0.0, 1.0));
  }
  let lit = bedAlbedo * light;
  return vec4<f32>(lit * (1.0 - submerge * 0.97), 1.0);
}
`;
