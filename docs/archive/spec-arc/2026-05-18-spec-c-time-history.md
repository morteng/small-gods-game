# Spec C (minimal) Time History Strip + Spec B Follow-ups — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three Spec B follow-ups (text-input focus guard for time keys, NpcMovementSystem cooldown math, retire `state.paused`), then ship a minimal clickable history strip of past commits + whispers above the time-bar transport row.

**Architecture:** The follow-ups are surgical edits to single files each. The history strip is a new UI panel (`src/ui/panels/time-history.ts`) mounted inside the existing `mountTimeBar`, subscribing to `eventLog` for filtered chips. Commits become first-class `timeline_commit` events in the log.

**Tech Stack:** TypeScript ES modules, Vite, Vitest (jsdom for DOM tests), existing `EventLog` / `TimelineController` / `SimClock` infrastructure.

**Spec:** [docs/superpowers/specs/2026-05-18-spec-c-time-history-design.md](../specs/2026-05-18-spec-c-time-history-design.md)

---

## File Structure

| Purpose | File | Action |
|---|---|---|
| Time key handler — add text-input guard | `src/ui/controls.ts` (`attachTimeKeys`, ~line 156) | edit |
| Test: keyboard guard | `tests/dom/time-keys.test.ts` | edit (add cases) |
| NpcMovementSystem — pass fixed interval, not ctx.dt | `src/sim/systems/npc-movement-system.ts` | edit |
| Test: replay equivalence at rate=2 | `tests/integration/commit-no-reroll-equivalence.test.ts` | edit (add case) |
| Retire `state.paused` field | `src/core/state.ts:18,59` | edit |
| Pause banner now sourced from scheduler rate | `src/game.ts:62,143-151,234-237,356,470` | edit |
| Test: banner shows when rate=0, hides when rate>0 | `tests/dom/chrome.test.ts` (or new) | edit/create |
| Add `timeline_commit` SimEvent variant | `src/core/events.ts` | edit |
| Emit `timeline_commit` from `TimelineController.commit()` | `src/core/timeline.ts:89-107` | edit |
| Test: commit appends timeline_commit | `tests/unit/timeline.test.ts` (or wherever timeline lives) | edit/create |
| History strip component | `src/ui/panels/time-history.ts` | create |
| Unit tests for strip | `tests/dom/time-history.test.ts` | create |
| Mount strip inside time bar | `src/ui/panels/time-bar.ts:19-68` | edit |
| End-to-end integration test | `tests/integration/time-history-end-to-end.test.ts` | create |
| Status note update | `CLAUDE.md` (Current Status line) | edit |

Each task ends in a commit. Run `npm test` before each commit; the existing 577 tests must stay green throughout (some grow by additions, none regress).

---

## Task 1: Text-input focus guard in `attachTimeKeys`

**Goal:** Space / T / 1-8 / Esc must not fire when an `<input>`, `<textarea>`, `<select>`, or contenteditable element has focus. Today `attachTimeKeys` ignores focus state, so typing in the settings API-key field accidentally pauses the game when the user hits Space between words.

**Files:**
- Modify: `src/ui/controls.ts:156-181` (`attachTimeKeys`)
- Test: `tests/dom/time-keys.test.ts`

- [ ] **Step 1: Write a failing test**

Add to `tests/dom/time-keys.test.ts`:

```ts
  it('does nothing while a text input is focused', () => {
    const onPause = vi.fn();
    const onToggle = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const detach = attachTimeKeys(window, {
      onToggleTimeBar: onToggle,
      onTogglePause: onPause,
      onSetRate: () => {},
      timeBarOpen: () => true,
      onEscape: () => {},
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));

    expect(onPause).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    detach();
    input.remove();
  });

  it('does nothing while a contenteditable element is focused', () => {
    const onPause = vi.fn();
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();

    const detach = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause: onPause,
      onSetRate: () => {},
      timeBarOpen: () => false,
      onEscape: () => {},
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onPause).not.toHaveBeenCalled();

    detach();
    div.remove();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dom/time-keys.test.ts`
Expected: the two new cases FAIL — `expected "spy" not to be called`.

- [ ] **Step 3: Implement the guard**

The file already exports a private `isTextInputFocused()` helper at the top (lines 20-27) used by `attachControls`. Reuse it. In `attachTimeKeys`, add a guard at the very top of `handler`:

Modify `src/ui/controls.ts:156-178` (the `attachTimeKeys` function). The `handler` callback (line 157) currently starts:

```ts
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 't' || e.key === 'T') {
```

Change it to:

```ts
  const handler = (e: KeyboardEvent): void => {
    if (isTextInputFocused()) return;
    if (e.key === 't' || e.key === 'T') {
```

No other changes needed — `isTextInputFocused` is already in the file's module scope.

- [ ] **Step 4: Run the full time-keys test file**

Run: `npx vitest run tests/dom/time-keys.test.ts`
Expected: all tests PASS (including the two existing ones; the guard does not break the focus-less default case because `document.activeElement` defaults to `<body>` which is not in `TEXT_INPUT_TAGS` and is not contenteditable).

- [ ] **Step 5: Run full suite to confirm no regression**

Run: `npm test`
Expected: 577 (existing) + 2 (new) = 579 passing.

- [ ] **Step 6: Commit**

