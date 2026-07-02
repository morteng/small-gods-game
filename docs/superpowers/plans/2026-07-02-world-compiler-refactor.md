# World Compiler Refactor — plan → reconcile → compile

**Status:** ACTIVE (2026-07-02). Base branch: `fix/terrain-features` (rivers/walls/roads/gates/bridges/stairs epic, WCV77, suite green).

## Why

Worldgen today is an imperative pipeline of independent writers over shared state (tiles,
heightfield deformations, entities). Each pass must remember every previous pass's
invariants, so N feature systems ⇒ O(N²) pairwise guards, each hand-written when someone
notices the bug in a rendered frame. The 2026-07 terrain-features epic fixed six such
guards (walls over water, bridgeless fords, un-bridged decks, approach dives, stair
siting, draw order) — all the same class. This refactor retires the class:

1. **Claims ledger** — one spatial authority; every feature claims cells; intersections
   are detected structurally, not discovered visually.
2. **Junction artifacts** — a feature×feature intersection is a first-class OBJECT
   (Bridge, WaterGate, Gatehouse, RoadJunction, Stair), produced by a reconciler.
   Combinations become unrepresentable as silent overlaps.
3. **Deep lint** — the linter (`evaluateConnectome`) checks geometry densely enough that
   a screenshot is never the first detector.
4. **Draw-order goldens** — deterministic draw-list assertions over authored worst-case
   scenes (no GPU needed) for the residual render-only class.
5. *(Deferred)* **Plan/compile split** of `map-generator.ts` — single writer, dirty-region
   recompile. Designed here, executed as its own epic.

## Constraints (repo law — violating these fails review)

- **Deterministic**: all randomness via seeded rng (`sfc32`); `src/sim/` is
  `Math.random`-free (guard test). Worldgen for a fixed (seed, worldSeed) stays
  reproducible. NO `Date.now()` in generation paths.
- **Byte-identical default**: unless a work package explicitly says otherwise, a world
  generated from the same seed must not change. New layers OBSERVE first (assert/lint),
  they do not move placements. If output must change, bump `WORLD_CONTENT_VERSION`
  (src/core/content-version.ts) with a note — coordinate with the integrator; do NOT
  bump per-package.
- **Tests**: vitest; new modules get unit tests; changed rule lists update the pins in
  `tests/unit/connectome-diagnostics.test.ts`. Run the tests you touch + `npm run
  lint:world` before committing.
- **Git**: commit explicit paths (never `git add -A`); do not push; do not merge.
- **No paid generation** (reseed frozen); no new heavy CI.
- Key gotchas: hydrology runs TWICE (map-generator + hydrology-store) — never read one
  and assume the other; `World.updateEntity()` for any position/kind/tag mutation;
  IndexedDB always via `withIdbTimeout` (not relevant to worldgen-pure code).

## Shared vocabulary

- `GameMap.tiles[y][x]`: `{ type, baseType? }`; roads preserve what they covered via
  `baseType`; `bridge` is a tile type whose `baseType` is water.
- `WATER_TYPES` (src/core/constants.ts).
- Barriers: `map.barrierRuns: PlacedBarrier[]` = `{id, run: BarrierRun}`; `run.path:
  [number,number][]`, `run.gates: {t, width, kind?: 'gate'|'gap'}[]`;
  `barrierFootprintTiles(run)` → `{blocking, gate}` cells (src/world/barrier.ts).
- Buildings: entities tagged `building`; solid cells via `buildingStructureCells(world)`
  (src/world/connectome-diagnostics.ts).
- Roads: `map.roadGraph: {nodes, edges}`; `edge.polyline`, `edge.bridgeCells:number[]`
  (idx = y*W+x).
- Heightfield: base ⊕ deformations; composed via `getComposedHeightfield(map)`
  (src/world/road-deformation.ts). Deformation channel:
  src/world/terrain-deformation.ts.
