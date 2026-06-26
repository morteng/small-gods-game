# Parametric stairs & bridges — "all kinds, popping out of the connectome"

**User direction (2026-06-26):** *"wooden stairs of all kinds. all kinds of stairs, in the
same way we support all kinds of buildings. and bridges. just pops out of the connectome, all
of it."*

This is the implementation spec for **G3 (stairs) + G4 (above-ground deck) + G5 (bridges)** of
the grade-reconciliation epic
(`docs/superpowers/specs/2026-06-26-grade-reconciliation-feature-vocabulary-brainstorm.md`),
sharpened by the user's mandate that stairs and bridges be **parametric families** (like the
building blueprint pipeline), not fixed presets, and that they **emerge from the world
connectome**.

## The key finding: it's already 80% built

Recon (4 explore passes) established that the user's vision needs almost no new architecture —
only wiring + one small renderer extension:

1. **The parametric pipeline is class-neutral.** `Blueprint.class` already includes
   `'terrain_feature'`; part types are registry-driven (`paramSchema → toPrims → manifold →
   SpritePack`). The `box`/`cylinder`/`prism`/`arch` prims already exist (`arch` is exactly a
   bridge arch). A new part type that emits these prims gets the *entire* resolve → compile →
   render → cache pipeline for free. **"All kinds of stairs like all kinds of buildings" = a new
   `stair_flight` / `deck` / `pier` part type. Nothing structural is new.**

2. **The crossing connectome is fully built and silently drops its output.**
   `detect-crossings.ts → CrossingSpec` (reads `edge.bridgeCells`) → `crossing-builder.ts`
   (era×prosperity gates: log-plank footbridge → timber trestle → dressed-stone arch) →
   `realize-crossing.ts → Placement[]` (categories `span`/`pier`/`building`/`apron`/`feature`).
   `crossing-structures.ts` instantiates only `category==='building'` placements; **`span` and
   `pier` placements are computed and thrown away** (the ribbon render pass was retired
   2026-06-25). Bridges already pop out of the connectome — they have **no render path**.

3. **The one genuinely-new capability (G4): authored entity height.** Every entity is lifted by a
   *single* terrain foot-z anchor (`terrain-lift.ts liftAt`). Stairs are fine — a flight sits ON
   the slope at its base anchor, billboarded, exactly like a building. But a bridge **deck**
   floats *above* the terrain/water at a feature-authored height. So a deck-segment entity must be
   able to carry an explicit "this sits at world-elevation E (the grade line)" instead of snapping
   to the (low) ground below. That is a **small, contained `terrain-lift.ts` extension** — an
   optional `liftElevM` on the draw item — **not** the full per-vertex mesh primitive one might
   fear. Piers descend from deck to riverbed and are billboarded from their *foot* anchor
   (riverbed) like any building, so they need nothing new.

## Decision: segmented SpritePack structures, not a mesh primitive

Bridges and stairs are realized as **placed, y-sorted SpritePack entities** through the existing
building pipeline — a long span = a *sequence* of short deck-segment + pier + arch entities, each a
3D-modelled parametric structure billboarded at its own anchor. This is exactly how the user framed
it ("same way we support all kinds of buildings") and honours the standing mandates: maximal reuse,
lean/performant, freeze-safe.

- **Freeze-safe:** with the img2img reseed frozen, these render as **grey parametric massing** —
  correctly *shaped* decks/arches/flights/railings. That is a large improvement over the current
  "carved-terrain-through-water" look, at **zero API cost**.
- **Rejected (deferred):** a true `mesh` `DrawItem` with per-vertex heights (new draw-list variant
  + GPU pipeline + lift rework). More general but a big renderer change; segmented SpritePacks match
  the iso/tile idiom and the building pipeline. Revisit only if long flat viaducts read wrong at
  oblique zoom.

## Parameter model (the "all kinds" knobs)

A stair/bridge is a `Blueprint` (`class:'prop'`) whose parts emit raw prims. The construction
spectrum (`construction ∈ [0,1]`, mirroring `road-state.ts deriveRoadState`) drives style
continuously: **scramble → cut-stone → dressed/accessible**.

- **`stair_flight`** — `material` (timber/stone/brick), `riseM`, `widthM`, `treads` (or derived
  from rise & a target riser), `construction` (rough rubble → cut blocks → even dressed treads),
  `stringer` (timber side strings under wooden flights), `railing` (none/one/both). Switchbacks =
  multiple flights + `landing` parts (a wider platform) composed in the blueprint, exactly like
  multi-wing buildings. → boxes (treads), boxes (stringers/landings), cylinders+box (rail).
- **`pier`** — `material`, `heightM` (foot→deck), `widthM`, `batter` (taper). → box/prism/cylinder.
- **`deck`** — `material`, `lengthM` (one segment), `widthM`, `thicknessM`, `parapet` (rail).
  Carries `liftElevM` so the segment rides the grade line. → box (+ parapet boxes/posts).
- **`arch_span`** — `material`, `span`, `rise`, `thickness`. → the existing `arch` prim.

These map straight onto the crossing-builder's existing outputs (`material: log-plank|timber|
dressed-stone`, `span`, `arches`, `width`) — the connectome *already* decides the family; we only
give it geometry.

## Slices

- **G3a — stair generator (this slice).** New `src/blueprint/parts/stair.ts` (`stair_flight` +
  `landing` part types) emitting treads/stringers/railings as prims; register in
  `register-buildings.ts`; base presets (`stair_wood`, `stair_stone`, `stair_scramble`,
  `stair_grand`) in `BUILDING_BLUEPRINTS`; geometry test (tread count/rise/width invariants +
  material spectrum). Pure pipeline reuse, **no renderer change** — synthesizable by name like any
  building. Delivers "wooden stairs of all kinds."
- **G4 — above-ground deck.** Add optional `liftElevM` to the `image` `DrawItem` + honour it in
  `terrain-lift.ts liftItem` (use `liftPxFromElev(liftElevM,…)` instead of the terrain sample).
  `deck`/`pier`/`arch_span` part types. Parity test for the lift override.
- **G5 — wire the crossing connectome.** In `crossing-structures.ts`, stop dropping `span`/`pier`
  placements: synthesize `deck`/`pier`/`arch_span` blueprints from each placement's resolved
  params (material/width/span/height/deck-elevation) and emit entities. Bridges render.
- **G3b — site stairs from grade.** The G1 grade-envelope diagnostic flags path segments over
  envelope; convert those runs to stair placements (scramble→dressed by construction). Additive
  `traversal-cost` tag (keep behind the existing sim cost model).
- **Version + verify.** Bump `WORLD_CONTENT_VERSION` (worldgen output changes), perf bench at
  gameplay zoom, **visual verify via `__debug.grab()`** (clear IDB `small-gods-saves` first —
  stale-autosave gotcha), re-pin goldens, suite green.

## Determinism & constraints

All derived from the persisted graph + seed; nothing new persisted (re-derives on load, the
road/river precedent). Presets generative, not hand-tuned. No img2img (freeze) — grey massing.
Commit explicit paths; do not push without a green build + explicit ask.
