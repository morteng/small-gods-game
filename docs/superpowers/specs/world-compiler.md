# World Compiler — plan → reconcile → compile

**Status:** SPEC (2026-07-02). Companion to
`docs/superpowers/plans/2026-07-02-world-compiler-refactor.md`. Describes the END STATE the
refactor converges toward; WP-B (the claims ledger) is the first landed piece.

## The problem this ends

Worldgen is a pipeline of independent writers over shared state (tiles, heightfield
deformations, entities). Each writer must know every earlier writer's invariants, so N
feature systems accrete O(N²) hand-written pairwise guards — each added only after someone
sees the bug in a rendered frame (walls in water, bridgeless fords, floating decks, roads
through houses). The compiler retires the class: overlaps between incompatible features
become **structurally detected**, then **typed objects**, not silent tile collisions.

## Three phases

```
  seed ──plan──▶ WorldPlan ──reconcile──▶ ReconciledPlan ──compile──▶ { map, world }
                (pure, no                 (junction artifacts          (the ONLY writer)
                 tile writes)              own every overlap)
```

1. **plan** *(WP-D, deferred)* — `planWorld(seed, worldSeed) → WorldPlan`: pure derivation
   of features (terrain field, water network, road graph, barrier runs, building sites) with
   NO tile mutation. Today `generateWithNoise` interleaves planning and writing; WP-D splits
   them so the ledger can be consulted DURING planning instead of after.
2. **reconcile** *(WP-C)* — `reconcile(ledger) → JunctionArtifact[]`: every unresolved
   conflict in the ledger becomes a proposed typed artifact (below). Existing builders
   (crossing-builder, enclosure gap-cutter, gate-wiring) migrate to REGISTER their outputs
   as resolutions instead of silently stamping tiles.
3. **compile** — `compileWorld(reconciledPlan) → { map, world }`: the single writer. It
   stamps tiles/entities from the plan + artifacts; because every overlap is owned by an
   artifact, no combination is representable as a silent tile collision. Dirty-region
   recompile (only re-stamp changed features) hooks [[project-incremental-world-update-substrate]].

## The claims ledger (WP-B — landed)

`src/world/claims.ts`. The single spatial authority. Every feature CLAIMS the cells it
occupies; incompatible co-claims are detected once, here.

- `ClaimKind = water | road | barrier | building | earthwork | stair | crossing`.
- `ledger.claim(featureId, kind, cells, meta?)` — one internal `Map<cell, Claim[]>`.
- `ledger.resolve(class, featA, featB, artifactId, cells)` — mark cells of a conflict class
  RESOLVED by an artifact (a crossing over road×water cells; a gate span over barrier×water).
  Matching is **by (class, cell)**, so a resolution covers whatever features intersect there
  — this is a deliberate deviation from the plan's cell-less sketch signature, needed because
  a barrier resolves water only over its *gap span*, not its whole footprint.
- `ledger.report() → ClaimsReport` — the deterministic snapshot (conflicts, resolution
  accounting, per-kind cell counts). Two builds of one world are deep-equal (sorted keys).
- `buildClaimsFromWorld(world, map)` — OBSERVATIONAL population from committed state, so the
  ledger is usable today without touching map-generator ordering.

### Compatibility matrix (the law)

Keyed by the two kinds; a shared cell held by two DIFFERENT features is judged:

| pair | disposition | resolved by (WP-C artifact) |
|------|-------------|-----------------------------|
| road × water | **needs** | crossing covering the cell → **Bridge / WaterGate** |
| barrier × water | **needs** | gap / water-gate span → **WaterGate** |
| road × barrier | **needs** | gate opening → **Gatehouse** |
| building × water | **conflict** | (none — placer never sites on water) |
| road × building | **conflict** | (none — road reroutes around the footprint) |
| barrier × building | **conflict** | wall reroute / **Gatehouse** embedding |
| building × building | **conflict** | (none — displace one; spatial-invariants INV1) |
| road × road | **overlap** (info) | **RoadJunction** |
| crossing × {water,road,barrier,building} | **ok** | crossing IS the resolution |
| everything else / inert same-kind | **ok** | — |

