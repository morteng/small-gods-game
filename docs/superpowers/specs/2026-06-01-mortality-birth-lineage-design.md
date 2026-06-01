# Mortality, Birth & Lineage (D1) — Design Spec

**Date:** 2026-06-01
**Track:** Prerequisite for the **Fate time-skip (D2)**; realizes the ROADMAP Track 7
"persistence principle + death & remains" backlog item and gives understanding's
deferred "pass on accurate belief" job (Track 1) a home.
**Status:** Approved design; ready for implementation plan.

---

## 0. Why this exists

We are building toward the **Fate time-skip** (D2): "jump N years forward → Fate
authors the era → commit & freeze." A century jump cannot be simulated tick-by-tick
(a year is 23,040 ticks; 100 years ≈ 2.3M ticks — `forwardSilent` would freeze the
tab), so D2 must *author* the result from a cheap, deterministic **sim skeleton**.

That skeleton needs to know **who is alive after a century** — which requires a
mortality/birth/lineage model that does not exist today: NPCs are currently immortal
(only faith can *lapse*; the soul persists). **D1 builds that model**, both as
real-time systems (death and birth happen in normal play too) and as a closed-form
turnover function D2 will call.

**Decision recap (from brainstorming):**
- Long jumps are *authored*, not simulated; the sim keeps numeric authority
  ("sim skeleton + Fate story").
- The cast undergoes **full generational turnover** — death and lineage matter to
  stories.
- Children inherit **diluted faith, near-zero understanding** — "born believing in
  *something*, but must relearn who you are." This is the generational engine of
  religion and the realization of VISION's "low understanding = belief in
  'something,' misattributed."

---

## 1. Persistence principle (the invariant this spec must honor)

> Once an NPC is instantiated it never leaves the world — **no sim-driven
> hard-deletes.** Losing faith is a **lapse** (already shipped; the soul lives on as a
> re-convertible non-believer). **Death is a separate, rarer event** that converts the
> actor into a persistent **remains** entity, discoverable for ~100+ in-game years,
> slowly weathering but never fully disappearing.

Death therefore **converts**, never deletes: the entity's `kind` flips `'npc' →
'remains'`, keeping its `id`, `name`, and lineage intact.

---

## 2. Data model (`src/core/types.ts`)

### 2.1 NPC additions

`NpcProperties` gains three fields:

| Field | Type | Meaning |
|---|---|---|
| `birthTick` | `number` | Sim tick at which this soul was born. Age is **derived**, never stored. |
| `parentIds` | `NpcId[]` | 0 (founder), 1, or 2 parent entity ids. |
| `lineageId` | `NpcId` | Root-ancestor id for "house of X" grouping. Founders: their own id. |

- **Age is derived**: `ageInYears(birthTick, now)` — never a stored, per-tick-mutated
  counter. This keeps it snapshot/replay-clean (no extra mutable state).
- Existing world-gen NPCs are **back-dated**: assigned a `birthTick` such that they
  start as a spread of adults (see §7 cradle safety). `lineageId = self`,
  `parentIds = []`.

### 2.2 Remains entity

Add `'remains'` to the entity `kind` union. A remains is a converted NPC: it keeps
the NPC's `properties` and adds:

| Field | Type | Meaning |
|---|---|---|
| `deathTick` | `number` | Sim tick of death. Weathering is **derived** (`now − deathTick`). |
| `deathCause` | `string` | `'old_age'` for D1 (plague/famine later). |

Weathering stage is a pure function of `now − deathTick` (e.g. fresh grave → old
grave → faint marker). No stored mutable weathering counter.

---

## 3. Mortality math (`src/sim/mortality.ts` — pure, unit-tested)

A single pure module, the deterministic core shared by the real-time system **and**
the closed-form turnover used by D2:

```
ageInYears(birthTick, now): number
  = (now - birthTick) / (TICKS_PER_DAY * DAYS_PER_YEAR)

annualMortality(age): number          // probability of dying within one year at this age
  // Gentle pre-modern curve, clamped [0,1]:
  //   ~0.005 (0.5%/yr) through adulthood
  //   rising past ~55
  //   ~0.5 by ~85, → 1.0 by ~95
  // Exact curve is tunable constants; must be monotonic non-decreasing for age ≥ adulthood.

survivalProbability(age, years): number
  = ∏_{y=0}^{years-1} (1 - annualMortality(age + y))     // closed-form, no loop over ticks

rollDeathYear(age, years, rngFloat∈[0,1)): number | null
  // Deterministic: walks cumulative hazard; returns the year-offset of death within
  // [0, years) or null if the soul survives the whole interval. rngFloat is supplied
  // by the caller (state.rng) so the result is seed-reproducible.
