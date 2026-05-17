# Spec B — Time

**Status:** Draft — complete, pending user review
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
- **Generated imagery surfaces** (NPC portraits, area vistas, god portrait, chapter scenes, `ImageSlot`, `ImageQueueChip`, Vista panel) — covered by the design handoff's Generated-imagery section but owned by a separate AI-imagery track, not Spec B.

## Architecture overview

```
                    ┌──────────────────────────────────┐
                    │ game.ts                          │
                    │  scheduler.tick(dt)              │
                    │  scrubber.render()               │
                    └────────┬──────────────┬──────────┘
                             │              │
              ┌──────────────▼─────┐  ┌─────▼───────────────────┐
              │ Scheduler          │  │ Time chip + Time bar    │
              │  setRate(n) ←──────┼──┤  transport / scrub head │
              │  pause when        │  │  speed buttons          │
              │  scrubbing         │  │  Back / Continue / Try  │
              └────────┬───────────┘  └─────┬───────────────────┘
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

`tests/unit/determinism.test.ts` already proves `NpcSimSystem + SpiritSystem + PerceptionSystem` are deterministic given identical inputs. Adding seedable RNG to `NpcMovementSystem` (Section 3 below) extends that test to cover movement. The test becomes the replay correctness gate.

**Trade-off acknowledged:** the `applyEvent` reducer must stay in sync with every system that emits events. If a system mutates `state` without emitting an event, replay diverges silently. **Mitigation:** add a debug-build assertion that snapshots state-hash after each system tick and compares to applyEvent-only replay; CI flag.

## Section 3 — Seedable world RNG

**Module:** `src/core/rng.ts`

**Algorithm:** **sfc32** (Simple Fast Counter, 32-bit). State is `[u32, u32, u32, u32]` (16 bytes), all operations stay in 32-bit so no BigInt overhead, passes PractRand to 32 TB. The typical JS-game default.

**API**

```ts
export type RngState = readonly [number, number, number, number];

export interface Rng {
  next(): number;                       // [0, 1)
  nextInt(maxExclusive: number): number; // [0, max)
  pick<T>(arr: readonly T[]): T;
  getState(): RngState;
}

export function createRng(seed: number): Rng;
export function fromState(state: RngState): Rng;
```

Implementation ~25 lines. State is captured by value (not closure) so snapshots serialize trivially.

**Integration**

`GameState` grows one field:

```ts
interface GameState {
  // …existing fields…
  rng: Rng;
}
```

Seeded once at world creation from the existing `worldSeed: number` in `schema.ts`. `NpcMovementSystem` migration is a one-line change per call site: `Math.random()` → `state.rng.next()`. A CI grep enforces "no `Math.random()` in `src/sim/`" going forward.

**Re-roll**

When the player commits with re-roll, the new RNG state is derived from the world's own RNG drawn at the scrub tick. Pseudo: `const newSeed = state.rng.nextInt(2**31); state.rng = createRng(newSeed);`. This makes re-rolls reproducible: the same save loaded yields the same re-roll outcome — testers can trust it, the player still experiences it as random.

**Snapshot integration**

`Snapshot.rngState = state.rng.getState()`. Restore via `state.rng = fromState(snap.rngState)`. No special-cased serialization needed.

**Determinism test extension**

```ts
// tests/unit/determinism.test.ts already exists; extend to:
it('movement is deterministic given identical rng seed', () => {
  const a = runScenario({ seed: 42, ticks: 1000 });
  const b = runScenario({ seed: 42, ticks: 1000 });
  expect(a.npcPositions).toEqual(b.npcPositions);
});
```

This becomes the precondition for the replay layer.

## Section 4 — Time UI (the Time chip and the Time bar)

The complete chrome UI is specified in `docs/design/2026-05-17-ui-system-handoff/README.md`. Spec B owns two of the elements in that handoff: the **Time chip** (top-right) and the **Time bar** (summoned, slides up from the bottom). The other chips and panels (Spirit chip, Events chip, Selection card) are not part of Spec B — they're a separate UI Chrome implementation track that can land before, during, or after Spec B as long as the shared design tokens (`tokens.css`) and `Chrome` mount scaffold are in place.

**Tokens prerequisite**

Spec B's UI work depends on `src/ui/tokens.css` being loaded. If it doesn't exist when Spec B starts, the implementation plan adds porting it from `docs/design/2026-05-17-ui-system-handoff/preview/tokens.css` as a leading task. Otherwise Spec B assumes the token palette (`--time`, `--you`, `--w-sun`, `--danger`, `--paper`, `--line`, `--ink*`, `--lift-*`) is available.

### 4.1 Time chip (resting, always visible)

- **Module:** `src/ui/chrome.ts` (chip owns its own mount; chrome owns layout).
- **Anchor:** `top: 18px; right: 18px` (paired with Events chip in same row; Events chip 8px to its left).
- **Content:** `[clock icon] Y1 spring · 30/96  [1×]` when running. When paused: `[pause icon] Y1 spring · 30/96  [paused]`. Tinted `--time` in the paused state.
- **Click:** toggles the Time bar.
- **Hotkey:** `T` toggles, `Space` toggles pause from anywhere.

Source of tick → human label (`Y1 spring · 30/96`): `src/core/calendar.ts` (new helper, ~30 lines; pure function of `clock.now()` and a constant `TICKS_PER_DAY`).

### 4.2 Time bar (summoned)

- **Module:** `src/ui/panels/time-bar.ts` + scoped CSS.
- **Anchor:** `left: 18px; right: 18px; bottom: 18px`. Slide-up via the `sg-fade-up` keyframe (200 ms ease-out, `translateY(4px)` + opacity 0 → 1).
- **Mount lifecycle:** instance is constructed alongside `Chrome` but its DOM only attaches when summoned. Dismiss removes the DOM but keeps the controller subscription alive (cheap; we don't tear down `TimelineController`).

**Live layout (single row):**

```
[◄◄] [▮▮] [►►] ┃ ━━━━━━━●━━━━━━━━━━━━━━━━━━━━━ ┃ 1840 / 1840 ┃ 1× 2× 4× 8× ┃ ×
              transport          scrub track             label         speed   dismiss
