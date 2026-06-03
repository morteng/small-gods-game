# Command Channel + Capability Registry — Implementation Plan

> **For agentic workers:** TDD, bite-sized steps, frequent commits. Spec:
> `docs/superpowers/specs/2026-06-03-command-channel-capability-registry-design.md`.

**Goal:** Build the shared command channel + capability registry (Track 4 #1):
player/rivals/Fate emit verbs onto one deterministic, replay-safe channel gated by
a single registry; revive inert rivals as a side effect.

**Architecture:** Transient `CommandQueue` → `CommandExecutorSystem` (registered
first, 60Hz) drains FIFO → `CAPABILITY_REGISTRY` validates (cost + precondition) →
`apply` delegates to `divine-actions.ts` → `EventLog`. Rivals are non-player
`Spirit`s with an `ai` profile, emitting from a seeded `RivalSystem`.

**Tech Stack:** TypeScript ESM, Vitest, `@/`→`src/`. All new sim code under
`src/sim/` (auto-guarded `Math.random`-free).

---

## Task A — Core types + capability registry

**Files:** Create `src/sim/command/types.ts`, `src/sim/command/registry.ts`,
`tests/unit/command-registry.test.ts`.

- [ ] **A1.** `types.ts`: `CommandVerb`, `CommandTarget`, `Command`,
  `RejectionReason`, `CommandResult`, `CommandCtx` (per spec §3.1/§3.2). Import
  `SpiritId` from `@/core/spirit`, `World`, `Spirit`, `EventLog`.
- [ ] **A2.** Failing test: registry has all 8 verbs; divine verbs `implemented:true`
  with `apply` defined and `cost` matching `divine-actions.ts` constants
  (`WHISPER_COST` etc.); authoring verbs `implemented:false`, no `apply`;
  `listCapabilities()` length 8; `getCapability('whisper')` defined.
- [ ] **A3.** Implement `registry.ts`. Each divine `apply(cmd, ctx)`:
  - resolve `spirit = ctx.spirits.get(cmd.source)`; resolve target;
  - call the matching `divine-actions.ts` fn (whisper/dream/answerPrayer take the
    npc `Entity`; omen/miracle take `poiId` + `ctx.world`); return its boolean.
  - `precondition` for whisper (`npcProps(npc).whisperCooldown > 0`) and
    answer_prayer (`activity !== 'worship'`); resolve target inside, return reason
    or null. `describe` returns a short string.
  - Authoring verbs: `{ tier:'authoring', cost:0, targetKind:'settlement',
    implemented:false, describe }` — no precondition/apply.
- [ ] **A4.** Run `npx vitest run tests/unit/command-registry.test.ts`; green.
- [ ] **A5.** Commit `feat(command): capability registry + command types`.

## Task B — CommandQueue

**Files:** Create `src/sim/command/command-queue.ts`,
`tests/unit/command-queue.test.ts`.

- [ ] **B1.** Failing test: `emit` stamps monotonic `seq` (0,1,2…); `drain` returns
  FIFO and empties; second `drain` returns `[]`; `clear` empties; `size` accurate.
- [ ] **B2.** Implement `CommandQueue` (spec §3.3). `emit(cmd: Omit<Command,'seq'>)`.
- [ ] **B3.** Green; commit `feat(command): transient command queue`.

## Task C — executeCommand + CommandExecutorSystem

**Files:** Create `src/sim/command/command-system.ts`,
`tests/unit/command-system.test.ts`.

- [ ] **C1.** Failing tests (table-driven, build a minimal `World`+`spirits`+`EventLog`
  fixture reusing existing test helpers):
  - `whisper` applied → target npc gains faith in source spirit + `whisper` event
    appended + power spent; equals a direct `whisper()` call on a twin fixture.
  - `insufficient_power` (power 0) → rejected, no mutation.
  - `precondition_failed`: whisper on cooled-down npc; answer_prayer on non-worshipper.
  - each authoring verb → `not_implemented`, no mutation.
  - `invalid_target` (npc verb with settlement target / missing npc), `unknown_source`.
- [ ] **C2.** Implement `executeCommand(cmd, ctx)` per spec §3.3 algorithm (steps 1–7).
- [ ] **C3.** Implement `CommandExecutorSystem` (`name:'command-executor'`,
  `tickHz:60`): `tick(ctx)` → `queue.drain()` → for each, `executeCommand(cmd,
  {world,spirits,log})` → `onResult?.(result)`.
- [ ] **C4.** Integration test: enqueue 3 mixed commands, one `tick`, assert FIFO
  application + results; deterministic.
- [ ] **C5.** Green; commit `feat(command): executor system + executeCommand`.

## Task D — Widen Spirit.ai + rival adapter

**Files:** Modify `src/core/spirit.ts`; create `src/sim/command/rival-adapter.ts`,
`tests/unit/rival-adapter.test.ts`.

- [ ] **D1.** Widen `Spirit.ai` (spec §5): add optional `personality`, `settlements`,
  `lastActionTick`, `actionCooldown`. (Keep `policy`, `cooldowns`.)
- [ ] **D2.** Failing test: `rivalToSpirit(createRivalSpirit(...))` produces a
  non-player `Spirit` with power/color/name + populated `ai`; `spiritToRivalView`
  round-trips the behavioral fields back into a `RivalSpirit` view.
- [ ] **D3.** Implement `rival-adapter.ts`: `rivalToSpirit(r: RivalSpirit): Spirit`
  and `spiritToRivalView(s: Spirit): RivalSpirit | null` (null if no `ai`).
- [ ] **D4.** Green; `npx tsc --noEmit` clean; commit
  `feat(rival): Spirit.ai rival profile + adapter`.

## Task E — RivalSystem + bootstrap instantiation

**Files:** Create `src/sim/systems/rival-system.ts`,
`tests/unit/rival-system.test.ts`; modify `src/game/bootstrap-world.ts`.

- [ ] **E1.** Failing test: a funded rival Spirit (via `rivalToSpirit`) in `spirits`,
  ticked by `RivalSystem` with a forced-low cooldown and a believer NPC in its
  settlement, emits a command; after a `CommandExecutorSystem` tick the target NPC's
  faith **in the rival** rises and rival power drops. Unfunded rival → no net change.
  Same seed ⇒ identical emissions across two runs.
- [ ] **E2.** Implement `RivalSystem(queue)` (`tickHz` 0.5) per spec §5: iterate
  non-player spirits with `ai`; build `spiritToRivalView`; build deterministic
  `context`; `decideRivalAction(view, ctx.now, context, () => ctx.rng.next01())`;
  map verb (whisper/omen/miracle; proselytize→whisper, discredit/curse→omen); pick
  target via `ctx.rng`; `queue.emit`; write `ai.lastActionTick = ctx.now`.
  Confirm the `Rng` method name (`next01`/`next`) against `src/core/rng.ts`.
- [ ] **E3.** Bootstrap: in `bootstrap-world.ts`, after settlements/POIs exist, call
  `generateRivalSpirits(seed, settlementIds, count=2)` → `rivalToSpirit` → add to
  `state.spirits`. Guard behind world-seed availability; keep determinism (seed from
  world seed, not random).
- [ ] **E4.** Green; commit `feat(rival): RivalSystem + bootstrap instantiation`.

## Task F — Player routing + wiring + replay

**Files:** Modify `src/game/divine-actions-controller.ts`, `src/game.ts`,
`src/core/timeline.ts`, rival-panel caller; add tests
`tests/unit/divine-actions-controller-routing.test.ts` and extend timeline replay test.

- [ ] **F1.** Failing parity test: a `DivineActionsController` wired with a real
  `CommandQueue` + `CommandExecutorSystem`; calling `controller.whisper(npc)` enqueues
  a `source:'player'` command; after one executor tick the end state equals the
  legacy direct `whisper()` path on a twin fixture. Flash (`lastCastTime`) updates on
  emit.
- [ ] **F2.** Refactor `DivineActionsController`: accept `queue` in deps; action
  methods build `Command{source:'player'}` + `queue.emit`; keep flash/particles on
  emit (optimistic, gated by `canAfford`). `register()` handlers now emit.
- [ ] **F3.** Wire `game.ts`: construct `CommandQueue`; register
  `CommandExecutorSystem` **first**, `RivalSystem` among sim systems; pass queue to
  controller; route `onResult` rejections to the status-hint surface; pass
  `queue.clear` into `TimelineController`.
- [ ] **F4.** `timeline.ts`: accept an optional `onRestore`/`clearTransient` hook (or
  a `queue` ref) and call `queue.clear()` inside `jumpTo`/`returnToLive`/`commit`
  restores.
- [ ] **F5.** Replay determinism test: live-run N ticks with a rival acting, snapshot,
  `jumpTo` back, `forwardSilent` to live tick; rival-driven belief reproduces
  identically.
- [ ] **F6.** `npx vitest run` (full suite) green; `npx tsc --noEmit` clean;
  `npm run build` clean.
- [ ] **F7.** Commit `feat(command): route player through channel + wire game/timeline`.

---

## Self-review notes

- **Spec coverage:** A→registry+types(§3.1/3.2); B→queue(§3.3); C→executor(§3.3/§7);
  D+E→rivals(§5); F→player routing(§4)+wiring(§6)+replay(§3.4). All §9 tests mapped.
- **Type consistency:** `apply` returns `boolean` everywhere; `CommandCtx` =
  `{world,spirits,log}`; executor passes exactly that; `source: SpiritId`.
- **Risk:** confirm `Rng` API (`next01` vs `next`) and `EntityRegistry`/`World`
  query helpers in tests before writing fixtures — read the actual files in each task.
- **Parity guard (F1):** the refactor's only behavioral change is ≤1-tick timing; the
  test pins identical end state.
