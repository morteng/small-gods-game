# Narrative Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the narrative substrate — a retrospective plot-thread recognition layer (Slice 1) plus a prospective staged-content/activation-on-discovery layer (Slice 2) — as deterministic, snapshot-persisted sim infrastructure that the future Fate brain will read and write.

**Architecture:** New `src/sim/threads/` module. Two scheduled `System`s read their stores from `SystemContext`. Threads + staging serialize *inside* `Snapshot`, so timeline-scrub and `SaveFile` both persist them through one integration point. Recognizers/producers are deterministic stubs; the Fate LLM brain is out of scope. Full type/section detail in `docs/superpowers/specs/2026-06-04-narrative-substrate-design.md`.

**Tech Stack:** TypeScript ESM, Vitest, `@/` → `src/`. `Math.random`-free in `src/sim/` (guarded by `tests/unit/no-random-in-sim.test.ts`).

**Commands:** `npm test -- <path>` runs a file; `npm run build` typechecks. Run from repo root.

---

## SLICE 1 — Retrospective thread layer

### Task 1: Thread types + shape registry

**Files:**
- Create: `src/sim/threads/thread-types.ts`
- Create: `src/sim/threads/shape-registry.ts`
- Test: `tests/unit/threads/shape-registry.test.ts`

- [ ] **Step 1: Write `thread-types.ts`** — copy the type block from spec §3.1 verbatim (`ThreadId`, `ShapeId`, `ThreadSubject`, `NarrativeWeight`, `ThreadStatus`, `ContributingEvent`, `PlotThread`). Import `EntityId` from `@/core/types`, `SpiritId` from `@/core/spirit`.

- [ ] **Step 2: Write `shape-registry.ts`** — `ThreadShape` interface (spec §3.2) + `SHAPES: Record<ShapeId, ThreadShape>` with the three seed shapes (`loss-given-meaning`, `trial`, `monomyth`) and a `getShape(id)` + `validateShapes()` helper (throws on empty phases / dup ids / ≠1 climax).

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SHAPES, getShape, validateShapes } from '@/sim/threads/shape-registry';

describe('shape-registry', () => {
  it('every seed shape is well-formed', () => {
    expect(() => validateShapes()).not.toThrow();
  });
  it('each shape has exactly one climax phase', () => {
    for (const s of Object.values(SHAPES)) {
      expect(s.phases.filter(p => p.weight === 'climax')).toHaveLength(1);
    }
  });
  it('phase ids are unique within a shape', () => {
    for (const s of Object.values(SHAPES)) {
      expect(new Set(s.phases.map(p => p.id)).size).toBe(s.phases.length);
    }
  });
  it('loss-given-meaning has the canonical phases', () => {
    expect(getShape('loss-given-meaning').phases.map(p => p.id))
      .toEqual(['loss', 'reaching', 'meaning', 'carried']);
  });
});
```

- [ ] **Step 4: Run** `npm test -- tests/unit/threads/shape-registry.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(threads): thread types + data-driven shape registry`.

### Task 2: PlotThreadStore

**Files:**
- Create: `src/sim/threads/thread-store.ts`
- Test: `tests/unit/threads/thread-store.test.ts`

- [ ] **Step 1: Implement `PlotThreadStore`** per spec §3.3. Private `threads: Map<ThreadId, PlotThread>`, `nextId`, derived `eventIndex: Map<number, ThreadId>`. `open` creates at `getShape(shapeId).phases[0].id`, status `'active'`. `advance` sets `phase`, pushes a `ContributingEvent`, indexes the eventId, bumps `updatedTick`. `resolve` sets status. `serialize` deep-copies. `hydrate` replaces, advances `nextId` past max id, rebuilds `eventIndex` from each thread's `contributingEvents`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PlotThreadStore } from '@/sim/threads/thread-store';

const npc = { kind: 'npc', npcId: 'n1' } as const;

describe('PlotThreadStore', () => {
  it('opens at the first phase, active', () => {
    const s = new PlotThreadStore();
    const t = s.open('loss-given-meaning', npc, 100);
    expect(t.phase).toBe('loss');
    expect(t.status).toBe('active');
    expect(s.active()).toHaveLength(1);
  });
  it('advance records a contributing event and reverse-indexes it', () => {
    const s = new PlotThreadStore();
    const t = s.open('loss-given-meaning', npc, 100);
    s.advance(t.id, 'reaching', 42, 110);
    expect(s.get(t.id)!.phase).toBe('reaching');
    expect(s.threadOfEvent(42)).toBe(t.id);
  });
  it('bySubject finds threads for a subject', () => {
    const s = new PlotThreadStore();
    s.open('loss-given-meaning', npc, 100);
    expect(s.bySubject(npc)).toHaveLength(1);
    expect(s.bySubject({ kind: 'npc', npcId: 'other' })).toHaveLength(0);
  });
  it('serialize/hydrate round-trips and rebuilds the reverse index + id counter', () => {
    const s = new PlotThreadStore();
    const t = s.open('trial', { kind: 'settlement', poiId: 'p1' }, 5);
    s.advance(t.id, 'hardship', 7, 6);
    const s2 = new PlotThreadStore();
    s2.hydrate(s.serialize());
    expect(s2.threadOfEvent(7)).toBe(t.id);
    const t2 = s2.open('trial', { kind: 'settlement', poiId: 'p2' }, 8); // must not collide
    expect(t2.id).toBeGreaterThan(t.id);
  });
});
```

