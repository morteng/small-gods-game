# Round 5 — Roads, Gates & Desire Lines (2026-07-03)

Goal: make the road/gate/path layer look **designed from the start**, per the research pass
(Galin 2010 procedural roads; Watabou TownGeneratorOS gates-as-portal-nodes; Helbing active-walker
desire lines / RimWorld Desire Paths numbers; StreetGen junction fillets). Three work packages.
Research notes: the integrator holds the full source synthesis; condensed mechanism notes are
inlined per WP below.

**Guiding principle for all WPs:** refactor, don't bolt on. When a WP supersedes an existing
mechanism (stitch passes, settlement-wear), the old mechanism is demoted or absorbed — the final
code should read as one coherent design, not layers of patches. Delete dead paths you obsolete.

## Shared protocol (all agents)

- Branch from `main` @ `c5f2f3f` in your isolated worktree. Never touch the shared checkout.
- Commit with **explicit paths** (never `git add -A`). Do NOT push. Do NOT merge to main.
- Run targeted tests for the files you touch + `npx tsc --noEmit` before finishing.
  The integrator runs the full suite / build / lint:world gate.
- **Do NOT bump `WORLD_CONTENT_VERSION` or `ART_RECIPE_VERSION`** — the integrator bumps WCV
  once at integration (WP-P and WP-Q both change worldgen output; a single bump avoids conflicts).
- All `src/sim/` code stays `Math.random`-free (guard test). Determinism is non-negotiable:
  same seed + same inputs ⇒ identical output.
- No live LLM calls in tests (MockLLMClient only). No paid generation (reseed frozen).
- Offline visual checks: `npx tsx scripts/probe-world.ts` and the existing probe/preview scripts —
  a visual render catches geometry bugs no assertion does.
- Report back: what you built, files touched, test results, deviations from this plan, and any
  seams you deliberately left for the integrator.

## Merge order: WP-O → WP-P → WP-Q

WP-Q is developed against pre-P main but merges after WP-P; coordination notes below keep the
file sets disjoint enough that conflicts should be trivial.

---

## WP-O — Emergent desire-line paths (trample system)  [model: opus]

**Today:** NPC traffic never creates geometry. `src/world/settlement-wear.ts` is a one-shot
gen-time cosmetic halo around authored roads; `src/world/road-evolution.ts` ages authored road
edges. Nothing emergent exists.

**Mechanism (research-backed):** an accumulator grid + decay-toward-natural + promotion with
hysteresis + **coupling back into the pathfinder** (the part naive implementations miss — a
forming trail must be cheaper to walk or footfalls never bundle into one shared path; Helbing's
trail-attraction term). Proven tuning from the RimWorld Desire Paths mod: deposit every ~20 ticks
per agent, promote above HI=120, geometric decay ×0.9 every ~2 in-game hours, revert below LO=80;
the HI/LO gap is the anti-flicker design. Saturation cap so trails can't deepen forever.

**Build:**
1. `TrampleGrid` (suggest `src/sim/trample.ts` + `src/sim/systems/trample-system.ts`):
   quantized accumulator sized to the map (Uint16 semantics; pick storage that snapshots cheaply).
   - **Deposit:** hook NPC movement (`src/sim/npc-movement.ts` / a registered tick system) —
     throttled (every N ticks per NPC, N≈20), deposit at the NPC's tile. No RNG needed
     (pure accumulation); if any randomness is genuinely required, `ctx.rng` only.
   - **Promote/decay pass:** low-Hz registered system (like Mortality at 0.25 Hz or slower).
     Above HI on soft ground: tile → `dirt` (store the ORIGINAL tile type for reversion).
     Decay ×factor per pass; below LO: revert to stored original. Hysteresis gap mandatory.
   - **Never sweep the full grid per tick** — deposit pass and promote/decay pass are separate
     and both throttled.
2. **Eligibility (per-terrain opt-out):** only soft natural ground trampls (grass/meadow-class).
   NEVER trample: road/bridge tiles, water, stone/mountain, farmland/fields, building footprints,
   POI/market tiles. **Trample caps at `dirt` — it must NEVER create road-class tiles**
   (`dirt_road` etc.), or it would feed the roads-lead-to-gates lint contracts and road-graph
   invariants. Trails are ground wear, not roads.
3. **Pathfinder coupling:** `tileCost` (`src/sim/pathfinding.ts:21`) — trampled `dirt` should cost
   between grass (1.0) and road (0.5), e.g. 0.8. Check what `dirt` costs today; make the trail
   tier explicit so A* bundles traffic onto forming trails.
4. **Absorb `settlement-wear.ts`:** the gen-time pass becomes a PREWARM of the same grid
   (seed accumulator values around roads/markets so gen output still shows worn ground), not an
   independent tile-setting mechanism. One system, two entry points (gen prewarm + runtime traffic).
   Gen output may change slightly — fine, integrator bumps WCV.