```bash
git add src/ui/controls.ts tests/dom/time-keys.test.ts
git commit -m "fix(time-keys): ignore Space/T/digits while text input focused

Carry-over follow-up from Spec B PR #5. Typing in the settings
API-key field no longer pauses the game on Space."
```

---

## Task 2: `NpcMovementSystem` consumes the per-tick interval, not `ctx.dt`

**Goal:** `NpcMovementSystem.tick` currently passes `ctx.dt` (the accumulator value the scheduler hands in; ≥ the system's interval and possibly larger) to `tickNpcMovementEntities`. That causes per-tick cooldown decrements to vary with frame timing and rate scaling, which diverges from silent replay (which always uses `SIM_STEP_MS`). Fix by passing the system's own fixed interval (`1000 / tickHz` = ~16.67 ms at 60 Hz) every tick.

**Background:** `Scheduler.tick` (src/core/scheduler.ts:49-58) loops while `acc >= interval` and passes `dt: acc` into each system. The system is supposed to advance one canonical interval per call, so the right per-call dt is `interval`, not the residual `acc`.

**Files:**
- Modify: `src/sim/systems/npc-movement-system.ts`
- Test: `tests/integration/commit-no-reroll-equivalence.test.ts`

- [ ] **Step 1: Read the existing equivalence test**

Open `tests/integration/commit-no-reroll-equivalence.test.ts` and skim it. The current case uses the default rate (1×). Find the inner block that runs the live scheduler vs the silent replay and asserts equality of entity positions (and other state). The new case adds the same flow at `scheduler.setRate(2)`.

- [ ] **Step 2: Add a failing test at rate=2**

In the same test file, add a second `it(...)` block (or extend the existing test with an additional rate). Pseudocode shape — adapt to the file's helpers:

```ts
  it('replay at rate=2 produces identical entity positions to live (no reroll)', () => {
    const { state, scheduler, timeline } = setupGame(/* seed: 42 */);
    scheduler.setRate(2);
    // run live for N frames
    for (let i = 0; i < 120; i++) scheduler.tick(16, baseCtx(state));
    const liveSnap = captureSnapshot(state);

    // restore to start, replay silently to the same tick
    restoreSnapshot(state, /* tick-zero snapshot */ start);
    timeline.jumpTo(state.clock.now() /* same final tick as liveSnap.t */);
    const replaySnap = captureSnapshot(state);

    expect(npcPositions(replaySnap)).toEqual(npcPositions(liveSnap));
  });
```

**Important:** Read what the existing test in the file actually does and mirror it precisely — the helpers (`setupGame`, `baseCtx`, `npcPositions`, etc) already exist in some form. If you can't find a direct analogue, copy the existing `it(...)` block, set `scheduler.setRate(2)` immediately after construction, and assert the same equalities.

- [ ] **Step 3: Run the new test to verify it fails**

Run: `npx vitest run tests/integration/commit-no-reroll-equivalence.test.ts`
Expected: the new case FAILs — positions differ because live consumes `ctx.dt = ~33ms` per movement tick while silent replay uses 16.67ms.

- [ ] **Step 4: Fix the system**

Modify `src/sim/systems/npc-movement-system.ts`. Today it is:

```ts
import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { tickNpcMovementEntities } from '@/sim/npc-movement';

export class NpcMovementSystem implements System {
  readonly name = 'npc_movement';
  readonly tickHz = 60;

  constructor(private getMap: () => GameMap | null) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    if (!map) return;
    tickNpcMovementEntities(ctx.world, map, ctx.dt, ctx.rng);
  }
}
```

Replace the file with:

```ts
import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { tickNpcMovementEntities } from '@/sim/npc-movement';

export class NpcMovementSystem implements System {
  readonly name = 'npc_movement';
  readonly tickHz = 60;
  private readonly intervalMs = 1000 / this.tickHz;

  constructor(private getMap: () => GameMap | null) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    if (!map) return;
    // Pass the canonical per-tick interval, NOT ctx.dt. The scheduler hands us
    // the accumulator (which can exceed `interval` when frame timing or rate
    // scaling spikes). Silent replay always advances by SIM_STEP_MS per tick;
    // using the fixed interval here keeps live and replay bit-identical.
    tickNpcMovementEntities(ctx.world, map, this.intervalMs, ctx.rng);
  }
}
```

- [ ] **Step 5: Run the test file again**

Run: `npx vitest run tests/integration/commit-no-reroll-equivalence.test.ts`
Expected: both cases PASS (original 1× + new 2×).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: no regressions. If any unit test asserts that the movement system was called with a particular `dtMs`, update it to expect `1000 / 60`.

- [ ] **Step 7: Commit**

```bash
git add src/sim/systems/npc-movement-system.ts tests/integration/commit-no-reroll-equivalence.test.ts
git commit -m "fix(npc-movement): consume fixed per-tick interval, not ctx.dt

Silent replay uses SIM_STEP_MS per tick. Live was using ctx.dt
(the scheduler accumulator), which exceeds the system interval
under rate>1 or frame-timing spikes, causing position drift
between live and replay. Adds a rate=2 case to the equivalence
test that locks this in."
```

---

## Task 3: Retire `state.paused`; banner reads from `scheduler.getRate()`

**Goal:** Eliminate the dual pause source of truth. Today `togglePause` flips `state.paused` and shows the banner, but the Time chip and Space-key path use `scheduler.setRate(0)`. They're independent: pause via banner ≠ pause via Time chip. Remove the field entirely and route the banner off `scheduler.getRate() === 0`.

**Files:**
- Modify: `src/core/state.ts` (remove `paused: boolean` field at line 18 and the initializer at line 59)
- Modify: `src/game.ts` (replace four reads/writes at lines 235, 236, 356, 470 and update `togglePause` at 234-237)
- Test: `tests/dom/chrome.test.ts` (or new `tests/dom/pause-banner.test.ts`)

- [ ] **Step 1: Map every `state.paused` reference**

Run: `grep -rn "state\.paused\|\.paused\b" src/ tests/`
Expected output should match what we already know: src/game.ts lines 235, 236, 356, 470 + src/core/state.ts lines 18, 59. If `grep` surfaces anything else, include it in the changes below.

- [ ] **Step 2: Write a failing test**

Create `tests/dom/pause-banner.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '@/game';

describe('pause banner', () => {
  let container: HTMLElement;
  let game: Game;

  beforeEach(() => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    game = new Game(container);
  });

  it('is hidden by default (rate=1)', () => {
    const banner = container.querySelector('div') /* refine selector if Game tags banner */;
    // The banner is the element whose textContent === 'PAUSED'.
    const el = Array.from(container.querySelectorAll('div')).find(d => d.textContent === 'PAUSED');
    expect(el?.style.display).not.toBe('block');
  });

  it('shows when scheduler.setRate(0) is called', () => {
    // Access via Game's public surface; if no public method, use the internal
    // scheduler getter the test infra exposes for the existing time-bar tests.
    game['scheduler'].setRate(0);
    // Drive one RAF / refresh tick so the banner updates.
    (game as any).refreshPauseBanner?.();
    const el = Array.from(container.querySelectorAll('div')).find(d => d.textContent === 'PAUSED');
    expect(el?.style.display).toBe('block');
  });

  it('hides when scheduler.setRate(1) is called', () => {
    game['scheduler'].setRate(0);
    (game as any).refreshPauseBanner?.();
    game['scheduler'].setRate(1);
    (game as any).refreshPauseBanner?.();
    const el = Array.from(container.querySelectorAll('div')).find(d => d.textContent === 'PAUSED');
    expect(el?.style.display).not.toBe('block');
  });
});
```

Note: the test assumes `Game` exposes a `refreshPauseBanner()` helper. If it doesn't yet, the next step adds one (and the RAF loop will call it). If `Game` already refreshes the banner in `render()` or per-frame, adapt the test to call that method instead.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/dom/pause-banner.test.ts`
Expected: FAIL (banner does not yet auto-reflect scheduler rate).

- [ ] **Step 4: Remove `paused` from state**

Edit `src/core/state.ts` line 18 (remove `paused: boolean;`) and line 59 (remove `paused: false,`).

- [ ] **Step 5: Rewire `Game` to drive the banner from scheduler rate**

Edit `src/game.ts`:

1. **togglePause** (lines 234-237) — change to set rate via scheduler:

```ts
  private togglePause(): void {
    const paused = this.scheduler.getRate() === 0;
    this.scheduler.setRate(paused ? 1 : 0);
    this.refreshPauseBanner();
  }

  private refreshPauseBanner(): void {
    this.pausedBanner.style.display = this.scheduler.getRate() === 0 ? 'block' : 'none';
  }
```

2. **RAF loop guard** (line 356) — change `!this.state.paused && this.state.world && !this.timeline.isScrubbed` to `this.scheduler.getRate() > 0 && this.state.world && !this.timeline.isScrubbed`. (Scheduler rate=0 already short-circuits ticks inside the scheduler, but the explicit guard skips the `updateNpcFrames` presentation animation and `onAfterLiveTick` snapshot bookkeeping, preserving current behavior.)

3. **Debug HUD** (line 470) — change `paused: this.state.paused,` to `paused: this.scheduler.getRate() === 0,`.

4. **Per-frame banner refresh** — in the RAF loop (around line 369 where `this.timeChip.refresh()` is called), add `this.refreshPauseBanner();` so external changes to scheduler rate (Time chip, Space key) also update the banner. Place immediately after `this.timeChip.refresh();`.

- [ ] **Step 6: Run the banner test**

Run: `npx vitest run tests/dom/pause-banner.test.ts`
Expected: all three cases PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: any tests that read or wrote `state.paused` fail; replace the usage with `scheduler.setRate(0)` / `scheduler.getRate() === 0` in those tests. Re-run until green.

- [ ] **Step 8: Verify nothing references `state.paused` anymore**

Run: `grep -rn "state\.paused\|\.paused\b" src/ tests/ | grep -v node_modules`
Expected: zero matches.

- [ ] **Step 9: Commit**

```bash
git add src/core/state.ts src/game.ts tests/dom/pause-banner.test.ts
# Plus any test files updated for the new API.
git commit -m "refactor(pause): single source of truth via scheduler.getRate()

Removes state.paused. The pause banner now reflects
scheduler.getRate() === 0, matching what the Time chip displays
and what the Space key controls. Closes the Spec B dual-pause
follow-up."
```

---

## Task 4: Add `timeline_commit` event variant + emit from `TimelineController.commit()`

**Goal:** Make commits visible in the canonical event log. This is the data foundation the history strip will read from.

**Files:**
- Modify: `src/core/events.ts` (add SimEvent variant)
- Modify: `src/core/timeline.ts` (`commit` method, lines 89-107)
- Test: `tests/unit/timeline.test.ts` if it exists; otherwise create `tests/unit/timeline-commit-event.test.ts`

- [ ] **Step 1: Locate existing timeline tests**

Run: `find tests -name "*timeline*" -type f`
If a `tests/unit/timeline.test.ts` (or similar) exists, add to it. Otherwise create `tests/unit/timeline-commit-event.test.ts`. The rest of this task assumes the new-file path; adapt as needed.

- [ ] **Step 2: Write a failing test**

Create `tests/unit/timeline-commit-event.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createInitialState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';

describe('TimelineController.commit() emits timeline_commit event', () => {
  function setup() {
    const state = createInitialState(/* whatever args createInitialState takes */);
    const scheduler = new Scheduler();
    const timeline = new TimelineController(state, scheduler);
    return { state, scheduler, timeline };
  }

  it('appends a timeline_commit event at the cutoff tick when committing a scrubbed timeline', () => {
    const { state, timeline } = setup();
    // Advance the clock by a few sim ticks first so commit has something to truncate.
    state.clock.advance(100);
    timeline.onAfterLiveTick();   // capture a baseline snapshot if required
    state.clock.advance(100);
    timeline.onAfterLiveTick();
    // Scrub back, then commit without reroll.
    timeline.jumpTo(100);
    timeline.commit({ reroll: false });

    const events = state.eventLog.since(0);
    const commitEvents = events.filter(e => e.event.type === 'timeline_commit');
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0].t).toBe(100);
    expect((commitEvents[0].event as any).parentTick).toBe(100);
    expect((commitEvents[0].event as any).rerolled).toBe(false);
  });

  it('records rerolled:true when committing with reroll', () => {
    const { state, timeline } = setup();
    state.clock.advance(100);
    timeline.onAfterLiveTick();
    state.clock.advance(100);
    timeline.onAfterLiveTick();
    timeline.jumpTo(100);
    timeline.commit({ reroll: true });

    const last = state.eventLog.since(0).at(-1)!;
    expect(last.event.type).toBe('timeline_commit');
    expect((last.event as any).rerolled).toBe(true);
  });
});
```

Adapt `createInitialState` / `Scheduler` / `TimelineController` constructor signatures by reading the actual files first — the test file shape is the goal; signatures must match what the codebase exposes.

- [ ] **Step 3: Run it to confirm failure**

Run: `npx vitest run tests/unit/timeline-commit-event.test.ts`
Expected: FAIL — `expected length 0 to be 1` (or a TS error if `timeline_commit` isn't a known event type).

- [ ] **Step 4: Add the SimEvent variant**

In `src/core/events.ts` (the `SimEvent` union starting at line 5), add the new variant. Insert before `system_error` so the union stays grouped:

```ts
  | { type: 'timeline_commit';    parentTick: number; rerolled: boolean }
  | { type: 'system_error';       system: string; message: string };
```

- [ ] **Step 5: Emit the event from `TimelineController.commit()`**

Edit `src/core/timeline.ts` lines 89-107. Current body:

```ts
  commit(opts: { reroll: boolean }): void {
    if (!this._isScrubbed) return;
    const cutoff = this.state.clock.now();
    const tail = this.state.eventLog.since(0).filter(e => e.t > cutoff);
    this.discardedFutures.push({
      parentTick: cutoff,
      events: tail,
      rerolled: opts.reroll,
    });
    this.state.eventLog.truncateAfter(cutoff);
    this.store.truncateAfter(cutoff);
    if (opts.reroll) {
      const newSeed = this.state.rng.nextInt(0x7fffffff);
      this.state.rng = createRng(newSeed);
    }
    this.liveSnapshot = null;
    this._isScrubbed = false;
    this.lastSnapshotEventCount = this.state.eventLog.size();
  }
```

Replace with (changed lines: add `append` call after RNG reroll, before `this.liveSnapshot = null`; recompute `lastSnapshotEventCount` from the now-larger log):

```ts
  commit(opts: { reroll: boolean }): void {
    if (!this._isScrubbed) return;
    const cutoff = this.state.clock.now();
    const tail = this.state.eventLog.since(0).filter(e => e.t > cutoff);
    this.discardedFutures.push({
      parentTick: cutoff,
      events: tail,
      rerolled: opts.reroll,
    });
    this.state.eventLog.truncateAfter(cutoff);
    this.store.truncateAfter(cutoff);
    if (opts.reroll) {
      const newSeed = this.state.rng.nextInt(0x7fffffff);
      this.state.rng = createRng(newSeed);
    }
    // Make the commit visible in the canonical event log so the time history
    // strip (and any future consumer) has one source of truth. Append AFTER
    // truncate so the event's tick is the cutoff and it isn't immediately
    // truncated by itself; subscribers fire after both side-effects.
    this.state.eventLog.append({
      type: 'timeline_commit',
      parentTick: cutoff,
      rerolled: opts.reroll,
    });
    this.liveSnapshot = null;
    this._isScrubbed = false;
    this.lastSnapshotEventCount = this.state.eventLog.size();
  }
```

- [ ] **Step 6: Run the new test**

Run: `npx vitest run tests/unit/timeline-commit-event.test.ts`
Expected: both cases PASS.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: any `switch (event.type)` site that wants exhaustive matching breaks. Search:

Run: `grep -rn "switch.*event\.type\|case 'system_error'" src/ tests/`

For each exhaustive switch, add a `case 'timeline_commit':` arm (usually a no-op or label like `'timeline commit'`). The renderer's event-glyph map (`src/ui/panels/time-bar.ts:102-108` `TYPE_TO_GLYPH`) does **not** need a new entry — the strip handles commit visuals, not the scrub track.

Re-run `npm test` until green.

- [ ] **Step 8: Commit**

```bash
git add src/core/events.ts src/core/timeline.ts tests/unit/timeline-commit-event.test.ts
# Plus any switch-arm files touched.
git commit -m "feat(timeline): emit timeline_commit event when commit() runs

Adds SimEvent variant {type:'timeline_commit',parentTick,rerolled}
and appends one to the live event log inside TimelineController
.commit() after the truncate. Enables the upcoming time-history
strip to subscribe to one source of truth for commits and player
actions."
```

---

## Task 5: TimeHistory strip component (unit tests + implementation)

**Goal:** A standalone UI module exposing `mountTimeHistory(container, deps) → { refresh, dispose }` that renders a row of clickable chips for `timeline_commit` and `whisper` events in chronological order.

**Files:**
- Create: `src/ui/panels/time-history.ts`
- Create: `tests/dom/time-history.test.ts`

- [ ] **Step 1: Sketch the public interface and write failing tests**

Create `tests/dom/time-history.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeHistory } from '@/ui/panels/time-history';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';

function makeDeps(overrides: Partial<{ clockNow: number }> = {}) {
  const clock = new SimClock();
  if (overrides.clockNow != null) clock.advance(overrides.clockNow);
  const eventLog = new EventLog(clock);
  const timeline = {
    jumpTo: vi.fn(),
    get currentTick() { return clock.now(); },
  };
  return { eventLog, timeline, clock };
}

function makeContainer(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return c;
}

describe('mountTimeHistory', () => {
  it('renders one chip per whisper and timeline_commit event in chronological order', () => {
    const deps = makeDeps();
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any });
    deps.clock.advance(10);  // tick 20
    deps.eventLog.append({ type: 'timeline_commit', parentTick: 20, rerolled: false });
    deps.clock.advance(10);  // tick 30
    deps.eventLog.append({ type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);

    const chips = c.querySelectorAll('.sg-time-history__chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain('10');
    expect(chips[1].textContent).toContain('20');
    expect(chips[2].textContent).toContain('30');
    handle.dispose();
    c.remove();
  });

  it('filters out non-relevant events (e.g. belief_cross)', () => {
    const deps = makeDeps();
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'belief_cross', npcId: 'n1' as any, spiritId: 'player' as any, kind: 'high', faith: 0.8 });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(0);
    handle.dispose();
    c.remove();
  });

  it('clicking a chip calls timeline.jumpTo with the chip tick', () => {
    const deps = makeDeps();
    deps.clock.advance(42);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    const chip = c.querySelector('.sg-time-history__chip') as HTMLElement;
    chip.click();
    expect(deps.timeline.jumpTo).toHaveBeenCalledTimes(1);
    expect(deps.timeline.jumpTo).toHaveBeenCalledWith(42);
    handle.dispose();
    c.remove();
  });

  it('appends a new chip when a relevant event is appended after mount', () => {
    const deps = makeDeps();
    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(0);

    deps.clock.advance(15);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(1);
    handle.dispose();
    c.remove();
  });

  it('drops chips whose tick > parentTick on timeline_commit', () => {
    const deps = makeDeps();
    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    deps.clock.advance(20);  // tick 30
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    deps.clock.advance(20);  // tick 50
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });

    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(3);

    // Simulate a commit at parentTick 25 (between chips at 10 and 30).
    deps.eventLog.append({ type: 'timeline_commit', parentTick: 25, rerolled: false });

    // After truncation: chip at 10 survives, chips at 30 and 50 drop, plus the new commit chip at 50 (current clock tick).
    const chips = c.querySelectorAll('.sg-time-history__chip');
    // Expected: chip at 10 (whisper) + chip at 50 (timeline_commit).
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('10');
    expect(chips[1].textContent).toMatch(/commit|▼/i);
    handle.dispose();
    c.remove();
  });

  it('caps the chip list at 50 entries (oldest dropped)', () => {
    const deps = makeDeps();
    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    for (let i = 0; i < 60; i++) {
      deps.clock.advance(1);
      deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    }
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(50);
    // The first surviving chip should be the one at tick 11 (chips 1..10 dropped).
    const first = c.querySelector('.sg-time-history__chip');
    expect(first!.textContent).toContain('11');
    handle.dispose();
    c.remove();
  });

  it('dispose() unsubscribes from the event log', () => {
    const deps = makeDeps();
    const c = makeContainer();
    const handle = mountTimeHistory(c, deps as any);
    handle.dispose();

    deps.clock.advance(10);
    deps.eventLog.append({ type: 'whisper', spiritId: 'p' as any, npcId: 'n' as any });
    // The strip has been removed; even if it left subscriptions, nothing crashes,
    // and no new DOM appears in the (now-detached) container.
    expect(c.querySelectorAll('.sg-time-history__chip')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run tests/dom/time-history.test.ts`
Expected: FAIL — module `@/ui/panels/time-history` does not exist.

- [ ] **Step 3: Implement the strip**

Create `src/ui/panels/time-history.ts`:

```ts
import type { EventLog, AppendedEvent } from '@/core/events';

export interface TimeHistoryDeps {
  eventLog: EventLog;
  timeline: { jumpTo(tick: number): void; readonly currentTick: number };
}

export interface TimeHistoryHandle {
  refresh(): void;
  dispose(): void;
}

const RELEVANT_TYPES = new Set(['timeline_commit', 'whisper']);
const MAX_CHIPS = 50;

interface ChipEntry {
  tick: number;
  type: 'timeline_commit' | 'whisper';
  el: HTMLElement;
}

export function mountTimeHistory(container: HTMLElement, deps: TimeHistoryDeps): TimeHistoryHandle {
  const root = document.createElement('div');
  root.className = 'sg-time-history';
  root.setAttribute('role', 'list');
  root.setAttribute('aria-label', 'Time history');
  container.appendChild(root);

  let chips: ChipEntry[] = [];

  function buildChip(ev: AppendedEvent): ChipEntry | null {
    const t = ev.event.type;
    if (t !== 'timeline_commit' && t !== 'whisper') return null;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sg-time-history__chip';
    el.setAttribute('role', 'listitem');
    el.dataset.tick = String(ev.t);
    el.dataset.kind = t;
    const icon = t === 'timeline_commit' ? '▼' : '≈';
    const label = t === 'timeline_commit' ? 'commit' : 'whisper';
    el.textContent = `${icon} ${label} ${ev.t}`;
    el.title = `${label} at tick ${ev.t} — click to scrub`;
    el.addEventListener('click', () => deps.timeline.jumpTo(ev.t));
    return { tick: ev.t, type: t, el };
  }

  function append(entry: ChipEntry) {
    chips.push(entry);
    root.appendChild(entry.el);
    // Cap at MAX_CHIPS — drop oldest.
    while (chips.length > MAX_CHIPS) {
      const dropped = chips.shift()!;
      dropped.el.remove();
    }
  }

  function truncateAfter(parentTick: number) {
    chips = chips.filter(c => {
      if (c.tick > parentTick) {
        c.el.remove();
        return false;
      }
      return true;
    });
  }

  function ingest(ev: AppendedEvent) {
    if (ev.event.type === 'timeline_commit') {
      // Truncate BEFORE appending the commit chip itself so the commit chip survives.
      truncateAfter(ev.event.parentTick);
    }
    const chip = buildChip(ev);
    if (chip) append(chip);
  }

  // Backfill from existing log.
  for (const ev of deps.eventLog.since(0)) ingest(ev);

  // Subscribe for new events.
  const unsubscribe = deps.eventLog.subscribe(ingest);

  return {
    refresh() {
      // Future: update current-playhead accent. Spec C minimal leaves visual
      // current-tick highlighting to a follow-up — chips are clickable
      // regardless.
    },
    dispose() {
      unsubscribe();
      root.remove();
    },
  };
}
```

Add styling. Inspect `src/ui/tokens.css` for variable names; add to it or to the time-bar CSS file (whichever is where `.sg-time-bar` styles live). Minimal styling:

```css
.sg-time-history {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 4px 8px;
  scrollbar-width: thin;
}

.sg-time-history__chip {
  flex: 0 0 auto;
  background: var(--bg-2, rgba(255,255,255,0.05));
  color: var(--ink-1, #cbd5e1);
  border: 1px solid var(--bg-3, rgba(255,255,255,0.1));
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}

.sg-time-history__chip:hover {
  background: var(--bg-3, rgba(255,255,255,0.12));
}
```

Confirm the CSS file path and var names by reading `src/ui/tokens.css` first; use whatever variable names that file already defines.

- [ ] **Step 4: Run the strip tests**

Run: `npx vitest run tests/dom/time-history.test.ts`
Expected: all 7 cases PASS.

If the "caps at 50" or "drops chips after parentTick" cases fail with off-by-one issues, re-read the test expectations and adjust the implementation; do NOT change the test to match the implementation unless the test itself is wrong.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green; no regressions in existing time-bar tests (strip isn't mounted by the time-bar yet, so no DOM crossover).

- [ ] **Step 6: Commit**

```bash
git add src/ui/panels/time-history.ts src/ui/tokens.css tests/dom/time-history.test.ts
git commit -m "feat(ui): time history strip — clickable chips per commit/whisper

Standalone panel module with full unit coverage: chronological
rendering, event filtering, click → timeline.jumpTo, commit
truncation, 50-chip cap, dispose unsubscribes. Not yet mounted
in the time bar — wired up in the next commit."
```

---

## Task 6: Mount the history strip inside the time bar

**Goal:** The strip is invisible until summoned by the time bar. When the time bar mounts, mount the strip above its main transport row; when the time bar disposes, dispose the strip.

**Files:**
- Modify: `src/ui/panels/time-bar.ts:19-68` (`mountTimeBar`)

- [ ] **Step 1: Add a failing DOM test**

Append to `tests/dom/time-bar-skeleton.test.ts` (or whichever existing time-bar test verifies mounting):

```ts
  it('mounts the time history strip above the main transport row', () => {
    const c = makeContainer();
    const handle = mountTimeBar(c, makeDeps());

    const strip = c.querySelector('.sg-time-history');
    expect(strip).not.toBeNull();

    // The strip should be the first child of the time-bar root; main row second.
    const root = c.querySelector('.sg-time-bar')!;
    expect(root.firstElementChild?.classList.contains('sg-time-history')).toBe(true);

    handle.dispose();
    // Strip should be gone after dispose.
    expect(c.querySelector('.sg-time-history')).toBeNull();
    c.remove();
  });
```

If the existing test file already has `makeContainer` and `makeDeps` helpers, reuse them. Otherwise read one of `tests/dom/time-bar-*.test.ts` to see the pattern and copy what's needed.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/dom/time-bar-skeleton.test.ts`
Expected: FAIL — `.sg-time-history` element does not exist.

- [ ] **Step 3: Wire it up**

Edit `src/ui/panels/time-bar.ts`:

1. **Add the import** at the top (with the others):

```ts
import { mountTimeHistory, type TimeHistoryHandle } from '@/ui/panels/time-history';
```

2. **Mount inside `mountTimeBar`.** After `container.appendChild(root);` (around line 32) and before `let commitRow: HTMLElement | null = null;`, add:

```ts
  const historyHandle: TimeHistoryHandle = mountTimeHistory(root, {
    eventLog: deps.eventLog,
    timeline: deps.timeline,
  });
  cleanups.push(() => historyHandle.dispose());
```

3. **Ensure DOM order.** The strip should be the FIRST child of `root`, above `buildMainRow`. Since the main row was appended on line 30 (`root.appendChild(buildMainRow(deps, cleanups));`) BEFORE container append, and we're appending the strip AFTER, the strip will sit below. Move the strip to the top:

Change the order so `buildMainRow` is appended after `mountTimeHistory`. Specifically, swap the order around lines 29-32:

```ts
  // Before:
  root.appendChild(buildMainRow(deps, cleanups));
  container.appendChild(root);

  // After:
  container.appendChild(root);
  const historyHandle: TimeHistoryHandle = mountTimeHistory(root, {
    eventLog: deps.eventLog,
    timeline: deps.timeline,
  });
  cleanups.push(() => historyHandle.dispose());
  root.appendChild(buildMainRow(deps, cleanups));
```

(The strip is created via `mountTimeHistory` which itself appends to `root`. So the strip lands as the first child of `root`, and the main row lands second. The commit row, when scrubbed, inserts via `root.insertBefore(commitRow, root.firstChild)` — make sure the commit row still lands above the strip; if not desired, change that insertion to `root.insertBefore(commitRow, root.firstChild?.nextSibling ?? null)` so the strip stays on top.)

**Decide commit-row placement:** The cleaner UX is *strip on top, commit row below it but above the main transport row*. To get that:

```ts
// In refreshScrubState, change:
root.insertBefore(commitRow, root.firstChild);
// To:
const mainRow = root.querySelector('.sg-time-bar__row--main');
root.insertBefore(commitRow, mainRow);
```

That places commitRow right before the main row regardless of what other rows exist above it (the strip).

- [ ] **Step 4: Run the time-bar tests**

Run: `npx vitest run tests/dom/time-bar-*.test.ts`
Expected: all pass, including the new mount-and-dispose case.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/panels/time-bar.ts tests/dom/time-bar-skeleton.test.ts
git commit -m "feat(time-bar): mount time history strip above transport row

Strip is the first child of the time-bar root; main row sits
below; commit row inserts just above main when scrubbed. Strip
disposed when the time bar disposes."
```

---

## Task 7: End-to-end integration test

**Goal:** Prove the round trip — whisper → chip appears, scrub → click chip → playhead moves, commit(reroll) → strip truncates and a fresh commit chip lands.

**Files:**
- Create: `tests/integration/time-history-end-to-end.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/time-history-end-to-end.test.ts`:

```ts
/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '@/game';

describe('Spec C minimal — time history strip end to end', () => {
  let container: HTMLElement;
  let game: Game;

  beforeEach(async () => {
    container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);
    game = new Game(container);
    await game.generateWorld?.();   // if Game requires explicit init
  });

  function openTimeBar() {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
  }

  function clickFirstChip() {
    const chip = container.querySelector('.sg-time-history__chip') as HTMLElement | null;
    chip?.click();
  }

  it('whisper appears as a chip in the strip', () => {
    openTimeBar();
    // Trigger a whisper via the public dispatcher. Adapt the call site to the
    // actual game API; the goal is "fire a whisper event with the player's
    // first NPC".
    const npcId = game['state'].world!.query({ kind: 'npc' })[0].id;
    game['dispatcher'].tryDispatch('whisper', { npcId });

    const chips = container.querySelectorAll('.sg-time-history__chip');
    expect(chips.length).toBeGreaterThanOrEqual(1);
    expect(chips[chips.length - 1].textContent).toMatch(/whisper/i);
  });

  it('scrub + commit(reroll) drops post-commit chips and lands a fresh commit chip', () => {
    openTimeBar();

    // Advance some live ticks.
    const tickByMs = (ms: number) => game['scheduler'].tick(ms, {
      world: game['state'].world!,
      spirits: game['state'].spirits,
      log: game['state'].eventLog,
      clock: game['state'].clock,
      rng: game['state'].rng,
    });

    // Whisper at tick ~0, advance ~100 ticks, whisper again at tick ~100.
    const npcId = game['state'].world!.query({ kind: 'npc' })[0].id;
    game['dispatcher'].tryDispatch('whisper', { npcId });
    for (let i = 0; i < 6; i++) tickByMs(16);  // ~96ms ≈ 6 ticks at SIM_STEP_MS
    game['dispatcher'].tryDispatch('whisper', { npcId });

    const beforeChips = container.querySelectorAll('.sg-time-history__chip');
    expect(beforeChips.length).toBe(2);

    // Scrub back to before the second whisper, commit with reroll.
    const earlyTick = (game['state'].eventLog.since(0)[0]).t;
    game['timeline'].jumpTo(earlyTick);
    game['timeline'].commit({ reroll: true });

    const afterChips = container.querySelectorAll('.sg-time-history__chip');
    // Surviving: whisper at earlyTick + new commit chip at earlyTick.
    // Both share the same tick (the cutoff); commit appended after truncate.
    expect(afterChips.length).toBe(2);
    const labels = Array.from(afterChips).map(el => el.textContent ?? '');
    expect(labels.some(l => /whisper/i.test(l))).toBe(true);
    expect(labels.some(l => /commit/i.test(l))).toBe(true);

    // Event log should also reflect a single timeline_commit event.
    const commitEvents = game['state'].eventLog.since(0)
      .filter(e => e.event.type === 'timeline_commit');
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0].t).toBe(earlyTick);
  });
});
```

Adapt the `Game` internals access (`game['state']`, `game['dispatcher']`, etc) to whatever the existing integration tests use. Read `tests/integration/spec-b-smoke.test.ts` first for the pattern.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/integration/time-history-end-to-end.test.ts`
Expected: PASS for both cases on the first try if the unit work is right. If failing, inspect the DOM via `console.log(container.innerHTML)` mid-test and iterate.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: green; total grows by 2 + the earlier additions.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/time-history-end-to-end.test.ts
git commit -m "test(spec-c): time history strip end-to-end smoke