- [ ] **Step 3: Run** the test → PASS.
- [ ] **Step 4: Commit** `feat(threads): PlotThreadStore with derived reverse index`.

### Task 3: Event variants + GameState/SystemContext/snapshot wiring (threads)

**Files:**
- Modify: `src/core/events.ts` (add `thread_opened`/`thread_advanced`/`thread_resolved`/`beat_fired` to `SimEvent`)
- Modify: `src/core/state.ts` (add `plotThreads`, construct in `createState`)
- Modify: `src/core/scheduler.ts` (add `threads` to `SystemContext`)
- Modify: `src/core/snapshot.ts` (`Snapshot.threads`, capture, restore w/ `?? []`)
- Test: `tests/unit/threads/snapshot-threads.test.ts`

- [ ] **Step 1: events.ts** — add the four variants from spec §3.5/§4.4. Import `ThreadId`, `ShapeId`, `ThreadSubject`, `NarrativeWeight`, `BeatId` from `@/sim/threads/thread-types` and `@/sim/threads/staging-types` (BeatId — add the import in this task even though staging-types lands in Task 6; create a minimal `staging-types.ts` stub now with just `export type BeatId = number;` to avoid a forward-ref, OR inline the `beat_fired` variant in Task 6. **Decision: inline `beat_fired` in Task 6**; this task adds only the three `thread_*` variants.)

- [ ] **Step 2: state.ts** — `import { PlotThreadStore } from '@/sim/threads/thread-store';`, add `plotThreads: PlotThreadStore;` to `GameState`, and `plotThreads: new PlotThreadStore(),` to the `createState` return.

- [ ] **Step 3: scheduler.ts** — add `threads: PlotThreadStore;` to `SystemContext` (import the type).

- [ ] **Step 4: snapshot.ts** — `Snapshot` gains `threads: PlotThread[]`. `captureSnapshot`: `threads: state.plotThreads.serialize()`. `restoreSnapshot`: `state.plotThreads.hydrate(snap.threads ?? []);`.

- [ ] **Step 5: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { seedWorld } from '@/world/seed-world'; // use the project's standard test world helper

describe('snapshot persists threads', () => {
  it('round-trips active threads', () => {
    const state = createState();
    seedWorld(state, 1); // adapt to the actual seeding helper signature
    const t = state.plotThreads.open('trial', { kind: 'settlement', poiId: 'p1' }, state.clock.now());
    const snap = captureSnapshot(state);
    state.plotThreads.resolve(t.id, 'resolved', state.clock.now()); // mutate after capture
    restoreSnapshot(state, snap);
    expect(state.plotThreads.get(t.id)!.status).toBe('active'); // snapshot is authoritative
  });
  it('tolerates an old snapshot with no threads field', () => {
    const state = createState();
    seedWorld(state, 1);
    const snap = captureSnapshot(state);
    delete (snap as any).threads;
    expect(() => restoreSnapshot(state, snap)).not.toThrow();
    expect(state.plotThreads.active()).toHaveLength(0);
  });
});
```

> Note: confirm the real world-seeding test helper (grep `tests/` for how other snapshot tests build a `state` with a world — e.g. `bootstrapWorld`/`seedWorld`). Use whatever the existing snapshot tests use.

- [ ] **Step 6: Run** the test → PASS. Then `npm run build` → no type errors.
- [ ] **Step 7: Commit** `feat(threads): wire thread store into state, scheduler ctx, snapshot`.

### Task 4: Recognizers

**Files:**
- Create: `src/sim/threads/recognizers.ts`
- Test: `tests/unit/threads/recognizers.test.ts`

- [ ] **Step 1: Implement** `RecognizerCtx` + `recognizeLossGivenMeaning` + `recognizeTrial` + an exported `RECOGNIZERS: Recognizer[]` array (spec §3.4). Each reads `newEvents` and mutates `ctx.store`. `loss-given-meaning`: on `npc_death` of a believer, find a bereaved relative via `relationships`/`parentIds` (`@/world/npc-helpers`); `open` if none exists for that relative; on `answer_prayer`/`dream`/meaning recovery for a subject with an open loss thread, `advance`/`resolve`. `trial`: on hardship `settlement_begin` `open`; track `vars.peakSeverity`; on `settlement_end` `resolve`.

- [ ] **Step 2: Write the failing test** — drive recognizers directly with synthetic `AppendedEvent[]` and a hand-built `World`:

```ts
import { describe, it, expect } from 'vitest';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { RECOGNIZERS } from '@/sim/threads/recognizers';
// build a minimal world + ctx with two related NPCs (deceased + relative)
// helper: run = (events) => RECOGNIZERS.forEach(r => r(events, ctx));

