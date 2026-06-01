# D2 — Deterministic Time-Skip (Design Spec)

**Date:** 2026-06-01
**Status:** Approved (brainstorm complete; ready for implementation plan)
**Depends on:** D1 (Mortality, Birth & Lineage) — specifically `projectTurnover` (`src/sim/turnover.ts`), `killNpc`/`birthNpc` (`src/world/npc-lifecycle.ts`), and the lineage/age fields on `NpcProperties`.
**Defers to:** [VISION.md](../../VISION.md) §2.1 (Fate cosmology), [ROADMAP.md](../../ROADMAP.md) Track 4 (Fate / DM agent).

---

## 1. Goal

Let the player jump the world forward by a span of years in one operation: a
**closed-form, deterministic transform** that ages out and turns over the
population, then commits the result as a new baseline. This realizes the first
half of VISION's "jump N years → Fate authors the era → commit & freeze" loop —
the **deterministic skip + commit**. The second half (Fate *authoring* the era
with the LLM) is explicitly deferred to Track 4.

## 2. Scope & non-goals

**In scope (this spec):**
- A `skipYears` operation that applies `projectTurnover`'s projected deaths and
  births to the live world and advances the clock.
- "Commit & freeze" semantics: a skip is a one-way boundary you cannot scrub back
  through.
- A minimal trigger control (year presets) and a one-line summary of what changed.

**Explicitly out of scope (deferred):**
- **Belief decay during a skip.** Survivors keep their belief frozen across the
  skipped span. (Secularization-over-decades belongs with Fate / Track 4.)
- **Power accrual during a skip.** No power regenerates for the skipped years —
  the player wasn't paying attention. Regen resumes naturally from the post-skip
  flock once play continues.
- **LLM era-authoring** (the chronicle / named dramas). Needs Track 4.
- A full era-summary *screen*. One summary line is enough for the baseline.

> **Baseline mandate.** Per standing guidance: establish a working baseline, keep
> it simple, expand later. Constants and feedback are intentionally minimal.

## 3. Why closed-form, not tick-based fast-forward

The existing timeline scrub (`TimelineController.jumpTo` → `forwardSilent`,
`src/core/timeline.ts`) advances time by **re-ticking recorded history** — it can
only replay ticks that already happened. A skip moves into *new* territory with no
recorded ticks, and the approved baseline (frozen belief, no power) is by
definition *not* "run N years of real ticks" (which would decay belief and accrue
power). So the skip is a **closed-form transform** built on `projectTurnover`,
which D1 created for exactly this purpose. It does not tick the scheduler.

## 4. The transform

A new operation (working name `skipYears`) performs, in order:

1. Snapshot the current tick `start = state.clock.now()`.
2. Collect living NPCs (`queryNpcs(world)` — kind `'npc'`, excludes `remains`).
3. Call `projectTurnover(livingNpcs, years, start, state.rng)` →
   `{ deaths, births }`.
4. **Apply deaths:** for each `ProjectedDeath`, look up the entity and call
   `killNpc(world, entity, start + deathYearOffset · TICKS_PER_YEAR, cause, log)`.
   (Converts `npc → remains`; never deletes — the persistence principle.)
5. **Apply births:** for each `SynthChild`, materialize a real NPC via the
   lifecycle layer using the projection's parents, `lineageId`, diluted
   `beliefs`, and `birthTick = start + birthYearOffset · TICKS_PER_YEAR`.
   - The projection synthesizes children by id (`synth-<y>-<n>`) and references
     parent ids that may themselves be projected to have died later in the
     window; materialization uses the projection's recorded `beliefs`/`lineageId`
     directly (it does **not** re-read parents from the world, which may already
     be remains), so a child whose parents died after its birth still appears.
6. Advance the clock by `years · TICKS_PER_YEAR`.
7. Survivors are untouched (frozen belief). No power regen runs — nothing ticked.
8. Emit one `era_skipped` summary event (see §6) and rebaseline the timeline (§5).

**Ordering note.** Because survivor state is frozen and the sim is not ticked
during the span, only the *end state* matters — the relative ordering of
within-window deaths and births does not affect the resulting world. Deaths and
births are applied as two batches.

## 5. Commit & freeze — a one-way boundary

A skipped span has **no recorded ticks**, so `forwardSilent` cannot reproduce it.
Allowing a scrub back across a skip would let `jumpTo` re-tick the region and
diverge from the closed-form result. Therefore a skip is a **commit boundary**:

