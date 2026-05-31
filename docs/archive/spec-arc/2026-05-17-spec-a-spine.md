# Spec A — The Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the codebase to a typed event log, system scheduler, first-class spirits with manifestation, NPCs collapsed into world entities, and a cradle-style start with tile realization — so future temporal, branching, cinematic, and narrative specs (B-E) can layer cleanly on top.

**Architecture:** Six PRs that each ship a green build. PR 1 adds new primitives invisibly. PRs 2-4 swap consumers to use them. PR 5 introduces the only player-visible change (cradle start with a void surround). PR 6 is a pure refactor of `game.ts` for readability. Source of truth for design: `docs/superpowers/specs/2026-05-17-spec-a-spine-design.md`.

**Tech Stack:** TypeScript ES modules, Vite, Vitest (`tests/unit/**/*.test.ts`, `@/` alias for `src/`), Canvas 2D, no external deps added.

---

## File structure

### Created files

| File | Responsibility | Introduced in |
|---|---|---|
| `src/core/clock.ts` | `SimClock` — sim-tick clock with sub-tick accumulator | PR 1 |
| `src/core/events.ts` | `SimEvent` discriminated union, `AppendedEvent`, `EventLog` | PR 1 |
| `src/core/scheduler.ts` | `System`, `SystemContext`, `Scheduler` | PR 1 |
| `src/core/spirit.ts` | `SpiritId`, `Spirit`, `Manifestation` | PR 1 |
| `src/sim/whisper.ts` | `whisper(spirit, npcEntity, log)` action handler | PR 2 |
| `src/sim/spirit-system.ts` | `SpiritSystem` — per-spirit power regen | PR 2 / PR 4 |
| `src/world/npc-helpers.ts` | `getNpc`, `npcProps`, `queryNpcs`, `forEachNpc`, `toRenderNpc` | PR 3 |
| `src/sim/systems/npc-movement-system.ts` | Wraps existing movement logic in `System` interface | PR 4 |
| `src/sim/systems/npc-sim-system.ts` | Wraps existing sim tick + threshold detection | PR 4 |
| `src/world/perception-system.ts` | `PerceptionSystem` — believer-driven realization | PR 5 |
| `src/world/oracle.ts` | Stub `Oracle` interface; identity implementation | PR 5 |
| `src/world/seed-world.ts` | `seedWorld()` — cradle start replacing `generateWorld` | PR 5 |
| `src/render/asset-manager.ts` | `AssetManager` — terrain/building/tree/atlas loading | PR 6 |
| `src/ui/overlay-dispatcher.ts` | Generic hit-area action registry | PR 6 |
| `src/sim/spawner.ts` | `spawnSeedBeliever` and `spawnFollower` helpers | PR 6 |

### Modified files

| File | Change | Introduced in |
|---|---|---|
| `src/core/state.ts` | Add `spirits`, `eventLog`, `clock`, `cameraLock`; remove `playerPower`, `npcs`, `npcSim` | PRs 2, 3 |
| `src/core/types.ts` | Add `NpcProperties`, `TileState`; remove `NpcInstance`, `NpcSimState` | PRs 3, 5 |
| `src/sim/npc-sim.ts` | Rewrite functions to operate on `Entity` instead of `NpcSimState` | PR 3 |
| `src/sim/npc-movement.ts` | Rewrite to operate on `Entity` | PR 3 |
| `src/sim/divine-actions.ts` | Delete `whisperNpc`, `computePowerRegen`; logic moves to `whisper.ts` + `SpiritSystem` | PRs 2, 4 |
| `src/render/renderer.ts` | Read NPCs from world; skip `'void'` tiles | PRs 3, 5 |
| `src/render/sim-overlay.ts` | Read spirit power from `Spirit` not state | PR 2 |
| `src/render/hud.ts` | Read power from `Spirit` | PR 2 |
| `src/render/npc-animator.ts` | Operate on NPC entities via shim | PR 3 |
| `src/ui/npc-info-panel.ts` | Operate on NPC entity | PR 3 |
| `src/ui/npc-tooltip.ts` | Operate on NPC entity | PR 3 |
| `src/game.ts` | Slim from 602 → ~300 LOC; use scheduler; cradle start | PRs 4, 6 |

### Test files

All under `tests/unit/`. New:

| File | Covers |
|---|---|
| `tests/unit/clock.test.ts` | `SimClock` |
| `tests/unit/events.test.ts` | `EventLog` |
| `tests/unit/scheduler.test.ts` | `Scheduler` |
| `tests/unit/spirit.test.ts` | `Spirit` types, registry semantics |
| `tests/unit/whisper.test.ts` | Whisper action handler |
| `tests/unit/spirit-system.test.ts` | Multi-spirit regen, `power_depleted` event |
| `tests/unit/npc-helpers.test.ts` | Helper functions, render shim |
| `tests/unit/npc-sim-system.test.ts` | Threshold detection (belief_cross, mood_cross) |
| `tests/unit/perception-system.test.ts` | Bubble grows with faith, deterministic ordering |
| `tests/unit/seed-world.test.ts` | Cradle start event sequence |
| `tests/unit/overlay-dispatcher.test.ts` | Action registration & dispatch |
| `tests/unit/determinism.test.ts` | Same seed + same actions → identical event log |

---

## PR 1 — Foundations (new primitives, no consumers yet)

### Task 1.1: SimClock

**Files:**
- Create: `src/core/clock.ts`
- Test: `tests/unit/clock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/clock.test.ts
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';

describe('SimClock', () => {
  it('starts at tick 0', () => {
    const c = new SimClock();
    expect(c.now()).toBe(0);
  });

  it('advances whole ticks at the default 16.667 ms/tick rate', () => {
    const c = new SimClock();
    c.advance(16.667);
    expect(c.now()).toBe(1);
    c.advance(33.334);
    expect(c.now()).toBe(3);
  });

  it('accumulates sub-tick ms without advancing', () => {
    const c = new SimClock();
    c.advance(10);
    expect(c.now()).toBe(0);
    c.advance(7);
    expect(c.now()).toBe(1);
  });

  it('respects custom msPerTick', () => {
    const c = new SimClock(100);
    c.advance(250);
    expect(c.now()).toBe(2);
    c.advance(50);
    expect(c.now()).toBe(3);
  });

  it('is monotonic — never goes backwards', () => {
    const c = new SimClock();
    for (let i = 0; i < 100; i++) {
      const before = c.now();
      c.advance(Math.random() * 50);
      expect(c.now()).toBeGreaterThanOrEqual(before);
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- clock.test.ts
```

Expected: `Cannot find module '@/core/clock'` or `SimClock is not defined`.

- [ ] **Step 3: Implement `SimClock`**

```ts
// src/core/clock.ts

/**
 * Sim-tick clock. Wall-time ms is fed in via advance(); now() returns the
 * integer tick count. Decoupling sim time from wall time lets Spec B scale
 * sim speed without bending the event log.
 */
export class SimClock {
  private ticks = 0;
  private accumMs = 0;
  private readonly msPerTick: number;

  constructor(msPerTick = 16.667) {
    this.msPerTick = msPerTick;
  }

  advance(realMs: number): void {
    if (realMs <= 0) return;
    this.accumMs += realMs;
    while (this.accumMs >= this.msPerTick) {
      this.accumMs -= this.msPerTick;
      this.ticks++;
    }
  }

  now(): number {
    return this.ticks;
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

```
npm test -- clock.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/clock.ts tests/unit/clock.test.ts
git commit -m "feat(core): SimClock for tick-based sim time"
```

---

### Task 1.2: EventLog

**Files:**
- Create: `src/core/events.ts`
- Test: `tests/unit/events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/events.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EventLog, type SimEvent } from '@/core/events';
import { SimClock } from '@/core/clock';

function makeLog(): { log: EventLog; clock: SimClock } {
  const clock = new SimClock();
  return { log: new EventLog(clock), clock };
}

