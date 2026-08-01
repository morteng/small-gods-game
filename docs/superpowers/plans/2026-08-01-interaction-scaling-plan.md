# Interaction Scaling — implementation plan

**Status:** plan (2026-08-01). No code yet.
**Design:** `docs/superpowers/specs/2026-08-01-interaction-scaling-connectome-brainstorm.md`
(which extends `2026-06-20-unified-world-connectome-design.md`).
**Goal:** make the sim a real "social reactor" — interaction rates driven by
density, movement budgets, and network hierarchy — then *measure* the emergent
scaling exponents and pin them as contracts. Never hand-impose an exponent.

## What the code audit found (2026-08-01)

The brainstorm predicted "our current exponents are probably ~linear — the gap
is the roadmap." The audit says it's worse, in useful ways:

1. **Encounter rate is O(frozen edges), not O(density).**
   `NpcEncounterSystem` (`src/sim/systems/npc-encounter-system.ts`) iterates each
   NPC's `relationships` array and fires only on pairs that already have an edge,
   both socializing, Chebyshev ≤ 2, cooldown elapsed. `seedSocialGraph`
   (`src/sim/social-graph.ts:29`) freezes the edge set at worldgen; **no code
   path ever creates a `Relationship` at runtime**, and materialized P2 extras
   get no relationships at all — they can never encounter anyone. A bigger town
   produces zero extra encounters per capita. There is no density mechanism to
   measure yet.
2. **Communion saturates at ~5 believers.** `communeFrom`
   (`src/sim/systems/belief-propagation-system.ts:97`) uses `min(1, S)` over
   trust-weighted believer connections — congregation strength is flat above ~5.
   The belief economy is structurally **sub**linear by construction.
3. **The statistical cohort tier has no dynamics.** `cohorts.ts` running sums
   are inert between materializations; `CohortSystem` *asserts* stat counts are
   constant. The mean-field layer of the brainstorm's §5 does not exist yet —
   but the conservation/audit machinery it must be held to already does
   (`CohortLedgerCounters`, `tests/unit/materialization-conservation.test.ts`).
4. **No unified flux.** `RoadUseTally` (`src/world/road-use.ts:270`) is the one
   real flow meter and the reference design (transient tally on the Snapshot,
   folded EMA on the map, window-anchored so time-skip is free). The market
   visitor pull — the only genuine cross-POI commute flux — is **unmetered**.
5. **Per-settlement aggregates are 4+ duplicate O(N) sweeps** with a "must not
   disagree" convention: `residentsByPoi`, `censusBelieversByPoi`,
   `buildRivalSituation`, `censusCohorts`. `SettlementView` (`game-query.ts:188`)
   carries no belief/needs/flux and skips the cohort tier.
6. **probe-world measures worldgen only** — never ticks the sim. The harness to
   copy for a headless sim probe is `scripts/bench-sim-rate.ts` (state → seed →
   scheduler → advance).
7. **Contracts see only `{world, map}`** (`DiagnosticContext`), so
   `lint:world` can pin *structural* scaling (road surface vs pop) but dynamic
   scaling (encounter/rumour rates) needs the sim-probe harness.
8. **Fate already has the insertion point**: `buildFateContext`
   (`src/game/fate/fate-context.ts:340-354`) joins eleven bounded digests; a
   `describeSettlementsForFate` slots after `buildWorldSummary`, whose per-NPC
   roster (cap 30) is the thing aggregates should replace.
9. **VISION §9 row 12 (prayer subject) is CLOSED in code but stale in the doc**
   (`prayerSubject`, `WORSHIP_THRESHOLDS`, `props.prayerNeed` all shipped).
   **Row 11 (need direction) is still open**: `tickNpcEntity`
   (`src/sim/npc-sim.ts:61`) reads only the scalar `computeMood()` mean — and
   differentiated need is the microstate the whole theory runs on.

## Plan shape