- After applying the skip, **rebaseline `TimelineController`'s snapshot store** to
  a single fresh snapshot of the post-skip state, discarding pre-skip snapshots.
  The store's floor (`maxTick` / `nearestAtOrBefore`) becomes the post-skip tick,
  so `jumpTo(t < postSkipTick)` cannot land inside the un-replayable region.
- **Pre-skip events remain in `state.eventLog`** as a read-only historical record
  (the time-history strip, and a future Book of [Spirit], still display them).
  You can read the past; you cannot time-travel into it once a skip commits.

This matches VISION's "commit & freeze" exactly: scrub/re-roll is "defying Fate"
*before* you commit; a committed skip is settled history.

The `TimelineController` gains a method to perform this rebaseline (working name
`commitSkip()` / `rebaseline()`), called by the skip operation after the
transform. It must be a no-op-safe call that leaves the controller in a clean,
non-scrubbed live state anchored at the new tick.

## 6. Trigger & feedback (minimal)

- **Trigger:** a small "Jump forward" control offering presets **10 / 25 / 50
  years**, placed near the existing summoned Time bar. No free-text entry for the
  baseline.
- **Feedback:** on completion, append
  - one `era_skipped` event to `state.eventLog` carrying
    `{ fromTick, toTick, years, deaths: number, births: number,
       believersBefore: number, believersAfter: number }`, and
  - one summary line to the time-history strip, e.g.
    *"Year 3 → Year 53: 24 died, 31 born. Flock: 18 believers (was 22)."*
- "Believers" = count of NPCs with any `faith > 0` for the player spirit
  (reuse whatever the HUD already uses; do not invent a new metric).

## 7. Determinism & replay

- All randomness flows through `state.rng` (already true inside
  `projectTurnover`), so a skip is fully deterministic for a given seed.
- The skip consumes the live rng stream once, as a single closed-form draw
  sequence — no `Math.random`, consistent with the `src/sim/` guard test.
- Rebaselining the snapshot store (§5) keeps the timeline honest: there is no
  scrub path that would attempt (and fail) to reproduce the skip by re-ticking.

## 8. Edge cases

- **Extinction.** If every living NPC dies and no births occur, the skip
  completes cleanly: the world holds remains (and zero living NPCs). The summary
  reports it. No special-casing or cradle floor for the baseline.
- **Tiny population / cradle.** `projectTurnover` already mirrors `BirthSystem`
  (homeless souls don't breed; per-POI soft cap). The skip inherits that
  behavior; no extra guard.
- **Zero-year / negative input.** `skipYears(0)` (or `years <= 0`) is a no-op:
  no transform, no rebaseline, no event.

## 9. Files (anticipated)

- **Create:** `src/sim/time-skip.ts` — the `skipYears` operation (orchestrates
  `projectTurnover` + `killNpc`/`birthNpc` + clock advance + summary).
- **Modify:** `src/core/timeline.ts` — add the rebaseline/commit-skip method.
- **Modify:** `src/core/events.ts` — add the `era_skipped` event type.
- **Modify:** `src/world/npc-lifecycle.ts` (or a small helper) — a way to
  materialize a `SynthChild` into a real NPC entity from projection data
  (parents' ids may be remains by then, so build from the projection's recorded
  `beliefs`/`lineageId`/`birthTick`, not by re-reading parents).
- **Modify:** UI — a "Jump forward" control near the Time bar
  (`src/ui/panels/time-bar.ts` or a sibling) + history-strip summary line.
- **Modify:** `src/game.ts` — wire the control to the skip operation +
  `TimelineController`.
- **Tests:** `tests/unit/time-skip.test.ts` (transform correctness, clock
  advance, determinism, extinction, zero-year no-op) and a timeline test that
  `jumpTo` cannot cross a committed skip.

## 10. Acceptance criteria

1. `skipYears(state, N, rng)` advances the clock by exactly `N · TICKS_PER_YEAR`.
2. The set of new `remains` equals `projectTurnover`'s `deaths`; the set of new
   living NPCs equals its `births`, with matching lineage and diluted beliefs.
3. Surviving NPCs' belief is byte-for-byte unchanged across the skip.
4. Same seed + same starting world + same `N` → identical post-skip world.
5. After a committed skip, `jumpTo(t)` for any `t` before the skip tick does not
   restore pre-skip state (the boundary holds); pre-skip events still readable.
6. One `era_skipped` event and one history-strip line are produced per skip.
7. Extinction and `years <= 0` behave as in §8.
8. No `Math.random` anywhere in the new sim code (guard test still passes).
