# Plan — Structure-mesh rendering

**Date:** 2026-07-15
**Spec:** `docs/superpowers/specs/2026-07-15-structure-mesh-rendering.md`
**Brainstorm:** `docs/superpowers/2026-07-15-structure-mesh-rendering-brainstorm.md`

Build order is **S0 → S1 (MVP proof) → S2 → S3 → S4**. Each slice is independently
shippable; do not start S4 (walls/towers) until the sprite-integration fork is decided.
Everything is $0, draw-only, no sim changes. Commit → server CI green (`✓ Server CI passed`)
→ push. WebGPU-only; verify with `__debug.grab`, not `page.screenshot`.

---

## S0 — Mesh extraction (no rendering yet)

**Deliver:** `structureMesh(spec)` that reuses `partFacets`, plus goldens. Sprite path
byte-unchanged.

- `src/assetgen/compose.ts` — factor the facet-building loop (the code before
  `projectFacets`, ~`:289-318`) so both `composeStructure` and a new `structureMesh(spec)`
  call the *same* `partFacets` accumulation. `composeStructure` output must not change.
- New `src/assetgen/structure-mesh.ts` — `structureMesh(spec: StructureSpec): StructureMesh`:
  accumulate `WorldFacet[]`, replicate each face normal to 3 verts, bake per-vertex
  albedo/material from `materialPbr(f.mat)` (+ surface engine), emit interleaved
  positions/normals/albedo/material + sequential `Uint32` indices + object-space `bbox`.
  Optional `materialRanges` for batching.
- New type `StructureMesh` in `src/assetgen/types.ts` (or `structure-mesh.ts`).
- **Tests** (`tests/unit/structure-mesh.test.ts`): a fixed bridge + a fixed stair spec →
  assert vertex/triangle counts, bbox, and that flat-normal replication is correct; assert
  `composeStructure` on the same spec is unchanged (guards the shared-`partFacets` refactor).

**Done when:** tsc clean, new tests pass, existing assetgen goldens untouched.

---

## S1 — The pass, bridges only (**the MVP proof**)

**Deliver:** bridges render as depth-tested meshes, founded against terrain. Behind
`?structmesh` first, then default-on for `kind:'bridge'`.

- **WGSL** `src/render/gpu/wgsl/structure-mesh-wgsl.ts`:
  - VS: read `terrainGlobalsBuf` (uXform, uHalf, uZParams, uGrid) + `heights`; apply
    per-draw `{ ox, oy, yawDeg, liftElev }`; yaw about footprint centre; iso-project
    `scrX=(fx−fy)·halfW`, `scrY=(fx+fy)·halfH − zPx − liftPx`; `zPx = objZ·HEIGHT_UNIT_PX`;
    `liftPx = (liftElev−seaLevel)·reliefM·zPxPerM`; snap `dev` to scene scale; write depth
    `clamp((groundFx+groundFy)/(W+H),0,0.999)`.
  - FS: banded model verbatim from `lit-wgsl.ts:130-154` reading `globalsBuf` (bind group 1).
- **Pipeline** `createStructureMeshPipeline` in `src/render/gpu/gpu-pipelines.ts` — clone the
  detail-patch pipeline shape (`:98`): `DEPTH_FORMAT`, `depthWriteEnabled:true`,
  `depthCompare:'greater'`, opaque.
- **Pass** in `src/render/gpu/gpu-scene.ts`: `passStructures(ctx)` inserted after
  `passDetail` (`:949`), before the entity pass. `depthLoadOp:'load'`. Bind
  `terrainGlobalsBuf`+`heights` (group 0, like `:619-635`) and `globalsBuf` (group 1). Guard
  with `hasStructures`.
- **Source** `src/render/structure-mesh-source.ts` (`StructureMeshSource`) mirroring
  `ParametricBuildingSource`: content-hash key over `toGeometry(rb)` (same hash family as the
  sprite cache), `warm`/`peek`, uploads GPU vertex/index buffers, returns `{ buffers, bbox }`.
  Instances share one mesh per identical `rb`.
- **Resolver** `resolveStructureMesh(entity)` in `src/game/render-context.ts` (next to
  `resolveParametricBuildingArt`).