describe('EventLog', () => {
  it('append assigns monotonic ids starting at 1', () => {
    const { log } = makeLog();
    const a = log.append({ type: 'spirit_birth', spiritId: 'p', name: 'Fooob', isPlayer: true });
    const b = log.append({ type: 'spirit_birth', spiritId: 'r', name: 'Grooob', isPlayer: false });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it('append stamps current sim tick as t', () => {
    const { log, clock } = makeLog();
    clock.advance(50);  // ~3 ticks at default rate
    const e = log.append({ type: 'power_depleted', spiritId: 'p' });
    expect(e.t).toBe(clock.now());
  });

  it('subscribers receive events synchronously in append order', () => {
    const { log } = makeLog();
    const seen: number[] = [];
    log.subscribe(e => seen.push(e.id));
    log.append({ type: 'power_depleted', spiritId: 'p' });
    log.append({ type: 'power_depleted', spiritId: 'r' });
    expect(seen).toEqual([1, 2]);
  });

  it('subscribe returns an unsubscribe function', () => {
    const { log } = makeLog();
    const fn = vi.fn();
    const off = log.subscribe(fn);
    log.append({ type: 'power_depleted', spiritId: 'p' });
    off();
    log.append({ type: 'power_depleted', spiritId: 'r' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('since(id) returns events with id > given', () => {
    const { log } = makeLog();
    log.append({ type: 'power_depleted', spiritId: 'a' });
    log.append({ type: 'power_depleted', spiritId: 'b' });
    log.append({ type: 'power_depleted', spiritId: 'c' });
    const r = log.since(1);
    expect(r.map(e => e.id)).toEqual([2, 3]);
  });

  it('range(tStart, tEnd) returns events in [tStart, tEnd)', () => {
    const { log, clock } = makeLog();
    log.append({ type: 'power_depleted', spiritId: 'a' });   // t=0
    clock.advance(100);                                       // t=6
    log.append({ type: 'power_depleted', spiritId: 'b' });
    clock.advance(100);
    log.append({ type: 'power_depleted', spiritId: 'c' });
    const r = log.range(0, 7);
    expect(r.map(e => (e.event as { spiritId: string }).spiritId)).toEqual(['a', 'b']);
  });

  it('size returns total events appended', () => {
    const { log } = makeLog();
    expect(log.size()).toBe(0);
    log.append({ type: 'power_depleted', spiritId: 'p' });
    log.append({ type: 'power_depleted', spiritId: 'q' });
    expect(log.size()).toBe(2);
  });

  it('one throwing subscriber does not block others', () => {
    const { log } = makeLog();
    const ok = vi.fn();
    log.subscribe(() => { throw new Error('boom'); });
    log.subscribe(ok);
    expect(() => log.append({ type: 'power_depleted', spiritId: 'p' })).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- events.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `EventLog` and event types**

```ts
// src/core/events.ts
import type { SimClock } from '@/core/clock';
import type { SpiritId } from '@/core/spirit';
import type { EntityId, NpcRole, Region, WorldSeed } from '@/core/types';

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
  private readonly clock: SimClock;

  constructor(clock: SimClock) {
    this.clock = clock;
  }

  append(event: SimEvent): AppendedEvent {
    const appended: AppendedEvent = {
      id: this.nextId++,
      t: this.clock.now(),
      event,
    };
    this.events.push(appended);
    for (const fn of this.subscribers) {
      try {
        fn(appended);
      } catch (err) {
        console.error('[event-log] subscriber threw:', err);
      }
    }
    return appended;
  }

  subscribe(fn: (e: AppendedEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }

  since(eventId: number): AppendedEvent[] {
    return this.events.filter(e => e.id > eventId);
  }

  range(tStart: number, tEnd: number): AppendedEvent[] {
    return this.events.filter(e => e.t >= tStart && e.t < tEnd);
  }

  size(): number {
    return this.events.length;
  }
}
```

Note: `SpiritId` and `Region` are imported. `Region` already exists in `types.ts`. `SpiritId` will be defined in Task 1.4. To make this file compile *now*, define `SpiritId` provisionally at the top of `events.ts`:

```ts
// remove this line in Task 1.4 when src/core/spirit.ts exports SpiritId
type SpiritIdLocal = string;
```

Actually, do it cleanly: skip the import for now; declare `type SpiritId = string;` at the top. Task 1.4 will move it to `spirit.ts` and update this import. This avoids a forward dep.

Replace the import line with:

```ts
import type { SimClock } from '@/core/clock';
import type { EntityId, NpcRole, Region, WorldSeed } from '@/core/types';

// Provisional — moved to '@/core/spirit' in Task 1.4
export type SpiritId = string;
```

- [ ] **Step 4: Run test, verify it passes**

```
npm test -- events.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts tests/unit/events.test.ts
git commit -m "feat(core): EventLog with typed SimEvent union"
```

---

### Task 1.3: Scheduler + System

**Files:**
- Create: `src/core/scheduler.ts`
- Test: `tests/unit/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Scheduler, type System, type SystemContext } from '@/core/scheduler';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';

function makeMap(): GameMap {
  return {
    tiles: [], width: 0, height: 0, villages: [], seed: 1,
    success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function makeCtx(): Omit<SystemContext, 'dt' | 'now'> {
  const clock = new SimClock();
  return {
    world: new World(makeMap()),
    spirits: new Map(),
    log: new EventLog(clock),
    clock,
  };
}

describe('Scheduler', () => {
  it('registers and ticks a single system at its rate', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 1, tick: fn });  // 1 Hz → 1000 ms / tick
    const ctx = makeCtx();
    sched.tick(500, ctx);   // half an interval
    expect(fn).not.toHaveBeenCalled();
    sched.tick(500, ctx);   // crosses 1000 ms threshold
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps accumulator across calls — fast systems fire multiple times if dt is large', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 60, tick: fn });
    const ctx = makeCtx();
    sched.tick(50, ctx);   // 60Hz = 16.667 ms/tick; 50 ms → 3 ticks
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not tick systems with tickHz <= 0', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 0, tick: fn });
    const ctx = makeCtx();
    sched.tick(10_000, ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects duplicate system names', () => {
    const sched = new Scheduler();
    sched.register({ name: 's', tickHz: 1, tick: () => {} });
    expect(() => sched.register({ name: 's', tickHz: 1, tick: () => {} }))
      .toThrowError(/already registered/);
  });

  it('a throwing system does not stop others and emits system_error', () => {
    const sched = new Scheduler();
    const good = vi.fn();
    sched.register({ name: 'bad', tickHz: 1, tick: () => { throw new Error('boom'); } });
    sched.register({ name: 'good', tickHz: 1, tick: good });
    const ctx = makeCtx();
    sched.tick(1000, ctx);
    expect(good).toHaveBeenCalledTimes(1);
    const evts = ctx.log.since(0);
    expect(evts).toHaveLength(1);
    expect(evts[0].event).toMatchObject({ type: 'system_error', system: 'bad' });
  });

  it('setRate scales sim time', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 1, tick: fn });
    sched.setRate(2);
    const ctx = makeCtx();
    sched.tick(500, ctx);   // real 500ms × 2 = sim 1000ms → tick
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('setRate(0) pauses sim time', () => {
    const sched = new Scheduler();
    const fn = vi.fn();
    sched.register({ name: 's', tickHz: 1, tick: fn });
    sched.setRate(0);
    const ctx = makeCtx();
    sched.tick(10_000, ctx);
    expect(fn).not.toHaveBeenCalled();
  });

  it('advances the clock by simDtMs', () => {
    const sched = new Scheduler();
    const ctx = makeCtx();
    sched.tick(100, ctx);
    expect(ctx.clock.now()).toBe(6);  // 100 / 16.667 ≈ 6
  });

  it('passes dt and now to system tick', () => {
    const sched = new Scheduler();
    let seen: { dt: number; now: number } | null = null;
    sched.register({
      name: 's', tickHz: 1,
      tick: (c) => { seen = { dt: c.dt, now: c.now }; },
    });
    const ctx = makeCtx();
    sched.tick(1500, ctx);
    expect(seen).not.toBeNull();
    expect(seen!.dt).toBeGreaterThanOrEqual(1000);
    expect(seen!.now).toBe(ctx.clock.now());
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- scheduler.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `Scheduler` and `System`**

```ts
// src/core/scheduler.ts
import type { SimClock } from '@/core/clock';
import type { EventLog, SpiritId } from '@/core/events';
import type { Spirit } from '@/core/spirit';
import type { World } from '@/world/world';

export interface SystemContext {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  clock: SimClock;
  dt: number;   // sim ms accumulated since this system last ticked
  now: number;  // current sim tick (clock.now() after advance)
}

export interface System {
  name: string;
  tickHz: number;   // 0 = manual / disabled; positive = scheduled
  tick(ctx: SystemContext): void;
}

type BaseCtx = Omit<SystemContext, 'dt' | 'now'>;

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

  /** Called once per RAF from game.ts with wall-clock dt. */
  tick(realDtMs: number, ctxBase: BaseCtx): void {
    const simDtMs = realDtMs * this.rateScale;
    ctxBase.clock.advance(simDtMs);
    const now = ctxBase.clock.now();

    for (const s of this.systems) {
      if (s.tickHz <= 0) continue;
      const interval = 1000 / s.tickHz;
      let acc = (this.accumulators.get(s.name) ?? 0) + simDtMs;
      // While loop so fast systems can tick multiple times within one frame
      while (acc >= interval) {
        try {
          s.tick({ ...ctxBase, dt: acc, now });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctxBase.log.append({ type: 'system_error', system: s.name, message });
          console.error(`[scheduler] ${s.name} threw:`, err);
        }
        acc -= interval;
      }
      this.accumulators.set(s.name, acc);
    }
  }

  setRate(scale: number): void {
    this.rateScale = Math.max(0, scale);
  }

  getRate(): number {
    return this.rateScale;
  }
}
```

Note: `Spirit` is imported from `'@/core/spirit'` which doesn't exist yet. Until Task 1.4 lands, add a one-line stub at the top of this file:

```ts
// remove in Task 1.4
interface Spirit { id: string }
```

And remove the `import type { Spirit } from '@/core/spirit';` line. Restore in Task 1.4.

- [ ] **Step 4: Run test, verify it passes**

```
npm test -- scheduler.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/scheduler.ts tests/unit/scheduler.test.ts
git commit -m "feat(core): Scheduler with rate-scaled tick + error isolation"
```

---

### Task 1.4: Spirit types

**Files:**
- Create: `src/core/spirit.ts`
- Modify: `src/core/events.ts` (move `SpiritId` here, import from `spirit.ts`)
- Modify: `src/core/scheduler.ts` (restore `import type { Spirit } from '@/core/spirit'`)
- Test: `tests/unit/spirit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/spirit.test.ts
import { describe, it, expect } from 'vitest';
import type { Spirit, Manifestation } from '@/core/spirit';

describe('Spirit shape', () => {
  it('a minimal spirit has identity + power and no manifestation', () => {
    const s: Spirit = {
      id: 'player',
      name: 'Fooob',
      sigil: '⊙',
      color: '#ffd700',
      isPlayer: true,
      power: 3,
      manifestation: null,
    };
    expect(s.manifestation).toBeNull();
  });

  it('avatar manifestation references an entity id', () => {
    const m: Manifestation = { kind: 'avatar', entityId: 'avatar-1' };
    expect(m.kind).toBe('avatar');
  });

  it('possessing manifestation references an npc entity id', () => {
    const m: Manifestation = { kind: 'possessing', npcEntityId: 'npc-3' };
    expect(m.kind).toBe('possessing');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- spirit.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement spirit types**

```ts
// src/core/spirit.ts
import type { EntityId } from '@/core/types';

export type SpiritId = string;

export type Manifestation =
  | { kind: 'avatar';     entityId: EntityId }
  | { kind: 'possessing'; npcEntityId: EntityId };

export interface Spirit {
  id: SpiritId;
  name: string;
  sigil: string;
  color: string;
  isPlayer: boolean;
  power: number;
  manifestation: Manifestation | null;
  ai?: { policy: string; cooldowns: Record<string, number> };
}
```

- [ ] **Step 4: Update `events.ts` to import SpiritId from spirit.ts**

In `src/core/events.ts`:
- Remove the line `export type SpiritId = string;`
- Add `import type { SpiritId } from '@/core/spirit';` at the top
- Continue to re-export it: at end of file add `export type { SpiritId };`

- [ ] **Step 5: Restore real Spirit import in `scheduler.ts`**

In `src/core/scheduler.ts`:
- Remove the temporary `interface Spirit { id: string }` stub
- Restore `import type { Spirit } from '@/core/spirit';`
- Also import: `import type { SpiritId } from '@/core/spirit';`
- Update the `SystemContext` field accordingly:

```ts
import type { Spirit, SpiritId } from '@/core/spirit';

export interface SystemContext {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  clock: SimClock;
  dt: number;
  now: number;
}
```

- [ ] **Step 6: Run all PR 1 tests, verify they pass**

```
npm test -- clock.test.ts events.test.ts scheduler.test.ts spirit.test.ts
```

Expected: all green.

- [ ] **Step 7: Run full test suite to ensure nothing else broke**

```
npm test
```

Expected: all 510+ tests pass (we've added new tests; existing ones untouched).

- [ ] **Step 8: TypeScript check**

```
npm run build
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/core/spirit.ts src/core/events.ts src/core/scheduler.ts tests/unit/spirit.test.ts
git commit -m "feat(core): Spirit type with manifestation; consolidate SpiritId"
```

This closes PR 1. The new primitives compile, are unit-tested, and have no consumers yet.

---

## PR 2 — Spirit registry replaces `playerPower`

### Task 2.1: Add `state.spirits`, `state.eventLog`, `state.clock`; seed player spirit

**Files:**
- Modify: `src/core/state.ts`
- Modify: `src/game.ts` (initialize spirits + log at boot; remove `playerPower`)

- [ ] **Step 1: Modify `GameState`**

In `src/core/state.ts`, update the `GameState` interface and `createState()` factory:

```ts
import type { GameMap, Camera, WorldSeed, NpcInstance, NpcSimState, TerrainField, BiomeMap, GeneratedDecoration, EntityId } from '@/core/types';
import type { BlobTile } from '@/map/blob-autotiler';
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createCamera } from '@/render/camera';

export interface GameState {
  map: GameMap | null;
  camera: Camera;
  worldSeed: WorldSeed | null;
  npcs: NpcInstance[];                          // removed in PR 3
  npcSim: Map<string, NpcSimState>;             // removed in PR 3
  selectedNpcId: string | null;
  visualMap: string[][] | null;
  blobMap: BlobTile[][] | null;
  debug: boolean;
  paused: boolean;
  showLabels: boolean;
  showPoiMarkers: boolean;
  pinnedNpcId: string | null;
  followNpc: boolean;
  // NEW:
  spirits: Map<SpiritId, Spirit>;
  eventLog: EventLog;
  clock: SimClock;
  cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId };
  // REMOVED: playerPower
  world: World | null;
  terrainFields: TerrainField | null;
  biomeMap: BiomeMap | null;
  generatedDecorations: GeneratedDecoration[];
}

export function createState(): GameState {
  const clock = new SimClock();
  const eventLog = new EventLog(clock);
  const spirits = new Map<SpiritId, Spirit>();
  // Seed the player spirit. Named "Fooob" placeholder — naming ritual is Spec E.
  spirits.set('player', {
    id: 'player',
    name: 'Fooob',
    sigil: '⊙',
    color: '#ffd700',
    isPlayer: true,
    power: 3,
    manifestation: null,
  });

  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    npcs: [],
    npcSim: new Map(),
    selectedNpcId: null,
    visualMap: null,
    blobMap: null,
    debug: false,
    paused: false,
    showLabels: true,
    showPoiMarkers: true,
    pinnedNpcId: null,
    followNpc: false,
    spirits,
    eventLog,
    clock,
    cameraLock: { mode: 'free' },
    world: null,
    terrainFields: null,
    biomeMap: null,
    generatedDecorations: [],
  };
}
```

- [ ] **Step 2: Append `spirit_birth` event when player spirit is seeded**

Replace the body of `createState()` from Step 1's "spirits.set" call onward with:

```ts
  spirits.set('player', {
    id: 'player',
    name: 'Fooob',
    sigil: '⊙',
    color: '#ffd700',
    isPlayer: true,
    power: 3,
    manifestation: null,
  });
  eventLog.append({ type: 'spirit_birth', spiritId: 'player', name: 'Fooob', isPlayer: true });

  return {
    map: null,
    camera: createCamera(),
    worldSeed: null,
    npcs: [],
    npcSim: new Map(),
    selectedNpcId: null,
    visualMap: null,
    blobMap: null,
    debug: false,
    paused: false,
    showLabels: true,
    showPoiMarkers: true,
    pinnedNpcId: null,
    followNpc: false,
    spirits,
    eventLog,
    clock,
    cameraLock: { mode: 'free' },
    world: null,
    terrainFields: null,
    biomeMap: null,
    generatedDecorations: [],
  };
}
```

- [ ] **Step 3: Remove `playerPower` from `game.ts`**

In `src/game.ts`, search for every reference to `state.playerPower` and replace with `state.spirits.get('player')!.power`. The non-null assertion is safe — `createState()` always seeds the player spirit.

Affected lines (approximate, based on current state):
- `game.ts:441` — `this.state.playerPower` → `this.state.spirits.get('player')!.power`
- `game.ts:528` — `whisperNpc(sim, this.state.playerPower)` becomes the return-value assignment to spirit power: see Task 2.3
- `game.ts:467` — `regenPerSec` argument

For Step 3 in this task, only do the simple `state.playerPower` → `state.spirits.get('player')!.power` substitutions. Whisper logic update is Task 2.3.

- [ ] **Step 4: Run full test suite**

```
npm test
```

Expected: tests pass; if any test fixture creates `GameState` manually, it may need updating. Update fixtures to match the new shape.

- [ ] **Step 5: Run build**

```
npm run build
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/state.ts src/game.ts
git commit -m "feat(spirit): add spirits map + eventLog + clock to GameState"
```

---

### Task 2.2: Migrate sim-overlay and hud to read spirit power

**Files:**
- Modify: `src/render/sim-overlay.ts`
- Modify: `src/render/hud.ts`

- [ ] **Step 1: Update `drawNpcOverlay` to take playerPower from spirit**

In `src/render/sim-overlay.ts`, find the `drawNpcOverlay` function signature. It currently takes `playerPower: number`. Keep the signature — pass the value from `state.spirits.get('player').power` at the call site. No internal changes needed.

- [ ] **Step 2: Update `drawPowerHud`**

Same as above — function signature unchanged, call site changed.

- [ ] **Step 3: Update call sites in `game.ts`**

In `src/game.ts`:

```ts
// previously
this.overlayHitAreas = drawNpcOverlay(
  this.ctx, npc, sim, this.state.camera,
  rc.canvasWidth, rc.canvasHeight,
  this.state.playerPower,
);

// becomes
const player = this.state.spirits.get('player')!;
this.overlayHitAreas = drawNpcOverlay(
  this.ctx, npc, sim, this.state.camera,
  rc.canvasWidth, rc.canvasHeight,
  player.power,
);
```

Same for `drawPowerHud`.

- [ ] **Step 4: Run full test suite + build**

```
npm test && npm run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/render/sim-overlay.ts src/render/hud.ts src/game.ts
git commit -m "refactor(render): read player power from spirits map"
```

---

### Task 2.3: Whisper credits the correct spirit, emits event

**Files:**
- Create: `src/sim/whisper.ts`
- Test: `tests/unit/whisper.test.ts`
- Modify: `src/game.ts` (call `whisper(...)` instead of `whisperNpc(...)`)

`src/sim/divine-actions.ts` is untouched in this task. `whisperNpc` and `computePowerRegen` become dead code over PRs 2-3 and are deleted in Task 4.3.

Note: in PR 3 we will add an entity-based `whisperEntity` alongside this `whisper` so the migration is incremental; Task 3.6 renames `whisperEntity` → `whisper` after the legacy is gone.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/whisper.test.ts
import { describe, it, expect } from 'vitest';
import { whisper, WHISPER_COST } from '@/sim/whisper';
import { initNpcSim } from '@/sim/npc-sim';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import type { Spirit } from '@/core/spirit';
import type { NpcSimState } from '@/core/types';

function makePlayer(power = 3): Spirit {
  return {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700',
    isPlayer: true, power, manifestation: null,
  };
}
function makeSim(): NpcSimState {
  const sim = initNpcSim('npc-1', 'Alice', 'farmer', 42);
  sim.beliefs['player'].faith = 0.3;
  sim.whisperCooldown = 0;
  return sim;
}

describe('whisper', () => {
  it('debits the spirit, boosts the NPCs faith in that spirit, and emits whisper event', () => {
    const spirit = makePlayer(3);
    const sim = makeSim();
    const clock = new SimClock();
    const log = new EventLog(clock);

    whisper(spirit, sim, log);

    expect(spirit.power).toBe(3 - WHISPER_COST);
    expect(sim.beliefs['player'].faith).toBeGreaterThan(0.3);
    const evts = log.since(0);
    expect(evts).toHaveLength(1);
    expect(evts[0].event).toMatchObject({ type: 'whisper', spiritId: 'player', npcId: 'npc-1' });
  });

  it('returns false and is a noop if power is insufficient', () => {
    const spirit = makePlayer(0);
    const sim = makeSim();
    const log = new EventLog(new SimClock());
    const ok = whisper(spirit, sim, log);
    expect(ok).toBe(false);
    expect(spirit.power).toBe(0);
    expect(log.size()).toBe(0);
  });

  it('returns false and is a noop if NPC is on cooldown', () => {
    const spirit = makePlayer(3);
    const sim = makeSim();
    sim.whisperCooldown = 4;
    const log = new EventLog(new SimClock());
    const ok = whisper(spirit, sim, log);
    expect(ok).toBe(false);
    expect(spirit.power).toBe(3);
    expect(log.size()).toBe(0);
  });

  it('creates a belief entry if the spirit was previously unbelieved-in', () => {
    const spirit: Spirit = { ...makePlayer(3), id: 'rival', name: 'Grooob', isPlayer: false };
    const sim = makeSim();
    const log = new EventLog(new SimClock());
    whisper(spirit, sim, log);
    expect(sim.beliefs['rival']).toBeDefined();
    expect(sim.beliefs['rival'].faith).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- whisper.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `whisper`**

```ts
// src/sim/whisper.ts
import type { Spirit } from '@/core/spirit';
import type { EventLog } from '@/core/events';
import type { NpcSimState } from '@/core/types';
import { clamp01 } from '@/sim/npc-sim';

export const WHISPER_COST = 1;
export const WHISPER_FAITH_BOOST = 0.15;
export const WHISPER_UNDERSTANDING_BOOST = 0.03;
export const WHISPER_COOLDOWN = 5;

/**
 * Apply a whisper from `spirit` to `npc`. Mutates both. Appends a whisper event
 * to the log. Returns true on success, false if power/cooldown disallows.
 *
 * NOTE: in PR 3 the `npc: NpcSimState` parameter is replaced with an
 * `Entity` and properties access. The contract here is otherwise stable.
 */
export function whisper(spirit: Spirit, npc: NpcSimState, log: EventLog): boolean {
  if (spirit.power < WHISPER_COST) return false;
  if (npc.whisperCooldown > 0) return false;

  spirit.power -= WHISPER_COST;

  const existing = npc.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    npc.beliefs[spirit.id] = {
      faith: clamp01(WHISPER_FAITH_BOOST),
      understanding: clamp01(WHISPER_UNDERSTANDING_BOOST),
      devotion: 0,
    };
  }
  npc.whisperCooldown = WHISPER_COOLDOWN;

  npc.recentEvents.push('whisper');
  if (npc.recentEvents.length > 5) npc.recentEvents.shift();

  log.append({ type: 'whisper', spiritId: spirit.id, npcId: npc.npcId });
  return true;
}
```

- [ ] **Step 4: Update `onCanvasClick` in `game.ts`**

```ts
private onCanvasClick(sx: number, sy: number): boolean {
  for (const area of this.overlayHitAreas) {
    if (sx >= area.x && sx <= area.x + area.w && sy >= area.y && sy <= area.y + area.h) {
      if (area.action === 'whisper' && area.active) {
        const sim = this.state.npcSim.get(area.npcId);
        const player = this.state.spirits.get('player')!;
        if (sim && whisper(player, sim, this.state.eventLog)) {
          this.lastWhisperTime = performance.now();
        }
      }
      return true;
    }
  }
  return false;
}
```

Don't forget the import:
```ts
import { whisper } from '@/sim/whisper';
```

- [ ] **Step 5: Run all tests**

```
npm test
```

Expected: new tests pass; existing whisper tests in `divine-actions.test.ts` still pass (we haven't deleted `whisperNpc` yet).

- [ ] **Step 6: Commit**

```bash
git add src/sim/whisper.ts tests/unit/whisper.test.ts src/game.ts
git commit -m "feat(sim): whisper handler routes through spirit + event log"
```

This closes PR 2. Spirits map exists, whisper credits the player spirit and emits an event. `playerPower` is gone from `GameState`.

---

## PR 3 — NPCs as world entities

This is the largest PR. It collapses `state.npcs: NpcInstance[]` + `state.npcSim: Map<string, NpcSimState>` into single `Entity` records with `kind: 'npc'`.

### Task 3.1: Define `NpcProperties` type

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add `NpcProperties` to `types.ts`**

After the existing `NpcSimState` interface in `src/core/types.ts`, add:

```ts
import type { SpiritId } from '@/core/spirit';

/** Properties stored on an Entity with kind: 'npc'. Replaces NpcInstance + NpcSimState. */
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
  // possession marker
  possessedBy?: SpiritId;
  // narrative breadcrumbs
  recentEventIds: number[];
}
```

- [ ] **Step 2: Run build**

```
npm run build
```

Expected: 0 errors. (The type is unused so far.)

- [ ] **Step 3: Commit**

```bash
git add src/core/types.ts
git commit -m "feat(types): NpcProperties for entity-backed NPCs"
```

---

### Task 3.2: NPC helpers

**Files:**
- Create: `src/world/npc-helpers.ts`
- Test: `tests/unit/npc-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/npc-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { getNpc, npcProps, queryNpcs, forEachNpc, toRenderNpc } from '@/world/npc-helpers';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return {
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

function makeNpcEntity(id: string, x: number, y: number): Entity {
  return {
    id, kind: 'npc', x, y,
    properties: initNpcProps('Alice', 'farmer', 42),
  };
}

describe('npc-helpers', () => {
  it('getNpc returns undefined for missing id', () => {
    const w = new World(emptyMap());
    expect(getNpc(w, 'nope')).toBeUndefined();
  });

  it('getNpc returns the entity for an existing npc id', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    expect(getNpc(w, 'n1')?.id).toBe('n1');
  });

  it('npcProps narrows to NpcProperties', () => {
    const e = makeNpcEntity('n1', 0, 0);
    expect(npcProps(e).role).toBe('farmer');
  });

  it('queryNpcs returns only kind: npc entities', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    w.addEntity({ id: 'tree1', kind: 'oak_tree', x: 1, y: 1 });
    const npcs = queryNpcs(w);
    expect(npcs.map(e => e.id)).toEqual(['n1']);
  });

  it('queryNpcs supports region filter', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    w.addEntity(makeNpcEntity('n2', 5, 5));
    const npcs = queryNpcs(w, { region: { x: 4, y: 4, w: 3, h: 3 } });
    expect(npcs.map(e => e.id)).toEqual(['n2']);
  });

  it('forEachNpc visits every npc entity', () => {
    const w = new World(emptyMap());
    w.addEntity(makeNpcEntity('n1', 0, 0));
    w.addEntity(makeNpcEntity('n2', 1, 1));
    const ids: string[] = [];
    forEachNpc(w, e => ids.push(e.id));
    expect(ids.sort()).toEqual(['n1', 'n2']);
  });

  it('toRenderNpc adapts entity to legacy NpcInstance shape', () => {
    const e = makeNpcEntity('n1', 3, 4);
    const r = toRenderNpc(e);
    expect(r.id).toBe('n1');
    expect(r.tileX).toBe(3);
    expect(r.tileY).toBe(4);
    expect(r.role).toBe('farmer');
  });

  it('initNpcProps produces a complete properties object', () => {
    const p = initNpcProps('Bob', 'priest', 100);
    expect(p.name).toBe('Bob');
    expect(p.role).toBe('priest');
    expect(p.beliefs).toBeDefined();
    expect(p.needs).toBeDefined();
    expect(p.mood).toBeGreaterThanOrEqual(0);
    expect(p.recentEventIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- npc-helpers.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement helpers**

```ts
// src/world/npc-helpers.ts
import type { Entity, EntityId, NpcProperties, NpcRole, Direction, NpcInstance, Region } from '@/core/types';
import type { World } from '@/world/world';
import { Random } from '@/core/noise';

export const NPC_KIND = 'npc';

export function getNpc(world: World, id: EntityId): Entity | undefined {
  const e = world.registry.get(id);
  return e && e.kind === NPC_KIND ? e : undefined;
}

export function npcProps(e: Entity): NpcProperties {
  return e.properties as NpcProperties;
}

export function queryNpcs(world: World, opts?: { region?: Region }): Entity[] {
  return world.query({ kind: NPC_KIND, region: opts?.region });
}

export function forEachNpc(world: World, fn: (e: Entity) => void): void {
  for (const e of queryNpcs(world)) fn(e);
}

/** Adapter to the legacy NpcInstance shape used by the renderer. The renderer
 *  itself is refactored later; this shim keeps PR 3 mechanical. */
export function toRenderNpc(e: Entity): NpcInstance {
  const p = npcProps(e);
  return {
    id: e.id,
    name: p.name,
    role: p.role,
    seed: p.seed,
    tileX: Math.floor(e.x),
    tileY: Math.floor(e.y),
    direction: p.direction,
    frame: p.frame,
    frameTimer: p.frameTimer,
    homeBuildingId: p.homeBuildingId,
    homePoiId: p.homePoiId,
    moveCooldown: p.moveCooldown,
  };
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const ROLE_FAITH: Record<NpcRole, number> = {
  priest: 0.7, elder: 0.5, farmer: 0.3, merchant: 0.25,
  soldier: 0.2, noble: 0.3, child: 0.4, beggar: 0.5,
};
const ROLE_PIETY_BONUS: Record<NpcRole, number> = {
  priest: 0.3, elder: 0.1, farmer: 0, merchant: -0.1,
  soldier: -0.1, noble: 0, child: 0.05, beggar: 0.1,
};
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Build a complete NpcProperties record from role + seed. Replaces initNpcSim. */
export function initNpcProps(name: string, role: NpcRole, seed: number): NpcProperties {
  const rng = new Random(seed);
  const personality = {
    assertiveness: rng.next(),
    skepticism:    rng.next(),
    piety:         clamp01(rng.next() + ROLE_PIETY_BONUS[role]),
    sociability:   rng.next(),
  };
  const baseFaith = ROLE_FAITH[role] * (0.5 + personality.piety * 0.5);
  const needsRng = new Random(seed ^ 0xdeadbeef);
  const jitter = () => (needsRng.next() - 0.5) * 0.2;
  const needs = {
    safety:     clamp01(0.6  + jitter()),
    prosperity: clamp01(0.5  + jitter()),
    community:  clamp01(0.55 + jitter()),
    meaning:    clamp01(0.45 + jitter()),
  };
  const mood = (needs.safety + needs.prosperity + needs.community + needs.meaning) / 4;
  return {
    name,
    role,
    seed,
    direction: DIRECTIONS[seed % 4],
    frame: (seed % 8) + 1,
    frameTimer: seed % 100,
    personality,
    beliefs: { player: { faith: clamp01(baseFaith), understanding: 0.1, devotion: 0.05 } },
    needs,
    mood,
    whisperCooldown: 0,
    recentEventIds: [],
  };
}
```

- [ ] **Step 4: Run test, verify it passes**

```
npm test -- npc-helpers.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/world/npc-helpers.ts tests/unit/npc-helpers.test.ts
git commit -m "feat(world): NPC helpers + initNpcProps for entity-backed NPCs"
```

---

### Task 3.3: Rewrite sim functions to operate on Entity

**Files:**
- Modify: `src/sim/npc-sim.ts` (rewrite `tickNpcSim`, `tickAllNpcs` to take `World` + entity)
- Modify: `src/sim/whisper.ts` (rewrite `whisper` to take `Entity`)
- Modify: `src/sim/npc-movement.ts` (rewrite to operate on entities)

- [ ] **Step 1: Add entity-based sim functions in `src/sim/npc-sim.ts`**

Keep `clamp01`, `personalityFromSeed`, `computeMood`, `initNpcSim`, `tickNpcSim`, `tickAllNpcs` exports as-is — they continue to operate on the legacy `NpcSimState` shape until Task 3.6 removes them. **Add** entity-based versions alongside:

```ts
// append to src/sim/npc-sim.ts
import type { Entity } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';

/** Entity-based version of tickNpcSim. Spec A migration target. */
export function tickNpcEntity(e: Entity): void {
  const p = npcProps(e);

  if (p.whisperCooldown > 0) p.whisperCooldown -= 1;

  for (const belief of Object.values(p.beliefs)) {
    const decay = FAITH_DECAY_BASE * p.personality.skepticism;
    belief.faith = clamp01(belief.faith - decay);
  }

  const avgNeeds = computeMood(p.needs);
  if (avgNeeds < 0.4) {
    const desperation = (0.4 - avgNeeds) / 0.4;
    const boost = NEED_FAITH_BOOST * desperation * p.personality.piety;
    for (const belief of Object.values(p.beliefs)) {
      belief.faith = clamp01(belief.faith + boost);
    }
  }

  p.needs.safety     = clamp01(p.needs.safety     - 0.001);
  p.needs.prosperity = clamp01(p.needs.prosperity - 0.001);
  p.needs.community  = clamp01(p.needs.community  - 0.0005);
  p.needs.meaning    = clamp01(p.needs.meaning    - 0.0005);

  p.mood = computeMood(p.needs);
}

export function tickAllNpcEntities(world: World): void {
  forEachNpc(world, tickNpcEntity);
}
```

The legacy `initNpcSim`/`tickNpcSim`/`tickAllNpcs` functions remain exported and unchanged. They are dead weight after Task 3.4 swaps `game.ts` to the entity versions, and `tests/unit/divine-actions.test.ts` is the only remaining consumer. Both are removed in Task 3.6.

- [ ] **Step 2: Add `whisperEntity` alongside the legacy `whisper`**

Keep the legacy `whisper(spirit, sim: NpcSimState, log)` from Task 2.3 untouched. **Append** a new entity-based function to `src/sim/whisper.ts`:

```ts
// append to src/sim/whisper.ts
import type { Entity } from '@/core/types';
import { npcProps } from '@/world/npc-helpers';

/** Entity-based whisper. Spec A migration target; replaces `whisper` in Task 3.6. */
export function whisperEntity(spirit: Spirit, npc: Entity, log: EventLog): boolean {
  if (spirit.power < WHISPER_COST) return false;
  const p = npcProps(npc);
  if (p.whisperCooldown > 0) return false;

  spirit.power -= WHISPER_COST;

  const existing = p.beliefs[spirit.id];
  if (existing) {
    existing.faith = clamp01(existing.faith + WHISPER_FAITH_BOOST);
    existing.understanding = clamp01(existing.understanding + WHISPER_UNDERSTANDING_BOOST);
  } else {
    p.beliefs[spirit.id] = {
      faith: WHISPER_FAITH_BOOST,
      understanding: WHISPER_UNDERSTANDING_BOOST,
      devotion: 0,
    };
  }
  p.whisperCooldown = WHISPER_COOLDOWN;

  const appended = log.append({ type: 'whisper', spiritId: spirit.id, npcId: npc.id });
  p.recentEventIds.push(appended.id);
  if (p.recentEventIds.length > 8) p.recentEventIds.shift();

  return true;
}
```

- [ ] **Step 3: Add tests for `whisperEntity`**

Keep the existing `whisper` tests in `tests/unit/whisper.test.ts` as-is. **Append** a new `describe('whisperEntity', ...)` block:

```ts
// append to tests/unit/whisper.test.ts
import { whisperEntity } from '@/sim/whisper';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcProperties } from '@/core/types';

function makeNpcEntity(faith = 0.3): Entity {
  const props = initNpcProps('Alice', 'farmer', 42);
  props.beliefs['player'].faith = faith;
  return { id: 'npc-1', kind: 'npc', x: 0, y: 0, properties: props };
}

describe('whisperEntity', () => {
  it('debits spirit, boosts NPC faith, emits whisper event', () => {
    const spirit = makePlayer(3);
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    const ok = whisperEntity(spirit, e, log);
    expect(ok).toBe(true);
    expect(spirit.power).toBe(2);
    expect((e.properties as NpcProperties).beliefs['player'].faith).toBeGreaterThan(0.3);
    const evts = log.since(0);
    expect(evts[0].event).toMatchObject({ type: 'whisper', spiritId: 'player', npcId: 'npc-1' });
  });

  it('noop on insufficient power', () => {
    const spirit = makePlayer(0);
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    expect(whisperEntity(spirit, e, log)).toBe(false);
    expect(log.size()).toBe(0);
  });

  it('noop on cooldown', () => {
    const spirit = makePlayer(3);
    const e = makeNpcEntity();
    (e.properties as NpcProperties).whisperCooldown = 4;
    const log = new EventLog(new SimClock());
    expect(whisperEntity(spirit, e, log)).toBe(false);
  });

  it('creates a new belief entry for a previously unknown spirit', () => {
    const spirit: Spirit = { ...makePlayer(3), id: 'rival', name: 'Grooob', isPlayer: false };
    const e = makeNpcEntity();
    const log = new EventLog(new SimClock());
    whisperEntity(spirit, e, log);
    expect((e.properties as NpcProperties).beliefs['rival']).toBeDefined();
  });
});
```

- [ ] **Step 4: Add `tickNpcMovementEntities` to `src/sim/npc-movement.ts`**

Keep the legacy `tickNpcMovement(npcs: NpcInstance[], ...)` export untouched. **Add** the entity version alongside:

```ts
// append to src/sim/npc-movement.ts
import type { Entity, Direction } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';

const MOVE_INTERVAL_MS_ENTITY = 400;

function tileWalkableEntity(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.tiles[y]?.[x]?.walkable === true;
}

export function tickNpcMovementEntities(world: World, map: GameMap, dtMs: number): void {
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    p.moveCooldown = (p.moveCooldown ?? 0) - dtMs;
    if (p.moveCooldown > 0) return;
    p.moveCooldown = MOVE_INTERVAL_MS_ENTITY;

    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    const dir = dirs[Math.floor(Math.random() * 4)];
    const tx = Math.floor(e.x) + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0);
    const ty = Math.floor(e.y) + (dir === 'up'   ? -1 : dir === 'down'  ? 1 : 0);
    if (tileWalkableEntity(map, tx, ty)) {
      world.registry.update(e.id, { x: tx, y: ty });
      p.direction = dir;
    }
  });
}
```

The legacy `tickNpcMovement(npcs: NpcInstance[], ...)` stays for now; Task 3.4 swaps `game.ts` to call the entity version, and Task 3.6 removes the legacy one.

- [ ] **Step 5: Add entity-based tests to `tests/unit/npc-sim.test.ts`**

Keep all existing tests untouched (they cover the legacy `NpcSimState` API which still works). **Add** a new `describe('tickNpcEntity', ...)` block at the bottom of the file:

```ts
// append to tests/unit/npc-sim.test.ts
import { tickNpcEntity, tickAllNpcEntities } from '@/sim/npc-sim';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcProperties } from '@/core/types';
import { World } from '@/world/world';

function makeNpcEntity(seed = 42, faith = 0.5): Entity {
  const props = initNpcProps('Alice', 'farmer', seed);
  props.beliefs['player'].faith = faith;
  return { id: 'n1', kind: 'npc', x: 0, y: 0, properties: props };
}

describe('tickNpcEntity', () => {
  it('decays faith on tick (skeptic > 0 case)', () => {
    const e = makeNpcEntity(42, 0.5);
    const before = (e.properties as NpcProperties).beliefs.player.faith;
    tickNpcEntity(e);
    expect((e.properties as NpcProperties).beliefs.player.faith).toBeLessThanOrEqual(before);
  });

  it('decrements whisperCooldown', () => {
    const e = makeNpcEntity();
    (e.properties as NpcProperties).whisperCooldown = 3;
    tickNpcEntity(e);
    expect((e.properties as NpcProperties).whisperCooldown).toBe(2);
  });

  it('updates mood from needs', () => {
    const e = makeNpcEntity();
    const p = e.properties as NpcProperties;
    p.needs.safety = p.needs.prosperity = p.needs.community = p.needs.meaning = 0.9;
    tickNpcEntity(e);
    expect(p.mood).toBeGreaterThan(0.8);
  });
});
```

- [ ] **Step 6: Run all tests**

```
npm test
```

Expected: every test passes — old tests still use legacy APIs which we left in place; new tests cover the entity API.

- [ ] **Step 7: Commit**

```bash
git add src/sim/npc-sim.ts src/sim/whisper.ts src/sim/npc-movement.ts tests/unit/npc-sim.test.ts tests/unit/whisper.test.ts
git commit -m "refactor(sim): add entity-based whisper/tick/movement alongside legacy"
```

---

### Task 3.4: Migrate `game.ts` NPC spawning to entities + use entity-aware sim

**Files:**
- Modify: `src/game.ts`

- [ ] **Step 1: Rewrite `spawnNpcs` in `game.ts` to create world entities**

Replace the current `spawnNpcs` body (lines ~257-325 of `game.ts`) with:

```ts
private spawnNpcs(ws: WorldSeed, map: GameMap): void {
  if (!this.state.world) return;
  // Remove any existing npc entities (game restart)
  for (const e of this.state.world.query({ kind: 'npc' })) {
    this.state.world.removeEntity(e.id);
  }
  this.sheets.clear();

  for (const poi of ws.pois) {
    if (!poi.npcs?.length || !poi.position) continue;
    const { x: px, y: py } = poi.position;
    const poiBuildings = (map.buildings ?? []).filter(b => b.poiId === poi.id);

    for (let i = 0; i < poi.npcs.length; i++) {
      const npcDef = poi.npcs[i];
      const id = `${poi.id}-npc-${i}`;
      const seed = hashId(id);
      const role = npcDef.role as NpcRole;
      const safeRole: NpcRole = VALID_ROLES.includes(role) ? role : 'farmer';
      const name = npcDef.name || safeRole;
      const homeBuilding = assignHomeBuilding(safeRole, poiBuildings, i);

      let tileX: number;
      let tileY: number;
      if (homeBuilding) {
        const template = getBuildingTemplate(homeBuilding.templateId);
        if (template) {
          tileX = homeBuilding.tileX + template.doorCell.x;
          tileY = homeBuilding.tileY + template.doorCell.y;
        } else {
          tileX = Math.max(0, Math.min(map.width  - 1, px + (seed % 3) - 1));
          tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));
        }
      } else {
        tileX = Math.max(0, Math.min(map.width  - 1, px + (seed % 3) - 1));
        tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));
      }

      const props = initNpcProps(name, safeRole, seed);
      props.homeBuildingId = homeBuilding?.id;
      props.homePoiId = poi.id;

      this.state.world.addEntity({
        id, kind: 'npc', x: tileX, y: tileY, properties: props,
      });
      this.state.eventLog.append({ type: 'npc_spawn', npcId: id, role: safeRole, poiId: poi.id });

      const spec = buildCharacterSpec(safeRole, seed);
      getOrGenerateSheet(spec).then(canvas => {
        if (canvas) this.sheets.set(id, canvas);
      });
    }
  }
}
```

Add the import: `import { initNpcProps } from '@/world/npc-helpers';`

- [ ] **Step 2: Update the loop to use entity-aware sim + movement**

In `startLoop()` of `game.ts`, replace:

```ts
updateNpcs(this.state.npcs, deltaMs);
if (this.state.map) tickNpcMovement(this.state.npcs, this.state.map, deltaMs);
this.simTickAcc += deltaMs;
while (this.simTickAcc >= SIM_TICK_MS) {
  this.simTickAcc -= SIM_TICK_MS;
  tickAllNpcs(this.state.npcSim);
  this.state.playerPower += computePowerRegen(this.state.npcSim);
}
```

With:

```ts
if (this.state.world) {
  // Frame animations advance for all npc entities via shim
  this.updateNpcFrames(deltaMs);
  if (this.state.map) tickNpcMovementEntities(this.state.world, this.state.map, deltaMs);
  this.simTickAcc += deltaMs;
  while (this.simTickAcc >= SIM_TICK_MS) {
    this.simTickAcc -= SIM_TICK_MS;
    tickAllNpcEntities(this.state.world);
    // Per-spirit power regen
    const player = this.state.spirits.get('player')!;
    let total = 0;
    for (const e of this.state.world.query({ kind: 'npc' })) {
      const p = (e.properties as NpcProperties);
      total += p.beliefs['player']?.faith ?? 0;
    }
    player.power += total * 0.02;  // POWER_REGEN_RATE inline; SpiritSystem replaces this in PR 4
  }
}
```

Add a private helper:

```ts
private updateNpcFrames(deltaMs: number): void {
  if (!this.state.world) return;
  for (const e of this.state.world.query({ kind: 'npc' })) {
    const p = e.properties as NpcProperties;
    p.frameTimer += deltaMs;
    if (p.frameTimer >= FRAME_MS) {
      p.frameTimer -= FRAME_MS;
      p.frame = (p.frame % 8) + 1;
    }
  }
}
```

- [ ] **Step 3: Update the `render()` method**

Where it currently does `this.state.npcs.find(n => n.id === this.state.selectedNpcId)`, replace with `getNpc(world, this.state.selectedNpcId)` and pass through `toRenderNpc(e)` to the renderer-facing call.

Specifically in `render()`:

```ts
if (this.state.selectedNpcId && this.state.world) {
  const entity = getNpc(this.state.world, this.state.selectedNpcId);
  if (entity) {
    const npc = toRenderNpc(entity);
    const player = this.state.spirits.get('player')!;
    this.overlayHitAreas = drawNpcOverlay(
      this.ctx, npc, simStateFromEntity(entity), this.state.camera,
      rc.canvasWidth, rc.canvasHeight,
      player.power,
    );
    // ... rest of panel logic, using simStateFromEntity result
  }
}
```

Define a local adapter:

```ts
function simStateFromEntity(e: Entity): NpcSimState {
  const p = e.properties as NpcProperties;
  return {
    npcId: e.id, name: p.name, role: p.role, personality: p.personality,
    beliefs: p.beliefs, needs: p.needs, mood: p.mood,
    recentEvents: [],  // legacy field; recentEventIds is the new home
    whisperCooldown: p.whisperCooldown,
    homeBuildingId: p.homeBuildingId, homePoiId: p.homePoiId,
  };
}
```

Place this helper in `src/world/npc-helpers.ts` (export it). It's a temporary bridge; PR 4 removes it as overlay/info-panel/tooltip switch to reading entity properties directly.

- [ ] **Step 4: Update `RenderContext` construction**

In `render()`, the `RenderContext` field `npcs` is currently `this.state.npcs: NpcInstance[]`. Replace:

```ts
npcs: this.state.world ? this.state.world.query({ kind: 'npc' }).map(toRenderNpc) : [],
```

- [ ] **Step 5: Update tooltip + hover handlers in `game.ts`**

```ts
private updateTooltip(): void {
  if (!this.hoverTile || !this.hoverScreen || !this.state.world) {
    this.tooltip.style.display = 'none';
    return;
  }
  const { x, y } = this.hoverTile;
  const hovered = this.state.world.query({ kind: 'npc' })
    .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
  if (!hovered || hovered.id === this.state.selectedNpcId) {
    this.tooltip.style.display = 'none';
    return;
  }
  const p = hovered.properties as NpcProperties;
  this.tooltip.textContent = formatNpcTooltip({ name: p.name, role: p.role, mood: p.mood });
  this.tooltip.style.left = `${this.hoverScreen.x}px`;
  this.tooltip.style.top  = `${this.hoverScreen.y}px`;
  this.tooltip.style.display = 'block';
}

private onTileClick(x: number, y: number): void {
  if (!this.state.map || !this.state.world) return;
  const clicked = this.state.world.query({ kind: 'npc' })
    .find(e => Math.floor(e.x) === x && Math.floor(e.y) === y);
  if (clicked) {
    this.state.selectedNpcId = this.state.selectedNpcId === clicked.id ? null : clicked.id;
    if (this.state.pinnedNpcId && this.state.pinnedNpcId !== this.state.selectedNpcId) {
      this.state.pinnedNpcId = null;
    }
  } else if (!this.state.pinnedNpcId) {
    this.state.selectedNpcId = null;
  }
}
```

Similarly update `applyFollowCamera`:

```ts
private applyFollowCamera(): void {
  if (!this.state.followNpc || !this.state.selectedNpcId || !this.state.world) return;
  const e = getNpc(this.state.world, this.state.selectedNpcId);
  if (!e) { this.state.followNpc = false; return; }
  const cam = this.state.camera;
  const viewW = this.canvas.width  / devicePixelRatio / cam.zoom;
  const viewH = this.canvas.height / devicePixelRatio / cam.zoom;
  const targetX = (e.x + 0.5) * TILE_SIZE - viewW / 2;
  const targetY = (e.y + 0.5) * TILE_SIZE - viewH / 2;
  cam.x += (targetX - cam.x) * 0.15;
  cam.y += (targetY - cam.y) * 0.15;
}
```

- [ ] **Step 6: Update onClick whisper handler to use entity version**

Change the import to use `whisperEntity` and update the handler:

```ts
import { whisperEntity } from '@/sim/whisper';   // replaces the existing whisper import

private onCanvasClick(sx: number, sy: number): boolean {
  for (const area of this.overlayHitAreas) {
    if (sx >= area.x && sx <= area.x + area.w && sy >= area.y && sy <= area.y + area.h) {
      if (area.action === 'whisper' && area.active && this.state.world) {
        const e = getNpc(this.state.world, area.npcId);
        const player = this.state.spirits.get('player')!;
        if (e && whisperEntity(player, e, this.state.eventLog)) {
          this.lastWhisperTime = performance.now();
        }
      }
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 7: Run build, fix any remaining type errors**

```
npm run build
```

There may be a handful of unresolved references (e.g. `this.state.npcs` still appears elsewhere). Fix each with the equivalent world-query pattern. After this step, `state.npcs` and `state.npcSim` are still in `GameState` (Task 3.6 removes them) but `game.ts` no longer reads from them.

- [ ] **Step 8: Run tests**

```
npm test
```

Expected: all green. The legacy `whisperNpc`/`initNpcSim`/`computePowerRegen` exports still exist so `divine-actions.test.ts` keeps passing; they become dead code only after Task 3.4 (game.ts) and are removed in Task 3.6 / Task 4.3.

- [ ] **Step 9: Manual smoke test**

```
npm run dev
```

Open the browser, generate a world. Confirm:
- NPCs spawn and animate
- Hovering an NPC shows tooltip
- Clicking selects; whisper button works
- Power counter ticks up

- [ ] **Step 10: Commit**

```bash
git add src/game.ts src/world/npc-helpers.ts
git commit -m "refactor(game): NPC spawning and consumers read from world entities"
```

---

### Task 3.5: Update info-panel, tooltip, overlay to read entity-backed NPCs

**Files:**
- Modify: `src/ui/npc-info-panel.ts`
- Modify: `src/render/sim-overlay.ts`
- Modify: `src/render/npc-animator.ts`

The strategy: keep public signatures stable, but consume the entity-backed data through the `simStateFromEntity` shim where convenient. Direct reads of `e.properties` are fine too. Goal: no module references `state.npcs` or `state.npcSim`.

- [ ] **Step 1: Verify the three files compile with the current shim**

```
npm run build
```

If errors remain in those three files, the most likely cause is they directly import `NpcSimState` or `NpcInstance` types. Update imports to `NpcProperties` and read accordingly, or accept the existing types and have callers pre-adapt with `toRenderNpc` / `simStateFromEntity`.

- [ ] **Step 2: Update `npc-animator.ts` if it references `NpcInstance[]`**

If `updateNpcs(npcs: NpcInstance[], dt)` is still used, it's covered by the `updateNpcFrames` we added in Task 3.4. Delete the old export if nothing else imports it. Keep `getSpriteCoords` (it's renderer-only).

- [ ] **Step 3: Run tests**

```
npm test
```

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "refactor(ui+render): UI consumers operate on entity-backed NPCs"
```

---

### Task 3.6: Remove legacy sim/whisper exports; remove `state.npcs` and `state.npcSim`; clean up types

**Files:**
- Modify: `src/sim/npc-sim.ts` (remove legacy exports)
- Modify: `src/sim/whisper.ts` (rename `whisperEntity` → `whisper`; remove legacy)
- Modify: `src/sim/npc-movement.ts` (remove legacy `tickNpcMovement`)
- Modify: `src/core/state.ts`
- Modify: `src/core/types.ts`
- Modify: `tests/unit/divine-actions.test.ts` (delete)
- Modify: `tests/unit/npc-sim.test.ts` (remove tests of removed legacy exports)
- Modify: `tests/unit/whisper.test.ts` (rename `whisperEntity` references back to `whisper`)

- [ ] **Step 1: Remove legacy exports from `src/sim/npc-sim.ts`**

Delete the `initNpcSim`, `tickNpcSim`, `tickAllNpcs` functions and the `SIM_TICK_MS` constant if unused. Keep `clamp01`, `computeMood`, `personalityFromSeed`, `tickNpcEntity`, `tickAllNpcEntities`.

- [ ] **Step 2: Replace legacy `whisper` with entity version**

In `src/sim/whisper.ts`:
- Delete the legacy `whisper(spirit, sim: NpcSimState, log)` function.
- Rename `whisperEntity` → `whisper`.

- [ ] **Step 3: Update `src/sim/npc-movement.ts`**

Delete the legacy `tickNpcMovement(npcs: NpcInstance[], ...)` and `MOVE_INTERVAL_MS` constant. Keep `tickNpcMovementEntities` and `MOVE_INTERVAL_MS_ENTITY` (rename the latter back to `MOVE_INTERVAL_MS`).

- [ ] **Step 4: Update consumer in `src/game.ts`**

Change `import { whisperEntity } from '@/sim/whisper';` back to `import { whisper } from '@/sim/whisper';` and rename the call site `whisperEntity(...)` → `whisper(...)`.

- [ ] **Step 5: Delete `tests/unit/divine-actions.test.ts`**

```
rm tests/unit/divine-actions.test.ts
```

- [ ] **Step 6: Update `tests/unit/npc-sim.test.ts`**

Remove any `describe('initNpcSim', ...)`, `describe('tickNpcSim', ...)`, `describe('tickAllNpcs', ...)` blocks that test the deleted functions. Keep `describe('clamp01', ...)`, `describe('personalityFromSeed', ...)`, `describe('computeMood', ...)`, `describe('tickNpcEntity', ...)`.

- [ ] **Step 7: Update `tests/unit/whisper.test.ts`**

Remove any `describe('whisper', ...)` blocks that test the deleted legacy `whisper(spirit, sim, log)`. The `whisperEntity` describe block stays — rename the function references from `whisperEntity(...)` to `whisper(...)`.

- [ ] **Step 8: Remove fields from `GameState`**

In `src/core/state.ts`:
- Remove the `npcs: NpcInstance[];` field and its `npcs: []` line in `createState()`.
- Remove the `npcSim: Map<string, NpcSimState>;` field and its `npcSim: new Map()` line.
- Remove imports of `NpcInstance`, `NpcSimState`.

- [ ] **Step 9: Annotate retained types in `src/core/types.ts`**

`NpcInstance` is still used by the renderer shim (`toRenderNpc` returns it). Add a JSDoc comment:

```ts
/** Render-only adapter shape (built via toRenderNpc in npc-helpers.ts). Not stored anywhere persistent. */
export interface NpcInstance { /* existing fields */ }
```

`NpcSimState` is still used by the `simStateFromEntity` shim (Task 3.4). Same treatment:

```ts
/** Legacy shape consumed by render-overlay/info-panel helpers; built via simStateFromEntity. Not stored. */
export interface NpcSimState { /* existing fields */ }
```

- [ ] **Step 10: Build + tests**

```
npm run build && npm test
```

Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add -u
git commit -m "refactor(sim+state): remove legacy NpcSimState-based sim; NPCs live in World"
```

PR 3 complete. NPCs are entities everywhere it matters; legacy sim functions and `state.npcs`/`state.npcSim` are gone.

---

## PR 4 — Wire existing systems to the scheduler

### Task 4.1: NpcMovementSystem

**Files:**
- Create: `src/sim/systems/npc-movement-system.ts`

- [ ] **Step 1: Write the wrapper**

```ts
// src/sim/systems/npc-movement-system.ts
import type { System, SystemContext } from '@/core/scheduler';
import { tickNpcMovementEntities } from '@/sim/npc-movement';

export class NpcMovementSystem implements System {
  readonly name = 'npc_movement';
  readonly tickHz = 60;
  private readonly getMap: (ctx: SystemContext) => { map: NonNullable<ReturnType<typeof getMapInner>> | null };

  constructor(private mapAccessor: () => { width: number; height: number; tiles: import('@/core/types').Tile[][] } | null) {
    // Map is owned by GameState; pass an accessor that returns null until seedWorld() runs.
    this.getMap = (ctx) => ({ map: this.mapAccessor() });
  }

  tick(ctx: SystemContext): void {
    const map = this.mapAccessor();
    if (!map) return;
    // tickNpcMovementEntities currently expects a GameMap; the relevant fields are width/height/tiles.
    tickNpcMovementEntities(ctx.world, map as never, ctx.dt);
  }
}

function getMapInner(): null { return null; }  // type helper; the cast above lets us avoid pulling in the full GameMap shape
```

A simpler version (preferred — cleaner):

```ts
// src/sim/systems/npc-movement-system.ts
import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { tickNpcMovementEntities } from '@/sim/npc-movement';

export class NpcMovementSystem implements System {
  readonly name = 'npc_movement';
  readonly tickHz = 60;

  constructor(private getMap: () => GameMap | null) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    if (!map) return;
    tickNpcMovementEntities(ctx.world, map, ctx.dt);
  }
}
```

- [ ] **Step 2: Commit (no test yet — covered by integration in Task 4.4)**

```bash
git add src/sim/systems/npc-movement-system.ts
git commit -m "feat(sim): NpcMovementSystem wrapper"
```

---

### Task 4.2: NpcSimSystem with threshold detection

**Files:**
- Create: `src/sim/systems/npc-sim-system.ts`
- Test: `tests/unit/npc-sim-system.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/npc-sim-system.test.ts
import { describe, it, expect } from 'vitest';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Entity, NpcProperties } from '@/core/types';

function makeCtx() {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const world = new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
  return { world, log, clock, spirits: new Map() };
}

function addNpc(world: World, id: string, faith: number): Entity {
  const props = initNpcProps('Alice', 'farmer', 42);
  props.beliefs['player'].faith = faith;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: props };
  world.addEntity(e);
  return e;
}

describe('NpcSimSystem', () => {
  it('ticks sim state for all npc entities', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    const e = addNpc(ctx.world, 'n1', 0.5);
    const before = (e.properties as NpcProperties).beliefs['player'].faith;
    sys.tick({ ...ctx, dt: 1000, now: 0 });
    expect((e.properties as NpcProperties).beliefs['player'].faith).toBeLessThanOrEqual(before);
  });

  it('emits belief_cross high when faith first crosses 0.6 upward', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    const e = addNpc(ctx.world, 'n1', 0.59);
    // Manually bump above threshold and re-tick
    (e.properties as NpcProperties).beliefs['player'].faith = 0.62;
    sys.tick({ ...ctx, dt: 1000, now: 5 });
    const evts = ctx.log.since(0).map(a => a.event);
    expect(evts.some(e => e.type === 'belief_cross' && e.kind === 'high' && e.npcId === 'n1')).toBe(true);
  });

  it('emits belief_cross low when faith drops below 0.3', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    const e = addNpc(ctx.world, 'n1', 0.31);
    // First tick establishes baseline above threshold
    sys.tick({ ...ctx, dt: 1000, now: 1 });
    // Manually drop
    (e.properties as NpcProperties).beliefs['player'].faith = 0.25;
    sys.tick({ ...ctx, dt: 1000, now: 2 });
    const evts = ctx.log.since(0).map(a => a.event);
    expect(evts.some(e => e.type === 'belief_cross' && e.kind === 'low')).toBe(true);
  });

  it('does not re-emit belief_cross while staying on the same side of threshold', () => {
    const sys = new NpcSimSystem();
    const ctx = makeCtx();
    addNpc(ctx.world, 'n1', 0.7);
    sys.tick({ ...ctx, dt: 1000, now: 1 });
    sys.tick({ ...ctx, dt: 1000, now: 2 });
    sys.tick({ ...ctx, dt: 1000, now: 3 });
    const crosses = ctx.log.since(0).map(a => a.event).filter(e => e.type === 'belief_cross');
    expect(crosses.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- npc-sim-system.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `NpcSimSystem`**

```ts
// src/sim/systems/npc-sim-system.ts
import type { System, SystemContext } from '@/core/scheduler';
import { tickNpcEntity } from '@/sim/npc-sim';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import type { SpiritId } from '@/core/spirit';

const BELIEF_HIGH = 0.6;
const BELIEF_LOW = 0.3;
const MOOD_HIGH = 0.7;
const MOOD_LOW = 0.3;

type Side = 'high' | 'mid' | 'low';

function beliefSide(faith: number): Side {
  if (faith >= BELIEF_HIGH) return 'high';
  if (faith <= BELIEF_LOW) return 'low';
  return 'mid';
}
function moodSide(mood: number): Side {
  if (mood >= MOOD_HIGH) return 'high';
  if (mood <= MOOD_LOW) return 'low';
  return 'mid';
}

export class NpcSimSystem implements System {
  readonly name = 'npc_sim';
  readonly tickHz = 1;
  // Track last side per (npcId, spiritId) and (npcId) for moods
  private beliefSides = new Map<string, Side>();   // key = `${npcId}:${spiritId}`
  private moodSides = new Map<string, Side>();     // key = npcId

  tick(ctx: SystemContext): void {
    forEachNpc(ctx.world, (e) => {
      const before: Record<SpiritId, number> = {};
      const props = npcProps(e);
      for (const [sid, b] of Object.entries(props.beliefs)) before[sid] = b.faith;

      tickNpcEntity(e);

      for (const [sid, b] of Object.entries(props.beliefs)) {
        const key = `${e.id}:${sid}`;
        const prev = this.beliefSides.get(key);
        const cur = beliefSide(b.faith);
        if (prev && prev !== cur && cur !== 'mid') {
          ctx.log.append({ type: 'belief_cross', npcId: e.id, spiritId: sid, kind: cur, faith: b.faith });
        }
        this.beliefSides.set(key, cur);
      }

      const mp = this.moodSides.get(e.id);
      const mc = moodSide(props.mood);
      if (mp && mp !== mc && mc !== 'mid') {
        ctx.log.append({ type: 'mood_cross', npcId: e.id, kind: mc, mood: props.mood });
      }
      this.moodSides.set(e.id, mc);
    });
  }
}
```

- [ ] **Step 4: Run tests**

```
npm test -- npc-sim-system.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/npc-sim-system.ts tests/unit/npc-sim-system.test.ts
git commit -m "feat(sim): NpcSimSystem with belief/mood threshold detection"
```

---

### Task 4.3: SpiritSystem; delete `divine-actions.ts`

**Files:**
- Create: `src/sim/spirit-system.ts`
- Test: `tests/unit/spirit-system.test.ts`
- Delete: `src/sim/divine-actions.ts` (its test file was already deleted in Task 3.6)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/spirit-system.test.ts
import { describe, it, expect } from 'vitest';
import { SpiritSystem, POWER_REGEN_RATE } from '@/sim/spirit-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function makeSpirit(id: string, isPlayer = false, power = 1): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer, power, manifestation: null };
}
function ctx(spirits: Map<SpiritId, Spirit>) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const world = new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
  return { world, log, clock, spirits };
}
function addBeliever(world: World, id: string, faiths: Record<string, number>) {
  const props = initNpcProps('Alice', 'farmer', 1);
  props.beliefs = Object.fromEntries(
    Object.entries(faiths).map(([sid, f]) => [sid, { faith: f, understanding: 0, devotion: 0 }])
  );
  world.addEntity({ id, kind: 'npc', x: 0, y: 0, properties: props } as Entity);
}

describe('SpiritSystem', () => {
  it('regens power for each spirit from its believers faith', () => {
    const spirits = new Map<SpiritId, Spirit>([
      ['player', makeSpirit('player', true, 1)],
      ['rival',  makeSpirit('rival', false, 1)],
    ]);
    const c = ctx(spirits);
    addBeliever(c.world, 'n1', { player: 0.8, rival: 0.4 });
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 1 });
    expect(spirits.get('player')!.power).toBeCloseTo(1 + 0.8 * POWER_REGEN_RATE, 6);
    expect(spirits.get('rival')!.power).toBeCloseTo(1 + 0.4 * POWER_REGEN_RATE, 6);
  });

  it('emits power_depleted when a spirit hits zero', () => {
    const spirits = new Map<SpiritId, Spirit>([['p', { ...makeSpirit('p'), power: 0 }]]);
    const c = ctx(spirits);
    addBeliever(c.world, 'n1', { p: 0 });  // no faith → no regen
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 1 });
    const evts = c.log.since(0);
    expect(evts.length).toBe(1);
    expect(evts[0].event).toMatchObject({ type: 'power_depleted', spiritId: 'p' });
  });

  it('does not re-emit power_depleted on subsequent ticks while still at zero', () => {
    const spirits = new Map<SpiritId, Spirit>([['p', { ...makeSpirit('p'), power: 0 }]]);
    const c = ctx(spirits);
    const sys = new SpiritSystem();
    sys.tick({ ...c, dt: 1000, now: 1 });
    sys.tick({ ...c, dt: 1000, now: 2 });
    const evts = c.log.since(0).map(a => a.event).filter(e => e.type === 'power_depleted');
    expect(evts.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- spirit-system.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement SpiritSystem**

```ts
// src/sim/spirit-system.ts
import type { System, SystemContext } from '@/core/scheduler';
import type { SpiritId } from '@/core/spirit';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

export const POWER_REGEN_RATE = 0.02;

export class SpiritSystem implements System {
  readonly name = 'spirits';
  readonly tickHz = 1;
  private depletedAlready = new Set<SpiritId>();

  tick(ctx: SystemContext): void {
    const totals = new Map<SpiritId, number>();
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      for (const [sid, b] of Object.entries(p.beliefs)) {
        totals.set(sid, (totals.get(sid) ?? 0) + b.faith);
      }
    });

    for (const [sid, spirit] of ctx.spirits) {
      const total = totals.get(sid) ?? 0;
      spirit.power += total * POWER_REGEN_RATE;

      if (spirit.power <= 0) {
        if (!this.depletedAlready.has(sid)) {
          ctx.log.append({ type: 'power_depleted', spiritId: sid });
          this.depletedAlready.add(sid);
        }
      } else {
        this.depletedAlready.delete(sid);
      }
    }
  }
}
```

- [ ] **Step 4: Run test**

```
npm test -- spirit-system.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Delete old divine-actions source**

```
rm src/sim/divine-actions.ts
```

(The test file was already removed in Task 3.6.) If any import of `'@/sim/divine-actions'` remains, `npm run build` will flag it — replace with imports from `'@/sim/whisper'` (for whisper constants) or `'@/sim/spirit-system'` (for `POWER_REGEN_RATE`).

- [ ] **Step 6: Build + test**

```
npm run build && npm test
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -u
git add src/sim/spirit-system.ts tests/unit/spirit-system.test.ts
git commit -m "feat(sim): SpiritSystem (per-spirit regen + power_depleted); remove divine-actions.ts"
```

---

### Task 4.4: Wire `game.ts` to the scheduler

**Files:**
- Modify: `src/game.ts`

- [ ] **Step 1: Construct and register systems in `Game` constructor**

Add a `private scheduler: Scheduler` field, initialize in the constructor after `this.state = createState();`:

```ts
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';

// in constructor, after createState:
this.scheduler = new Scheduler();
this.scheduler.register(new NpcMovementSystem(() => this.state.map));
this.scheduler.register(new NpcSimSystem());
this.scheduler.register(new SpiritSystem());
```

- [ ] **Step 2: Replace the manual loop body**

Replace the body of the RAF `loop` closure in `startLoop()`:

```ts
const loop = (now: number) => {
  const deltaMs = Math.min(now - this.lastTime, 100);
  this.lastTime = now;
  if (deltaMs > 0) {
    const instantFps = 1000 / deltaMs;
    this.fpsEma = this.fpsEma * 0.9 + instantFps * 0.1;
  }
  if (!this.state.paused && this.state.world) {
    this.scheduler.tick(deltaMs, {
      world: this.state.world,
      spirits: this.state.spirits,
      log: this.state.eventLog,
      clock: this.state.clock,
    });
    this.updateNpcFrames(deltaMs);  // presentation-only; not a scheduled system
  }
  this.applyFollowCamera();
  this.render();
  this.rafId = requestAnimationFrame(loop);
};
```

Remove the old `simTickAcc`, `tickAllNpcEntities`, `tickNpcMovementEntities` inline calls — they're now driven by the scheduler. The frame-animation update stays inline (view-state mutation, not narrative).

- [ ] **Step 3: Build + test + manual smoke**

```
npm run build && npm test && npm run dev
```

Verify in the browser:
- NPCs still move
- Power still ticks up
- Whisper still works
- (New) Belief crossings appear in the log — to confirm, open browser devtools and run:

```js
window.__game.state.eventLog.since(0)  // (you may need to expose __game in main.ts for inspection)
```

Add a one-line `window.__game = game` in `src/main.ts` for development inspection (revert before shipping).

- [ ] **Step 4: Commit**

```bash
git add src/game.ts
git commit -m "refactor(game): drive sim through scheduler with registered systems"
```

PR 4 complete. The main loop is now `scheduler.tick(); render();`.

---

## PR 5 — Tile realization + PerceptionSystem + cradle start

### Task 5.1: Add `TileState` and the `Oracle` seam

**Files:**
- Modify: `src/core/types.ts` (add `TileState`, add `state` to `Tile`)
- Create: `src/world/oracle.ts`

- [ ] **Step 1: Add `TileState`**

In `src/core/types.ts`, change `Tile`:

```ts
export type TileState = 'void' | 'realizing' | 'realized';

export interface Tile {
  type: string;
  x: number;
  y: number;
  walkable: boolean;
  /** Reality state. 'realizing' is reserved for Spec D animation + Oracle override window; Spec A never produces it. */
  state: TileState;
  realizedAt?: number;
  height?: number;
  bridgeDirection?: string;
}
```

- [ ] **Step 2: Default-initialize `state: 'realized'` in existing tile constructors**

Search for every place that constructs a `Tile`:

```
grep -rn "type:.*walkable:" src/
```

For each constructor, add `state: 'realized'` as a default. The map-generator code currently produces realized tiles for the whole grid (until Task 5.3 changes it). This step keeps the field non-optional and behavior unchanged.

- [ ] **Step 3: Implement Oracle stub**

```ts
// src/world/oracle.ts
/**
 * Reality decider for tiles being realized. Spec A ships the identity oracle:
 * whatever the substrate (WFC) said the tile should be is what it becomes.
 * The future Oracle spec replaces this with a narrative-driven decider.
 */
export interface Oracle {
  realizeTile(x: number, y: number, substrateType: string): { type: string; by: 'wfc' | 'oracle' };
}

export const identityOracle: Oracle = {
  realizeTile(_x, _y, substrateType) {
    return { type: substrateType, by: 'wfc' };
  },
};
```

- [ ] **Step 4: Build**

```
npm run build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/world/oracle.ts $(grep -rln 'state:.*realized' src/)
git commit -m "feat(world): TileState + identity Oracle stub"
```

---

### Task 5.2: PerceptionSystem

**Files:**
- Create: `src/world/perception-system.ts`
- Test: `tests/unit/perception-system.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/perception-system.test.ts
import { describe, it, expect } from 'vitest';
import { PerceptionSystem } from '@/world/perception-system';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { identityOracle } from '@/world/oracle';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeMap(w: number, h: number, type = 'grass'): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type, x, y, walkable: true, state: 'void' });
    }
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function setup(faith = 0.5) {
  const map = makeMap(20, 20);
  const world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  props.beliefs['player'].faith = faith;
  const e: Entity = { id: 'n1', kind: 'npc', x: 10, y: 10, properties: props };
  world.addEntity(e);
  const log = new EventLog(new SimClock());
  return { world, log, map, e };
}

describe('PerceptionSystem', () => {
  it('initial tick realizes a bubble around the believer', () => {
    const sys = new PerceptionSystem(identityOracle, () => null);
    const { world, log, map } = setup(0.2);  // small faith
    sys.tick({ world, log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    // Center tile should be realized
    expect(map.tiles[10][10].state).toBe('realized');
    // Far corner should still be void
    expect(map.tiles[0][0].state).toBe('void');
  });

  it('bubble radius grows with faith', () => {
    const a = setup(0.0);
    const b = setup(1.0);
    const sys = new PerceptionSystem(identityOracle, () => null);
    sys.tick({ world: a.world, log: a.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    sys.tick({ world: b.world, log: b.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    const countA = a.map.tiles.flat().filter(t => t.state === 'realized').length;
    const countB = b.map.tiles.flat().filter(t => t.state === 'realized').length;
    expect(countB).toBeGreaterThan(countA);
  });

  it('emits one region_realized per growth tick', () => {
    const sys = new PerceptionSystem(identityOracle, () => null);
    const s = setup(0.5);
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    const regionEvents = s.log.since(0).map(a => a.event).filter(e => e.type === 'region_realized');
    expect(regionEvents.length).toBe(1);
  });

  it('emits tile_collapsed per realized tile, deterministically ordered', () => {
    const sys = new PerceptionSystem(identityOracle, () => null);
    const s = setup(0.0);
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    const tileEvents = s.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed');
    expect(tileEvents.length).toBeGreaterThan(0);
    // Determinism: same setup twice should produce same sequence
    const s2 = setup(0.0);
    sys.tick({ world: s2.world, log: s2.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    const tileEvents2 = s2.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed');
    expect(tileEvents).toEqual(tileEvents2);
  });

  it('does not re-emit tile_collapsed for already-realized tiles', () => {
    const sys = new PerceptionSystem(identityOracle, () => null);
    const s = setup(0.0);
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 1 });
    const firstCount = s.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed').length;
    sys.tick({ world: s.world, log: s.log, clock: new SimClock(), spirits: new Map(), dt: 500, now: 2 });
    const secondCount = s.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed').length;
    // Second tick may or may not add any new tiles if faith didn't change.
    // The invariant is that no tile fires twice.
    const ids = s.log.since(0).map(a => a.event).filter(e => e.type === 'tile_collapsed') as { x: number; y: number }[];
    const set = new Set(ids.map(e => `${e.x},${e.y}`));
    expect(set.size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```
npm test -- perception-system.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement `PerceptionSystem`**

```ts
// src/world/perception-system.ts
import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap, Region, Tile } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import type { Oracle } from '@/world/oracle';

const BASE_RADIUS = 3;
const MAX_FAITH_BONUS = 4;

export class PerceptionSystem implements System {
  readonly name = 'perception';
  readonly tickHz = 2;

  constructor(
    private readonly oracle: Oracle,
    private readonly getMap: () => GameMap | null,
    /** If provided, the substrate type for (x, y). Defaults to current tile.type. */
    private readonly getSubstrate?: (x: number, y: number) => string,
  ) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    if (!map) return;

    // Collect believer points with their reach
    const reaches: Array<{ x: number; y: number; r: number }> = [];
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      let bestFaith = 0;
      for (const b of Object.values(p.beliefs)) {
        if (b.faith > bestFaith) bestFaith = b.faith;
      }
      const r = BASE_RADIUS + Math.floor(bestFaith * MAX_FAITH_BONUS);
      reaches.push({ x: Math.floor(e.x), y: Math.floor(e.y), r });
    });

    if (reaches.length === 0) return;

    // Compute newly-realized tiles. Deterministic order: scan by (cy, cx) tile-major.
    const newlyRealized: Tile[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const reach of reaches) {
      const x0 = Math.max(0, reach.x - reach.r);
      const x1 = Math.min(map.width  - 1, reach.x + reach.r);
      const y0 = Math.max(0, reach.y - reach.r);
      const y1 = Math.min(map.height - 1, reach.y + reach.r);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - reach.x, dy = y - reach.y;
          if (dx * dx + dy * dy > reach.r * reach.r) continue;
          const tile = map.tiles[y][x];
          if (tile.state === 'realized') continue;
          newlyRealized.push(tile);
        }
      }
    }

    if (newlyRealized.length === 0) return;

    // Dedup (a tile may be inside multiple believer bubbles), sort by (y, x) for determinism
    const seen = new Set<string>();
    const ordered: Tile[] = [];
    for (const t of newlyRealized) {
      const k = `${t.x},${t.y}`;
      if (seen.has(k)) continue;
      seen.add(k);
      ordered.push(t);
    }
    ordered.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    for (const t of ordered) {
      const substrate = this.getSubstrate ? this.getSubstrate(t.x, t.y) : t.type;
      const decided = this.oracle.realizeTile(t.x, t.y, substrate);
      t.type = decided.type;
      t.state = 'realized';
      t.realizedAt = ctx.now;
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x > maxX) maxX = t.x;
      if (t.y > maxY) maxY = t.y;
      ctx.log.append({ type: 'tile_collapsed', x: t.x, y: t.y, becameType: decided.type, by: decided.by });
    }

    const region: Region = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    ctx.log.append({ type: 'region_realized', region, cause: 'belief_spread' });
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

```
npm test -- perception-system.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/world/perception-system.ts tests/unit/perception-system.test.ts
git commit -m "feat(world): PerceptionSystem — believer-driven tile realization"
```

---

### Task 5.3: `seedWorld` (cradle start)

**Files:**
- Create: `src/world/seed-world.ts`
- Test: `tests/unit/seed-world.test.ts`
- Modify: `src/game.ts` to call `seedWorld` instead of running NPCs after `generateWithNoise`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/seed-world.test.ts
import { describe, it, expect } from 'vitest';
import { seedWorld } from '@/world/seed-world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import type { GameMap, Tile, WorldSeed } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { identityOracle } from '@/world/oracle';

function emptyMap(w = 20, h = 20): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function minimalWorldSeed(): WorldSeed {
  return {
    name: 'TestWorld',
    size: { width: 20, height: 20 },
    biome: 'temperate',
    pois: [
      { id: 'village-1', type: 'village', position: { x: 10, y: 10 },
        npcs: [{ name: 'Alice', role: 'farmer' }] },
    ],
    connections: [],
    constraints: [],
  };
}

describe('seedWorld', () => {
  it('emits the canonical cradle event sequence', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const world = new World(emptyMap());
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true,
      power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    seedWorld({ world, log, clock, spirits, worldSeed: ws, map: world.tiles, oracle: identityOracle });

    const types = log.since(0).map(a => a.event.type);
    expect(types).toContain('npc_spawn');
    expect(types).toContain('region_realized');
    expect(types).toContain('world_seeded');
    // world_seeded is last (chapter zero marker)
    expect(types[types.length - 1]).toBe('world_seeded');
  });

  it('realizes only the cradle bubble, not the whole map', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const world = new World(emptyMap());
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    // Reset tiles to 'void' as seedWorld would expect (the substrate-pass marks all tiles void)
    for (const row of world.tiles.tiles) for (const t of row) t.state = 'void';

    seedWorld({ world, log, clock, spirits, worldSeed: ws, map: world.tiles, oracle: identityOracle });

    const realized = world.tiles.tiles.flat().filter(t => t.state === 'realized').length;
    const total = world.tiles.width * world.tiles.height;
    expect(realized).toBeGreaterThan(0);
    expect(realized).toBeLessThan(total);
  });

  it('spawns the seed NPC at the configured POI', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const world = new World(emptyMap());
    const spirits = new Map<SpiritId, Spirit>([['player', {
      id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 3, manifestation: null,
    }]]);
    const ws = minimalWorldSeed();

    seedWorld({ world, log, clock, spirits, worldSeed: ws, map: world.tiles, oracle: identityOracle });

    const npcs = world.query({ kind: 'npc' });
    expect(npcs.length).toBe(1);
    expect(Math.abs(npcs[0].x - 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(npcs[0].y - 10)).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Implement `seedWorld`**

```ts
// src/world/seed-world.ts
import type { GameMap, WorldSeed, NpcRole } from '@/core/types';
import type { EventLog } from '@/core/events';
import type { SimClock } from '@/core/clock';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Oracle } from '@/world/oracle';
import { World } from '@/world/world';
import { PerceptionSystem } from '@/world/perception-system';
import { initNpcProps } from '@/world/npc-helpers';

const VALID_ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

export interface SeedWorldArgs {
  world: World;
  log: EventLog;
  clock: SimClock;
  spirits: Map<SpiritId, Spirit>;
  worldSeed: WorldSeed;
  map: GameMap;
  oracle: Oracle;
}

export function seedWorld(args: SeedWorldArgs): void {
  const { world, log, clock, spirits, worldSeed, map, oracle } = args;

  // 1. Mark every tile void
  for (const row of map.tiles) for (const t of row) t.state = 'void';

  // 2. Pick seed POI (first one with NPCs and a position)
  const seedPoi = worldSeed.pois.find(p => p.npcs && p.npcs.length > 0 && p.position);
  if (!seedPoi || !seedPoi.position) {
    throw new Error('seedWorld: no POI with a seed NPC found in worldSeed');
  }

  // 3. Spawn the seed NPC
  const npcDef = seedPoi.npcs![0];
  const role: NpcRole = VALID_ROLES.includes(npcDef.role as NpcRole) ? npcDef.role as NpcRole : 'farmer';
  const name = npcDef.name || role;
  const id = `${seedPoi.id}-npc-0`;
  const seed = hashId(id);
  const props = initNpcProps(name, role, seed);
  props.homePoiId = seedPoi.id;
  // Cradle starts with low faith — the believer barely believes
  props.beliefs['player'].faith = 0.2;
  world.addEntity({ id, kind: 'npc', x: seedPoi.position.x, y: seedPoi.position.y, properties: props });
  log.append({ type: 'npc_spawn', npcId: id, role, poiId: seedPoi.id });

  // 4. Run PerceptionSystem once to realize the cradle bubble
  const perception = new PerceptionSystem(oracle, () => map);
  perception.tick({
    world, spirits, log, clock,
    dt: 500, now: clock.now(),
  });

  // 5. Mark cradle cause on the first region_realized event
  // (Easiest: re-emit; but we don't want duplicates. Instead, perception emitted
  //  cause: 'belief_spread'. We just append a wrap-up world_seeded event.)
  log.append({
    type: 'world_seeded',
    worldSeed,
    substrateSeed: map.seed,
  });
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
```

Note: the test expects `region_realized` events present. The PerceptionSystem emits them with `cause: 'belief_spread'`. The test asserts type only (not cause), so this works.

If you want `cause: 'cradle_start'` specifically, modify PerceptionSystem to accept a cause parameter via the SystemContext or via a constructor option. For Spec A, we can let perception always emit `belief_spread` — `world_seeded` is the unambiguous chapter zero marker.

- [ ] **Step 3: Run test**

```
npm test -- seed-world.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Wire `seedWorld` into `game.ts`**

In `generateWorld()` in `game.ts`, replace:

```ts
this.spawnNpcs(ws, map);
```

with:

```ts
seedWorld({
  world: this.state.world,
  log: this.state.eventLog,
  clock: this.state.clock,
  spirits: this.state.spirits,
  worldSeed: ws,
  map,
  oracle: identityOracle,
});
```

Imports:
```ts
import { seedWorld } from '@/world/seed-world';
import { identityOracle } from '@/world/oracle';
```

Remove the now-unused `spawnNpcs` method body. Keep the `assignHomeBuilding` helper at the bottom of the file for future full-population spawn calls (Task 6.3 moves it).

- [ ] **Step 5: Register PerceptionSystem in `Game` constructor**

```ts
import { PerceptionSystem } from '@/world/perception-system';

// in constructor after other system registrations
this.scheduler.register(new PerceptionSystem(identityOracle, () => this.state.map));
```

- [ ] **Step 6: Build + test + manual smoke**

```
npm run build && npm test && npm run dev
```

In the browser: game should open with a small visible bubble around one NPC, the rest of the map invisible (renderer skip is Task 5.4 — until that lands, void tiles still render as their substrate type).

- [ ] **Step 7: Commit**

```bash
git add src/world/seed-world.ts tests/unit/seed-world.test.ts src/game.ts
git commit -m "feat(world): seedWorld — cradle start with one believer and a tiny realized bubble"
```

---

### Task 5.4: Renderer skips void tiles

**Files:**
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: Locate the terrain draw inner loop**

In `src/render/renderer.ts`, find `drawTerrain` (or the part of `renderMap` that iterates tiles).

- [ ] **Step 2: Add the void skip**

At the start of each tile iteration, before drawing:

```ts
const tile = rc.map.tiles[y][x];
if (tile.state === 'void') continue;
```

This skips both terrain sprite and grid lines for void tiles. The canvas background color shows through.

- [ ] **Step 3: Confirm overlays (POIs, decorations, NPCs) skip void positions too**

NPCs are entity-positioned; they only exist within the believer-anchored realized region by construction, so they're effectively safe — but add a defensive guard in the entity draw pass: if `tile at (entity.x, entity.y)` is `'void'`, skip drawing that entity. This protects against decorations the player placed before the belief bubble retreated.

- [ ] **Step 4: Build + manual smoke**

```
npm run build && npm run dev
```

Game opens to a tiny bubble of visible terrain; the rest is bg color.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): skip void tiles and out-of-bubble entities"
```

---

### Task 5.5: NPCs confined to realized tiles

**Files:**
- Modify: `src/sim/npc-movement.ts`

- [ ] **Step 1: Update `tileWalkable` to require realization**

```ts
function tileWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y]?.[x];
  return t?.walkable === true && t.state === 'realized';
}
```

- [ ] **Step 2: Run tests**

```
npm test
```

Existing movement tests don't reference realization (they use a stub map). They still pass. Add a new test:

Create a new file `tests/unit/npc-movement.test.ts`:

```ts
// tests/unit/npc-movement.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';

function mapWithOneRealizedTile(rx: number, ry: number): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) {
      row.push({
        type: 'grass', x, y, walkable: true,
        state: (x === rx && y === ry) ? 'realized' : 'void',
      });
    }
    tiles.push(row);
  }
  return {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('tickNpcMovementEntities', () => {
  it('does not step onto void tiles', () => {
    const map = mapWithOneRealizedTile(5, 5);
    const world = new World(map);
    const e: Entity = { id: 'n1', kind: 'npc', x: 5, y: 5, properties: initNpcProps('A', 'farmer', 1) };
    world.addEntity(e);
    (e.properties as { moveCooldown?: number }).moveCooldown = 0;
    for (let i = 0; i < 50; i++) tickNpcMovementEntities(world, map, 500);
    expect(Math.floor(e.x)).toBe(5);
    expect(Math.floor(e.y)).toBe(5);
  });
});
```

- [ ] **Step 3: Run, commit**

```
npm test && npm run build
git add src/sim/npc-movement.ts tests/unit/npc-sim.test.ts
git commit -m "feat(sim): NPCs confined to realized tiles"
```

PR 5 complete. The game starts as a tiny realized bubble, NPCs stay inside it, void is invisible.

---

## PR 6 — Slim `game.ts`

### Task 6.1: AssetManager

**Files:**
- Create: `src/render/asset-manager.ts`
- Modify: `src/game.ts`

- [ ] **Step 1: Implement `AssetManager`**

```ts
// src/render/asset-manager.ts
import { BUILDING_TEMPLATES } from '@/map/building-templates';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export class AssetManager {
  private tileAtlas: HTMLImageElement | null = null;
  private terrain = new Map<string, HTMLImageElement>();
  private buildings = new Map<string, HTMLImageElement>();
  private trees = new Map<string, HTMLImageElement>();

  async loadAll(): Promise<void> {
    if (!this.tileAtlas) this.tileAtlas = await loadImage('/sprites/tiles/kenney-town.png');
    await this.loadTerrain();
    await this.loadBuildings();
    if (this.trees.size === 0) await this.loadTrees();
  }

  getTileAtlas(): HTMLImageElement | null { return this.tileAtlas; }
  getTerrainSheets(): Map<string, HTMLImageElement> { return this.terrain; }
  getBuildingSprites(): Map<string, HTMLImageElement> { return this.buildings; }
  getTreeSheets(): Map<string, HTMLImageElement> { return this.trees; }

  private async loadTerrain(): Promise<void> {
    const groups = ['grass', 'water', 'dirt', 'sand', 'stone', 'rocky'];
    await Promise.all(groups.map(async (g) => {
      if (!this.terrain.has(g)) {
        const img = await loadImage(`/sprites/terrain/${g}.png`);
        if (img) this.terrain.set(g, img);
      }
    }));
  }

  private async loadBuildings(): Promise<void> {
    await Promise.all(BUILDING_TEMPLATES.map(async (tpl) => {
      if (!this.buildings.has(tpl.id)) {
        const img = await loadImage(`/sprites/buildings/${tpl.id}.png`);
        if (img) this.buildings.set(tpl.id, img);
      }
    }));
  }

  private async loadTrees(): Promise<void> {
    const variants = ['green', 'orange', 'dead', 'pale', 'brown'];
    await Promise.all(variants.map(async (v) => {
      const img = await loadImage(`/sprites/trees/trees-${v}.png`);
      if (img) this.trees.set(v, img);
    }));
  }
}
```

- [ ] **Step 2: Replace inline loaders in `game.ts`**

In the constructor, add:
```ts
private assets = new AssetManager();
```

In `generateWorld()`:
```ts
// replace tileAtlas + loadTerrainSheets + loadBuildingSprites + loadTreeSheets
await this.assets.loadAll();
```

In `render()`, the `RenderContext` fields use `assets`:
```ts
tileAtlas: this.assets.getTileAtlas(),
terrainSheets: this.assets.getTerrainSheets(),
buildingSprites: this.assets.getBuildingSprites(),
treeSheets: this.assets.getTreeSheets(),
```

Remove the private fields `tileAtlas`, `terrainSheets`, `buildingSprites`, `treeSheets` and their loader methods from `game.ts`.

- [ ] **Step 3: Build + test + smoke**

```
npm run build && npm test && npm run dev
```

- [ ] **Step 4: Commit**

```bash
git add src/render/asset-manager.ts src/game.ts
git commit -m "refactor(render): AssetManager owns sprite loading"
```

---

### Task 6.2: OverlayDispatcher

**Files:**
- Create: `src/ui/overlay-dispatcher.ts`
- Test: `tests/unit/overlay-dispatcher.test.ts`
- Modify: `src/render/sim-overlay.ts` (use the generic action shape)
- Modify: `src/game.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/overlay-dispatcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { OverlayDispatcher, type OverlayHitArea } from '@/ui/overlay-dispatcher';

describe('OverlayDispatcher', () => {
  it('dispatches a hit area to the registered handler', () => {
    const d = new OverlayDispatcher();
    const handler = vi.fn(() => true);
    d.register('whisper', handler);
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'whisper', payload: { npcId: 'n1' }, active: true };
    expect(d.tryDispatch(5, 5, [area])).toBe(true);
    expect(handler).toHaveBeenCalledWith({ npcId: 'n1' });
  });

  it('returns false if no hit area contains the click', () => {
    const d = new OverlayDispatcher();
    d.register('whisper', () => true);
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'whisper', payload: null, active: true };
    expect(d.tryDispatch(50, 50, [area])).toBe(false);
  });

  it('skips inactive areas', () => {
    const d = new OverlayDispatcher();
    const handler = vi.fn(() => true);
    d.register('whisper', handler);
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'whisper', payload: null, active: false };
    d.tryDispatch(5, 5, [area]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores actions with no handler registered', () => {
    const d = new OverlayDispatcher();
    const area: OverlayHitArea = { x: 0, y: 0, w: 10, h: 10, action: 'omen', payload: null, active: true };
    expect(() => d.tryDispatch(5, 5, [area])).not.toThrow();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/ui/overlay-dispatcher.ts
export interface OverlayHitArea {
  x: number; y: number; w: number; h: number;
  action: string;       // 'whisper' | future: 'omen' | 'dream' | 'miracle' | 'possess' | ...
  payload: unknown;
  active: boolean;
}

type Handler = (payload: unknown) => boolean | void;

export class OverlayDispatcher {
  private handlers = new Map<string, Handler>();

  register(action: string, handler: Handler): void {
    this.handlers.set(action, handler);
  }

  tryDispatch(sx: number, sy: number, areas: OverlayHitArea[]): boolean {
    for (const a of areas) {
      if (sx < a.x || sx > a.x + a.w || sy < a.y || sy > a.y + a.h) continue;
      if (!a.active) continue;
      const handler = this.handlers.get(a.action);
      if (handler) handler(a.payload);
      return true;  // hit-test absorbs the click even if no handler is registered
    }
    return false;
  }
}
```

- [ ] **Step 3: Update `sim-overlay.ts` to emit the new shape**

The current `OverlayHitArea` type lives in `src/render/sim-overlay.ts`. Replace it with an import from the dispatcher module, and change emitted areas to use `action: 'whisper'` + `payload: { npcId }` form:

```ts
import type { OverlayHitArea } from '@/ui/overlay-dispatcher';
export type OverlayHitAreas = OverlayHitArea[];

// where the whisper button is emitted:
{ x: bx, y: by, w: BTN_W, h: BTN_H, action: 'whisper', payload: { npcId: npc.id }, active: whisperActive }
```

- [ ] **Step 4: Wire dispatcher in `game.ts`**

In constructor:
```ts
private dispatcher = new OverlayDispatcher();

// after createState:
this.dispatcher.register('whisper', (payload) => {
  const p = payload as { npcId: string };
  if (!this.state.world) return false;
  const e = getNpc(this.state.world, p.npcId);
  const player = this.state.spirits.get('player')!;
  if (e && whisper(player, e, this.state.eventLog)) {
    this.lastWhisperTime = performance.now();
    return true;
  }
  return false;
});
```

Replace the manual `onCanvasClick` switch:
```ts
private onCanvasClick(sx: number, sy: number): boolean {
  return this.dispatcher.tryDispatch(sx, sy, this.overlayHitAreas);
}
```

- [ ] **Step 5: Test + commit**

```
npm test && npm run build && npm run dev
git add src/ui/overlay-dispatcher.ts tests/unit/overlay-dispatcher.test.ts src/render/sim-overlay.ts src/game.ts
git commit -m "refactor(ui): OverlayDispatcher generalizes hit-area action handling"
```

---

### Task 6.3: Spawner module

**Files:**
- Create: `src/sim/spawner.ts`
- Modify: `src/game.ts`

- [ ] **Step 1: Move `assignHomeBuilding` and full-population spawn helper to spawner**

```ts
// src/sim/spawner.ts
import type { BuildingInstance, NpcRole, WorldSeed, GameMap } from '@/core/types';
import type { World } from '@/world/world';
import type { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { getBuildingTemplate } from '@/map/building-templates';

const VALID_ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

const ROLE_PREFERRED_CATEGORY: Record<string, string> = {
  priest:   'religious', farmer:   'farm',        merchant: 'commercial',
  soldier:  'military',  noble:    'residential', elder:    'residential',
  child:    'residential', beggar:  'residential',
};

export function assignHomeBuilding(
  role: string,
  buildings: BuildingInstance[],
  index: number,
): BuildingInstance | undefined {
  if (!buildings.length) return undefined;
  const preferred = ROLE_PREFERRED_CATEGORY[role];
  if (preferred) {
    const match = buildings.find(b => {
      const t = getBuildingTemplate(b.templateId);
      return t?.category === preferred;
    });
    if (match) return match;
  }
  return buildings[index % buildings.length];
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Populate every POI's NPCs into the world (used when leaving cradle phase). */
export function spawnAllPoiNpcs(args: {
  world: World; log: EventLog; worldSeed: WorldSeed; map: GameMap;
}): void {
  const { world, log, worldSeed, map } = args;
  for (const poi of worldSeed.pois) {
    if (!poi.npcs?.length || !poi.position) continue;
    const { x: px, y: py } = poi.position;
    const poiBuildings = (map.buildings ?? []).filter(b => b.poiId === poi.id);

    for (let i = 0; i < poi.npcs.length; i++) {
      const npcDef = poi.npcs[i];
      const id = `${poi.id}-npc-${i}`;
      if (world.registry.get(id)) continue;  // already spawned (e.g. seed npc)
      const seed = hashId(id);
      const role: NpcRole = VALID_ROLES.includes(npcDef.role as NpcRole) ? npcDef.role as NpcRole : 'farmer';
      const name = npcDef.name || role;
      const home = assignHomeBuilding(role, poiBuildings, i);

      let tileX: number, tileY: number;
      if (home) {
        const t = getBuildingTemplate(home.templateId);
        if (t) { tileX = home.tileX + t.doorCell.x; tileY = home.tileY + t.doorCell.y; }
        else   { tileX = Math.max(0, Math.min(map.width - 1, px + (seed % 3) - 1));
                 tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1)); }
      } else {
        tileX = Math.max(0, Math.min(map.width - 1, px + (seed % 3) - 1));
        tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));
      }

      const props = initNpcProps(name, role, seed);
      props.homeBuildingId = home?.id;
      props.homePoiId = poi.id;
      world.addEntity({ id, kind: 'npc', x: tileX, y: tileY, properties: props });
      log.append({ type: 'npc_spawn', npcId: id, role, poiId: poi.id });
    }
  }
}
```

- [ ] **Step 2: Remove `assignHomeBuilding` and `spawnNpcs` from `game.ts`**

`game.ts` should no longer contain these. The cradle start uses `seedWorld`; `spawnAllPoiNpcs` is available as a future gameplay-trigger.

- [ ] **Step 3: Confirm `game.ts` is now ~300 lines**

```
wc -l src/game.ts
```

Target: under 350. If still above, look for remaining helpers that belong elsewhere.

- [ ] **Step 4: Build + test + commit**

```
npm run build && npm test
git add src/sim/spawner.ts src/game.ts
git commit -m "refactor(sim): extract spawner; slim game.ts"
```

---

## Final integration: determinism test

### Task 7: Determinism test

**Files:**
- Test: `tests/unit/determinism.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/determinism.test.ts
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import { Scheduler } from '@/core/scheduler';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { initNpcProps } from '@/world/npc-helpers';
import { whisper } from '@/sim/whisper';
import type { GameMap, Tile } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function makeWorld(): { world: World; map: GameMap } {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 30; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 30; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = { tiles, width: 30, height: 30, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { world: new World(map), map };
}

function runScenario(): number[] {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const spirits = new Map<SpiritId, Spirit>([['player', {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 5, manifestation: null,
  }]]);
  const { world, map } = makeWorld();
  world.addEntity({ id: 'n1', kind: 'npc', x: 15, y: 15, properties: initNpcProps('Alice', 'farmer', 42) });

  const sched = new Scheduler();
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => map));

  const ctx = { world, spirits, log, clock };

  // Run 10 sim seconds
  for (let i = 0; i < 30; i++) sched.tick(333, ctx);

  // Then whisper at fixed point
  const e = world.registry.get('n1')!;
  whisper(spirits.get('player')!, e, log);

  // Run another 5 seconds
  for (let i = 0; i < 15; i++) sched.tick(333, ctx);

  return log.since(0).map(a => a.event).map(e => JSON.stringify(e)).map(s => s.length);
}

describe('determinism', () => {
  it('same scenario produces identical event log (by event content length)', () => {
    const a = runScenario();
    const b = runScenario();
    expect(a).toEqual(b);
  });

  it('event count is stable across runs', () => {
    const a = runScenario();
    const b = runScenario();
    expect(a.length).toBe(b.length);
  });
});
```

- [ ] **Step 2: Run**

```
npm test -- determinism.test.ts
```

Expected: passes. If it fails, the diff in event sequences points to a nondeterministic source (likely `Math.random()` in `npc-movement` — that's fine; movement isn't part of this scenario, but if you've inadvertently introduced randomness in sim/spirit/perception, it'll show here).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/determinism.test.ts
git commit -m "test(integration): determinism — same scenario yields identical event log"
```

---

## Success-criteria sweep

- [ ] **Run full test suite**
```
npm test
```
Expected: all tests pass.

- [ ] **TypeScript build**
```
npm run build
```
Expected: 0 errors.

- [ ] **Line count**
```
wc -l src/game.ts
```
Expected: under 350.

- [ ] **No `state.playerPower` references**
```
grep -rn "playerPower" src/ tests/
```
Expected: no matches (other than possibly in `docs/`).

- [ ] **No `state.npcs` or `state.npcSim` references**
```
grep -rn "state\.npcs\|state\.npcSim" src/ tests/
```
Expected: no matches.

- [ ] **No hardcoded `'player'` strings outside intentional spots**
```
grep -rn "'player'" src/
```
Expected: only in `state.ts` (seeding the player spirit), `npc-helpers.ts` `initNpcProps` (seeding initial belief), and tests. No raw `'player'` in render or sim systems.

- [ ] **Game starts cradle-style**

Run `npm run dev`. Verify game opens with a small visible bubble of terrain around one NPC, surrounded by background color.

- [ ] **Adding a rival spirit is a one-line change**

In devtools:
```js
window.__game.state.spirits.set('rival', {
  id: 'rival', name: 'Grooob', sigil: '✶', color: '#c43a3a',
  isPlayer: false, power: 5, manifestation: null,
});
window.__game.state.eventLog.append({ type: 'spirit_birth', spiritId: 'rival', name: 'Grooob', isPlayer: false });
```
Then watch the event log over time: `SpiritSystem` should start regenerating Grooob's power as NPCs gain belief in it (even though it's zero at start). No code changes required.

---

## What Spec B-E inherit

This plan delivers everything Specs B-E need to slot in cleanly:
- **EventLog** is the timeline (Spec B), the branch point (Spec C), the script format (Spec D), the text source (Spec E)
- **Scheduler.setRate** is the speed control (Spec B)
- **`'realizing'` TileState** is the hook for Spec D collapse animation and the future Oracle override window
- **Manifestation type** is ready for the input-bound avatar/possession controls
- **Determinism** of the sim → events pipeline is the precondition for replay-based time travel
