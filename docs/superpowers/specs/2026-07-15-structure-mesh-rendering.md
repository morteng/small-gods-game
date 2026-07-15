# Spec — Structure-mesh rendering (depth-tested 3D structures)

**Date:** 2026-07-15
**Status:** spec (not built)
**Brainstorm:** `docs/superpowers/2026-07-15-structure-mesh-rendering-brainstorm.md`
**Plan:** `docs/superpowers/plans/2026-07-15-structure-mesh-rendering-plan.md`
**Owner track:** Engine & world epics (render)

## Goal

Render ground-anchored structural geometry — **bridges and stairs first, walls/towers
next** — as real 3D meshes in a WebGPU pass that shares the terrain depth buffer, so they
are **occluded by and interleaved with terrain** (and each other) instead of drawn as flat
billboards. This retires: the bridge "float above the riverbed", the wall/tower draw-order
glitches, and the general "structures sit *on* the world, not *in* it" flatness.

Reuse the manifold geometry we already compute (and currently discard), the terrain
uniforms we already upload, and reproduce the existing banded-lighting pixel-art look
exactly. **$0, no sim changes, no paid assets.**

## Non-goals

- **Buildings stay sprites.** The img2img albedo pipeline is the reason buildings are
  billboards; they are out of scope (a later slice may revisit only if the mesh look beats
  grey massing).
- No new **art generation**, no paid models, no `ART_RECIPE_VERSION` semantics change for
  the sprite path.
- No **perspective camera** — the dimetric/iso view is preserved exactly.
- No change to `src/sim/` or worldgen entity *creation* (bridges/stairs/barriers are built
  as they are today; only their *draw* changes).

## Success criteria

1. A bridge over a river renders with its abutments/footings **founded** — masonry that
   passes below the visible bed is occluded by the terrain, no floating gap. Verified in a
   live grab against the current billboard bridge.
2. A stair cut into a slope is **occluded by the slope** above it and reads as seated in the
   ground, not resting on it.
3. Two overlapping structure meshes (e.g. a curtain wall crossing a tower) resolve by **true
   depth**, not a per-slab midpoint tiebreak.
4. The mesh look is **indistinguishable in register** from the sprite look at 1:1 zoom
   (same art-pixel grid, same banded lighting, same cast shadow) — no shimmer, no sub-pixel
   drift against terrain/sprites.
5. Byte-stable & deterministic: same `rb` → same mesh → same pixels. Studio + tests
   reproducible. Full-day lighting reproduces the sprite path's tone.
6. No frame-rate regression at overview zoom (structures are localized + viewport-culled).

## Architecture

### A. Mesh extraction (geometry we already build)

- **New export `structureMesh(spec: StructureSpec): StructureMesh`** in
  `src/assetgen/` — shares `partFacets(p)` with `composeStructure` so the sprite and mesh
  paths **cannot drift** (same manifold solids, same materials). It stops *before*
  `projectFacets`/`rasterizeMaps` (`compose.ts:318`) and returns the `WorldFacet[]` plus a
  packed vertex/index representation.
- `StructureMesh` (new type):
  ```ts
  interface StructureMesh {
    // Interleaved vertex attrs in OBJECT space (tiles x,y; cube-units z; 1 tile=2m=128px,
    // 1 cube-unit=64px — the frame WorldFacet already uses).
    positions: Float32Array;   // xyz per vertex (face normal replicated → flat shading)
    normals:   Float32Array;   // per-face normal, replicated to the 3 verts
    // Per-vertex baked PBR (from the SAME materialPbr the rasterizer uses):
    albedo:    Uint8Array;     // rgb, palette-consistent with the sprite path
    material:  Uint8Array;     // g=AO, b=roughness, a=metallic  (r reserved)
    indices:   Uint32Array;    // sequential or de-duped
    materialRanges?: {...}[];   // optional: index sub-ranges grouped by Mat for batching
    bbox: { lo: Vec3; hi: Vec3 };  // object-space, for culling + placement
  }
  ```
- **Flat shading:** replicate each facet's single face normal to its 3 verts (matches
  today's faceted massing). Do **not** back-face cull at extraction (the sprite path's
  `projectFacets` cull at `projection.ts:41` is 2D-view-specific; a mesh keeps all faces).
