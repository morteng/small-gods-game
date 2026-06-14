# Roads & linear features through the connectome + unified renderer (brainstorm)

**Date:** 2026-06-14 · **Status:** brainstorm (pre-spec) · **Author:** consolidation pass

**Consolidates three prior threads:**
- [world prop/vegetation rendering — Track V](2026-06-13-world-prop-vegetation-rendering-design.md) (the spline-truth / grid-mask split + bridges)
- [unified renderer over the connectome](2026-06-14-unified-renderer-connectome-design.md) (the `RenderGraph` seam, `RenderEdge` linear features)
- [fact catalogue + connectome](2026-06-14-worldbuilding-fact-database-design.md) (roads = Portals at world scale; `TerrainProbe` bidirectional seam)

**Fills three gaps those threads left thin:** (a) POI-aware routing, (b) meta-waypoints, (c) two-way road↔WFC/terrain constraint flow.

> ✅ A deep-research best-practices pass (24 sources, 24/25 claims adversarially
> confirmed) is folded into §11 and reconciled into the leans below. Headlines:
> graph-incremental road growth (not literal L-systems); hierarchy as typed edges;
> centripetal Catmull-Rom centerlines; proximity-snap junctions at runtime + geometric
> junction caps at bake; hydrology-first drainage graph (Strahler width + carve
> operators) for rivers. The one unproven piece is WFC pre-collapse (§11.7) — no cited
> precedent, so it's the experimental slice.

---

## 1. The question this answers

> "We want roads fully integrated into our unified world connectome and rendering
> system — aware of POIs and any meta-waypoints and all kinds of things,
> bidirectional with the WFC system, and so on."

Roads today **work as data** (they path, grow, route doors, bridge rivers) but
**render as flat tinted diamonds** and are **architecturally orphaned**: each road
representation computes a polyline, then *throws it away* into the tile grid. The
graph that knows *why* a road exists (which POIs it connects) is severed from the
geometry that draws it and from the terrain it crosses. This brainstorm unifies the
three into one model.

## 2. Code reality (what exists, 2026-06-14 post-consolidation)

Two road representations, both of which **discard their polyline into tiles**:

| Layer | Code | Produces | Fate of the polyline |
|---|---|---|---|
| **Inter-POI** | `src/terrain/road-walker.ts` `walkRoad()` | terrain-aware A* path: `{cells[], cost, bridgeCells}`, slope + water + bridge cost, reads `fields.elevation` | rasterized to `dirt_road`/`stone_road` tiles by `map-generator.ts`, then **dropped** |
| **Intra-settlement** | `src/world/settlement-plan.ts` | `RoadNode{id,x,y,kind:'founding'|'junction'|'end'}` + `RoadEdge{a,b,tiles[],kind:'through'|'lane'}` in `SettlementPlan` | tiles persisted in `GameMap.settlementPlans`; **render reads the tile swap, not the edge** |

Three seams already built **and waiting** for exactly this work:

| Seam | Code | State |
|---|---|---|
| **Render** | `RenderEdge {kind:'road'|'river'|'wall', polyline:[x,y][], width, material?}` + `RenderGraph.edges(region)` | declared, returns empty — *"empty until Track V"* |
| **Connectome↔terrain** | `TerrainProbe.affordanceAt(x,y): Record<string,unknown>` on `ExpandCtx.terrain` | declared, unwired |
| **Heightfield** | `TerrainView.heightAt(tx,ty)` / `materialAt` | shipped (R1) — `heightAt = baseSeedHeight ⊕ deformations` |

**The whole job is to stop discarding the polyline.** Promote it to the source of
truth, hang it off the connectome as a Portal edge, draw it through `RenderEdge`,
and let it both read terrain affordances and write terrain/grid deformations.

## 3. First principles (the model)

1. **A road/river is a connectome edge (Portal) whose geometry is a spline.** The
   *graph* says it connects POI-A to POI-B (and why — trade, pilgrimage, military);
   the *spline* (centerline + per-vertex width profile) says where it physically
   runs and how wide. These are one object viewed two ways, never two objects to
   keep in sync.
