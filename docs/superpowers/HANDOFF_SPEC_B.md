# Handoff: Starting Spec B (Time)

**Read this first if you are picking up Small Gods development to begin Spec B.**

## TL;DR for the next session

Spec A (architectural spine) is shipped. The codebase has an event log, system scheduler, first-class spirits, NPCs as world entities, tile realization, and a cradle-style start. **Spec B builds time-travel on top of this.**

Start by reading these three files in order:
1. `docs/superpowers/specs/2026-05-17-spec-a-spine-design.md` — the architecture you're inheriting
2. `docs/superpowers/plans/2026-05-17-spec-a-spine.md` — the plan format the repo expects
3. This handoff (you're reading it)

Then brainstorm Spec B with the user via `superpowers:brainstorming`, write the design doc as `docs/superpowers/specs/YYYY-MM-DD-spec-b-time-design.md`, and follow the same flow that produced Spec A.

## The five-spec arc — recap

| Spec | Status | Scope |
|---|---|---|
| **A. Spine** | ✅ merged 2026-05-17 (`a5b1989`) | Event log, scheduler, spirits, NPC entities, realization, cradle start, slim game.ts |
| **B. Time** | ← you are here | Snapshots, replay, scrub UI, time scaling (slow/fast/pause), seed control |
| **C. Branching** | future | Parallel universes — fork timeline, diverging realized regions, universe selector UI |
| **D. Cinematic** | future | Cutscenes (scripted event sequences), camera director, void visual treatment (dithering / mist) |
| **E. The Book** | future | Chapter detector over event log, narrative renderer, naming ritual ("Fooob"), LLM backfill |

## What's in place that Spec B leverages

These exist on `main` after Spec A:

- **`EventLog`** (`src/core/events.ts`) — typed `SimEvent` discriminated union (15 arms), append-only, monotonic ids, sim-tick timestamps, subscriber fan-out. **This is the timeline.**
- **`SimClock`** (`src/core/clock.ts`) — sim-tick clock decoupled from wall time.
- **`Scheduler`** (`src/core/scheduler.ts`) — `setRate(scale)` already exists for time scaling. `setRate(0)` pauses, `setRate(2)` doubles speed. The plumbing is done; what's missing is the UI and the snapshot/replay layer.
- **Determinism guarantee** — `tests/unit/determinism.test.ts` proves that NpcSimSystem + SpiritSystem + PerceptionSystem produce identical event logs given identical inputs. **This is the precondition for replay-based time travel.**
- **`NpcMovementSystem` uses `Math.random()`** — NOT deterministic. Spec B will need to address this (seedable RNG, or record movement deltas as events, or accept that movement is presentation-only and not part of the replay).

## What Spec B needs to design

The core question for Spec B is: **snapshot-and-fast-forward vs full event-sourcing replay?**

- **Snapshot strategy:** Periodically snapshot `GameState` (without scheduler/DOM). Scrubbing means "jump to nearest snapshot, then forward-tick to target time." Faster scrub but more memory.
- **Pure replay strategy:** State = `fold(events)` from t=0. Scrubbing is "re-fold from beginning to target event id." Zero state-snapshot memory but slow long sessions.
- **Hybrid (recommended in Spec A's design doc):** Snapshots every N events for fast jumps + replay forward from the nearest snapshot.

Other Spec B questions to brainstorm:
- What's the scrub UI? A horizontal scrubber bar at the bottom? Chapter markers (will tie into Spec E)?
- Does scrubbing "rewind" view state too (camera, selected NPC), or just sim state?
- Speed UI — slider? buttons? keyboard shortcuts (`1`/`2`/`4`/`8`)?
- How to handle the `NpcMovementSystem` non-determinism. Three options: (a) seedable RNG on the system, (b) emit `npc_moved` events into the log and replay them, (c) treat movement as presentation-only and let it re-randomize on rewind (cheap, but NPCs "jitter" during scrub).
- What's the "seed control" feature the user mentioned? Probably: re-seed the world's stochastic systems to explore alternate universes from the same initial state. May overlap with Spec C — clarify with user.

## Known follow-ups from Spec A (open GitHub issues)

Decide with the user before starting Spec B whether any block Spec B:

- **[#2](https://github.com/morteng/small-gods-game/issues/2)** — `World.move()` to keep spatial index in sync. **Probably non-blocking** for Spec B; movement is already in the "non-deterministic, may not be part of replay" bucket.
- **[#3](https://github.com/morteng/small-gods-game/issues/3)** — prime `NpcSimSystem` side maps in `seedWorld` to suppress spurious cradle `belief_cross`. **Worth doing before Spec B** because the Book of Fooob (Spec E) will read this event log, and the seed believer's birth shouldn't include a phantom crossing. ~10 minutes.
- **[#4](https://github.com/morteng/small-gods-game/issues/4)** — rewrite NPC overlay/info-panel to consume `NpcProperties` directly; delete adapter shims. **Non-blocking** for Spec B; transitional cleanup.

## Key files and where to look

| What you'll likely touch | File |
|---|---|
| Event log (read for replay) | `src/core/events.ts` |
| Scheduler rate control | `src/core/scheduler.ts` (`setRate` already exists) |
| Sim clock | `src/core/clock.ts` |
| Game state (snapshot target) | `src/core/state.ts` |
| Main loop wiring | `src/game.ts` |
| Determinism precondition test | `tests/unit/determinism.test.ts` |

| What you'll likely create | Path |
|---|---|
| Spec B design doc | `docs/superpowers/specs/YYYY-MM-DD-spec-b-time-design.md` |
| Spec B plan | `docs/superpowers/plans/YYYY-MM-DD-spec-b-time.md` |
| Snapshot/replay module | `src/core/snapshot.ts` (or similar) |
| Scrub UI | `src/ui/timeline-scrubber.ts` (or similar) |
| Speed UI | `src/ui/speed-controls.ts` (or similar) |

## How to run the existing game

```
npm run dev        # vite dev server; opens game with cradle start
npm test           # 526 unit tests
npm run build      # TypeScript check + production build
```

The game currently opens to a small visible bubble around one believer (faith 0.2), surrounded by void. Click the NPC to select; whisper button appears in the overlay; whispering boosts the believer's faith, which expands the realized bubble.

## What to say to start the session

> "I want to start Spec B (Time — snapshots, scrub, speed control, seed re-roll). Read `docs/superpowers/HANDOFF_SPEC_B.md` first, then brainstorm Spec B with me."

That's it. The handoff file will walk Claude through everything.

## A note on flow

This session executed Spec A in one stretch using the `superpowers:subagent-driven-development` skill — fresh subagent per task, two-stage review (spec compliance + code quality), continuous execution. It worked well: 22 tasks, all merged green, ~3 hours wall time. Recommend repeating the same flow for Spec B unless you want to try something different.
