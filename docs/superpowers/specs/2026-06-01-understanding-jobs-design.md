# Make `understanding` Matter — Design Spec

**Date:** 2026-06-01
**Track:** ROADMAP Track 1 (close the belief-model loops) — final self-contained slice.
**Status:** Approved design; ready for implementation plan.

---

## 0. Context & scope

Track 1 is ~80% shipped by the Dilemma MVP. An audit (file:line citations below)
found 4 of 6 listed items complete:

| Item | State |
|---|---|
| Power formula `faith·(1+2u)·(1+2d)` | ✅ `src/sim/spirit-system.ts:5-31` |
| Self-agency (activity→need restore, worship excluded) | ✅ `src/sim/systems/npc-activity-system.ts:74-82` |
| Secularization / comfort + abandonment + desperation | ✅ `src/sim/npc-sim.ts:65-75` |
| Devotion's jobs | ⚠️ multiplier ✅, propagation ✅, costly-acts gating ❌ |
| **Understanding's jobs** | ⚠️ **power multiplier only** — perception reads faith only, prayer efficacy ❌ |
| Consume belief events | ❌ emitted, UI-only (needs Fate/Book — later tracks) |

The remaining pieces split cleanly by dependency:
- *Events → Fate's attention* needs **Fate (Track 4)**; *events → the Book* needs **Track 6**.
- *Story fidelity / misattribution* (understanding's 3rd VISION job) needs the **LLM (Track 2)** and **rivals (Track 3)**.
- *Costly-acts gating via devotion* needs the costly acts (sacrifice/shrine/monument) to **exist first** — Track 7 backlog.

**This spec covers only the genuinely self-contained, buildable-now remainder: make
`understanding` matter.** `understanding` is the weakest dimension — written
everywhere (whisper/dream/miracle all grant it), read only by the power formula.

### Canonical authority

VISION §3 (line 118): understanding *"Gates whether they perceive your signs, pray
effectively, and pass on accurate belief. Low understanding = belief in 'something,'
misattributed."* VISION §6 tenet 5 (line 264): *"You are heard only in the form they
recognize → understanding gates…"*

This spec implements **two of the three** canonical understanding jobs —
sign-perception and prayer efficacy. The third (pass-on-accurate / misattribution)
is explicitly deferred to Tracks 2–3.

---

## 1. The shared primitive — comprehension multiplier

A single pure helper, used everywhere a divine signal lands on an NPC:

```
signResponse(understanding) = SIGN_RESPONSE_FLOOR + (1 - SIGN_RESPONSE_FLOOR) * understanding
SIGN_RESPONSE_FLOOR = 0.5
```

- understanding = 0 → **0.5×** effect (floor, never zero)
- understanding = 1 → **1.0×** effect

**The floor is load-bearing.** It preserves bootstrapping: a brand-new believer
(understanding ≈ 0) still responds to your first signs at half strength, while a
believer who grasps who you are responds at full strength. *"You are heard only in
the form they recognize"* — but the door is never fully shut.

Lives alongside the other belief math (same module as `clamp01`, i.e. exported from
`src/sim/npc-sim.ts`, or a small `src/sim/belief-math.ts` if cleaner — implementer's
call, keep it pure and unit-tested). Input is clamped to [0,1] defensively.

---

## 2. The four touch-points

### 2.1 Perception reach — `src/world/perception-system.ts`

Current (`:29-34`): radius depends on faith alone:
```ts
const r = BASE_RADIUS + Math.floor(bestFaith * MAX_FAITH_BONUS);   // 3 + faith·4
```

New: understanding extends the radius **additively**, using the **dominant belief**
(the per-spirit belief with the highest faith — pair faith with *its own* spirit's
understanding, don't mix spirits):
```ts
r = BASE_RADIUS + Math.floor(domFaith * FAITH_BONUS + domUnderstanding * UNDERSTANDING_BONUS)
BASE_RADIUS = 3   FAITH_BONUS = 4   UNDERSTANDING_BONUS = 2
```
(`MAX_FAITH_BONUS` is renamed `FAITH_BONUS` for symmetry; value unchanged at 4.)

- `BASE_RADIUS = 3` guarantees the **cradle still opens** at understanding ≈ 0.
- Understanding is **secondary** to faith for reach: max +2 tiles vs faith's +4.
- "Dominant belief" = iterate beliefs, track the entry with max `faith`, read both
  `faith` and `understanding` off that entry. If no beliefs, reach contribution is 0
  (unchanged from today's `bestFaith = 0`).

### 2.2 Omen — `src/sim/divine-actions.ts → omen()`

Current (`:73-81`): each home-POI believer with an existing belief gets
`faith += OMEN_FAITH_BOOST` (0.08), flat.

New: per-witness faith boost scales by that witness's comprehension:
```ts
existing.faith = clamp01(existing.faith + OMEN_FAITH_BOOST * signResponse(existing.understanding))
```
Comprehending believers see the omen for what it is; the rest half-register it.
(Omen still only affects NPCs that already have a belief entry — unchanged.)

### 2.3 Whisper — `src/sim/divine-actions.ts → whisper()`

Current (`:46-56`): faith += 0.15, understanding += 0.03 (flat), for both the
existing-belief and new-belief branches.

New:
- The **faith** gain scales by `signResponse(understanding)`. For an existing
  believer, use their current understanding *before* this whisper's increment. For a
  brand-new believer (no entry yet), understanding is 0 → floor (0.5×) applies.
- The **understanding gain (+0.03) stays ungated.** This is the loop: every whisper
  *teaches* a little, and the more they understand, the harder the next whisper lands
  on faith. Whisper remains the entry-level bootstrap.

```ts
// existing branch:
const resp = signResponse(existing.understanding);
existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST * resp);
existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
// new branch: understanding starts at WHISPER_UNDERSTANDING_BOOST (0.03);
// faith starts at WHISPER_FAITH_BOOST * signResponse(0) = 0.15 * 0.5 = 0.075
```

### 2.4 Answer Prayer — `src/sim/divine-actions.ts → answerPrayer()`

Current (`:213-226`): faith += 0.2 (flat), meaning += 0.3, activity → idle.

New (the "Both" decision):
- **faith** gain scales by `signResponse(understanding)` — well-understood prayers
  deepen faith more. Existing believer uses current understanding; new believer
  (recruitment branch) gets `signResponse(0)` = 0.5× → faith 0.1.
- A successful answer **nudges understanding up** by `ANSWER_UNDERSTANDING_BOOST`
  (0.04) — they learn your form by being heard. Applies to both branches (new
  believer starts understanding at 0.04 instead of 0).
- **`meaning` restoration stays fixed at +0.3** — that's the need being met,
  independent of comprehension. Unchanged.
- activity → idle, duration → 0. Unchanged.

```ts
const u = existing ? existing.understanding : 0;
const faithGain = ANSWER_PRAYER_FAITH_BOOST * signResponse(u);
// then add faithGain to faith, and bump understanding by ANSWER_UNDERSTANDING_BOOST (clamped)
```

---

## 3. Constants summary (all tunable)

| Constant | Value | Where |
|---|---|---|
| `SIGN_RESPONSE_FLOOR` | 0.5 | belief math helper |
| `BASE_RADIUS` | 3 | perception-system.ts (unchanged) |
| `FAITH_BONUS` (was `MAX_FAITH_BONUS`) | 4 | perception-system.ts (rename, same value) |
| `UNDERSTANDING_BONUS` | 2 | perception-system.ts (new) |
| `ANSWER_UNDERSTANDING_BOOST` | 0.04 | divine-actions.ts (new) |

Existing magnitudes (`OMEN_FAITH_BOOST` 0.08, `WHISPER_FAITH_BOOST` 0.15,
`WHISPER_UNDERSTANDING_BOOST` 0.03, `ANSWER_PRAYER_FAITH_BOOST` 0.2,
`ANSWER_PRAYER_MEANING_BOOST` 0.3) are unchanged.

---

## 4. Out of scope (do not touch)

- **Devotion**, the power formula, self-agency, secularization, desperation boost.
- **Belief propagation** (`belief-propagation-system.ts`) — understanding's
  "pass on accurate belief" job is misattribution, which needs rivals (Track 3) + LLM
  (Track 2). Not this slice.
- **Dream** and **Miracle** understanding grants — leave as-is. Miracle is a
  need-meeting act, not a sign-reading test; gating it would punish crisis relief.
- **Belief-event consumption** (`belief_cross`/`mood_cross`/`believer_lost`) — needs
  Fate (Track 4) / Book (Track 6).

---

## 5. Testing

New/updated tests (Vitest, under `tests/unit/`):

1. **`signResponse`** — floor at u=0 (→0.5), ceiling at u=1 (→1.0), monotonic,
   clamps out-of-range input.
2. **Perception reach** — reach grows with understanding; still opens (r ≥ 3) at
   understanding=0; faith and understanding both contribute; uses the dominant
   (max-faith) belief's understanding. (`perception-system.test.ts`)
3. **Omen** — per-witness faith delta scales with that witness's understanding
   (high-understanding believer gains ~2× a zero-understanding one). (`dilemma-divine-actions.test.ts`)
4. **Whisper** — faith gain scales by `signResponse`; understanding gain stays flat
   at 0.03; new-believer faith starts at 0.075. (`dilemma-divine-actions.test.ts`)
5. **Answer Prayer** — faith gain scales by understanding; a successful answer raises
   understanding by 0.04; meaning still +0.3; new-believer recruitment faith = 0.1.
   (`dilemma-divine-actions.test.ts`)

**Existing assertions to update:** `dilemma-divine-actions.test.ts` currently asserts
the old fixed deltas (e.g. whisper faith +0.15, answer faith +0.2). These become the
new scaled values. `dilemma-power-formula.test.ts` is unaffected (formula unchanged).

The full suite (~820 tests) must stay green after updates.

---

## 6. File-touch summary

- **Modify:** `src/sim/npc-sim.ts` (or new `src/sim/belief-math.ts`) — add `signResponse` + `SIGN_RESPONSE_FLOOR`.
- **Modify:** `src/world/perception-system.ts` — reach formula + `UNDERSTANDING_BONUS`, rename `MAX_FAITH_BONUS`→`FAITH_BONUS`, dominant-belief selection.
- **Modify:** `src/sim/divine-actions.ts` — `omen`, `whisper`, `answerPrayer`; add `ANSWER_UNDERSTANDING_BOOST`.
- **Modify/add tests:** `tests/unit/perception-system.test.ts`, `tests/unit/dilemma-divine-actions.test.ts`, + a `signResponse` test (new file or fold into an existing belief-math test).