Whisper appears as a chip; scrub + commit(reroll) drops the
post-cutoff chip and adds a fresh commit chip at the new
commit point. Event log contains exactly one timeline_commit
event at the cutoff."
```

---

## Task 8: Browser smoke + CLAUDE.md status update

**Goal:** Confirm the strip works in a real browser, and update the project status note.

- [ ] **Step 1: Run the dev server**

Run: `npm run dev` (it will pick port 3000 or 3001).

- [ ] **Step 2: Manual smoke test**

In the browser:
1. Press `T` to summon the time bar — verify a strip is visible above the transport row (empty if no events yet).
2. Click an NPC, click the Whisper button — verify a `≈ whisper N` chip appears.
3. Press `T` again to dismiss, press `T` to re-summon — verify the strip is still there with the chip (events live in the log; strip rebuilds from `eventLog.since(0)`).
4. Click the scrub track to scrub back to before the whisper — verify the past-veil appears and the commit row appears (between strip and main row).
5. Click "Commit with reroll" — verify the whisper chip vanishes and a new `▼ commit N` chip appears at the cutoff tick.
6. Verify Space toggles pause and the banner shows/hides (Task 3 sanity).
7. Focus the Settings API-key field (press `K` for settings, click the field), press Space — verify the game does NOT pause (Task 1 sanity).

If anything is off, fix it and update relevant tests rather than just patching the symptom.

- [ ] **Step 3: Update CLAUDE.md status line**

Edit the "Current Status" line in `CLAUDE.md` (search for "Current Status:"). Change from:

```
**Current Status:** Spec A (architectural spine) and Spec B (Time) shipped. ... 576 tests passing.
```

To:

```
**Current Status:** Spec A (spine), Spec B (Time), and Spec C (minimal — clickable time history strip) shipped. Sim is fully deterministic with seedable RNG; snapshot/replay layer supports scrub + commit + re-roll; summoned Time bar UI with past-veil scrubbed treatment, clickable history strip of past commits/whispers above the transport row, and keyboard shortcuts T/Space/1/2/4/8/Esc. `state.paused` retired in favor of `scheduler.getRate()`. NPC movement cooldown now uses the canonical per-tick interval. <N> tests passing.
```

Where `<N>` = the final passing count from `npm test`.

Also update the `## Key File Locations` table to add:

```
| Time history strip | `src/ui/panels/time-history.ts` |
```

- [ ] **Step 4: Final full-suite run + commit**

Run: `npm test`
Expected: green.

Run: `npm run build`
Expected: no TS errors, build succeeds.

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md status for Spec C minimal + Spec B follow-ups"
```

- [ ] **Step 5: Push and open PR (optional, ask user first)**

Ask the user whether to push and open a PR, or stop here for review. Default: stop and let the user decide.

---

## Self-Review (run after writing this plan)

- **Spec coverage:** §1.1 (state.paused) → Task 3; §1.2 (text-input guard) → Task 1; §1.3 (movement cooldown) → Task 2; §2 architecture + data source → Task 4; §2 chip rendering + click + truncate + cap → Task 5; §2 mounting in time bar → Task 6; §2 integration test → Task 7; §3 deferred items not implemented (correct); Definition of Done → Task 8. ✓
- **Type consistency:** `mountTimeHistory(container, deps)` returns `{refresh, dispose}` throughout. `TimeHistoryDeps` shape is consistent in Tasks 5 and 6. Event variant `timeline_commit` uses `parentTick: number; rerolled: boolean` consistently in Tasks 4, 5, 7. ✓
- **Placeholders:** None — every code step has actual code; every test step has actual assertions. ✓
- **Risk:** The biggest implementation risk is exhaustive `switch (event.type)` sites that don't currently handle `timeline_commit`. Task 4 step 7 explicitly searches for and updates them. ✓