5. **Persistence:** grid + original-tile map must survive snapshot/save-load (full-state snapshot
   model — see `src/core/snapshot.ts`; follow how tiles/other grids serialize). Roundtrip test
   required. Check whether SAVE_VERSION needs bumping (new snapshot field usually rides free if
   structured-cloned; verify).
6. **Scrub/replay:** deterministic by construction (deposit from deterministic movement). Verify
   snapshot scrub doesn't leave stale grid state.

**Tests:** deposit accumulation determinism (two runs, same seed ⇒ identical grid); hysteresis
(oscillating traffic near threshold doesn't flicker tiles); opt-out terrains untouched; A* prefers
a formed trail over parallel grass; snapshot roundtrip; settlement-wear prewarm produces worn
ground at gen; no-random-in-sim guard still green.

**Files (expected):** `src/sim/trample.ts` (new), `src/sim/systems/trample-system.ts` (new),
`src/sim/pathfinding.ts` (tileCost), `src/sim/npc-movement.ts` or system registration site,
`src/world/settlement-wear.ts` (absorb), `src/core/snapshot.ts` only if a new top-level field is
needed, tests. **Do not touch:** `src/world/enclosure.ts`, `src/world/connectome/gate-approach.ts`,
`src/map/map-generator.ts` road-carving order (WP-P owns those), `src/world/road-deformation.ts`
(WP-Q owns it). Calling into map-generator to wire the prewarm is fine — keep the diff surgical.

---

## WP-P — Gates-first commit (structural worldgen refactor)  [model: opus]

**Today:** gates are DERIVED from wherever roads happen to cross the traced wall ring
(`src/world/enclosure.ts:401` `gatesWhereOpen`), with `ensureMainGate` as a fallback guarantee,
patched by a pre-carve orphan-gate stitch (`src/map/map-generator.ts:364` → `wire-gate.ts`) plus a
post-merge fallback stitch (`map-generator.ts:415`), watched by the `gate.road-connected` lint.
Each piece exists because gates and roads are authored by different passes that only meet at the end.

**Mechanism (research-backed, Watabou TownGeneratorOS):** commit walls+gates BEFORE any road or
street exists. Gates are authoritative portal nodes; the wall is an obstacle everywhere else. The
external road network terminates AT gates and the internal street network grows FROM gates — both
by construction, so no stitching is ever needed. Degenerate cases are repaired at gate-COMMIT time
(edit geometry so the future road has a viable corridor), not by post-hoc road repair. Smoothing
pins gate endpoints so it can never detach a road from its gate.

**Build:**
1. **Gate commit pass** (in/next to `enclosure.ts`): after `deriveSettlementRing` traces the ring,
   commit `Gate[]` BEFORE road carving:
   - one gate per distinct connection direction: for each `Connection` incident to the settlement,
     pick the landward ring point nearest the ray toward the connected POI (reuse the ring-walk
     slab machinery so gate positions land on renderable slab boundaries, midpoint-sampled at
     k+0.5 like `gatesWhereOpen` does today — renderer lockstep is load-bearing);
   - enforce min spacing (merge near-duplicate directions into one gate);
   - never on water / off-bank (keep the existing water-fronted-side gap logic for GAPS —
     gaps stay derived; only GATES become committed);
   - guarantee ≥1 gate (absorb `ensureMainGate`'s role at commit time).
2. **Renderer/openings consume committed gates:** `gatesWhereOpen` becomes
   "openings = committed gates + derived gaps" instead of deriving gates from road crossings.
   `place-barrier.ts` blocking-cell indexing keeps excluding gate cells (NPC pathing through gates
   must keep working).
3. **Roads terminate at committed gates:** `gateApproachPlan`
   (`src/world/connectome/gate-approach.ts`) already rewrites connection waypoints to the nearest
   real gate — now the gate set is authoritative and exists pre-road. Verify approach roads route
   to the committed gate for their direction (nearest-gate-by-direction, not just nearest-by-distance,
   when they differ).
4. **Streets grow from gates:** `src/world/settlement-plan.ts` street templates anchor to committed
   gates — at minimum the through-street endpoints target the gates (or each committed gate is wired
   to the street spine as part of STREET layout, before approach carving). Streets may keep their
   template character; the invariant is: **every committed gate has an interior street connection
   at layout time.**
5. **Demote the stitches:** both orphan-gate `wireGateToRoad` passes in `map-generator.ts` become
   degenerate-case repair — kept, expected to no-op on healthy seeds, and LOG (console.warn or the
   gen-diagnostics channel) when they actually fire so regressions are visible. Remove the parts of
   `ensureMainGate` that the commit pass obsoletes.
6. **Degenerate repair at commit time:** if a committed gate's outward corridor is blocked
   (building/green directly outside), prefer moving the gate along the ring at commit time over
   relying on the stitch.

**Acceptance:** `npm run lint:world` **0 errors on BOTH seeds** (and probe ≥2 genSeeds via
`scripts/probe-world.ts` — the live game rolls Date.now() seeds); `wall.crossing-only-at-gate`
and `gate.road-connected` contracts green; no gate on water; every committed gate reachable by
road AND street tiles; deterministic (same seed twice ⇒ identical world); offline probe render
for visual sanity (roads visibly meet gates head-on).

**Files (expected):** `src/world/enclosure.ts`, `src/world/connectome/gate-approach.ts`,
`src/map/map-generator.ts` (ordering region ~341–430), `src/world/settlement-plan.ts`,
`src/world/wire-gate.ts` (demote), `src/world/connectome/wall-contracts.ts` only if contract
semantics need updating (prefer not), tests.
**Do not touch:** `src/world/road-deformation.ts` / `src/render/gpu/feature-geometry.ts`
(WP-Q owns fillets/render), `src/sim/` (WP-O owns it), `src/world/settlement-wear.ts` (WP-O).

---

## WP-Q — Fillet → raster reconciliation + building-anchor fillets  [model: sonnet]

**Today:** `filletApproach` (`src/world/anchor-fillet.ts`) smooths GATE approaches, but only the
RENDER centerline (`road-deformation.ts:270` `edgeRoadProfile` → `filletOntoGates`); the integer
cell polyline / tile mask / NPC-walkable grid keep the kinked path (`road-deformation.ts:213`).
So the smooth approach the player sees is not the surface NPCs walk. And building-anchor arrivals
(anchor-snap resolver) get no fillet at all.

**Mechanism (research-backed):** Galin 2010's named pitfall — any pipeline that smooths after
routing must RE-VALIDATE the smoothed curve against the world and reconcile. StreetGen's fillet
robustness lessons: clamp radius against short segments; degenerate angles (near-flat,
near-parallel) need fallbacks, not closed-form arcs.

**Build:**
1. **Raster reconciliation:** where a filleted centerline exists (gate approaches today), re-derive
   the road tile set along the smoothed curve so walkable tiles match the rendered ribbon.
   Constraints (hard): never place road tiles on curtain BLOCKING cells (`wall.crossing-only-at-gate`
   must stay green), never on water without an existing bridge cell, never through building
   footprints or greens. Where reconciliation would violate a constraint, keep the original tiles
   for that span (fall back, don't force). Keep bridge cell indices consistent
   (`road-graph` bridge bookkeeping). Old tiles no longer under the ribbon: un-carve only when
   provably redundant (adjacent replacement tile exists); when in doubt leave them — a slightly
   wide road is better than a broken one.
2. **Building-anchor fillets:** extend the same `filletApproach` tangent smoothing to
   building-anchor arrivals (`src/world/anchor-snap-resolver.ts` and the anchor-collect path) —
   same mechanism as `filletOntoGates`, endpoint pinned at the anchor so smoothing can never
   detach the road from its target. Then the same raster reconciliation applies.
3. **Radius/degeneracy handling:** clamp fillet radius against incident segment length; skip the
   fillet entirely (straight arrival) at degenerate angles rather than emitting a bad arc.

**Acceptance:** a render/raster agreement check as a test — sample the smoothed centerline at
sub-tile steps; every sample must land on a road-class tile (or a deliberate fallback span);
`npm run lint:world` 0 errors both seeds; draw-order/geometry goldens updated if pinned hashes
move; deterministic.

**Coordination (important):** WP-P is refactoring gate COMMIT ordering in `enclosure.ts` /
`gate-approach.ts` / `map-generator.ts` pass order / `settlement-plan.ts` — **do not edit those
files.** Confine yourself to `road-deformation.ts`, `anchor-fillet.ts`, anchor-snap files,
rasterization helpers (`road-graph.ts` rasterize/mask functions if needed), `feature-geometry.ts`
if consumption changes, and tests. You merge AFTER WP-P; the gate-fillet entry points you consume
(`filletOntoGates`, `edgeRoadProfile`) are not expected to move.

---

## Integrator (not the agents)

Merge WP-O → WP-P → WP-Q; resolve conflicts; single WCV bump (+ changelog line in
`src/core/content-version.ts`); full suite + build + `lint:world` both seeds + probe genSeeds;
browser E2E sanity (roads meet gates, trails form near a busy settlement under time acceleration);
zombie-session check; ONE push to main; docs/memory update.

## Deliberately NOT in this round

- `RoadJunction` as a compile object + StreetGen buffer-intersection junction fillets (round 6
  candidate; depends on WP-Q's reconciliation being in).
- Orientation-augmented road A* (true switchbacks) — only if mountain roads visibly zigzag after
  this round.
- Trail "social gravity" on building placement (Foundation-style) — wants the trample grid to
  exist first.