Six phases, each an independently shippable slice with its own tests. Order is
measure → plumb → mechanism → mean-field → contracts → Fate. Phases 0 and 1
change no behaviour; Phase 2 is the first gameplay-visible change.

Dependencies: P2 needs P1's meters to be verifiable; P3 needs P1's aggregates;
P4's dynamic contracts need P0's harness; P5 needs P1. P0 must land **before**
P2 so we have a baseline to show the mechanism actually moved the exponents.

---

### Phase 0 — Measure the baseline (science first, no sim changes)

**S0.1 — `scripts/probe-scaling.ts`**, copying the `bench-sim-rate.ts` harness
(state → `planWorldLayout` → `generateWithNoise` → `seedWorld` → cohorts →
scheduler with the `sim-systems.ts` registration order → advance):
- Argv: seed array (default `[12345, 777, 42]`), sim-hours to run (default a
  few game-hours at max rate), `--json`.
- **Per-seed POI deep-clone** (the `connectome-lint.ts:57-60` gotcha —
  `snapDrySettlementsOffWater` mutates `poi.position` in place).
- Per settlement, record: population (named + cohort, via
  `residentsByPoi(world, cohorts)`), encounter count, rumour-spread count,
  belief-delta sums, prayer/worship count, road surface (structural: covered
  edge cells × class width), building count.
- Counters come from a probe-only instrumentation seam: an optional
  `onEncounter`/`onRumour` hook on the two systems (or an event-log scan —
  but prefer hooks; `EventLog.range` is O(n) and the probe runs long).
- Fit log-log slope per quantity across settlements (pooled across seeds);
  print slope + R². Output shape: `{ seeds, settlements: [...], fits: {...} }`.

**S0.2 — record the baseline** in the plan/spec doc (expected: encounters
~flat, belief ~sub-linear, road surface whatever worldgen authored). This
number is the before-photo every later phase gets compared against.

**S0.3 — doc hygiene:** mark VISION §9 row 12 closed (pointing at
`prayerSubject`/`prayerNeed`); leave row 11 open and reference this plan.

*Tests:* the probe is a script, but pin a tiny smoke test that the
instrumentation hooks fire deterministically on a micro-world.

### Phase 1 — Aggregates + flux plumbing (no behaviour change)

**S1.1 — `SettlementAggregates` store** (`src/sim/settlement-aggregates.ts`):
one sweep per GAME_HOUR building per-POI records, both tiers, following the
`buildRivalSituation` conventions exactly (one `forEachNpc` pass, sorted cohort
fold, plain counts/records, explicit baseline for trends):
```
SettlementAggregate {
  poiId, population: { named, statistical },
  believers: Record<SpiritId, { count, durable, meanFaith }>,
  needPressure: { safety, prosperity, community, meaning },   // means, kept directional
  prayerPressure, encountersWindow, visitorsWindow,
}
```
Consolidate the duplicate sweeps behind it where cheap (start with
`SettlementView.npcCount` and `residentsByPoi` callers; leave
`buildRivalSituation` alone until parity is proven — the "must not disagree"
convention becomes "read the same store").
- New `GameState` field ⇒ bump `GAME_STATE_FIELD_COUNT` + classify in
  `state-reset-parity.test.ts`; snapshot field + pre-field back-compat test per
  the `snapshot.test.ts:96,113` precedent.

**S1.2 — meter the unmetered flux.** A `SettlementFluxTally` shaped like
`RoadUseTally` (window anchor `sinceTick`, raw counts, snapshot-optional):
per-POI-pair counts of realized market visitors and (later) migrants. Producer:
`MaterializationSystem`'s visitor pull — it already knows `srcPoi`. Fold to an
EMA per game-day. This is the first entry of the brainstorm's "one `flux` field";
road traffic stays where it is (it already works) and gets *read through* the
same query surface.

**S1.3 — `GameQuery.settlementAggregates()`** + one MCP `registerTool`
delegation in `tools/mcp-server.ts`, DTO modeled on the existing golden-test
families. This gives the probe, the UI, and Fate one read path.

