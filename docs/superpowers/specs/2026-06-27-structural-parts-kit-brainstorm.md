# Structural Parts Kit — Brainstorm / Design

**Status:** brainstorm (2026-06-27). No code yet.
**Origin:** user direction —
- *"we should consider modularizing on standard modules for e.g. arches. they occur in doorways too, and in buildings for support."*
- *"what other primitives like arches should we modularize? stairs? what else?"* · *"indoor and outdoor stairs, btw."*
- *"and, i mean.. windows have arches sometimes, too…"*
- *"complete structural parts kit plan after considering what other structures should be kit parts. integrate fully with our ECS and rest of renderer systems — and our procedural texturing system that also needs to encompass all building materials and paints etc."*

**Relationship to shipped work:** the kit is the next layer on the parametric building pipeline
(`project-parametric-buildings`, `project-opening-feature-model`) and the grade-reconciliation
connectome (`project-grade-reconciliation-features`: bridges/aqueducts/stairs already consume
`deck`/`pier`/`arch_span`/`stair_flight` parts). It **subsumes and extends** the procedural-material
epic (`2026-06-24-procedural-material-textures-img2img-design.md`) from terrain/roads-only to *all*
building materials plus a new paint/finish layer.

---

## 1. Thesis

Recurring structural elements — arches, columns, railings, vaults, stairs, channels — are each **one
parametric generator**, consumed in multiple **modes** by BOTH buildings and the world connectome
(bridges, aqueducts, walls, irrigation), and driven by **material × finish × era × style ×
ornament**. This is the exact pattern the `roof` module and the generative-`openings` (v10) module
already proved; the kit generalizes it to the rest of the structural vocabulary.

Two payoffs, and the user's framing names both:

1. **Geometry de-duplication.** `pier` / `post` / `baluster` are three columns; deck-parapet /
   stair-balustrade / wall-top / battlement are four railings; bridge-span / aqueduct-bay / **arched
   doorway / arched window** are four arches. Today arches are *all faked as squares* (key finding
   below). One generator collapses the duplication and the fakery.
2. **The texturing system must "encompass all building materials and paints."** A kit part emits
   geometry tagged `(material, finish)`; a **single Material+Finish engine** turns that into textured
   pixels for buildings *and* kit structures alike — the same engine the terrain exemplar layer uses.
   This is what makes the kit and the texturing epic **one epic**, not two.

### Key code finding (verified this session) — there is NO true curved primitive

- `solidArch` (`src/assetgen/geometry/solids.ts:77`) — used by the `arch_span` part
  (`src/blueprint/parts/bridge.ts`) for bridges and now aqueducts — is a **post-and-LINTEL portal**
  (two cube legs + a beam). Trabeated, square, not curved.
- Door/window openings (`carveApertures` / aperture boxes, `src/blueprint/features/opening.ts`) are
  **rectangular subtraction boxes** — square-headed.

So **every "arch" in the game is a square**, in both freestanding and aperture forms. The user's three
arch remarks (support, doorway, window) are the same missing primitive seen from three sides.

---

## 2. The unifying architecture (how a part becomes textured pixels)

The recon traced the full path; the kit slots cleanly into the existing seams. One pipeline, three
already-built junctions:

```
 PartType.toPrims(part, ctx)          ─ ctx.materials + (NEW) ctx.finishes
   → Prim[] tagged { material, finish, style, ornament }     [src/blueprint/parts/*, compose.ts Part union]
 → manifold geometry → WorldFacet[]   each facet carries mat + (NEW) finish + worldPos  [assetgen/compose.ts]
 → rasterizeMaps()                     per-pixel G-buffer: albedo / normal / material / emissive
   → (NEW) sample MaterialLibrary[mat][finish] at facet worldPos  ← the texturing engine    [assetgen/render/rasterize.ts]
 → applyWeathering()                   (NEW) per-material/finish decay rules                  [assetgen/render/weathering.ts]
 → SpritePack { albedo, normal, material, emissive }                                          [render/parametric-building-source.ts]
 → entity (kind=preset, properties.blueprint, footprint, liftElev?)                           [blueprint/entity.ts]
 → entity-draw-list bbox + y-sort + terrain-lift (foot-z OR liftElev)                          [render/iso/*, gpu/terrain-lift.ts]
 → banded-PBR fragment shader          (NEW) honors roughness + finish, not just AO+metallic    [render/gpu/wgsl/lit-wgsl.ts]
```

