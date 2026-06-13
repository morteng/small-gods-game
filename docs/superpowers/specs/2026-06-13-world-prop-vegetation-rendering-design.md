# World props, vegetation, ground & linear features through the generative pipeline (brainstorm)

**Date:** 2026-06-13 · **Status:** brainstorm (user-directed) · **Builds on:**
[PBR sprite stack](2026-06-09-pbr-sprite-stack-design.md),
[blueprint parameter model](2026-06-08-blueprint-parameter-model-design.md),
[settlement growth/placement](2026-06-13-settlement-growth-placement-design.md)

## What the user asked for

1. Visualise everything the engine *computes* but does not yet *draw*: paths,
   roads, clutter, **wells**, graveyards — "pre-generative texturing to sprites
   or tiles or whatever."
2. Render **trees the same way we do buildings** — crib an open-source 3D tree
   generator to emit a wide variety of vegetation 3D primitives, then push them
   through our existing generative rendering pipeline.
3. Standing principle: keep the chain **open and flexible** so Fate (the LLM
   agent) can influence every stage.

## The state of play (what already draws vs. what doesn't)

Investigated the live pipeline. Three distinct situations — only one is a true
black hole:

| Thing | Status | Gap |
|---|---|---|
| Roads / paths | **Draw** as procedural `dirt_road`/`stone_road` tile variants, autotiled from grid connectivity (`renderer.ts:72`). The `RoadEdge` graph is discarded after carving, but the tiles render. | Flat tinted diamonds, untextured, unlit. |
| Wear-mask ground | **Draws** — `settlement-wear.ts` mutates `tile.type → dirt`; not a layer, a tile swap. | Flat colour. |
| Building ground material | **Draws** as 70%-alpha quads (`iso-ground.ts`). | Flat colour. |
| **Wells / graveyards / civic props** | **Do not draw at all.** `entity-draw-list.ts:67–109` only emits barriers (`_run`/`barrier`), blueprinted buildings (`blueprintOf`), and `category:'vegetation'`. `category:'prop'` falls through silently. Fallback shapes in `entity-kinds.ts` are unreachable. | **Genuinely invisible pixels.** S5/S6 shipped civic props that render nothing. |
| Trees / vegetation | **Draw** as pre-baked 64px sprite-sheet silhouettes (`tree-sheets.ts`) + flat fallback. | **Not generative, not PBR-lit** — flat unlit billboards beside normal-mapped, cast-shadowed buildings. Visual mismatch. |

## The unifying thesis

Everything visible should flow through the **one** generative geometry→sprite
pipeline buildings already use:

> blueprint → manifold CSG → grey G-buffer (albedo/normal/material/emissive) →
> img2img paint → `SpritePack` → PBR-lit WebGL draw item.

Today buildings are the only first-class citizens. The mill proves the move: in
S6 it became invisible-prop → real building blueprint, and it now renders + lights
for free. `EntityClass` is **already** `'building' | 'barrier' | 'plant' |
'terrain_feature'` — the *type* is class-neutral; only the geometry compiler and
the preset catalogue are building-centric. Widening those two is the whole game:
props and trees inherit PBR lighting, cast shadows, day/night, material truth,
and Fate-overridable parameters by construction.

## Slice 1 — props through the building pipeline (smallest, highest impact)

Wells, graveyards, market stalls, troughs, woodpiles, fences-as-props are *small
structures*. Trivial manifold CSG we already have (`solidCylinder/Prism/Box/Cone`):

- **well** = capped cylinder (curb) + two posts + a little gable roof.
- **graveyard** = a seeded scatter of headstone prisms + a low wall/lych gate.

Work:
1. Teach the geometry compiler (`toGeometry`) to compile `class:'prop'` /
   `'terrain_feature'` blueprints (likely reuse `body`/`roof` parts + a new
   `scatter` part for headstones). Keep the existing building path untouched.
2. Add prop presets (`well`, `graveyard`) to the catalogue.
3. In `building-placer.ts`, emit wells/graveyards as **blueprint** entities (as
   the S6 mill already does) instead of bare `CIVIC_ENTITY_KINDS` props — or,
   minimally, route `category:'prop'` into the building branch of the draw list.
   Prefer the blueprint route: it's the on-brand, Fate-friendly path.
