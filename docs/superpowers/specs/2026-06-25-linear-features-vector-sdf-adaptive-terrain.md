# Linear Features as a Vector SDF on the Adaptive Terrain Mesh — Design

**Status:** brainstorm / spec (2026-06-25). Pragmatic patch SHIPPED (see §6); the analytical model
below is design-only, no code yet.
**Builds on:** `2026-06-24-roads-as-carved-terrain-design.md` (roads = carve + surface, no ribbon)
and `2026-06-18-terrain-water-shader-system-research.md` (one per-cell field → texturing/water/scatter).
**Origin:** user direction —
> *"roads and rivers are basically the same thing to the terrain, it's just different algorithms for
> paths to carve (and different carve profiles and rules etc) and roads don't normally have water on
> them. can we achieve that in a dynamic, dynamically subdivided terrain model?"*

## 1. Thesis

A **linear feature** (road, river, wall, future: rail, hedge, canal) is one abstraction:

> a **vector centerline** + a **carve profile** + a **surface rule**, evaluated *analytically* on the
> terrain mesh at whatever subdivision the mesh happens to have.

Roads and rivers differ only in three slots — never in the machinery:

| Slot | Road | River | Wall |
|---|---|---|---|
| **Path algorithm** | A* cost-walk (`walkRoad`, grade/obstacle/reuse) | hydrology flow-accumulation (`getHydrologyResult`) | A* cost-walk (defensible line) |
| **Carve profile** | crown + kerb + gutter + ruts (`crossProfile`) | incised channel + banks (`buildRiverDeformations`) | berm/foundation (or none) |
| **Surface rule** | dry paved ramp (dirt→cobble); 4-connected **walkable** mask | water fill + flow; **not** walkable | masonry; blocks movement |

"Roads don't have water on them" is exactly the surface-rule row — not a separate system.

## 2. The codebase already half-agrees

This is not a green-field proposal. The unification is **partly built**:

- **One shared deformation channel.** `getWorldDeformationStore()` (`src/world/road-deformation.ts`)
  composes `buildRoadDeformations() + buildRiverDeformations()` into a single `DeformationStore`,
  read through the `heightAt = baseSeedHeight ⊕ deformations` contract (`terrain-deformation.ts`).
  Roads and rivers already write to the **same** substrate; overlaps resolve by priority (a road
  bridges a river).
- **The carve is already a vector SDF**, not a grid thing:
  `targetAt(tx,ty) = interpAtArc(grade, s) + crossProfile(d)` — a continuous function of the smooth
  centripetal Catmull-Rom centerline (`smoothCenterline`, arc-length `s`, cross-distance `d`). It is
  evaluated at *continuous* coordinates; nothing about it is intrinsically 2 m.
- **The mesh already subdivides adaptively** around features — the detail-patch pass
  (`detail-field.ts` importance map flags carve/coast/slope; `detail-patch-wgsl.ts` refines those
  tiles 4× and shares the terrain `fsMain`).

## 3. Where the grid actually leaks in (two bakes, not the source)

The centerline and carve are vector. The terrain mesh is adaptive. Yet roads render grid-locked,
because **two re-quantisation steps sit between the vector truth and the mesh**:

1. **Height bake.** `getComposedHeightfield()` samples the analytical `heightAt(tx,ty)` at *integer
   tile centres* into a per-cell `W×H` `Float32Array`. The vector carve is frozen to 2 m **before**
   the GPU sees it — so carve banks step at tile frequency no matter how fine the mesh.
2. **Surface bake.** Road pavedness was a per-cell field; a per-cell scalar resolves a carriageway
   edge only to ±½ tile, so the edge wobbled at tile frequency. (§6 super-samples it as an interim.)

And the killer: **the adaptive detail patches resample those baked per-cell fields** (bilinear over
`heights` / `roadSurface`). Subdividing the mesh adds triangles but cannot recover detail the bake
already threw away. We pay for adaptivity and get none of its fidelity for features.

## 4. The target model: evaluate the SDF on the mesh, don't bake it

Flip the dependency. The per-cell fields stay for the **base** terrain (biome elevation, moisture,
temperature — genuinely cell-resolution data). Linear features instead become **GPU-resident vector
geometry** evaluated where the mesh is already dense:

- **Upload** each feature's smoothed centerline as segments + per-feature profile/surface params
  (a small CSR bucket index by tile, exactly like `river-channel-geometry.ts` already does for the
  river analytic-SDF S1 — *this pattern is in the repo and tested*).
- **Detail-patch vertex shader** evaluates carve height = `baseHeight + Σ featureProfile(distance to
  centerline)` per fine vertex — banks resolve to the patch's 4×/8× lattice, any-angle, no steps.
- **Terrain `fsMain`** evaluates the surface (pavedness / water / masonry) from the same
  distance-to-centerline, retiring the per-cell `roadSurface` field (and the §6 super-sample) for a
  true zero-width-quantisation edge.
- **Coarse base mesh** (away from features) keeps the cheap per-cell path — features only matter
  where the importance map already refines, so cost is bounded to the patches.

Result: one path for roads + rivers + walls; the terrain *conforms* to the vector at the mesh's
local resolution; nothing about a feature is ever 2 m-quantised. This is the standard spline-feature
/ conforming-adaptive-terrain pattern (GIS road decals, CDLOD + analytic displacement).