- Linter: `evaluateConnectome(ctx, DEFAULT_RULES)` in
  src/world/connectome-diagnostics.ts; consumed by `npm run lint:world`
  (scripts/lint-world.ts), MCP `lint_world`, studio overlay.

---

## WP-A — Lint deepening  *(Sonnet; independent; owns `src/world/connectome-diagnostics.ts`)*

Upgrade the linter so every issue class from the 2026-07-02 screenshot is machine-detected.

**A1. `barrier.over-water` dense sampling.** Today the rule checks entity
`footprintCells` only; a live probe found 6 wet samples on `oakshire_ring`'s POLYLINE the
cell rule missed. Add dense sampling: walk each `run.path` at ≤0.5-tile steps; a wet
sample is a violation UNLESS its arc-length `t` falls inside a declared gate/gap span
(`gates[i].t ± width/2`). Keep the existing cell check. Report wet arc spans (start/end
t + tile list).

**A2. `carve.dry-pit` (new, warn).** Detect carved holes with nothing in them (the dark
faceted pits in renders). For each tile: `depth = base[i] − composed[i]` (use
`getComposedHeightfield` and the base heightfield the map exposes — find the accessor;
if only composed exists, reconstruct base by summing deformation contributions, or
compute depth from the deformation channel directly, whichever is simplest and pure).
Flag tiles where carve depth > ~1.2 m AND tile is not water/bridge/road AND no
water/road/bridge tile within 1 tile. Cluster contiguous flagged tiles into one
diagnostic per pit (centroid + cell count + max depth).

