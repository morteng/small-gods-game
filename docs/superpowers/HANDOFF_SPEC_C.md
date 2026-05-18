# Handoff: Starting Spec C (Branching)

**Read this first if you are picking up Small Gods development to begin Spec C.**

## TL;DR

Spec B (Time) is shipped on `feat/spec-b-time` ([PR #5](https://github.com/morteng/small-gods-game/pull/5)) and ready to merge. The codebase now has: seedable sfc32 RNG, hybrid snapshot/replay, `TimelineController` (jumpTo/returnToLive/commit/getDiscardedFutures), summoned Time bar UI with past-veil scrubbed treatment, keyboard shortcuts (T/Space/1/2/4/8/Esc). 577 tests passing.

**Spec C builds parallel-universe branching on top of `TimelineController.getDiscardedFutures()`.**

Start by reading these four files in order:
1. `docs/superpowers/specs/2026-05-17-spec-a-spine-design.md` — architectural spine (Spec A)
2. `docs/superpowers/specs/2026-05-17-spec-b-time-design.md` — the time layer (Spec B) you're inheriting
3. `docs/design/2026-05-17-ui-system-handoff/README.md` §8.10 — the Branches UI mock
4. This handoff (you're reading it)

Then brainstorm Spec C with the user via `superpowers:brainstorming`, write the design doc as `docs/superpowers/specs/YYYY-MM-DD-spec-c-branching-design.md`, and follow the same flow that produced A and B.

## The five-spec arc — recap

| Spec | Status | Scope |
|---|---|---|
| **A. Spine** | ✅ merged 2026-05-17 (`a5b1989`) | Event log, scheduler, spirits, NPC entities, realization, cradle start, slim game.ts |
| **B. Time** | ✅ PR #5 (2026-05-18) | Snapshots, replay, scrub UI, time scaling, commit/re-roll, discarded-future capture |
| **C. Branching** | ← you are here | Parallel universes — persist discarded futures as branches, switch between, lineage UI |
| **D. Cinematic** | future | Cutscenes (scripted event sequences), camera director, void visual treatment polish |
| **E. The Book** | future | Chapter detector over event log, narrative renderer, naming ritual, LLM backfill |

## What's in place that Spec C leverages

These exist on `feat/spec-b-time` (merge first, then start Spec C):

- **`TimelineController.getDiscardedFutures()`** (`src/core/timeline.ts`) — every `commit({ reroll })` stashes the truncated tail as `{ parentTick, events: AppendedEvent[], rerolled }`. In-memory only today; Spec C makes them persistent and player-visible.
- **`SnapshotStore`** (`src/core/snapshot.ts`) — ring-buffered restores, has `truncateAfter` for clean fork operations. Already capacity-bounded; Spec C may want a separate per-branch snapshot pool.
- **`captureSnapshot` / `restoreSnapshot`** — authoritative for spirits + entities + RNG + clock. Branch persistence will serialize Snapshot objects (already `JSON.stringify`-clean at ~50 KB per snapshot per the size budget test).
- **`SilentEventLog`** — replay machinery that won't pollute live logs. Branch playback uses the same trick.
- **Event glyphs on the scrub track** (`src/ui/panels/time-bar.ts`) — the visual vocabulary Spec C extends with branch markers (`--time` dot above chapter glyphs, per the design handoff).
- **Past-veil overlay** (`src/ui/chrome.ts`) — Spec C may layer a different tint when viewing a non-active branch.
- **Discarded-future schema** — `DiscardedTail` interface already carries `parentTick` and a `rerolled` flag. Spec C will likely extend it with `id`, `committedAt`, `name?`, child-branch refs.

## What Spec C needs to design

The core question for Spec C is: **how does the player choose, view, and live in alternate timelines?**

Open questions worth brainstorming:

- **Branches surface** — the design handoff §8.10 shows three branch cards (A here, B peek, C peek) with an SVG branch diagram above. Is "branches" its own panel summoned by a fourth corner chip, or a Book chapter, or a sidebar that lives inside the Time bar's commit row?
- **Branch identity** — auto-generated names ("the merchant timeline", "Year 2 winter"), or just timestamps, or player-named?
- **Re-entering a branch** — does "switch to branch B" do `jumpTo(parentTick) + apply tail events + resume`, or does each branch become its own `GameState` you can freely fork and switch between?
- **Per-branch snapshots** — Spec B's ring buffer holds snapshots for one timeline. Each branch needs its own (or branches share snapshots up to the parent tick?).
- **Persistence** — Spec B is in-memory only. Should Spec C land save-to-disk? Or stay in-memory for one more spec?
- **The "current branch" indicator** — does the Time chip show which branch you're in? Does the scrub bar visually annotate branch points along the track?
- **Pruning policy** — if the player branches obsessively, when do old branches expire? Per-branch tick budget? Tree size cap?

## Known follow-ups from Spec B (open in PR #5)

Address with the user before starting Spec C if they're blockers:

- **Dual pause mechanisms** — `state.paused` (legacy banner-toggle, unreachable via keyboard since Spec B) vs `scheduler.setRate(0)` (canonical, what Time chip displays + Space toggles). **Worth fixing before Spec C** because branch-switch flows will want to gate live ticks consistently. ~30 min to retire `state.paused` and route the banner off `scheduler.getRate() === 0`.
- **Text input focus guard on attachTimeKeys** — Space currently toggles pause even when typing in the settings API-key field. Minor, but spec D/C may add more modals.
- **NpcMovementSystem cooldown math** — consumes `ctx.dt` (the accumulator remainder) rather than the per-tick interval. Works in production (RAF deltaMs ≈ msPerTick) but means non-standard step sizes diverge between live and silent replay. The Spec B test `commit-no-reroll-equivalence` documents this. Not a blocker for Spec C; fix when touching the movement system anyway.
- **Glyph clustering** — Spec B's design said `< 4 px per glyph → merge`; not implemented because density hasn't been a problem yet. Watch in long sessions.

## Key files and where to look

| What you'll likely read | File |
|---|---|
| Timeline controller (commit + discarded futures) | `src/core/timeline.ts` |
| Snapshot capture/restore + store | `src/core/snapshot.ts` |
| Event log (`truncateAfter`, `since`, etc) | `src/core/events.ts` |
| Time bar + commit row | `src/ui/panels/time-bar.ts` |
| Chrome scaffold + past-veil | `src/ui/chrome.ts` |
| Design tokens | `src/ui/tokens.css` |
| Spec B replay equivalence tests | `tests/integration/commit-no-reroll-equivalence.test.ts` |

| What you'll likely create | Path |
|---|---|
| Spec C design doc | `docs/superpowers/specs/YYYY-MM-DD-spec-c-branching-design.md` |
| Spec C plan | `docs/superpowers/plans/YYYY-MM-DD-spec-c-branching.md` |
| Branch store (extends DiscardedTail) | `src/core/branches.ts` (or similar) |
| Branches panel | `src/ui/panels/branches.ts` |
| Branches chip (fourth corner indicator) | inside `src/ui/chrome.ts` or `src/ui/panels/branches-chip.ts` |

## How to run the existing game

```
npm run dev        # vite dev server; opens game with cradle start
npm test           # 577 unit + DOM + integration tests
npm run build      # TypeScript check + production build
```

The game opens to a small realized bubble around one believer (faith 0.2), surrounded by void. Top-right: Time chip showing `Y1 spring · DD/96 · 1×`. Click it (or press `T`) to summon the Time bar. Click the NPC to select; whisper button appears in the overlay. `Space` pauses; `1`/`2`/`4`/`8` set rate (with bar open); `Esc` dismisses.

## What to say to start the session

> "I want to start Spec C (Branching — persist discarded futures as parallel universes, branches UI). Read `docs/superpowers/HANDOFF_SPEC_C.md` first, then brainstorm Spec C with me."

## A note on flow

Sessions for both Spec A and Spec B used `superpowers:subagent-driven-development` — fresh subagent per task, two-stage review (spec compliance + code quality), continuous execution. It worked well: 22 tasks for A, 26 tasks for B, all merged green. Recommend the same flow for Spec C unless you want to try something different.

The biggest lesson from Spec B: review feedback caught two Critical bugs (infinite-loop `jumpTo`, EventLog `nextId` divergence after truncate) and several Important ones (dual-pause, missing test 5.7, double-jumpTo on handle click). Don't skip the code-quality review pass — it pays for itself.
