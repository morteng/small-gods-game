# Full-3D building exteriors + multi-view generative rendering (brainstorm)

**Date:** 2026-06-13 · **Status:** brainstorm (user-directed) · **Builds on:** [PBR sprite stack](2026-06-09-pbr-sprite-stack-design.md), [v6 medieval detail pass](2026-06-12-building-geometry-v6-medieval-detail.md)

## What the user asked for

1. "Use the 3D model more to assist with shadows" — derive cast shadows from the
   actual building geometry instead of the screen-space sprite shear.
2. "Render 2–4 views of each building through the generative pipeline" — fully
   textured buildings viewable from all sides ("four passes").
3. "Model ALL parts of the building exterior in 3D for proper shading and
   generative texturing" — doors, window shutters, windows, hanging tavern
   signs, lanterns… as separately modeled, separately textured parts.
4. Texture **and animate** doors / shutters / windows; tag lanterns as dynamic
   flickering light sources.

## Where we already are (don't rebuild what exists)

- Every building IS a watertight 3D model (manifold CSG) — walls, carved
  door/window apertures + flush leaves, dormers, chimneys/louvres, eaves are
  all real solids with per-facet materials (`src/assetgen/geometry/solids.ts`).
- The pipeline already rasterizes that model into a co-registered G-buffer
  (albedo-grey / normal / material / emissive) and the img2img pass paints ONE
  canonical view (`composeStructure` → chroma pipeline → `SpritePack`).
- The WebGL layer already lights sprites per-pixel from the normal map and has
  an emissive channel waiting for Slice 5 (point lights / flicker).

So "model everything in 3D" is ~80% true today; the gaps are (a) only one
camera view is ever rendered, (b) sub-parts aren't separable (one fused solid →
one sprite → nothing can animate), (c) shadows ignore the model entirely.

## Slice 1 — geometry-true baked shadows (small, do first)

The renderer fakes shadows by shearing the sprite silhouette (fixed 2026-06-13
to a true ground projection, but still silhouette-based: dormers, eaves and
towers all smear into one outline; footprint depth pollutes the shape).

Instead: at assetgen time, project every mesh vertex along the sun ray onto
z=0, rasterize the projected triangles in the SAME iso camera → a 1-bit
**shadow mask sprite**, co-registered with the albedo like normal/material
maps. Pack it as a 5th channel (`SpritePack.shadow`), draw it as the shadow
texture in the Pixi shadow layer (replacing the sheared silhouette for items
that carry one; NPCs/trees keep the shear).

