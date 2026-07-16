# Spec — Proactive Fate: arcs, portents, and dynamic weaving

**Date:** 2026-07-14 · **Status:** spec · **Track:** 4 (Fate) · **Brainstorm:** [../2026-07-14-mortal-power-and-proactive-fate-brainstorm.md](../2026-07-14-mortal-power-and-proactive-fate-brainstorm.md)
**Canon:** VISION 1.1.0 §2.1, §2.1.1 (amended in the same change that produced this spec)

> This closes both of Fate's outstanding roadmap gaps in one architecture:
> *"pacing/plot intelligence beyond single-beat reactions"* and *"the era-authoring half of the D2 skip loop."*

---

## 1. The problem, stated architecturally

Fate today cannot be proactive **in principle**, and no prompt change would fix it:

| | |
|---|---|
| `FateBrainService.deliberate()` | **Stateless.** Reads world state → arms ≤1 beat → **forgets**. No memory of intent between deliberations. |
| `FateTrigger` | **Event-driven only.** Wakes on a story-significant event or sustained rival claim pressure. **No heartbeat** ⇒ no initiative. |
| `FATE_TOOLS` | Five tools, all **immediate**: `arm_staged_beat`, `nudge_event_severity`, `force_next_event`, `set_rival_stance`, `author_building`. None expresses an *intention over time*. |

Fate needs three things it does not have: **memory**, **a pulse**, and **a vocabulary for intent**.

---

## 2. Goals / non-goals

**Goals**
- Fate holds **long-range intentions** (arcs) that persist across deliberations, saves, and scrubs.
- Fate acts on **initiative** (a pulse), not only on incoming events.
- Fate runs **2–4 arcs concurrently** and prefers pressures that **advance several at once** (weaving).
- Every beat is **foreshadowed** before it lands (portents), making Fate *readable*.
- Fate **re-plans** when thwarted; it never forces a beat through.

**Non-goals**
- ❌ Fate does **not** model the player. That is rival spirits (VISION §2.1). Fate plots against the *story*, not the *player*.
- ❌ Fate does **not** gain new powers over the world. **The arc vocabulary is strictly the existing sim-mutation vocabulary.** Fate gets *foresight*, not *reach*.
- ❌ No new save version. Arc state rides the snapshot (see §4.3).

---

## 3. The four constraints (from VISION §2.1.1) — as testable invariants

| Constraint | Invariant | Guard |
|---|---|---|
| **Sim-currency** | Every arc pressure resolves to an existing capability-registry verb or an existing Fate tool. No arc may name an effect the sim cannot already produce. | Validate arc pressures against `CAPABILITY_REGISTRY` at parse time — same allowlist discipline as `story-pack-live-verbs.test.ts`. Reject the arc, not the run. |
| **Portents first** | A beat with `gravity >= PORTENT_GATE` may not arm unless its arc's `portents[]` ledger is non-empty and at least one portent has been **discovered**. | `fate-arcs.test.ts` — arm a heavy beat with an empty ledger, assert rejection. |
| **Dispositions** | An arc whose preconditions have become unreachable must be **abandoned**, not forced. | Abandonment is checked every pulse; `abandonedReason` is logged. Test: satisfy an arc's negation, assert it abandons within one pulse. |
| **Latency** | Staged content materializes only on player attention (VISION §2.3). | Existing `StagingBuffer` discovery path — unchanged. |

---

## 4. Architecture

### 4.1 `FateArc` — the unit of intent