- **Albedo bake:** reuse `materialPbr(f.mat)` + the surface engine the rasterizer uses, so a
  mesh face and a sprite face carry the same tone. Palette-quantize the albedo the same way
  the sprite path does *iff* needed for register (MVP: bake per-vertex material color; add
  Oklab quantize only if a visible palette seam appears).

### B. The GPU pass

- **New `structureMeshPipeline`** modeled on `createDetailPatchPipeline`
  (`gpu-pipelines.ts:98`): a fresh vertex+fragment WGSL module, `DEPTH_FORMAT` depth
  attachment, **`depthWriteEnabled: true`**, **`depthCompare: 'greater'`**, premultiplied
  blend off (structures are opaque; alpha only for future cutouts).
- **Bind group 0 = terrain env** (`terrainGlobalsBuf` binding 0 + `heights` storage buffer
  binding 1) — the exact set the detail-patch pass binds (`gpu-scene.ts:619-635`). Vertex
  shader reads `uXform`, `uHalf`, `uZParams`, `uGrid`, and samples `heights` for the lift.
- **Bind group 1 = lighting `Globals`** (`globalsBuf`: uBands, uAmbient, uSunDir, uSunColor,
  uNight) so the fragment shader runs the identical banded model.
- **Per-draw uniform / vertex pull** for placement: entity `(ox, oy)` tile origin, `yawDeg`,
  and `liftElev` (the bed/seat elevation). The vertex shader:
  1. Apply object-space yaw about the footprint centre (same convention as
     `solidBoxYawed`).
  2. Translate object-space `(x,y)` by the entity tile origin.
  3. Iso-project: `scrX = (fx−fy)·halfW`, `scrY = (fx+fy)·halfH − zPx − liftPx`, where
     `zPx = objectZ · HEIGHT_UNIT_PX` (cube-units → px, matching the sprite's vertical
     scale) and `liftPx = liftPxFromElev(liftElev, seaLevel, reliefM, zPxPerM)` — the seat
     on terrain. (Structures with no `liftElev` sample `heights` at their foot tile and lift
     by that, like a foot-anchored sprite.)
  4. `dev = scr·uXform.xy + uXform.zw`; `ndc = screen→NDC`; snap to the art-pixel grid the
     same way terrain/sprites do (round `dev` at the scene scale) to hold 1:1.
  5. **Depth:** write the terrain iso depth `clamp((fx+fy)/(W+H), 0, 0.999)` **per pixel**,
     evaluated from the vertex's *ground-projected* `(fx,fy)` (its footprint tile), so a
     structure interleaves with terrain exactly like the terrain mesh does, and a taller part
     nearer the camera occludes a part behind it. (Height does **not** enter depth — matches
     terrain, which orders purely by tile-sum. Refinement — adding a small height term to
     order overlapping masonry — is an explicit later tuning knob, off by default.)
- **Fragment shader:** the banded model verbatim from `lit-wgsl.ts:130-154` — banded
  diffuse `floor(ndl·uBands+0.5)/uBands`, `(uAmbient + uSunColor·banded)·ao`, gated banded
  specular, `uNight` emissive term (structures have none → zero). Inputs: interpolated
  vertex normal (screen-space or object-space consistently transformed), vertex albedo,
  vertex material (G=AO,B=rough,A=metal).

### C. Pass ordering (resolves the central tension)

Insert **`passStructures` immediately after `passDetail` (`gpu-scene.ts:949`) and BEFORE the
entity pass's depth-clear (`gpu-scene.ts:1083`)**, with `depthLoadOp: 'load'` (keep the
terrain depth) and depth write on. This gives:

- ✅ terrain ↔ structure mutual occlusion (shared iso depth),
- ✅ structure ↔ structure mutual occlusion (real per-pixel depth),
- ⚠️ sprites (trees/NPCs/buildings) still paint over structures because the entity pass
  clears depth at `:1083`.