*Tests:* aggregate-vs-legacy-sweep parity on a seeded world; snapshot
round-trip incl. pre-field save; determinism (two runs, identical stores).

### Phase 2 — The social reactor (density starts to matter)

The one phase that changes NPC behaviour. Three mechanisms, each small:

**S2.1 — runtime acquaintance formation.** In `NpcEncounterSystem`, after the
existing edge-pair pass: co-located (`Chebyshev ≤ ENCOUNTER_RADIUS`) socializing
NPCs *without* an edge may form a weak `Relationship { type:'friend', trust:~0.15 }`
with probability `sociability × ACQUAINTANCE_RATE`, budgeted (max new edges per
NPC per day, max degree cap) and rng'd via `ctx.rng`. Materialized extras
participate — this is what makes encounter rate density-dependent, because the
market convergence loop (`community < 0.35 → market anchor`) already
concentrates people; today they just stand next to strangers forever.
- Persistence: relationships already live on the entity, so fold-back must
  either drop extra-NPC edges (cheap, defensible — acquaintances of a folded
  soul dissolve) or bank a scalar "sociality" into the cohort. **Start with
  drop + a conservation note**; revisit if it reads badly.

**S2.2 — de-saturate communion.** Replace `min(1, S)` in `communeFrom` with a
concave, unbounded curve (e.g. `S / (1 + S/S₀)` → asymptote is *also* wrong;
prefer `sqrt(S)` normalized so S=5 matches today's value) so a 50-strong
congregation beats a 5-strong one but with diminishing returns. Retune
`COMMUNION_RATE` so the documented equilibrium ("~5 mutual believers
self-sustain; a lone believer withers") still holds — that arithmetic in the
header block (`belief-propagation-system.ts:45-73`) is the invariant to
preserve, and it gets a test if it doesn't have one.

**S2.3 — need direction (VISION §9 row 11).** `tickNpcEntity` reads the
*minimum* need (direction), not just the mean: desperation boost keys on the
worst need and stamps which one; comfort decay keys on all-needs-met rather
than mean > 0.6. Small, surgical, and it's the microstate scaling runs on —
a settlement whose `prosperity` is collapsing while `safety` is fine must look
different in the aggregates, or Phase 5's Fate observables are mush.

**S2.4 — re-run the Phase 0 probe.** Acceptance for the whole phase: encounter
rate per capita now *rises* with settlement size (slope > 0 on the log-log
fit), belief-output slope moves toward superlinear, and the game-balance smoke
checks (existing belief-economy tests) still pass. Record before/after slopes
in this doc.

*Tests:* acquaintance determinism + budget caps; fold-back conservation with
dropped edges; communion equilibrium pin; need-direction unit tests
(the row-11 "no-op pressure" case must now move faith).

### Phase 3 — Mean-field settlement dynamics (the LOD layer)

Give the statistical tier laws, so out-of-attention settlements evolve instead
of freezing. All flows must be *explained* to `CohortSystem`'s ledger — extend
`CohortLedgerCounters` with the new flow kinds rather than weakening the audit.

**S3.1 — cohort belief drift.** Per GAME_HOUR, evolve each `CohortBelief`'s
running sums with mean-field forms of the same forces the named tier feels:
faith decay (skepticism/comfort from band `needs`), desperation boost, and a
congregation term driven by the settlement's own believer density (the S2.2
curve, applied to `believerCount`). Coefficients derived from the named-tier
constants × expected fire ratio — and verified by a **tier-parity test**: a
settlement simulated fully-named vs fully-statistical over N game-hours lands
within tolerance on total belief mass. This test is the conservation contract
of brainstorm §"What NOT to do".

**S3.2 — cohort migration.** Young-adult band (18–45 edges already exist in
`COHORT_BAND_EDGES`), prospect-driven: flow along `roadNeighbours` edges toward
settlements with higher opportunity (aggregate prosperity/need signal from S1),
rate small, apportioned deterministically (largest-remainder, like `apportion`),
metered into the S1.2 flux tally and ledgered as `migrations`. Belief travels
with the migrants' sums — the "calling home" edge (belief flowing back) is a
later refinement, noted not planned.

**S3.3 — materialization consistency.** `drawCohortSouls`/fold already
round-trip running sums exactly; drifting sums change nothing structurally, but
the audit's "stat counts constant" assertion (P1) must learn the two legal
mutation sources (drift doesn't change counts; migration does, via the ledger).

*Tests:* tier parity (S3.1), conservation of souls under migration, time-skip
parity (mean-field ticks are per-GAME_HOUR and closed-form-able — follow the
`projectRoadClassesOverSkip` pattern if skip windows exceed the hourly fire),
scrub/replay determinism.

### Phase 4 — Scaling contracts

**S4.1 — structural contract in `lint:world`:** a `level:'world'` invariant
`scaling.infrastructure-sublinear` — fit road-surface-vs-population across the
world's settlements; warn if the slope ≥ 1 (per-capita road surface should
*fall* with size once the wear economy has differentiated classes). Pure
`{world, map}`, so it fits the existing `DiagnosticContext`; `metrics` carries
slope + R², `registerContract` + import on the gen path.

**S4.2 — dynamic contracts as a probe gate:** `probe-scaling.ts --assert`
checks the fitted slopes against declared bands (encounters superlinear,
belief-output ≥ linear) and exits non-zero. Wire as an opt-in server-CI step
(same tier as `lint:world`), not a vitest — it ticks a real sim and belongs
next to the other world probes. A reduced micro-ensemble smoke test *can* live
in vitest if it stays under a few seconds; decide when we see the timings.

*Bands, not points:* contracts assert direction and rough magnitude
(e.g. slope ∈ [1.05, 1.35]), never exact 7/6 — the exponent is an output.

### Phase 5 — Fate reads the mean field

**S5.1 — `describeSettlementsForFate(state)`** in `fate-context.ts`: per
settlement (bounded, `MAX_SETTLEMENTS_IN_DIGEST`, deterministic order, `''`
when empty, try/catch), one line each: population + trend, dominant
belief + trend, worst need direction, prayer pressure, flux in/out, contention
state. Trends need a baseline — persist the previous digest's aggregate
snapshot the same way `rivalFollowerDelta` takes an explicit baseline.
Union its poiIds into `validPoiIds`.

**S5.2 — shrink the roster.** Replace `buildWorldSummary`'s 30-NPC roster in
the *Fate* prompt with the aggregate digest (keep the roster for the Create
panel — check callers before touching `world-summary.ts`; if shared, add a
`{ roster: boolean }` option instead of forking).

**S5.3 — golden tests** for the digest (formatting stability = prompt-cache
friendliness), and one FateBrain integration test that a settlement in
`schism` + collapsing `prosperity` surfaces in the prompt.

### Phase 6 — gameplay expressions (directional, not sliced)

Noted for later rounds, each its own brainstorm when scheduled: festivals as
deliberate density spikes (temporary encounter-radius/convergence boost →
superlinear devotion burst); exclusion pockets (aggregate need pressure ×
low flux → rival cult nucleation, feeds Track 3 contention with a spatial
cause); jamming (population ≫ road capacity → disease/safety pressure);
settlement extent from flux (the "bound state" definition — needs the flux
history from P1/P3 to mean anything).

---

## Disciplines (non-negotiable, from the audit)

- **No hand-imposed exponents.** Mechanisms in, slopes out, contracts assert
  bands. If a slope is wrong, fix the mechanism, not the assertion.
- **Determinism:** all new randomness via `ctx.rng`; sorted folds over Map
  keys; `apportion` for integer splitting; new stateful systems implement
  `SerializableSystem` and register with `state.systemState`.
- **Snapshot/save:** transient tallies ride the Snapshot (optional field +
  pre-field back-compat test); folded state rides the map/save; new
  `GameState` fields bump `GAME_STATE_FIELD_COUNT` same commit.
- **Conservation:** every population/belief flow across the tier boundary is
  ledgered and audited; the tier-parity test (S3.1) is the acceptance gate for
  the whole mean-field layer.
- **Skip parity:** anything with hysteresis or windows needs a closed-form
  projection (`projectRoadClassesOverSkip` is the pattern).
- **Perf:** no new `EventLog.range` windowed scans — use accumulators; one
  sweep per fold for aggregates; `KindIndex.byKind` allocates, don't call it
  per-tick per-POI.
- **`src/sim/` stays import-cycle-free and `Math.random`-free.**

## Suggested sequencing

P0 (probe + baseline) is a one-session slice and pure upside. P1 (plumbing) is
mechanical and de-risks everything after. P2 is the first design-sensitive
slice — land it behind the P0 before/after comparison. P3 is the largest and
most novel (the LOD layer); it can trail P2 by any distance. P4/P5 are small
and independent once P0/P1 exist. Each phase = its own branch off main, server
CI green before push, per the standing git rules.

## Baseline (measured 2026-08-01)

Measured with `scripts/probe-scaling.ts 12345 777 42 --hours 6` (default seeds
and default `--hours`) against `public/data/worlds/default.json`, on the
harness described in S0.1. Wall-clock: **227s (~3.8 min)** for all 3 seeds ×
6 game-hours each — well inside the ~8-minute budget. 27 inhabited-POI rows
(9 settlements × 3 seeds), `residentsByPoi` population (named + statistical).

**Fitted log-log slopes (quantity vs total population, pooled across seeds):**

| quantity | slope | R² | n | note |
|---|---|---|---|---|
| encounters | — | — | 0 | **zero** in all 27 rows — no fit possible |
| rumours | — | — | 0 | **zero** in all 27 rows — no fit possible |
| beliefDeltaSum | — | — | n/a | nonzero **only** in `khar_ordu` (all 3 seeds); population is identical (72) across those points → zero x-variance, fit undefined |
| prayers (worship-activity samples) | — | — | n/a | same as above: nonzero only in `khar_ordu`, zero x-variance |
| roadSurface | −0.930 | 0.570 | 13 | negative, not sublinear-positive — see caveat below |
| buildings | 1.851 | 0.675 | 23 | superlinear-looking, but see caveat below |

**The headline finding is sharper than the audit predicted, not just softer.**
The audit expected encounters to read "~flat" because the social graph is
frozen at worldgen (finding #1). What the probe actually shows: under the
*current* `public/data/worlds/default.json`, **only one settlement
(`khar_ordu`) has any named NPCs at all** — 6, all authored in the seed file,
fully cross-connected by `seedSocialGraph` (5 relationships each). Every other
settlement (`ironvein_mine`, `crossroads_inn`, `old_watchtower`, `dawn_temple`,
`millbrook_farm`, `ironkeep_castle`, `oakshire`, `stonehaven_city`) is **pure
statistical-cohort population** (36–144 "residents") with **zero individual
entities** — so `NpcEncounterSystem`, `BeliefPropagationSystem`, and the
worship-activity sampler literally cannot act there: there is no per-soul state
for the named-tier mechanisms to touch, let alone scale. This isn't just "the
social graph doesn't grow" (finding #1) — it's "the social graph doesn't exist
outside one settlement," which makes any encounter/rumour/belief scaling
**unmeasurable across settlements** until either the default world seed names
more residents or Phase 3's mean-field layer gives the statistical tier its own
dynamics. More surprising still: even inside `khar_ordu`, with 6 fully
cross-connected named NPCs and 6 real game-hours (three separate seeds, same
result each time), **`NpcEncounterSystem` fired zero encounters** — communion
(belief propagation) and worship-activity sampling both show healthy nonzero
signal there in the same window, so the belief/prayer machinery is live; the
encounter mechanism specifically (co-located AND both `activity==='socialize'`
AND cooldown-clear) never lined up. Root-causing that gap is Phase 2 work
(S2.1), not Phase 0's — this probe's job was to measure honestly, and it did.

**Structural quantities** (roadSurface, buildings) don't need named NPCs and
did fit, but both carry a caveat worth flagging rather than smoothing over:
`roadSurface` came out **negative** (−0.93, not the sublinear-*positive*
~5/6 Bettencourt predicts) because the two largest settlements (`oakshire`,
`stonehaven_city`, pop 144) show **zero** attributed road surface in several
seeds — their road-graph nodes evidently don't carry a direct `poiRef` the
probe's edge-attribution walk picks up (possibly hub junctions rather than
POI-tagged endpoints, or edges pruned by `mergeParallelRoads`). `buildings`
scaling superlinear (1.85) is plausible but likely partly circular: statistical
population is seeded in relation to housing capacity, so building count and
population aren't fully independent measurements here. Both are flagged as
**measurement-method caveats**, not asserted findings — Phase 4's structural
contract work should re-derive road attribution from the graph more carefully
before trusting a sign, let alone a magnitude.

**Bottom line for Phase 2+:** the "before" photo isn't a shallow slope to
steepen — it's an absence of population diversity for the named-tier
mechanisms to run against at all, plus one live mechanism (`NpcEncounterSystem`)
that didn't fire even where it structurally could. S2.1 (runtime acquaintance
formation, materialized extras) and S1/S3 (mean-field dynamics for the
cohort-only settlements) are both prerequisites for a re-run of this probe to
show anything other than "insufficient data" on the interaction quantities —
matching the plan's own dependency note that P3 (mean-field) is what makes the
majority of settlements measurable at all, not just P2.

