# Narrative Substrate — Threads & Staging

**Date**: 2026-06-04
**Status**: Approved — ready for planning
**Track**: Foundation under Track 4 (Fate). Closes a Track-1 loose end.
**Anchored on**: [VISION.md](../../VISION.md) §2 (Fate, attention/realization), §7 (the arc), §9 #5 (consume belief events); [ROADMAP.md](../../ROADMAP.md) Track 4 (plot-thread tracker), Track 5 (progression — *out of scope here*).

---

## 1. Why

The game can already *recognize* nothing about its own story. Events
(`npc_death`, `belief_cross`, settlement events) fire into `EventLog` atomized —
no event knows it belongs to an arc, no arc knows what phase it's in, and there
is nowhere for Fate (Track 4) to *read* "what story is unfolding" or *write*
"here is content prepared for the player to discover."

This spec lays that missing layer: a **narrative substrate** with two directions.

| Direction | What it does | Driven by |
|---|---|---|
| **Retrospective** (Slice 1) | *Recognizes* multi-stage arcs from events the sim already produced; tracks each through its phases. | sim events |
| **Prospective** (Slice 2) | Holds **dormant, pre-authored content** ("staged beats") bound to a subject, armed and invisible until the player's attention reaches it; **materializes on discovery**. | discovery signals |

**Boundary rule (the spine of this design): this layer *senses and stages; it
does not decide*.** It provides the data structures, lifecycle, and seams. The
*authoring intelligence* — which arcs are worth recognizing, what is worth
staging — is the future **Fate LLM brain (Track 4)**, explicitly out of scope.
Every seam here is proven by **deterministic stubs** so the layer is alive and
testable on its own; the brain later *replaces the stubs as a producer*.

### Reconciliation with "Fate is reactive" (VISION §2.1)

Staging is *prospective*, which pushes on VISION §2.1 ("Fate amplifies and
escalates what the sim produces; it does not inject arbitrary plot devices").
The reconciliation, to be written into VISION when the brain lands (not now):

> Fate may **prepare** the stage, but staged content must be (a) **grounded in /
> amplifying** existing sim conditions, never arbitrary, and (b) **latent until
> discovered** — never forced into view. Fate sets out possibilities; the sim and
> the player's attention decide which get realized.

This is consistent with the existing **attention/realization cosmology** (§2.3):
"discover" already means "the player's sphere of attention reaches it," exactly
how `realized` tiles flicker wider. Staged beats activating on discovery is that
same mechanic applied to narrative. The *substrate* laid here is rule-neutral —
it only provides the mechanism.

---

## 2. How it fits existing systems (no new infrastructure)

Everything this layer needs already exists; we are wiring, not inventing:

- **Events** — `EventLog` (canonical, append-only) + `SilentEventLog` (replay).
  Recognizers *read* new events; the layer *emits* new `thread_*` / `beat_fired`
  events back into the canonical log.
- **Command channel** — a staged beat's **hard payload** is a list of `Command`s
  (`author_spawn_npc` / `author_place_object` / `author_modify_npc`, or a future
  authoring verb), emitted with `source: 'fate'`. Activation just pushes them
  onto the existing `CommandQueue`; the existing deterministic executor applies
  them.
- **Soft content** — a beat's **soft payload** (a pre-written *thought* or
  location vibe) primes the existing `NpcAttentionStore` (the soft lane that is
  never snapshotted and regenerates on focus) via a callback — the sim never
  imports UI.
- **Snapshot** — `Snapshot` (`snapshot.ts`) is the single serialization point
  used by **both** timeline scrub *and* game persistence (`SaveFile` rides
  `captureSnapshot`). Threads + the staging buffer serialize *inside* `Snapshot`,
  so both paths handle them for free, with no `SaveFile` version bump and no
  migration.
- **Scheduler** — two new `System`s registered like the others. They read their
  stores from `SystemContext` (added there, like `world`/`spirits`), **not** by
  held reference, so a snapshot restore that rehydrates the stores is picked up
  on the next tick (the world/spirits pattern; *not* the held-queue pattern).
- **Determinism** — both systems live in `src/sim/threads/`, covered by
  `tests/unit/no-random-in-sim.test.ts`. IDs come from a serialized integer
  counter in each store (no `Math.random`, no `Date`). All recognizer/producer
  randomness, if any, flows through `ctx.rng`.

---

## 3. Slice 1 — Retrospective thread layer

### 3.1 Types — `src/sim/threads/thread-types.ts`

