# Command Channel + Capability Registry — Design

**Date:** 2026-06-03
**Track:** 4 (Fate) — sub-project #1 of the decomposition
**Status:** Design approved; spec for implementation

---

## 1. Why

The game has three *disjoint* vocabularies for "what can be done in the world":

- what the **player UI** can trigger (5 divine actions, called directly),
- what the **sim** can represent,
- what an **agent** could do (today: nothing — rivals are inert, Fate is unbuilt).

Canon (VISION §2.1, ROADMAP Track 4) already names the fix: *"a low-frequency
`FateSystem` emitting commands on **the same channel as the player and rivals**."*
This spec builds that shared channel and the **capability registry** that governs
it — the single source of truth for every divine possibility. It is the
foundation every later Fate/rival sub-project stacks on, and it revives the
currently-inert rival spirits as a direct side effect.

### Scope (this slice)

- **Declare** the full verb vocabulary (5 divine + 3 authoring-tier) in one registry.
- **Implement** the 5 divine verbs as channel commands, delegating to the existing
  `divine-actions.ts` effect functions.
- **Route the player** through the channel (uniform path).
- **Activate rivals**: a `RivalSystem` that emits real commands on a simple cadence.
- The 3 authoring verbs (`bias_event`, `inject_npc`, `nudge_severity`) are
  first-class registry entries marked `implemented: false` → executor returns a
  clean `not_implemented` rejection until the Fate cycle wires them.

### Non-goals (deferred)

- Fate's "brain" (world-state summarizer + LLM decision loop) — sub-project #3.
- Real rival strategy/learning/player-modelling — Track 3.
- Authoring-verb *execution* (event injection, NPC injection, severity nudge).
- Player-input recording for exact scrub-replay of past clicks — matches today's
  behavior (divine actions are exogenous, captured by snapshots, not re-derived).

---

## 2. Canonical constraints (baked in, not optional)

- **Determinism / replay-safety.** All code lives under `src/sim/` and is
  `Math.random`-free (guarded by `tests/unit/no-random-in-sim.test.ts`). Agent
  commands are emitted from a **System** during `tick()` using `ctx.rng`, so they
  re-run identically under `TimelineController.forwardSilent` from a snapshot.
- **Fate is impersonal & reactive** (VISION §2.1). The authoring verbs amplify /
  escalate what the sim already produces; none injects arbitrary plot. (Their
  execution is out of scope here; the *declaration* must respect this framing.)
- **`divine-actions.ts` stays the effect layer.** The channel routes and gates
  (cost + preconditions); it never reimplements an effect.

---

## 3. Architecture

```
 emitters                      channel (src/sim/command/)                 effects
┌────────────────┐   emit()   ┌───────────────────────────┐   apply()  ┌──────────────────┐
│ player (UI)    │──────────▶ │ CommandQueue (transient)   │            │ divine-actions.ts│
│ RivalSystem    │──────────▶ │                            │            │ whisper/omen/... │
│ (Fate, later)  │──────────▶ │ CommandExecutorSystem      │──────────▶ │                  │
└────────────────┘            │  drain → registry validate │            └──────────────────┘
                              │  → apply → log SimEvent    │                    │
                              │  CapabilityRegistry        │                    ▼
                              └───────────────────────────┘              EventLog (SimEvent)
```

- **CommandQueue** — a transient FIFO of pending `Command`s. **Not** part of any
  snapshot (it is pending *input*, like a keypress, not sim state). Cleared on
  snapshot restore.
