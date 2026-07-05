# Round 9 — Time Controls (fastforward + jump-to-next-interesting-event)

**Context.** R8 shipped TRUE 1:1 realtime (`TICKS_PER_DAY = 5,184,000`; a calendar day = 24 real
hours). The game is now genuinely ambient. User directive: add **fastforward** and a
**"jump forward to next interesting event"** control, with pause still working. Second standing
directive (2026-07-05): **all new UI goes through the agent-driven UI system** — controls are
capability-registry Commands rendered as affordances in the WebGPU immediate-mode UI, never
bespoke DOM panels.

## Ground truth (recon 2026-07-05)

- `Scheduler.setRate` has **no upper clamp** (`src/core/scheduler.ts:70`); `SimClock.advance` is
  O(1). Determinism is rate-independent: systems fire off sim-time accumulators in a
  `while (acc >= interval)` catch-up loop (`scheduler.ts:49-58`), so any rate produces the same
  sim — only CPU cost changes.
- **The wall is the 60 Hz systems** (`NpcMovementSystem`, `CommandExecutorSystem`): at rate R they
  run 60·R times per real second, synchronously inside the frame. The 50 ms frame-dt clamp
  (`src/game/frame-loop.ts:94`) clamps REAL dt before the rate multiply — it does NOT bound
  sim work per frame. Naive `setRate(3600)` = frame freeze.
- **No global future-event queue.** Only `after_tick` staged beats
  (`StagingBuffer.armedByTrigger`) and active settlement-event end ticks are known ahead.
  Everything else (prayers, crossings, threads, births/deaths, rival claims) is
  probabilistic/predicate — a next-event jump must **simulate-until-predicate**.
- **Interestingness already exists in two halves**: `FateTrigger.isSignificant`
  (`src/game/fate/fate-trigger.ts:36-46`) and the salience scorer
  (`src/game/affordance/salience.ts:36`, feeding `divineInbox`). Reuse; do not invent a third
  taxonomy.
- `forwardSilent` (timeline) is O(ticks) — never use it to move forward. Closed-form
  `applySkip` (+10/25/50y, `src/sim/time-skip.ts`) is scale-invariant and stays as-is for eras;
  it does NOT surface fine-grained events, so it is the wrong tool for "next event".
- Existing transport chrome is **DOM** (`src/ui/panels/time-bar.ts`, `time-chip.ts`). Per the
  directive, the new transport lives in the WebGPU UI (`src/render/ui/`); the DOM bar keeps
  scrub/timeline authoring for now.
- Two pause concepts stay distinct: **soft pause** = rate 0 (transport control);
  **hard pause** = `FrameLoop.setPaused` (space key, idles CPU/GPU). The new UI drives soft
  pause; space keeps hard pause.

## Design

### Budgeted advance (the fastforward engine)

New `TimeController` (`src/game/time-controller.ts`) owns requested rate + seek state. Each frame
it advances the scheduler in **budgeted slices**: convert requested rate to desired sim-ms, then
run `scheduler.tick` in bounded chunks while `performance.now() - frameStart < SIM_BUDGET_MS`
(~24 ms). If CPU can't deliver the requested rate, the effective rate degrades gracefully
(clock runs slower than requested, never a freeze); surface `effectiveRate` for the UI.
Rate ladder is **measured, not guessed**: a node bench (`scripts/bench-sim-rate.ts`) reports
sustainable × on the default world; ladder presets chosen from that (target: 1× / 8× / 60× /
max-measured, cut to what the bench supports).

### Seek = accelerate-and-watch

`skip_to_next_event`: enter seek mode → budgeted max-throughput advance + subscribe to the
EventLog with an interest predicate = `isSignificant(ev)` ∪ salience-band events
(rival `answer_prayer`, `prayer_contested`-grade threats, `belief_cross`/`mood_cross` only if they
form a new inbox threat, `npc_death`/`npc_birth` of believers, `settlement_*`, `beat_fired`,
`place_flooded`, `site_born`). Stop conditions: predicate fires → land; **horizon** (default 24
game-hours) reached → land with "a quiet day passed"; user cancels (any transport input) →
land immediately. Landing: restore rate 1, emit a summary (elapsed span + the triggering event +
counts of minor events passed over) rendered as a **UiSpec card** — same surface as the whisper
card. While seeking, the HUD shows the clock spinning + elapsed span + a cancel affordance;
rendering continues (throttled cadence is fine).

### Commands, not buttons

Register in the capability registry (remember: the live bus allowlist rejects packs naming
unknown verbs): `set_time_rate { rate }`, `skip_to_next_event { horizonHours? }`,
`cancel_seek {}`. These are **meta commands** — they change how fast the sim advances, not sim
state — so they are flagged replay-excluded (like pause) and must never enter snapshot/replay
streams. Fate and the MCP server get time control for free via the same verbs.

### WebGPU transport cluster

New HUD cluster in `UiRuntime` (`src/render/ui/`): clock/date chip (calendarLabel + effective
rate badge), soft-pause toggle, rate-ladder buttons, **⏭ next event** button, seek progress
line. All dispatch through `UiRuntimeHooks` → the command channel (not direct Game method
calls where a command exists). The DOM `time-chip` is retired (its job moves here); the DOM
`time-bar` stays for scrub/commit/era-skip authoring, with its 1/2/4/8 speed group now calling
the same command path.

## Work packages

- **WP-A (core, Opus):** `TimeController` + budgeted advance + seek engine + interest predicate
  module (`src/game/interest-predicate.ts`, reusing fate-trigger/salience) + command
  registration (replay-excluded) + `scripts/bench-sim-rate.ts` + landing-summary data. Wires
  into `game.ts` frame path (replacing the raw `scheduler.tick` call site at `game.ts:1443`).
  Tests: budget degradation, seek stop conditions (predicate/horizon/cancel), determinism
  (same seed + seek ≡ same seed + realtime over the same span), command gating.
- **WP-B (UI, Sonnet):** WebGPU transport cluster + seek progress + landing UiSpec card +
  DOM time-chip retirement + time-bar speed group rerouted through commands + keybinding
  updates (digits map to the new ladder). Tests per `ui-runtime.test.ts` idiom (hitRegions,
  click-drive).

Interface contract (so A and B run parallel): `TimeController` exposes
`{ setRate(r), getRequestedRate(), getEffectiveRate(), requestSeek(opts), cancelSeek(),
seekStatus(): null | { elapsedTicks, horizonTicks }, onLanded(cb) }`; UI consumes it via new
`UiRuntimeHooks` entries `timeStatus()` / `onTimeCommand(cmd)`. WP-A owns `game.ts` wiring of
the controller; WP-B only touches the `ui.configure({...})` hooks block.

Integration: merge A then B, resolve `game.ts` overlap, server CI gate
(`grep '✓ Server CI passed'` BEFORE push), local build, push (auto-deploys). No WCV bump
(no worldgen change); SAVE_VERSION untouched (seek advances the live world, autosave rides the
existing event-driven persistence).

## Out of scope (named follow-ups)

- Fate-authored landing cards (`onArmed` stretch), era-authoring for closed-form skips
  (Fate depth track), offline catch-up (explicitly "not yet"), migrating scrub/timeline
  authoring into the WebGPU UI, hard-pause unification.