2. **Spline is truth; the tile grid is a *derived mask*.** Sim/replay/pathfinding
   read a deterministically-rasterized grid mask (walk cost, is-road, flow dir).
   They never see the spline. Render reads the spline (continuous width, sub-tile
   meanders, real curves). One source, two projections — exactly the
   connectome→Blueprint→geometry "resolve down" pattern, one scale up.
3. **Bidirectional with terrain/WFC by two opposing flows** (the heart of the ask):
   - **Up (affordance):** terrain/WFC tell the router where roads *can* and
     *cheaply* go — slope, water, biome, existing-tile constraints. This is
     `TerrainProbe.affordanceAt` + `walkRoad`'s cost function, generalized.
   - **Down (projection):** the chosen spline writes back — rasterized walk mask,
     heightfield grade-cut deformation, and WFC tile constraints (pre-collapse
     road/bank tiles along the centerline). The grid the player sees is
     `baseWFC ⊕ roadProjection`.
4. **Everything seeded & deterministic.** Splines derive from `(worldSeed, edge
   endpoints, waypoints)`; the grid mask and heightfield deformation are pure
   functions of the spline. Replay-safe by construction (the sim only ever touches
   derived masks, ROADMAP determinism rule).

## 4. The unified road graph — POIs, waypoints, hierarchy

This is gap (a)+(b) — the part prior docs only gestured at.

### 4.1 One graph, three node ranks
The connectome already nests Zones (world ▸ region ▸ settlement ▸ district ▸
building). Roads are **Portal edges between Zone nodes at the matching scale**:

- **POI nodes** — settlements, mines, shrines, gates (existing `RoadNode kind:'founding'` at settlement scale; world POIs at world scale). The *endpoints* of a road edge.
- **Junction nodes** — where roads fork/cross (existing `kind:'junction'`). Created where two edges' splines intersect; promotes a crossing into a first-class graph node so routing can reuse it.
- **Waypoint nodes** (NEW — gap b) — intermediate control points on an edge that are *not* POIs or junctions: a mountain pass, a ford, a wayshrine, a bend forced around a lake. They are spline control points with optional semantics. A waypoint is how Fate or worldgen says "the road must pass *here*" without inventing a POI. They also anchor meta (rest stops, ambush sites, milestones, toll points).

### 4.2 Hierarchy (highway vs lane)
Roads carry a **class** that sets width, priority, and routing cost discount:
`highway > road > track > path`, mirroring the existing `RoadEdge.kind:'through'|'lane'`
one scale up. Higher classes:
- route first and get a **reuse discount** (later roads prefer to merge onto an
  existing highway then branch — this is how real road trees form and how we avoid
  a spaghetti of parallel paths),
- render wider with better material (paved highway vs dirt track),
- pre-collapse stronger WFC constraints.

### 4.3 Routing between POIs
The connection topology (which POIs link to which) is a graph problem distinct from
the geometry (how the spline runs):
- **Topology:** a connectivity graph over POIs — candidate edges scored by distance
  + terrain cost, reduced to a sensible network (spanning tree for "everywhere
  reachable" + a few extra cycles for realism; trade-importance weights which links
  upgrade to highway). *(Exact algorithm — MST vs Steiner vs gabriel-graph vs
  Delaunay-relative-neighbourhood — deferred to §11 deep-research; `walkRoad`
  already gives per-pair cost to feed any of them.)*
- **Geometry:** for each chosen edge, `walkRoad` A* produces the terrain-aware tile
  path → simplified to a spline through its waypoints. The A* cost function IS the
  "up" affordance flow; it already reads elevation and avoids water.

## 5. Bidirectional integration with WFC / terrain

This is gap (c) — the explicit "bidirectional with the WFC system."

WFC generates terrain tiles from adjacency constraints; roads are continuous
vector features. Reconcile them with a **two-phase, two-way** flow (final picks
pending §11):

**Up — terrain informs roads (already partly live):**
- `walkRoad` reads `fields.elevation` for slope cost and tile type for water cost.
  Generalize its cost source to `TerrainProbe.affordanceAt(x,y)` so the router sees
  height/slope/biome/WFC-tile-kind uniformly. A WFC "cliff" or "marsh" tile becomes
  a high routing cost; "valley floor" becomes cheap. Roads thread terrain *as
  generated*.