## After Phase 2a (measured 2026-08-01, `feat/scaling-p2a-encounters`)

### Root cause of the zero-encounter baseline (S2a.0)

The audit's finding #1 (frozen social graph) was **not** why zero encounters
fired. Instrumenting positions + activities at 1 sim-second resolution over one
game-hour inside `khar_ordu` (genSeed 12345, the settlement that *does* have six
fully cross-connected named NPCs) gives an unambiguous answer:

| activity | NPC-samples over 1 game-hour (6 NPCs × 3600 s) | share |
|---|---|---|
| `worship` | 21,393 | **99.04 %** |
| `work` | 117 | 0.54 % |
| `wander` | 53 | 0.25 % |
| `idle` | 37 | 0.17 % |
| `socialize` | **0** | **0 %** |

`meaning` decays `MEANING_DECAY = 0.004` per 1 Hz `tickNpcEntity` fire and
**nothing mortal restores it** — `SELF_AGENCY_RESTORE` deliberately excludes
`worship` ("meaning is restored only when a god Answers"), leaving exactly two
inflows: `answerPrayer` and the `festival` settlement event. In a headless probe
(and in any unattended stretch of a live game) neither fires, so every named soul
crossed the 0.3 worship threshold within ~35 sim-seconds and then prayed
**forever**. `worship` outranks the social calendar by design (M0.a), so
`socialize` never fired once — and `NpcEncounterSystem`'s gate (BOTH parties
`socialize`) was therefore unsatisfiable by construction. Not a tuning gap: a
structural lock.