```

**Scrubbed layout (commit row prepended on top):**

```
─────────────────────────────────────────────────────────────────
 ● You're looking back to tick 1180.  Change what happens next?
                          [↻ Back to now] [Continue] [Try a different way ↻]
─────────────────────────────────────────────────────────────────
[◄◄] [▮▮] [►►] ┃ ━━━●╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ┃ 1180 / 1840 ┃ 1× 2× 4× 8× ┃ ×
```

### 4.3 Track and scrub head

- Track height 32 px; baseline line 2 px.
- Live-tail portion: solid `--time`.
- Scrubbed-future portion (between scrub head and live tail when scrubbed): 8 px dashed `--line-2`.
- Scrub head: 2 px vertical line + 10 px circular handle with white border.
  - Live: `--you` color.
  - Scrubbed: `--time` color.
- Hover tooltip on track: monospace `tick N`, follows cursor along the track.
- Click empty track → `jumpTo(tick)`. Drag handle → `jumpTo(tick)` continuously.
- Keyboard on focused track: `Left/Right` step by 1 tick; `Shift+Left/Right` step by 50; `Home/End` jump to bounds.

### 4.4 Event glyphs on the track

Rendered as 18×18 rounded squares on the track, color-by-type. The renderable subset (locked in from the design handoff):

| Event type | Glyph token | Color token |
|---|---|---|
| `whisper_cast` | `G.whisper` | `--you` |
| `miracle` | `G.miracle` | `--w-sun` |
| `belief_cross` (rising) | `G.beliefRise` | `--w-sun` |
| `tile_realized` | `G.realize` | `--time` |
| rival action | `G.rival` | `--danger` |
| `mood_cross` | `G.mood` | `--ink-3` |

Chapter-marked events get an additional 4×4 `--time` dot above their glyph. Events past the scrub head (in the scrubbed-future region) render at `0.55` opacity with `--ink-4` border.

Glyphs explicitly **not** on the track: `npc_moved` (never rendered, even if added later), `power_depleted` (covered by the system voice, not narrative; reconsider in Spec E if we want it).

**Glyph density management.** If two glyphs would overlap (`trackWidthPx / maxTick < 4 px` per glyph), merge into a single cluster glyph that expands on hover. Implemented by post-processing the event list into glyph buckets after each `EventLog.subscribe` notification.

### 4.5 Tick label, speed buttons, dismiss

- **Tick label** (right of track): `[current] / [max]`, monospace, current value color matches scrub-head color. Below: `now` (live) or `looking back` (scrubbed).
- **Speed buttons:** `1×` / `2×` / `4×` / `8×`. Active uses `--you-soft` background, `--you-line` border, `--you` color. Pressing the active rate again pauses (Civ/Stellaris convention).
- **Dismiss `×`** on the far right; matches pressing `Esc` or `T`.

### 4.6 Commit row (rendered only when `timeline.isScrubbed`)

- Background `--time-soft`; bottom border `--line`.
- Left: pulsing `--time` dot + the message `You're looking back to tick {N}. Change what happens next?` (13 px `--ink` with `--ink-3` trailing clause).
- Right: three buttons in this order:
  1. **`Back to now`** — ghost. Icon `forwardEnd`. Calls `timeline.returnToLive()`. Returns scrub head to live tail without truncating.
  2. **`Continue`** — default variant. Calls `timeline.commit({ reroll: false })`. Truncates the future, keeps RNG state, replays forward.
  3. **`Try a different way`** — danger variant. Icon `reroll`. Calls `timeline.commit({ reroll: true })`. Truncates, swaps RNG state, replays forward.

