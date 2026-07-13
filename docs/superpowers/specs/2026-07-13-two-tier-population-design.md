# Two-Tier Population — Named Souls & Statistical Cohorts (Epic Design)

**Status:** Draft 2026-07-13. Design only — no code changes ship with this doc.

**One-line:** Scale settlement population past the named-NPC cap with a per-settlement **statistical tier** (demographic cohorts carrying aggregate belief per spirit) that the belief economy, rivals, and Fate read directly — individuals **materialize deterministically out of their cohort when a god's attention needs them** and fold back when it lapses, under one hard invariant: **souls are conserved** (births − deaths ± migration only; houses never create people).

---

## 1. Motivation — and why not GTA-style ambient population

Every open-world game with crowds fakes them: pedestrians spawn at the edge of the camera frustum, despawn behind your back, and nobody audits the books. That is the correct engineering answer when people are *scenery*. In Small Gods, people are **the substrate of the entire economy**:

- **Power regen is a per-soul sum.** `SpiritSystem` (1 Hz) walks every living NPC and accumulates `faith × (1 + 2·understanding) × (1 + 2·devotion)` into each spirit's power (`src/sim/spirit-system.ts:16–31`). A spawned NPC is minted power; a despawned one is confiscated power.
- **Belief propagates along persistent relationship edges.** `BeliefPropagationSystem` transfers faith across `relationships` (trust-weighted), and the round-7 COMMUNION term makes a congregation of ~5+ self-sustaining against decay (`src/sim/systems/belief-propagation-system.ts:1–50`). Despawning half a congregation silently changes whether the remainder withers.
- **Prayers are stateful.** A prayer is an NPC in `activity === 'worship'` with a `prayerSince` stamp; a plea unanswered for half a day becomes rival-claimable (`src/sim/rival-claims.ts:139–148`, `PRAYER_CLAIM_WINDOW_TICKS` at `:43`). A despawned petitioner is a claim that evaporates — or worse, a claim the player could dodge by scrolling away.
- **Nothing is ever deleted.** Death converts the entity to `kind:'remains'`; the soul stays queryable and lapsed believers stay re-convertible (`src/world/npc-lifecycle.ts:26–45`, `src/sim/believers.ts:11–13`). Ambient despawning is deletion by another name.

### The exploit that forces the invariant

Housing is already a **capacity constraint growth responds to**: `SettlementGrowthSystem` builds a dwelling when a settlement's living population exceeds its summed `DWELLING_CAPACITY` (`src/sim/systems/settlement-growth-system.ts:205–210`, capacities at `:58–63`). That direction of causality — *people cause houses* — is load-bearing. If an ambient system ever derived population from housing (the GTA/city-builder reflex: "this district has N houses, so render N·k people"), the loop closes into a money printer:

> build houses → houses imply people → people are believers → believers regen power (`spirit-system.ts:21–25`) → power funds miracles → prosperity funds houses…

Every step exists in the shipped game today except the second, and the second is exactly what naive ambient population would add. So the invariant is stated up front and everything below is designed to make it checkable:

> **Conservation of souls.** For each settlement, population changes only by births, deaths, and migration. Materialization and fold-back are zero-sum transfers *between tiers*, never sources or sinks. Houses gate where people can live and when births throttle; they never create people.

### Why we need a second tier at all

Today population is small by construction: `POP_CAP_PER_POI = 24` (`src/sim/systems/birth-system.ts:11`) caps births per settlement, and everything full-scans the living: `SpiritSystem` at 1 Hz, `PerceptionSystem` at 2 Hz filling an r² tile disc per believer (`src/world/perception-system.ts:19,54–68`), `buildRivalSituation` one pass per waking rival (`src/sim/rival-claims.ts:85–131`), and the renderer re-emits the NPC draw layer every frame (`src/render/iso/entity-draw-list.ts:56–63`). A market town should *feel* like 300 souls, a city like 3,000 — but 3,000 full-sim NPCs breaks both the 1 Hz sim scans and the draw list (§7). The answer is not to fake the people; it is to keep them real at a different resolution.

---

## 2. The metaphysical frame — attention individuates (and the code already believes this)

