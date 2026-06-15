# S0 — Command/Query bus (spec)

**Date:** 2026-06-15 · **Status:** ✅ IMPLEMENTED (2026-06-15) — `GameQuery`
(`src/game/game-query.ts`) + `GameBus` (`src/game/game-bus.ts`) built and wired
into `game.ts`; `__debug` shimmed onto `GameQuery`; `window.__bus` exposed;
`game-query.test.ts` + `game-bus.test.ts` green. ·
**Parent:** [WebGPU UI + MCP integration brainstorm](2026-06-15-webgpu-ui-mcp-integration-design.md)
· **Related:** [command channel + capability registry](2026-06-03-command-channel-capability-registry-design.md)

## Goal

Establish the **one seam both the WebGPU UI and the MCP bridge consume**: a
single `GameBus` exposing **emit/preview commands** + **read-only queries** +
**capability introspection** + **event subscription**. "Who asked" (human click
vs Claude tool-call) is decoupled from "what happens."

**Crucial discovery — the command half already exists.** The 2026-06-03 command
channel is live and mature:

- `CommandQueue.emit()` / `drain()` (`src/sim/command/command-queue.ts`) — transient
  FIFO, cleared on snapshot restore.
- `previewCommand()` / `executeCommand()` + `CommandExecutorSystem`
  (`src/sim/command/command-system.ts`) — validate against the registry, structured
  rejections, drained at tick top.
- `CAPABILITY_REGISTRY` (`src/sim/command/registry.ts`) — one `CapabilityDef` per
  verb (`verb`, `tier`, `cost`, `targetKind`, `implemented`, `precondition`,
  `apply`, **`describe(cmd)` — already "human/agent-readable, for Fate
  introspection"**).
- `Command.source` is already `'player' | <rivalId> | 'fate' | 'author'`
  (`src/sim/command/types.ts`); rivals emit via `rival-adapter.ts`, the player via
  `DivineActionsController` (`src/game/divine-actions-controller.ts`).
- Replay-honesty already solved per tier: editor-tier → `AuthorCommandLog`
  re-emission; authoring/divine effects → world snapshot + `EventLog` narrative.

So S0 does **not** build a command bus. It adds the **missing read side** and the
**thin facade** that unifies the two, and exposes the registry as data so UI
affordances and MCP tools are generated from one source.

## Non-goals (later slices)

- The MCP server / WebSocket bridge (S4) — S0 only makes the bus it will call.
- Any WebGPU UI (S1+) — S0 is headless, Node-testable.
- New verbs or filling in `implemented:false` authoring `apply`s — that's the Fate
  track; S0 surfaces them as-is (declared, not-implemented).
- Conversation UI, screenshots-over-the-wire (S5) — `query.screenshot()` returns
  the dataURL; transporting it is the bridge's job.
- Replacing `DivineActionsController` — it stays as the player's emitter (it owns
  cosmetics/optimistic flash); it will simply emit *through* the bus.

## Design

### A new read-only facade: `GameQuery` (`src/game/game-query.ts`)

Pure reads over `GameState` — never mutates, snapshot-consistent (reads the live
world; callers that need a frozen view take it at a tick boundary). Subsumes and
extends `__debug`'s read verbs.

```ts
export interface GameQuery {
  worldSummary(): WorldSummary;                 // name, map dims, counts by kind, tick, era
  npcs(filter?: QueryOpts): NpcView[];          // World.query passthrough → compact views
  npc(id: EntityId): NpcDetail | null;          // belief per spirit, needs, mood, relationships, home
  beliefState(spiritId?: SpiritId): BeliefView; // believers, power, regen, aggregate faith/u/d
  settlement(poiId: string): SettlementView | null;
  events(sinceId?: number): AppendedEvent[];    // delegates to EventLog.since
  timeline(): TimelineView;                      // rate, current tick, commits, scrub state
  spirits(): SpiritView[];
  screenshot(): string;                          // canvas.toDataURL (browser only; '' headless)
}
```

- `worldSummary`/`npcs`/`screenshot` reuse the exact logic already in
  `debug-api.ts` (`inventory`, `query`, `grab`).
- `events` delegates to `EventLog.since(id)` (already exists).
- Views are **compact, serializable DTOs** (no live `Entity`/`World` refs) so the
  MCP bridge can `JSON.stringify` them directly. This is the one real design
  task: define `NpcView`/`NpcDetail`/`BeliefView`/`SettlementView`/`TimelineView`
  as plain data derived from the world + spirits + clock + timeline.

### The unifying facade: `GameBus` (`src/game/game-bus.ts`)