4. They then flow through the existing building branch in `entity-draw-list.ts`
   automatically — `blueprintOf(e)` already gates that branch.

Payoff: closes a live invisibility bug (S5/S6 civic props) **and** proves the
"Blueprint goes class-generic" move that slices 2 and 3 depend on. The
`graveyard.buried` count from S6 can later drive headstone density.

## Slice 2 — parametric trees (the explicit ask)

Build a tree-geometry generator analogous to building blueprints. We do **not**
need botanical fidelity — we need a *manifold-buildable primitive*:

- trunk = tapered cone; a few branch cylinders; canopy = 1–3 ellipsoids/blobs;
  union into one CSG solid → `composeStructure` → img2img (turns the grey blob
  canopy into textured foliage) → `SpritePack`.
- **Branching algorithm:** crib **proctree.js** (space-colonisation, MIT, pure
  JS) or a small L-system — but only to *emit CSG params* (trunk taper, branch
  count/angle/length, canopy blob layout), never to render. Manifold does the
  geometry; img2img does the look.
- Species variety = seeded blueprint params + season palette. The existing
  `NATURE_HEIGHT_M` table feeds metric scale; `class:'plant'` already exists.

Payoff: trees get the same normal maps → same sun / day-night / cast shadows as
buildings, killing the flat-billboard mismatch. The pre-baked sprite sheets stay
as the keyless fallback (same author-time seeding story as buildings).

## Slice 3 — generated ground tiles (texture the flat diamonds)

Cheap win, orthogonal to the vector track below. Same img2img pipeline, but the
product is a seamless **tileset**, not a per-entity sprite:

- generate grass / dirt-wear / cobble-market textures + the autotile blob/wang
  variants the existing `blob-autotiler` already selects.
- carry normal maps too → ground lit by the same PBR shader as buildings.
- folds in ROADMAP terrain **phase 4** (offscreen bake) + **phase 6** (normal-map
  lighting), both currently backlogged.

This textures *area* ground. Linear features (roads/paths/rivers) graduate out of
the tile grid entirely — see the next track.

## Track V — vector linear features (roads, paths, rivers) + bridges

**The problem.** Roads, paths and rivers vary continuously in width and wander
sub-tile; pinning them to the diamond grid makes terrain "tile-y" and caps
expressiveness. Root cause: we use **one representation for two jobs** — the tile
grid is both the *sim truth* (walkability, flow) and the *render representation*.
Tiles are right for the first, wrong for the second.

**The core move.** Represent a linear feature as a **polyline/spline centerline +
a per-vertex width profile** — the source of truth — and split the two jobs:

- **Render** strokes a textured **ribbon mesh** along the spline (continuous
  width, sub-tile meanders, real curves/tapers), built on the ground plane (z=0)
  in world metres so the existing 2:1 iso transform foreshortens it correctly.
  Reuses the PixiJS lit-shader **Mesh** seam (`lit-shader.ts`) — a ribbon is a
  quad *strip* with UVs flowing along its length; rivers get normals → sun glint,
  roads get AO in the ruts. Texture via the same img2img author-time seeding
  (one tiling road/riverbed texture flowed along UVs). Band/quantize + pixel-snap
  (or offscreen-bake, terrain phase 4) to keep the crisp pixel-art identity.
- **Sim** rasterizes the same vector into the tile grid as a *derived mask*
  (walk cost, "is road", flow dir). The grid becomes a **projection of the vector
  truth, not the truth itself** — deterministic, cheap, replay-safe. Sim/replay
  never see the ribbon; they see the mask, exactly as today.

We already have the road half: `RoadNode`/`RoadEdge` is a graph with polyline
`.tiles` we currently compute and *discard*. Promote it to source of truth.

**Rivers** are the highest-payoff first target: width = f(**stream order** /
flow accumulation) — a trickle widening to a delta, with meanders and banks — the
one thing a grid can never express ("gradually 1.5 tiles wide"). *Spike entry
point:* promote a single river to a spline ribbon on the WebGL layer before
migrating roads/paths. (Verify first how rivers are currently generated/stored —
roads are a graph; rivers are believed to be `tile.type` from worldgen flow/noise.
If a flow-accumulation field already exists, the width profile is nearly free.)

