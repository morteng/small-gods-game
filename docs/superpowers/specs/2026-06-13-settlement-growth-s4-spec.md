# Settlement growth S4 — constraint catalogue (spec)

**Date:** 2026-06-13 · **Status:** shipped · **Builds on:** S1 (plan/execute), S2 (lots/wards/wear), S3 (live growth) · **Design:** `2026-06-13-settlement-growth-placement-design.md`

## Goal

Round out the placement system with the medieval *constraint catalogue*: civic
landmarks sited by rule, a denser growth repertoire (upgrade-in-place +
back-lane), and a frontage-value gradient that makes growth order legible — all
on the same deterministic, agent-directable seams S1–S3 established.

## What shipped

### 1. Frontage-value gradient — `frontageValue(plan, lot)`
Pure function returning prime-ness in `(0, 1]`: `1 / (1 + manhattan(frontage,
founding))`. The market sits at the founding node, so value decays outward —
the medieval rule that crossroads/market frontage is prime. Replaces S3's raw
distance term in the live-growth lot ordering and drives upgrade targeting
(prime lots densify first). Replay-stable (geometry only, no rng). Agents read
it to weight commercial placement.

### 2. Civic catalogue — `CIVIC_RULES` / `registerCivicRule` / `planCivics`
Open registry (same shape as `SITE_RULES` / `DWELLING_CAPACITY`):
`CivicRule { size, site: 'green'|'edge'|'water', nearWater? }`. Defaults: a
`well` on the green (nearest buildable footprint to the founding node), a
`graveyard` on the rim (farthest buildable footprint within the settlement
extent), a `mill` only where water is within range (else no mill — mills need a
stream). `planCivics` is pure/deterministic (coordinate scans, no rng); it
writes `plan.civics: CivicSite[]` and keeps each precinct on buildable ground,
off roads/market/lots/other civics. `subdivideLots` now excludes civic ground,
so ribbon/back-lane re-subdivision never lots over a well or graveyard.

**Scope note:** this slice reserves precincts as plan data only — no civic
*entity* is emitted at worldgen (keeps worldgen output stable). Emitting the
well prop and filling the graveyard with `remains` over deep time is the S5
consumer. Bridges + the water-aware road walker were already live
(`walkRoad`/`autoBridge` + `bridgeCells`, inter-POI connections), so S4 adds
only the in-settlement catalogue.

### 3. Upgrade-in-place — `UPGRADE_CHAINS` / `registerUpgrade` + `townhouse`
Open registry mapping a dwelling to its denser successor (`yurt→cottage`,
`cottage→townhouse`). New `townhouse` preset: the cottage's 3×3 burgage
footprint with two jettied storeys (capacity 8 vs cottage 5). When a settlement
saturates, `tryUpgrade` replaces a standing dwelling with its target on the
SAME lot — raising capacity without consuming ground. Prime-frontage lots
upgrade first (`frontageValue` order). Emits `settlement_upgraded
{ poiId, entityId, from, to, lotId }`. An upgrade fires only when the target's
capacity exceeds the source's AND its footprint still fits the lot.

### 4. Back-lane growth — `extendBackLane(plan, tiles, seed)`
Once ribbon extension caps (`MAX_PLAN_NODES`), the town deepens: branch a new
`lane` edge perpendicular to the through street off a founding/junction node
with a free side, walk `EXTEND_LEN` into open ground, re-subdivide
(coordinate-keyed, claims carried by id). Mirrors `extendThroughStreet`.
Back lanes follow ribbon (a ribbon extension turns an end node into the
junction a lane branches from) — the medieval ribbon-then-back-lane sequence.

### Growth sequence (live system)
`SettlementGrowthSystem.growOne` now runs, in order: **infill** a free lot →
**ribbon**-extend the street + retry → **upgrade** in place → branch a
**back-lane** + retry. Bounded by the shared node cap and lot supply, so growth
saturates and stops.

## Invariants held
- Deterministic, seeded, `Math.random`-free (guard test applies).
- Every layer is data-in/data-out with an open-registry patch seam
  (`CIVIC_RULES`, `UPGRADE_CHAINS`) — Fate directs via typed intents, never raw
  tile edits.
- Plans persist verbatim via `GameMap.settlementPlans`; `plan.civics` rides the
  snapshot automatically; `reconcileSettlementTiles` (S3) still covers
  scrub/re-roll.

## Versions
`WORLD_CONTENT_VERSION` 4 → **5** (plan shape gained `civics`).
`ART_RECIPE_VERSION` unchanged (`v7`) — no geometry change; `townhouse` reuses
existing part/feature types.

## Tests
- `tests/unit/settlement-plan-s4.test.ts` (8): frontage monotonicity; back-lane
  branch/claims/determinism/node-cap; civic well+graveyard siting, mill
  water-gating, determinism, lot exclusion, open-registry.
- `tests/unit/settlement-growth-system.test.ts` (+2): upgrade-in-place raises
  capacity after saturation; back-lane branches after the street caps.
- `tests/unit/content-version.test.ts`: expects 5.

## Deferred to S5
- Emit civic entities from `plan.civics`; route `remains` into the graveyard.
- D2 time-skip → growth steps; `grow_settlement` Fate capability; ward mutation
  in era-authoring.
- Two-sided streets (waits on the multi-view facing epic — preset doors face
  south, so only north/west-side lots are claimable).