Two secondary findings, both worth recording:

- **The travel-budget hypothesis is real but was not the blocker here.**
  `ACTIVITY_DURATION_MIN/MAX = 3/12` are counts of 1 Hz fires, and NPCs walk at
  `NPC_WALK_SPEED = 1.4` tiles/s — but `khar_ordu`'s six homes sit 3–5 tiles from
  its well (2.3–4.6 s of walking), which fits inside the window. The mismatch
  bites in the *larger* settlements the probe could not previously populate,
  whose resident slots spread over tens of tiles. Fixed anyway (S2a.1): the walk
  is now budgeted on top of the dwell.
- **The Phase 0 probe's own chunking was an artifact.** `Scheduler.tick` runs each
  system's whole catch-up loop before moving to the next system, so the probe's
  one-GAME-HOUR chunk ran 216,000 consecutive movement ticks against frozen
  activity targets, THEN 3,600 consecutive activity re-evaluations against frozen
  positions, THEN 3,600 encounter checks at a single frozen `now` — at most ONE
  encounter per pair per chunk was even reachable, and the per-GAME_HOUR-gated
  systems (growth, mortality, births, road evolution) saw a `now` that never
  moved. The probe now chunks at `RATE_CHUNK_SIM_MS` (250 ms), the live
  fast-forward slice. **This makes the probe ~8× more expensive**, which is why
  the after-run below uses fewer seeds/hours than Phase 0's 3 × 6 h.

