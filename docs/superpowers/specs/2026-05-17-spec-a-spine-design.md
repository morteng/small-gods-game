# Spec A — The Spine

**Status:** Draft for review
**Date:** 2026-05-17
**Scope:** First of a five-spec arc establishing the architecture for temporal features, parallel universes, cutscenes, and the Book of [Spirit Name]. Spec A delivers the structural foundation: event log, system scheduler, first-class spirits with manifestation, NPCs as world entities, tile realization, cradle-style start, and a slim `game.ts`.

## Context

Small Gods is a deity simulation where belief flows through narrative. The codebase currently has a working NPC sim layer, divine actions (whisper), procedural map generation, and a unified entity/world model for buildings and decorations. Stories are already designed as the core belief-propagation mechanism (`docs/STORY_MECHANICS.md`).

The next phases of the game require subsystems that don't fit the current architecture:
- Rival spirits (the design's headline feature) — currently `'player'` is hardcoded in belief and power code
- Temporal mechanics — jump back, fork into parallel universes, slow/speed
- Cutscenes and a narrative "Book" view of play
- An interactive, belief-driven world that constructs itself as the player's followers reveal it

This spec lays down the spine these features will hang from. **The unifying insight:** a typed, append-only event log is simultaneously the bus the sim publishes on, the timeline that scrubbing operates over, the divergence point for parallel universes, the script format for cutscenes, and the source text the Book of [Spirit Name] is written from. Building it once, well, replaces five future ad-hoc systems.

## Goals

1. Replace the hardcoded `'player'` spirit with a registry that supports rivals and player avatar/possession ("spirit riding") without further refactors.
2. Replace the hand-rolled tick logic in `game.ts` with a scheduler so adding new systems is registration, not threading through orchestration code.
3. Establish a typed event log as the canonical record of narrative-grade sim state changes.
4. Collapse NPC data (`state.npcs` + `state.npcSim`) into single `World` entities so spatial queries and the entity index work for NPCs natively.
5. Introduce a tile **realization** state so the world can start as a small bubble of reality around one believer and expand with belief — without yet committing to lazy WFC or the full Oracle system.
6. Slim `game.ts` from 602 lines (mixed concerns) to ~300 lines (pure orchestration).

## Non-goals

The following are deliberately out of scope and addressed in later specs:

- **Time scrub, replay, snapshots, time scaling** — Spec B.
- **Parallel universe branching** — Spec C.
- **Cutscene engine and director** — Spec D.
- **Chapter detection, Book viewer, narrative renderer** — Spec E.
- **Lazy/chunked WFC; on-demand terrain generation** — separate future spec.
- **The Oracle: DM-driven narrative override of realization** — separate future spec.
- **Endgame state machine (cradle → mid → sandbox)** — gameplay spec.
- **NPC drifts after the believer / camera-lock behavior** — gameplay spec.
- **Rival AI policy implementation** — gameplay spec (spirit data model is in scope; behavior is not).
- **Player avatar/possession controls** — gameplay spec (data model is in scope; input wiring is not).

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│ game.ts (slim orchestrator)                                 │
│   - DOM scaffolding, lifecycle, RAF loop                    │
│   - Composes RenderContext, calls scheduler + renderer      │
└───────┬─────────────────────────────────────────┬───────────┘
        │                                         │
        ▼                                         ▼
┌──────────────────┐                  ┌──────────────────────┐
│ Scheduler        │ ─── ticks ──▶    │ Systems              │
│  - tickHz/system │                  │   NpcMovementSystem  │
│  - rate scaler   │                  │   NpcSimSystem       │
│  - error isolate │                  │   SpiritSystem       │
└──────────────────┘                  │   PerceptionSystem   │
                                      └──────┬───────────────┘
                                             │
                  reads state, mutates state, emits events
                                             │
            ┌────────────────────────────────┼────────────────────┐
            ▼                                ▼                    ▼
   ┌────────────────┐               ┌──────────────────┐   ┌─────────────┐
   │ World          │               │ state.spirits    │   │ EventLog    │
   │  EntityReg     │               │   Map<id,Spirit> │   │  append()   │
   │  SpatialIdx    │               │  (omnipresent    │   │  subscribe()│
   │  KindIdx       │               │   identity)      │   │  since/range│
   │  TagIdx        │               └──────────────────┘   └──────┬──────┘
   │  Tile.state    │                                              │
   │  (void/        │                                              │
   │  realizing/    │                                              │
   │  realized)     │                              ┌───────────────┴────────┐
   └────────────────┘                              ▼                        ▼
                                            UI subscribers          Future: Book,
                                            (overlay refresh,       chapter detector,
                                            tooltip, panels)        LLM backfill
```

## Components

### 1. Event log

The append-only canonical record of narrative-grade state changes.

```ts
// src/core/events.ts

export type SimEvent =
  | { type: 'world_seeded';       worldSeed: WorldSeed; substrateSeed: number }
  | { type: 'spirit_birth';       spiritId: SpiritId; name: string; isPlayer: boolean }
  | { type: 'spirit_manifest';    spiritId: SpiritId; form: 'avatar'; at: { x: number; y: number } }
  | { type: 'spirit_possess';     spiritId: SpiritId; npcId: EntityId }
  | { type: 'spirit_unmanifest';  spiritId: SpiritId; reason: 'voluntary' | 'killed' | 'unhost' }
  | { type: 'spirit_gaze_shift';  spiritId: SpiritId; fromNpcId?: EntityId; toNpcId: EntityId }
  | { type: 'npc_spawn';          npcId: EntityId; role: NpcRole; poiId: string }
  | { type: 'whisper';            spiritId: SpiritId; npcId: EntityId }
  | { type: 'belief_cross';       npcId: EntityId; spiritId: SpiritId; kind: 'high' | 'low'; faith: number }
  | { type: 'mood_cross';         npcId: EntityId; kind: 'high' | 'low'; mood: number }
  | { type: 'power_depleted';     spiritId: SpiritId }
  | { type: 'region_realized';    region: Region; cause: 'belief_spread' | 'miracle' | 'cradle_start' }
  | { type: 'tile_collapsed';     x: number; y: number; becameType: string; by: 'wfc' | 'oracle' }
  | { type: 'entity_emerged';     entityId: EntityId; kind: string; x: number; y: number }
  | { type: 'system_error';       system: string; message: string };

export interface AppendedEvent {
  id: number;
  t: number;
  event: SimEvent;
}

export class EventLog {
  private events: AppendedEvent[] = [];
  private nextId = 1;
  private subscribers = new Set<(e: AppendedEvent) => void>();
  private clock: { now(): number };

  constructor(clock: { now(): number }) {
    this.clock = clock;
  }

  append(event: SimEvent): AppendedEvent {
    const appended: AppendedEvent = {
      id: this.nextId++,
      t: this.clock.now(),
      event,
    };
    this.events.push(appended);
    for (const fn of this.subscribers) fn(appended);
    return appended;
  }

  subscribe(fn: (e: AppendedEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  since(eventId: number): AppendedEvent[] {
    return this.events.filter(e => e.id > eventId);
  }

  range(tStart: number, tEnd: number): AppendedEvent[] {
    return this.events.filter(e => e.t >= tStart && e.t < tEnd);
  }

  /** Total events appended so far (= next id - 1). */
  size(): number { return this.events.length; }
}
```

**Design notes:**

- **Sim time, not wall time.** `t` is a tick count from a `SimClock` passed in. Time scaling in Spec B becomes a clock-rate change; the log remains a clean monotonic sequence.
- **Discriminated union.** TypeScript narrows on `event.type` in subscribers and the future replay reducer. New events = one union arm + one place that appends.
- **Narrative threshold events**, not per-tick deltas. `belief_cross` fires when faith crosses 0.3/0.6/0.9, not every tiny decay step. The log records *moments worth narrating*, which keeps it tractable for the Book and the future LLM backfill, and keeps determinism manageable.
- **Synchronous fan-out.** Subscribers receive events in the same tick they're emitted. Order is preserved.
- **Immutable after append.** Events cannot be edited or removed.

### 2. Scheduler and systems

```ts
// src/core/scheduler.ts

export interface SystemContext {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  clock: SimClock;
  dt: number;       // ms elapsed since this system last ticked
  now: number;      // current sim tick (clock.now())
}

export interface System {
  name: string;
  tickHz: number;   // 0 = manual; positive = scheduled by scheduler
  tick(ctx: SystemContext): void;
}

export class Scheduler {
  private systems: System[] = [];
  private accumulators = new Map<string, number>();
  private rateScale = 1;

  register(s: System): void {
    if (this.systems.some(x => x.name === s.name)) {
      throw new Error(`System already registered: ${s.name}`);
    }
    this.systems.push(s);
    this.accumulators.set(s.name, 0);
  }

  /** Called once per RAF from game.ts with real wall-time ms. */
  tick(realDtMs: number, ctxBase: Omit<SystemContext, 'dt' | 'now'>): void {
    const simDtMs = realDtMs * this.rateScale;
    ctxBase.clock.advance(simDtMs);
    const now = ctxBase.clock.now();

    for (const s of this.systems) {
      if (s.tickHz <= 0) continue;
      const interval = 1000 / s.tickHz;
      const acc = (this.accumulators.get(s.name) ?? 0) + simDtMs;
      if (acc >= interval) {
        try {
          s.tick({ ...ctxBase, dt: acc, now });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctxBase.log.append({ type: 'system_error', system: s.name, message: msg });
          console.error(`[scheduler] ${s.name} threw:`, err);
        }
        this.accumulators.set(s.name, acc - interval);
      } else {
        this.accumulators.set(s.name, acc);
      }
    }
  }

  /** Spec B will use this for slow/speed. */
  setRate(scale: number): void { this.rateScale = Math.max(0, scale); }
}

// src/core/clock.ts
export class SimClock {
  private ticks = 0;        // integer sim ticks
  private accumMs = 0;      // sub-tick accumulator
  private msPerTick: number;

  constructor(msPerTick = 16.667) { this.msPerTick = msPerTick; }
  advance(realMs: number): void {
    this.accumMs += realMs;
    while (this.accumMs >= this.msPerTick) {
      this.accumMs -= this.msPerTick;
      this.ticks++;
    }
  }
  now(): number { return this.ticks; }
}
```

**Systems registered in Spec A:**

| System | Hz | Replaces | Adds |
|---|---|---|---|
| `NpcMovementSystem` | 60 | `tickNpcMovement` + `updateNpcs` | — |
| `NpcSimSystem` | 1 | `tickAllNpcs` | belief/mood threshold detection → `belief_cross`/`mood_cross` events |
| `SpiritSystem` | 1 | `computePowerRegen` (called inline) | multi-spirit power regen; `power_depleted` events |
| `PerceptionSystem` | 2 | new | computes realized region from believers; `region_realized`/`tile_collapsed`/`entity_emerged` |

**Error isolation:** A throwing system logs a `system_error` event, gets its current tick skipped, and the loop continues. One bad system cannot kill the game.

### 3. Spirit registry and manifestation

```ts
// src/core/spirit.ts

export type SpiritId = string;

export type Manifestation =
  | { kind: 'avatar';     entityId: EntityId }
  | { kind: 'possessing'; npcEntityId: EntityId };

export interface Spirit {
  id: SpiritId;
  name: string;             // "Fooob" — what followers call this spirit
  sigil: string;            // emoji or sprite key
  color: string;
  isPlayer: boolean;
  power: number;
  manifestation: Manifestation | null;
  ai?: { policy: string; cooldowns: Record<string, number> };
}
```

**Stored as:** `state.spirits: Map<SpiritId, Spirit>`. Spirits are omnipresent identities; they do not live on the tile grid. This is the right call because forcing `x/y` onto an omnipresent entity creates bugs ("why is the rival drawn at 0,0?") and because the spirit's body, when it has one, is a separate concrete entity in `World`.

**Manifestation forms:**

- **Avatar** — `World` contains an `Entity { kind: 'avatar', x, y, properties: { spiritId, ... } }`. The spirit's `manifestation` points to it. Avatar is render-able, query-able, and can be the target of attacks or interactions.
- **Possession** — the NPC entity gets a property `possessedBy: SpiritId`. The NPC is unchanged in identity; it just gains a marker that `NpcMovementSystem` and `NpcSimSystem` consult.

**Sim contract during possession (Spec A locks the rule, defers controls):**

- The NPC's sim tick still runs (body still has needs, beliefs still drift). The host is alive.
- The NPC's `whisperCooldown`, mood, needs continue evolving.
- `NpcMovementSystem` skips autonomous movement for possessed NPCs; input dispatch (future gameplay spec) will move them instead.
- On entry to possession, the possessing spirit's belief in the host is forcibly boosted; the resulting `belief_cross` event will fire from the sim if a threshold is crossed. ("The priest came to know what no man should — and was changed.")

**Replacements:**

| Old code | New code |
|---|---|
| `state.playerPower` | `state.spirits.get('player')!.power` |
| `sim.beliefs['player']` | `sim.beliefs[spiritId]` (key is already a string; just stops being hardcoded) |
| `computePowerRegen(npcSim): number` | `computeRegenPerSpirit(spirits, world): Map<SpiritId, number>` (consumed by `SpiritSystem`) |
| `whisperNpc(sim, playerPower): number` | `whisper(spirit, npcEntity, log): void` (mutates spirit and entity; appends event) |

### 4. NPCs as `World` entities

`NpcInstance` and `NpcSimState` are removed. NPC data lives in `Entity.properties` for entities with `kind: 'npc'`.

```ts
export interface NpcProperties {
  // identity
  name: string;
  role: NpcRole;
  seed: number;
  // movement / animation
  direction: Direction;
  frame: number;
  frameTimer: number;
  moveCooldown?: number;
  // home
  homeBuildingId?: string;
  homePoiId?: string;
  // sim
  personality: NpcPersonality;
  beliefs: Record<SpiritId, SpiritBelief>;
  needs: NpcNeeds;
  mood: number;
  whisperCooldown: number;
  // possession
  possessedBy?: SpiritId;
  // narrative breadcrumb refs
  recentEventIds: number[];
}
```

Position lives in `Entity.x` / `Entity.y` (already sub-tile capable).

**Removed from `GameState`:**
- `npcs: NpcInstance[]`
- `npcSim: Map<string, NpcSimState>`
- `playerPower: number` (moves to `spirits.get('player').power`)

**Added to `GameState`:**
- `spirits: Map<SpiritId, Spirit>`
- `eventLog: EventLog`
- `clock: SimClock`
- `cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId }`

**Owned by `Game` (the class), not by `GameState`:**
- `scheduler: Scheduler` — orchestration concern. Accumulators are derived from real wall-clock and don't need to roundtrip through snapshots. Spec B's replay will reconstruct the scheduler from `GameState.clock`.

The split rule: `GameState` is *what to snapshot* (the simulation, the timeline, the world). `Game` is *what orchestrates* (the loop, the scheduler, DOM bindings).

**Helpers:**

```ts
// src/world/npc-helpers.ts
export function getNpc(world: World, id: EntityId): Entity | undefined { ... }
export function npcProps(e: Entity): NpcProperties { return e.properties as NpcProperties; }
export function forEachNpc(world: World, fn: (e: Entity) => void): void { ... }
export function queryNpcs(world: World, opts?: { region?: Region }): Entity[] { ... }
```

**Renderer compatibility:** `renderer.ts` and `npc-animator.ts` are not rewritten in this spec. A thin shim `toRenderNpc(e: Entity): RenderableNpc` adapts the entity shape to what the renderer expects today. Renderer-internal cleanup is a later opportunistic refactor.

### 5. Tile realization

A structural seam to let the world start tiny and grow with belief, without yet committing to lazy WFC or the Oracle.

```ts
export type TileState = 'void' | 'realizing' | 'realized';

export interface Tile {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  state: TileState;
  realizedAt?: number;   // sim tick when collapsed; for the Book
  height?: number;
  bridgeDirection?: string;
}
```

**Substrate vs realization:**

- WFC still runs at game start and computes a deterministic substrate (the "would-be" type of every tile, given the seed).
- Tiles start as `state: 'void'`. Only the cradle bubble (Section 6) is set to `'realized'` initially.
- When `PerceptionSystem` realizes a tile in Spec A, it transitions `void → realized` directly in one tick and fires `tile_collapsed`. The intermediate `'realizing'` value is defined in the type for future use (Spec D collapse animation, Oracle override window) but is **not produced by any code in Spec A**. Defining it now means later specs add behavior without changing the type shape or migrating data.
- The Oracle (later spec) will be able to *override* the WFC value at realization time. Default Oracle = "use WFC value." Spec A wires the seam (`oracle.realizeTile(x, y, wfcType) => realType`) with a stub identity implementation.

**Renderer behavior in Spec A:**
- Draws `'realized'` tiles normally. Also draws `'realizing'` tiles as if `'realized'` (forward-compatible no-op since `'realizing'` never appears in Spec A).
- Void tiles draw nothing — the background color shows through. (A more sophisticated void treatment — dithering, dream-mist, abstract pattern — is Spec D.)

**Other systems consulting realization:**
- `NpcMovementSystem` confines NPCs to realized tiles.
- `PerceptionSystem` (Section 6) is the only writer of `Tile.state`.

### 6. PerceptionSystem and the cradle start

**`PerceptionSystem`** (registered at 2Hz) computes the realized region each tick from believers:

```
realized_region = union over all NPCs n:
  ball(center = (n.x, n.y),
       radius = base_radius + faith_bonus(strongest_belief(n)))
```

Where:
- `base_radius` = 3 tiles
- `faith_bonus(faith)` = `floor(faith * 4)` → up to +4 tiles for max-faith NPC
- Strongest belief = max faith across all spirits the NPC believes in

When the system computes a new region that exceeds the previous one, it:
1. Appends `region_realized` once for the bounding diff
2. For each tile transitioning `void → realizing`, schedules a `tile_collapsed` event (debounced 2 ticks later when state becomes `realized`)
3. For any entity on a newly-realized tile, appends `entity_emerged`

**Determinism:** Order of tile collapses within a single `region_realized` is determined by Chebyshev distance from the believer's tile, then x, then y — stable across runs.

**Cradle start.** `seedWorld()` replaces `generateWorld()`:

```
1. Load WorldSeed (default or provided).
2. Run WFC over full grid to compute substrate (deterministic).
3. Set every tile to state: 'void'.
4. Create state.spirits and add the player spirit. Append spirit_birth.
5. Pick the seed POI (configured in WorldSeed; default: first village).
6. Spawn one NPC at that POI as an Entity (kind: 'npc'), faith ≈ 0.2 in player.
   Append npc_spawn.
7. Center camera on that NPC; set cameraLock = { mode: 'follower', targetId: npcId }.
8. Run PerceptionSystem once synchronously to realize the initial bubble.
   It will append region_realized { cause: 'cradle_start' } and tile_collapsed events.
9. Append world_seeded as the final cradle event (chapter zero marker for the Book).
10. Start the loop.
```

Player-experienced behavior: game opens to a small island of realized world around one NPC, surrounded by void. Camera locked to the believer until ≥2 followers (gameplay rule, future spec — but the data structure supports it now).

### 7. Slim `game.ts`

Target ~300 lines. Pure orchestrator.

**Stays in `game.ts`:**
- DOM scaffolding (canvas, panels, settings button, tooltip)
- Lifecycle (`constructor`, `destroy`, `resize`, `resizeObserver`)
- Main RAF loop: `scheduler.tick(realDt, ctxBase); render();`
- Render-context assembly
- Camera state and follow logic (presentation-only mutation)
- Hover tile / fps / debug HUD

**Extracted:**

| New file | Responsibility |
|---|---|
| `src/sim/spawner.ts` | `spawnSeedBeliever(world, log, worldSeed, map): EntityId` and (eventually) other spawn routines |
| `src/render/asset-manager.ts` | `class AssetManager` — loads and caches terrain/building/tree/atlas sprites |
| `src/ui/overlay-dispatcher.ts` | Generic action registry; replaces `'whisper'` switch in `onCanvasClick` |
| `src/sim/spirit-system.ts` | `class SpiritSystem implements System` |
| `src/world/perception-system.ts` | `class PerceptionSystem implements System` |
| `src/sim/systems/npc-movement-system.ts` | Wraps existing movement logic in `System` interface |
| `src/sim/systems/npc-sim-system.ts` | Wraps `tickAllNpcs`; adds threshold detection |
| `src/sim/whisper.ts` | `function whisper(spirit, npcEntity, log): void` (replaces inline whisper handling) |
| `src/core/events.ts` | Event types + `EventLog` |
| `src/core/scheduler.ts` | `Scheduler`, `System`, `SystemContext` |
| `src/core/clock.ts` | `SimClock` |
| `src/core/spirit.ts` | `Spirit`, `SpiritId`, `Manifestation` |
| `src/world/npc-helpers.ts` | `getNpc`, `npcProps`, `queryNpcs`, etc. |

## Data flow

A single sim tick of the new architecture:

```
1. game.ts RAF fires with realDt ms since last frame
2. game.ts calls scheduler.tick(realDt, { world, spirits, log, clock })
3. scheduler advances clock by realDt * rateScale
4. scheduler iterates registered systems:
   a. NpcMovementSystem (60Hz):  moves entities, skips possessed NPCs
   b. NpcSimSystem      (1Hz):   ticks beliefs/needs/mood; emits belief_cross,
                                 mood_cross on threshold crossings
   c. SpiritSystem      (1Hz):   regen power per spirit; emits power_depleted
                                 when spirit hits zero
   d. PerceptionSystem  (2Hz):   recomputes realized region from believers;
                                 emits region_realized, tile_collapsed,
                                 entity_emerged
5. game.ts assembles RenderContext (includes realized-only tile mask)
6. renderer.renderMap(ctx, rc) — unchanged interface; reads from world + spirits
7. UI subscribers (overlay refresh, tooltip, panels) reacted in step 4 already
   via EventLog subscriptions
```

A player whisper:

```
1. Player clicks the whisper overlay button
2. game.ts onCanvasClick hits an OverlayHitArea { id: 'whisper', payload: { npcId } }
3. overlayDispatcher dispatches to the registered handler
4. Handler resolves player spirit + target NPC entity, calls whisper(spirit, e, log)
5. whisper() mutates spirit.power and entity properties (faith, understanding,
   whisperCooldown, recentEventIds), then log.append({ type: 'whisper', ... })
6. EventLog subscribers (UI overlay) re-render the affected panels
```

## Error handling

| Boundary | Failure mode | Handling |
|---|---|---|
| `EventLog.append` | Missing `type` field | Throw — programmer error |
| `Scheduler.tick` per-system | System throws | Catch, append `system_error` event, log to console, skip this tick |
| `World.addEntity` | Duplicate id | Throw — already does |
| `PerceptionSystem` | Realize already-realized tile | No-op, no event |
| `Spirit lookup` | Missing spirit id | Throw — there should never be a dangling spirit reference |
| `getNpc` | Missing entity | Return `undefined`; callers handle defensively (UI deselects on missing target) |
| Possession of non-NPC entity | Wrong target | Throw at the action handler boundary, before event is appended |

The event log never contains failed actions. If `whisper` cannot proceed (no power, on cooldown), the action handler returns early without appending. Events are facts about what happened.

## Testing strategy

| Test file | What it covers |
|---|---|
| `tests/core/event-log.test.ts` | Append order, id monotonicity, `t` assignment, subscriber fan-out and unsubscribe, `since`, `range` |
| `tests/core/scheduler.test.ts` | Tick rate accumulator math, multiple systems at different Hz, rate scaling, error isolation (one throwing system doesn't break others), `system_error` event emitted |
| `tests/core/clock.test.ts` | `advance` correctly accumulates sub-tick ms, `now` is monotonic |
| `tests/core/spirit.test.ts` | Multi-spirit power regen, whisper credits correct spirit, manifestation transition events, possessedBy marker round-trip |
| `tests/world/npc-entity.test.ts` | NPC entities support spatial queries, properties round-trip, `npcProps` typing |
| `tests/world/perception-system.test.ts` | Cradle bubble matches believer position, region grows with faith, `region_realized` fires only on growth, `tile_collapsed` fires once per tile, deterministic order |
| `tests/sim/whisper.test.ts` | Whisper mutates correct spirit + entity, emits event, respects cooldown and power |
| `tests/ui/overlay-dispatcher.test.ts` | Action registration, hit-area dispatch, unknown actions ignored |
| `tests/integration/cradle-start.test.ts` | `seedWorld()` produces the expected initial event sequence (`spirit_birth` → `npc_spawn` → `region_realized` → `world_seeded`) and exactly one realized region |
| `tests/integration/determinism.test.ts` | Same seed + same scripted player actions → identical event log (critical prep for Spec B replay) |

Existing 510 tests are updated where they reference `state.npcs` or `state.npcSim` — most just swap to `getNpc(world, id)` / `npcProps(e)`.

## Migration order (suggested PR sequence)

Each PR ships green, with the game runnable at the end.

1. **PR 1 — Foundations.** Add `EventLog`, `Scheduler`, `SimClock`, `Spirit` types. No consumers yet. ~300 LOC + tests. Invisible.
2. **PR 2 — Spirit registry.** Add `state.spirits` Map, seed with player spirit, replace `state.playerPower` references. Whisper credits player spirit by id. ~150 LOC. Invisible.
3. **PR 3 — NPCs as entities.** Collapse `state.npcs` + `state.npcSim` into `World` entities of `kind: 'npc'`. Update consumers via helpers. ~400 LOC mostly mechanical. Invisible.
4. **PR 4 — Wire systems to scheduler.** `NpcMovementSystem`, `NpcSimSystem`, `SpiritSystem`. Remove hand-rolled tick logic from `game.ts`. Add threshold detection emitting `belief_cross`/`mood_cross`. ~200 LOC. Invisible (game plays the same).
5. **PR 5 — Tile realization + PerceptionSystem + cradle start.** Add `TileState`, replace `generateWorld` with `seedWorld`, register `PerceptionSystem`, renderer skips void. ~300 LOC. **Visible** — game opens to a small bubble; the rest is void.
6. **PR 6 — Slim `game.ts`.** Extract `AssetManager`, `OverlayDispatcher`, `Spawner`. Pure refactor. ~100 net LOC reduction.

PR 5 is the only player-visible change. Everything else is structural and ships dark.

## Open questions deferred to later specs

1. **Camera-lock behavior for ≥2 followers.** Spec A leaves the data structure (`cameraLock`); Spec ? (gameplay) defines the rules.
2. **Naming the player's spirit ("Fooob").** Player input? First believer assigns? Random table? Deferred to Spec E (Book) — the spirit's name is a Book concern.
3. **Oracle's narrative override.** Deferred to its own spec (the Oracle is substantial). Spec A leaves the seam.
4. **Lazy WFC.** Substrate is computed all-at-once in Spec A. Lazy chunked generation is a future optimization.
5. **Possession entry effects on the host NPC's sim.** Forced faith jump is wired (any resulting `belief_cross` fires from the existing pipe), but the specific magnitudes and any direct mood/needs effects are gameplay decisions for later.
6. **Cradle bubble radius and growth formula.** Numbers picked for Spec A (`base = 3`, `+floor(faith*4)`) are placeholders; gameplay tuning will revisit.

## Success criteria

- All 510 existing tests pass (updated where they touch removed types).
- New tests for each new component pass.
- `tests/integration/determinism.test.ts` passes — same seed + same actions → identical event log.
- `game.ts` is under 350 lines.
- `state.playerPower` and `'player'` string literals (outside of test fixtures) are eliminated.
- `state.npcs` and `state.npcSim` fields are removed from `GameState`.
- Adding a rival spirit requires only: insert into `state.spirits`, no code changes elsewhere.
- Game starts with one believer and a small realized bubble; rest of the map is invisible.
- Whisper still works end-to-end and emits a `whisper` event.

## What this unlocks for Specs B-E

- **Spec B (Time):** EventLog is the timeline. `Scheduler.setRate` is the speed control. Snapshots cache state at event-ids; replay re-applies events from a snapshot forward. Most of the time-travel infrastructure is already implied by Spec A.
- **Spec C (Branching):** A fork copies the log up to event id N, then diverges. The unrealized portion of each branch may collapse differently — geographic divergence emerges naturally.
- **Spec D (Cinematic):** A cutscene is a scripted event sequence injected into the log (plus camera/UI directives). The realized-region machinery and the void state give the director something to play with.
- **Spec E (The Book):** The chapter detector subscribes to `EventLog` and groups events into chapters by patterns (first miracle, schism, betrayal, return). The Book viewer renders chapters as prose; the future LLM backfill turns event sequences into narrative.