```ts
// src/sim/fate/arc-types.ts   (sim-side: it is snapshot state)
export interface FateArc {
  id: number;                       // monotonic, from state
  shape: string;                    // arc-library key, e.g. 'strongman_dies_abroad'
  openedTick: number;
  /** What Fate WANTS to become true. Evaluated against the world each pulse. */
  goals: ArcGoal[];
  /** Pressures already applied — the audit trail, and the re-plan input. */
  applied: ArcPressure[];
  /** Omens planted for this arc. A heavy beat may not land on an empty ledger. */
  portents: ArcPortent[];
  /** Subject bindings: the mortals/settlements this arc is ABOUT. */
  cast: { poiIds: string[]; npcIds: number[] };
  stage: 'seeded' | 'building' | 'imminent' | 'landed' | 'abandoned';
  abandonedReason?: string;
  /** Soft budget: how much more pressure this arc may spend before it must land or fold. */
  pressureBudget: number;
}

export interface ArcGoal {
  /** A pure predicate over GameState. Named, so it round-trips through the snapshot. */
  predicate: string;                // e.g. 'lord_absent', 'heir_is_child'
  args?: Record<string, string | number>;
  met: boolean;                     // recomputed each pulse — never trusted from disk
}
```

`ArcPressure` is **not a new effect type** — it is a *reference* to an existing tool/verb call plus the
arc it served:

```ts
export interface ArcPressure {
  tick: number;
  verb: string;                     // MUST be in CAPABILITY_REGISTRY (or a FATE_TOOLS name)
  args: Record<string, unknown>;
  servedArcs: number[];             // ← the weaving audit trail
}
```

### 4.2 The arc library — story *shapes*, not scripts

```ts
// src/sim/fate/arc-library.ts
export interface ArcShape {
  key: string;
  title: string;                    // for the chronicler + dev UI
  /** Preconditions for Fate to even CONSIDER seeding this arc. */
  seedWhen: string[];               // predicate names
  /** The conditions Fate will work toward. */
  goals: Omit<ArcGoal, 'met'>[];
  /** Which portent flavours suit this shape (the chronicler picks the words). */
  portentKinds: string[];
  /** Soft cap on total pressure. */
  budget: number;
}
```

First library (from the Norman research — see the mortal-power spec for their content):

| key | shape |
|---|---|
| `strongman_dies_abroad` | The strongman dies far from home, leaving a child heir. The vacuum is not empty; it is a feeding frenzy. |
| `exile_returns_crowned` | The exile at a foreign court returns to rule, bringing foreign tastes and a promise that detonates later. |
| `kingmaker_discarded` | The one who made the ruler becomes the first casualty of the ruler they made. |
| `brother_from_within` | A rival born of **defection** — strictly more hostile than one always foreign. |
| `victory_that_loses` | Success as the direct cause of failure (Stamford Bridge → Hastings). |
| `martyr_by_accident` | A squalid, unjust death converted into a permanent belief-generating structure — *and your enemies can create one by mistake.* |
| `the_null_event` | The usurper who simply dies, for no dramatic reason. **Fate must sometimes decline to author.** |

> `the_null_event` is load-bearing, not a joke. Both Harold Harefoot and Harthacnut died young for no
> reason, which is how the wholly unlikely Edward got a throne. **An author who never rolls a null is
> legible as an author.**

### 4.3 Persistence — ride the snapshot, no `SAVE_VERSION` bump

`StagingBuffer` is already snapshot-backed with full-state persistence and no version bump. **Arcs go
in the same place**, for the same reason: they are narrative state, they must survive save/load, and —
critically — **they must survive a timeline scrub**.

⚠ **Scrub semantics are a real design call, not a detail.** `FateTrigger.reset()` exists precisely
because scrubbing broke throttle state (the "scrub-ghost" bug). For arcs:

- **Arc state is sim truth ⇒ it scrubs WITH the timeline.** Scrub back before an arc was seeded, and the
  arc un-happens. This is correct: VISION tenet 10 says defying Fate has a price, and the *cheapest*
  reading of a scrub is that Fate's plan is rewound too.
- Arc *deliberation throttles* (last-pulse tick, in-flight flag) are **runtime**, and reset on restore —
  same pattern as `FateTrigger.reset()`.

### 4.4 The pulse — initiative

```ts
// src/game/fate/fate-pulse.ts
```
A low-frequency heartbeat (default: **once per game-day**, cooldown-shared with `FateTrigger`) that
wakes the brain **even when nothing happened**. This is the entire mechanical difference between a
reactive and a proactive Fate.

The pulse deliberation asks a different question than the event deliberation:

| | wakes on | asks |
|---|---|---|
| `FateTrigger` (exists) | a story-significant event / rival pressure | *"something happened — what do you make of it?"* |
| `FatePulse` (new) | the clock | *"nothing happened. What are you **building toward**?"* |

Both funnel into `FateBrainService.deliberate(focus)`; `FateFocus` grows a `kind: 'event' | 'pulse'`
discriminant so `buildFateContext` can frame the prompt appropriately.

### 4.5 Weaving — one scoring line

When Fate proposes a pressure, score it by **how many live arcs it advances**:

```ts
score(pressure) = Σ_{arc ∈ live} advances(pressure, arc) * arc.urgency
```

Fate is *shown* its live arcs in context and *asked* to prefer multi-arc pressures; the `servedArcs[]`
field is then validated (a claimed arc must actually list a goal the pressure plausibly moves). **One
drought serving both the famine arc and the tyrant arc is how plot braids rather than queues.**

---

## 5. New Fate tools

Following the established pattern exactly: constrained enums, drift-guarded ids, capped deltas,
validation on **both** sides of the LLM boundary.

| tool | purpose | guards |
|---|---|---|
| `seed_arc` | Open a new arc from the library. | `shape` ∈ `ARC_LIBRARY` keys; `cast` ids drift-guarded against `validPoiIds`/live npc ids; **rejected if `seedWhen` predicates are not met** (this is the "no plot devices" gate); rejected if live arcs ≥ `MAX_LIVE_ARCS` (4). |
| `plant_portent` | Add an omen to an arc's ledger. Materializes as a `soft` staged beat + an inbox tiding. | `arcId` must be live; portent kind ∈ the shape's `portentKinds`; ≤1 per deliberation. |
| `advance_arc` | Apply a pressure in service of ≥1 arc. **Carries no effect of its own** — it *names* an existing tool call and the arcs it serves. | `verb` ∈ `CAPABILITY_REGISTRY` ∪ `FATE_TOOLS`; `servedArcs` all live; the underlying call is re-validated by its own existing parser. |
| `abandon_arc` | Fold an arc Fate can no longer reach. | `arcId` live; `reason` required (it feeds the chronicler). |

**`arm_staged_beat` gains a `portentGate`:** if the beat's gravity is heavy and the named arc's portent
ledger is empty, **reject it and tell Fate why** — reusing the `authoringRetryPrompt` self-correction
loop that `author_building` already proves works.

---

## 6. Slices