- **CommandExecutorSystem** — a registered `System` (`tickHz` high enough to feel
  instant, e.g. matches the fastest sim system; registered **first** so commands
  apply before the tick's sim systems compute). Each tick it drains the entire
  queue in FIFO order; for each command it looks up the registry, validates, and
  either applies (delegating to `divine-actions.ts`) + logs, or records a
  structured rejection.
- **CapabilityRegistry** — one `CapabilityDef` per verb; the introspectable map of
  all possibilities.

### 3.1 Core types (`src/sim/command/types.ts`)

```ts
export type CommandVerb =
  | 'whisper' | 'omen' | 'dream' | 'miracle' | 'answer_prayer'   // divine, implemented
  | 'bias_event' | 'inject_npc' | 'nudge_severity';             // authoring, declared-only

export type CommandTarget =
  | { kind: 'npc'; npcId: string }
  | { kind: 'settlement'; poiId: string }
  | { kind: 'none' };

export interface Command {
  verb: CommandVerb;
  source: SpiritId;                          // 'player', a rival id, or 'fate' (unused this slice)
  target: CommandTarget;
  params?: Record<string, number | string>;  // verb-specific (reserved; unused by v1 divine verbs)
  seq: number;                               // monotonic, stamped by the queue on emit
}

export type RejectionReason =
  | 'insufficient_power' | 'precondition_failed'
  | 'not_implemented' | 'invalid_target' | 'unknown_source';

export type CommandResult =
  | { status: 'applied'; verb: CommandVerb; source: SpiritId }
  | { status: 'rejected'; verb: CommandVerb; source: SpiritId; reason: RejectionReason };
```

### 3.2 Capability registry (`src/sim/command/registry.ts`)

```ts
export interface CommandCtx {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
}

export interface CapabilityDef {
  verb: CommandVerb;
  tier: 'divine' | 'authoring';
  cost: number;                              // power cost; reuses divine-actions.ts constants
  targetKind: 'npc' | 'settlement' | 'none';
  implemented: boolean;                      // false ⇒ 'not_implemented'
  /** Read-only gate (cooldown, worship-state, …). Returns a reason or null. */
  precondition?(cmd: Command, ctx: CommandCtx): RejectionReason | null;
  /** Mutating effect. MUST delegate to divine-actions.ts, which itself pays the
   *  power cost and appends the SimEvent. Returns false if the underlying function
   *  declined (lost a race after the pre-gate). */
  apply?(cmd: Command, ctx: CommandCtx): boolean;
  /** Human/agent-readable summary for logs, tooltips, Fate introspection. */
  describe(cmd: Command): string;
}

export const CAPABILITY_REGISTRY: Record<CommandVerb, CapabilityDef>;
export function getCapability(verb: CommandVerb): CapabilityDef | undefined;
export function listCapabilities(): CapabilityDef[];   // Fate/UI/docs introspection
```

**Divine verbs** (`implemented: true`): each `apply` resolves its `source` spirit
and its target from `ctx`, then calls the matching `divine-actions.ts` function.
Because those functions *already* re-check power internally and decrement it, the
executor's responsibility is the **pre-gate** (so we get a structured rejection
instead of a silent `false`) and the **post-log of the rejection**. The apply path
trusts the divine-action function's own bool return as a final guard.

| verb | tier | cost | target | precondition |
|---|---|---|---|---|
| `whisper` | divine | `WHISPER_COST` (1) | npc | `whisperCooldown > 0` → `precondition_failed` |
| `answer_prayer` | divine | `ANSWER_PRAYER_COST` (2) | npc | `activity !== 'worship'` → `precondition_failed` |
| `omen` | divine | `OMEN_COST` (3) | settlement | — |
| `dream` | divine | `DREAM_COST` (4) | npc | — |
| `miracle` | divine | `MIRACLE_COST` (10) | settlement | — |
| `bias_event` | authoring | 0 | settlement | n/a (`implemented:false`) |
| `inject_npc` | authoring | 0 | settlement | n/a (`implemented:false`) |
| `nudge_severity` | authoring | 0 | settlement | n/a (`implemented:false`) |

### 3.3 Queue + executor (`src/sim/command/command-queue.ts`, `command-system.ts`)

```ts
export class CommandQueue {
  private pending: Command[] = [];
  private seqCounter = 0;
  emit(cmd: Omit<Command, 'seq'>): void;     // stamps seq, pushes
  drain(): Command[];                         // returns FIFO, clears
  clear(): void;                              // on snapshot restore
  size(): number;
}

export class CommandExecutorSystem implements System {
  name = 'command-executor';
  tickHz = 60;   // matches NpcMovementSystem — player commands drain within ~16ms
  constructor(private queue: CommandQueue, private onResult?: (r: CommandResult) => void) {}
  tick(ctx: SystemContext): void;             // drain → execute each → onResult
}

/** Pure, testable: validate + apply one command. No RNG, no queue. */
export function executeCommand(cmd: Command, ctx: CommandCtx): CommandResult;
```

`executeCommand` algorithm:
1. `def = getCapability(cmd.verb)`; missing → `rejected/invalid_target` (defensive).
2. `!def.implemented` → `rejected/not_implemented`.
3. Resolve `source` spirit from `ctx.spirits`; missing → `rejected/unknown_source`.
4. Resolve target (npc via `getNpc`, settlement via poi id); wrong kind/missing →
   `rejected/invalid_target`.
5. `spirit.power < def.cost` → `rejected/insufficient_power`.
6. `def.precondition?.(cmd, ctx)` non-null → `rejected/<reason>`.
7. `def.apply(cmd, ctx)` (delegates to divine-actions, which pays cost + logs the
   SimEvent). If the underlying function returns `false` (lost a race), surface
   `rejected/precondition_failed`. Else → `applied`.