```

All thresholds (`ADULT_AGE`, curve params) are exported tunable constants.

---

## 4. Lifecycle helpers (`src/world/npc-lifecycle.ts`)

### 4.1 Death

```
killNpc(world, entity, deathTick, cause, log):
  - set properties.deathTick = deathTick, properties.deathCause = cause
  - flip kind 'npc' → 'remains' via world.updateEntity()   // CLAUDE.md gotcha: syncs BOTH index layers
  - log.append({ type: 'npc_death', npcId, lineageId, cause })
```

Because `SpiritSystem` (and all NPC systems) iterate via `forEachNpc` (kind `'npc'`
only), a remains **automatically** stops contributing belief/power and stops moving,
praying, etc. — no other system needs to change. The soul stays queryable as
`kind: 'remains'`.

### 4.2 Birth

```
birthNpc(world, parents[1..2], birthTick, rng, log): Entity
  - new NPC entity at a parent's home (homePoiId / homeX/Y inherited)
  - parentIds = parents.map(id); lineageId = parents[0].lineageId
  - personality = mean(parents.personality) + small seeded jitter, clamped [0,1]
  - beliefs: for the player spirit (and any spirit both/at-least-one parent believes in):
        faith         = INHERIT_FAITH_FRAC      × avg(parent faith for that spirit)   // ≈ 0.4×
        understanding = INHERIT_UNDERSTANDING_FRAC × avg(parent understanding)        // ≈ 0.05× (~0)
        devotion      = 0
  - log.append({ type: 'npc_birth', npcId, parentIds, lineageId })
```

Diluted faith + near-zero understanding is the **generational decay** that forces you
to keep tending a religion: each generation is born half-believing and must
*relearn who you are* (understanding), or drift into misattributed "belief in
something."

---

## 5. Real-time systems (deterministic, seeded)

Both implement `System` (`name`, `tickHz`, `tick(ctx)`) and are registered in the
`Game` constructor alongside the others. **Both roll exclusively through `ctx.rng`
(`state.rng`), never `Math.random`** — this is stricter than `NpcMovementSystem`
(which is non-deterministic) and is required so the systems replay identically under
silent replay.

### 5.1 `MortalitySystem` (`src/sim/systems/mortality-system.ts`)
- Low frequency (≈ once per in-game day). Converts `annualMortality(age)` to the
  probability for the elapsed period and rolls each living NPC via `ctx.rng`.
- On death → `killNpc(..., cause: 'old_age', ...)`.
- **Cradle guard:** mortality is disabled while the living-NPC population is below
  `CRADLE_MORTALITY_FLOOR` (≈ 4), so the cradle opening cannot die out before it
  grows.

### 5.2 `BirthSystem` (`src/sim/systems/birth-system.ts`)
- Low frequency. Per settlement (POI), finds co-located **fertile adults**
  (`FERTILE_MIN_AGE`..`FERTILE_MAX_AGE`, ≈ 18..45), pairs them, and spawns a child at
  `BIRTH_RATE_PER_PAIR` per period, up to a soft `POP_CAP_PER_POI`.
- Pairing (vs. an abstract settlement birth rate) is chosen so **every child has real
  parents** and lineage is always grounded.

---

## 6. Closed-form turnover (`src/sim/turnover.ts` — the D2 bridge, pure, tested)

```
projectTurnover(npcs, years, rng): { deaths: {id, deathYearOffset, cause}[],
                                      births: SynthChild[] }
