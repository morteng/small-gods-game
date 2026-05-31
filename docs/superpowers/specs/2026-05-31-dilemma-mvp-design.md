# Dilemma MVP — Design

**Date**: 2026-05-31
**Status**: Approved — ready for implementation plan
**Anchored on**: [VISION.md](../../VISION.md) §3 (belief model), §4 (master loop), [ROADMAP.md](../../ROADMAP.md) Track 1

> The first playable proof. Goal: demonstrate the core loop **works** and is
> **interesting** — nothing more. This is ROADMAP Track 1 ("close the belief-model
> loops") shaped into a single-god, no-rival, no-Fate, no-LLM vertical slice.

---

## 1. The thesis being proven

VISION's central tension is the **secularization dilemma**: a god is fed by need,
but answering needs removes the need, which starves the god. The MVP proves this
is a genuine, *fun* decision rather than a thermostat by giving the player a second
lever (Deepen) that converts fickle fear-faith into decay-resistant devotion.

**Win shape of the proof:** with the math wired, the only stable strategy is to
keep believers in a *needing-but-believing* band while investing in durable
devotion. Answer-everything collapses (comfort). Ignore-everything collapses
(abandonment). Balanced play survives. If a headless sim shows exactly that, the
dilemma works.

## 2. Scope

**In:**
- Single player-spirit, with a **starting power stipend** (~10) so the player has
  agency from tick 0. (Slice-1 scaffold — Slice 2, §12, replaces it with the
  powerless drift + free first-contact bootstrap.)
- A **seeded band of ~6 NPCs** in the realized area (see §2.1) — the dilemma needs
  several simultaneous claims on limited power. The intimate one-NPC cradle is an
  Act-0 tutorial concern and is out of scope.
- Two divine verbs: **Answer** and **Deepen**.
- The belief math: power formula, comfort decay, abandonment decay, devotion-resistance.
- One divine need (`meaning`); material needs self-satisfied by NPCs.
- Abandonment → believer departs. Soft goal + soft lose. Minimal HUD.

**Out (later slices, do not build):** rival spirits, Fate/DM agent, LLM narration,
the Book, Act 0 cold-open, omen/miracle/whisper-as-primary, multi-need prayers,
generated art. Canned/templated text only.

### 2.1 Starting population

`seedWorld()` today spawns exactly one NPC (faith 0.2) and the abandonment rule
only ever *removes* NPCs — so a one-NPC start has no triage dilemma and the goal is
unreachable. For this slice, seed a band of **~6 NPCs** in the cradle POI (varied
roles → varied `skepticism`/`piety`, so they decay and convert at different rates),
each starting as a near-non-believer (`faith ≈ 0.1–0.2`, `understanding = devotion
= 0`). No newcomer trickle in this slice — population is fixed at the start and can
only shrink, which is itself part of the stakes.

## 3. The belief math (canonical for this slice)

Each NPC tracks per-spirit `SpiritBelief { faith, understanding, devotion }` (all
0–1, unchanged) and `NpcNeeds { safety, prosperity, community, meaning }` where
**higher = more satisfied** (existing convention; needs decay downward).

### 3.1 Faith dynamics (per `NpcSimSystem` tick, 1 Hz)

Faith is pushed by three forces, all **resisted by devotion** (resistance factor
`(1 − devotion)`):

1. **Desperation boost** — *already implemented* in `npc-sim.ts`: when `avgNeeds <
   0.4`, faith rises ∝ desperation × piety. Keep as-is. (Fear breeds belief; also
   acts as a floor preventing instant abandonment.)
2. **Comfort decay** — *new*: when `avgNeeds > COMFORT_THRESHOLD (0.6)`,
   `faith -= COMFORT_DECAY (0.004) × (avgNeeds − 0.6) / 0.4 × (1 − devotion)`.
3. **Abandonment decay** — *new*: while the NPC is in `worship` (an unanswered
   standing plea), `faith -= ABANDON_DECAY (0.006) × (1 − devotion)`.

The existing baseline `FAITH_DECAY_BASE (0.002) × skepticism` decay stays.

> Note the productive tension: a desperate praying NPC gets *both* the desperation
> boost (low needs) and the abandonment decay (in worship). Net effect is a slow
> bleed that the player can arrest by Answering — exactly the pressure we want.

### 3.2 Power formula

Replace `power += Σ faith × 0.02` in `SpiritSystem` with:

```
contribution(believer) = faith × (1 + 2·understanding) × (1 + 2·devotion)
spirit.power          += Σ contribution × POWER_REGEN_RATE (0.02 unchanged)
```

- Faith is the **floor** (u=d=0 → `faith × 1`), so bootstrapping from a single
  fearful believer still works.
- Understanding×devotion is the **multiplier** (fully deepened → `faith × 9`).
- Consequence: **quantity ≠ power**. ~15 devoted believers outweigh ~100 fearful
  ones. This is VISION §3 made true in the math.

## 4. The two verbs

Both already exist in `src/sim/divine-actions.ts`; this slice **retunes** their
constants to sharpen the dilemma and **wires** them to clicks.

| Verb | Function | Effect | Cost | Enabled when |
|---|---|---|---|---|
| **Answer** | `answerPrayer()` | `faith += 0.2`; restore `meaning` enough to exit worship (`+0.3`); `devotion += 0` (Deepen owns devotion) | 2 | NPC `activity === 'worship'` |
| **Deepen** | `dream()` | `understanding += 0.12`; `devotion += 0.12`; `faith += 0.05`; **no** need restore | 4 | always (NPC must be a believer: faith > 0) |

Retuning intent: Answer is **faith-and-need heavy** (keeps them alive/believing,
but raises meaning → feeds comfort decay). Deepen is **durability heavy** (grows
the power multiplier and decay-resistance, ignores the immediate need). The player
juggles triage (Answer the about-to-leave) against investment (Deepen to escape
the treadmill).

`answerPrayer` currently boosts the *lowest* need; retune it to restore **meaning**
specifically (the divine need, §5) so it reliably clears the worship state.

**Answer is also the recruitment funnel.** A desperate NPC enters `worship` because
its `meaning` is low — *regardless of whether it believes in you yet*. When you
Answer, `answerPrayer()` creates the belief entry if absent, converting a
non-believer into a believer. This is how the flock grows (population is fixed, but
*belief* spreads); without it the only believers are the handful seeded with
`faith > 0`.

**Answer must reset the activity, not just raise `meaning`.** `NpcActivitySystem`
re-evaluates only when `activityDuration` hits 0, so bumping `meaning` alone leaves
the NPC visibly stuck in `worship` (the 🙏 lingers, feedback feels broken).
`answerPrayer()` must flip `activity` out of `worship` (and zero `activityDuration`)
on success.

## 5. The one-need simplification

`meaning` is the **divine need** — the only need a god can satisfy, and the one
NPCs cannot self-satisfy. The other three needs are **self-agency** (ROADMAP
Track 1, item 2):

- On activity completion, restore the matching need: `work → prosperity`,
  `socialize → community`, `sleep → safety`.
- `worship` restores `meaning` **only if a god Answers** — unanswered worship
  yields nothing and bleeds faith (§3.1.3).

Effect: the material economy keeps the world alive in the background; the entire
player-facing dilemma collapses onto one legible axis (`meaning` ↔ `faith`).
Multi-need prayers are a later slice.

The existing `NpcActivitySystem` already sets `activity = 'worship'` when
`meaning < MEANING_THRESHOLD (0.3)`, so the prayer trigger needs **no new code** —
it falls out of the self-agency change plus natural meaning decay.

**But `meaning` must decay fast enough for prayers to recur at a playable cadence.**
Today `meaning` decays at `0.0005/tick` → ~1400 ticks from full to the worship
threshold, so prayers would almost never fire. Raise the `meaning` decay
(`MEANING_DECAY ≈ 0.004/tick`, ~175 ticks full→prayer) so the loop actually spins.
The other three needs keep their slow decay — they're background, kept topped up by
self-agency.

## 6. Loop closure: abandonment, goal, lose

- **Abandonment → departure:** when a believer's player-faith reaches 0, they cease
  believing and **leave** — entity removed from the world, `believer_lost` event
  logged. Fewer believers → less power. The world can depopulate. (A short grace
  period before removal avoids flicker; tune in plan.)
- **Durable believer:** `faith > 0.3 && devotion > 0.4`. The asset the player is
  trying to accumulate.
- **Soft goal:** convert **most of the starting band into durable believers** —
  e.g. 4 of ~6 durable at once. Pinned to the seeded population (§2.1), not an
  absolute count, since population can only shrink.
- **Soft lose:** believer count → 0 ("nothing but names").
- These are *surfaced*, not hard game-over screens — the slice is a sandbox that
  trends toward one of three legible outcomes.

## 7. UI & wiring (minimal)

- **Action menu:** clicking an NPC opens a small menu with **Answer** (enabled only
  while praying) and **Deepen**. Reuses `OverlayDispatcher` — register handlers
  `'answer'` and `'deepen'` exactly as `'whisper'` is registered today. Hit-areas
  via `OverlayHitArea`.
- **Decision legibility (required — the dilemma must be *visible*).** The action
  menu / NPC panel shows that NPC's **faith / understanding / devotion / meaning**,
  plus a one-line **status hint** derived from their state:
  - `faith < 0.15` → *"about to abandon you"*
  - in `worship` → *"praying — needs you now"*
  - `meaning > 0.6 && devotion < 0.4` → *"comfortable — drifting away"*
  - `faith > 0.3 && devotion < 0.4` → *"ripe to deepen"*
  - `faith > 0.3 && devotion > 0.4` → *"devoted"*

  Without this the dilemma is invisible and the game is unplayable as a *decision*.
- **Prayer indicator:** a 🙏 marker floats over NPCs in `worship`, drawn in the
  existing NPC overlay pass, so the player can see who needs them at a glance.
- **Per-act feedback (required):** each Answer/Deepen appends a canned, templated
  one-line event to the event log (e.g. *"You answered Tola's prayer."* / *"You sent
  Tola a dream of the deep water."*) and the HUD updates immediately so acts visibly
  land.
- **HUD:** power, total believers, durable believers, goal progress. Extends the
  existing power HUD; no new framework.
- **Time controls reused:** the dilemma is observed at sim rate via the existing
  T/Space/1/2/4/8 transport; the player pauses to deliberate. Time-scrub *cost*
  ("defying Fate") is out of scope for this slice.
- Renderer, camera, dev inspector, scheduler, snapshot/replay: **untouched**.

## 8. Constants (initial, all tunable)

| Constant | Value | Where |
|---|---|---|
| starting power stipend | ~10 | spirit init / game setup |
| starting band size | ~6 NPCs | `seed-world.ts` |
| starting belief per NPC | faith 0.1–0.2, u = d = 0 | `seed-world.ts` |
| `POWER_REGEN_RATE` | 0.02 (unchanged) | `spirit-system.ts` |
| power multiplier coeff | 2 (for both u and d) | `spirit-system.ts` |
| `COMFORT_THRESHOLD` | 0.6 | `npc-sim.ts` |
| `COMFORT_DECAY` | 0.004 | `npc-sim.ts` |
| `ABANDON_DECAY` | 0.006 | `npc-sim.ts` |
| `FAITH_DECAY_BASE` | 0.002 (unchanged) | `npc-sim.ts` |
| `MEANING_DECAY` | 0.004 (was 0.0005) | `npc-sim.ts` |
| Answer: faith / meaning | +0.2 / +0.3 | `divine-actions.ts` |
| Deepen: understanding / devotion / faith | +0.12 / +0.12 / +0.05 | `divine-actions.ts` |
| Answer / Deepen cost | 2 / 4 | `divine-actions.ts` |
| self-agency need restore (per activity completion) | +0.3 | `npc-activity-system.ts` |
| durable threshold | faith > 0.3 && devotion > 0.4 | new helper |
| goal | 4 of ~6 durable at once | HUD |

These are first-pass values. **The headless harness (§9) doubles as the tuning
instrument** — expect a balance pass to make the three policies separate cleanly.
Tune decay/cost/boost ratios there, not by guessing.

## 9. Testing

**Unit (deterministic, Vitest):**
- Comfort decay: high needs + devotion=0 → faith falls; devotion=1 → negligible.
- Abandonment decay: worship + unanswered → faith falls; resisted by devotion.
- Power formula: pure-faith vs deepened contribution ratio (= 9× at full deepen).
- `answerPrayer` restores `meaning`, flips `activity` out of `worship`, and resets
  `activityDuration`; `dream`/Deepen leaves needs untouched and raises
  understanding+devotion.
- Recruitment: `answerPrayer` on a non-believer (no belief entry, but in `worship`)
  creates the entry and yields faith > 0.
- Self-agency: each activity completion restores its mapped need.
- Abandonment removal: faith→0 believer is removed, `believer_lost` logged, and no
  dangling relationship/social-graph references remain.

**Integration — headless dilemma harness (the key proof):** run the seeded sim
~1000 ticks under three scripted policies and assert outcomes:
- *Answer-everything* → believers comfortable, faith collapses (secularization).
- *Ignore-everything* → believers abandon, count → 0.
- *Balanced (answer near-departures + deepen the faithful)* → stable/growing durable
  believers.

If only the balanced policy sustains durable believers, the dilemma is real and the
MVP has proven its thesis.

> **Determinism caveat.** `NpcMovementSystem` uses `Math.random` and is
> non-deterministic. The harness must drive the proof off the **sim / activity /
> belief / spirit systems only** and assert on belief/need/power state — never on
> NPC positions — so the run is reproducible.

## 10. Decisions & caveats

- **Belief propagation stays on.** `BeliefPropagationSystem` already ticks (devotion
  spreads belief along the social graph). Leave it running — it's on-theme and makes
  Deepen doubly valuable (durable believers also evangelize). Not central to the
  proof, but no reason to freeze it.
- **Removal hygiene.** When an abandoned NPC leaves (§6), remove it via the proper
  `World` removal path and scrub dangling references — other NPCs' `relationships`
  and any social-graph edges pointing at it — so nothing references a dead entity.
- **Newcomers are out of scope.** Population is fixed at the seeded band and only
  shrinks. A newcomer trickle (refugees/strangers) is a later slice.
- **Canned text only.** All narration (status hints, per-act lines, `believer_lost`)
  is templated string constants. No LLM in this slice.

## 11. Reconciliation note

This slice closes ROADMAP Track 1 items 1 (power formula), 2 (self-agency), and
part of 6 (believer accounting / soft win) and 7 (fading, in the per-NPC
abandonment form). It does **not** touch understanding's sign-perception/prayer-
efficacy roles (Track 1 item 4 detail), rivals, or Fate. VISION remains canonical;
nothing here contradicts it.

## 12. Next slice — The Drifting Spirit (deferred, not built here)

Captured so it isn't lost. Slice 1 proves the belief *loop*; Slice 2 proves the
*opening*, layering the front-end of the Act-0 experience onto the same systems:

- **Powerless, roving start.** The spirit begins with **0 power**. Its only free
  verbs are *drift* (move a point of attention through the dark) and *illuminate*
  (passive realization of nearby tiles — the sphere of attention from VISION §2.3
  becomes mobile and embodied, instead of Slice 1's fixed cradle bubble).
- **Drawn to minds.** The spirit is naturally pulled toward creatures, preferring
  higher *potential belief* (maps to the existing `ROLE_FAITH` ceilings). MVP form:
  a soft visual cue / shimmer on high-potential creatures in range; an optional
  gentle drift-pull is a later nicety, not core.
- **Free first contact = the bootstrap.** Reaching a creature with an unmet need
  lets the spirit make a free first touch/whisper that plants seed faith (~0.1).
  This **replaces the Slice-1 power stipend**: once the first believer exists, power
  regen begins and the paid Answer/Deepen economy comes online.
- **Fate as authored content, not the agent.** Seed **1–3 hand-scripted scenarios**
  (a lost sheep, a frightened child, a death) for the player to stumble onto and
  exploit. The live DM agent stays **out** (ROADMAP Track 4) — this is static
  scenario authoring only.
- **Added scope vs Slice 1:** spirit-as-avatar movement, dynamic spirit-centred
  realization (touches `PerceptionSystem` + renderer), and scenario authoring. Gets
  its own brainstorm → spec → plan when picked up.