The executor **never throws**: any unexpected error is caught and surfaced as a
`system_error` event by the scheduler's existing try/catch (`scheduler.ts:50`).

### 3.4 Replay & snapshot interaction

- **Agent commands** (rivals, later Fate) originate inside `RivalSystem.tick` using
  `ctx.rng` → reproduced exactly by `forwardSilent`. No recording needed.
- **Player commands** are exogenous input. They are **not** recorded for replay
  (matching today: a past whisper's *effect* is captured by snapshots; scrubbing
  forward does not re-derive the click). The queue is transient and excluded from
  snapshots; `TimelineController` clears it on restore (via `CommandQueue.clear()`).
- The 1-tick drain latency is invisible to replay because the *effect* lands inside
  a tick and is snapshotted normally.

---

## 4. Player routing (uniform path)

`DivineActionsController` becomes a **player-source emitter** instead of a direct
caller. Its action methods build a `Command{source:'player'}` and `queue.emit(...)`,
keeping their existing **cosmetic** responsibilities (gold flash, particle effects)
on emit.

- **Optimistic feel:** on emit the controller does a cheap read-only affordability
  check (`canAfford`) and only flashes/triggers particles when plausibly castable;
  the authoritative apply still happens at the next drain. On a real rejection
  (e.g. depleted between emit and drain) the existing status-hint surface reports it
  via the `onResult` callback. Net player-perceived latency: ≤1 sim tick + an
  immediate flash — matches the current "instant act feedback" goal.
- The `OverlayDispatcher` handler wiring (`register()`) is unchanged in shape; the
  handlers now emit commands rather than call sim functions.
- Parity requirement: the observable end state of a player whisper/omen/dream/
  miracle/answer-prayer (belief deltas, events logged, power spent) is **identical**
  to the pre-change direct-call path — only the timing shifts by ≤1 tick.

---

## 5. Rival activation ("activate, don't perfect")

Rivals are modeled as **non-player `Spirit`s** in `state.spirits`, carrying their
behavioral profile in the existing `Spirit.ai` seam (widened). This gives them
power-regen (SpiritSystem already iterates `state.spirits`), snapshot/replay
(snapshots `structuredClone` every Spirit, `ai` included), and divine-action
compatibility (the effect functions take a `Spirit`) **with zero changes to
`snapshot.ts` and no new state collection.**

Widen `Spirit.ai` (`src/core/spirit.ts`):

```ts
ai?: {
  policy: string;                 // RivalStrategy: 'expand'|'defend'|'undermine'|'coexist'
  cooldowns: Record<string, number>;
  personality?: RivalPersonality; // from rival-spirit.ts
  settlements?: string[];         // claimed POI ids
  lastActionTick?: number;
  actionCooldown?: number;
};
```

**Bootstrap:** in `bootstrap-world.ts`, after settlements exist, call the existing
`generateRivalSpirits(seed, settlementIds, count)` and register each as a `Spirit`
(`isPlayer:false`, power/color from the generated rival, `ai` populated from its
personality/strategy/settlements). This is the first time rivals are *instantiated*
at all.

**`RivalSystem`** (`src/sim/systems/rival-system.ts`, low `tickHz` ≈ 0.5):
for each non-player spirit with an `ai` profile:
1. Reconstruct a lightweight `RivalSpirit` view from `Spirit` + `ai`.
2. Build the decision `context` (player power, follower counts per settlement,
   nearby NPC beliefs) from `world` + `spirits` — all deterministic reads.
3. `action = decideRivalAction(view, ctx.now, context, () => ctx.rng.next01())`
   (reuse existing, sketched decision functions).
4. Map the `RivalAction.type` to a real `CommandVerb`:
   `whisper→whisper`, `omen→omen`, `miracle→miracle`; the fictional
   `proselytize→whisper`, `discredit→omen`, `curse→omen` (documented mapping; the
   non-existent verbs never reach the executor). Pick a target deterministically
   (`ctx.rng`) — an NPC in a claimed settlement (npc-target verbs) or a claimed
   settlement id (settlement-target verbs).
5. `queue.emit({ verb, source: rival.id, target })` and write
   `ai.lastActionTick = ctx.now`.

The CommandExecutor then runs the rival's command through the *same* registry/gate
as the player — rivals now visibly spend power and shift NPC belief toward
themselves. Strategy quality, target heuristics, and learning are explicitly Track 3.

**UI:** `rival-panel.ts` already wants a `RivalSpirit`; add a small adapter
(`spiritToRivalView`) so `onSelectRival` can show the live rival. (`onSelectRival`
already reads `state.spirits.get(rivalId)`.)

---

## 6. Wiring & ordering (`game.ts`)

