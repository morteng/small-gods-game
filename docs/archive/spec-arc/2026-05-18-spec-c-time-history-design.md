# Spec C (minimal) — Time History Strip + Spec B Followups

**Status:** Design, 2026-05-18
**Branch:** to be cut from `main` after PR #5 merges
**Predecessor:** [Spec B (Time)](./2026-05-17-spec-b-time-design.md)

## Goal

A small, focused next chunk that closes out Spec B's known follow-ups and then ships a deliberately *minimal* version of Spec C — a clickable history strip of past commits and player actions — without the parallel-universe branching the full Spec C envisioned. After this lands, the project pauses Spec-track work and turns to rendering improvements.

Full branching (parallel universes, branch identity, lineage UI) is deferred. The `DiscardedTail` capture from Spec B remains in place and unchanged; minimal C does not consume it.

## Scope

### §1. Spec B follow-ups

Three small cleanups carried over from PR #5 review:

1. **Retire `state.paused`** as the source of truth. Today there are two pause mechanisms: legacy `state.paused` (banner-toggle, unreachable via keyboard since Spec B) and `scheduler.setRate(0)` (canonical, what the Time chip shows and Space toggles). Route the pause banner off `scheduler.getRate() === 0` and remove the `state.paused` field and all reads of it. Future branch/time work will want one truth.

2. **Text-input focus guard in `attachTimeKeys`** (`src/ui/controls.ts`). Space currently toggles pause even when the user is typing in the settings API-key input. The guard skips key handling when `document.activeElement` is an `<input>`, `<textarea>`, or has `contenteditable`.

3. **`NpcMovementSystem` cooldown math** (`src/sim/systems/npc-movement-system.ts`). It consumes `ctx.dt` (the per-frame accumulator remainder) rather than the per-tick interval, which means non-standard step sizes diverge between live and silent replay. Fix to consume the configured `intervalMs` so silent replay matches live exactly regardless of step size. The existing `commit-no-reroll-equivalence` test gets a stricter variant that runs at a non-default rate.

### §2. Time History Strip

A horizontal row of chips above the existing time-bar transport row. Each chip is a past moment the player can jump back to.

#### Architecture

- **New file:** `src/ui/panels/time-history.ts` (~150 LOC). Exports `mountTimeHistory(container, deps): TimeHistoryHandle` with `refresh()` and `dispose()` like the existing panels.
- **Mounted by:** `mountTimeBar` in `src/ui/panels/time-bar.ts`. The history row is inserted at the top of the time-bar root, above `buildMainRow` (and above the commit row when present).
- **No new module dir.** The strip is a single UI panel; no `core/`-layer file is needed.

#### Data source: extend the event log

Add a new `SimEvent` variant to `src/core/events.ts`:

```ts
| { type: 'timeline_commit'; parentTick: number; rerolled: boolean }
```

Modify `TimelineController.commit()` in `src/core/timeline.ts` to `append` a `timeline_commit` event into the live `eventLog` after `truncateAfter(cutoff)` and after RNG reroll. The event's `t` will be `cutoff` (the current clock tick). This gives the strip one uniform subscription source and means commits become first-class log entries that survive snapshot/restore.

The strip subscribes via `eventLog.subscribe(fn)`, filters for `type ∈ {timeline_commit, whisper}`, and renders one chip per matching event. On mount it backfills from `eventLog.since(0)` with the same filter.

#### Chip rendering

- **Content:** small inline icon (▼ for commit, ≈ for whisper) + the calendar shorthand for the event's tick (e.g., `▼ 48/96`, `≈ Y1 spring 34/96`). Use the existing `formatCalendar(t)` helper from `src/core/calendar.ts`.
- **Order:** chronological left → right. Most recent on the right.
- **Auto-scroll:** on new chip append, the strip scrolls to the right edge so the newest chip is visible. If the user has manually scrolled left in the last 2 seconds, suppress auto-scroll until they scroll back.
- **Current-playhead indicator:** the chip whose tick is the greatest `≤` the current playhead tick gets a subtle accent outline (use `--accent` from `tokens.css`). Updates via the existing `refresh()` callback the time bar already calls each animation frame.

#### Click behavior

`onclick(chip)` → `deps.timeline.jumpTo(entry.tick)`. That's it. The existing past-veil overlay and commit row appear exactly as they do for scrub-track clicks. No new flow, no new state machine. The user can then commit, re-roll, or return-to-live from the existing commit row.

#### Truncation on commit