### 4.7 Scrubbed-world visual treatment

When `timeline.isScrubbed === true`, the world canvas gets a subtle blue tint via a `.sg-past-veil` overlay div (4 % blue gradient + 1 px scanline texture). The Spirit and Events chips do not change. The Time chip swaps to its paused state. No desaturation — the look stays warm.

### 4.8 Wire-up

```ts
import { TimelineController } from '../core/timeline';

class TimeBar {
  constructor(
    private readonly timeline: TimelineController,
    private readonly scheduler: Scheduler,
    private readonly eventLog: EventLog,
  ) {
    // subscribe; unsubscribe on dismount
    this.eventLog.subscribe((e) => this.addGlyph(e));
  }

  onScrub(targetTick: number) { this.timeline.jumpTo(targetTick); }
  onReturn()                  { this.timeline.returnToLive(); }
  onCommit()                  { this.timeline.commit({ reroll: false }); }
  onReroll()                  { this.timeline.commit({ reroll: true }); }
  onSetRate(rate: number)     { this.scheduler.setRate(rate); }
  onTogglePause()             { /* toggle between current rate and 0 */ }
}
```

### 4.9 File budget for Spec B's UI

| File | Estimated LOC | Notes |
|---|---|---|
| `src/ui/panels/time-bar.ts` | ~300 | Bar + commit row + track + glyph layout |
| `src/ui/chrome.ts` (Time chip section) | ~80 | Just the Time chip if Chrome scaffold exists; otherwise +~120 for the scaffold |
| `src/ui/components/icons.ts` (subset) | ~60 | Only the glyphs Spec B needs: pause, play, rewindEnd, forwardEnd, clock, whisper, miracle, beliefRise, realize, rival, mood, reroll, close |
| Time-bar CSS (in `tokens.css` or a scoped block) | ~120 | |
| `src/core/calendar.ts` | ~30 | tick → `Y1 spring · 30/96` |
| Edits to `src/game.ts` to mount Chrome+TimeBar and wire keyboard | ~25 | |

If the broader Chrome scaffold from the UI handoff hasn't landed yet when Spec B starts, the plan adds a small leading task: stand up `Chrome` + tokens just enough to host the Time chip. The Spirit chip, Events chip, and Selection card stay out of scope.

### 4.10 Plain-copy table (verbatim, from design handoff "Voice & copy" section)

| String | Use |
|---|---|
| `now` / `looking back` | Time-bar state, below the tick label |
| `You're looking back to tick {N}. Change what happens next?` | Commit row prompt |
| `Back to now` | Commit row, button 1 |
| `Continue` | Commit row, button 2 |
| `Try a different way` | Commit row, button 3 |
| `T time · L log · Space pause` | Bottom-left hint pill (hidden when time bar is open) |

## Section 5 — Testing strategy

**Unit-level**