### What changed (S2a.1 / S2a.2)

1. **Worship became a public errand.** It prayed at the mortal's own doorstep
   behind a "future: go to temple/altar" placeholder; it now walks to the same
   gathering tile socializing mortals head for. The plea is untouched (same
   `prayerNeed`, same `activity === 'worship'` the Track-3 claim ledger ages and
   `tickNpcEntity` bleeds faith against) — only the place moved.
2. **Venue-bound errands budget the walk** on top of the 3–12 s dwell, and
   `socialize` only earns its `SELF_AGENCY_RESTORE` if the mortal actually
   arrived (`VENUE_ARRIVAL_RADIUS`). A failed errand leaves community low so the
   mortal sets out again instead of being paid for company it never had.
3. **Runtime acquaintance formation** — the first code path in the game that
   creates a `Relationship` after worldgen. Co-located gathering strangers form a
   weak `friend` edge at `min(sociability) × ACQUAINTANCE_RATE`, capped by
   `MAX_ACQUAINTANCES_PER_DAY = 3` and `MAX_SOCIAL_DEGREE = 12`. Materialized
   extras participate.
4. **Probe seam** (`MaterializationSystem.materializeForProbe`, game-unused) so
   `--materialize N` populates every settlement through the shipped `spawnN`.

### Controlled before/after (mechanism only, identical harness)

