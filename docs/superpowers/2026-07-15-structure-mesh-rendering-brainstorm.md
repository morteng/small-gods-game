# Structure-mesh rendering — brainstorm

**Date:** 2026-07-15
**Status:** brainstorm (feeds the spec + plan of the same date)
**Trigger:** user, looking at a river bridge in the live game: *"they float above the
riverbed… bridges should parametrically extend to below riverbed to look good"* → then,
after a failed billboard-side attempt, *"we want them integrated fully into the world, use
the 3d geometry for that? … maybe render the procedurally-textured 3d for bridges and
stairs? there are issues with wall and tower rendering orders, too."*

The user's diagnosis is correct and it is architectural. This doc records **why**, what
already exists to build on, the **central tension**, and where the thesis fights the
current renderer — so the spec can commit cleanly.

---

## The thesis

**Ground-anchored structural geometry (bridges, stairs, walls, towers) should render as
real 3D meshes in a depth-tested pass, not as flat billboard sprites.** The manifold
geometry already exists at compose time — we currently *throw it away* by rasterizing it to
a 2D sprite. Rendering the mesh directly, sharing the terrain depth buffer, fixes three
distinct bugs at once with one mechanism.

## The renderer is split-brain (the root cause)

- **Terrain** is a true 3D heightfield mesh. Its vertex shader iso-projects each tile, lifts
  it by `heightPx = (elev−seaLevel)·reliefM·zPxPerM`, and writes a real per-pixel depth
  `clamp((fx+fy)/(W+H), 0, 0.999)` into a shared `depth24plus` buffer
  (`terrain-wgsl.ts:375-386`).
- **Every structure** — bridges, stairs, walls, towers, buildings — is composed from
  manifold CSG geometry (`WorldFacet[]`, the last fully-3D form at `compose.ts:289`) and
  then **flattened to a billboard sprite** two lines later (`compose.ts:318-321`:
  `projectFacets` → `rasterizeMaps`). The sprite draws in a y-sorted painter's-order pass
  that writes **one depth value for the entire quad** — `iDepth = (listIndex+1)/(count+1)`
  (`instance-batch.ts:99`, `lit-wgsl.ts:74`). A billboard has no per-pixel world depth.

That single fact — *one depth plane per structure* — is the direct cause of all three
symptoms:

1. **Bridges float.** A billboard cannot be *partially* occluded by terrain, so a footing
   can't disappear below the riverbed; the visible stone starts at the waterline with a gap
   under it. (My first attempt — extend masonry below the bed in the blueprint — proved the
   point: with no depth test the "buried" stone just drew as a bigger visible lump. Reverted.)
2. **Wall/tower draw-order glitches.** Large overlapping barrier slabs/towers sort against
   each other and against buildings by a single per-slab midpoint key with inconsistent
   `Math.floor` and a priority that sits *above* buildings (`entity-draw-list.ts:118-141`,
   `KIND_PRIORITY.barrier=5 > building=4`). Single-plane depth can't resolve interpenetrating
   masonry.
3. **"Not integrated into the world."** The sprite sits *on* the terrain, never *in* it —
   no founding, no cut-in, no mutual occlusion with hills.

## What already exists to build on (this is why it's tractable)

- **The geometry is free.** `toGeometry(rb)` → `StructureSpec` → `partFacets(p)` already
  builds manifold solids per part; `StructureResult` just discards the mesh after
  rasterizing. We keep what we already compute.
- **The depth buffer is shared** (`depth24plus`, `ensureDepth`, `gpu-scene.ts:510-520`) and
  terrain already writes a usable iso depth. A mesh pass emitting the *same* iso depth
  interleaves with terrain for free.
- **The camera/terrain uniforms are reusable as-is.** `terrainGlobalsBuf` (uXform, uGrid,
  uHalf, uZParams, uSun, uAmbient) + the `heights` storage buffer are exactly what a
  terrain-lifted mesh vertex shader needs. The **detail-patch pass**
  (`createDetailPatchPipeline`, `gpu-pipelines.ts:98`) is a working template for "new vertex
  shader + shared terrain bindings, load the depth buffer."
- **The banded-lighting look is fully reproducible in a mesh shader.** It's
  `floor(ndl·bands+0.5)/bands` (bands=4) plus un-banded ambient × AO and a gated banded
  specular, reading the shared `Globals` uniform (`lit-wgsl.ts:130-154`, truth in
  `banded-pbr.ts`). Per-face normals + enum materials + baked AO are all on the facets.
- **Shadows already come from the mesh.** The default `geometry` shadow mode projects the
  *same 3D facets* onto the ground plane along the (pinned) sun and feeds a stencil-union
  pass at `SHADOW_ALPHA=0.32` (`ground-shadow.ts:54-91`). A live mesh can project itself the
  same way — no new shadow philosophy.
- **The divert seam is one branch.** Bridges (`kind:'bridge'`) and stairs
  (`kind:'stair_flight'`) both flow through the *same* building/parametric branch
  (`entity-draw-list.ts:199-241`), distinguished only by `liftElev`. Gate those two kinds to
  a mesh draw item; everything else is unchanged. All metadata a mesh needs — `rb`, `e.x/e.y`,
  `footprint`, `liftElev` — is already on the entity.