```ts
export type ThreadId = number;
export type ShapeId = string;

export type ThreadSubject =
  | { kind: 'npc'; npcId: EntityId }
  | { kind: 'settlement'; poiId: string }
  | { kind: 'spirit'; spiritId: SpiritId };   // free now; exercised by Track 5/brain later

export type NarrativeWeight = 'setup' | 'rising' | 'climax' | 'resolution';
export type ThreadStatus = 'staged' | 'active' | 'resolved' | 'abandoned';
//                          ^ 'staged' anticipates Slice 2; unused by Slice-1 recognizers.

export interface ContributingEvent { eventId: number; phase: string; tick: number; }

export interface PlotThread {
  id: ThreadId;
  shapeId: ShapeId;
  subject: ThreadSubject;
  phase: string;                 // current phase id within the shape
  status: ThreadStatus;
  openedTick: number;
  updatedTick: number;
  contributingEvents: ContributingEvent[];
  vars: Record<string, number>;  // recognizer bookkeeping (e.g. peak severity seen)
}
```

### 3.2 Shape registry — `src/sim/threads/shape-registry.ts` (data-driven)

A shape is **pure data**: an ordered phase list, each phase tagged with a
narrative weight. No shape is special-cased in code; recognizers reference shapes
by id. Adding a shape (incl. future Fate/authored ones) is adding data.

```ts
export interface ThreadShape {
  id: ShapeId;
  name: string;
  subjectKind: ThreadSubject['kind'];      // which subject this shape applies to
  phases: { id: string; weight: NarrativeWeight }[];   // ordered; first = initial phase
}
```

Seed set:

| Shape | Subject | Phases (weight) | Recognizer |
|---|---|---|---|
| `loss-given-meaning` | npc | `loss`(setup) → `reaching`(rising) → `meaning`(climax) → `carried`(resolution) | **fully wired** |
| `trial` | settlement | `onset`(setup) → `hardship`(rising) → `turning`(climax) → `aftermath`(resolution) | **fully wired** |
| `monomyth` | npc | `call`(setup) → `threshold`(rising) → `ordeal`(climax) → `return`(resolution) | **stub** (data only — proves a shape can exist *awaiting the brain*) |

Validation helper: every shape has ≥1 phase, unique phase ids, exactly one
`climax`. A unit test asserts the registry is well-formed.

### 3.3 Store — `src/sim/threads/thread-store.ts`

```ts
export class PlotThreadStore {
  open(shapeId, subject, tick): PlotThread          // creates at the shape's first phase, status 'active'
  advance(id, toPhase, eventId, tick): void         // moves phase, appends ContributingEvent
  resolve(id, status: 'resolved' | 'abandoned', tick): void
  get(id): PlotThread | undefined
  active(): PlotThread[]                             // status 'active'
  bySubject(subject): PlotThread[]                   // for "does this NPC already have a loss thread?"
  threadOfEvent(eventId): ThreadId | undefined       // derived reverse index
  serialize(): PlotThread[]                          // deep copy
  hydrate(threads: PlotThread[]): void               // replace contents; rebuild reverse index; advance id counter
}
```

- IDs from a private integer counter; `hydrate` advances it past the max restored
  id (the `EventLog.hydrate` pattern).
- The `eventId → threadId` reverse index is **derived** (rebuilt in `hydrate`
  from `contributingEvents`), never serialized.

### 3.4 Recognizers — `src/sim/threads/recognizers.ts` (deterministic)

A recognizer is a pure function:

```ts
type Recognizer = (newEvents: AppendedEvent[], ctx: RecognizerCtx) => void;
interface RecognizerCtx { world: World; spirits: Map<SpiritId, Spirit>;
                          store: PlotThreadStore; log: EventLog; rng: Rng; now: number; }
```

Wired recognizers (read only existing events — **this closes VISION §9 #5 /
Track-1 "consume belief events"**):

- **`loss-given-meaning`**: a `npc_death` whose victim *was a believer* (faith in
  any spirit ≥ threshold before death, derivable from the dying NPC's lineage /
  nearby kin) opens a thread on a bereaved relative at `loss`. A subsequent
  `answer_prayer` / `dream` / meaning-need recovery on that relative advances
  `reaching → meaning → carried`, then `resolve('resolved')`. No meaning within a
  timeout window → `resolve('abandoned')`.
- **`trial`**: a `settlement_begin` of a hardship type (`drought`/`plague`/
  `raiders`) opens a `trial` at `onset`; rising severity (a higher-severity
  `settlement_begin`/`omen` on the same POI, tracked in `vars.peakSeverity`)
  advances `onset → hardship`; a `miracle`/`answer_prayer` countering it advances
  `→ turning`; `settlement_end` advances `→ aftermath` and resolves.

`monomyth` ships **without** a recognizer — its presence in the registry with no
wired recognizer is the explicit proof that data and recognition are decoupled.

### 3.5 System — `src/sim/threads/systems/plot-thread-system.ts`