**Down — roads constrain terrain/WFC:**
- **Pre-collapse:** before (or alongside) WFC, stamp the road/river centerline mask
  as **fixed cells** (a road tile, a riverbank tile) and let WFC propagate around
  them. The vector says "river here"; WFC fills consistent banks/shallows. This is
  the standard "pre-seed the wave" technique for forcing features into a constraint
  solver.
- **Heightfield deformation:** the spline writes a grade-cut/incision into the
  world heightfield (`heightAt = baseSeedHeight ⊕ roadCut ⊕ riverIncision`), exactly
  the `⊕ deformations` slot the renderer/connectome already agreed on. Roads flatten
  a shelf; rivers carve a channel. Deterministic from the spline.

**Ordering question (→ §11):** does the heightfield/road network generate *before*
WFC (roads as boundary conditions) or *after* (roads thread finished terrain)? Lean:
heightfield first → road topology+splines routed on it → splines pre-collapse WFC
tile constraints → WFC fills the rest. This keeps one acyclic deterministic pass
while still being "bidirectional" in the sense that matters (terrain shapes roads
via cost; roads shape terrain via deformation + tile pre-collapse).

## 6. Terrain carving & Z (toward elevation)

- **Grade-cut / incision:** a deformation function `(spline, widthProfile) →
  heightfield delta`, composed under `heightAt`. Roads cut into uphill, fill
  downhill (cut-and-fill); rivers monotonically descend and incise. Pure, seeded.
- **Z / walkZ:** bridges (next section) are the first features with non-zero deck
  elevation. The render y-sort already carries a per-entry `z` (always 0 today);
  bridge spans get a real deck `z`, and a per-tile `walkZ` lifts NPCs onto the deck.
  This is the deliberate toe-hold into full terrain elevation — built bridge-shaped
  now so the later heightmap track reuses the same plumbing.

## 7. Rendering — ribbon mesh through `RenderEdge`

The render seam is already shaped for this:
- Fill `RenderGraph.edges(region)` from the promoted road/river graph: each edge →
  `RenderEdge {kind, polyline, width, material}`.
- The GPU layer strokes a **textured ribbon (triangle-strip) mesh** along the
  polyline on the ground plane (z=0 in world metres → the existing 2:1 iso
  transform foreshortens it correctly), lit by the same sun/ambient as buildings
  via the `lit-shader` Mesh seam. Roads get AO in the ruts; rivers get normals →
  sun glint and a flow-scrolled UV.
- **Width profile** tapers per-vertex: rivers widen by stream order (a trickle to a
  delta); roads narrow on tracks, widen on highways.
- **Junctions/forks** are the genuinely fiddly bit (→ §11): where ribbons meet,
  either miter the strips or drop a small junction "patch" quad. Promoting
  crossings to junction *nodes* (§4.1) gives a clean place to author that patch.
- **Pixel-art identity:** band/quantize + pixel-snap (or offscreen-bake per terrain
  phase 4) so curved ribbons keep the crisp look, same as building sprites.
- Texture via the same author-time img2img seeding (one tiling road/riverbed texture
  flowed along arc-length UVs); keyless players get the vendored bake.

## 8. Bridges & fords (where it all meets)

A bridge is `road-spline ∩ river-spline`:
- river width profile → **span**; road direction → **orientation**; span subdivision
  → **pier count**.
- A bridge is a **blueprint structure** (the class-generic Slice-1 family already
  shipped) — deck + railings + abutments + arches/piers, parameterized; stone arches
  reuse `solidArch` CSG and the same generative pipeline as buildings. The spline
  says *where/how wide*; the blueprint says *what it looks like*; Fate overrides
  either.
- **Ford vs bridge** = a deterministic threshold on stream order: below it the road
  dips through shallow water (tile stays walkable, no structure); above it, a bridge
  with deck `z` + `walkZ`.
- `walkRoad` already emits `bridgeCells` — that set seeds crossing detection.

## 9. Determinism & save-safety

- Spline = f(worldSeed, edge endpoints, waypoints, class). Grid mask, heightfield
  deformation, and WFC pre-collapse constraints are all pure functions of the spline.
- Persist the **graph** (nodes + edges + waypoints + class) like `settlementPlans`
  already persists; re-derive masks/deformations on load via a `reconcile` pass
  (mirrors `reconcileSettlementTiles`). Sim/replay only ever touch derived masks.