Same seed (12345), same world, same 250 ms chunking, `khar_ordu`, 1 game-hour,
named residents only — the ONLY variable is the S2a code:

| | encounters | socialize episodes |
|---|---|---|
| before (main @ 74700789) | **0** | 0 |
| after (this branch) | **30** | 0 |

30 = 15 pairs × 2 `ENCOUNTER_COOLDOWN_TICKS` windows per hour: the **saturation
ceiling** for a frozen 6-node complete graph. Note `socialize` is still zero —
every one of those meetings is the *worship congregation*, because the
meaning-decay lock is untouched by this branch (see "open, and not ours" below).

### Scaling fits, populated world

`npx tsx scripts/probe-scaling.ts 12345 --hours 1 --materialize 32` — one seed,
9 inhabited POIs, 32 cohort souls materialized per settlement:

| poi | pop | named | encounters | acquaintances |
|---|---|---|---|---|
| ironvein_mine | 36 | 32 | 88 | 46 |
| crossroads_inn | 36 | 32 | 90 | 45 |
| old_watchtower | 36 | 32 | 96 | 48 |
| khar_ordu | 72 | 38 | 138 | 54 |
| dawn_temple | 72 | 32 | 89 | 45 |
| millbrook_farm | 72 | 32 | 94 | 47 |
| ironkeep_castle | 72 | 32 | 94 | 48 |
| oakshire | 144 | 32 | 30 | 15 |
| stonehaven_city | 144 | 32 | 73 | 38 |