When `TimelineController.commit({reroll})` runs, the strip's subscription will receive a `timeline_commit` event at `t = parentTick`. The strip handles truncation declaratively: before adding the new chip, drop every chip whose `tick > parentTick`. (Equivalently: rebuild from `eventLog.since(0)` filtered — same result, cheaper to just splice.) This mirrors what the scrub track does to its event glyphs.

#### Capacity

Soft cap: keep the most recent 50 chips. Older ones drop silently. The cap is enforced on render — the DOM holds at most 50 chip elements. Long sessions don't accumulate unbounded DOM.

### §3. Out of scope (deferred)

- Parallel branches as first-class objects (`Branch` entity, `branches` registry).
- Branch identity (names, lineage, parent pointers between branches).
- A branches panel / fourth corner chip.
- Persistence of any kind (history is in-memory and resets on reload).
- Visual branch markers on the scrub track. Plain event glyphs only.
- Saving the discarded tail to disk. The in-memory `DiscardedTail[]` keeps growing as today; this spec doesn't touch it.

## Testing

### Spec B follow-ups

- **Unit:** `state.paused` removal — grep proves zero references; banner shows when `scheduler.getRate() === 0`, hides when rate > 0.
- **DOM:** text-input guard — fake an `<input>` focus, dispatch keydown Space, assert `scheduler.setRate` was not called.
- **Integration:** strengthen `commit-no-reroll-equivalence.test.ts` with a second case at `setRate(2)` to lock the movement-cooldown fix; expect identical entity positions and faith between live and replay paths.

### Time History Strip

- **Unit (`tests/ui/time-history.test.ts`):**
  - Mounts strip with a mock `eventLog` seeded with `whisper` at t=10 and `timeline_commit` at t=20 → renders two chips with the right labels in chronological order.
  - Click on the t=10 chip calls `deps.timeline.jumpTo(10)` exactly once.
  - Append a `belief_cross` event → no new chip (filtered out).
  - Append a second `timeline_commit` at t=15 → chips with tick > 15 are removed (truncation).
  - Append > 50 chips → only the most recent 50 are in the DOM.
- **DOM (`tests/ui/time-bar.test.ts`):** opening the time bar mounts the history row; dismissing the bar disposes it.
- **Integration (`tests/integration/time-history-end-to-end.test.ts`):** scrub to a past tick → commit({reroll:true}) → history strip drops the future chip and adds a fresh commit chip at the new commit point. Confirm `eventLog.since(0)` contains one `timeline_commit` event at the expected tick.

## Risk and rollback

- Adding `timeline_commit` to the event log changes the `SimEvent` union. Any exhaustive `switch` over events needs a new arm. Grep for `event.type ===` and `switch (event.type)` and update; the TS compiler will catch the rest.
- The strip's subscription leak is the usual one — `dispose()` must call the function returned by `eventLog.subscribe`. Tested.
- If the strip turns out visually too noisy with both commit and whisper chips, narrow to commits-only in a follow-up; the filter is a single line.

## File map

| Purpose | File | Action |
|---|---|---|
| Add `timeline_commit` event variant | `src/core/events.ts` | edit |
| Emit `timeline_commit` from `commit()` | `src/core/timeline.ts` | edit |
| History strip component | `src/ui/panels/time-history.ts` | create |
| Mount strip inside time bar | `src/ui/panels/time-bar.ts` | edit |
| Strip styling | `src/ui/tokens.css` (or `chrome.ts` inline) | edit |
| Retire `state.paused` | `src/core/state.ts`, `src/ui/chrome.ts`, others | edit |
| Text-input guard | `src/ui/controls.ts` (`attachTimeKeys`) | edit |
| Movement cooldown fix | `src/sim/systems/npc-movement-system.ts` | edit |
| Strip unit tests | `tests/ui/time-history.test.ts` | create |
| End-to-end integration | `tests/integration/time-history-end-to-end.test.ts` | create |
| Movement equivalence at rate=2 | `tests/integration/commit-no-reroll-equivalence.test.ts` | edit |

## Definition of done

- All three follow-ups landed; existing 577 tests still green.
- History strip visible above the transport row when the time bar is summoned; chips for past commits and whispers; clicking a chip scrubs to that tick.
- New tests added per the Testing section; full suite green.
- Briefly smoke-tested in the browser: whisper an NPC → chip appears; scrub back → click chip → playhead moves; commit re-roll → strip truncates and a fresh commit chip appears.
- CLAUDE.md "Current Status" line updated to reflect the new state.