- Exact eave/dormer/tower shadows, no footprint smearing, ground-true shape.
- Cost: one extra rasterize per generation (free — no LLM call; it's geometry).
- Day/night (PBR Slice 4) caveat: a baked mask is per-sun-direction. Options:
  bake 3 masks (morning/noon/evening) and crossfade, or re-rasterize on sun
  change (it's fast, and generation is already async + cached).

## Slice 2 — multi-view rendering (the "4 passes" ask)

Render the SAME model from the 4 iso facings (camera yaw 0/90/180/270°), run
each through the img2img + chroma + registration pipeline → 4 `SpritePack`s
per building, keyed `{recipe}:{model}:{wh}:{hash}:{facing}`.

What it buys, in increasing ambition:
- **Variety now:** the placer can face buildings toward their road/door anchor
  (G1 anchors already store facing) — streets where doors actually face the
  street, using the correct view per facing. This alone fixes the "6/12
  presets aim doors at camera-hidden faces" deferral.
- **Camera rotation later:** Q/E 90° map rotation becomes possible (all 4
  views exist; terrain diamonds are rotation-symmetric; draw list re-sorts).
- **NOT free-rotation 3D:** these stay 2D sprites; 4 views is the honest scope.

Consistency risk: the LLM paints each view independently → material drift
between facings (different stone colour on the north face). Mitigations:
paint view 1, then feed view 1's RESULT as a style reference into views 2–4
(gemini-2.5-flash-image accepts multiple input images); palette-quantize all
four against view 1's palette; accept minor drift (you never see two facings
at once without rotation).

Cost: 4× paid generations — ~$0.156/building, ~$1.90 for the 12-preset
library. Acceptable; seeding stays a one-off authored artifact.

## Slice 3 — separable, animatable parts

Today `toGeometry` fuses everything into wall/roof solids. To animate a door
or shutter, or hang a swinging sign, the part must be its OWN draw item.

- Blueprint compilers emit **part groups**: `{ body, roof }` fused as today,
  plus `attachments: [{ kind: 'door_leaf'|'shutter'|'sign'|'lantern', anchor,
  solidSpec }]`. Each attachment rasterizes to its own mini sprite-pack
  (geometry-only painting is fine for most; signs deserve an img2img pass for
  the painted sign-board).
- Runtime: attachments become child draw items positioned by their anchor
  (world-space anchors already exist from G1), y-sorted with the parent.
  Animation = swapping/transforming the mini sprite (door: closed/ajar/open
  frames from 3 hinge rotations of the same solid; shutters likewise; sign:
  ±6° swing tween; lantern: static sprite + emissive tag).
- **Lanterns/light tags:** attachment carries `light: { color, radius,
  flicker }` → feeds PBR Slice 5 point lights directly. The emissive G-buffer
  channel already exists; this gives it authored sources with positions.
- Sim hooks fall out for free: doors open when an NPC enters (activity system
  knows), shutters close at night (clock), tavern sign exists because the
  blueprint has a `sign` feature with `toBrief()` feeding the LLM prompt.

## Interiors / "voxelized buildings" (user ask, 2026-06-13)

The ask: derive fully voxelized buildings from the 3D geometry + generated
textures — rooms, internal stairs/floors/walls/doors, see-through windows,
buildings fully integrated into the world.

**Honest cost assessment.** Voxelizing the manifold solids is trivial (they're
watertight; occupancy-sample them on a grid). The expensive part is what
true voxels imply: a volumetric RENDERER (cutaways, per-voxel occlusion,
interior lighting) — that's the full 3D-engine rewrite we deliberately banned
(`no-three-in-bundle`), and the generated textures only cover the ONE painted
view; back faces and interiors have no texture source. Real voxels also fight
the crisp pixel-art identity.

**What gets ~90% of the payoff inside the current architecture:**

1. **Interior MODEL first (data, no renderer change):** extend the Blueprint
   compilers with `toInterior` — rooms (body partition), floor plates per
   storey, a stair feature, internal door features → a walkable room graph
   per building. The SIM uses this immediately: NPCs path inside buildings,
   activities happen in named rooms ("the tavern's back room"), Fate can
   stage scenes indoors. This is also exactly the D&D-map shape LLM prompts
   want, and it's renderer-independent.
2. **Dollhouse cutaway through the SAME pipeline:** for a focused building,
   bake a SECOND sprite from the same CSG with the roof + camera-facing
   walls clipped (one extra `composeStructure` pass + img2img paint) —
   interior floors, partitions, stairs and furniture blocks all render and
   get LLM-textured exactly like exteriors. Swap to the cutaway sprite when
   the player focuses/enters; classic iso-game grammar, zero new renderer.
3. **See-through windows:** emissive panes already exist in the G-buffer;
   warm window glow at night (PBR Slice 5) + the cutaway view cover the
   fantasy without per-pixel transparency into a modeled interior.
4. **Tile-voxel hybrid as the far point (DF-style z-levels):** if we ever
   want true walk-inside-with-camera, the grid-native form is storey LAYERS
   (each storey = a tile floorplan rendered when the camera's z-level slices
   it), not free voxels. Defer until the interior model proves the gameplay.

Order: interior model (1) can ride with the separable-parts slice; the
dollhouse bake (2) is its visual payoff one slice later.

## Suggested order

1. **Slice 1** (baked shadow mask) — small, pure-geometry, immediately visible.
2. **Slice 3** (separable parts: door leaf + shutters + sign + lantern tags) —
   unlocks animation AND Slice 5 lighting; no extra paid generation for
   plain parts.
3. **Slice 2** (4 facings) — schedule with a worldgen slice that uses facing
   (street-aware placement from the settlement-growth epic), so the 4× cost
   buys visible variety the same week it lands.

Each slice gets its own spec/plan before implementation per house process.