```

- Fully deterministic (seeded), **no tick loop** — this is what makes a century jump
  feasible.
- **Deaths:** for each living NPC, `rollDeathYear(age, years, rng.next())`; non-null →
  a death at that year-offset.
- **Births:** estimate births from fertile-adult-pair-years across the interval
  (respecting deaths as they occur) × birth rate; synthesize `SynthChild`s with
  `parentIds`/`lineageId` chosen from souls alive at the child's birth-year, and
  diluted belief per §4.2.
- D1 **builds and unit-tests** `projectTurnover`; **D2 wires it** into the skip flow.
  (D1 ships it unused by UI — that is intentional, the bridge is the deliverable.)

---

## 7. Cradle / opening safety

- Founder NPC(s) spawn as **young adults** (age ≈ 20–30): `birthTick` back-dated so
  `ageInYears` lands in range; never elderly at start.
- `MortalitySystem` is inert below `CRADLE_MORTALITY_FLOOR` population.
- `BirthSystem` needs ≥1 fertile pair, so growth begins only once the bubble has
  adults — consistent with the cradle ramp.

---

## 8. Lineage queries, events, renderer

- **`npc-helpers.ts`:** `getParents(world, npc)`, `getChildren(world, npc)`,
  `lineageMembers(world, lineageId)` (living NPCs + remains sharing a root ancestor).
- **Events:** `npc_death { npcId, lineageId, cause }` and
  `npc_birth { npcId, parentIds, lineageId }` added to the event-type union; they
  surface in the time-history strip like other narrative events.
- **Renderer:** a cheap grave-marker placeholder for `kind: 'remains'` (gray marker).
  Rich weathering visuals and discovery mechanics are deferred.

---

## 9. Determinism & replay (the load-bearing guarantee)

- All randomness flows through `ctx.rng` (`state.rng`, seeded sfc32) → mortality and
  birth replay **identically** under `forwardSilent`, exactly like the existing
  deterministic systems.
- Age and weathering are **derived** from `birthTick`/`deathTick` + `now`, so no extra
  mutable state can drift across snapshot/restore.
- Remains are ordinary entities → captured by `captureSnapshot` (entities array) and
  reinstated by `restoreSnapshot`.
- **Constraint:** unlike `NpcMovementSystem` (which uses `Math.random` and is
  explicitly non-deterministic), `MortalitySystem`/`BirthSystem` **must not** use
  `Math.random`. A determinism guard test enforces this (§10).

---

## 10. Testing (Vitest, `tests/unit/`)

1. **`mortality.ts`** — `ageInYears`; `annualMortality` bounded [0,1] and monotonic
   non-decreasing for age ≥ adulthood; `survivalProbability` ∈ [0,1] and decreasing in
   `years`; `rollDeathYear` boundaries (survives at low hazard, dies at high, returned
   offset ∈ [0, years)).
2. **`npc-lifecycle.ts`** — `killNpc` flips kind via `updateEntity` (NPC no longer
   returned by `forEachNpc`/npc queries; still present as `'remains'`), preserves
   `id`/`lineageId`, appends `npc_death`; `birthNpc` sets `parentIds`/`lineageId`,
   diluted belief (faith ≈ 0.4×avg, understanding ≈ 0), appends `npc_birth`.
3. **`MortalitySystem`** — same seed → identical death set; cradle floor protects a
   small population; an elderly NPC eventually dies; belief power drops after a
   believer's death (no longer summed by `SpiritSystem`).
4. **`BirthSystem`** — same seed → identical births; respects `POP_CAP_PER_POI`;
   children carry lineage + diluted faith; no births without a fertile pair.
5. **`turnover.ts`** — `projectTurnover` deterministic for a seed; deaths+survivors
   account for the full input; synthesized children have valid parents alive at their
   birth-year; lineage continuity holds.
6. **Determinism guard** — run the sim N ticks twice from the same seed; the
   death/birth event sets are identical.

The full suite (~832 tests) must stay green.

---

## 11. Out of scope (D1)

- The **time-skip flow & UI** and **Fate/LLM authoring** — that's **D2**.
- **Plague/famine** death causes — D1 is old-age (the curve) only.
- **Marriage/relationship depth** for pairing — MVP uses simple co-located fertile
  adults.
- **Remains discovery mechanics** and **rich weathering visuals** — placeholder only.

---

## 12. Future extensions (explicitly noted, not built now)

- **Genetics & richer lineage simulation** — heritable traits beyond the current
  personality-mean+jitter blend; deeper family trees, kinship, and inheritance of
  more than belief (per Daisy's note, this is wanted later, not now).
- Death causes beyond old age; remains as discoverable archaeology; the Book of
  [Spirit Name] consuming `npc_death`/`npc_birth`/lineage as chapter material.

---

## 13. File-touch summary

- **Modify:** `src/core/types.ts` (NPC fields, `'remains'` kind + props),
  `src/core/events.ts` (add `npc_death`/`npc_birth` to the `GameEvent` discriminated
  union, alongside the existing `npc_spawn`/`whisper`/… variants),
  `src/world/npc-helpers.ts` (`initNpcProps` defaults + lineage queries), `src/game.ts`
  (register the two systems; back-date world-gen `birthTick`s), the renderer (remains
  marker).
- **Create:** `src/sim/mortality.ts`, `src/world/npc-lifecycle.ts`,
  `src/sim/systems/mortality-system.ts`, `src/sim/systems/birth-system.ts`,
  `src/sim/turnover.ts`.
- **Tests:** `tests/unit/mortality.test.ts`, `npc-lifecycle.test.ts`,
  `mortality-system.test.ts`, `birth-system.test.ts`, `turnover.test.ts`, plus a
  determinism-guard test.
</content>
</invoke>