## 5. Risks / open questions

- **Decoupled masks.** Walkability + the road-connectivity flood need a 4-connected *tile* mask. Keep
  rasterising that from the vector (today: `orthogonalize` + `applyEdge`); it is a derived artifact,
  independent of rendering. Don't let the mask drive the visual.
- **Per-fragment segment cost.** Bounded by the CSR-by-tile bucket (only nearby segments evaluated)
  and by only running on detail patches. Needs an iGPU budget check (the river S1 SDF is the proving
  ground / perf precedent).
- **Bridges / fords / junctions** are *places* where profiles compose — priority order in the store
  already handles road-over-river; junction-snap (per `road-junctions`) defines the topology. The
  SDF evaluation must honour the same priority.
- **Determinism + save-safety.** All feature geometry derives from `roadGraph` + hydrology (both
  persisted/re-derivable); the GPU buffers are pure projections. No new persisted state.
- **Recipe versioning.** Moving the carve off the per-cell bake changes terrain geometry → bump
  `ART_RECIPE_VERSION` / update the assetgen-golden pins when the height path actually moves.

## 6. Shipped interim (2026-06-25) — the pragmatic patch under this design

Committed on `feat/roads-rivers-any-angle` (`3c61a34`, not pushed). Fixes the *visible* grid-lock now
while the analytical model above is the proper follow-up:

- **Any-angle paths.** `walkRoad` runs 8-connected for roads + rivers (`allowDiagonal = feature !==
  'wall'`); the path distributes off-axis steps one-per-run, so RDP+Catmull reconstruct the true
  bearing (4-connected A* clumped its turns past the RDP tolerance — that was the zig-zag). The
  rasterised tile mask stays 4-connected via `orthogonalize()` (land-preferring corner per diagonal
  step → a tight 1-step staircase that collapses back to the diagonal).
- **Grid-liberated surface edge.** Road pavedness is super-sampled S× (`ROAD_SURFACE_SUPERSAMPLE = 4`,
  0.5 m); `terrain-wgsl.ts` derives S from `arrayLength(&roadSurface)` and bilinear-samples the finer
  grid (no new uniform; S=1 byte-identical). This is the field §3.2/§4 retires once the surface is
  evaluated analytically.

These are deliberately *workarounds for the grid*, not the cure. The cure is §7.

## 7. Shipped — the unified-terrain-features epic (2026-06-25, `feat/unified-terrain-features`)

The cure §4 called for, built in slices on a branch off the §6 patch (not pushed). The §6
super-sampled `roadSurface` workaround is now **retired**.

- **Slice 0 — shared substrate.** `feature-geometry.ts` generalises the proven river analytic-SDF
  (CSR-by-tile segment buckets) into `binFeatureSegments` + a road feature buffer (self-describing
  4-word header `[bucketTiles,nbx,nby,segCount]`, so the terrain uniform struct is untouched) +
  `roadPavednessAt` CPU mirror. `river-channel-geometry.ts` now shares `binFeatureSegments` (byte-parity).
- **Slice 1 — analytic road surface; tech debt deleted.** `terrain-wgsl.ts` `sampleRoadBi` (per-cell
  bilinear) → `roadPaved` (analytic distance to the smooth centreline, MAX of paved·fade over the
  bucket). Binding 6 is now the road feature buffer (shared by the terrain + detail passes; net-zero
  buffer count). **DELETED** `src/world/road-surface.ts`, `ROAD_SURFACE_SUPERSAMPLE`, `sampleRoadBi`,
  and all the per-cell road-surface plumbing. The carriageway edge is now sub-tile sharp at any angle.
- **Slice 4 — gentle building foundation pads.** `settlement-deformation.ts` levels each BUILT burgage
  lot's footprint to its mean base height (soft feather) via `footprintLevelDeformation`, composed into
  the world store alongside roads+rivers. Derives purely from `map.settlementPlans` (lots persisted on
  the map), so the composed heightfield stays a pure, save-safe function of `map`; the world-store key
  folds the built-lot count so live growth invalidates. Conservative per-building, not whole-town
  terracing.

**Decisions vs the §4 plan (kept it leaner than feared):**
- The per-cell composed **height bake is KEPT** (not retired). It is the CPU datum for entity foot-z
  lift and the water plane; the detail-patch mesh already evaluates the carve analytically, so the
  visual win came from the analytic *surface* + the existing detail height, not from removing the bake.
  This also de-risked the patch-seam concern (§5 risk 2 / Slice 2 — folded, no longer needed).
- **Separate buffers per pass, one shared module/format.** Terrain binds the road feature buffer
  (binding 6); water keeps its river channel (binding 9). A terrain fragment therefore only ever sees
  road segments, so the cross-kind priority-composition problem (§ blocker) evaporates for the surface —
  road↔road overlap is just max-pavedness. This respects the hard 8-storage-buffer budget.
- **No content-version bump.** Every change re-derives from already-persisted data (roadGraph, lots),
  so existing saves render with the new look on reload — no save-format change, no autosave invalidation.

**Deferred (honest gaps):** walls/enclosures as berm carves (barriers are World entities, not on `map`
like `settlementPlans` — needs the same derive-from-map treatment; thin features, low value); deep
priority-composed bridge crossings (roads already cross water via deformation priority + the entity
deck); lampposts/point props stay lifted (carving terrain for a point prop is pointless — by design).
