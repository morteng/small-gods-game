# Roads as Carved Terrain — Brainstorm / Design

**Status:** brainstorm (2026-06-24). No code yet. Supersedes the ribbon-render half of
`2026-06-14-roads-linear-features-connectome-design.md` (Slice 1 "roads as RenderEdge ribbons").
**Origin:** user direction — *"we don't want road ribbons, just carve road profile (and curbs)
into terrain. then road can interact fully with other terrain features like water, ice, snow and
so on."* Plus an algorithm-audit ask: *"review our road algorithms… we are supposed to have really
good road systems according to that research."*

## Thesis

A road is **not a thing we draw — it is a thing the terrain *is*.** There is no separate ribbon
mesh and no second render path. A road is exactly two writes into substrates that already exist:

1. a **carved cross-section** in the shared height-deformation channel
   (`heightAt = baseSeedHeight ⊕ deformations`, `src/world/terrain-deformation.ts`), and
2. a **surface signal** in the per-cell material field (alongside `moisture`/`temperature` in
   `src/render/gpu/terrain-field.ts`).

Because both ride the *same* unified field the terrain + water shaders already read (the
T-A/T-B/T-C material gradient from `2026-06-18-terrain-water-shader-system-research.md`),
road↔terrain interaction is **emergent, not special-cased**:

- crowned profile + curb lips → a gutter channel → water runs to the edges and pools in ruts for
  free (water surface is already `surfaceW − terrainH`);
- flat carved bed + cold temperature → snow accumulates via the existing snow band;
- paved surface + cold + wet → reads as icy cobble (ice/snow/wet are already temperature × moisture
  in the material composite);
- a sunken hollow-way that dips below the water table fills with water automatically.

That is the whole payoff of "roads are just terrain": every interaction with water/ice/snow/mud
falls out of the unified field. We add **two extensions to existing channels**, not a new system.

## The load-bearing finding: the carve is only as good as the centerline

Carving the profile **follows the road polyline directly**. So a bad centerline becomes a bad
trench. Today's centerlines are bad in ways that were hidden under the (now-cut) ribbon plan but are
fatal for a carve:

An audit of the shipped road algorithms (2026-06-24) against the research picks in §11 of the
2026-06-14 design found that **the research-endorsed scaffolding shipped, but almost none of the
algorithms that make road *networks* look good did.** The "really good road system" is in the doc,
not the code — build stopped at Slice 0 (+ partial hierarchy classing + the grade-cut from the
deformation epic).

| Research pick (§11 of 2026-06-14) | Status | Reality |
|---|---|---|
| Graph-incremental growth, seeded | half | Graph-as-truth exists (`road-graph.ts`), but it walks a predetermined `Connection[]` — not *grown* from POI seeds. |
| Hierarchy = type labels per edge | ✅ | `classForConnection` (`road-graph.ts:107`) tiers highway/road/track/path by endpoint significance. |
| Junction proximity-snap (split crossed edges) | ❌ | Explicitly skipped (`road-graph.ts:24`). Crossing roads overlay as tiles — **no real network topology**, just a bundle of independent POI→POI paths. |
| Centripetal Catmull-Rom centerlines | ❌ | The *decided* spline pick — unbuilt. Polylines are raw **4-connected grid cells** (`road-walker.ts:106`): orthogonal staircases, never smoothed. |
| Road-reuse discount (slice 4) | ❌ | `walkRoad` has no "cheaper to follow an existing road" term → minor roads don't bundle into trunks; each POI pair carves its own parallel path. |
| Grade-aware cost | crude | Linear `50 × |Δelev|` (`road-walker.ts:126`), no max-grade cap → roads climb anything for a price; no contour switchbacks. |
| Pathfinder perf | crude | Open set is a `Set` with an **O(n) linear min-scan per iteration** (`road-walker.ts:95-98`) → O(n²); self-flagged "replace with a heap." |
| Hydrology-first rivers (Strahler) | ❌ | Out of scope here — separate epic, and the water/flora session is near that ground. |

**Why this is now a prerequisite, not a nicety:** a 4-connected staircase centerline carved into the
heightfield becomes a **staircase ditch** — stepped walls, water pooling in each step instead of
flowing down the gutter, ugly faceting. Smoothing and grade-discipline move from cosmetic (under a
ribbon) to *load-bearing* (under a carve).