it('a believer death opens a loss-given-meaning thread on a relative', () => {
  // ...arrange world with n_dead (believer) related to n_kin...
  run([{ id: 1, t: 10, event: { type: 'npc_death', npcId: 'n_dead', lineageId: 'L', cause: 'age' } }]);
  expect(store.bySubject({ kind: 'npc', npcId: 'n_kin' })
    .some(t => t.shapeId === 'loss-given-meaning')).toBe(true);
});

it('answering the relative resolves the thread', () => {
  // ...after the open above...
  run([{ id: 2, t: 12, event: { type: 'answer_prayer', spiritId: 'player', npcId: 'n_kin' } }]);
  const t = store.bySubject({ kind: 'npc', npcId: 'n_kin' })[0];
  expect(t.status).toBe('resolved');
});

it('a drought opens then resolves a trial', () => {
  run([{ id: 3, t: 1, event: { type: 'settlement_begin', poiId: 'p1', eventType: 'drought', severity: 0.5, durationTicks: 100 } }]);
  expect(store.bySubject({ kind: 'settlement', poiId: 'p1' })[0].shapeId).toBe('trial');
  run([{ id: 4, t: 50, event: { type: 'settlement_end', poiId: 'p1', eventType: 'drought' } }]);
  expect(store.bySubject({ kind: 'settlement', poiId: 'p1' })[0].status).toBe('resolved');
});
```

> Build the world with the project's NPC test helpers (grep `tests/` for how mortality/birth tests construct related NPCs — reuse that). Keep the `ctx` minimal: `{ world, spirits, store, log, rng, now }`.

- [ ] **Step 3: Run** → PASS.
- [ ] **Step 4: Commit** `feat(threads): deterministic recognizers (loss-given-meaning, trial)`.

### Task 5: PlotThreadSystem + register in game.ts

**Files:**
- Create: `src/sim/threads/systems/plot-thread-system.ts`
- Modify: `src/game.ts` (register system; pass `threads` in scheduler ctx)
- Test: `tests/unit/threads/plot-thread-system.test.ts`

- [ ] **Step 1: Implement `PlotThreadSystem`** — `tickHz = 0.5`, private `cursor = 0`. `tick(ctx)`: `const evs = ctx.log.since(this.cursor); if (evs.length) this.cursor = evs[evs.length-1].id;` run `RECOGNIZERS` with `{world,spirits,store:ctx.threads,log,rng,now}`. Recognizers emit `thread_*` via `ctx.log.append` inside `store.open/advance/resolve`? No — keep store pure: the **system** emits. Simplest: recognizers return a list of lifecycle deltas the system appends. **Decision:** recognizers mutate the store *and* call `ctx.log.append(...)` directly (the store stays log-free; recognizers own emission). Under `SilentEventLog`, append is a no-op automatically. Document this in the file header.

- [ ] **Step 2: game.ts** — `this.scheduler.register(new PlotThreadSystem());` (after `CommandExecutorSystem`). In the `scheduler.tick(...)` call (~line 513) add `threads: this.state.plotThreads,` to the ctx object.

- [ ] **Step 3: Write the failing test** — a seeded full sim that drives a death and asserts a `thread_opened` is appended and a thread exists. Reuse the integration-style harness other system tests use (grep for `new SettlementEventSystem` usage in tests).

```ts
it('emits thread_opened when a recognizer opens a thread', () => {
  // build state with world; subscribe to eventLog; append a believer npc_death
  // tick the PlotThreadSystem once with simDt past 2000ms (0.5Hz)
  expect(captured.some(e => e.event.type === 'thread_opened')).toBe(true);
});
```

- [ ] **Step 4: Run** test + `npm run build` → PASS.
- [ ] **Step 5: Commit** `feat(threads): PlotThreadSystem wired into the scheduler`.

---

## SLICE 2 — Prospective staging + activation-on-discovery

### Task 6: Staging types + beat_fired event + StagingBuffer

**Files:**
- Create: `src/sim/threads/staging-types.ts`
- Modify: `src/core/events.ts` (add `beat_fired`)
- Create: `src/sim/threads/staging-buffer.ts`
- Test: `tests/unit/threads/staging-buffer.test.ts`

- [ ] **Step 1: staging-types.ts** — copy spec §4.1 (`BeatId`, `BeatStatus`, `ActivationTrigger`, `SoftBeat`, `StagedBeat`). Import `Command` from `@/sim/command/types`, `ThreadId`/`ThreadSubject` from `./thread-types`.
- [ ] **Step 2: events.ts** — add `| { type: 'beat_fired'; beatId: BeatId; subject: ThreadSubject; threadId?: ThreadId }`; import `BeatId`.
- [ ] **Step 3: staging-buffer.ts** — `StagingBuffer` per spec §4.2 (Map by id, subject index, `arm`/`armedFor`/`armedByTrigger`/`markFired`/`markExpired`/`serialize`/`hydrate`).

- [ ] **Step 4: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
const subj = { kind: 'settlement', poiId: 'p1' } as const;

it('arms and finds beats by subject', () => {
  const b = new StagingBuffer();
  b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
  expect(b.armedFor(subj)).toHaveLength(1);
});
it('markFired removes a beat from the armed set', () => {
  const b = new StagingBuffer();
  const beat = b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
  b.markFired(beat.id);
  expect(b.armedFor(subj)).toHaveLength(0);
});
it('serialize/hydrate round-trips and advances the id counter', () => {
  const b = new StagingBuffer();
  const beat = b.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
  const b2 = new StagingBuffer(); b2.hydrate(b.serialize());
  expect(b2.arm({ subject: subj, trigger: { kind: 'discovery' }, hard: [], stagedTick: 1 }).id)
    .toBeGreaterThan(beat.id);
});
```