- **Divert** `src/render/iso/entity-draw-list.ts` `case 'building'` (`:199-241`): for
  `kind:'bridge'`, emit a `t:'mesh'` DrawItem `{ meshRef, ox:bx, oy:by, footprint:fp,
  yawDeg, liftElev }` instead of `buildingSpriteItemFromPack`. Keep the existing `liftElev`
  read. New `DrawItem` variant in `src/render/iso/draw-list.ts`.
- **Draw-list → pass plumbing:** collect `t:'mesh'` items into a per-frame structure list the
  new pass consumes (they still get a y-sort entry for coarse ordering; per-pixel depth does
  the real work).
- **Fallback:** on extraction/upload failure, fall back to the sprite item for that entity.
- **Dev flag** `?structmesh=off` forces the sprite path.

**Verify (live):** reload a world with river bridges; grab the same bridge as the billboard
baseline; confirm the footing is occluded by the bank/water with no floating gap, register
matches at zoom rungs, banded lighting matches. A/B via `?structmesh=off`.

**Done when:** founded bridge confirmed in a grab, no shimmer, no perf regression at
overview, CI green. Then flip default-on for bridges.

---

## S2 — Stairs

- Add `kind:'stair_flight'` to the S1 divert (per-piece entities already carry their own
  `liftElev` from `stair-structures.ts:278`). No new geometry work — `stair_flight` parts
  already flow through `structureMesh`.
- **Verify:** a road stair cut into a slope is occluded by the slope above it and reads
  seated, not floating (the artifact the anchor-driven stair work chased on the sprite side).

**Done when:** slope stair grab confirms occlusion + seating; CI green.

---

## S3 — Live mesh shadow (optional refinement)

- Replace the baked ground-shadow sprite for structure meshes with a live projection: project
  the structure's facets to ground `z=0` along the pinned `shadowDir` and feed the existing
  stencil-union pass at `SHADOW_ALPHA=0.32` (`ground-shadow.ts` already does exactly this at
  bake time — lift it to run per-frame for meshes, or keep baked if the look is identical).
- Only pursue if the baked shadow visibly mismatches the new mesh silhouette.

---

## S4 — Walls / towers (gated on the sprite-integration fork)

**Prerequisite:** decide brainstorm **B (unify depth spaces)** vs **C (hybrid)** — the
wall/tower ordering bug is *between structures and sprites/buildings*, so the MVP's
"sprites-on-top" is not acceptable here.

- **Geometry adapter** `barrierRunMesh(run: BarrierRun)` — convert the polyline + `height`,
  `thickness`, `crenellated`, `posts`, `gates`, and `towers[]` into `WorldFacet[]` (the
  barrier is *not* a blueprint entity, so it can't use `toGeometry(rb)`). Reuse the same
  vertex/material bake as `structureMesh`.
- **Divert** the `case 'barrier'` path (`entity-draw-list.ts:108-143`): the
  `parametricBarrierSource`/`barrierPieceItem` seam becomes a mesh emit.
- **Depth fix:** implement the chosen B/C so a tree/building behind a wall is correctly
  occluded and towers/curtain resolve by true depth. Retire the per-slab midpoint tiebreak
  and the `KIND_PRIORITY.barrier>building` hack for meshed barriers.
- **Verify:** the reported wall/tower mis-sort grab is correct; buildings behind a curtain
  wall are occluded; no double-darkened shadows.

---

## Cross-cutting

- **Pixel-perfect:** every VS must round `dev` to the exact scene scale terrain/sprites use;
  add a zoom-ladder register test if feasible.
- **Determinism:** mesh is a pure function of `rb`/`BarrierRun`; content-addressed like the
  sprite cache. No `Math.random`.
- **Perf gate:** measure overview FPS before/after S1 and S4 (fill-bound regime — memory).
  Instancing + material batching + viewport cull mandatory before default-on.
- **No ART/WCV bump** expected (draw-only). If any bake changes the content hash, follow the
  version-pin discipline.
- **Memory:** update `[[project-render-view-angle-scale]]` / the rendering-direction topic
  and `MEMORY.md` when S1 lands.