## The central tension (the spec must resolve this)

**The entity/sprite pass CLEARS the depth buffer to 0 before drawing** (`gpu-scene.ts:1083`)
so that billboards *always* paint over terrain — the entity index-depth scheme is
deliberately self-contained. Consequence: a structure mesh drawn in the terrain-depth phase
(before that clear) gets correct **terrain** occlusion, but every subsequent sprite (tree,
NPC, building) paints over it regardless of true depth.

For **bridges and stairs specifically this is mostly benign**: sprites near them stand *on*
them (NPC on the deck → correctly on top) or *in front* of them, and a bridge over water
rarely has a tall sprite directly behind it. So the MVP can live in the terrain-depth phase
and accept "sprites over structures." But the general case (a tree behind a curtain wall)
needs a real answer, which is the phase-2 fork:

- **A. Terrain-depth phase, sprites-on-top (MVP).** Cheapest, solves the float + gives
  terrain occlusion + mesh-vs-mesh self-occlusion. Accept sprite-over-structure ordering.
- **B. Unify the depth spaces.** Stop clearing depth before entities; give billboards a real
  iso depth so *everything* interleaves in one buffer. Correct, but touches the entire entity
  depth scheme and every sprite's sort — a large, risky change.
- **C. Hybrid.** Draw structures at the *start* of the entity pass writing a real per-pixel
  iso depth, and have sprites depth-test against them. Requires reconciling painter-order and
  iso-depth spaces — fiddly.

**Recommendation: ship A as the MVP** (bridges + stairs), prove depth-correct terrain
occlusion in the real scene, then evaluate B/C for walls/towers where the ordering bug
actually bites.

## Where the thesis fights canon

- **Pixel-perfect rule.** The user requires 1:1 pixel-perfect art (native sizes, no
  fractional scaling). A mesh rendered live must land on the *same* art-pixel grid the
  sprites use — the pass has to snap to the pixel-doubled scene target
  (`xform`/`sx,sy,ox,oy`) exactly as terrain and sprites do, or structures will shimmer
  against everything else. This is a hard constraint, not a nicety.
- **Cost = $0.** No paid anything. Geometry, materials, and the shader are all local. This
  epic stays inside the spend freeze.
- **Determinism.** Nothing here touches `src/sim/`; it's pure render. But the mesh must be a
  deterministic function of `rb` (same content-addressed key as the sprite path) so the
  studio/tests stay reproducible.
- **Two art paths, not one.** Buildings will *keep* the sprite path (img2img albedo is the
  whole point of that pipeline). This epic is explicitly for **ground-anchored structural
  geometry that has no img2img art and reads as pure massing** — bridges, stairs, then
  walls/towers. Buildings are out of scope unless a later slice proves the mesh look is
  strictly better than grey massing.
- **Walls/towers are a bigger migration.** Barriers are *not* blueprint entities — they're
  `BarrierRun` polylines with a separate draw path (`iso-barrier.ts`). They reuse the mesh
  *pass* but need their own geometry adapter (`BarrierRun + towers → facets`). Sequence them
  after bridges+stairs prove the pass.

## Open questions for the spec

1. **Mesh source of truth.** Return `WorldFacet[]` on `StructureResult`, or factor a
   dedicated `structureMesh(spec)` that stops after `partFacets`? (Lean: a `structureMesh`
   that shares `partFacets` so the sprite and mesh paths can't drift.)
2. **Face vs. smooth normals.** Facets carry per-*face* normals only. Flat-shaded mesh
   (replicate the face normal to 3 verts) preserves today's faceted look — probably correct
   for pixel-art massing. Confirm.
3. **Material at shade time.** Bake per-facet PBR into vertex attributes (albedo + G=AO,
   B=rough, A=metal), or sample analytically? MVP: bake albedo/normal/material into vertex
   attrs from the same `materialPbr` the rasterizer uses — no atlas, no per-pixel material
   sampling.
4. **AO.** Recompute screen-space from the pass's own depth (matches `ao.ts`), or bake
   per-vertex? MVP can ship with a flat/again-baked AO and add screen-space AO later.
5. **Upload/caching.** Per-entity vertex/index buffers keyed by the same content hash as the
   sprite cache; batch by material for draw-call count. When does a mesh get freed?
6. **Culling.** Viewport-cull per structure (they're localized). Reuse the sprite path's
   cull box?

## Payoff

One mechanism retires the bridge float, the wall/tower mis-sort, and the "on-the-world not
in-the-world" flatness — using geometry we already build and uniforms we already upload,
inside the spend freeze, without touching the sim. It also opens the door to real
founding/cut-in (a bridge abutment that plunges into the bank and is *occluded* by it, a
stair cut into a slope) that the billboard renderer can never express.

Related: [[project-rendering-direction]] (WebGPU-only) · the parametric building pipeline ·
`docs/superpowers/specs/2026-06-28-render-perf-engine-pass-spec.md` (shares the pass-order
and uniform plumbing this touches).
