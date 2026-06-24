// src/render/gpu/wgsl/detail-patch-wgsl.ts
//
// Adaptive sub-tile detail PATCHES — the vertex stage only. The coarse terrain
// mesh draws one quad per tile (flat-faceted); this overlays a finer mesh on the
// hot regions the importance map flagged (coast/carve/slope), reading GENUINE
// sub-tile relief baked by `terrain-detail.ts`. Drawn right after terrain into the
// SAME depth buffer (greater-equal + write): a patch vertex sits at the same iso
// depth as the coarse tile it covers, so — drawn later — it wins and fully
// overdraws that tile; the adjacent un-patched tile in front still occludes
// correctly. Seams are perfect because the baked heights equal the coarse buffer
// at integer tile coords.
//
// Only the VERTEX lives here: the pipeline pairs it with the terrain shader's
// `fsMain` (same `VSOut` layout + the colour/material/coarse-height bindings it
// reads via `vGrid`), so there is no fragment duplication — the patch shades,
// lights and textures identically to the terrain, just over a denser mesh.
//
// One patch covers PATCH_TILES×PATCH_TILES tiles, supersampled SUPER× → a
// FINE×FINE vertex lattice (FINE = PATCH_TILES*SUPER + 1). Patches are instanced:
// one instance per patch, its tile origin a per-instance vertex attribute; the
// per-patch fine-height slice is `patchHeights[instance * FINE*FINE + ...]`.

/** Tiles per patch edge. Must match DETAIL_PATCH_TILES in detail-field.ts. Small
 *  (4) so a patch tightly bounds the river/lake carve it covers — a 16-tile block
 *  refined a whole neighbourhood around a 1-tile river; 4-tile blocks hug the
 *  channel + banks, and (being 1/16 the area) cost fewer total verts despite the
 *  higher instance count. */
export const DP_PATCH_TILES = 4;
/** Supersample factor per patch edge — the sub-tile mesh density over carved/coast/
 *  steep regions. 4 = each tile split into a 4×4 fine lattice (much finer banks at
 *  road/river carves than the old 2×, 4× the triangles). Drives the baked lattice
 *  size in detail-field.ts (DETAIL_SUPERSAMPLE = DP_SUPER); patches are hot-region-
 *  only + memoised. Pushing higher needs frustum culling first (no per-patch view
 *  cull yet — every patch draws each frame), or the whole-map overview stalls. */
export const DP_SUPER = 4;

export const DETAIL_PATCH_WGSL = /* wgsl */ `
struct TGlobals {
  uViewport : vec2<f32>,
  uMode     : vec2<f32>,   // x: display mode enum (shared terrain fragment)
  uXform    : vec4<f32>,
  uGrid     : vec2<f32>,
  uHalf     : vec2<f32>,
  uZParams  : vec4<f32>,   // zPxPerM, seaLevel, reliefM, subsample
  uSun      : vec4<f32>,
  uAmbient  : vec4<f32>,
};

@group(0) @binding(0) var<uniform> G : TGlobals;
// binding 1 (coarse heights) + 2..4 (colour/moisture/temperature) are consumed by
// the shared terrain fragment via vGrid; the vertex only needs the patch heights.
@group(0) @binding(5) var<storage, read> patchHeights : array<f32>;

const PATCH_TILES : u32 = ${DP_PATCH_TILES}u;
const SUPER       : u32 = ${DP_SUPER}u;
const FINE        : u32 = ${DP_PATCH_TILES * DP_SUPER + 1}u;   // verts per patch edge
const QUADS       : u32 = ${DP_PATCH_TILES * DP_SUPER}u;       // quads per patch edge

fn fineH(inst : u32, i : u32, j : u32) -> f32 {
  return patchHeights[inst * FINE * FINE + j * FINE + i];
}
fn finePx(inst : u32, i : u32, j : u32) -> f32 {
  return (fineH(inst, i, j) - G.uZParams.y) * G.uZParams.z * G.uZParams.x;
}

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vNormal : vec3<f32>,
  @location(1) vGrid   : vec2<f32>,
  @location(2) vStep   : f32,   // this patch's fine quad spacing (1/SUPER tiles)
};

@vertex
fn vsMain(
  @builtin(vertex_index) vid : u32,
  @builtin(instance_index) inst : u32,
  @location(0) origin : vec2<f32>,   // per-instance patch tile origin
) -> VSOut {
  let W = u32(G.uGrid.x);
  let H = u32(G.uGrid.y);

  let quadIdx = vid / 6u;
  let vinq = vid % 6u;
  let qx = quadIdx % QUADS;
  let qy = quadIdx / QUADS;

  var corner = vec2<u32>(0u, 0u);
  switch vinq {
    case 0u: { corner = vec2<u32>(0u, 0u); }
    case 1u: { corner = vec2<u32>(1u, 0u); }
    case 2u: { corner = vec2<u32>(0u, 1u); }
    case 3u: { corner = vec2<u32>(1u, 0u); }
    case 4u: { corner = vec2<u32>(1u, 1u); }
    default: { corner = vec2<u32>(0u, 1u); }
  }
  let li = qx + corner.x;   // 0..QUADS  (≤ FINE-1)
  let lj = qy + corner.y;

  let hPx = finePx(inst, li, lj);

  // Normal from fine neighbours (±1 fine cell = 1/SUPER tile), expressed as a
  // PER-TILE gradient so the slope magnitude matches the coarse mesh (×SUPER for
  // the finer spacing); the dense lattice then gives smooth lit relief.
  let iL = select(li - 1u, li, li == 0u);
  let iR = select(li + 1u, li, li >= FINE - 1u);
  let jU = select(lj - 1u, lj, lj == 0u);
  let jD = select(lj + 1u, lj, lj >= FINE - 1u);
  let dxh = finePx(inst, iR, lj) - finePx(inst, iL, lj);
  let dyh = finePx(inst, li, jD) - finePx(inst, li, jU);
  let normal = normalize(vec3<f32>(-dxh * 0.5 * f32(SUPER), G.uHalf.y, -dyh * 0.5 * f32(SUPER)));

  // Tile-space position, clamped to the map so an edge patch's overhang collapses
  // onto the boundary (degenerate, invisible) instead of drawing past the island.
  let tx = min(origin.x + f32(li) / f32(SUPER), f32(W - 1u));
  let ty = min(origin.y + f32(lj) / f32(SUPER), f32(H - 1u));

  let scr = vec2<f32>((tx - ty) * G.uHalf.x, (tx + ty) * G.uHalf.y - hPx);
  let dev = scr * G.uXform.xy + G.uXform.zw;
  let ndc = vec2<f32>(dev.x / (G.uViewport.x * 0.5) - 1.0, 1.0 - dev.y / (G.uViewport.y * 0.5));
  let depth = clamp((tx + ty) / (G.uGrid.x + G.uGrid.y), 0.0, 0.999);

  var out : VSOut;
  out.pos = vec4<f32>(ndc, depth, 1.0);
  out.vNormal = normal;
  out.vGrid = vec2<f32>(tx, ty);
  out.vStep = 1.0 / f32(SUPER);   // fine spacing → wireframe shows the refined mesh
  return out;
}
`;