VISION §2.3 is explicit: belief does **not** make the world exist — the unrealized world runs fully under Fate; what belief buys a god is a **sphere of attention** within which the world is *present to you* and draws narrative detail (`docs/VISION.md:78–98`; misframing #9 in the same doc warns against "belief creates reality"). This epic extends that cosmology from tiles to souls, and closes the game's central symmetry:

> Mortals' belief makes gods real. A god's **attention** makes mortals **individual**.

A cohort mortal is not fake and not "unspawned." She exists, ages, prays, and believes — the sim carries her, statistically, exactly as Fate carries unrealized terrain. What she lacks until a god attends her is *individuation*: a name, a face, a walk, a memory ring. The codebase already implements this pattern three times:

1. **Tiles.** `Tile.state: 'void'|'realizing'|'realized'` (`src/core/types.ts:14`) with `PerceptionSystem` collapsing void tiles inside believers' perception reach, deterministically ordered and event-logged (`src/world/perception-system.ts:75–98`).
2. **Souls across a time-skip.** `projectTurnover` runs whole generations as projections — `SynthChild` records with belief, lineage, home, and *no entity* (`src/sim/turnover.ts:30–37,86–152`) — and `materializeSynthChild` individuates one into a live NPC with a seeded name/personality and a deterministic id, placed on a co-located resident's tile (`src/world/npc-lifecycle.ts:123–151`).
3. **The attention surface.** The NPC panel is the shipped statement that *paying attention* is the player-facing act, with a deterministic floor and disposable narration (`docs/superpowers/specs/2026-06-03-npc-attention-surface-design.md` §1, §6).

The statistical tier is these three primitives generalized: cohorts are `projectTurnover`'s soul-projection made a **permanent, live-ticking representation** rather than a skip-only transient, and materialization is `materializeSynthChild` given triggers, a protocol, and a fold-back.

---

## 3. The cohort data model

### 3.1 Shape

Per settlement (`poiId`), a `SettlementCohorts` record — plain data (numbers and records only) so it snapshots via `structuredClone` and rides `SAVE_VERSION` like `NpcProperties` does (the same "plain counts snapshot trivially" argument `RivalSituation` makes at `src/sim/rival-claims.ts:82–84`).

```ts
interface SettlementCohorts {
  poiId: string;
  bands: CohortBand[];              // fixed band edges, index-stable
  /** Monotonic per-settlement draw counter — the materialization determinism anchor (§4.2). */
  drawCount: number;
  /** Settlement-level plea ledger per spirit (§5.3). */
  pleas: Record<SpiritId, { count: number; oldestSince: number }>;
}

interface CohortBand {
  /** [minAge, maxAge) in years. */
  ageMin: number; ageMax: number;
  count: number;                     // integer souls (stochastic rounding, §3.3)
  /** Fractional-age accumulator: souls promoted to the next band as it fills (§3.3). */
  agingFrac: number;
  /** Per-spirit RUNNING SUMS (not means) — exact under add/remove (§3.2). */
  belief: Record<SpiritId, CohortBelief>;
  needs: { safety: number; prosperity: number; community: number; meaning: number }; // means
}

interface CohortBelief {
  sumFaith: number;
  sumU: number;                      // Σ understanding
  sumD: number;                      // Σ devotion
  /** Σ faith·(1+2u)·(1+2d) — the power-contribution sum, kept exactly (§5.1). */
  sumContribution: number;
  believerCount: number;             // souls with faith ≥ BELIEVER_THRESHOLD
  durableCount: number;              // souls passing isDurable (believers.ts:16–18)
}
```

**Band edges** align with the shipped lifecycle constants rather than round numbers: `0–15` (child; `ADULT_AGE = 15`, `src/sim/mortality.ts:8`), `15–18`, `18–45` (fertile; `FERTILE_MIN_AGE/MAX_AGE`, `src/sim/systems/birth-system.ts:8–9`), `45–55`, `55–75`, `75–95` (senescence ramp; `SENESCENCE_START = 55`, `MAX_AGE = 95`, `mortality.ts:12–14`). Six bands; every rate the live systems use is constant or monotone within a band.

**Where it lives:** on `GameState` (keyed map, sorted iteration), not on `GameMap` — it is sim truth, not worldgen. It is written ONLY by the cohort system, the D2 skip integrator, and the materialize/fold transfer functions, all through one module (`src/sim/cohorts.ts` when built) so the conservation ledger (§5.2) has a single choke point.

### 3.2 Running sums, not means

Storing `sumFaith` etc. instead of `meanFaith` makes materialization exact: sampling a soul out subtracts her contribution; folding her back adds it. No drift, no renormalization step, and the power read (§5.1) is exact rather than a product-of-means approximation (Jensen's inequality would otherwise overstate power for any correlated faith/devotion population — and faith/devotion *are* correlated by construction, `isDurable` at `src/sim/believers.ts:16–18`).

### 3.3 Update rules — GAME_HOUR_HZ, expected-value with stochastic rounding

A `CohortSystem` fires at `GAME_HOUR_HZ` (`1/3600`, `src/core/calendar.ts:17`) — the exact cadence the day-keyed lifecycle systems adopted under 1:1 realtime (`MortalitySystem`/`BirthSystem`/`SettlementGrowthSystem` all fire hourly with per-day rates re-derived via `perCheckFromPerDay`, `calendar.ts:24–26`, `settlement-growth-system.ts:42–50`). Per fire, per settlement in **sorted poiId order** (the replay-stable iteration pattern of `birth-system.ts:39–41`):

- **Deaths:** expected deaths per band = `count × hourly(annualMortality(bandMidAge))`, using the shipped curve (`mortality.ts:27–32`). The fractional expectation accumulates; **stochastic rounding through `ctx.rng`** (draw once per band only when the accumulator crosses a soul) keeps counts integer and deterministic without per-soul draws. Deaths remove a *mean* member: subtract `count⁻¹ × each sum`. Tally `recordBurial` against the settlement graveyard as live mortality does (`src/world/npc-lifecycle.ts:34–36`).
- **Births:** expected births = `pairs(fertileBand) × hourly(BIRTH_RATE_PER_PAIR)` (`birth-system.ts:16,23`), **gated by housing-derived headroom, not `POP_CAP_PER_POI`** (§5.2). Newborns enter band 0 with belief diluted from the fertile band's means by the shipped inheritance fractions — `INHERIT_FAITH_FRAC = 0.4`, `INHERIT_UNDERSTANDING_FRAC = 0.05`, devotion 0 (`src/world/npc-lifecycle.ts:11–13`, mirrored in `turnover.ts:53–68`).
- **Aging:** each hour adds `count / (bandWidth × hoursPerYear)` to `agingFrac`; when it crosses 1, promote one mean member to the next band (move `count⁻¹ × sums`). This is the continuous-time equivalent of a Leslie-matrix step (§5.4) and avoids a thundering year-boundary.
- **Belief drift:** aggregate analogues of the live per-NPC loop — decay at `FAITH_DECAY_BASE × meanSkepticism` (`src/sim/npc-sim.ts:18,70`; cohorts carry a fixed skepticism prior per settlement until proven insufficient), and a communion term keyed on `believerCount` density mirroring the R7 arithmetic so a statistically-devout settlement self-sustains exactly like a named congregation. Divine actions and events targeting a settlement (festival, drought, an area-effect miracle) apply deltas to band sums directly.

Total per-hour cost: `settlements × bands × spirits` — dozens × 6 × ≤4 ≈ hundreds of float ops. Negligible next to the existing 1 Hz scans (§7).

**What cohorts deliberately do NOT carry:** individual positions, relationships, memory rings, activity states, personalities. That is the *point* — those are what attention buys (§4.3).

---

## 4. The materialization protocol

### 4.1 Triggers

An individual crystallizes out of a cohort when — and only when — some consumer needs a *subject* rather than a statistic:

1. **Player focus/zoom.** The camera settles on a settlement at an NPC-legible zoom band (the semantic-zoom bands already gate what UI affordances appear) and the visible named population under-represents the cohort population. Materialize up to the scene budget (§7), nearest-band-first.
2. **Fate needs a subject.** `arm_staged_beat` with a storylet ref needs a discoverable carrier; the storylet `subject:` binding gap (noted in CLAUDE.md's story-pack gotcha) is *solved* by cohort draw: "a miller's daughter in Thornbridge" becomes a materialization request with role/band constraints.
3. **The divine inbox needs a petitioner.** A settlement-level plea (§5.3) that the player opens/answers materializes its petitioner so `answer_prayer` has its NPC target and the answered soul carries the memory forward.
4. **A rival claim lands on a statistical plea** above the surfacing threshold (§5.3) — the lost soul materializes lapsed, so the player can see who they failed.

De-materialization (fold-back) is the reverse and much rarer: an NPC may fold only when she has been outside every attention trigger for a grace window (order: days, sized in REAL time per the durable rule), is bound to no live thread/storylet/inbox item, and her memory ring holds no divine interaction above a salience floor. **Named-seed NPCs and anyone the player has whispered to never fold** — individuality, once granted by attention, is sticky (this is also the cheap answer to fold-thrash). Death never folds: remains persist (`npc-lifecycle.ts:26–45`).

### 4.2 Determinism — the seed derivation

Materialization must be scrub/replay-stable AND must not perturb the shared sim rng stream (the discipline `findClaimablePrayers` follows by not touching rng in the single-eligible case, `src/sim/rival-claims.ts:186–206`). So each draw runs on a **dedicated derived stream**:

```
drawSeed = mix(worldSeed, hash(poiId), bandIndex, cohorts.drawCount)
rng      = createRng(drawSeed)            // sfc32 via expandSeed (src/core/rng.ts:14–27,57–59)
cohorts.drawCount++                       // snapshot state → replay reproduces the sequence
```

`drawCount` rides the snapshot, so a scrub past three materializations and a re-play reproduces the same three souls in the same order — the same property `birthNpc`'s rng-derived ids rely on (`npc-lifecycle.ts:82–84`). The entity id is `npc-m${tick}-${rng.nextInt(0x7fffffff)}` with the same collision-guard loop.

### 4.3 What is sampled vs synthesized

| Field | Source |
|---|---|
| Age | Sampled uniform within the band (seeded). |
| Belief per spirit | **Threshold-first sampling:** draw believer-membership as Bernoulli(`believerCount/count`), then faith conditional on membership around the band mean with seeded jitter, clamped. This preserves `believerCount` exactly — sampling around the raw mean would erode the believer fraction whenever the distribution is bimodal (devout core + lapsed rest), which is the *normal* shape of a contested settlement. |
| Understanding / devotion | Sampled around band means, correlated with the faith draw (durable believers exist; `believers.ts:16–18`). |
| Needs | Band means + jitter. |
| `homePoiId`, home position | The cohort's settlement; placed on a co-located living resident's tile, the `materializeSynthChild` baseline (`npc-lifecycle.ts:134–139`), else a dwelling doorstep. |
| Name, personality, role | Synthesized fresh via `initNpcProps` with a seeded personality (`npc-lifecycle.ts:126`) — cohorts don't carry personalities, attention invents them. Role constrained by the trigger (Fate asked for a miller's daughter). |
| Relationships | **Stitched, not empty:** 1–3 edges to existing named residents of the same POI (seeded pick; `type:'family'` when a same-band named lineage exists, else `'friend'` with seeded trust). An edgeless NPC is invisible to `BeliefPropagationSystem` and to death-memory fan-out (`npc-lifecycle.ts:41–44`) — she would be individuated but socially inert, which reads as wrong within minutes. |
| Memory ring | Empty, plus one framing memory ("has lived in ⟨settlement⟩ all her life") so Mind-mode narration has soil. |

**Conservation mechanics:** decrement `band.count`, subtract the *sampled* soul's exact belief contributions from the running sums (not the mean — the sums stay consistent with the souls actually remaining). Fold-back adds her *current* values back — belief earned as a named NPC flows into the aggregate, which is exactly right: the god's attention enriched the cohort.

---

## 5. Conservation, the ledger, and reading the statistical tier

### 5.1 The belief economy reads cohorts

`SpiritSystem`'s tick gains one term per spirit: `Σ_settlements Σ_bands sumContribution × POWER_REGEN_RATE` — exact, because `sumContribution` is maintained as its own running sum (§3.2) with the identical formula the named loop uses (`spirit-system.ts:21–25`). `countPlayerBelievers` and the UI totals become `named + Σ believerCount` (`src/sim/believers.ts:22–29` gains a cohort term). `buildRivalSituation` extends `playerFollowersInSettlement` / `rivalFollowersInSettlement` with cohort believer counts in the same one-pass build (`rival-claims.ts:85–131`) — the rival decider sees the true balance of souls, named or not.

### 5.2 Housing gates births; the ledger proves it

`POP_CAP_PER_POI = 24` (`birth-system.ts:11`) retires in favor of a **housing-derived cap**: cohort+named births throttle as total population approaches `Σ DWELLING_CAPACITY × slack` (slack ≈ 1.25 — medieval overcrowding pressure, the same overshoot that makes `SettlementGrowthSystem` fire at all, since it triggers on `pop > capacity`, `settlement-growth-system.ts:205–210`). The shipped growth loop is unchanged in direction: population presses on housing → dwellings get built → the birth throttle relaxes. `residentsByPoi` (`settlement-growth-system.ts:103–110`) becomes `residents + cohortPopulation`, so growth responds to people who exist statistically — houses for real (aggregate) souls, never souls from houses.

**The ledger test** is the invariant made executable: every mutation of a cohort count emits a typed event (`cohort_births`, `cohort_deaths`, `cohort_migration`, `npc_materialized`, `npc_folded` — joining `npc_birth`/`npc_death` in the `EventLog`), and a guard test integrates the log over a long deterministic run asserting `Δ(named + cohort) = births − deaths ± migration` per settlement and globally, with materialize/fold summing to zero. This is the two-tier analogue of `no-random-in-sim.test.ts` — a cheap permanent tripwire against any future code path minting souls.

### 5.3 Statistical prayers and rival claims

Cohorts pray in aggregate. Each hour, expected worshippers per settlement = `believerCount × worshipPropensity(unmet needs)` accumulate into the settlement plea ledger `pleas[spiritId] = { count, oldestSince }` — the settlement-level analogue of the per-NPC `prayerSince` stamp (`rival-claims.ts:139–148`), aged by the same `PRAYER_CLAIM_WINDOW_TICKS` half-day (`:43`).

- **Warning:** ledger age past `PRAYER_CLAIM_WARNING_TICKS` feeds `prayerPressureInSettlement` (`rival-claims.ts:111–113`) so rival opportunism and the player's threat pins see statistical neglect identically to named neglect.
- **Claiming:** an eligible rival (territorial presence + affordability, unchanged: `rival-claims.ts:157–174`) claims a statistical plea through the command channel at `ANSWER_PRAYER_COST` (`src/sim/divine-actions.ts:18`) via a cohort-target variant of `answer_prayer` — **no new write path**, honoring the Track-3 design rule (`rival-claims.ts:17–19`). The deterministic effect moves one mean believer's faith mass from the player's aggregate toward the rival's within the band sums.
- **Surfacing:** claims accumulate silently until a per-settlement threshold, then the *next* claim materializes its petitioner as a lapsed NPC (§4.1 trigger 4) and lands the "you were beaten to it" inbox notice. Losses stay legible without spamming one card per statistical soul.

The player answers statistical pleas the same way: answering a settlement plea from the inbox spends `ANSWER_PRAYER_COST` and shifts the aggregate; opening the plea *first* materializes the petitioner for the full named-path experience. Attention, again, is the differentiator.

### 5.4 D2 time-skip — cohorts integrate in closed form

`applySkip` today projects turnover per individual — one rng draw per soul per projection (`src/sim/time-skip.ts:46`, `turnover.ts:86–152`), fine at 24/POI, hopeless at 3,000. Cohorts skip as a **Leslie-matrix step per year**: survival per band from `annualMortality` at band midpoints (`mortality.ts:27–32`), fertility on the 18–45 band from `BIRTH_RATE_PER_PAIR_YEAR` (`turnover.ts:22` — inheriting its documented expected-value-vs-Bernoulli calibration caveat, which becomes *more* accurate at cohort scale, not less), newborn belief diluted by the §3.3 fractions, belief decay/communion applied at annual granularity. Pure matrix arithmetic — deterministic without touching rng except for terminal stochastic rounding. Named NPCs keep the existing `projectTurnover` path unchanged; `growSettlementsOnSkip` reads the combined post-skip population (`settlement-growth-system.ts:224–249`), so a century skip grows towns to house their statistical descendants. Road evolution already keys on `residentsByPoi` (`time-skip.ts:71–76`) and inherits the combined count for free.

---

## 6. Migration

Souls move between settlements as hourly cohort flows — the third and final term of the conservation equation:

- **Drivers (deterministic, computed per pair of road-connected settlements):** capacity headroom differential (overcrowded → roomy), needs differential (starving → prosperous), and road connectivity/cost from the existing `roadGraph`. Rate constant tuned very low (medieval baseline: order 1 soul/settlement/week), scaled up by settlement events (a razed village empties; Fate's `nudge_event_severity` gets a demographic lever for free).
- **Mechanics:** expected-value accumulation with stochastic rounding via `ctx.rng` in sorted (source, dest) order — the births pattern. Each moved soul transfers a mean member's sums from source band to dest band; `cohort_migration` events feed the ledger test. Belief travels with the migrant — a diaspora from a devout town seeds faith where it lands, which is emergent missionary mechanics at zero extra design cost, and rival-held settlements exporting believers is a pressure the rival decider will see in its follower deltas (`rival-claims.ts:115–121`).
- **Named NPCs do not auto-migrate** in this epic (their `homePoiId` semantics touch movement, buildings, and storylets). A named soul who *would* migrate is a future Fate hook, not a v1 behavior.

---

## 7. Performance budget — why the named cap keeps everything bounded

The two-tier split exists precisely so the expensive representations stay O(named), with named bounded by the attention surface rather than by fiction population:

| Cost center | Scaling | Bound after this epic |
|---|---|---|
| `SpiritSystem` power scan, 1 Hz (`spirit-system.ts:16–27`) | O(named × spirits) | Named stays ~current scale (tens per settlement); cohort term is O(settlements × bands × spirits) per **hour**, ~10⁻⁶ of the 1 Hz budget. |
| `BeliefPropagationSystem`, 1 Hz | O(named edges) | Unchanged; cohort communion is aggregate arithmetic. |
| `PerceptionSystem`, 2 Hz, r² disc per believer (`perception-system.ts:54–68`) | O(named × r²) | Unchanged — cohorts don't hold perception reach; a settlement's realized footprint comes from its named residents. (Open question 9.4.) |
| `buildRivalSituation`, per waking rival (`rival-claims.ts:97–114`) | O(named) | + O(settlements × bands) cohort read — cheaper than the NPC pass it joins. |
| NPC movement/pathfinding, activity, mortality/birth scans | O(named) | Unchanged. |
| **Render:** `buildEntityDrawList` re-emits the NPC layer every frame; only the static layer is cached (`entity-draw-list.ts:50–63`) | O(visible named) | This is the hard wall: the profiling epic already measures the entity pass at 7–9 ms with the **overview draw-list assembly as the standing bottleneck** — thousands of individual NPC entities would blow the frame budget outright. Cohort souls emit **zero draw items**. Ambient crowd *impostors* (a settlement-level animated sprite representing "many people," no entities) are explicitly out of scope here and belong to the renderer-perf track. |

The named-tier ceiling is therefore a **scene/attention budget, not a fiction budget**: on the order of the current `POP_CAP_PER_POI`-scale counts per settlement plus materialization headroom, enforced by the fold-back grace policy (§4.1). Fiction population becomes a cohort number and can be 10×–100× named without any hot loop noticing.

---

## 8. Build slices

Each slice ships independently with its own plan under `docs/superpowers/plans/`, is behind no flag (P0 is read-only; later slices are the feature), and leaves the game correct if the epic pauses after it.

**P0 — Shadow bookkeeping (read-only).**
`src/sim/cohorts.ts` (data model, transfer fns) + `CohortSystem` at `GAME_HOUR_HZ`. Cohorts are *initialized by census* from the living named population at world gen / save load and thereafter shadow it: every `npc_birth`/`npc_death` also updates the matching band, so cohort totals ≡ named totals at all times. No gameplay reads. Ships: snapshot round-trip, the conservation ledger test, determinism/replay test (scrub across cohort ticks reproduces byte-identical cohorts), a dev-panel census readout. **Value:** the invariant machinery exists and is proven before any consumer depends on it.

**P1 — The belief economy reads cohorts.**
Seed worlds with cohort population beyond the named residents (fiction pop, e.g. 5–10× per settlement, worldgen-authored per POI type). `SpiritSystem`, believer counts, `buildRivalSituation`, the settlement plea ledger (§5.3), and settlement growth / birth throttle (§5.2 — `POP_CAP_PER_POI` retired) read combined totals. Rival claiming against statistical pleas via the cohort `answer_prayer` variant. **Value:** towns feel populous in every number the player and rivals see; the exploit-proof growth loop is live. (No individuals materialize yet — statistical pleas surface as settlement-level inbox items only.)

**P2 — Materialization + fold-back.**
The §4 protocol: derived-stream determinism, threshold-first sampling, social stitching, fold policy; triggers wired to player focus, the inbox petitioner path, rival-claim surfacing, and Fate/storylet subject requests (closing the `subject:` binding gap for cohort-drawn subjects). **Value:** the thesis lands — attention visibly individuates; Fate can cast characters from the population instead of only from the named roster.

**P3 — Time-skip integration.**
Leslie step in `applySkip` beside `projectTurnover` (§5.4); combined-population growth catch-up; era summary reports cohort demographics; a calibration test comparing a year of live `CohortSystem` ticking against one Leslie step within tolerance. **Value:** century skips over populous worlds at O(bands), not O(souls).

**Testing spine across all slices:** the ledger test (§5.2), replay determinism (materialization sequence stable across scrub/commit), the exploit test (a world where dwellings are force-built with no population must show zero belief/power delta — the houses-mint-believers loop asserted dead), and P1↔P0 equivalence (with fiction pop = named pop, all economy reads match pre-epic values exactly).

---

## 9. Open questions

1. **Fold-back vs. the persistence principle.** "Nothing is ever deleted" (`believers.ts:11–13`) — is folding a materialized NPC back into aggregate a violation in spirit? The §4.1 policy (whispered-to NPCs never fold; remains never fold) protects everything the *player* touched, but an NPC who befriended a named NPC leaves a dangling relationship edge on fold. Options: prune the edge, tombstone it ("someone she once knew"), or make any relationship to a never-folding NPC itself never-folding (risk: fold-immunity percolates until nothing folds). Needs a decision before P2.
2. **Skepticism and personality priors per cohort.** Belief decay needs a skepticism term (`npc-sim.ts:70`) but cohorts carry no personalities. A per-settlement scalar prior is cheapest; per-band sums of skepticism are more faithful but grow the model. P1 can ship the scalar and measure whether cohort belief trajectories diverge from named ones.
3. **Statistical claim pacing vs. Fate's pressure triggers.** `FateBrainService` wakes on sustained rival claim pressure (≥2 claims/sim-day). Cohort-scale claiming could produce claim *volumes* an order of magnitude above named-scale and re-tune Fate's wake cadence by accident. Does the trigger count statistical claims 1:1, weighted, or only surfaced-materialized ones?
4. **Does aggregate belief realize tiles?** `PerceptionSystem` reach comes from named believers only (§7). A devout 500-soul cohort town with two named residents would have a strangely small realized footprint. A settlement-level reach term (from `believerCount`) is easy but changes the meaning of the cradle-opening mechanic — VISION §2.3 review needed.
5. **Cohort needs vs. the event system.** `SettlementEventSystem` and divine actions press on *individual* needs today. The §3.3 model keeps band-mean needs; is that resolution enough for events to feel consequential in aggregate (a drought should starve the poor band before the prosperous one — do bands need a prosperity axis, not just age)?
6. **Materialization scene budget.** How many souls per settlement may be simultaneously materialized by the focus trigger before it stops (and does the budget flex with zoom band)? Interacts with the renderer-perf entity-pass work; number should come from measurement, not this doc.