| quantity | Phase 0 slope | after slope | R² | n |
|---|---|---|---|---|
| encounters | **no fit (all zero)** | −0.423 | 0.306 | 9 |
| acquaintances | (mechanism did not exist) | −0.429 | 0.363 | 9 |
| rumours | no fit (all zero) | no fit (all zero) | — | 0 |
| beliefDeltaSum | no fit | no fit (only `khar_ordu`) | — | — |
| prayers | no fit | +0.006 | 0.003 | 9 |
| roadSurface | −0.930 | −0.951 | 0.643 | 5 |
| buildings | 1.851 | 1.850 | 0.693 | 9 |

**Read this honestly: encounters are now nonzero everywhere, and the slope is
NEGATIVE.** That is a measurement artifact of the cap, not a property of the
mechanism — the x-axis is TOTAL population (36→144) while the population that
can actually interact was pinned at 32 by `--materialize 32` in every settlement.
The probe now also fits against NAMED population for exactly this reason. The
residual negative signal is real, though, and has a real cause: `oakshire`
(30 encounters vs `old_watchtower`'s 96) spreads its 32 extras over 22 buildings
across a much wider footprint, so fewer of them reach the well inside a dwell —
**geography, not sociology**. That is the travel-budget effect surviving the
travel budget, and it is the honest lead for the next slice.

**Also honest: this mechanism cannot produce sustained superlinear encounter
scaling, by construction.** `MAX_SOCIAL_DEGREE = 12` plus a per-pair
`ENCOUNTER_COOLDOWN_TICKS` (30 real minutes) caps any mortal at 24 encounters per
hour no matter how big its town is. Density changes how FAST a soul fills its
degree budget, not the ceiling it fills to — so per-capita encounter rate is
transiently rising and asymptotically FLAT. If the round wants a superlinear
exponent out of this channel, the degree cap has to become size-dependent, or the
cooldown has to stop being per-pair. Recording that as a mechanism property
rather than quietly loosening a cap to hit a number.

### Open, and NOT fixed by this branch

- **The meaning-decay runaway** (`MEANING_DECAY` in `src/sim/npc-sim.ts`) is the
  root cause above and it is still live: at 1:1 realtime a mortal's `meaning`
  falls from full to the 0.3 worship line in ~3 real minutes, and only a god's
  answer or a festival raises it. A settlement no god is attending is
  permanently on its knees. Deliberately untouched here — `npc-sim.ts` and need
  *direction* are the belief half's file (plan S2.3) — but it needs a decision,
  because it is not obviously a bug: it may be exactly the "gods must answer"
  pressure VISION intends, in which case the constant is simply mistuned for
  1:1 realtime (it predates R8).
- **Rumours stay at zero** because `spreadRumour` needs `domains` on the speaker,
  and neither the authored named NPCs nor materialized extras carry any.
- **`beliefDeltaSum` stays confined to `khar_ordu`**: communion runs on the
  relationship graph, and extras start with none. Acquaintance edges will feed it,
  but a 1-hour probe only just starts building them (3 edges/soul/day cap).
- **A multi-seed, fully-populated after-run was attempted and abandoned on cost.**
  `--materialize 400` (materialize every cohort: ~684 NPCs across 9 settlements)
  did not finish ONE seed-game-hour in 50 minutes of wall clock, against 218 s for
  the same seed-hour at `--materialize 32` (~296 NPCs). Wall-clock grows far
  faster than linearly in materialized population. **Unverified hypothesis worth
  checking before the next probe run:** the S2a convergence mechanism now sends
  hundreds of mortals to ONE tile, and `findPath` (which takes `world` + the
  entity id, i.e. considers occupancy) degrades badly when a destination
  neighbourhood is crowded. If so it is not only a probe problem — it is the
  frame budget in any focused, materialized town, and the natural fix is a spread
  of gathering tiles (a market APRON rather than the wellhead) plus an arrival
  test that stops re-pathing once the mortal is inside `VENUE_ARRIVAL_RADIUS`.
  Until that is understood, size probe runs by materialized NPC count, not by
  simulated hours.