### Bridges (the milestone where Track V meets Slice 1)

A bridge is just **road-spline ∩ river-spline**. The river's width profile gives
the **span**; the road direction gives the **orientation**; subdividing the span
gives **pier count**. A bridge is then a **blueprint structure** (Slice-1
class-generic family) — deck + railings + abutments + arches/piers, parameterized
by span/material/piers; stone arches reuse the existing `solidArch` CSG and the
same generative pipeline as buildings. Clean separation: **the spline says *where*
and *how wide*; the blueprint says *what it looks like*** — and Fate can override
either ("make this a grand stone bridge").

- **Ford vs. bridge** = a threshold on stream order (deterministic): below it the
  road dips through shallow water (tile stays walkable, no structure); above it,
  a bridge.
- **The one genuinely new thing bridges force: Z.** Every feature so far lives on
  z=0; a bridge's deck arches *over* water that flows *under*. Three touch points:
  1. *Render/occlusion:* the y-sort already carries a per-entry `z` (always 0
     today) — give bridge-span items a real deck z; water/piers/deck/on-deck
     layer correctly by construction.
  2. *Walk-height:* an NPC on the bridge must draw at deck elevation — a per-tile
     `walkZ` offset the span stamps onto its tiles; NPCs inherit it in their sort
     key. (Else they appear to wade.)
  3. *Pathfinding:* the bridge punches a walkable **road-over-water corridor**
     through the water barrier; surrounding water stays impassable. Sim still
     sees only a grid mask.
- **Scoping:** v1 = flat-deck plank bridge, single span, low rails (minimal Z,
  proves crossing-detection + blueprint-placement + walkZ); v2 = stone arches +
  multiple piers for wide rivers. (Mirrors buildings: rect-plan first, medieval
  detail later.)

### Forward marker — terrain height & carving (later)

`walkZ` and the per-entry sort `z` are the **first toe-hold into terrain
elevation**. Deliberately scoped *out* of Track V, but designed toward: a later
track introduces a real heightmap (hills, valleys, cliffs) and **carving** —
rivers incising valleys, roads cut into hillsides, terraced settlements. Bridges'
Z plumbing (deck height, walkZ, z-aware y-sort, over/under occlusion) is the same
machinery elevation needs, so building it bridge-shaped now keeps the door open.
Determinism rule still holds: heightfield is seeded; sim reads a derived grid.

## Seeding & determinism (applies to all three)

Reuse the building author-time pattern: extend `scripts/seed-building-art.ts`
(or a sibling) to seed props / trees / ground tiles into the vendored library so
keyless players get baked art; runtime generate-on-miss for keyed players.
Generation never touches the sim/replay path — the library is the deterministic
interface (ROADMAP determinism rule).

## Suggested order (user approved: "do everything in order")

1. **Slice 1 — props through the pipeline** ✅ SHIPPED (branch `feat/render-props-slice1`)
   — wells & graveyards are now `class:'prop'` blueprint entities that render +
   light through the building branch; in-browser verified (well: textured stone +
   tiled cap; graveyard: headstone scatter w/ shadows). Spec:
   `2026-06-13-render-props-slice1-spec.md`. Fixed the live invisibility bug;
   proved class-generic blueprints (the foundation bridges later reuse).
2. **Slice 2 — parametric trees** (the explicit ask; unifies the visual look).
3. **Slice 3 — generated ground tiles** (texture the flat *area* surfaces).
4. **Track V — vector linear features** (roads/paths/rivers as splines; sim grid
   becomes a derived mask). *Spike:* one river as a spline ribbon first.
   - **Bridges** ride on Track V as its milestone, reusing Slice 1's blueprint
     pipeline + introducing the first `z`/`walkZ` plumbing.
5. **Later — terrain height & carving** (heightmap + river/road incision). Out of
   scope now; bridges' Z machinery is built toward it.

Slices 1–3 are orthogonal and independent. Track V depends on nothing above it
but is the larger architectural step, so it follows the quick wins. Bridges
depend on Track V's splines (can't precede them). Each slice/track gets its own
spec/plan before implementation per house process.