- [ ] **Step 5: Run** → PASS. **Commit** `feat(staging): staged-beat types + StagingBuffer + beat_fired event`.

### Task 7: Staging state/snapshot wiring + DiscoveryQueue

**Files:**
- Modify: `src/core/state.ts` (`staging`), `src/core/scheduler.ts` (`staging` in ctx), `src/core/snapshot.ts` (`Snapshot.staging`)
- Create: `src/sim/threads/discovery-queue.ts`
- Test: extend `tests/unit/threads/snapshot-threads.test.ts`

- [ ] **Step 1: state.ts** — add `staging: StagingBuffer;` + construct.
- [ ] **Step 2: scheduler.ts** — add `staging: StagingBuffer;` to `SystemContext`.
- [ ] **Step 3: snapshot.ts** — `Snapshot.staging: StagedBeat[]`; capture `state.staging.serialize()`; restore `state.staging.hydrate(snap.staging ?? [])`.
- [ ] **Step 4: discovery-queue.ts** — `DiscoverySignal` + `DiscoveryQueue` (`push`/`drain`), spec §4.3.
- [ ] **Step 5: Add a snapshot test** asserting an armed beat survives capture/restore. **Run** + `npm run build` → PASS.
- [ ] **Step 6: Commit** `feat(staging): staging buffer in snapshot + DiscoveryQueue`.

### Task 8: StagingActivationSystem

**Files:**
- Create: `src/sim/threads/systems/staging-activation-system.ts`
- Test: `tests/unit/threads/staging-activation-system.test.ts`

- [ ] **Step 1: Implement** per spec §4.4. Constructor `(discovery: DiscoveryQueue, queue: CommandQueue, onSoftBeat?: (s, soft)=>void)`. `tickHz = 0.5`, private event `cursor`. `tick(ctx)`: collect discovered subjects from `discovery.drain()` + `region_realized` in `ctx.log.since(cursor)`; for each `armed` beat whose trigger is satisfied (`discovery` match by subject; `after_tick` when `ctx.now >= tick`; `thread_phase` when the named thread is at the phase; `sim_condition` via a small predicate map), **fire**: push each `hard` command via `queue.emit(...)`, call `onSoftBeat?`, activate/advance `beat.threadId` in `ctx.threads`, `ctx.staging.markFired(id)`, `ctx.log.append({type:'beat_fired',...})`.

