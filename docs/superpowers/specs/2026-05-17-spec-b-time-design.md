# Spec B — Time

**Status:** Draft — brainstorm in progress (Sections 1–2 settled; UI section settled at decision level; Sections 3–5 pending)
**Date:** 2026-05-17
**Scope:** Second of a five-spec arc. Builds the time-mastery package on Spec A's spine: hybrid snapshot/replay layer, scrub UI, speed control, seedable world RNG, commit & re-roll flow. Followed by Spec C (Branching) which extends the discarded-future capture into persistent parallel universes.

## Context

Spec A delivered the architectural spine: a typed `EventLog` is the canonical record of narrative-grade sim state changes, a `Scheduler` already supports `setRate(n)` for time scaling, a `SimClock` decouples sim ticks from wall time, NPCs are first-class `World` entities, and `determinism.test.ts` proves the sim systems are deterministic given identical inputs. The plumbing for time control exists; what's missing is the UI surface, the snapshot/replay machinery, and a way to handle the one remaining source of non-determinism (`NpcMovementSystem` uses `Math.random()`).

Spec B turns that latent capability into a feature. The player can pause, accelerate, scrub backward, inspect what happened, and either return to live or commit a change — either replaying the same fate from the scrub point or re-rolling for a different fate. Discarded futures are captured (in-memory) so Spec C can later resurrect them as branches.

## Goals

1. **Snapshot/replay layer** — hybrid strategy. `GameState` (minus DOM and scheduler) snapshotted every N events. Scrubbing jumps to the nearest snapshot then folds events forward to the exact tick.
2. **Seedable world RNG** — single PRNG in `GameState`, all stochastic systems draw from it. `NpcMovementSystem` migrated off `Math.random()`. RNG state is part of snapshots so replay reproduces movement exactly.
3. **Scrub UI** — bottom bar with transport buttons, scrub handle, event glyphs, current/max tick label.
4. **Speed control surface** — pause / 1x / 2x / 4x / 8x buttons + keyboard shortcuts (`Space`, `1`, `2`, `4`, `8`); wraps existing `scheduler.setRate`.
5. **Commit & re-roll** — two-button commit flow when scrubbed away from live tail. *Commit* truncates the future and replays forward with the same RNG state (same fate, same future). *Re-roll & commit* truncates, swaps RNG state, and replays forward (alternate fate).
6. **Discarded-future capture** — when commit or re-roll truncates the existing future, the discarded event tail is stashed in-memory keyed by parent tick. Spec C reads this to resurrect branches; Spec B only needs the hook.

## Non-goals

- **Parallel-universe persistence and switching UI** — Spec C.
- **Chapter/event-glyph polish driven by narrative semantics** — Spec E.
- **Saving timelines to disk between sessions** — out of scope.
- **LLM-narrated rewind / cinematic scrub** — Spec D.
- **Movement-event logging for replay** — we chose seedable RNG instead.
- **Camera/selection rewind tied to scrub position** — out of scope; view state is sticky as you scrub (open question, may revisit).

## Architecture overview

```
                    ┌──────────────────────────────────┐
                    │ game.ts                          │
                    │  scheduler.tick(dt)              │
                    │  scrubber.render()               │
                    └────────┬──────────────┬──────────┘
                             │              │
              ┌──────────────▼─────┐  ┌─────▼───────────────┐
              │ Scheduler          │  │ Scrub UI            │
              │  setRate(n) ←──────┼──┤  speed buttons      │
              │  pause when        │  │  scrub handle       │
              │  scrubbing         │  │  Commit/Re-roll btns│
              └────────┬───────────┘  └─────┬───────────────┘
                       │                    │
                       ▼                    ▼
              ┌─────────────────────────────────────────────┐
              │ TimelineController                          │
              │   - jumpTo(tick)                            │
              │   - commit(reroll?: boolean)                │
              │   - returnToLive()                          │
              │   - snapshots: SnapshotStore (every N ev)   │
              │   - discardedFutures: Map<tick, Event[]>    │
              └────────┬────────────────────────────────────┘
                       │ reads/writes
                       ▼
              ┌─────────────────────────────────────────────┐
              │ GameState (snapshot target)                 │
              │   - world, spirits, clock, rng (new!)       │
              │   + EventLog (frozen at currentTick)        │
              └─────────────────────────────────────────────┘
```

## Section 2 — Snapshot / replay layer

**Modules**

- `src/core/timeline.ts` — `TimelineController` (the controller)
- `src/core/snapshot.ts` — `SnapshotStore` (ring buffer + serialize/restore)

**Snapshot shape**

```ts
type Snapshot = {
  tick: number;            // sim tick at capture
  eventId: number;         // last event id included
  state: SerializedState;  // deep-cloned GameState minus runtime-only fields
  rngState: RngState;      // serialized PRNG state
};
```

`SerializedState` is `GameState` with these stripped:

- DOM-bound refs (canvas, asset blobs)
- The `Scheduler` instance
- Subscriber lists on `EventLog`

The world entity registry and spatial index are serialized as the source-of-truth entity arrays plus a flag that lets `World.rebuild()` reconstruct indexes on load.

**Snapshot interval**

