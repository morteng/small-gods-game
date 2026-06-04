# Fate Amplification Levers — Design

**Track 4 / Fate sub-project #4.** Implement the two declared-but-unimplemented
authoring verbs `bias_event` and `nudge_severity`, giving the autonomous Fate
brain immediate sim-layer levers to amplify a settlement's troubles — beyond
`inject_npc` (sub-project #3).

Status: design approved 2026-06-04. Builds on the Fate brain
(`docs/superpowers/specs/2026-06-04-fate-brain-design.md`), the narrative
substrate (threads + staging), and the command channel + capability registry.

---

## Goal

When the Fate brain deliberates on a recognized story thread, let it not only
prepare a discoverable beat (`inject_npc`) but also **amplify the always-on
simulation now**: worsen (or ease) an active settlement event, or steer what
trouble comes next. The player perceives the changed crisis the next time they
attend to that settlement.

This stays within Fate's charter (VISION §2.1): amplify and escalate — and now
also *let fade* — what the mortals' story already produces, grounded in existing
settlement conditions and the sim's existing event vocabulary. Fate never
invents arbitrary plot.

## Two key decisions (locked during brainstorming)

1. **Application timing: immediate, sim-layer.** Unlike `inject_npc` (which
   stages a discoverable entity), these verbs manipulate the always-on
   programmatic sim (`SettlementEventSystem` rolls events for every populated POI
   each tick, regardless of player attention). So the brain applies them
   immediately at deliberation time via the command queue; they are **not**
   staged-until-discovery.
2. **Direction: both ways.** `nudge_severity` can raise *or* lower severity;
   `bias_event` can force any of the 8 existing event types (harmful or
   benevolent). The Fate charter wording broadens from "amplify and escalate" to
   "amplify, escalate, or let fade — always grounded, never invented."

---

## Architecture

```
Fate brain (off-tick, async)
  │  deliberate(focus)
  │    buildFateContext  ──► enriched with each thread-settlement's active event
  │    generateWithTools(arm_staged_beat, nudge_event_severity, force_next_event)
  │    parseFateToolCalls ──► { beats, commands }
  │       beats    ──► staging.arm(beat)            (unchanged, inject_npc path)
  │       commands ──► emitCommand(cmd)             (NEW immediate path)
  ▼
CommandQueue.emit({ verb, source:'fate', ... })     (transient, cleared on scrub)
  ▼  next tick
CommandExecutorSystem ─► executeCommand ─► registry[verb].precondition/apply
  ▼
authoring-verbs.ts: nudgeSeverityApply / biasEventApply   (sim-layer, deterministic)
  ▼
world.activeEvents (severity mutated)  |  world.forcedEvents (next-event set)
  ▼
SettlementEventSystem.rollNewEvents consumes world.forcedEvents
```

Both verbs flip from `implemented: false` → `true` in
`CAPABILITY_REGISTRY` (`src/sim/command/registry.ts`), with effects added to the
existing `src/sim/command/authoring-verbs.ts` (alongside `inject_npc`). **Neither
verb needs `ctx.rng`** — they are pure mutations of existing state, so the
`no-random-in-sim` guard is unaffected. (The forced event's severity/duration are
still rolled by `SettlementEventSystem`'s own seeded RNG, so replay determinism
holds.)

The staging path (`arm_staged_beat` → `inject_npc`) is untouched. This work adds a
**parallel immediate path** the brain uses for these two verbs.

---

## The two verbs

### `nudge_severity`

- **Target:** `{ kind: 'settlement', poiId }`
- **Payload:** `{ delta: number }` — signed; magnitude capped at `±0.5` per call.
- **Effect:** for every active event at `poiId`, set
  `severity = clamp(severity + delta, 0.05, 1.0)`. The `0.05` floor keeps the
  event meaningful (still has a need effect) even when Fate eases it; `1.0` is the
  natural ceiling.
- **Precondition (`nudgeSeverityPrecondition`):**
  - target must be a settlement with a `poiId` → else `invalid_target`
  - `delta` must be a finite number → else `invalid_payload`
  - the POI must have ≥1 active event → else `precondition_failed`
- **`describe`:** `nudge severity of <poi> event by <delta>`

### `bias_event`

- **Target:** `{ kind: 'settlement', poiId }`
- **Payload:** `{ eventType: SettlementEventType }` — one of the 8 existing types.
- **Effect:** `world.forcedEvents.set(poiId, eventType)` — a one-shot "the next
  event rolled here will be this type".
- **Precondition (`biasEventPrecondition`):**
  - target must be a settlement with a `poiId` → else `invalid_target`
  - `eventType` must be one of the 8 `SettlementEventType` values → else
    `invalid_payload`
- **`describe`:** `force next event at <poi> to be <type>`
- **Consumption** (in `SettlementEventSystem.rollNewEvents`): for a POI that has
  no active event, if `world.forcedEvents` holds a type for it, materialize that
  exact event type immediately — bypassing the probability roll **and** the
  per-type cooldown (Fate overrides) — then `world.forcedEvents.delete(poiId)`.
  Severity (`0.3–0.7`) and duration are rolled by the system's existing seeded RNG
  exactly as for a natural event; a `settlement_begin` event is logged as usual.

### Drift guard (both verbs)

In addition to the sim-layer preconditions above, the **brain only ever targets a
settlement already under an active thread**: the tool-parse layer validates
`poiId ∈ validPoiIds` (the same `validPoiIds` set the Fate context already builds
for `arm_staged_beat`). Ungrounded tool calls are dropped with a `console.warn`,
exactly like staged beats today. So Fate amplifies existing, recognized stories —
never a random settlement.

---

## New persistent state

`world.forcedEvents: Map<string, SettlementEventType>` on `World`
(`src/world/world.ts`), mirroring the existing `world.activeEvents`.

Snapshot integration in `src/core/snapshot.ts`, identical shape to `activeEvents`:

- `Snapshot` gains `forcedEvents: [string, SettlementEventType][]`
- capture: `for (const [poiId, type] of state.world.forcedEvents) forcedEvents.push([poiId, type])`
- restore: `for (const [poiId, type] of snap.forcedEvents ?? []) fresh.forcedEvents.set(poiId, type)`

The `?? []` makes restore tolerant of older snapshots that lack the field, so
**existing IndexedDB autosaves load fine and `SAVE_VERSION` does not bump**
(additive, same approach used for `NpcProperties.fateRole` in sub-project #3).

---

## Brain integration

### Two new immediate tools (`src/game/fate/fate-tools.ts`)

Two separate, clearly-named tools (clearer for the LLM than one overloaded tool;
each maps 1:1 to a verb):

- **`nudge_event_severity`** — params `{ subjectPoiId: string, delta: number }`
  - description: raise (positive) or lower (negative) the intensity of the
    settlement's current event; only for a settlement listed with an active event.
- **`force_next_event`** — params `{ subjectPoiId: string, eventType: enum(8) }`
  - description: steer what event befalls the settlement next, from the listed
    event vocabulary.

`arm_staged_beat` is unchanged. The system charter is updated to mention the new
capability and the broadened direction.

### `parseFateToolCalls` returns `{ beats, commands }`

The parser is restructured to return both staged beats (as today) and immediate
commands:

```ts
export interface ParsedFateActions {
  beats: Array<Omit<StagedBeat, 'id' | 'status'>>;
  commands: Array<Omit<Command, 'seq'>>;
}
export function parseFateToolCalls(calls, ctx: FateToolCtx): ParsedFateActions
```

- `arm_staged_beat` → a beat (unchanged logic)
- `nudge_event_severity` → a `nudge_severity` command, if `subjectPoiId ∈
  validPoiIds` and `delta` is finite (clamped to `±0.5`); else dropped + warn
- `force_next_event` → a `bias_event` command, if `subjectPoiId ∈ validPoiIds`
  and `eventType` is one of the 8; else dropped + warn

All commands carry `source: 'fate'` and omit `seq` (typed `Omit<Command, 'seq'>`);
`CommandQueue.emit` stamps the monotonic `seq` when the brain emits them.

### `FateBrainService` (`src/game/fate/fate-brain-service.ts`)

- New dep: `emitCommand: (cmd: Omit<Command, 'seq'>) => void`.
- After parsing, the brain `staging.arm`s each beat (as today) **and**
  `this.deps.emitCommand`s each command.
- `onArmed` observability seam unchanged (beats only).

### `game.ts`

Wire `emitCommand: (cmd) => this.commandQueue.emit(cmd)` into the
`FateBrainService` construction.

### Enriched Fate context (`src/game/fate/fate-context.ts`)

`describeThreadsForFate` augments each settlement-thread line with its current
active event so the brain can choose the right lever:

```
- thread 3: trial at "Dunharrow" (poi-7), phase rising; active event: drought (severity 0.45)
- thread 5: loss at "Bywater" (poi-2), phase climax; no active event
```

It reads `state.world.activeEvents.get(poiId)` for each enumerated thread POI.

---

## Testing

| Area | Cases |
|------|-------|
| `authoring-verbs` (`nudge_severity`) | raises severity + clamps at 1.0; lowers + clamps at 0.05; declines (`precondition_failed`) when no active event; rejects non-finite delta (`invalid_payload`) |
| `authoring-verbs` (`bias_event`) | sets `world.forcedEvents`; rejects unknown eventType (`invalid_payload`); rejects non-settlement target (`invalid_target`) |
| `settlement-event-system` | a forced type materializes that exact event on the next eligible tick, bypassing probability + cooldown, then clears from `forcedEvents`; a POI with an active event ignores its forced entry until the event ends |
| `fate-tools` | parse returns `commands` for nudge/force; drops ungrounded `subjectPoiId`, bad `eventType`, non-finite `delta`; caps `delta` to `±0.5`; `arm_staged_beat` still yields a beat |
| `fate-context` | a thread line includes the settlement's active event (type + severity); "no active event" when none |
| `snapshot` | `forcedEvents` round-trips capture→restore; a snapshot lacking the field restores to an empty map |
| `fate-brain-service` | given mock tool calls, the brain emits immediate commands via `emitCommand` AND arms beats |
| integration | brain forces an event → `SettlementEventSystem` materializes it; brain nudges → an active event's severity shifts |

Determinism: the two verb effects use no randomness, so
`tests/unit/no-random-in-sim.test.ts` stays green. The forced event's
severity/duration come from `SettlementEventSystem`'s seeded RNG, preserving
replay determinism.

---

## Out of scope

- Player-facing access to these verbs (they are Fate-only, authoring tier).
- New event types — Fate works only within the existing 8.
- Staged/latent variants of these verbs (immediate only, per decision #1).
- Multi-event POIs beyond what the sim already produces (the system caps at one
  active event per POI; `nudge_severity` iterates defensively regardless).