- [ ] **Step 2: Write the failing test**

```ts
it('firing a discovery beat emits its commands and marks it fired', () => {
  const discovery = new DiscoveryQueue();
  const queue = new CommandQueue();
  const soft: any[] = [];
  const sys = new StagingActivationSystem(discovery, queue, (s, b) => soft.push(b));
  // arrange ctx.staging with an armed beat: subject npc 'n1', hard:[author_modify_npc cmd], soft:{...}
  discovery.push({ kind: 'npc', npcId: 'n1' });
  sys.tick(ctxWithTimePast2s);
  expect(queue.drain()).toHaveLength(1);
  expect(soft).toHaveLength(1);
  expect(captured.some(e => e.event.type === 'beat_fired')).toBe(true);
  expect(ctx.staging.armedFor({ kind: 'npc', npcId: 'n1' })).toHaveLength(0);
});
it('after_tick fires when now passes the tick', () => { /* ... */ });
```

> Use the real `CommandQueue` (`@/sim/command/command-queue`). Build `ctx` with `threads`/`staging` stores directly.

- [ ] **Step 3: Run** → PASS. **Commit** `feat(staging): StagingActivationSystem (discovery + timed/thread triggers)`.

### Task 9: Stub producer + game.ts discovery/soft wiring + integration test

**Files:**
- Create: `src/sim/threads/stub-producer.ts`
- Modify: `src/game.ts` (DiscoveryQueue; register `StagingActivationSystem`; feed NPC focus; wire `onSoftBeat` → `NpcAttentionStore`; pass `staging` in ctx)
- Test: `tests/unit/threads/integration-prep-discover.test.ts`

- [ ] **Step 1: stub-producer.ts** — `maybeStageStranger(ctx)`: when a `trial` thread reaches `hardship`, `ctx.staging.arm` a beat on that settlement with `hard: [author_spawn_npc stranger]` + `soft: { kind:'location_vibe', text:'A stranger lingers at the edge of the fields.' }`, trigger `discovery`. Call it from `PlotThreadSystem` after recognizers (or a tiny dedicated step in the activation system). **Decision:** call it at the end of `PlotThreadSystem.tick` so producers ride the same cadence as recognizers.

- [ ] **Step 2: game.ts** — construct `this.discoveryQueue = new DiscoveryQueue();`; `this.scheduler.register(new StagingActivationSystem(this.discoveryQueue, this.commandQueue, (s, soft) => /* push into NpcAttentionStore */));`; in the NPC-focus path push `{kind:'npc', npcId}` onto the queue; add `staging: this.state.staging` to the scheduler ctx.

- [ ] **Step 3: Write the failing integration test** — seeded sim: force a `trial` to `hardship` (append two rising `settlement_begin` droughts), tick `PlotThreadSystem` so the stub arms a beat, push a discovery signal for that settlement, tick `StagingActivationSystem`, drain the `CommandQueue` into the executor, assert a new `stranger` NPC exists and a `beat_fired` was emitted.

- [ ] **Step 4: Run** the integration test + full `npm test` + `npm run build` → all PASS.
- [ ] **Step 5: Commit** `feat(staging): stub producer + game wiring + prep→discover integration`.

### Task 10 (optional, descopeable): dev thread/beat viewer

**Files:** Create `src/dev/ThreadViewerPanel.ts` (FloatingPanel), add a dev-toolbar button.

- [ ] List active threads (`state.plotThreads.active()`) + armed beats (`state.staging.serialize()`), refresh on a timer. Button-reachable per the dev-UX convention. Commit `feat(dev): thread/beat viewer panel`.

---

## Self-Review notes

- **Spec coverage:** Slice 1 (§3) → Tasks 1–5; Slice 2 (§4) → Tasks 6–9; integration changes (§5) → folded into Tasks 3, 5, 7, 9; testing (§7) → each task's tests + Task 9 integration; optional dev panel (§8) → Task 10.
- **Forward-ref resolved:** `beat_fired` event variant + `BeatId` import land in Task 6 (not Task 3) so `events.ts` never references an undefined type.
- **Determinism:** all new files in `src/sim/threads/` → auto-covered by `no-random-in-sim`. IDs from serialized integer counters. Confirm `npm test -- tests/unit/no-random-in-sim.test.ts` stays green after each slice.
- **Open confirmations for the implementer:** the exact world-seeding test helper (grep existing snapshot/mortality tests), the NPC-focus call site in `game.ts`, and the `NpcAttentionStore` priming method name.