## Road as a connectome projection — the parameter model

**(Added 2026-06-24, user direction:** *"footpaths follow terrain, a cobbled prosperous highway cuts
through more terrain because they spent more on workers modifying terrain. then there is age, upkeep,
repairs, overgrowth… they change with time… we have to get the road system fully into the world
connectome on all levels."*)

The carve is **not keyed on `RoadClass`** — `class` is one input among many. A road is an **edge on
the unified world connectome** whose carve/surface/overgrowth are a **projection of its derived,
time-varying state**, exactly as "one renderer = projection of one connectome." The class enum
becomes a coarse fallback; the real driver is a derived `RoadState`:

| `RoadState` field | Derived from (connectome) | Drives in the carve/surface |
|---|---|---|
| **construction** (0..1, engineered earth-moving effort) | endpoint **prosperity** × **era/tech** × **importance/traffic** | how hard it cuts: a footpath *follows* terrain (low → level-target tracks base, detours steep ground); a prosperous cobbled highway *cuts a flat graded shelf through* the hill (high → flat target, tolerates deep cuts + steeper max-grade because they paid laborers). Also width + curb presence. |
| **surfaceMaterial** (dirt/gravel/cobble/paved) | construction tier + era + prosperity | surface channel (Slice 2), curb crispness, edge hardness, gutter depth |
| **width** | traffic + construction + class | carriageway half-width, crown |
| **condition** (0..1, upkeep) | is the route still **live** (connectome flow)? maintained by a still-**prosperous** endpoint? age, last repair | crisp vs slumped edges, curb integrity, rut depth |
| **age** (years) | sim time since built / last rebuild | cumulative wear, overgrowth onset |
| **traffic** (0..1) | connectome edge **flow** (trade/pilgrimage/military) | rutting + packing; suppresses overgrowth |
| **wear** (0..1) | age × traffic × (1−condition) | rut depth, surface roughening, edge feather widening |
| **overgrowth** (0..1) | (1−traffic) × age × climate (moisture/temp) | surface shifts back toward vegetation, carve softens. **Coordinated with the flora session — roads emit an overgrowth intensity the scatter/flora layer reads; roads do NOT place plants.** |

**Carve cross-section = f(RoadState, terrain slope).** Every cross-section parameter (cut strength,
max-grade tolerance, carriageway width, crown, curb height, gutter/ditch depth, rut depth, edge
feather, surface-irregularity noise) is a function of `RoadState`, not a constant table. "Footpaths
follow terrain, prosperous highways cut through" falls out of `construction × slope`.

**Time evolution (the "change with time" ask).** `RoadState` is a **pure function of (connectome
state, age/maintenance counters, climate)**, and the carve is a pure function of `RoadState`. So:
- a low-frequency **road-system tick** (+ a closed-form time-skip form, mirroring D1/D2) advances
  `age`, recomputes `condition` from live connectome state, accrues `wear`, grows/recedes
  `overgrowth`, and applies **repair events** (reset wear/condition);
- a changed edge **re-derives its deformation + surface over just its AABB** → a dirty region on the
  incremental-world-update-substrate. Roads become a producer on that substrate. A settlement
  collapsing (node prosperity ↓) → its roads lose upkeep → decay + overgrow, **emergently**.

**"Fully into the connectome on all levels."** Road edges are first-class **Portals** on the unified
world connectome (roads-epic Slice 6, pulled forward to foundational). Attributes flow *down* from
node state (settlement prosperity, era) and edge flow (traffic); carve/surface/overgrowth project
*out* onto the terrain field. The road system is connectome-native, not a terrain afterthought.

### Build sequencing for the parameter model
- **Now:** build the carve to take a rich `RoadState` bundle from day one; derive that bundle from the
  connectome signals that exist today (endpoint prosperity/importance, era, surface, class, climate).
  This makes "footpaths follow / prosperous highways cut through" work immediately, with the right
  seam.
- **Built (Slice 4):** the road-system **tick** (age/condition/wear/overgrowth) + decay + repair +
  re-derivation, slotted in *without* reworking the carve (it already consumes `RoadState`). See
  "Slice 4 — Time-evolution" below.
- **Still follow-on:** per-edge **connectome** drive of upkeep/traffic/climate (replacing the class
  defaults); full **Portal** unification; **overgrowth↔flora** coordination (roads emit an
  overgrowth intensity the scatter layer reads — roads never place plants).

## Scope & slices

Sequence: fix the centerline first, then the `RoadState`-driven carve, then texture, then time +
connectome, then loosen placement. Each slice is independently shippable and visually verifiable.

### Slice 0 — Centerline quality (the prerequisite)
Make the polyline worth carving. In `src/terrain/road-walker.ts` + a new smoothing step:
- **Any-angle / 8-connected pathfinding** (or Theta* line-of-sight) → no more orthogonal staircases.
- **Centripetal Catmull-Rom (α=0.5)** smoothing of the cell path into a centerline spline (research
  pick #4, already decided). Interpolates through POIs/waypoints, no cusps (Yuksel 2011).
- **Grade-aware cost + max-grade cap** → non-linear slope cost; roads switchback up hills instead of
  climbing straight. This is what reads as a *constructed* road once carved.
- **River relationship in routing** (user direction 2026-06-24: *"roads run next to rivers, or cross
  them where it is possible and convenient"*). The cost model gains water-relationship terms:
  - **valley/bank affinity** — a *discount* for travelling on land adjacent to water, so roads follow
    river valleys (gentle grade, the natural corridor) instead of ignoring them;
  - **crossing cost ∝ span** — crossing penalty scales with the run of consecutive water cells, so a
    road crosses where the river is **narrow** (and roughly perpendicular), not anywhere;
  - **convenient-crossing reuse** — an existing crossing/ford site is cheap to reuse, so crossings
    *concentrate* into shared bridge points. The crossing itself is a **sited PLACE** (the road stops
    at the banks, a bridge/ford is generated) — that siting belongs to
    `2026-06-20-river-crossings-generative-sites-brainstorm.md`; this slice only provides the cost-model
    hooks (`bridgeCells` already flags where a crossing happens) that feed it.
  `construction` modulates this too: a footpath fords/detours; a prosperous highway can afford to bridge
  a wider span head-on.
- **Heap open-set** (perf hygiene; kills the O(n²) scan).
- *Defer within this slice if needed:* road-reuse discount (bundling into trunk+feeder) and junction
  proximity-snap (split crossed edges). These make it a *network*; do them once the single-road carve
  looks right.

**Verify:** one road between two POIs over a hill renders as a smooth graded centerline (not a
staircase), with a switchback where the direct line is too steep.

### Slice 1 — Cross-section carve profiles
In `src/world/road-deformation.ts` (the existing producer on the shared channel). Replace today's
single "level-to-segment-mean" op with a **per-class cross-section sampled by distance-to-centerline**:
- crown in the middle, gutters at the shoulders, optional side ditches;
- per-class character: `path` = sunken hollow-way, `track` = shallow rutted, `road` = graded +
  shoulder, `highway` = raised crowned causeway;
- **curbs** = a raised kerb lip along the edges (an `add` band just outside the carriageway), which
  is what creates the gutter that makes water pool/run for free.

Pure deformation math — the producer the channel was built for. Composes with earthworks/rivers via
the existing priority-ordered blend ops.

**Curb resolution nuance:** crown/ditch/sunken-bed (~0.3–1 tile features) read fine at tile or
near-tile resolution. A curb *lip* (~0.15 m) is genuinely sub-tile → two coexisting options:
(a) cheap default = a shaded curb edge in the *material* channel (Slice 2); (b) true geometry = let
the **already-merged detail-patch sub-tile mesh** (`src/world/terrain-detail.ts`, mask already keys on
carve regions) sample the carve. The earlier "sub-tile detail is inert" finding was about *revealing
base terrain*; a carved road profile is deliberately-added high-frequency *content*, so the detail
pass has real signal to show here. Dynamic resolution earns its place for road profiles specifically.

**Verify:** a carved road shows a crowned cross-section; water pools in the gutters / runs to the
shoulders; a sunken path below the water table fills.

### Slice 2 — Surface / material channel
Add a per-cell `surfaceId` / paved-weight field packed next to `moisture`/`temperature` in
`src/render/gpu/terrain-field.ts`, written by the road producer. The terrain shader folds it into the
existing height-blend gradient as **one more input** — so cobble/dirt/trodden-earth paint correctly
*and* ice/snow/mud/water all compose on top through the same machinery. This is also exactly the field
that would later run through img2img (deferred — reseed is frozen; this slice only *produces* the
field).

**Verify:** a stone road reads as cobble; the same road in a cold zone reads as snow-dusted/icy
without any road-specific ice code.

### Slice 4 — Time-evolution (BUILT)
Roads age, wear, are repaired, and overgrow. `src/world/road-evolution.ts` is the pure,
deterministic stepping model over the time-varying half of `RoadState` (`RoadDynamics`):

- `condition` degrades by `traffic + weather`, is repaired by `upkeep` (the maintenance balance);
- `wear` integrates use minus upkeep (rut depth, edge softening);
- `overgrowth` greens over a **neglected, low-condition** road — traffic (trampling) and upkeep
  (clearing) hold it back; and
- `ageYears` is monotonic time.

Rates are tuned so a state-kept **highway stays pristine for a century** while a **neglected path
ruins and is reclaimed in ~50 years**. Large steps integrate in ≤1-year sub-steps, so a single
*jump-N-years* call matches an N-times-stepped one — the model is **replay- and time-skip-safe**.

Integration is stateless: `RoadGraph.evolvedAtTick` carries the evolution clock **on the graph**
(persisted, survives snapshot/save), and `RoadGraph.rev` bumps when dynamics change, folding into
the carve + surface **cache keys** so an evolving world re-derives. `advanceRoadEvolution` gates the
heavy re-derivation to ≤2×/in-game-year. The live `RoadEvolutionSystem` (0.1 Hz heartbeat) ticks it
in play; `applySkip` (D2) advances it across a closed-form jump. No `Math.random` — sim-deterministic.

Because the carve and the surface both read `edge.dynamics`, an overgrown road **softens its cut
AND fades back to biome** (the `baseType` cleanup pays off: low pavedness reveals the grass under
the road). `upkeep`/`traffic` default from road **class** today; per-edge **settlement prosperity**
and per-edge **climate** (weather-system wetness) are the connectome follow-up — the `EvolveOptions`
`upkeepFor`/`trafficFor`/`climateFor` seams already exist for it.

### Slice 3 — Connectome loosening
Reserve **road corridors before lots subdivide** in `src/world/settlement-plan.ts` so the carve has
good ground to sit on, rather than roads being placed last and threading whatever gaps remain.

## Roads render entirely through the terrain shader (no road pass)

After Slice 1+2 there is **no separate road/ribbon render pass** — a road's whole 3D
appearance is produced by the terrain shader: the **carve** (height channel) shapes it, the
**surface channel** (binding 6 pavedness) gives it its material albedo, and the existing
material gradient lets snow/mud/ice/wet compose on top. Roads are terrain.

Caveat / cleanup: the legacy `dirt_road`/`stone_road` **tiles** still exist (NPC walkability,
minimap, 4-connected flood invariants) and still tint the biome base colour in
`packColorField`, which is now mildly **redundant** with the surface channel. That's benign
(both paint road-ish colour), but a follow-up can stop special-casing road tiles in
`packColorField` so the road's look is *purely* carve+surface — the tiles then carry only
sim/walkability semantics.

## Engine-wide contextual blend (object ↔ terrain grounding)

**(User direction 2026-06-24:** *"texture blend where wilderness can gradually grow into/onto
road, buildings get tint from terrain they are placed on… effective for rocks placed in nature.
should be an engine-wide thing with different parameters for different objects."*)

The road surface channel is the **first instance** of a general principle: **every placed object
samples the unified per-cell terrain context at its footprint and blends toward it, with
per-object-type parameters.** One shared seam, many consumers:

- the **unified per-cell context** already exists for terrain (biome colour, material weights,
  moisture, temperature, road, wetness, snow — `terrain-field.ts` + the T-A/B/C gradient). Generalise
  "sample the context at a position" into a reusable read the *entity* passes can call too.
- each object type carries **blend params**: `groundTint` (pick up the ground colour at its base —
  a rock in grass greens slightly, on sand sands), `edgeBlend`/`skirt` (silhouette feathers into the
  surroundings instead of a hard cut), `overgrowthSusceptibility` (how readily moss/vegetation
  reclaims it — high for ruins, ~0 for a kept road), `wetnessResponse`/`snowResponse` (does it darken
  when wet, cap with snow).
- **road↔wilderness** is just this with the road's params: as `RoadState.overgrowth` rises,
  `road-surface.ts` fades pavedness → biome grass returns → the flora scatter reclaims it. Same
  machinery grounds a **rock** (groundTint + skirt), tints a **building** by its pad terrain, and
  weathers a **ruin** (overgrowth). It also unifies with the existing sprite **skirt/affordance-graph**
  and **sprite-weathering** work.

**Ownership / sequencing.** This is a cross-cutting seam like the deformation channel — design it as
shared, build instances per owner: **roads = this session** (done as the first instance);
**rocks/trees/overgrowth scatter = the flora/rock session** (their files — coordinate, don't touch);
**building tint = a renderer/building task**. It also wants the incremental substrate (context changes
→ re-blend the affected objects). Recommend a small standalone brainstorm doc for the engine-wide
version rather than overloading this roads spec; the road instance proves the pattern.

## Cross-session coordination (read before building)

- **Shared deformation channel is a cross-session seam** (`spec-shared-terrain-deformation-channel`).
  Extend `terrain-deformation.ts` via the brush/op vocabulary; do **not** fork it. Earthworks + rivers
  also write it.
- **The flora / rocks / trees session owns its files** — stay out of `src/blueprint/parts/flora*.ts`,
  `src/render/tree-sheets.ts`, `public/sprites/trees/`, and vegetation entity-kind work. The surface
  channel (Slice 2) must not collide with their scatter/placement work.
- **Reseed / img2img is frozen** ("don't spend money yet"). Slice 2 produces the field only; running
  it through img2img waits for a funded pass.
- **Branch off `main`** for the code (this working tree is currently on the flora branch). Commit
  explicit paths; never push unless asked.
- **`baseHeightAt` vs `heightAt`:** siting/affordance reads `baseHeightAt` (else a road's own carve
  feeds back into where it was routed — circular); rendering/water/collision read `heightAt`. The road
  producer writes deformations; `walkRoad` cost must keep reading base terrain.

## Open questions (carry into spec)

- **Reuse discount vs junctions — order?** Both make it a network. Lean: reuse discount first (bundling
  is more visible than T-junction caps), junction snap second.
- **Curb default — material edge or detail-patch geometry?** Ship the cheap material edge first; gate
  true sub-tile curb geometry behind zoom + the detail mask. Decide whether geometry curbs are worth
  the patch cost after seeing the material version.
- **Surface field type** — single `surfaceId` enum vs a small weight vector (paved/dirt/trodden). A
  weight vector composes more gracefully with the existing height-blend; lean that way.
- **Determinism** — carve + surface writes are pure functions of the (smoothed) graph; persist the
  graph, re-derive on load (mirrors `reconcileSettlementTiles`). Smoothing must be seed-deterministic.

## Code anchors

- pathfinder: `src/terrain/road-walker.ts` (`walkRoad`)
- graph: `src/world/road-graph.ts` (`buildRoadGraph`, `RoadEdge.class`)
- carve producer: `src/world/road-deformation.ts` (per-class `CARVE_STRENGTH`/`HALF_WIDTH_TILES`)
- shared channel: `src/world/terrain-deformation.ts` (`Deformation`, blend ops, `heightAt`)
- per-cell fields: `src/render/gpu/terrain-field.ts`; climate source `world/heightfield.ts:getClimateFields`
- terrain material shader: `src/render/gpu/wgsl/terrain-wgsl.ts`
- sub-tile detail (curb geometry option): `src/world/terrain-detail.ts`, `src/render/gpu/detail-field.ts`
- placement loosening: `src/world/settlement-plan.ts`
- research (picks §11, slices §10): `docs/superpowers/specs/2026-06-14-roads-linear-features-connectome-design.md`