| # | Slice | Ships | Depends on |
|---|---|---|---|
| **F1** | **Arc state + snapshot.** `FateArc`/`ArcGoal`/`ArcPressure` types; `state.fateArcs`; snapshot round-trip; scrub semantics + test. **No LLM yet** — a deterministic stub seeds one arc so the plumbing is provable offline. | Memory. | — |
| **F2** | **The pulse.** `FatePulse` heartbeat; `FateFocus.kind` discriminant; context framing for "what are you building toward?". | Initiative. | F1 |
| **F3** | **Arc library + `seed_arc` / `abandon_arc`.** The 7 shapes; predicate registry; `seedWhen` gate. | Intent. | F1, F2 |
| **F4** | **Portents + the gate.** `plant_portent`; ledger; the heavy-beat gate + retry prompt. | Readability. | F3 |
| **F5** | **Weaving.** `advance_arc` with `servedArcs`; the multi-arc scoring in context; the audit trail. | Braiding. | F3 |
| **F6** | **Era-authoring** (the D2 skip loop's missing half): an arc that spans a time-skip authors the *era summary* from its own goals + applied pressures. | Roadmap gap closed. | F5 |

**F1–F2 are the whole architectural change.** F3–F6 are content and polish on top.

---

## 7. Tests

- `fate-arc-snapshot.test.ts` — arcs round-trip; scrub rewinds them; runtime throttles reset (scrub-ghost).
- `fate-arc-guards.test.ts` — `seed_arc` with unmet `seedWhen` is **rejected**; unknown shape rejected; >MAX_LIVE_ARCS rejected; `advance_arc` naming an unregistered verb is rejected **without killing the deliberation**.
- `fate-portent-gate.test.ts` — a heavy beat on an empty ledger is rejected and the rejection text reaches the retry prompt.
- `fate-arc-abandon.test.ts` — an arc whose goals become unreachable abandons within one pulse and never fires its beat.
- `fate-weaving.test.ts` — given two arcs sharing a settlement, a pressure serving both records `servedArcs.length === 2`.
- **Determinism:** `no-random-in-sim` already guards. Arc *state* is sim-side; arc *authoring* stays async/off-tick (the existing `FateBrainService` pattern). Any arc predicate must be a **pure function of `GameState`**.

---

## 8. Risks

1. **Arc state in the snapshot inflates the autosave.** Mitigate: arcs are small (≤4 live, bounded
   `applied[]` ring). Measure against the autosave budget — the codec work already made this cheap, but
   don't assume; **measure**.
2. **A proactive Fate is a much bigger LLM bill.** The pulse fires on a clock, not on drama. Mitigate:
   the pulse shares `FateTrigger`'s cooldown, runs at ~1/game-day, and **skips entirely when no arc is
   live and no `seedWhen` is met** (Fate is allowed to be idle — `the_null_event` is in the library for
   a reason).
3. **The LLM will want to author plot devices.** That is exactly what `seedWhen` and the
   capability-registry gate exist to refuse. **Reject the arc, keep the run** — and feed the rejection
   back through the proven self-correction retry.
4. **Weaving could collapse into "always pick the pressure that touches the most settlements."**
   Guard: `advances()` must check a *goal*, not mere subject overlap.
5. **Offline/stub path.** `llmClientCapable === null` must still produce a coherent (if dull) Fate. F1's
   deterministic stub is not scaffolding to throw away — it is the **permanent offline fallback**.

---

## Reality check (2026-07-16) — F1 + F2 SHIPPED

Implemented as specified. `src/sim/fate/`: `arc-types.ts` (§4.1 shapes +
`MAX_LIVE_ARCS = 4`), `arc-predicates.ts` (named pure-predicate registry —
unknown predicate evaluates to an honest `false`), `arc-store.ts`
(`FateArcStore`, a direct mirror of `StagingBuffer`), `arc-stub.ts` (the
deterministic offline seeder, shape `stub_vigil` — the permanent no-LLM
fallback per §8.5). `state.fateArcs` rides the snapshot with no
`SAVE_VERSION` bump; `restoreSnapshot` hydrates with every `goal.met`
forced false then `recomputeGoals(state)` — `met` is never trusted from
disk, and a scrub un-happens arcs opened after the restore point (§4.3,
test-proven). `FatePulse` (`src/game/fate/fate-pulse.ts`) ticks once per
game-day (`TICKS_PER_DAY` multiple), routes through `FateTrigger`'s OWN
readiness+cooldown gate (`fateTrigger.pulse()`), skips entirely when no
arc is live and no seed condition holds, and its runtime throttle resets
in the timeline `onRestore` hook beside `fateTrigger.reset()`.

**One deviation:** `EventFocus.kind` is *optional* (`kind?: 'event'`)
rather than required — the many existing `{ event, threadId }`
construction sites keep compiling; discrimination is always via
`focus.kind === 'pulse'`.

## Reality check (2026-07-16, later) — F3 SHIPPED

The arc library + `seed_arc`/`abandon_arc`, as specified.
`src/sim/fate/arc-library.ts`: the seven §4.2 shapes (`ArcShape` with
`logline` added for the prompt), `isShapeSeedable`/`seedableShapes`/
`anySeedableShape`, and `openArcFromShape` — goals and budget always come
from the library, the LLM binds only the cast. `arc-predicates.ts` grew
the shapes' predicates (all pure over GameState, partial-state-safe);
registry integrity is guarded by `tests/unit/fate-arc-guards.test.ts`
(every `seedWhen`/goal predicate a shape names must exist — the
sim-currency discipline). Both tools follow the constrained pattern:
`seed_arc` is four-gated (arc ctx present; shape ∈ library; live count
+ same-response seeds < `MAX_LIVE_ARCS`; `seedWhen` holds NOW) with a
drift-guarded cast (unknown poiIds / causal-site ids / unknown npc ids
filtered, arc still seeds); `abandon_arc` requires a LIVE arcId + a
non-empty reason (`FateArcStore.abandon` refuses re-folds). Every
rejection is a logged drop — §7's "must NOT kill the deliberation" is
test-proven end-to-end through `FateBrainService`. The online pulse's
idle-skip now asks the library's own gate (`anySeedableShape`); offline
keeps the stub condition. Context: charter mentions the arc tools; a
"seedable shapes" digest (only shapes whose preconditions hold, hidden
at the cap) joins the live-arcs digest.

**Two deviations:** (1) `FateArc.cast.npcIds` is `string[]` (`NpcId` =
`EntityId`), not the spec sketch's `number[]` — the shipped entity system
keys NPCs by string id, and the cast drift-guard must validate against
real live ids. (2) `the_null_event.seedWhen = ['has_settlements']` (not
`always`) so a settled world is required before Fate may even decline —
keeping the pulse's idle-skip meaningful pre-worldgen. **F4 note:** the
portent ledger, `plant_portent`, and the heavy-beat gate remain; goal
teeth (weaving/`advance_arc`) are F5.

## Reality check (2026-07-16, later still) — F4 SHIPPED

Portents + the gate, as specified. `plant_portent` follows the constrained
pattern: `kind` is schema-constrained to `ARC_PORTENT_KINDS` (the derived
union of every shape's `portentKinds`) and parse-narrowed to the NAMED
arc's own shape's kinds — the model picks among library flavours, never
invents; live-arc drift guard; required omen line; ≤1 per parse turn;
subject falls back to the arc's first cast settlement (causal sites
refused — an omen lands somewhere durable). It materializes exactly per
§5: a soft discovery beat (`StagedBeat` gained an optional `arcId`) + a
`beatId`-linked ledger entry + a new `portent_planted` SimEvent that
surfaces as an "An omen gathers over …" inbox tiding (event-log windowed,
`game-query.ts`) and a chronicler line. Firing the beat flips the entry
to `discovered` (StagingActivationSystem → `markPortentDiscovered`).
The gate: `arm_staged_beat` gained an optional `arcId`; a HEAVY beat on a
live arc whose ledger is empty is REJECTED and the reason rides
`portentGateRetryPrompt` through ONE bounded retry scoped to
`[plant_portent, arm_staged_beat]` — same-response omens count toward the
gate, so foreshadow-then-land in a single reply passes (test-proven end
to end; §7's `fate-portent-gate.test.ts`).

**Resolved ambiguities.** (1) *"Gravity"*: `StagedBeat` has no numeric
gravity field, so `PORTENT_GATE` is realized as HEAVY ⇔ the beat lands a
hard command (`inject_npc`); atmosphere-only beats pass ungated. (2) The
§3 constraint table's stronger form ("…and at least one portent has been
**discovered**") vs §5/§6/§7's empty-ledger wording: F4 ships the
§5/§6/§7 gate (non-empty ledger). The `discovered` plumbing is live and
truthful (writeback + digest show `N planted (M discovered)`), so
tightening to discovered-required is a one-line change if play wants it.
(3) A beat naming a hallucinated/stale `arcId` drops the REF (logged) and
still arms ungated — drift-guard discipline (same as storylet refs), not
a rejection; only a REAL live-arc ref submits a heavy beat to the gate.
(4) "≤1 portent per deliberation" is enforced per parse turn; a
deliberation whose gate-retry also plants can total 2 (main + retry),
each turn individually capped. (5) Shapes with no portent vocabulary
(`the_null_event`; the offline `stub_vigil`) accept no portents, so a
heavy beat on such an arc can never pass the gate — read as intended:
Fate declining to author lands no heavy blows. (6) `ArcPortent.discovered`
is a HISTORICAL fact and round-trips trusted from disk (unlike
`ArcGoal.met`), matching beat-status persistence; the ledger scrubs with
its arc (test-proven).