**Extension points are tiny and additive** (no consumer edits):
- New part = new file in `src/blueprint/parts/`, exported `PartType`, added to the loop in
  `register-buildings.ts:20`. The `PartType` interface (`resolve`/`toPrims`/`toCollision`/`toAnchors`/
  `toBrief`) is the whole contract.
- A part emits standard `Prim`s (`box`/`cylinder`/`cone`/`prism`/`ellipsoid`/`arch`/…) — so **new
  parts get textured/lit/weathered/lifted for free** the moment the engine swaps in.

---

## 3. The kit roster (expanded — "what other structures should be kit parts")

Priority order = build order. Each names **what it unifies**, its **modes**, and its **consumers**.

### Tier A — foundational (highest leverage; do first)

**A1. Arch** *(foundational — vault/dome/arcade/arched-opening all derive)*
- **New** `src/assetgen/geometry/arch.ts`: an arch-ring manifold (extruded voussoir profile).
- **Two modes from one definition:**
  - **SOLID** (freestanding): bridge span, aqueduct arcade bay, building support arcade / loggia /
    undercroft / colonnade head. *Replaces `solidArch`'s portal.*
  - **CUTTER** (subtractive aperture head): door heads, **window heads** ← the user's point; the v10
    openings path gains an `archHead` aperture shape, so `carveApertures` subtracts a curved top
    instead of a square one, and the filler (leaf/pane) follows the arch. **The hook already half-exists:**
    `window.ts:26` already exposes a `style:'arched'` enum value, but `window.ts:58` still emits a flat
    recessed pane — the intent is declared, only the curved cutter manifold is missing. Clean plug-in.
