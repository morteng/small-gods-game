# Rivers R3 — ponds, beaver dams, pond/fishery nodes — round plan

**Date:** 2026-07-18 · **Spec:** `docs/superpowers/specs/2026-07-05-realistic-rivers-streams-design.md`
§R3 + §7 (connectome water sites — user-decided 2026-07-05) · **Handoff plan:** §4.1–4.2.
**Branch:** `rivers-r3-ponds` (worktree `/Users/Morten/mcpui/small-gods-s3`; other live session
shares the main checkout — never work there).

**Status of the R-slices:** R1 (meanders), R4 (rock eraser + riffle scatter), R5 (bury sink),
R6 (render polish) + emergent fringe (WCV 100) + lily pads (2026-07-16, render-only) are shipped.
R2's per-pool flat water was deliberately NOT built (probes showed no true ≥2 m falls emerge;
user picked render-only rapids/cascades instead). **R3 does not depend on R2** — it reads the
filled-elevation field directly, not reach classification.

## Design decisions (frozen)

1. **Depression hierarchy, not a full FSM port.** During the existing priority-flood in
   `generateHydrology` (`src/terrain/hydrology.ts`), label depressions and record per-depression
   metadata: member cells, max fill depth, spill (outlet) cell + spill elevation, and the
   downstream cell where flow resumes. This is the useful half of Barnes 2020; we do not need
   dynamic water-volume routing.
2. **Pond keep-rule replaces the flat per-cell cutoff for small hollows.** Today a cell reads
   `Lake` iff `W − elevation > LAKE_MIN_FILL` (0.01 ≈ 0.5 m) — small genuine hollows vanish.
   New rule: a depression whose max depth ≥ `POND_MIN_DEPTH` (< LAKE_MIN_FILL; calibrate) and
   whose area lies in `[POND_MIN_CELLS, POND_MAX_CELLS]` keeps its water as a pond, with the
   ε-flat-run false-positive excluded STRUCTURALLY (a real depression has a strictly-lower
   interior; an ε run does not). **Existing deep lakes must classify exactly as today** — the
   keep-rule only ADDS ponds; it never removes or reshapes current lakes.
3. **Ponds are `WaterType.Lake`.** No new WaterType. Everything already wired for lakes (tile
   raster stamp, `standingWaterCost` routing, `snapDrySettlementsOffWater`, lake-conform
   deformation, lily-pad calm gate, connectome lake nodes) applies to ponds for free.
   Pond identity (id, subtype, area, depth, spill/outlet) is NEW `HydrologyResult` metadata:
   a `ponds` record list + a per-cell pond-id array, consumed later by P3.
4. **Beaver dams = persisted crest records, ponds fall out of P1.** Gen-time two-pass: base
   hydrology → deterministic siting (moderate-flow reach — brook/stream Strahler band, never
   trunk; narrow valley cross-section by perpendicular ground-rise probe; wood nearby) →
   crest applied → hydrology re-run gives the pond via the P1 machinery. Dam records persist
   on the map (the `riparianSeed` lesson: maps DECLARE derived identity; the render-path
   recompute reads the records, never re-guesses). Dam renders as a stick/mud bar prop
   (parametric prop pipeline, grey-safe) + trickle-over foam from the existing slope/churn
   signal. Fate/flood levers are explicitly OUT of this round.
5. **Pond connectome node + fishery** (§7 as decided): `pond` site node (subtype
   natural|beaver) carrying area/depth/inlet/outlet; ONE affordance this round — `fishery`,
   scored by area/flow, realizing fisherman's hut + jetty + drying racks through the prop
   pipeline (grey-massing safe). NPC fishing activity explicitly NOT in scope.

## Constraints (spec §6 + memory, load-bearing)

- **Hydrology runs twice** (map-generator + hydrology-store) and must stay byte-identical —
  changes land in shared code; anything siting-derived is persisted and passed to BOTH callers
  (the `scorchMask` precedent). Volcanic scorch gating stays geometric in both.
- Determinism: seeded sfc32 only; no `Math.random` (guard test).
- Terrain writes only via the deformation channel; post-gen `tile.type` writes → `bumpTilesRev`.
- **WCV bump + `tests/unit/content-version.test.ts` pin update in the SAME commit** for every
  gen-output slice. Goldens (`river-channel-geometry`, crossings, water-s1, lake-*) re-pin as
  needed. Probe ≥2 genSeeds + `npm run lint:world`; calibrate counts on the 24-seed set.
- Server CI (`./scripts/ci-on-server.sh`) must log `✓ Server CI passed` before any push;
  commit first (CI archives HEAD); never chain `; git push`.

## Work packages

| WP | What | Model | Files (boundary) |
|---|---|---|---|
| P1 | Depression hierarchy + pond keep-rule + metadata; WCV bump; tests + probe calibration | Opus | `src/terrain/hydrology.ts`, `src/core/types.ts` (HydrologyResult), `src/core/content-version.ts`, new+updated tests, `scripts/probe-ponds.ts` (new) |
| P2 | Beaver dam siting + persisted crests + dam-bar prop + foam; WCV bump | Opus, after P1 | siting module (new), `map/map-generator.ts`, prop pipeline files, tests |
| P3 | Pond connectome node + fishery affordance (hut/jetty/racks) | Sonnet/Opus, after P1 | connectome/site files, tests |
| P4 (opt) | Gravel banks (unspecced; scope from scratch if attempted) | Sonnet filler | scatter/ground files only |

Acceptance (round): ponds appear across the 24-seed probe set in former erased hollows with
real outlets; existing lakes byte-identical on seeds 12345/777; ≥1 beaver dam across the
probe set on brook/stream reaches near forest; lint:world 0 errors both seeds; full CI green.