**A3. `bridge.seating` (new, error).** For every `bridge_deck` entity: derive its span
cells from its blueprint footprint (origin + `blueprint.rb.footprint`); require (a) ≥1
beneath-cell is water or carved channel, (b) both span END cells (the two extreme cells
along the deck's long axis) are NON-water land tiles. Catches floating decks and decks
seated in the channel.

**A4. `bridge.tiles-vs-deck` (new, error).** Every contiguous run of `bridge` tiles must
intersect ≥1 `bridge_deck` entity footprint, and every `bridge_deck` must sit over ≥1
`bridge` tile — tiles and entities must agree (catches the un-bridging class from the
opposite side).

Each rule: register in `DEFAULT_RULES`, unit tests (synthetic worlds, both clean and
violating), update the rule-list pin test, run `npm run lint:world` and report its
output in your final message. Pre-existing known finding: `building.on-water:
swamp_shrine…` on the second genSeed — leave it, it's tracked.

## WP-B — Claims ledger  *(Opus; independent; new files only + one wiring point)*

New module `src/world/claims.ts` (+ `src/world/claims-diagnostics.ts`): the single
spatial authority for feature space claims — OBSERVATIONAL first (no placement changes).

- `ClaimKind = 'water' | 'road' | 'barrier' | 'building' | 'earthwork' | 'stair' | 'crossing'`.
- `ClaimsLedger.claim(featureId, kind, cells: Iterable<[number,number]>, meta?)`;
  internally one Map cell→claims. Deterministic iteration (sorted keys) so reports are
  stable.
- `ledger.conflicts(): SpatialConflict[]` — pairs whose kinds are INCOMPATIBLE per an
  explicit compatibility matrix. Compatible-by-design pairs need a RESOLUTION
  registration: `ledger.resolve(conflictClass, featureA, featureB, artifactId)` (e.g. a
  road×water overlap is fine iff resolved by a crossing artifact covering those cells).
  Matrix (initial): road×water ⇒ needs `crossing`; barrier×water ⇒ needs gap/water-gate
  span; barrier×building ⇒ needs gatehouse (none exist yet ⇒ always conflict);
  building×building ⇒ always conflict; building×water ⇒ always conflict; road×building
  ⇒ always conflict; road×road ⇒ allowed (junction artifact comes in WP-C; emit as
  `info`-grade overlap for now); same-feature self-overlap ignored.
- **Population**: one pure function `buildClaimsFromWorld(world, map): ClaimsLedger`
  that derives claims from committed state (water tiles from `map.tiles`; roads from
  road tiles + `baseType`; barriers via `barrierFootprintTiles` per run, with gate/gap
  spans registered as resolutions; buildings via `buildingStructureCells`; crossings
  from `bridge` tiles + `bridge_deck`/`bridge_pier` entities registered as resolutions
  of road×water). This makes the ledger usable TODAY without touching map-generator
  ordering.
- **Wiring**: `claims-diagnostics.ts` exports a `claims.unresolved` DiagnosticRule
  (error) that builds the ledger and reports unresolved conflicts. Do NOT edit
  `connectome-diagnostics.ts` (WP-A owns it) — export the rule; the integrator registers
  it. Include a short doc comment mapping each conflict class → the WP-C artifact that
  will resolve it.
- Unit tests: matrix behavior, resolution accounting, determinism (two builds ⇒ deep-equal
  reports), a synthetic world exercising every conflict class.
- Also write `docs/superpowers/specs/world-compiler.md`: the target end-state (plan →
  reconcile → compile), how the ledger becomes the AUTHORITY in the compile split
  (WP-D), and the junction-artifact taxonomy for WP-C. Keep it ≤200 lines, concrete.

## WP-E — Draw-order goldens  *(Sonnet; independent; tests only)*

`tests/unit/draw-order-goldens.test.ts`: deterministic assertions over
`buildEntityDrawList` (src/render/iso/entity-draw-list.ts) for authored worst-case
scenes — NO GPU, pure list inspection. Scenes (build tiny synthetic worlds/entities
directly):

1. Wall behind building, same tile row → building draws before the barrier chunk that
   is in front of it; barrier KIND_PRIORITY tie-break holds.
2. Diagonal wall descending a slope → consecutive barrier chunks' depth keys are
   monotonic; no chunk spans more than `CHUNK_DEPTH_SPAN_MAX` in (x+y).
3. Bridge over carved river with road approaches → river/road/deck ordering: deck draws
   after the water tile beneath it; approach road draws before the deck.
4. Building cluster with npc + vegetation interleaved → y-sort stability (equal keys
   keep insertion order; no flicker-prone key ties between building and barrier).

Derive expectations from the CURRENT (fixed) behavior on `fix/terrain-features` — these
are regression pins for the draw-order fixes just shipped, plus documentation of the
sort contract. Read `entity-draw-list.ts` + `parametric-barrier-source.ts`
(`sortTx/sortTy`, KIND_PRIORITY, CHUNK_DEPTH_SPAN_MAX) first.

## WP-C — Junction artifacts + reconciler  *(Opus; AFTER WP-B merges)*

Not started until WP-B lands. Scope sketch (final spec comes from WP-B's
`world-compiler.md`): typed `JunctionArtifact` union; `reconcile(ledger)` proposing
artifacts for unresolved conflicts; migrate crossing-builder/enclosure-gaps/wire-gate to
REGISTER their outputs as resolutions; wall×building ⇒ reroute-or-gatehouse decision in
`building-placer`/`enclosure`. Placement changes ⇒ WCV bump, integrator-coordinated.

## WP-D — Plan/compile split  *(deferred epic)*

`generateWithNoise` decomposes into `planWorld(seed, worldSeed) → WorldPlan` (pure,
no tile writes) and `compileWorld(plan) → {map, world}` (the ONLY writer). The ledger
becomes the authority consulted DURING planning instead of after. Dirty-region
recompile hooks into [[project-incremental-world-update-substrate]]. Do not start in
this round.

## Integration protocol

Agents work in isolated worktrees branched from `fix/terrain-features`, commit with
explicit paths, and DO NOT merge/push. The integrator (main session) reviews each
branch, resolves the one known seam (registering WP-B's rule into `DEFAULT_RULES` +
rule-pin test alongside WP-A's changes), runs the full suite + `npm run lint:world` +
`npm run build`, and lands everything as one reviewed merge for the user to approve.