- **needs** = legitimate only where a resolution is registered for that cell; an un-resolved
  cell is an ERROR. **conflict** = always an error until its artifact type ships. **overlap** =
  allowed, surfaced as INFO so a junction can eventually own it. **ok** = never reported.
- Un-ruled pairs default to `ok`: observational code must never invent conflicts, so a new
  kind is compatible-until-a-rule-is-added.

### Diagnostic seam

`src/world/claims-diagnostics.ts` exports `claimsUnresolvedRule` (`claims.unresolved`, error;
road×road → info). It builds the ledger and reports conflicts as `Diagnostic`s in the
connectome linter's shape. Registered in `DEFAULT_RULES` at integration (2026-07-02), so every
linter consumer (`lint:world`, MCP `lint_world`, studio overlay) runs it.

## Junction-artifact taxonomy (WP-C)

A `JunctionArtifact` is the typed object a reconciler produces for an overlap. Each OWNS its
cells (registers them as resolutions) and carries the geometry the compiler stamps:

- **Bridge** — road × water. Deck span (bank→bank) + piers/arches; owns the `bridge` tiles
  and the `bridge_deck`/`bridge_pier` entities. Seats both ends on land (cf. WP-A `bridge.seating`).
- **WaterGate** — barrier × water. A gap span in the wall where it meets a channel, optionally
  a fortified water-gate; owns the barrier's opening cells over water.
- **Gatehouse** — road × barrier (and barrier × building where a wall must admit a building).
  A gate leaf + flanking towers; owns the barrier's gate span cells and the road cells through it.
- **RoadJunction** — road × road. A typed node where edges meet (degree, priority, surface
  reconciliation); replaces today's silent shared-cell overlap.
- **Stair / Ramp** — grade × path (future). A connector across a terrace edge; owns the
  carved step cells.

Reconciliation is: for each unresolved conflict class, instantiate the mapped artifact,
register its cells as resolutions, re-run `ledger.conflicts()` → converge to zero errors.
Placement-moving artifacts (a rerouted road, a displaced building) change worldgen output ⇒
bump `WORLD_CONTENT_VERSION`, integrator-coordinated.

## Ledger as compile authority (WP-D)

In the split, planning consults the ledger BEFORE writing: a feature proposes its cells,
the ledger reports conflicts, the planner either accepts a resolution artifact or adjusts the
plan (reroute, displace, gap) — so the compiler only ever stamps a conflict-free, artifact-
owned plan. The ledger stops being a post-hoc linter and becomes the placement gate.

## Observed reality (WP-B, offline, default world, 3 genSeeds)

`buildClaimsFromWorld` over ~96–101k claimed cells returns in well under a second and finds
only genuine overlaps — none a matrix false positive:

- **road-x-road** (info): 19–26 junctions/world — legitimate, awaits RoadJunction.
- **road-x-water** (error): 0–2 residual bridgeless fords (8–15 bridge cells correctly
  resolved) — same class as WP-A `road.on-water`.
- **barrier-x-water** (error): 1–3 croft/ring cells wading water (some gate spans resolved) —
  same class as WP-A `barrier.over-water` dense sampling.
- **barrier-x-building** (error): 1–2 — croft ring clipping a building / a toll-booth building
  sitting on a croft wall — same class as `barrier.through-building`.
- **building-x-water** (error): 0–2 — the tracked `swamp_shrine` on-water finding.
- **road-x-barrier** (error): 2–5 — roads threading CROFT rings that declare no gate span.
  The most novel finding: crofts model informal openings as absent gates, so a path entering a
  croft reads as fording its wall. Candidate for WP-C (crofts want gate spans, or a croft-kind
  barrier disposition) — recorded here as SIGNAL, not loosened away.