- Construct one `CommandQueue` in the `Game` constructor.
- Register `new CommandExecutorSystem(queue, onResult)` **first** in the scheduler
  (before `NpcMovementSystem`) so queued commands apply at the top of each tick.
- Register `new RivalSystem(queue)` alongside the other sim systems.
- `tickHz` for the executor: **60**, matching `NpcMovementSystem` (the fastest
  system), so player commands drain within ~16ms at normal rate. The drain is a
  cheap no-op when the queue is empty.
- Pass the `queue` into `DivineActionsController` so player actions emit onto it.
- Pass `queue.clear` to `TimelineController` so restores drop pending input.
- `onResult` routes rejections to the existing player status-hint surface.

---

## 7. Error handling

- All rejections are **structured `CommandResult`s**, never thrown, never logged as
  narrative `SimEvent`s (a denied whisper is not a story beat).
- Unknown verb / missing source / missing target → defensive structured rejections.
- An `apply` that throws is caught by the scheduler and recorded as `system_error`;
  the tick loop continues.
- The authoring verbs always reject `not_implemented` — proves the declared-but-
  unwired contract and gives the Fate cycle a green-field `apply` to fill in.

---

## 8. File structure

**Create**
- `src/sim/command/types.ts` — `Command`, `CommandTarget`, `CommandVerb`, results.
- `src/sim/command/registry.ts` — `CapabilityDef` + `CAPABILITY_REGISTRY` + helpers.
- `src/sim/command/command-queue.ts` — `CommandQueue`.
- `src/sim/command/command-system.ts` — `executeCommand` + `CommandExecutorSystem`.
- `src/sim/systems/rival-system.ts` — `RivalSystem`.
- `src/sim/command/rival-adapter.ts` — `spiritToRivalView` / `rivalToSpirit` helpers.

**Modify**
- `src/core/spirit.ts` — widen `Spirit.ai`.
- `src/game/divine-actions-controller.ts` — emit commands instead of direct calls;
  keep cosmetic flash/particles; accept the queue.
- `src/game/bootstrap-world.ts` — instantiate rivals as spirits.
- `src/game.ts` — construct queue, register systems, wire controller + timeline.
- `src/core/timeline.ts` — clear the queue on restore.
- `src/ui/rival-panel.ts` (or its caller in `game.ts`) — adapter for live rival view.

**Unchanged (deliberately)**
- `src/sim/divine-actions.ts` — remains the effect layer.
- `src/core/snapshot.ts` — rivals ride along as `Spirit`s; no change.

---

## 9. Testing

- **registry.test** — every `CommandVerb` has a def; divine verbs `implemented:true`
  with `apply` + correct cost (matches `divine-actions.ts` constants); authoring
  verbs `implemented:false`; `listCapabilities()` returns all 8.
- **command-system.test (`executeCommand`)** — table-driven:
  - applied path mutates state + appends the matching `SimEvent` (parity with a
    direct `divine-actions` call on the same fixture).
  - `insufficient_power` when spirit can't afford.
  - `precondition_failed` for whisper-on-cooldown and answer-prayer-not-worshipping.
  - `not_implemented` for each authoring verb (and that state is untouched).
  - `invalid_target` (npc verb given a settlement target / missing id),
    `unknown_source`.
- **command-queue.test** — FIFO order, `seq` monotonic, `drain` clears, `clear`.
- **command-system.integration** — enqueue several mixed-source commands; one
  executor tick drains them in FIFO order; deterministic end state.
- **rival-system.test** — a funded rival emits a command that, once executed, raises
  a target NPC's faith *in that rival*; an unfunded rival's command is rejected with
  no state change; same seed ⇒ same emissions (determinism).
- **replay/determinism** — run N ticks live, snapshot, scrub back, `forwardSilent`:
  rival-driven belief state reproduces identically (extends existing timeline tests).
- **no-random-in-sim** — existing guard must stay green (new files under `src/sim/`).
- **player-routing parity** — a simulated player whisper via the queue reaches the
  same end state as the legacy direct call (guards the refactor).

---

## 10. Success criteria

1. The capability registry lists all 8 verbs; Fate/rivals/UI can introspect the full
   vocabulary; authoring verbs cleanly reject `not_implemented`.
2. Player divine actions flow through the channel with identical observable effects
   (±1 tick) and preserved instant feedback.
3. Rivals are instantiated and **visibly act** — they spend power and shift NPC
   belief toward themselves on a cadence, through the same gate as the player.
4. Everything is deterministic and replay-safe; the full suite (currently 971) stays
   green plus the new tests; typecheck + prod build clean.
5. The Fate cycle can later add a `'fate'` source and fill in the authoring verbs'
   `apply` with no channel changes.
