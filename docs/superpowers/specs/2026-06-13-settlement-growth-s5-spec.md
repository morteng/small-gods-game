# Settlement growth S5 — skip integration + Fate lever + civic entities (spec)

**Date:** 2026-06-13 · **Status:** shipped · **Builds on:** S1 (plan/execute), S2 (lots/wards/wear), S3 (live growth), S4 (constraint catalogue) · **Design:** `2026-06-13-settlement-growth-placement-design.md`

## Goal

Close the growth loop on its two remaining consumers — **deep time** and
**Fate** — and turn the S4 civic *reservations* into standing *entities*. After
S5 a settlement grows whether you watch it tick, jump fifty years past it, or
have Fate push it; and the wells and graveyards the plan reserved are real
objects on the map, off-limits to building placement.

## What shipped

### 1. Shared growth path — `growSettlement(ctx, plan, tag?)`
The S3/S4 growth logic lived in three private methods of
`SettlementGrowthSystem`. S5 lifts them to **module-level free functions** over a
minimal `GrowthCtx { world, rng, now, log }` — a structural subset of the live
`SystemContext`, the command `ApplyCtx`, and the hand-built skip context, so all
three drive identical code. `growSettlement` now **returns a boolean** (any
structural change — build, upgrade, or road carve) so callers can loop until
saturation. A `tag` parameter keys the new entity ids; it defaults to the tick,
leaving the live system's ids byte-unchanged, but skip/command callers pass a
per-step tag so several grows land within one logical tick without id
collisions. Exposed helpers `residentsByPoi` / `housingCapacityByPoi` are shared
by the tick and the skip.

### 2. Time-skip integration — `growSettlementsOnSkip` in `applySkip`
The live 0.25 Hz system can't tick during a closed-form jump. After `applySkip`
materializes the projected deaths and births, it calls `growSettlementsOnSkip`,
which — for each settlement, in sorted POI order — grows until housing capacity
meets the (now-materialized) resident count or growth saturates. That is the
deterministic end-state the live sim would have converged to. Fully deterministic
given the skip's seeded `rng`; bounded by a runaway backstop on top of growth's
own saturation. A 50-year jump past a crowded village now lands on a town.

### 3. `grow_settlement` authoring command (Fate lever)
New verb in the command channel (`src/sim/command/settlement-verbs.ts`),
registered authoring-tier, cost 0, `targetKind: 'settlement'`, mirroring
`place_building`. Payload `{ steps?: number }` (clamped 1–64) runs the growth
sequence N times on the target plan. Agent influence is an **input to the seeded
planner** (a step budget), never a raw tile edit, so the world stays
replayable. Fate (or the Create panel) emits it like any other intent; it is
validated/previewable through the same `previewCommand` gate.

### 4. Civic entities + hard reservation
New `graveyard` prop kind (`well` already existed). In `placeSettlement`, every
`plan.civics` precinct now (a) reserves its tiles in a `civicSet` consulted by
both the slot fit-check and the fallback spiral — props don't block via
`canPlaceIgnoringNature`, so without this a fallback cottage could land on the
well (the S4 gotcha) — and (b) emits a standing prop for mapped civic types
(`well`, `graveyard`). Civic entities ride `result.entities` and are indexed
exactly like buildings. The **mill** and any agent-registered civic without a
known entity kind reserve ground but emit no prop yet.

## Invariants held
- Deterministic, seeded, `Math.random`-free (guard test applies). The skip and
  the command both draw only from the supplied `rng`.
- Growth has ONE implementation now; the live tick, the skip catch-up, and the
  Fate command are three callers of `growSettlement`.
- Open-registry seams unchanged (`DWELLING_CAPACITY`, `UPGRADE_CHAINS`,
  `CIVIC_RULES`); civic entity kinds map through `CIVIC_ENTITY_KINDS`.
- Civic entities are ordinary world entities → captured by `captureSnapshot`
  with no special handling.

## Versions
`WORLD_CONTENT_VERSION` 5 → **6** (worldgen now emits civic entities + reserves
their tiles). `ART_RECIPE_VERSION` unchanged (`v7`) — `graveyard` renders via the
prop fallback (square marker); no geometry change.

## Tests
- `tests/unit/settlement-growth-s5.test.ts` (15): tag-keyed id collision avoidance;
  saturation return value; skip grows toward population / no-pressure no-op /
  determinism / `applySkip` end-to-end; `grow_settlement` apply + steps budget +
  precondition rejects (target/poi/payload) + `executeCommand` end-to-end; civic
  well+graveyard emission, on reserved tiles, no building overlap, world-registered.
- Updated: `command-registry.test.ts` (16 verbs), `content-version.test.ts` (→6),
  `settlement-plan.test.ts` + `building-placer.test.ts` (filter civic props when
  counting buildings).

## Deferred to a later slice
- **Graveyard "filling"** — routing settlement `remains` into the graveyard over
  deep time (a `buried` count or physical relocation; the scalable model is a
  count, since a 2×2 yard can't hold centuries of dead). The graveyard precinct
  + entity is the anchor this will hang off.
- **Mill as a working building** (it reserves ground today, no entity).
- **Ward-mutation verbs** (`rename_ward` / `retype_ward`) — a separate
  district-authoring concern, not part of the growth/skip/civic story.
