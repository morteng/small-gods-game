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

// How many world tiles one exemplar repeat spans (1 tile = 2 m). ~2.5 tiles → a 64px
// swatch over ~5 m reads chunky-but-legible under the banded sun.
const MAT_TILES : f32 = 2.5;

fn matSample(layer : i32, uv : vec2<f32>) -> vec3<f32> {
  return textureSample(matAtlas, matSamp, uv, layer).rgb;
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
fn roadPaved(fx : f32, fy : f32) -> f32 {
  let segCount = roadFeat[3];
  if (segCount == 0u) { return 0.0; }
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
  var best = 0.0;
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
    if (d <= half) {
      let core = half * 0.7;
      let fade = select((half - d) / max(half - core, 1e-4), 1.0, d <= core);
      let paved = mix(rfF(o + 6u), rfF(o + 7u), t);
      best = max(best, paved * fade);
    }
  }
  return best;
}

// Cheap value noise for jittering material thresholds so edges wander (kills the
// flat contour rings / square biome borders that betray procedural terrain).
fn hash21(p : vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
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

// ── Analytic road materials (Step 2) ─────────────────────────────────────────
// Cobble + gravel are evaluated PER-PIXEL in continuous world space instead of
// sampling a baked 64px swatch — so the feature size is set directly in world
// units (no fixed-px resolution ceiling, no tiling seam ever) and the high-freq
// detail BAND-LIMITS against the pixel footprint (fwTiles) so it fades to a
// flat tone as you zoom out instead of shimmering ("octaves read as faceting").
// An integer bit-hash (not sin-based hash21) keeps the cell field artefact-free
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
// Blocky outcrop — larger Voronoi facets (~1 m) with darkened seam grooves + fine grain,
// scaled in world units + band-limited like the road materials. Mirrors the baked rock
// swatch (worley facets, grooved seams, warm grey) but with no fixed-px resolution ceiling.
fn analyticRock(uvTiles : vec2<f32>, fwTiles : vec2<f32>) -> vec3<f32> {
  let facetTiles = 0.5;                        // ~1.0 m facets / 2 m-per-tile
  let uv = uvTiles / facetTiles;
  let cellFw = max(fwTiles.x, fwTiles.y) / facetTiles;
  let v = vorCell(uv, 0.8);
  let lod = detailLod(cellFw);
  let grain = (vnoise(uvTiles * 3.2) - 0.5) * lod;          // fine surface grain (~0.31 m)
  let aa = max(cellFw, 1e-4);
  let seam = 1.0 - smoothstep(0.04, 0.04 + aa, v.z);        // darken facet crevices (F2−F1 edge)
  let tone = 0.40 + 0.10 * v.y + 0.10 * grain;
  let shade = mix(1.0, 0.55, seam);
  let lit = tone * shade;
  return vec3<f32>(lit * 1.05, lit, lit * 0.93);
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
  // y=up, z=south. Flat ground gives (0,1,0). The ±1-tile spacing + sub up-term
  // keep slope magnitude independent of the mesh density (matches the original).
  var normal = vec3<f32>(0.0, 1.0, 0.0);
  if (fx > 0.5 && fx < f32(W - 1u) - 0.5 && fy > 0.5 && fy < f32(H - 1u) - 0.5) {
    let hl = heightPxF(fx - 1.0, fy);
    let hr = heightPxF(fx + 1.0, fy);
    let hu = heightPxF(fx, fy - 1.0);
    let hd = heightPxF(fx, fy + 1.0);
    normal = normalize(vec3<f32>(-(hr - hl) * 0.5, f32(sub) * G.uHalf.y, -(hd - hu) * 0.5));
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
  let moist = moisture[ci];
  let temp = temperature[ci];
  let jit = vnoise(in.vGrid * 0.35) - 0.5;       // [-0.5,0.5] threshold wander

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
  let fwTiles = fwidth(in.vGrid);

  let road = roadPaved(in.vGrid.x, in.vGrid.y);
  // Road surface = the full packed-dirt → gravel → cobble exemplar spectrum (real
  // sett/grain texture), driven by pavedness. feature-geometry.ts encodes the road
  // TIER into this scalar at the material anchors (dirt 0.2 · gravel 0.45 · cobble 0.75 ·
  // paved 1.0), dimmed by condition·overgrowth — so a worn cobble road drifts toward
  // gravel→dirt on its own, the wear IS the lower pavedness. Packed DIRT stays a baked
  // low-relief swatch (layer 6); GRAVEL and COBBLE are now ANALYTIC (per-pixel, scaled in
  // real world units, band-limited — analyticCobble/Gravel above) so their sett/chip size
  // is correct at every zoom with no tiling seam. Dirt is sampled unconditionally (texture
  // LOD needs uniform control flow); the analytic Voronoi is the cost, so it's gated behind
  // road presence — off-road fragments skip it entirely.
  // Road-vs-land blend. The OLD smoothstep(0,0.16,road) saturated to ~1 at a dirt road's
  // 0.2 pavedness, so a dirt track painted a hard-edged, full-strength uniform brown SLAB
  // (read as a wide muddy scar) while only cobble feathered. Now the blend STRENGTH scales
  // with pavedness: a dirt track blends ~0.35 (grass shows through, a packed-earth desire
  // path), gravel rises, cobble/paved go fully opaque. A narrow edge smoothstep keeps the
  // sub-tile boundary soft for every tier.
  let roadMix = smoothstep(0.0, 0.08, road) * mix(0.35, 1.0, smoothstep(0.20, 0.75, road));
  let dirtA = matSample(6, muv);
  var roadAlb = dirtA;
  if (roadMix > 0.0) {
    let gravelA = analyticGravel(in.vGrid, fwTiles);
    let cobbleA = analyticCobble(in.vGrid, fwTiles);
    let upper = road >= 0.45;                      // above the gravel anchor?
    roadAlb = select(
      mix(dirtA,   gravelA, smoothstep(0.20, 0.45, road)),   // dirt → gravel
      mix(gravelA, cobbleA, smoothstep(0.45, 0.78, road)),   // gravel → cobble
      upper);
  }
  // Texture the biome ground by MODULATING its per-cell hue with the grass exemplar's
  // detail (luminance / mean) — keeps every biome's colour, adds grain without needing a
  // per-biome swatch. Roads override it where paved.
  let groundDetail = clamp(dot(matSample(0, muv), vec3<f32>(0.3333)) / 0.5, 0.72, 1.28);
  let base = mix(biome * groundDetail, roadAlb, roadMix);

  // Material WEIGHTS — each becomes a height-blend layer below.
  let wRock = smoothstep(0.42, 0.78, slope + jit * 0.18);                 // steep faces
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
  let metresAS  = aboveSea * G.uZParams.z;
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
  let SNOW = matSample(4, muv);
  let SAND = matSample(3, muv);
  let MUD  = matSample(5, muv);

  // HEIGHT-BLEND composite (crisp, NOT linear-alpha mush): the biome base is the
  // ground layer at a constant height; each material pokes through where its weight
  // exceeds the running max within a transition band ("sand fills the cracks").
  let band = 0.12;
  let hGround = 0.34;
  let m = max(max(hGround, wRock), max(wSnow, max(wSand, wMud))) - band;
  let bG = max(hGround - m, 0.0);
  let bR = max(wRock   - m, 0.0);
  let bS = max(wSnow   - m, 0.0);
  let bA = max(wSand   - m, 0.0);
  let bM = max(wMud    - m, 0.0);
  let sum = bG + bR + bS + bA + bM + 1e-4;
  let albedo = (base * bG + ROCK * bR + SNOW * bS + SAND * bA + MUD * bM) / sum;

  // Wet-sand band (T-C shore coordination): damp + darken the land within a thin
  // strip just above the waterline so the water pass's contact-fade edge melts into
  // wet ground instead of a hard line. Land-only (step) — the bed under water keeps
  // its colour since the water pass draws over it.
  let wet = smoothstep(0.045, 0.0, aboveSea) * step(0.0, aboveSea);
  let shoreAlbedo = albedo * mix(1.0, 0.6, wet);

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
  let lit = modeAlbedo * light;
  return vec4<f32>(lit * (1.0 - submerge * 0.97), 1.0);
}
`;
