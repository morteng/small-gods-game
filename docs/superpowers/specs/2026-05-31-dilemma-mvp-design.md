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
- Single player-spirit. Existing cradle start (a handful of NPCs, small realized area).
- Two divine verbs: **Answer** and **Deepen**.
- The belief math: power formula, comfort decay, abandonment decay, devotion-resistance.
- One divine need (`meaning`); material needs self-satisfied by NPCs.
- Abandonment → believer departs. Soft goal + soft lose. Minimal HUD.

**Out (later slices, do not build):** rival spirits, Fate/DM agent, LLM narration,
the Book, Act 0 cold-open, omen/miracle/whisper-as-primary, multi-need prayers,
generated art. Canned/templated text only.

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

## 6. Loop closure: abandonment, goal, lose

- **Abandonment → departure:** when a believer's player-faith reaches 0, they cease
  believing and **leave** — entity removed from the world, `believer_lost` event
  logged. Fewer believers → less power. The world can depopulate. (A short grace
  period before removal avoids flicker; tune in plan.)
- **Durable believer:** `faith > 0.3 && devotion > 0.4`. The asset the player is
  trying to accumulate.
- **Soft goal:** reach **5 durable believers**.
- **Soft lose:** believer count → 0 ("nothing but names").
- These are *surfaced*, not hard game-over screens — the slice is a sandbox that
  trends toward one of three legible outcomes.

## 7. UI & wiring (minimal)

- **Action menu:** clicking an NPC opens a small menu with **Answer** (enabled only
  while praying) and **Deepen**. Reuses `OverlayDispatcher` — register handlers
  `'answer'` and `'deepen'` exactly as `'whisper'` is registered today. Hit-areas
  via `OverlayHitArea`.
- **Prayer indicator:** a 🙏 marker floats over NPCs in `worship`, drawn in the
  existing NPC overlay pass, so the player can see who needs them.
- **HUD:** power, total believers, durable believers, goal progress (5). Extends
  the existing power HUD; no new framework.
- Renderer, camera, dev inspector, scheduler, snapshot/replay: **untouched**.

## 8. Constants (initial, all tunable)

| Constant | Value | Where |
|---|---|---|
| `POWER_REGEN_RATE` | 0.02 (unchanged) | `spirit-system.ts` |
| power multiplier coeff | 2 (for both u and d) | `spirit-system.ts` |
| `COMFORT_THRESHOLD` | 0.6 | `npc-sim.ts` |
| `COMFORT_DECAY` | 0.004 | `npc-sim.ts` |
| `ABANDON_DECAY` | 0.006 | `npc-sim.ts` |
| `FAITH_DECAY_BASE` | 0.002 (unchanged) | `npc-sim.ts` |
| Answer: faith / meaning | +0.2 / +0.3 | `divine-actions.ts` |
| Deepen: understanding / devotion / faith | +0.12 / +0.12 / +0.05 | `divine-actions.ts` |
| Answer / Deepen cost | 2 / 4 | `divine-actions.ts` |
| self-agency need restore (per activity completion) | +0.3 | `npc-activity-system.ts` |
| durable threshold | faith > 0.3 && devotion > 0.4 | new helper |
| goal | 5 durable believers | HUD |

## 9. Testing

**Unit (deterministic, Vitest):**
- Comfort decay: high needs + devotion=0 → faith falls; devotion=1 → negligible.
- Abandonment decay: worship + unanswered → faith falls; resisted by devotion.
- Power formula: pure-faith vs deepened contribution ratio (= 9× at full deepen).
- `answerPrayer` restores `meaning` and exits worship; `dream`/Deepen leaves needs
  untouched and raises understanding+devotion.
- Self-agency: each activity completion restores its mapped need.
- Abandonment removal: faith→0 believer is removed and `believer_lost` logged.

**Integration — headless dilemma harness (the key proof):** run the seeded sim
~1000 ticks under three scripted policies and assert outcomes:
- *Answer-everything* → believers comfortable, faith collapses (secularization).
- *Ignore-everything* → believers abandon, count → 0.
- *Balanced (answer near-departures + deepen the faithful)* → stable/growing durable
  believers.

If only the balanced policy sustains durable believers, the dilemma is real and the
MVP has proven its thesis.

## 10. Reconciliation note

This slice closes ROADMAP Track 1 items 1 (power formula), 2 (self-agency), and
part of 6 (believer accounting / soft win) and 7 (fading, in the per-NPC
abandonment form). It does **not** touch understanding's sign-perception/prayer-
efficacy roles (Track 1 item 4 detail), rivals, or Fate. VISION remains canonical;
nothing here contradicts it.