`PlotThreadSystem implements System`, `tickHz ≈ 0.5`. Each tick it pulls events
appended since its last cursor (`log.since(cursor)`), runs every recognizer, and
emits the resulting lifecycle events. It holds **no state** beyond the `since`
cursor; the store comes from `ctx.threads`.

New `SimEvent` variants (added to the `events.ts` union):

```ts
| { type: 'thread_opened';    threadId: ThreadId; shapeId: ShapeId; subject: ThreadSubject }
| { type: 'thread_advanced';  threadId: ThreadId; phase: string; weight: NarrativeWeight }
| { type: 'thread_resolved';  threadId: ThreadId; status: 'resolved' | 'abandoned' }
```

Replay note: when `ctx.log instanceof SilentEventLog`, recognizers still run
(they mutate the store) but emit nothing — matching how every other system
behaves under replay.

---

## 4. Slice 2 — Prospective staging + activation-on-discovery

### 4.1 Types — `src/sim/threads/staging-types.ts`

```ts
export type BeatId = number;
export type BeatStatus = 'armed' | 'fired' | 'expired';

export type ActivationTrigger =
  | { kind: 'discovery' }                                         // subject enters attention — FULLY wired
  | { kind: 'sim_condition'; predicateId: string }               // minimal: a named predicate over world state
  | { kind: 'thread_phase'; threadId: ThreadId; phase: string }  // when a thread reaches a phase
  | { kind: 'after_tick'; tick: number };                        // time-based

export interface SoftBeat { kind: 'npc_thought' | 'location_vibe' | 'narration'; text: string; }

export interface StagedBeat {
  id: BeatId;
  threadId?: ThreadId;        // beats usually belong to a staged thread
  subject: ThreadSubject;
  trigger: ActivationTrigger;
  hard: Command[];            // armed commands released on fire (source:'fate')
  soft?: SoftBeat;            // primed into NpcAttentionStore on fire
  status: BeatStatus;
  stagedTick: number;
}
```

### 4.2 Staging buffer — `src/sim/threads/staging-buffer.ts`

```ts
export class StagingBuffer {
  arm(beat: Omit<StagedBeat,'id'|'status'>): StagedBeat   // status 'armed'
  armedFor(subject): StagedBeat[]                          // indexed by subject
  armedByTrigger(kind): StagedBeat[]
  markFired(id) / markExpired(id): void
  serialize(): StagedBeat[]                                // the *fact* a beat is armed persists
  hydrate(beats): void                                    // advance id counter
}
```

The **fact** a beat is armed (incl. its hard commands) is serialized inside the
snapshot. The **soft text** is also stored (so a discovered beat can prime
narration after a reload), but is regenerable in spirit with `NpcAttentionStore`.

### 4.3 Discovery signal