**MVP accepts ⚠️ for bridges + stairs** (sprites near them are on/in-front; see brainstorm).
Shadows (`passShadows`, currently between detail and water) must run **after** `passStructures`
so structure meshes can cast into the stencil-union pass — or keep the pre-baked geometry
shadow and draw it in the existing shadow pass (MVP: keep the existing baked ground-shadow
sprite; live mesh shadow is a later refinement).

**Phase-2 sprite integration (walls/towers)** picks one of brainstorm B/C. This spec commits
only to A for the MVP and flags B/C as the wall/tower prerequisite.

### D. The divert seam (bridges + stairs)

- `entity-draw-list.ts` `case 'building'` (`:199-241`): gate `kind:'bridge'` and
  `kind:'stair_flight'` (or `rb.preset ∈ {bridge, stair_flight}`) away from
  `buildingSpriteItemFromPack` and into a **new `mesh` DrawItem** carrying `{ meshRef, ox,
  oy, footprint, yawDeg, liftElev }`. Everything else in the branch is unchanged.
- **New `DrawItem` variant `t:'mesh'`** (or a side-list the structure pass consumes) — the
  y-sort still runs for coarse ordering, but the pass itself resolves depth per-pixel.
- **New resolver `resolveStructureMesh(entity)`** in `render-context.ts` paralleling
  `resolveParametricBuildingArt`, backed by a **`StructureMeshSource`** that mirrors
  `ParametricBuildingSource`: cache key = same content hash of `toGeometry(rb)` (so a mesh is
  content-addressed identically to the sprite), value = uploaded GPU vertex/index buffers +
  `bbox`. Warm off-thread if extraction is non-trivial; peek sync on the frame.
- **Buffer lifecycle:** meshes cached by content hash; freed on the same LRU the sprite cache
  uses. Identical `rb` (every packhorse bridge of the same class) shares one mesh + one draw
  via instancing (per-entity placement uniform).

### E. Fallback & safety

- If mesh extraction or upload fails for an entity, **fall back to the existing sprite path**
  for that entity (never a blank). Log once.
- Studio (`?studio`) and headless/test contexts with no WebGPU keep the sprite/flat path.
- A dev flag `?structmesh=off` forces the sprite path for A/B comparison.

## Slices

- **S0 — Mesh extraction + golden.** `structureMesh(spec)` shares `partFacets`; unit test
  that a known bridge spec yields the expected vert/tri counts + bbox; assert the sprite
  path is byte-unchanged (extraction is additive).
- **S1 — The pass, bridges only.** `structureMeshPipeline` + `passStructures` + the divert
  for `kind:'bridge'`. Ship behind `?structmesh` on; validate the founded bridge in a grab;
  then default-on for bridges. **This is the MVP proof.**
- **S2 — Stairs.** Add `kind:'stair_flight'` to the divert (per-piece `liftElev` already
  present). Validate a slope stair occluded by its slope.
- **S3 — Live mesh shadow (optional).** Project structure facets into the stencil-union
  shadow pass instead of the baked ground-shadow sprite.
- **S4 — Walls/towers.** `BarrierRun + towers → facets` adapter feeding the same pass;
  requires resolving the sprite-integration fork (brainstorm B/C) because the ordering bug is
  the whole point here.

## Risks

- **Register drift / shimmer** (breaks the pixel-perfect rule) — mitigate by snapping `dev`
  to the exact scene scale terrain/sprites use; test at multiple zoom rungs.
- **Depth-space seam with sprites** — the accepted ⚠️; bound to bridges/stairs in the MVP.
- **Perf** — many small draws; mitigate by content-hash instancing + material batching +
  viewport cull. Measure before/after at overview zoom (memory: overview is fill-bound).
- **Lighting divergence** — mirror `banded-pbr.ts` exactly; add a test comparing a mesh
  fragment to `bandedPbrPixel` for representative normals.

## Verification

- Live grabs (`__debug.grab`): bridge founded (S1), slope stair occluded (S2), wall/tower
  ordering correct (S4) — each against the billboard baseline.
- Unit: mesh extraction counts/bbox; banded-lighting parity vs `bandedPbrPixel`; sprite path
  byte-unchanged.
- `npm run lint:world` unaffected (draw-only change).
- Server CI green before push.