- Author-time seeding extends `seed-building-art.ts` siblings for road/riverbed/
  ribbon textures into the vendored library.

## 10. Suggested slices (each its own spec→plan→build)

0. **Promote the polyline (the seam fill).** Stop discarding road paths: store the
   `walkRoad`/`RoadEdge` polylines as a first-class **road graph** (nodes incl.
   waypoints + classed edges). Render unchanged (still tiles). Pure refactor + new
   data; guard with goldens. *De-risks everything; nothing visual yet.*
1. **Roads as `RenderEdge` ribbons.** Fill `RenderGraph.edges()` from the graph;
   GPU ribbon mesh, lit, width-by-class, pixel-snapped. First visible payoff.
2. **River spline + hydrology.** Promote rivers to splines with stream-order width
   (highest-payoff render — "1.5 tiles wide" a grid can't express). Spike: one river.
3. **Bidirectional WFC/terrain.** `TerrainProbe.affordanceAt` feeds `walkRoad` (up);
   spline pre-collapses WFC tiles + writes heightfield grade-cut/incision (down).
4. **POI routing + waypoints + hierarchy.** Connectivity graph over POIs (network
   reduction §4.3), highway/track classes + reuse discount, Fate-placeable waypoints.
5. **Bridges & fords.** `road ∩ river` → blueprint bridge + ford threshold + first
   `z`/`walkZ`.
6. **Connectome unification.** Road edges become Portals on the world-scale
   connectome multigraph; meta (trade/pilgrimage/military edge types) layers on.

Slices 0–2 are the quick render wins; 3–4 are the architectural core of the ask;
5 is the milestone; 6 closes the connectome loop. Sequence and the algorithm picks
in §4.3/§5 reconcile against the deep-research pass.

## 11. Best practices (deep research, 2026-06-14)

Five-angle fan-out, 24 sources, 24/25 claims adversarially confirmed. The findings
**validate the architecture** and sharpen three picks. Source caveat: the most
directly-applicable sources are strong worked examples (two theses + Watabou's
devlog) plus two peer-reviewed anchors — proven implementations, not industry
consensus.

**1. Road network generation → graph-incremental growth, NOT literal L-systems.**
The proven, deterministic, terrain-adaptive pattern is **graph-based incremental
road growth** (nodes typed by hierarchy, edges = roads), seeded for replay-safety —
this is exactly what Watabou's MFCG does ("roads grow organically like veins… each
road can adapt to the terrain, descending to water, going around a hill") and the
LiU L-system thesis. **Both descend from Parish-Müller "Procedural Modeling of
Cities," and Watabou deliberately scrapped the literal L-system string-rewriting**
(it scales *exponentially* — hours for big nets) while keeping the road-growth core.
→ Confirms our §4.3 "growth from POIs + per-edge A*" over a heavyweight grammar.
*Tensor-field + multi-agent* (Zhang & Shi 2022) gives good major/minor hierarchy but
its only published impl is on **proprietary ArcGIS Engine** — use for hierarchy
*ideas* only, not the engine. (Refuted 1-2: the claim that a graph carrier is
*necessary* for L-systems to form road cycles — it's a convenience, not a requirement.)

**2. Hierarchy = type labels on graph nodes/edges** (highway/street/track/path,
arbitrary depth), with per-type growth rules. → Directly confirms §4.2's road
`class` and the roads-as-typed-Portals model.

**3. Junctions → growth-time proximity-radius snap at runtime; geometric meshing at
bake.** The cheap, proven runtime model: each edge carries an `IntersectRadius`; a
new edge crossing an existing one **snaps to the crossing and splits the crossed
edge to insert a junction node** (LiU). The *geometric* junction pipeline
(offset control points by ribbon width → De Casteljau → Jarvis-March hull → SAT →
Sutherland-Hodgman clip → merge) is **benchmarked as non-real-time** (~30 FPS at
only ~20 intersections, SAT-dominated) → **confine it to author/bake time** — which
suits our manifold-bake pipeline exactly. → Resolves the §12 junction question:
graph proximity-snap at runtime, geometric junction caps baked.

**4. Spline = centripetal Catmull-Rom (α=0.5).** Provably the only Catmull-Rom
parameterization with **no cusps and no self-intersection within a segment**
(Yuksel 2011), and it **interpolates *through* its control points** — ideal for a
centerline pinned to ordered POIs + waypoints. It's the centerline type in the
shipping Unity Road Generator. Cubic Bézier is the documented alternative *only*
when you need its convex-hull property for geometric junction collision (→ a
bake-time concern, per finding 3). → Confirms §7's lean; **decides the §12 spline
question: centripetal Catmull-Rom.**

**5. Ribbon mesh = sweep a 2D cross-section along the centerline** at even arc-length
intervals, triangulate between rings; generate a **separate edge strip** (curb/bank)
with its own width/thickness. Width is per-vertex → modulate by river stream order.
(Malmö thesis + Unity Road Generator.) → Confirms §7 verbatim; for pixel-art, sample
cross-sections at banded/integer widths and pixel-snap arc-length UVs.

**6. Rivers → hydrology-first drainage graph + Strahler + carve operators
(Génevaux et al., ACM TOG 2013 — the canonical method, open-source reimpl
`bmelaiths/terrainHydrology`).** Build a hierarchical **drainage network as a
geometric graph**, order it by **Horton-Strahler number** (→ river class + per-vertex
width taper), then **generate/deform the heightfield from it with blending + carving
operators**. This is *rivers as the primary driver, terrain derived* — a direct match
for `heightAt = baseSeedHeight ⊕ deformations`. **This revises §5's generation order:**
for rivers, the drainage graph comes *first* and the heightfield is shaped to it (not
"rivers thread finished terrain"); the same graph→spline→width→carve pattern unifies
rivers and roads. The drainage graph slots into the connectome as river Portals.

**7. WFC bidirectional integration — GAP, no cited shipping example.** No verified
source demonstrates roads/rivers pre-collapsing WFC tiles or two-way vector↔tile
propagation; our §5 "pre-collapse the wave" plan is **inferred from the general
vector-truth/grid-mask pattern, not a proven precedent.** Targeted follow-up:
Boris-the-Brave's WFC constraint work (DeBroglie *path constraints*, "WFC Tips &
Tricks," the *Tessera* paper) — surfaced but not yet verified. **Treat WFC
pre-collapse as the one genuinely experimental slice; prototype it small (Slice 3).**

**Citations:** LiU L-system road thesis (diva2:1467574) · Watabou MFCG devlog ·
Zhang & Shi, tensor-field + multi-agent (ISPRS 2022) · Malmö spline-road thesis
(diva2:1675311) · Unity-Road-Generator (Alan-Baylis) · centripetal Catmull-Rom
(Yuksel 2011 / Wikipedia) · Génevaux et al., hydrology terrain (ACM TOG 2013) +
`bmelaiths/terrainHydrology`.

## 12. Open questions (carry into spec)

**Decided by §11 deep research:**
- ~~Spline type~~ → **centripetal Catmull-Rom (α=0.5)**, interpolates through POIs/waypoints.
- ~~Junction rendering~~ → **graph proximity-snap junctions at runtime; geometric
  junction caps baked at author time** (the offset-hull/SAT pipeline is non-real-time).
- ~~River generation order~~ → **hydrology-first: drainage graph → Strahler width →
  carve the heightfield to it** (Génevaux). Roads still thread terrain via per-edge A*.

**Still open:**
- **Network reduction for POI connectivity** — research endorsed *incremental growth
  from POI seeds + proximity-snap*, and was neutral on MST/Steiner as the topology
  selector on top. Lean: grow from POIs, A* per edge (we have `walkRoad`), add a few
  cycles for realism; pick the reducer in the spec.
- **WFC pre-collapse (the experimental piece)** — no cited precedent (§11.7). Follow
  up Boris-the-Brave (DeBroglie path constraints, *Tessera*); prototype small in Slice 3.
- **Bridge/ford z vs incised river valley** — deterministic walk-height reconciliation
  where a road deck crosses a carved channel; not covered beyond generic carve operators.
- **Where the road graph lives** — world/sim service both lanes read (like the
  heightfield), connectome layering Portal semantics above — needs the cross-lane
  sign-off the heightfield got.
- **Rivers' current source** — confirm whether a flow-accumulation field already
  exists in `src/terrain/` (if so, Strahler width profile is nearly free) or rivers
  are pure `tile.type` from noise.
