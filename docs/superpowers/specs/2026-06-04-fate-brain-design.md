# Fate Brain — Autonomous Narrative Producer (Track 4 #3)

**Date**: 2026-06-04
**Status**: Approved — ready for planning
**Track**: Track 4 (Fate / the DM agent), sub-project #3 — the *deciding* intelligence.
**Anchored on**: [VISION.md](../../VISION.md) §2.1 (Fate is reactive), §2.3 (attention/realization), §9 #5; [ROADMAP.md](../../ROADMAP.md) Track 4.
**Builds on**: the [narrative substrate](2026-06-04-narrative-substrate-design.md) (threads + staging), the [command channel + capability registry](2026-06-03-command-channel-capability-registry-design.md), and the [Create-panel tool-calling](2026-06-03-create-panel-world-authoring-design.md) (`generateWithTools`, `llmClientCapable`).

---

## 1. Why

The narrative substrate **senses** (recognizers open/advance plot threads) and **stages** (armed beats materialize on discovery), but the *deciding* half is a deterministic placeholder: `stageStrangerOnHardship` (`src/sim/threads/stub-producer.ts`) hard-codes "settlement trial reaches `hardship` → arm a beggar." The substrate spec named its own successor:

> "The *authoring intelligence* … is the future **Fate LLM brain (Track 4)**, explicitly out of scope. … the brain later **replaces the stubs as a producer**."

This spec lands that brain: an autonomous LLM that reads thread + world state and authors staged beats, replacing the stub when a capable model is configured. It also wires Fate's first real **escalation lever** — the declared-but-unimplemented `inject_npc` verb.

## 2. Scope (decided)

| Decision | Choice |
|---|---|
| Ambition | **Minimal brain + one escalation lever.** Not the full escalation ladder / anti-grinding / anti-snowball. |
| Trigger | **Event-driven (reactive)**, with a cooldown. No periodic heartbeat in v1. |
| Escalation verb | **`inject_npc`** (a stranger arrives — preacher / skeptic / refugee). |
| Output model | **Everything staged** (latent until discovered). `inject_npc` rides as a staged beat's `hard` payload; nothing fires immediately. |
| Stub producer | **Kept as the deterministic offline fallback** — runs only when no capable LLM is configured; suppressed when the brain is active (no double-arming). |

### Out of scope (deferred)

Escalation ladder & pacing policy; anti-grinding detection; **Fate-resists-ascension** pushback; the other authoring verbs (`bias_event`, `nudge_severity`); a periodic heartbeat trigger; player-facing Fate UI; rival coaching / player-modelling (Track 3 owns player-modelling). Multi-turn read loops (v1 is single-shot tool-calling, like the Create panel).

## 3. Determinism & persistence (the spine)

The brain is an **LLM call: non-deterministic and async**. It therefore must **never** run inside a sim tick — it mirrors `LlmBackfillService`:

- Lives in **`src/game/fate/`** (game/orchestration layer), **not `src/sim/`**, so `src/sim/` stays `Math.random`-free (the `tests/unit/no-random-in-sim.test.ts` guard is untouched).
- It applies its decisions by calling **`StagingBuffer.arm()`** directly. Armed beats already serialize **inside `Snapshot`** (`captureSnapshot`), so they ride both timeline-scrub and `SaveFile` persistence for free — **no `SAVE_VERSION` bump**. This is the same full-state-snapshot model the LLM belief-writeback already relies on (LLM mutations aren't replay-reproducible; persistence is full-state, not deterministic replay).
- Gated on **`llmClientCapable !== null`** *and* **`!timeline.isScrubbed`** (the persistence-controller guard) — Fate does not deliberate while the player is scrubbing the past.
- **Single-flight**: at most one `deliberate()` in flight; a trigger fired while a call is pending is dropped (the cooldown will re-offer).

The materialization of a fired beat (`inject_npc` spawning an NPC) runs through the **existing deterministic command executor** on a sim tick — so the *world mutation* stays seeded/deterministic; only the *decision to arm* is LLM-driven and off-tick. This is the same hard/soft split the substrate already uses.

## 4. Reactive trigger — `src/game/fate/fate-trigger.ts`

A thin `EventLog` subscriber that decides *when* to wake the brain.

```ts
export interface FateTriggerDeps {
  clock: SimClock;
  cooldownTicks: number;                 // min sim-tick gap between deliberations (e.g. 480 = ~5 game-days)
  isReady: () => boolean;                // llmClientCapable !== null && !timeline.isScrubbed && !inFlight
  onTrigger: (focus: FateFocus) => void; // schedules deliberate()
}
export interface FateFocus { event: SimEvent; threadId?: ThreadId; }
```

**Significant events** (the only ones that wake Fate):
- `thread_advanced` whose `weight === 'climax'` — a story reaches its turning point.
- `thread_opened` — a new arc begins.
- `thread_resolved` — an arc closes (Fate may stage an aftermath).

(These are exactly the substrate's `thread_*` lifecycle events — Fate reacts to *recognized story*, not raw sim noise, which keeps it grounded and cheap.) On a significant event, if `isReady()` and `clock.now() - lastDeliberationTick >= cooldownTicks`, it stamps `lastDeliberationTick` and calls `onTrigger(focus)`. `lastDeliberationTick` is **transient** (the trigger is a runtime orchestrator, not sim state) — after a reload Fate may deliberate one cycle sooner, which is harmless.

## 5. The brain — `src/game/fate/fate-brain-service.ts`

```ts
export interface FateBrainDeps {
  getState: () => GameState;
  getCapableClient: () => LLMClient | null;
  isScrubbed: () => boolean;
  onArmed?: (beat: StagedBeat) => void;   // optional hook for logging/tests
}

export class FateBrainService {
  private inFlight = false;
  isReady(): boolean;                      // client != null && !isScrubbed() && !inFlight
  async deliberate(focus: FateFocus): Promise<void>;
}
```

`deliberate(focus)`:
1. Re-check `isReady()`; set `inFlight = true` (cleared in `finally`).
2. Build the Fate context (`fate-context.ts`).
3. `client.generateWithTools(messages, FATE_TOOLS)`.
4. Parse + validate tool calls (`fate-tools.ts`) → for each valid `arm_staged_beat`, call `staging.arm(beat)` and set `thread.vars.staged = 1` on the focus thread (cooperates with the stub's once-per-thread guard); emit `onArmed?`.
5. On any error (no tool call, invalid client, network) — log a warning and no-op. **Silent-failure rule:** failures are logged via `console.warn('[fate] …')`, never swallowed; a failed deliberation simply arms nothing.

## 6. Fate context — `src/game/fate/fate-context.ts`

Builds the prompt. Reuses `buildWorldSummary(state)` for the world digest and adds a **threads digest** + the **triggering focus**:

```ts
export function buildFateContext(state: GameState, focus: FateFocus): { system: string; user: string };
```

- **System**: Fate's charter — *"You are Fate. You are impersonal and reactive. You amplify and escalate what the mortals' story already produces; you never invent arbitrary plot. You may prepare content to be discovered, grounded in what is already happening. Stage at most one beat."* Plus the rule that `subjectPoiId` MUST be one listed below.
- **User**: the world digest + an enumerated list of **active threads** (`id`, `shapeId`, `phase`/weight, subject — only settlement-subject threads are stageable in v1) + a one-line description of the **triggering event**. The enumerated settlement `poiId`s are the *only* valid `subjectPoiId` values; the validator rejects anything else (drift guard, mirroring the Create panel).

A threads digest helper (`describeThreadsForFate(state)`) lists active threads compactly; settlement subjects resolve to their `poiId` + name from `worldSeed.pois`.

## 7. The tool — `src/game/fate/fate-tools.ts`

A **single** constrained tool. (Single-tool keeps v1 legible and the validation tight.)

```ts
export const FATE_TOOLS: LLMTool[] = [{
  name: 'arm_staged_beat',
  description: 'Prepare a beat to be discovered at a settlement that is already part of an unfolding thread. ' +
    'The content stays hidden until the player notices that settlement. Stage at most one.',
  parameters: {
    type: 'object',
    properties: {
      subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads. Required.' },
      threadId:     { type: 'integer', description: 'The thread id this beat belongs to (from the list).' },
      hard:         { type: 'string', enum: ['inject_npc', 'none'],
                      description: "'inject_npc' = a stranger arrives; 'none' = atmosphere only." },
      role:         { type: 'string', enum: ['preacher', 'skeptic', 'refugee'],
                      description: 'If hard=inject_npc, who arrives.' },
      soft:         { type: 'string', description: 'One line of atmosphere/narration primed on discovery.' },
    },
    required: ['subjectPoiId', 'hard'],
  },
}];
```

Parser/validator: `parseFateToolCalls(calls, ctx): Array<Omit<StagedBeat,'id'|'status'>>`.
- Reject (drop with a warning) any call whose `subjectPoiId` is not in `ctx.validPoiIds`.
- `hard === 'inject_npc'` → `hard: [{ verb:'inject_npc', source:'fate', target:{kind:'settlement', poiId}, payload:{ role: role ?? 'refugee' }, seq:0 }]`. `hard === 'none'` → `hard: []`.
- `soft` present → `soft: { kind:'location_vibe', text: soft }`.
- `trigger: { kind:'discovery' }` (fixed in v1); `subject: { kind:'settlement', poiId }`; `threadId` if valid; `stagedTick: now`.

This is the seam that **replaces `stageStrangerOnHardship`**: same end shape (`StagingBuffer.arm` with a settlement subject, a `hard` spawn-style command, a `location_vibe` soft line, discovery trigger), authored by the LLM instead of hard-coded.

## 8. The escalation lever — `inject_npc`

Implement the declared capability (currently `implemented: false`). New apply in **`src/sim/command/authoring-verbs.ts`** (a new sibling to `editor-verbs.ts`, keeping the authoring tier distinct), reusing the spawn helpers exported from `editor-verbs.ts` (`resolveCenter`/`findPlacement`/`initNpcProps` pattern, or a shared extraction).

```ts
const FATE_ROLES = ['preacher', 'skeptic', 'refugee'] as const;
// payload: { role: 'preacher'|'skeptic'|'refugee', poiId: string }
export function injectNpcPrecondition(cmd, ctx): RejectionReason | null;  // poiId resolves to a center, role valid
export function injectNpcApply(cmd, ctx): boolean;                        // spawn ONE npc, faith 0, near the poi
```

- **Role mapping**: `preacher`/`skeptic`/`refugee` are Fate-narrative roles; they map to existing `NpcRole`s for the sim (e.g. `preacher`→`priest`, `skeptic`→`elder`, `refugee`→`beggar`) and the Fate role is recorded in a prop (e.g. `props.fateRole`) for later narration. (Mapping table lives in `authoring-verbs.ts`; no new `NpcRole` enum churn.)
- Always spawns **exactly one**, `faith: 0` (a stranger to convert/contest), founder of its own lineage — same machinery as `spawnApply`.
- Registry entry flips to `implemented: true`, tier `authoring`, `targetKind: 'settlement'`, with `precondition` + `apply` + `describe`.

Because it's the `hard` payload of a **discovery-armed** beat, the injected stranger does not appear until the player discovers the settlement — honoring "latent until discovered."

## 9. Stub producer → deterministic fallback

`PlotThreadSystem` gains an optional **`isProducerActive?: () => boolean`** predicate (default `() => true`). Stub producers run only when it returns true. `game.ts` passes `() => this.llmClientCapable === null`, so:

- **No capable LLM** → stub `stageStrangerOnHardship` runs (offline loop stays alive; all existing substrate tests unaffected — they construct the system without the predicate, defaulting on).
- **Capable LLM configured** → stub suppressed; the brain owns staging.

The brain additionally sets `focus thread.vars.staged = 1` when it arms, so even across the live-config switch there is no double-arm for a given thread.

## 10. Integration — `src/game.ts`

- Construct `FateBrainService` (deps from existing fields: state getter, `() => this.llmClientCapable`, `() => this.timeline.isScrubbed`).
- Construct `FateTrigger` subscribed to `state.eventLog`; `onTrigger` → `void fateBrain.deliberate(focus)`; `isReady` → `fateBrain.isReady()`.
- Pass the producer gate `() => this.llmClientCapable === null` into the `PlotThreadSystem` constructor.
- `applyLlmConfig` already rebuilds `llmClientCapable` live — the getters mean the brain/stub switch follows with no extra wiring.

## 11. Testing

Deterministic throughout; the LLM is always a **mock capable client** returning canned tool calls (never a live call in tests).

- **`inject_npc` capability** (`authoring-verbs.test.ts`): precondition rejects unknown `poiId` / invalid role; apply spawns exactly one NPC of the mapped role, `faith 0`, on a realized walkable tile near the POI; seeded → deterministic id/placement; emits a spawn event.
- **`fate-tools`**: a valid `arm_staged_beat` → one beat with the right `hard`/`soft`/subject/trigger; `hard:'none'` → soft-only beat (empty `hard`); hallucinated `subjectPoiId` → dropped with no beat; missing `role` defaults to `refugee`.
- **`fate-context`**: includes the world roster, the active settlement threads (id/phase), and the triggering event; lists valid `poiId`s.
- **`FateBrainService`**: with a mock client returning a canned call, `deliberate()` arms exactly one beat and sets `vars.staged`; single-flight (second concurrent call no-ops); `isReady()` false when scrubbed or no client → `deliberate()` no-ops; a client returning **no** tool call arms nothing (and warns).
- **`FateTrigger`**: a `thread_advanced`(climax) within readiness schedules once; a second significant event inside the cooldown is suppressed; a non-significant event (`thread_advanced` rising) is ignored; not-ready (`isReady()` false) suppresses.
- **Producer gate** (`plot-thread-system` test): with `isProducerActive → false` the stub does not arm; default/true it does.
- **Integration (proof-of-life)**: seeded run → settlement hardship → `trial` reaches a climax-weight phase → `thread_advanced` wakes the mock brain → brain arms a `inject_npc:preacher` beat → discover the settlement → preacher materializes via the executor + vibe primed + `beat_fired` emitted.
- **Persistence**: arm a Fate beat → `captureSnapshot`/`restoreSnapshot` round-trip preserves it; a `SaveFile` round-trip preserves it; no `SAVE_VERSION` change.

## 12. VISION canon update (fold in now)

The substrate spec deferred the VISION §2.1 reconciliation paragraph until "the brain lands." It lands here, so add to **`docs/VISION.md` §2.1**:

> **Fate may prepare the stage.** Fate is still reactive: any content it stages must (a) **amplify or escalate an existing sim condition** (a recognized plot thread), never an arbitrary plot device, and (b) be **latent until discovered** — it materializes only when the player's attention reaches its subject. Fate sets out grounded possibilities; the sim and the player's attention decide which become real. (This is the attention/realization cosmology of §2.3 applied to narrative.)

## 13. File summary

**New:**
- `src/game/fate/fate-brain-service.ts`
- `src/game/fate/fate-trigger.ts`
- `src/game/fate/fate-context.ts`
- `src/game/fate/fate-tools.ts`
- `src/sim/command/authoring-verbs.ts` (the `inject_npc` precondition/apply + role map)
- `tests/unit/fate-brain-service.test.ts`, `tests/unit/fate-trigger.test.ts`, `tests/unit/fate-tools.test.ts`, `tests/unit/fate-context.test.ts`, `tests/unit/authoring-verbs.test.ts`, `tests/unit/fate-integration.test.ts`

**Modified:**
- `src/sim/command/registry.ts` (`inject_npc` → implemented, with precondition/apply)
- `src/sim/command/editor-verbs.ts` (export the shared spawn helpers, if extraction is needed)
- `src/sim/threads/systems/plot-thread-system.ts` (`isProducerActive` gate)
- `src/game.ts` (construct + wire `FateBrainService` + `FateTrigger`; pass the producer gate)
- `docs/VISION.md` (§2.1 reconciliation paragraph)