```ts
export interface GameBus {
  emit(cmd: Omit<Command, 'seq'>): void;                 // → CommandQueue.emit
  preview(cmd: Command): RejectionReason | null;         // → previewCommand (read-only gate)
  capabilities(): CapabilityView[];                      // ← CAPABILITY_REGISTRY as data
  query: GameQuery;                                      // read side
  subscribe(fn: (e: AppendedEvent) => void): () => void; // → EventLog.subscribe (Fate push channel)
}

interface CapabilityView {                               // registry projected to plain data
  verb: CommandVerb; tier: 'divine'|'authoring'|'editor';
  cost: number; targetKind: 'npc'|'settlement'|'none'; implemented: boolean;
}
```

- `emit` is a 1-line delegate to the existing `CommandQueue` — **same queue the
  player and rivals use**, so Claude's commands inherit identical validation,
  gating, ordering, per-tier replay, and tick-boundary application. No new
  determinism surface.
- `capabilities()` projects `CAPABILITY_REGISTRY` to plain data. **The MCP tool
  surface (S5) and the UI's action affordances (S3) are both generated from
  this** — one source of truth for the verb vocabulary. (Tool *descriptions* can
  later pull `describe(cmd)`; S0 just exposes the static shape.)
- `subscribe` wraps `EventLog.subscribe` — this is the seam the MCP `event` push
  channel (S5, "Claude as Fate") and any reactive UI will hang off.

### Wiring (`src/game.ts`)

`Game` already owns `state` (with `world`, `spirits`, `eventLog`, `clock`), the
`CommandQueue`, and the `TimelineController`. S0 adds:

```ts
this.query = createGameQuery({ state, canvas, viewport });   // reuses debug-api deps
this.bus   = createGameBus({ queue: this.commandQueue, state, query: this.query });
```

`__debug` becomes a **thin shim over `this.bus.query`** (keep the existing surface
+ camera verbs `focusKind/focusXY/fitMap` for console/Playwright; back-compat, no
churn). `DivineActionsController` is unchanged in behaviour — it already builds
`Command{source:'player'}` and calls `queue.emit`; optionally it takes the `bus`
instead of the bare queue for symmetry (cosmetic).

### Replay-honesty note (corrects a brainstorm over-simplification)

The brainstorm said "every MCP mutation is recorded to `EventLog`." More precisely
— and already true — persistence is **per tier**: divine effects persist via the
**world snapshot + narrative `EventLog`**; editor-tier via **`AuthorCommandLog`
re-emission**; authoring-tier (Fate) via the **world snapshot**. Claude's commands
inherit whichever tier its verb belongs to, identically to player/rival/Fate.
**S0 adds no new persistence path** — it routes onto the existing one.

## Work (file-by-file)

| File | Change |
|---|---|
| `src/game/game-query.ts` | **New.** `createGameQuery(deps)` + the DTO types. Reuse `debug-api` read logic; add `npc`/`beliefState`/`settlement`/`timeline`/`spirits`/`events`. |
| `src/game/game-bus.ts` | **New.** `createGameBus(deps)` — emit/preview/capabilities/query/subscribe. ~40 LOC of delegation. |
| `src/game.ts` | Construct `query` + `bus`; expose as readonly fields; point `__debug` at `bus.query`. |
| `src/dev/debug-api.ts` | Re-implement read verbs as a shim over `GameQuery` (keep camera verbs + signature). |
| `src/game/divine-actions-controller.ts` | (Optional, cosmetic) accept `bus` instead of bare `queue`. |

## Tests (Node, no browser)

| Test | Asserts |
|---|---|
| `tests/unit/game-query.test.ts` | Build a seeded world; `worldSummary`/`npcs`/`npc`/`beliefState`/`events` return correct compact DTOs; DTOs are JSON-serializable (no circular `World` refs); `events(sinceId)` matches `EventLog.since`. |
| `tests/unit/game-bus.test.ts` | `emit` enqueues onto the real queue and the command applies next tick (belief/power changes via `query`); `preview` matches `previewCommand`; `capabilities()` lists every registry verb with correct tier/cost/implemented; `subscribe` fires on an appended `SimEvent` and the unsubscribe stops it. |
| existing channel tests | Untouched — S0 adds no command-path behaviour. |

## Acceptance

- One `GameBus` object both a UI and an MCP bridge can hold; no consumer reaches
  into `state`/`world`/`queue` directly for command-or-query.
- `capabilities()` is the single introspection source (drives S3 affordances + S5
  tools).
- All DTOs JSON-serializable end-to-end (MCP-ready).
- Full suite green; no determinism/replay change (pure-read additions + delegation).