1. **`sfc32` correctness.** Vector test against the algorithm's published reference sequence (seed → first N outputs). Detects regressions in the implementation.
2. **`Rng.getState()` round-trip.** `fromState(rng.getState()).next() === rng.next()` for any number of draws.
3. **`SnapshotStore` ring buffer.** Capacity respected; oldest evicted first; `nearestSnapshot(tick)` returns correct entry.
4. **`applyEvent` reducer parity.** For every `SimEvent` arm, a focused test: emit one event, capture the state diff from the system, capture the state diff from `applyEvent`, assert equal. This is the discipline that keeps replay correct.

**Integration-level**

5. **Determinism (extended).** Existing `tests/unit/determinism.test.ts` already covers `NpcSimSystem + SpiritSystem + PerceptionSystem`. Extend to include `NpcMovementSystem` once it's on `state.rng`. Two runs with the same world seed yield identical NPC positions at tick N.
6. **Scrub round-trip.** Run sim for 500 ticks. Capture state hash. `jumpTo(250)` then `returnToLive()`. Final state hash must equal pre-scrub hash.
7. **Commit + replay forward.** Run to 500. `jumpTo(250)`. `commit({ reroll: false })`. Run forward another 250 ticks. The event log from 250 → 500 must match the original 250 → 500 byte-for-byte (same RNG path).
8. **Re-roll + replay forward.** Same as 7 but `commit({ reroll: true })`. The new event log from 250 → 500 must differ from the original (otherwise the re-roll didn't take effect). And — discarded future at tick 250 contains the original tail.
9. **Snapshot/replay equivalence.** Pure replay from tick 0 (no snapshots) and hybrid replay (with snapshots) must produce identical state at any target tick. Catches `applyEvent` parity bugs early.

**UI/DOM-level**

10. **Time bar mounts on `T`, dismisses on `T` / `Esc` / `×`.** Headless DOM test using JSDOM (matches existing UI tests in this repo).
11. **Commit-row buttons fire the right controller methods.** Spy on `TimelineController.{commit,returnToLive}`.
12. **Speed buttons toggle `aria-checked` correctly and call `scheduler.setRate`.**
13. **Past-veil overlay class toggles in lockstep with `timeline.isScrubbed`.**

**Budget / non-functional**

14. **Snapshot-size sanity.** At a representative mid-game state (say 200 NPCs, ~30 buildings), one snapshot must be < 200 KB. If not, we revisit the serialization (drop indexes, prune view caches, etc.).
15. **Replay speed sanity.** Folding 500 events forward must complete in < 50 ms on the dev machine. If not, snapshot interval `N` is too sparse.

## Open questions

- Snapshot interval `N` — defaulting to 50 events; revisit after measuring real session size.
- Snapshot ring buffer cap — 40; revisit.
- View state on scrub: camera and selection currently stay where the player put them (sticky); confirm or revisit.
- Whether to extend Spec B with a tiny "branches debug panel" that just lists the in-memory discarded futures, or leave that entirely to Spec C.
- Whether the time chip needs to show the `1×` rate badge or whether the badge moves into the time bar only (handoff says: chip shows it).

## Brainstorm decisions log

For future reference, the brainstorm answered:

1. Spec B is the full time-mastery package — scrub, speed, and seed re-roll all carry equal weight.
2. Seed re-roll **replaces** the live timeline (Spec B). Spec C will later add the "keep both timelines and switch" layer on top.
3. **Hybrid** snapshot+replay (snapshots every N events, fold forward from nearest).
4. **Seedable world RNG** owned by `GameState`; not per-system; not movement events.
5. **Bottom bar with event ticks** for scrub UI (refined by the design handoff to: *summoned*, not pinned).
6. **Buttons + keyboard shortcuts** for speed control (canonical 1/2/4/8 rates).
7. **Pause-while-scrubbing**, no truncation until commit; commit replays forward.
8. **Three commit buttons**, not two (refined by the design handoff): `Back to now`, `Continue`, `Try a different way`. RNG is derived from world RNG state at the scrub tick.

## References

- **UI handoff:** `docs/design/2026-05-17-ui-system-handoff/README.md`
- **Spec A (architectural spine):** `docs/superpowers/specs/2026-05-17-spec-a-spine-design.md`
- **Determinism test (precondition):** `tests/unit/determinism.test.ts`

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