- **Styles** (era-gated): `flat`(=today's portal, kept for parity) · `round` · `segmental` · `pointed`
  · `horseshoe` · `ogee`. Params `spanM/riseM/depthM/ringDepthM` + ornament (`keystone`/`impost`/
  `archivolt`/`voussoir-count`).
- **Slices:** *A1a* solid mode → swap bridge + aqueduct `arch_span` to curved (no building-golden
  churn, only the two connectome presets move). *A1b* cutter mode → arched openings on buildings
  (bumps `ART_RECIPE_VERSION`, re-pins assetgen goldens).

**A2. Column / post / pier / shaft** *(pairs with Arch → arcade)*
- Base + shaft + capital; taper / batter; order; material. **Unifies** bridge `pier`, aqueduct arch
  posts, stair-`balustrade` posts, porch posts, colonnades, timber studs, stall poles, standing
  supports. Highest-leverage pairing with Arch (an arcade = Column × Arch).

### Tier B — surfaces & edges (broad reuse, modest geometry)

**B1. Slab / Platform** *(generalize the existing `deck` part)*
- One horizontal-plane primitive with thickness, edge profile, optional `parapet`. **Unifies** bridge
  deck, aqueduct channel-floor, building floor/storey-slab, terrace, balcony, **jetty**, **podium /
  stylobate** (a thick slab = the base outdoor stairs and temples sit on). `deck` already exists and
  is reused heavily — promoting it to the canonical slab is low-risk, high-coverage.

**B2. Railing / parapet / balustrade / crenellation** *(edge-treatment family — one profile run along
an edge)* — **ADJUSTED: this is EXTRACT-AND-UNIFY, not greenfield.** `barrier.ts:10` already models
`crenellated`/`posts` and `iso-barrier.ts:131-166` already renders merlons + per-vertex posts; `deck`
already does `parapet:'both'`. The work is **extracting one shared edge-profile generator** from those
two bespoke paths so the *same* profile serves bridge decks, aqueduct channel walls, stair edges,
balconies/terraces, defensive wall-tops (`project-defensive-constructions` DC-1/2/3) and fences.
Sub-styles: open balustrade · solid parapet · crenellation (merlon/crenel) · picket fence · coping
course. Lower-risk than it looks; mostly de-duplication.

**B3. Wall** *(unify barrier-runs + building body walls)* — **ADJUSTED: higher conflict, sequence
LATE.** DC-1/2/3 barriers are shipped (`barrier.ts`/`enclosure.ts`/`place-barrier.ts` +
`iso-barrier.ts` render). Merging that with the building `body` wall path touches the **barrier render
path and entity-draw-list categories** — the highest-churn surface in the kit. Defer until A/B parts
are in. Prep step that de-risks it: in K3 extract a generic `slabSplit()` from `iso-barrier.ts` so any
long run (wall, arcade, colonnade) reuses one y-sort interleave instead of re-merging the barrier code.

### Tier C — derived & specialized (cheap once A exists; concrete near-term consumers)

**C1. Vault & dome** — barrel vault = Arch extruded, dome = Arch revolved (near-free once A1 exists).
Undercrofts, cisterns, bridge soffits, wells, monumental interiors.

**C2. Buttress** — pilaster / battered base / flying (= an arch). Tall walls, temples, **retaining
walls / embankments** (pairs with G2 fill in grade-reconciliation).

**C3. Channel / trough / conduit** — lined trench / covered conduit / open flume. The aqueduct fakes
this today with deck+parapet; the real one **directly feeds G7 irrigation** (next on the
grade-reconciliation roadmap), plus mill races, drains, moats. The most concrete near-term consumer.

### Stairs — ONE generator, THREE siting authorities

Not a new primitive (`stair_flight` + `landing` exist; `stairTreads()` already derives tread geometry
from a `construction` quality knob). The work is **exposing the existing generator to three siters**:
- **terrain-grade** — BUILT (G3a–G3d grade reconciliation; outdoor cliff/path steps).
- **indoor** — NEW, sited by the building/room graph: between floor levels, undercroft, tower,
  mezzanine. Adds enclosure within walls + headroom vs the slab above + winders/spiral + under-stair
  space; implies an **Arch-cutter stairwell opening** through the floor above.
- **outdoor architectural** — NEW, sited by the entrance/site layer (not terrain grade): perron/stoop
  at a doorway, monumental temple flights on a stylobate (B1), terrace/harbour steps, amphitheatre
  tiers (= "steps as a profile"). Leans on the railing family (B2) + Arch cutter (stairwell).

### Deliberately NOT new primitives

`roof` (already the richest module; only gap = lightweight canopy/awning for market_stall/tents —
`project-building-opening-system`) · **tower** (a composition of column + wall + railing + roof) ·
**truss / timber-frame** (a composition, lives inside roof) · point props (lamp, bench — stay lifted
entities, no kit geometry).

---

## 3½. Gameplay gating — the **buildability envelope** (user requirement, 2026-06-27)

> *"a connectome must limit what kinds of structures it spawns to technological and economic limits of
> current gameplay. that spreads into the whole connectome, too."*

This is the concern that turns the kit from an art system into a **gameplay** system. A society must not
build what it cannot yet build. The kit gives us a rich vocabulary (pointed arches, stone aqueducts,
vaulted undercrofts) — but **whether a given settlement may use a given part is gated by where that
society is on the tech and wealth axes**, and that ceiling must propagate through the *entire*
connectome (buildings, roads, bridges, aqueducts, walls, irrigation), not just one structure.

### The envelope is a function of two axes the game already simulates

```ts
interface BuildabilityEnvelope {           // resolved per settlement (or region), per current sim state
  tech:    TechLevel;     // what they KNOW how to build  ← era × aggregate believer UNDERSTANDING
  economy: EconomyLevel;  // what they can AFFORD to build ← settlement wealth × labour × local resources
  // → derived allow-lists, consulted by every part generator AND every connectome placer:
  materials: Set<MaterialId>;     // e.g. early village: {wattle, timber, thatch}; no dressed stone
  finishes:  Set<FinishId>;       // bare/daub early; limewash/ochre later; polychrome/gilt only rich+advanced
  structures: Set<StructureKind>; // ford < timber footbridge < stone arch bridge < aqueduct
  archStyles: Set<ArchStyle>;     // round/segmental earlier; pointed/ogee gated by tech
  maxSpanM: number; maxStoreys: number; maxRiseM: number;  // engineering ceilings scale with tech+economy
}
```

- **Tech axis = era × understanding.** This is *the god-game's own progression made physical*. Era
  (`ERA_PROFILES`) sets the baseline; **aggregate believer `understanding`** (the existing
  faith/understanding/devotion model — `understanding` already gates sign-perception & prayer efficacy,
  Track 1) raises or lowers it locally. A settlement whose followers deeply understand the god unlocks
  ambitious works earlier; a backwater stays in timber. The player's cultivation of understanding
  literally **unlocks architecture** — a satisfying, legible feedback loop.
- **Economy axis = wealth × labour × resources.** Settlement wealth/size (the S1–S6 growth model) +
  available labour + *local* material availability (no quarried stone ⇒ no ashlar, even if tech allows).
  A monumental temple is a tech AND economy gate; a wealthy but primitive town builds big in timber, a
  poor but advanced one builds small but refined.

### How it propagates through the whole connectome (the "spreads into the whole connectome" part)

The envelope is resolved **once per settlement/region** and threaded into every placer as a filter —
the connectome already routes/sites; it gains a *capability predicate*:

- **Buildings:** `building-placer` picks presets/materials within `envelope.materials/structures` (extends
  `project-building-validity-situation` Tier-1 auto-fix: an out-of-envelope choice **snaps to the
  envelope-nearest legal one** instead of rendering an anachronism).
- **Crossings (bridges):** the grade-reconciliation crossing-siter chooses ford → clapper → timber deck →
  stone arch bridge **by envelope**, not just by span. A low-tech/poor crossing is a ford even where an
  arch would fit.
- **Aqueducts / irrigation (G6/G7):** an aqueduct is a *high* tech+economy structure — the demand model
  already exists; the envelope **gates whether the aqueduct is offered at all**, and if offered, its
  channel material and whether elevated runs may use stone arcades vs timber trestles.
- **Walls/defence:** palisade (timber, cheap) vs crenellated stone curtain (advanced, rich) — already
  partly era-gated in `enclosure.ts`; the envelope makes it uniform with everything else.
- **Roads:** dirt track vs gravel vs cobbled — the `usedness`/traffic signal already shipped; the
  envelope caps the *paving ceiling* by economy (a poor village never cobbles).

### Why this belongs in the kit plan (not a separate epic)

Because the kit is the thing that *creates the choices*. The moment we add pointed arches, vaults and
stone aqueducts, we MUST also answer "who is allowed to build them" — or every village sprouts
cathedrals. So the envelope is a **foundational, cross-cutting layer of the kit**, resolved before any
part generator runs, and it is the natural home for the user's tech/economy mandate. It also gives the
kit its **gameplay payoff**: structures become a visible readout of a settlement's belief-driven
advancement — exactly the Small Gods loop.

**Scope note / non-goal:** the envelope *reads* sim state (era, understanding, wealth, resources) but
**must not write it** — it's a pure query, keeping `src/sim/` `Math.random`-free and the gating
deterministic. It's a capability *filter* over generation, not a new simulation.

---

## 4. ECS integration (flat entities, blueprint-level composition)

Ground truth from recon — the kit must follow these exactly:

- **Each part = one entity. The ECS is flat; there is no parent/child.** An arcade = N arch entities +
  N column entities + 1 channel/deck entity, all sharing an **id namespace**
  (`${assemblyId}:${role}:${index}`, e.g. `aqueduct:src->town:arch:9,5-12,5`). This is the proven
  aqueduct/bridge pattern (`aqueduct-structures.ts`, `crossing-structures.ts`).
- **Composition happens at the blueprint level, not the entity level.** A single arch-bay *blueprint*
  bundles arch + springing posts into its `parts`; the entity holds the resolved blueprint in
  `properties.blueprint`. Sub-parts never become child entities.
- **Entity shape** (`blueprintEntity()`, `src/blueprint/entity.ts:27`): `kind = preset`,
  `tags = [category, subcategory]`, `properties = { category, blueprint, footprint, anchors, era,
  liftElev? }`. New presets: `arcade_bay`, `colonnade`, `wall_segment`, `vault`, `buttress`,
  `irrigation_channel`, `stair_indoor`, `stair_perron`, … each `category:'infrastructure'` (or
  `'building'` for parts that *are* a building's structure).
- **Stacked structures (deck on arches on ground):** the **top deck** carries `liftElev`
  (render-elev override; rides its authored water/floor line); **supports below it omit `liftElev`**
  and foot-sample the terrain (`terrain-lift.ts`: `liftElev` path vs foot-z path). Y-sort by
  far-corner `(sortTx+sortTy)` interleaves the stack correctly. This already works for aqueduct
  arcades — the kit just makes it the general rule.
- **Mutation discipline:** never mutate `x/y/kind/tags` directly — `World.updateEntity()` syncs both
  index layers (the dual-index gotcha). Placement claims cells in the `OccupancyGrid`
  (`building-placer.ts`); kit runs that occupy ground (walls, arcades, channels) must claim too, so
  routing/spacing respects them (ties to `project-spatial-coordination-epic` C1 visual-extent).

**Long runs render via slab-splitting**, not one giant sprite: the `barrierSlabs` pattern (one entity,
per-depth `${id}#${slab}` draw items) is promoted to the shared mechanism for walls and arcades so a
50-tile colonnade interleaves with whatever stands in front of each bay.

---

## 5. Renderer integration (no new render paths)

The kit emits the **same `Prim`s** the building pipeline already rasterizes, so it inherits the entire
renderer with zero new paths:

- **Geometry → SpritePack:** `toPrims → partFacets → projectFacets → rasterizeMaps → composeStructure →
  SpritePack {albedo, normal, material, emissive}`. A new part is just more facets.
- **Draw-list bbox** is computed from the resolved parts' footprint claims (`entity-draw-list.ts`), so
  multi-part blueprints size correctly with no special-casing.
- **Banded lighting** (ambient + one sun, quantized bands, AO from `material.G`) and **stencil cast
  shadows** apply unchanged. Emissive (glass, v12) glows at night by `emissive·uNight`.
- **Terrain-lift** composes the stack (foot-z for supports, `liftElev` for decks) — §4.
- **Caching / freeze:** kit structures render as **grey massing now** (reseed frozen) exactly like
  buildings — *except* the procedural-texture engine in §6 gives them real surface detail **without
  paid img2img**, which is the freeze-safe win.

**Two renderer extensions the kit needs (both in §6's engine):** the banded-PBR shader currently uses
only AO + the metallic mask and **ignores roughness**; finishes need it to honor roughness + a finish
code. That's a shader change, not a path change.

---

## 6. Procedural texturing — "encompass all building materials and paints"

This is the load-bearing new half. Current reality (recon-verified): building materials are a flat
`Mat` union of 12 (`stone/timber/plaster/thatch/tile/brick/slate→stone/glass/metal/…`), each a **flat
grey-ref albedo + PBR constants** — **no surface texture at all** unless img2img repaints (FROZEN). The
terrain exemplar engine (`material-exemplar.ts`: seamless metre-scale procedural tiles with albedo +
normal) **exists but is dormant and terrain-only**. Blueprint `Palette {walls, roof, trim}` exists but
**only feeds img2img prompts** — it never reaches geometry or pixels. So today there is **no paint
layer and no building-surface texture**. The kit's requirement forces closing all three gaps.

### 6.1 One Material+Finish library, shared by terrain and structures

Promote the dormant terrain `material-exemplar.ts` into the **canonical Material engine** and extend
its roster to every building material:

- **Materials** (surface micro-structure, metre-scale): the terrain set (grass/dirt/rock/sand/snow/mud
  + road dirt/gravel/cobble) **plus** building surfaces — *ashlar stone, rubble stone, brick (bonds),
  dressed timber + grain, log, wattle-and-daub, plaster, thatch weave, slate, clay tile, rammed
  earth, marble*. Each = a seamless procedural function `f(worldPos, normal) → {albedo, normalDetail,
  roughness}` at real FEATURE_M scales (the engine already keys features in metres).
- **Finishes / PAINTS** (a NEW orthogonal layer over a material): `bare · limewash · whitewash ·
  ochre · red- earth · tar/pitch · polychrome · gilt · mossed · soot`. A finish is a *recolour +
  roughness/coverage modifier* applied over the material's micro-structure (limewash = high-albedo
  near-white that lets stone courses read faintly through; tar = dark low-roughness on timber). This
  is what the user means by "and paints etc."

```ts
interface SurfaceSpec { material: MaterialId; finish?: FinishId; tint?: RGB }  // resolved from Blueprint.materials + Palette
function sampleSurface(spec, worldPos, normal): { albedo: RGB; normal: Vec3; roughness: number; ao: number }
```

### 6.2 Where it plugs in (rasterize-time, so buildings AND kit parts get it)

The single highest-leverage junction is **`rasterizeMaps()`** (`assetgen/render/rasterize.ts`): it
already walks every pixel of every facet with interpolated depth — interpolate **world-xyz** too and
call `sampleSurface(facet.surface, worldPos, facet.normal)` to fill albedo + perturb normal + write
roughness into the material channel. Because it's at rasterize time:
- **Every kit part and every building** gets textured by the *same* engine — no per-part work.
- It's the **grey-init for img2img later** (the §-aligned epic), so funded reseed becomes a quality
  lift into the same slot, not a rewrite.
- **Freeze-safe:** procedural-now is `$0` and on by default; img2img is OFF until funded.

### 6.3 The G-buffer and shader changes (small, bounded)

- **Carry `finish` to the facet.** `Blueprint.materials` → resolve `Palette` (walls/roof/trim → per-
  region finish) → `WorldFacet.surface = {material, finish, tint}`. This finally makes `Palette` real.
- **Use the roughness channel.** `material.B` is *written but ignored* by banded-PBR today; the shader
  starts honoring it (matte plaster vs glossy marble vs fuzzy thatch) + a small per-finish branch
  (limewash chalk-matte, gilt specular). One shader edit, no new texture binding (room exists in the
  4-byte material RGBA; the finish code can ride a few bits or a 5th packed channel if needed).
- **Weathering per material/finish** (`weathering.ts`, today: grime-on-all + rust-on-metal): add
  timber-rot, thatch-decay, plaster-flaking, slate-moss, limewash-fade, gilt-tarnish — gated by
  `(material, finish)`. Intensity already deterministic per-asset (no `Math.random`).

### 6.4 Era gating of materials & finishes

**ADJUSTED — materials are ALREADY era-gated.** `eras.ts` `ERA_PROFILES` + `eraPatch()` already rewrite
wall/roof material + window style per era; `connectomeOpenings` reads `eraWindowStyle`. So the *material*
half of era-gating exists. This section narrows to: (a) extend the same mechanism to the **NEW finish
layer** (allowed finishes per era — limewash classical, polychrome later, etc.), and (b) hand off the
*structure-type* and *economic* half to the **buildability envelope** in §3½ — which is the deeper
gameplay concern and where the user's "technological and economic limits" requirement lives.

---

## 7. Slice sequence (each shippable, green, freeze-safe)

Geometry and texturing interleave so each slice is visible. **Track T3 (KE, below) runs in parallel
from day one** — it's a different subsystem (sim-query + placer filters) with no chokepoint overlap.

0. **KE — Buildability envelope (§3½, gameplay gating).** Resolve `BuildabilityEnvelope(settlement)` from
   era × understanding × wealth × resources; thread it as a capability predicate into every connectome
   placer (buildings/crossings/aqueducts/walls/roads). Pure sim-read filter — no `Math.random`, no
   assetgen/golden touch. **Parallel-safe; ideal web session.** Gates *which* kit parts a society may use,
   so it shapes how the geometry slices land in the world even before all parts exist.
1. **K0 — Material+Finish engine (texturing foundation).** Promote `material-exemplar.ts` to the
   shared engine; add building materials + the finish layer; wire `sampleSurface` into `rasterizeMaps`
   behind a flag; make `Palette` resolve to facet `surface`. *Buildings gain real procedural surface
   texture with no paid gen.* Bumps `ART_RECIPE_VERSION`; re-pins assetgen goldens. **Biggest visible
   win, unblocks the freeze-grey look.**
2. **K1 — Arch (solid) + Column.** `arch.ts` curved manifold; swap bridge + aqueduct `arch_span` to
   curved; `column.ts` unifies pier/post. *Real arches replace square portals on infrastructure.*
   Bumps `WORLD_CONTENT_VERSION`.
3. **K2 — Arch (cutter): arched openings.** Doors + windows get arched heads via the v10 openings
   path (← the user's "windows have arches too"). Re-pins building goldens.
4. **K3 — Slab/Platform + Railing family.** Generalize `deck`; add balustrade/crenellation/coping;
   retrofit defensive wall-tops.
5. **K4 — Wall (unify barrier-run + body wall)** with openings + coping + slab-split render.
6. **K5 — Channel/trough** → hand off to **G7 irrigation**.
7. **K6 — Vault/dome + Buttress** (cheap derivations).
8. **K7 — Stairs: indoor + outdoor-architectural siters** (generator exists; add the two siting
   authorities + stairwell Arch-cutter).
9. **K8 — Era gating + per-material/finish weathering** validation pass.
10. **K9 (deferred, funded) — img2img upgrade** of material/finish tiles into the same slot
    (`seed-material-textures.ts` + `GeneratedTextureSource`, OFF until reseed).

---

## 7½. Parallelization plan (user requirement — "what could run in a separate session")

**State (verified 2026-06-27):** single clean checkout on `main`; no active `sg-*` worktrees; the
"site-anchors owned by another session" guardrail is **not currently live**. So parallel work = fresh
worktrees I (or web sessions) create off `main`.

### The conflict surface is small and known — four chokepoint files

Multiple slices all touch: `src/assetgen/compose.ts` (the `Part` union), `src/blueprint/register-buildings.ts`
(the registration loop), `src/core/content-version.ts` (`ART_RECIPE_VERSION`/`WORLD_CONTENT_VERSION`), and
`tests/unit/assetgen-golden.test.ts` (re-pinned hashes). Everything else is in **disjoint directories**.

**De-risk step (one tiny prep commit on `main` BEFORE forking):** pre-declare the `Part` union variants
for *all* kit prims (arch-curved, column, slab, railing, channel, vault, buttress) even though only stubs
exist, and reserve the registration slots. Then each parallel session adds its *implementation* without
re-editing the union or the loop → the chokepoints stop being conflict points. Golden re-pins are
serialized at merge (each session pre-commits its expected hashes; updater runs once per merge, in order).

### Recommended split — three tracks that touch disjoint dirs

| Track | Slice(s) | Owns (dirs) | Conflict with others | Run as |
|---|---|---|---|---|
| **T1 — Texturing** | K0 Material+Finish engine | `src/assetgen/render/*`, `material-exemplar.ts`, `materials.ts`, `material-pbr.ts`, `lit-wgsl.ts` | only the version+golden chokepoint | **local worktree** (needs the GPU/dev-server visual loop — `__debug.grab`) |
| **T2 — Geometry** | K1 Arch(solid)+Column, then K2 cutter | `src/assetgen/geometry/*`, `src/blueprint/parts/*`, `features/window.ts·door.ts` | version+golden + the K1→K2 internal order | **local worktree** (visual verify of curved arches) |
| **T3 — Gameplay gating (design+sim)** | §3½ buildability envelope | `src/sim/*` query + `src/world/connectome/*` placer filters + a design doc | **none** — different subsystem, no assetgen/golden touch | **Claude Code web** (pure logic+docs, no GPU loop needed) — ideal remote candidate |

**Why this split:** T1 and T2 are the two halves that *look* coupled (both make sprites) but live in
different directories — render/rasterize vs geometry/parts — and neither hard-depends on the other (a
curved arch renders as grey/flat-LUT massing fine without the finish engine; the finish engine textures
existing geometry fine without curved arches). They share only the version+golden chokepoint, handled by
the prep commit. **T3 is the cleanest remote/web candidate**: it's sim-query + connectome-placer logic
with no WebGPU visual loop, no assetgen goldens, and no chokepoint-file edits — it can run start-to-finish
in Claude Code web while T1/T2 run locally where the render loop matters.

**Do NOT parallelize:** K1→K2 (cutter needs the solid arch manifold first); K4 Wall-unify against
anything (it churns the barrier render path — single-owner, late); the golden re-pin step (serial by
construction).

### My decision

Spec the three foundational pieces first (they're independent docs, zero file conflict), **in parallel**,
then implement T1+T2 in local worktrees with T3 on web. The spec drafts are the immediately-profitable
parallel action; I can kick them off now on request (or you point a web session at the §3½ envelope while
I take T1/T2 locally).

---

## 8. Non-goals / guardrails

- **No paid generation now.** Everything above is procedural-`$0` and freeze-safe; img2img (K9) lands
  OFF behind the spend cap until a funded reseed. (Standing constraint: *"do not spend money yet."*)
- **WebGPU-only**; integrated-GPU is quad/fill-bound — bound noise octaves, analytic-derivative
  normals over multi-tap, gate procedural ops to the fragments that need them.
- **No sim coupling.** Texturing/finish/weathering are cosmetic; `src/sim/` stays `Math.random`-free.
- **No render-path rewrite.** The kit reuses the existing Prim → rasterize → SpritePack → draw-list →
  lit-shader path; only the rasterize sampling + the banded-PBR roughness/finish read are new.
- **Don't fork the connectome.** Bridges/aqueducts/stairs already consume parts — migrate them onto
  the kit parts in place; don't add a parallel path.
- **Coordinate footprints** via the OccupancyGrid (`project-spatial-coordination-epic` C1) — kit runs
  that occupy ground must claim cells.

---

## 9. Open questions for spec time

1. **Finish encoding** — fit the finish code into the existing 4-byte material RGBA (steal bits from
   roughness/metallic) or add a 5th packed channel? (Buffer budget is tight elsewhere, but sprite
   G-buffers are CPU-side textures, not the 8/8-bound terrain pass — likely free to add a channel.)
2. **World-UV vs local-UV** for surface sampling — world-xyz gives seamless cross-facet continuity and
   consistent metre scale, but means a sprite isn't position-invariant (two identical buildings differ
   slightly). Acceptable (adds variety) or pin to local-UV with a per-asset seed?
3. **Exemplar cardinality** — one procedural function per material, parameterized by finish at sample
   time (cheap, infinite finishes) vs pre-baked (material × finish) tiles (img2img-ready but
   combinatorial). K0 favors the former; K9 bakes the chosen subset.
4. **Slab/deck migration** — promote `deck` in place (rename + extend) or add `slab` and deprecate
   `deck`? In-place avoids a connectome churn.
5. **Indoor stairs need a floor-level model** — does the building/room graph already express storeys
   richly enough to site inter-floor flights, or is that a prerequisite sub-spec?
```
