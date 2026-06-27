# G6 — Aqueduct channel (grade-reconciliation epic)

> Plan. 2026-06-27. The grade-reconciliation epic's next slice after G1–G5
> (envelope, embankment, stairs, deck primitive, bridges — all shipped). Origin: the user's
> founding direction — *"…with an eye to also supporting aqueducts and other irrigation systems"* —
> and the headline *"it all pops out of the connectome."*

## Thesis (from the epic brainstorm)

An aqueduct is **the inverted river**: a river is hydrology's *output* (water the terrain sheds,
carved downhill); an aqueduct is an *input* — water carried along a **near-constant, author-chosen
gentle down-grade regardless of terrain**: CUT where the ground rises above the water line,
ELEVATED on a deck/arches where the ground falls below it, hugging the SURFACE where the ground
descends gently within the grade band. So:

> aqueduct = (grade-envelope linear feature, ~0.3% fall) + (G4 elevated-deck where below ground)
> + (river-channel cut where above ground) + (a thin channel water surface).

Almost all the machinery exists (recon 2026-06-27): the shared SDF feature buffer
(`feature-geometry.ts`), the cardinal-run span vocabulary (`road-span.ts` `sampleSpanSegments`),
the elevated-deck entity + `liftElev` pattern (`crossing-structures.ts`), and the river channel
geometry/surface. The one missing piece is **the aqueduct itself as a routed, profiled feature.**

## The decomposition (each slice independently shippable)

### Slice 1 — Aqueduct profile planner ✅ (`8b54514`)
**Pure, path-independent, no existing-file edits, no version bump, no goldens.** Given an
already-chosen source→sink tile path + an elevation field, lay the gravity water-line and classify.

`src/world/connectome/aqueduct-profile.ts`:
- `planAqueductProfile(path, opts) → AqueductProfile | null`.
- The water-line is a **greedy monotone forward pass**: start at the source ground; at each tile
  set the surface to *hug the terrain* but clamped into the grade band `[minFall, maxFall]·stepLen`
  below the previous station — so it **never rises** and **never falls faster than max**. This one
  rule makes the three modes fall out: gentle descending ground → `surface`; ground rises → water
  stays below → `cut` (the depth = how far the hill rises above the held line); ground drops away →
  water can only ease down at maxFall → ground sinks below → `elevated` (deck height = the gap).
- Per-tile `AqueductStation {x,y, terrainM, waterM, mode, clearM}`; grouped into
  `AqueductSegment {from,to,dir,mode,runTiles,fromWaterM,toWaterM}` runs by (mode, cardinal) for the
  eventual renderer. Reports `deliveredHeadM`, `maxCutM`, `maxElevatedM`, `feasible` (+reason).
- Feasibility: source must sit above sink; a cut deeper than `cutDepthMaxM` (a hill too tall to
  trench — the router's job to go around) ⇒ infeasible; water must arrive at the sink with head.
- Full unit tests: hug-the-slope → all `surface`; a hill → a `cut` run; a valley → an `elevated`
  run; monotone-never-rises invariant; min-grade always-flows invariant; deterministic; infeasible
  cases (source below sink, hill over cut cap).

> **Status 2026-06-27:** Slices 1, 2, 3 + the source extractor (4a) are SHIPPED on
> `feat/aqueduct-g6` — the full emergent decision pipeline (water connectome → routed, classified
> aqueduct geometry), 37 tests, tsc clean, every module pure + isolated (no existing files touched,
> no version bump, no goldens, not deployed). The user chose **emergent placement (A)**. Remaining:
> Slice 4 integration + render (the risky half — live worldgen wiring + renderer + version bump +
> goldens + visual verify) and the settlement **water-demand model**.

### Slice 2 — Grade-constrained router ✅ (`bcea470`)
`routeAqueduct({source, sink, elevAt, passable, envelope}) → path | null`: an A* variant
(mirroring `pathfinding.ts`) whose cost couples the **profile planner's structural cost**
(Σ cut + Σ elevated + length) so the chosen horizontal line minimizes trenching/arching — water
prefers to follow contours. Pure + testable on synthetic fields. *Needed under EVERY placement
design (emergent or seed-authored both need a grade-respecting route), so it is also path-
independent and safe to build next.*

### Slice 3 — Emergent placement ✅ (`132f010`) + source extractor 4a (`6a1a0f5`)
**Decision: EMERGENT, per the user** (2026-06-27) — aqueducts pop out of the connectome, not from
seed-authored connections. Shipped pure + tested:
- `planAqueducts(settlements, sources, opts)` (`aqueduct-placement.ts`): per demanding settlement,
  pick the feasible highland source with the least trench+arch (head + distance gated), route it,
  emit one plan per served town. Deterministic.
- `findHighlandSources(net, opts)` (`aqueduct-sources.ts`): lift the river network's `spring` +
  `lake_outlet` nodes into source candidates — the bridge from the live water graph to the placer.

**Still needed for Slice 4 (the real demand half):** a settlement WATER-DEMAND model — currently the
placer takes a `needsAqueduct` predicate that defaults to "all demand". The adapter must supply the
real signal (e.g. a town beyond N tiles of usable lower water, above a population floor).

### Slice 4 — Render (reuse) — feature-buffer cut runs + G4 deck elevated runs + channel water
- Add `'aqueduct'` to `LinearFeature`/feature-buffer tagging; cut runs reuse river-channel geometry,
  elevated runs spawn G4 deck bays (`liftElev` = `waterM`), a thin channel water surface rides the
  authored line (not the terrain datum). Bump `WORLD_CONTENT_VERSION`; re-pin goldens.

### Slice 5 — Irrigation (G7, its own track)
Trunk + branches + flow apportionment at junctions + an "irrigated" terrain tag feeding
biome/fertility. Deepest net-new modelling; explicitly later.

## Critical files
| Concern | File |
|---|---|
| Profile planner (Slice 1) | `src/world/connectome/aqueduct-profile.ts` (new) |
| Cardinal-run vocabulary (reuse) | `src/world/connectome/road-span.ts` |
| Grade-constrained router (Slice 2) | `src/world/connectome/aqueduct-route.ts` (new), ref `src/sim/pathfinding.ts` |
| Feature buffer / channel (Slice 4) | `src/render/gpu/feature-geometry.ts`, `river-channel-geometry.ts` |
| Elevated deck + liftElev (Slice 4) | `src/world/connectome/crossing-structures.ts`, `blueprint/parts/bridge.ts` |
| Feature enum (Slice 3/4) | `src/world/road-graph.ts` (`LinearFeature`) |
| Version gate (Slice 4) | `src/core/content-version.ts` |

## Verification
- Slice 1: `npm test` (new `aqueduct-profile.test.ts`); `tsc --noEmit` clean. No render/worldgen
  change ⇒ no stale-autosave risk, no goldens to re-pin, nothing to deploy.
- Later slices carry the visual + golden + version-bump discipline (see G3/G5).

Branch: `feat/aqueduct-g6`. Commit explicit paths. Not pushed without the Slice-3 design decision +
a coherent rendered increment.