Player attention is non-deterministic and non-replayable (it's input), and
persistence is full-state — consistent with the existing model. Discovery enters
the sim through a tiny transient queue (the `CommandQueue` pattern), **not**
snapshotted:

```ts
export interface DiscoverySignal { subject: ThreadSubject; }
export class DiscoveryQueue { push(s): void; drain(): DiscoverySignal[]; }
```

`game.ts` feeds it from the existing attention seams:
- **NPC focus** (`Game.onNpcFocus` / selection) → `push({kind:'npc', npcId})`.
- **`region_realized`** events → the activation system also scans new events for
  region realization and treats overlapping settlement subjects as discovered.

### 4.4 Activation system — `src/sim/threads/systems/staging-activation-system.ts`

`StagingActivationSystem implements System`, `tickHz ≈ 0.5` (registered *after*
`PlotThreadSystem`, *before* nothing critical; it emits onto the command queue
which the executor drains at the top of the next tick). Each tick:

1. Drain `DiscoveryQueue`; also collect `region_realized` from `log.since(cursor)`.
2. For each discovered subject, fire matching `armed` beats with a `discovery`
   trigger; also fire `after_tick`/`thread_phase`/`sim_condition` beats whose
   condition is now met (checked every tick regardless of discovery).
3. **Fire** = push each `hard` Command onto the `CommandQueue` (`source:'fate'`);
   invoke `onSoftBeat?(subject, soft)` (game.ts → `NpcAttentionStore`); if the
   beat has a `threadId`, activate the staged thread (`status 'staged' → 'active'`)
   or advance it; `markFired`; emit `beat_fired`.

```ts
| { type: 'beat_fired'; beatId: BeatId; subject: ThreadSubject; threadId?: ThreadId }
```

Constructor deps (held by reference, all transient): `DiscoveryQueue`,
`CommandQueue`, and an optional `onSoftBeat` callback. Stores come from `ctx`.

### 4.5 Deterministic stub producer — `src/sim/threads/stub-producer.ts`

A tiny rule that *stands in for the brain* so the prep→discover→materialize loop
runs end-to-end and is testable: when a `trial` thread reaches `hardship`
(prolonged settlement hardship), stage a beat on that settlement — a
`author_spawn_npc` of a `stranger` (hard) plus a `location_vibe` soft line —
armed on `discovery`. Discovering the settlement later materializes the stranger
and primes the vibe. This is wired behind the same recognizer cadence and is the
canonical Slice-2 integration test. The brain replaces this producer later.

---

## 5. State / integration changes (exhaustive)

1. **`src/core/state.ts`** — add `plotThreads: PlotThreadStore` and
   `staging: StagingBuffer` to `GameState`; construct both in `createState()`.
2. **`src/core/scheduler.ts`** — add `threads: PlotThreadStore` and
   `staging: StagingBuffer` to `SystemContext` (additive; existing systems ignore
   them).
3. **`src/core/events.ts`** — add the four event variants
   (`thread_opened/advanced/resolved`, `beat_fired`) to the `SimEvent` union.
4. **`src/core/snapshot.ts`** — `Snapshot` gains `threads: PlotThread[]` and
   `staging: StagedBeat[]`; `captureSnapshot` serializes both; `restoreSnapshot`
   rehydrates both into the existing store instances. **(This single change makes
   timeline-scrub *and* `SaveFile` persistence work — no `SaveFile` edits, no
   `SAVE_VERSION` bump.)**
5. **`src/game.ts`** — construct the `DiscoveryQueue`; register
   `PlotThreadSystem` and `StagingActivationSystem` (after `CommandExecutorSystem`
   so fired beats' commands apply next tick); pass `threads`/`staging` in the
   scheduler `tick` ctxBase; feed NPC focus into the `DiscoveryQueue`; wire
   `onSoftBeat` to the `NpcAttentionStore`.

Old saves: a save captured before this change deserializes a `Snapshot` lacking
`threads`/`staging`; `restoreSnapshot` treats missing arrays as empty (defensive
`?? []`), so old saves load with no threads rather than failing.

---

## 6. Out of scope (explicit)

- The **Fate LLM brain** and beat-authoring intelligence (Track 4).
- Command-emission **policy** / escalation / pacing (Track 4).
- **Deity tiers / progression / win-state** (Track 5).
- **Monomyth recognition** (data + stub only here).
- The **VISION §2.1 reconciliation paragraph** (write it when the brain lands).
- A player-facing UI. (A dev-panel thread viewer is an optional, descopeable
  final step — see §8.)

---

## 7. Testing

Deterministic throughout (seeded worlds; `Math.random`-free, guarded).

- **Shape registry** — well-formedness (phases non-empty, unique ids, one climax).
- **Store** — open/advance/resolve; reverse index; `serialize`/`hydrate`
  round-trip incl. id-counter advance.
- **Recognizers** — seeded sim: a believer `npc_death` opens `loss-given-meaning`;
  an `answer_prayer` resolves it; timeout abandons it. A `settlement_begin`
  drought opens `trial`; `settlement_end` resolves it.
- **Staging buffer** — arm/fire/expire; serialize round-trip.
- **Activation** — arm a `discovery` beat → push a matching `DiscoverySignal` →
  assert hard commands hit the `CommandQueue`, `onSoftBeat` fired, thread
  activated, `beat_fired` emitted, beat marked `fired`. `after_tick` fires on time.
- **Snapshot/persistence** — capture with active threads + armed beats; restore;
  assert both stores match (and the reverse index works). A `SaveFile` round-trip
  through `toSaveFile`/`applySaveFile`.
- **Replay parity** — under `SilentEventLog`, recognizers mutate the store but
  emit nothing; an old-snapshot (no `threads`/`staging`) restores cleanly.
- **Integration (the proof-of-life)** — seeded run: prolonged hardship → `trial`
  reaches `hardship` → stub producer arms a stranger beat → discover the
  settlement → stranger materializes + vibe primed + `beat_fired`.

## 8. Build order (two slices)

1. **Slice 1** — types → shape registry (+validation test) → store (+test) →
   event variants → recognizers (+tests) → `PlotThreadSystem` → snapshot
   integration (threads only) → register in `game.ts` (+integration test).
2. **Slice 2** — staging types → staging buffer (+test) → discovery queue →
   activation system (+tests) → stub producer → snapshot integration (staging) →
   wire `game.ts` discovery + `onSoftBeat` (+integration test).
3. **(Optional, descopeable)** — a `FloatingPanel` dev thread/beat viewer
   (button-reachable per the dev-UX convention), listing active threads and armed
   beats so you can watch prep→discover→resolve live.