Every **N events** rather than every K ticks. Rationale: ticks without events are cheap to replay; events are the units of state change. **Default N = 50.** Tunable in `GameConstants`. At ~1 belief-relevant event per second of play, 50 events ≈ one snapshot per ~50 s of game time.

**Capacity**

Ring buffer of last **40 snapshots** (~33 minutes of recent play). In-memory only; no persistence between sessions in Spec B.

**`TimelineController` API**

```ts
class TimelineController {
  jumpTo(targetTick: number): void;
  // Picks nearest snapshot ≤ targetTick, restores it,
  // folds eventLog forward until clock.now() === targetTick.
  // Pauses scheduler. Sets isScrubbed = true.

  commit(opts: { reroll: boolean }): void;
  // Truncates eventLog at currentTick.
  // If reroll: replaces rngState with fresh splitmix64(Date.now()).
  // Stashes truncated tail in discardedFutures.
  // Resumes scheduler at rate 1.
  // Sets isScrubbed = false.

  returnToLive(): void;
  // Restores most recent snapshot + folds to end of eventLog.
  // Resumes scheduler. isScrubbed = false. No truncation.

  get isScrubbed(): boolean;
  get currentTick(): number;
  get maxTick(): number;
}
```

**Replay mechanics**

Systems are *not* re-run during replay. Replay folds events into state via pure reducers:

```ts
function applyEvent(state: GameState, event: SimEvent): void { … }
```

One switch over the 15 `SimEvent` arms. Each arm mutates exactly the fields that the original-system emitter mutated. This forces us to write down what each event canonically *means* for state, which is healthy discipline.

**Determinism precondition**

`tests/unit/determinism.test.ts` already proves `NpcSimSystem + SpiritSystem + PerceptionSystem` are deterministic given identical inputs. Adding seedable RNG to `NpcMovementSystem` (see Section 3, pending) extends that test to cover movement. The test becomes the replay correctness gate.

**Trade-off acknowledged:** the `applyEvent` reducer must stay in sync with every system that emits events. If a system mutates `state` without emitting an event, replay diverges silently. **Mitigation:** add a debug-build assertion that snapshots state-hash after each system tick and compares to applyEvent-only replay; CI flag.

## UI decisions (decided; full section pending)

**Scrub UI shape** — bottom bar pinned to the viewport, full width. Contains:

- Transport buttons on the left: `◄◄` (jump to start), `▮▮` (pause), `►►` (jump to live tail)
- Speed buttons: `1x` / `2x` / `4x` / `8x` (highlighted when active)
- Scrub track with event glyphs at notable events (whisper, belief crossing, miracle — exact event subset TBD in full UI section)
- Current/max tick label: `tick: 1240 / 1840`
- When `isScrubbed`: **Commit** and **Re-roll & commit** buttons appear

**Speed controls** — buttons in the scrub bar plus keyboard:

- `Space` → toggle pause
- `1` / `2` / `4` / `8` → set rate

**Commit flow** — when the player scrubs away from live tail and chooses to act:

- **Commit** → truncate future, keep same RNG state, replay forward (same fate from this point)
- **Re-roll & commit** → truncate future, swap RNG state, replay forward (alternate fate)

**Scrub semantics** — pause-while-scrubbing, no live tail running headless. The player is in control of the clock.

## Pending sections

- **Section 3** — Seedable world RNG module (`src/core/rng.ts`), integration with `NpcMovementSystem`, splitmix64 vs xoshiro choice.
- **Section 4** — Scrub UI component design and rendering details (DOM vs canvas, hit areas, event-glyph rules, visual treatment of scrubbed-vs-live state, integration with existing `OverlayDispatcher`).
- **Section 5** — Testing strategy: replay determinism tests, scrub-and-commit round-trip tests, RNG migration test, snapshot-size budget test.

## Open questions

- Snapshot interval N — defaulting to 50 events; may tune after measuring real session size.
- Snapshot ring buffer cap — 40; may tune.
- View state on scrub: camera and selection currently stay where the player put them (sticky); confirm or revisit.
- Visual treatment of "we are not at live tail" — tinted overlay? muted UI? deferred to Spec D (Cinematic) or owned here?
- Exact subset of event types that render glyphs on the scrub track (likely: `whisper_cast`, `belief_cross`, `miracle`, `npc_died`; explicitly not: `npc_moved` if we ever add it, `mood_cross` is borderline).

## Brainstorm decisions log

For future reference, the brainstorm answered:

1. Spec B is the full time-mastery package — scrub, speed, and seed re-roll all carry equal weight.
2. Seed re-roll **replaces** the live timeline (Spec B). Spec C will later add the "keep both timelines and switch" layer on top.
3. **Hybrid** snapshot+replay (snapshots every N events, fold forward from nearest).
4. **Seedable world RNG** owned by `GameState`; not per-system; not movement events.
5. **Bottom bar with event ticks** for scrub UI.
6. **Buttons + keyboard shortcuts** for speed control (canonical 1/2/4/8 rates).
7. **Pause-while-scrubbing**, no truncation until commit; commit replays forward.
8. **Two buttons** (Commit / Re-roll & commit); discarded futures stashed for Spec C.
