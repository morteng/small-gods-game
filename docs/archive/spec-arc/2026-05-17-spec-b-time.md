# Spec B (Time) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the time-mastery package on top of Spec A's spine — seedable world RNG, hybrid snapshot/replay layer, a Time chip + Time bar UI per the design handoff, and the commit/re-roll flow that lets the player rewrite the future from any past tick.

**Architecture:** Single seedable PRNG (`sfc32`) on `GameState` makes the sim fully deterministic. `SnapshotStore` keeps a 40-deep ring buffer of state snapshots, one per N events. `TimelineController` exposes `jumpTo / commit / returnToLive`; jumps work by restoring the nearest snapshot then re-running the scheduler forward in **silent mode** (event log calls become no-ops) until the target tick is reached. UI is a summoned bottom bar (DOM, scoped to the game container) with three commit buttons — *Back to now*, *Continue*, *Try a different way*.

**Tech Stack:** TypeScript ES modules, Vite, vitest, Canvas 2D (untouched), DOM for the UI, CSS custom properties from the design handoff's `tokens.css`.

**Design source of truth:**
- Spec: `docs/superpowers/specs/2026-05-17-spec-b-time-design.md`
- UI handoff: `docs/design/2026-05-17-ui-system-handoff/README.md` (especially §8.7–§8.8 for the Time chip + Time bar)
- Spec A baseline: `docs/superpowers/specs/2026-05-17-spec-a-spine-design.md`

---

## Phase 1 — Seedable RNG (foundation for determinism)

### Task 1: Add `sfc32` RNG module

**Files:**
- Create: `src/core/rng.ts`
- Test: `tests/unit/rng.test.ts`

- [ ] **Step 1: Write the failing test** for `sfc32` reference-vector correctness.

```ts
// tests/unit/rng.test.ts
import { describe, it, expect } from 'vitest';
import { createRng, fromState } from '@/core/rng';

describe('sfc32 rng', () => {
  it('produces a stable reference sequence for seed 1', () => {
    const rng = createRng(1);
    const out: number[] = [];
    for (let i = 0; i < 8; i++) out.push(Math.floor(rng.next() * 0x1_0000_0000));
    expect(out).toMatchInlineSnapshot();
  });

  it('next() returns values in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(max) returns integers in [0, max)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(10);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('getState() then fromState() resumes the same sequence', () => {
    const a = createRng(7);
    for (let i = 0; i < 50; i++) a.next();
    const snap = a.getState();
    const b = fromState(snap);
    expect(b.next()).toBe(a.next());
    expect(b.next()).toBe(a.next());
    expect(b.next()).toBe(a.next());
  });

  it('pick<T> draws from array, never out-of-bounds', () => {
    const rng = createRng(123);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 200; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/rng.test.ts`
Expected: FAIL — `Cannot find module '@/core/rng'`.

- [ ] **Step 3: Implement `src/core/rng.ts`.**

```ts
// src/core/rng.ts
export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Serializable state snapshot. */
  getState(): RngState;
}

/** Cheap hash mixing to seed sfc32's four u32 state words from one number. */
function expandSeed(seed: number): RngState {
  let z = (seed | 0) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    z = ((z + 0x9e3779b9) | 0) >>> 0;
    let x = z;
    x = (Math.imul(x ^ (x >>> 16), 0x85ebca6b)) >>> 0;
    x = (Math.imul(x ^ (x >>> 13), 0xc2b2ae35)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    out.push(x);
  }
  return [out[0], out[1], out[2], out[3]] as RngState;
}

class Sfc32 implements Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(state: RngState) {
    this.a = state[0] >>> 0;
    this.b = state[1] >>> 0;
    this.c = state[2] >>> 0;
    this.d = state[3] >>> 0;
  }
  next(): number {
    const t = (this.a + this.b | 0) + this.d | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 0x1_0000_0000;
  }
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(arr.length)];
  }
  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}

export function createRng(seed: number): Rng {
  return new Sfc32(expandSeed(seed));
}

export function fromState(state: RngState): Rng {
  return new Sfc32(state);
}
```

- [ ] **Step 4: Run the test to populate the inline snapshot.**

Run: `npx vitest run tests/unit/rng.test.ts -u`
Expected: PASS — vitest writes the reference sequence into the inline snapshot. Open `tests/unit/rng.test.ts` and verify the snapshot is non-trivial (eight large integers).

- [ ] **Step 5: Re-run without `-u` to lock it in.**

Run: `npx vitest run tests/unit/rng.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 6: Commit.**

```bash
git add src/core/rng.ts tests/unit/rng.test.ts
git commit -m "feat(core): seedable sfc32 rng for deterministic sim"
```

---

### Task 2: Add `rng` to `GameState` and `SystemContext`

**Files:**
- Modify: `src/core/state.ts:9-32` (interface) and `src/core/state.ts:34-72` (factory)
- Modify: `src/core/scheduler.ts:6-13` (SystemContext interface)
- Modify: `src/game.ts:306-311` (scheduler.tick call site)
- Test: `tests/unit/rng-state.test.ts` (new)

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/rng-state.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';

describe('GameState.rng', () => {
  it('is present on a fresh state', () => {
    const s = createState();
    expect(s.rng).toBeDefined();
    expect(typeof s.rng.next).toBe('function');
  });

  it('two fresh states produce the same sequence (deterministic default seed)', () => {
    const a = createState();
    const b = createState();
    const seqA = Array.from({ length: 8 }, () => a.rng.next());
    const seqB = Array.from({ length: 8 }, () => b.rng.next());
    expect(seqA).toEqual(seqB);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/rng-state.test.ts`
Expected: FAIL — `rng` is undefined on the GameState.

- [ ] **Step 3: Add `rng: Rng` to `GameState`** in `src/core/state.ts`.

Add the import:

```ts
import { createRng, type Rng } from '@/core/rng';
```

Add the field to the interface (after `cameraLock`):

```ts
  cameraLock: { mode: 'follower' | 'free'; targetId?: EntityId };
  rng: Rng;
  world: World | null;
```

- [ ] **Step 4: Seed `rng` in `createState()`.**

In the factory, after constructing the spirits map:

```ts
  const rng = createRng(1);
```

And include `rng` in the returned object (between `cameraLock` and `world`):

```ts
    cameraLock: { mode: 'free' },
    rng,
    world: null,
```

- [ ] **Step 5: Extend `SystemContext`** in `src/core/scheduler.ts`.

```ts
import type { SimClock } from '@/core/clock';
import type { EventLog } from '@/core/events';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { World } from '@/world/world';
import type { Rng } from '@/core/rng';

export interface SystemContext {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  clock: SimClock;
  rng: Rng;
  dt: number;
  now: number;
}

type BaseCtx = Omit<SystemContext, 'dt' | 'now'>;
```

- [ ] **Step 6: Pass `rng` from the game loop into the scheduler.**

In `src/game.ts` modify the `scheduler.tick(...)` call (~line 306):

```ts
this.scheduler.tick(deltaMs, {
  world: this.state.world,
  spirits: this.state.spirits,
  log: this.state.eventLog,
  clock: this.state.clock,
  rng: this.state.rng,
});
```

- [ ] **Step 7: Run all tests.**

Run: `npm test -- --run`
Expected: PASS — the new `rng-state.test.ts` passes, all prior tests still pass.

- [ ] **Step 8: Commit.**

```bash
git add src/core/state.ts src/core/scheduler.ts src/game.ts tests/unit/rng-state.test.ts
git commit -m "feat(core): thread rng through GameState and SystemContext"
```

---

### Task 3: Migrate `NpcMovementSystem` off `Math.random`

**Files:**
- Modify: `src/sim/npc-movement.ts:14-30`
- Modify: `src/sim/systems/npc-movement-system.ts:11-15`
- Test: `tests/unit/npc-movement-deterministic.test.ts` (new)
- Test: `tests/unit/no-random-in-sim.test.ts` (new)

- [ ] **Step 1: Write the failing test** for deterministic movement.

```ts
// tests/unit/npc-movement-deterministic.test.ts
import { describe, it, expect } from 'vitest';
import { createRng } from '@/core/rng';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { tickNpcMovementEntities } from '@/sim/npc-movement';
import type { GameMap, Tile } from '@/core/types';

function makeWorldAndMap() {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 20; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 20; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 20, height: 20, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  const world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> });
  return { world, map };
}

describe('NpcMovementSystem determinism', () => {
  it('same rng seed yields identical positions after N ticks', () => {
    const a = makeWorldAndMap();
    const b = makeWorldAndMap();
    const rngA = createRng(42);
    const rngB = createRng(42);
    for (let i = 0; i < 50; i++) {
      tickNpcMovementEntities(a.world, a.map, 500, rngA);
      tickNpcMovementEntities(b.world, b.map, 500, rngB);
    }
    const ea = a.world.registry.get('n1')!;
    const eb = b.world.registry.get('n1')!;
    expect({ x: ea.x, y: ea.y }).toEqual({ x: eb.x, y: eb.y });
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/npc-movement-deterministic.test.ts`
Expected: FAIL — `tickNpcMovementEntities` signature doesn't accept an Rng.

- [ ] **Step 3: Update `tickNpcMovementEntities`** in `src/sim/npc-movement.ts`.

```ts
import type { Direction, GameMap } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { World } from '@/world/world';
import type { Rng } from '@/core/rng';

const MOVE_INTERVAL_MS = 400;

function tileWalkable(map: GameMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const t = map.tiles[y]?.[x];
  return t?.walkable === true && t.state === 'realized';
}

export function tickNpcMovementEntities(
  world: World,
  map: GameMap,
  dtMs: number,
  rng: Rng,
): void {
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    p.moveCooldown = (p.moveCooldown ?? 0) - dtMs;
    if (p.moveCooldown > 0) return;
    p.moveCooldown = MOVE_INTERVAL_MS;

    const dir = rng.pick(dirs);
    const tx = Math.floor(e.x) + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0);
    const ty = Math.floor(e.y) + (dir === 'up'   ? -1 : dir === 'down'  ? 1 : 0);
    if (tileWalkable(map, tx, ty)) {
      world.registry.update(e.id, { x: tx, y: ty });
      p.direction = dir;
    }
  });
}
```

- [ ] **Step 4: Update the system wrapper** in `src/sim/systems/npc-movement-system.ts`.

```ts
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
    tickNpcMovementEntities(ctx.world, map, ctx.dt, ctx.rng);
  }
}
```

- [ ] **Step 5: Run the new test.**

Run: `npx vitest run tests/unit/npc-movement-deterministic.test.ts`
Expected: PASS.

- [ ] **Step 6: Add a CI grep guard** preventing future `Math.random()` in `src/sim/`.

```ts
// tests/unit/no-random-in-sim.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function listFilesRec(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listFilesRec(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('determinism guard', () => {
  it('no Math.random() in src/sim/ — use ctx.rng', () => {
    const files = listFilesRec('src/sim');
    const offenders = files.filter(f => /Math\.random\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 7: Run all tests.**

Run: `npm test -- --run`
Expected: PASS — including both new tests and all prior tests still passing.

- [ ] **Step 8: Commit.**

```bash
git add src/sim/npc-movement.ts src/sim/systems/npc-movement-system.ts \
        tests/unit/npc-movement-deterministic.test.ts \
        tests/unit/no-random-in-sim.test.ts
git commit -m "feat(sim): NpcMovementSystem draws from ctx.rng (deterministic)"
```

---

### Task 4: Extend the determinism test to include movement

**Files:**
- Modify: `tests/unit/determinism.test.ts`

- [ ] **Step 1: Update `runScenario`** to register `NpcMovementSystem` and thread `rng` through the context.

Add imports near the top:

```ts
import { createRng } from '@/core/rng';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
```

Replace the body of `runScenario`:

```ts
function runScenario(): string[] {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const rng = createRng(99);
  const spirits = new Map<SpiritId, Spirit>([['player', {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 5, manifestation: null,
  }]]);
  const { world, map } = makeWorld();
  const npcProps = initNpcProps('Alice', 'farmer', 42);
  world.addEntity({ id: 'n1', kind: 'npc', x: 15, y: 15, properties: npcProps as unknown as Record<string, unknown> });

  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(() => map));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => map));

  const ctx = { world, spirits, log, clock, rng };

  for (let i = 0; i < 30; i++) sched.tick(333, ctx);
  const e = world.registry.get('n1')!;
  whisper(spirits.get('player')!, e, log);
  for (let i = 0; i < 15; i++) sched.tick(333, ctx);

  return log.since(0).map(a => JSON.stringify(a.event));
}
```

Delete the comment "Deliberately NOT registering NpcMovementSystem…".

- [ ] **Step 2: Run the determinism tests.**

Run: `npx vitest run tests/unit/determinism.test.ts`
Expected: PASS — two runs with seed 99 yield identical event content and counts.

- [ ] **Step 3: Commit.**

```bash
git add tests/unit/determinism.test.ts
git commit -m "test(determinism): include NpcMovementSystem with seeded rng"
```

---

## Phase 2 — Snapshot store

### Task 5: Snapshot serialization

**Files:**
- Create: `src/core/snapshot.ts`
- Test: `tests/unit/snapshot.test.ts`

- [ ] **Step 1: Write the failing test** for serialize/restore round-trip on a fresh `GameState`.

```ts
// tests/unit/snapshot.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

function attachWorld(state: ReturnType<typeof createState>): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: props as unknown as Record<string, unknown> });
}

describe('snapshot', () => {
  it('captures clock, rng state, spirits, and entity positions', () => {
    const s = createState();
    attachWorld(s);
    s.clock.advance(1234);
    s.rng.next(); s.rng.next();

    const snap = captureSnapshot(s);

    s.clock.advance(99999);
    s.rng.next();
    s.world!.registry.update('n1', { x: 9, y: 9 });

    restoreSnapshot(s, snap);
    expect(s.clock.now()).toBe(1234);
    expect(s.world!.registry.get('n1')!.x).toBe(5);
    expect(s.world!.registry.get('n1')!.y).toBe(5);
  });

  it('rng state survives the round-trip', () => {
    const s = createState();
    attachWorld(s);
    s.rng.next(); s.rng.next(); s.rng.next();
    const snap = captureSnapshot(s);
    const after = s.rng.next();
    restoreSnapshot(s, snap);
    expect(s.rng.next()).toBe(after);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Inspect `src/core/clock.ts`** to verify the SimClock's internal field name.

Run: `grep -n 'tNow\|private\|advance' src/core/clock.ts`

If the clock's internal field is **not** named `tNow`, add a public setter to `SimClock`:

```ts
// in src/core/clock.ts, append:
setNow(t: number): void { this.tNow = t; }
```

Use the actual private-field name in the setter body.

- [ ] **Step 4: Implement `src/core/snapshot.ts`.**

```ts
// src/core/snapshot.ts
import type { GameState } from '@/core/state';
import type { Entity } from '@/core/types';
import type { RngState } from '@/core/rng';
import { fromState } from '@/core/rng';
import { World } from '@/world/world';

export interface Snapshot {
  tick: number;
  eventId: number;
  /** Last-known clock value in sim ticks. */
  clockMs: number;
  rng: RngState;
  /** Copies of every world entity; positions and properties are deep-cloned. */
  entities: Entity[];
  /** Snapshots of every spirit: id → power and manifestation. */
  spirits: Array<{ id: string; power: number; manifestation: unknown }>;
}

export function captureSnapshot(state: GameState): Snapshot {
  if (!state.world) {
    throw new Error('captureSnapshot: state.world is null — call after world seed');
  }
  const entities: Entity[] = state.world.query({}).map(e => ({
    ...e,
    properties: structuredClone(e.properties),
  }));
  const spirits = Array.from(state.spirits.values()).map(s => ({
    id: s.id,
    power: s.power,
    manifestation: s.manifestation ? structuredClone(s.manifestation) : null,
  }));
  return {
    tick: state.clock.now(),
    eventId: state.eventLog.size(),
    clockMs: state.clock.now(),
    rng: state.rng.getState(),
    entities,
    spirits,
  };
}

export function restoreSnapshot(state: GameState, snap: Snapshot): void {
  if (!state.world || !state.map) {
    throw new Error('restoreSnapshot: world/map not initialized');
  }
  // Reset clock via the public setter added in Step 3.
  (state.clock as { setNow?(t: number): void }).setNow?.(snap.clockMs);

  // Restore rng.
  state.rng = fromState(snap.rng);

  // Restore spirits' mutable fields.
  for (const ss of snap.spirits) {
    const live = state.spirits.get(ss.id as unknown as string);
    if (live) {
      live.power = ss.power;
      live.manifestation = ss.manifestation as typeof live.manifestation;
    }
  }

  // Rebuild the world entity registry to match the snapshot.
  const fresh = new World(state.map);
  for (const e of snap.entities) {
    fresh.addEntity({ ...e, properties: structuredClone(e.properties) });
  }
  state.world = fresh;
}
```

- [ ] **Step 5: Run the snapshot tests.**

Run: `npx vitest run tests/unit/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 6: Run all tests.**

Run: `npm test -- --run`
Expected: PASS — all prior tests still green.

- [ ] **Step 7: Commit.**

```bash
git add src/core/snapshot.ts tests/unit/snapshot.test.ts src/core/clock.ts
git commit -m "feat(core): snapshot capture/restore for state, rng, entities, spirits"
```

---

### Task 6: SnapshotStore ring buffer

**Files:**
- Modify: `src/core/snapshot.ts` (append `SnapshotStore` class)
- Test: `tests/unit/snapshot-store.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/snapshot-store.test.ts
import { describe, it, expect } from 'vitest';
import type { Snapshot } from '@/core/snapshot';
import { SnapshotStore } from '@/core/snapshot';

function fakeSnap(tick: number, eventId: number): Snapshot {
  return { tick, eventId, clockMs: tick, rng: [0, 0, 0, 0], entities: [], spirits: [] };
}

describe('SnapshotStore', () => {
  it('evicts oldest first when capacity is exceeded', () => {
    const store = new SnapshotStore({ capacity: 3 });
    store.push(fakeSnap(0, 1));
    store.push(fakeSnap(10, 20));
    store.push(fakeSnap(20, 40));
    store.push(fakeSnap(30, 60));
    const all = store.list();
    expect(all.length).toBe(3);
    expect(all[0].tick).toBe(10);
    expect(all[2].tick).toBe(30);
  });

  it('nearestAtOrBefore returns the highest tick <= target, or null', () => {
    const store = new SnapshotStore({ capacity: 5 });
    store.push(fakeSnap(0, 1));
    store.push(fakeSnap(10, 5));
    store.push(fakeSnap(20, 9));
    expect(store.nearestAtOrBefore(15)!.tick).toBe(10);
    expect(store.nearestAtOrBefore(20)!.tick).toBe(20);
    expect(store.nearestAtOrBefore(100)!.tick).toBe(20);
    expect(store.nearestAtOrBefore(-1)).toBeNull();
  });

  it('truncateAfter drops snapshots with tick > target', () => {
    const store = new SnapshotStore({ capacity: 5 });
    store.push(fakeSnap(0, 1));
    store.push(fakeSnap(10, 5));
    store.push(fakeSnap(20, 9));
    store.push(fakeSnap(30, 13));
    store.truncateAfter(15);
    expect(store.list().map(s => s.tick)).toEqual([0, 10]);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/snapshot-store.test.ts`
Expected: FAIL — `SnapshotStore` not exported.

- [ ] **Step 3: Append `SnapshotStore` to `src/core/snapshot.ts`.**

```ts
export interface SnapshotStoreOptions {
  capacity: number;
}

export class SnapshotStore {
  private readonly capacity: number;
  private buf: Snapshot[] = [];

  constructor(opts: SnapshotStoreOptions) {
    if (opts.capacity < 1) throw new Error('SnapshotStore capacity must be >= 1');
    this.capacity = opts.capacity;
  }

  push(snap: Snapshot): void {
    this.buf.push(snap);
    while (this.buf.length > this.capacity) this.buf.shift();
  }

  nearestAtOrBefore(tick: number): Snapshot | null {
    let best: Snapshot | null = null;
    for (const s of this.buf) {
      if (s.tick <= tick && (!best || s.tick > best.tick)) best = s;
    }
    return best;
  }

  truncateAfter(tick: number): void {
    this.buf = this.buf.filter(s => s.tick <= tick);
  }

  list(): readonly Snapshot[] { return this.buf; }

  size(): number { return this.buf.length; }
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/unit/snapshot-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/snapshot.ts tests/unit/snapshot-store.test.ts
git commit -m "feat(core): SnapshotStore ring buffer with nearest/truncate"
```

---

## Phase 3 — Timeline controller

### Task 7: Silent event log stub

**Files:**
- Modify: `src/core/events.ts` (add `SilentEventLog`)
- Test: `tests/unit/silent-log.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/silent-log.test.ts
import { describe, it, expect } from 'vitest';
import { SilentEventLog } from '@/core/events';
import { SimClock } from '@/core/clock';

describe('SilentEventLog', () => {
  it('does nothing on append', () => {
    const log = new SilentEventLog(new SimClock());
    const out = log.append({ type: 'system_error', system: 'x', message: 'y' });
    expect(out.id).toBe(0);
    expect(log.size()).toBe(0);
  });

  it('subscribers are never called', () => {
    const log = new SilentEventLog(new SimClock());
    let calls = 0;
    log.subscribe(() => { calls++; });
    log.append({ type: 'system_error', system: 'x', message: 'y' });
    expect(calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/silent-log.test.ts`
Expected: FAIL — `SilentEventLog` not exported.

- [ ] **Step 3: Append `SilentEventLog` to `src/core/events.ts`.**

```ts
/**
 * No-op replacement for EventLog used during replay. Append/subscribe are
 * no-ops so re-running systems doesn't pollute the canonical log.
 */
export class SilentEventLog extends EventLog {
  override append(event: SimEvent): AppendedEvent {
    return { id: 0, t: 0, event };
  }
  override subscribe(): () => void { return () => {}; }
  override since(): AppendedEvent[] { return []; }
  override range(): AppendedEvent[] { return []; }
  override size(): number { return 0; }
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/unit/silent-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/events.ts tests/unit/silent-log.test.ts
git commit -m "feat(core): SilentEventLog stub for replay (no-append, no-subscribe)"
```

---

### Task 8: TimelineController — jumpTo / returnToLive

**Files:**
- Create: `src/core/timeline.ts`
- Test: `tests/unit/timeline-jump.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/timeline-jump.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

function attachWorld(state: ReturnType<typeof createState>): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 20; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 20; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 20, height: 20, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: props as unknown as Record<string, unknown> });
  return map;
}

function buildScheduler(getMap: () => GameMap | null): Scheduler {
  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(getMap));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, getMap));
  return sched;
}

describe('TimelineController.jumpTo / returnToLive', () => {
  it('jumpTo rewinds to a past tick using the nearest snapshot + silent forward run', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildScheduler(() => state.map);
    const tl = new TimelineController({ state, scheduler: sched, snapshotEveryNEvents: 50 });

    for (let i = 0; i < 90; i++) {
      sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }
    const liveTick = state.clock.now();

    tl.jumpTo(Math.floor(liveTick / 2));
    expect(tl.isScrubbed).toBe(true);
    expect(state.clock.now()).toBeLessThanOrEqual(liveTick / 2 + 333);

    tl.returnToLive();
    expect(tl.isScrubbed).toBe(false);
    expect(state.clock.now()).toBe(liveTick);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/timeline-jump.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/timeline.ts`.**

```ts
// src/core/timeline.ts
import type { GameState } from '@/core/state';
import type { Scheduler } from '@/core/scheduler';
import { SnapshotStore, captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import { SilentEventLog, type AppendedEvent } from '@/core/events';
import { createRng } from '@/core/rng';

export interface TimelineOptions {
  state: GameState;
  scheduler: Scheduler;
  /** Capture a snapshot every N events appended to the live log. Default 50. */
  snapshotEveryNEvents?: number;
  /** Ring-buffer capacity for snapshots. Default 40. */
  snapshotCapacity?: number;
}

interface DiscardedTail {
  parentTick: number;
  events: AppendedEvent[];
  rerolled: boolean;
}

const SIM_STEP_MS = 1000 / 60;

export class TimelineController {
  private readonly state: GameState;
  private readonly scheduler: Scheduler;
  private readonly store: SnapshotStore;
  private readonly snapEveryN: number;
  private readonly silentLog: SilentEventLog;

  private liveSnapshot: Snapshot | null = null;
  private lastSnapshotEventCount = 0;
  private _isScrubbed = false;
  private discardedFutures: DiscardedTail[] = [];

  constructor(opts: TimelineOptions) {
    this.state = opts.state;
    this.scheduler = opts.scheduler;
    this.snapEveryN = opts.snapshotEveryNEvents ?? 50;
    this.store = new SnapshotStore({ capacity: opts.snapshotCapacity ?? 40 });
    this.silentLog = new SilentEventLog(this.state.clock);
  }

  get isScrubbed(): boolean { return this._isScrubbed; }
  get currentTick(): number { return this.state.clock.now(); }
  get maxTick(): number {
    return this.liveSnapshot ? this.liveSnapshot.tick : this.state.clock.now();
  }

  /** Called by game.ts after every live (non-scrubbed) scheduler.tick. */
  onAfterLiveTick(): void {
    if (this._isScrubbed) return;
    const evNow = this.state.eventLog.size();
    if (evNow - this.lastSnapshotEventCount >= this.snapEveryN || this.store.size() === 0) {
      this.store.push(captureSnapshot(this.state));
      this.lastSnapshotEventCount = evNow;
    }
  }

  jumpTo(targetTick: number): void {
    if (!this._isScrubbed) {
      this.liveSnapshot = captureSnapshot(this.state);
      this._isScrubbed = true;
    }
    const snap = this.store.nearestAtOrBefore(targetTick);
    if (!snap) {
      if (this.liveSnapshot && this.liveSnapshot.tick >= targetTick) {
        restoreSnapshot(this.state, this.liveSnapshot);
      }
      return;
    }
    restoreSnapshot(this.state, snap);
    this.forwardSilent(targetTick);
  }

  returnToLive(): void {
    if (!this._isScrubbed || !this.liveSnapshot) return;
    restoreSnapshot(this.state, this.liveSnapshot);
    this.liveSnapshot = null;
    this._isScrubbed = false;
  }

  commit(opts: { reroll: boolean }): void {
    if (!this._isScrubbed) return;
    const cutoff = this.state.clock.now();
    const tail = this.state.eventLog.since(0).filter(e => e.t > cutoff);
    this.discardedFutures.push({
      parentTick: cutoff,
      events: tail,
      rerolled: opts.reroll,
    });
    truncateEventLogAt(this.state.eventLog, cutoff);
    this.store.truncateAfter(cutoff);
    if (opts.reroll) {
      const newSeed = this.state.rng.nextInt(0x7fffffff);
      this.state.rng = createRng(newSeed);
    }
    this.liveSnapshot = null;
    this._isScrubbed = false;
    this.lastSnapshotEventCount = this.state.eventLog.size();
  }

  getDiscardedFutures(): readonly DiscardedTail[] { return this.discardedFutures; }

  private forwardSilent(targetTick: number): void {
    const baseCtx = {
      world: this.state.world!,
      spirits: this.state.spirits,
      log: this.silentLog,
      clock: this.state.clock,
      rng: this.state.rng,
    };
    while (this.state.clock.now() < targetTick) {
      this.scheduler.tick(SIM_STEP_MS, baseCtx);
    }
  }
}

/** Tactical shim: EventLog doesn't expose internal events array. */
function truncateEventLogAt(log: GameState['eventLog'], cutoff: number): void {
  const internal = log as unknown as { events: { t: number }[] };
  internal.events = internal.events.filter(e => e.t <= cutoff);
}
```

- [ ] **Step 4: Run the timeline-jump test.**

Run: `npx vitest run tests/unit/timeline-jump.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/timeline.ts tests/unit/timeline-jump.test.ts
git commit -m "feat(core): TimelineController jumpTo + returnToLive via silent replay"
```

---

### Task 9: TimelineController — commit and re-roll

**Files:**
- Test: `tests/unit/timeline-commit.test.ts` (new)

- [ ] **Step 1: Write the test** for commit-forward equivalence and re-roll divergence.

```ts
// tests/unit/timeline-commit.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

function attachWorld(state: ReturnType<typeof createState>) {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 20; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 20; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 20, height: 20, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 10, y: 10, properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown> });
}

function buildSched(state: ReturnType<typeof createState>) {
  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(() => state.map));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => state.map));
  return sched;
}

function tickFor(state: ReturnType<typeof createState>, sched: Scheduler, tl: TimelineController, n: number) {
  for (let i = 0; i < n; i++) {
    sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
    tl.onAfterLiveTick();
  }
}

describe('TimelineController.commit', () => {
  it('commit with reroll=false truncates events after the scrub tick', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    tl.commit({ reroll: false });
    const tails = state.eventLog.since(0).filter(e => e.t > midTick);
    expect(tails.length).toBe(0);
    expect(tl.isScrubbed).toBe(false);
  });

  it('commit with reroll=true changes the rng state', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    const rngBefore = state.rng.getState();
    tl.commit({ reroll: true });
    const rngAfter = state.rng.getState();
    expect(rngAfter).not.toEqual(rngBefore);
  });

  it('discarded futures are retained for Spec C', () => {
    const state = createState();
    attachWorld(state);
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    tickFor(state, sched, tl, 60);
    const midTick = state.clock.now();
    tickFor(state, sched, tl, 30);

    tl.jumpTo(midTick);
    tl.commit({ reroll: false });
    const futures = tl.getDiscardedFutures();
    expect(futures.length).toBe(1);
    expect(futures[0].parentTick).toBe(midTick);
    expect(futures[0].rerolled).toBe(false);
  });
});
```

- [ ] **Step 2: Run.**

Run: `npx vitest run tests/unit/timeline-commit.test.ts`
Expected: PASS (logic was written in Task 8). If a case fails, fix in `src/core/timeline.ts` and re-run.

- [ ] **Step 3: Commit.**

```bash
git add tests/unit/timeline-commit.test.ts src/core/timeline.ts
git commit -m "test(timeline): commit truncates, re-roll diverges, futures retained"
```

---

### Task 10: Replay equivalence sanity test

**Files:**
- Test: `tests/unit/timeline-replay-equivalence.test.ts`

- [ ] **Step 1: Write the test.**

```ts
// tests/unit/timeline-replay-equivalence.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

function attach(state: ReturnType<typeof createState>) {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 15; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 15; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 15, height: 15, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 7, y: 7, properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown> });
}

describe('Timeline replay equivalence', () => {
  it('jumpTo + returnToLive leaves world state byte-identical', () => {
    const state = createState();
    attach(state);
    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    const tl = new TimelineController({ state, scheduler: sched });

    for (let i = 0; i < 90; i++) {
      sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }
    const liveTick = state.clock.now();
    const liveX = state.world!.registry.get('n1')!.x;
    const liveY = state.world!.registry.get('n1')!.y;
    const liveRng = state.rng.getState();
    const liveEvents = state.eventLog.size();

    tl.jumpTo(Math.floor(liveTick / 3));
    tl.returnToLive();

    expect(state.clock.now()).toBe(liveTick);
    expect(state.world!.registry.get('n1')!.x).toBe(liveX);
    expect(state.world!.registry.get('n1')!.y).toBe(liveY);
    expect(state.rng.getState()).toEqual(liveRng);
    expect(state.eventLog.size()).toBe(liveEvents);
  });
});
```

- [ ] **Step 2: Run.**

Run: `npx vitest run tests/unit/timeline-replay-equivalence.test.ts`
Expected: PASS. If it fails, the most likely cause is `restoreSnapshot` missing a field; fix it in `src/core/snapshot.ts` and re-run.

- [ ] **Step 3: Commit.**

```bash
git add tests/unit/timeline-replay-equivalence.test.ts
git commit -m "test(timeline): jumpTo+returnToLive round-trips world state"
```

---

### Task 11: Wire `TimelineController` into `Game`

**Files:**
- Modify: `src/game.ts:43-95` (constructor & scheduler setup)
- Modify: `src/game.ts:293-318` (game loop)

- [ ] **Step 1: Add the import and field.**

Near the other imports in `src/game.ts`:

```ts
import { TimelineController } from '@/core/timeline';
```

Add a field on the `Game` class (alongside `private scheduler`):

```ts
private timeline!: TimelineController;
```

- [ ] **Step 2: Instantiate after the scheduler is built.**

In the `Game` constructor, after the `this.scheduler.register(...)` calls:

```ts
this.timeline = new TimelineController({
  state: this.state,
  scheduler: this.scheduler,
});
```

- [ ] **Step 3: Hook the live tick observation.**

In `startLoop()`, replace the existing `if (!this.state.paused && this.state.world)` block with:

```ts
if (!this.state.paused && this.state.world && !this.timeline.isScrubbed) {
  this.updateNpcFrames(deltaMs);
  this.scheduler.tick(deltaMs, {
    world: this.state.world,
    spirits: this.state.spirits,
    log: this.state.eventLog,
    clock: this.state.clock,
    rng: this.state.rng,
  });
  this.timeline.onAfterLiveTick();
}
```

- [ ] **Step 4: Build & test.**

Run: `npm run build && npm test -- --run`
Expected: PASS — TypeScript compiles, all tests still green.

- [ ] **Step 5: Commit.**

```bash
git add src/game.ts
git commit -m "feat(game): mount TimelineController and gate live ticks on isScrubbed"
```

---

## Phase 4 — UI foundations

### Task 12: Port `tokens.css`

**Files:**
- Create: `src/ui/tokens.css` (copy from `docs/design/2026-05-17-ui-system-handoff/preview/tokens.css`)
- Create: `src/ui/inject-tokens.ts`
- Modify: `src/game.ts` (call `injectTokens` in constructor; clean up on destroy)

- [ ] **Step 1: Copy the design tokens verbatim.**

```bash
cp docs/design/2026-05-17-ui-system-handoff/preview/tokens.css src/ui/tokens.css
```

- [ ] **Step 2: Create the injector.**

```ts
// src/ui/inject-tokens.ts
import tokensCss from './tokens.css?raw';

export function injectTokens(container: HTMLElement): () => void {
  const style = document.createElement('style');
  style.dataset.smallGodsTokens = 'true';
  style.textContent = tokensCss;
  container.appendChild(style);
  return () => style.remove();
}
```

- [ ] **Step 3: Add to `Game`.**

In `src/game.ts`, near the imports:

```ts
import { injectTokens } from '@/ui/inject-tokens';
```

Add a field:

```ts
private cleanupTokens: (() => void) | null = null;
```

In the constructor, right after the container-position fixup:

```ts
this.cleanupTokens = injectTokens(this.container);
```

In `destroy()` (or the existing teardown method, search for `cancelAnimationFrame`):

```ts
this.cleanupTokens?.();
```

- [ ] **Step 4: Verify the build picks up the CSS.**

Run: `npm run build`
Expected: PASS — Vite emits the CSS as a string bundled into the JS.

- [ ] **Step 5: Smoke-check in dev.**

Run: `npm run dev` and open the existing game. In devtools confirm a `<style data-small-gods-tokens="true">` element exists inside the container and contains `--w-grass`.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/tokens.css src/ui/inject-tokens.ts src/game.ts
git commit -m "feat(ui): port design tokens; inject scoped stylesheet on mount"
```

---

### Task 13: Calendar helper

**Files:**
- Create: `src/core/calendar.ts`
- Test: `tests/unit/calendar.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/unit/calendar.test.ts
import { describe, it, expect } from 'vitest';
import { formatCalendarTick, TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

describe('calendar', () => {
  it('formats tick 0 as year 1, spring, day 1', () => {
    expect(formatCalendarTick(0)).toEqual({ year: 1, season: 'spring', day: 1, dayOfYear: 1 });
  });

  it('formats one full year later as year 2, spring, day 1', () => {
    const ticksPerYear = TICKS_PER_DAY * DAYS_PER_YEAR;
    expect(formatCalendarTick(ticksPerYear).year).toBe(2);
    expect(formatCalendarTick(ticksPerYear).season).toBe('spring');
    expect(formatCalendarTick(ticksPerYear).day).toBe(1);
  });

  it('formats mid-summer correctly', () => {
    const ticksPerYear = TICKS_PER_DAY * DAYS_PER_YEAR;
    const result = formatCalendarTick(Math.floor(ticksPerYear * 0.3));
    expect(result.season).toBe('summer');
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/unit/calendar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/calendar.ts`.**

```ts
// src/core/calendar.ts
export const TICKS_PER_DAY = 240;
export const DAYS_PER_YEAR = 96;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = typeof SEASONS[number];

export interface CalendarTick {
  year: number;
  season: Season;
  day: number;
  dayOfYear: number;
}

export function formatCalendarTick(tick: number): CalendarTick {
  const t = Math.max(0, Math.floor(tick));
  const ticksPerYear = TICKS_PER_DAY * DAYS_PER_YEAR;
  const year = Math.floor(t / ticksPerYear) + 1;
  const dayOfYear = Math.floor((t % ticksPerYear) / TICKS_PER_DAY) + 1;
  const seasonLen = Math.floor(DAYS_PER_YEAR / SEASONS.length);
  const seasonIdx = Math.min(SEASONS.length - 1, Math.floor((dayOfYear - 1) / seasonLen));
  return {
    year,
    season: SEASONS[seasonIdx],
    day: ((dayOfYear - 1) % seasonLen) + 1,
    dayOfYear,
  };
}

export function calendarLabel(tick: number): string {
  const c = formatCalendarTick(tick);
  return `Y${c.year} ${c.season} · ${c.dayOfYear}/${DAYS_PER_YEAR}`;
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/unit/calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/core/calendar.ts tests/unit/calendar.test.ts
git commit -m "feat(core): calendar helper for tick → 'Y1 spring · 30/96'"
```

---

### Task 14: Chrome scaffold (hosts the Time chip)

**Files:**
- Create: `src/ui/chrome.ts`
- Test: `tests/dom/chrome.test.ts`

- [ ] **Step 1: Write the failing DOM test.**

```ts
// tests/dom/chrome.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { mountChrome } from '@/ui/chrome';

describe('Chrome scaffold', () => {
  it('creates four anchor regions inside the container', () => {
    const container = document.createElement('div');
    container.style.position = 'relative';
    document.body.appendChild(container);

    const chrome = mountChrome(container);
    expect(container.querySelector('.sg-anchor-top-left')).not.toBeNull();
    expect(container.querySelector('.sg-anchor-top-right')).not.toBeNull();
    expect(container.querySelector('.sg-anchor-bottom-left')).not.toBeNull();
    expect(container.querySelector('.sg-anchor-bottom-right')).not.toBeNull();
    chrome.dispose();
    expect(container.querySelector('.sg-anchor-top-left')).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/chrome.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/ui/chrome.ts`.**

```ts
// src/ui/chrome.ts
export interface ChromeHandle {
  anchorTopLeft: HTMLElement;
  anchorTopRight: HTMLElement;
  anchorBottomLeft: HTMLElement;
  anchorBottomRight: HTMLElement;
  dispose(): void;
}

function makeAnchor(side: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): HTMLElement {
  const el = document.createElement('div');
  el.className = `sg-anchor sg-anchor-${side}`;
  el.style.position = 'absolute';
  el.style.zIndex = '20';
  el.style.pointerEvents = 'none';
  const PAD = '18px';
  if (side === 'top-left')      { el.style.top = PAD; el.style.left  = PAD; }
  if (side === 'top-right')     { el.style.top = PAD; el.style.right = PAD; el.style.display = 'flex'; el.style.gap = '8px'; el.style.alignItems = 'flex-start'; }
  if (side === 'bottom-left')   { el.style.bottom = PAD; el.style.left  = PAD; }
  if (side === 'bottom-right')  { el.style.bottom = PAD; el.style.right = PAD; }
  return el;
}

export function mountChrome(container: HTMLElement): ChromeHandle {
  const tl = makeAnchor('top-left');
  const tr = makeAnchor('top-right');
  const bl = makeAnchor('bottom-left');
  const br = makeAnchor('bottom-right');
  container.appendChild(tl);
  container.appendChild(tr);
  container.appendChild(bl);
  container.appendChild(br);
  return {
    anchorTopLeft: tl,
    anchorTopRight: tr,
    anchorBottomLeft: bl,
    anchorBottomRight: br,
    dispose() { tl.remove(); tr.remove(); bl.remove(); br.remove(); },
  };
}

export function mountPastVeil(container: HTMLElement): { setActive(on: boolean): void; dispose(): void } {
  const veil = document.createElement('div');
  veil.className = 'sg-past-veil';
  veil.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:15',
    'pointer-events:none', 'opacity:0', 'transition:opacity 200ms ease-out',
    'background: linear-gradient(180deg, oklch(0.55 0.09 225 / 0.04), oklch(0.55 0.09 225 / 0.08))',
  ].join(';');
  container.appendChild(veil);
  return {
    setActive(on) { veil.style.opacity = on ? '1' : '0'; },
    dispose() { veil.remove(); },
  };
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/dom/chrome.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the past-veil test in the same file.**

Append to `tests/dom/chrome.test.ts`:

```ts
import { mountPastVeil } from '@/ui/chrome';

describe('past veil', () => {
  it('toggles opacity on setActive', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const v = mountPastVeil(c);
    const el = c.querySelector('.sg-past-veil') as HTMLElement;
    expect(el.style.opacity).toBe('0');
    v.setActive(true);
    expect(el.style.opacity).toBe('1');
    v.setActive(false);
    expect(el.style.opacity).toBe('0');
    v.dispose();
  });
});
```

Run: `npx vitest run tests/dom/chrome.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/chrome.ts tests/dom/chrome.test.ts
git commit -m "feat(ui): chrome scaffold (four anchors + past-veil overlay)"
```

---

## Phase 5 — Time chip

### Task 15: Time chip component

**Files:**
- Create: `src/ui/panels/time-chip.ts`
- Test: `tests/dom/time-chip.test.ts`

- [ ] **Step 1: Write the failing DOM test.**

```ts
// tests/dom/time-chip.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeChip } from '@/ui/panels/time-chip';
import { SimClock } from '@/core/clock';

describe('TimeChip', () => {
  it('renders the calendar label and the current rate', () => {
    const host = document.createElement('div');
    const clock = new SimClock();
    const chip = mountTimeChip(host, {
      clock,
      getRate: () => 1,
      isPaused: () => false,
      onClick: () => {},
    });
    expect(host.textContent).toContain('Y1 spring');
    expect(host.textContent).toContain('1×');
    chip.dispose();
  });

  it('shows paused state when isPaused() returns true', () => {
    const host = document.createElement('div');
    const clock = new SimClock();
    const chip = mountTimeChip(host, {
      clock,
      getRate: () => 0,
      isPaused: () => true,
      onClick: () => {},
    });
    chip.refresh();
    expect(host.textContent).toContain('paused');
    chip.dispose();
  });

  it('fires onClick when clicked', () => {
    const host = document.createElement('div');
    const onClick = vi.fn();
    const chip = mountTimeChip(host, {
      clock: new SimClock(),
      getRate: () => 1,
      isPaused: () => false,
      onClick,
    });
    (host.querySelector('.sg-time-chip') as HTMLElement).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    chip.dispose();
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/time-chip.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/ui/panels/time-chip.ts`.**

```ts
// src/ui/panels/time-chip.ts
import type { SimClock } from '@/core/clock';
import { calendarLabel } from '@/core/calendar';

export interface TimeChipOptions {
  clock: SimClock;
  getRate: () => number;
  isPaused: () => boolean;
  onClick: () => void;
}

export interface TimeChipHandle {
  refresh(): void;
  dispose(): void;
}

export function mountTimeChip(host: HTMLElement, opts: TimeChipOptions): TimeChipHandle {
  const btn = document.createElement('button');
  btn.className = 'sg-time-chip sg-chip';
  btn.style.pointerEvents = 'auto';
  btn.setAttribute('aria-label', 'Toggle time bar');
  btn.addEventListener('click', opts.onClick);

  const icon = document.createElement('span');
  icon.className = 'sg-time-chip__icon';
  icon.textContent = '◷';
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'sg-time-chip__label';
  btn.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'sg-time-chip__rate';
  btn.appendChild(badge);

  host.appendChild(btn);

  function refresh(): void {
    label.textContent = ' ' + calendarLabel(opts.clock.now()) + ' ';
    if (opts.isPaused()) {
      badge.textContent = 'paused';
      btn.classList.add('sg-time-chip--paused');
    } else {
      badge.textContent = `${opts.getRate()}×`;
      btn.classList.remove('sg-time-chip--paused');
    }
  }
  refresh();
  return {
    refresh,
    dispose() { btn.remove(); },
  };
}
```

- [ ] **Step 4: Append component CSS** to `src/ui/tokens.css`:

```css
/* Time chip ───────────────────────────────────────────────── */
.sg-time-chip {
  pointer-events: auto;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  background: var(--shade);
  border: 1px solid var(--line);
  border-radius: var(--r-pill);
  font-family: var(--f-sans);
  font-size: var(--t-base);
  color: var(--ink);
  cursor: pointer;
  backdrop-filter: blur(8px);
  box-shadow: var(--lift-1);
}
.sg-time-chip__rate {
  font-family: var(--f-mono);
  font-size: var(--t-tiny);
  color: var(--ink-3);
  padding: 2px 6px;
  border-radius: var(--r-pill);
  background: var(--paper-2);
}
.sg-time-chip--paused .sg-time-chip__rate { color: var(--time); }
```

- [ ] **Step 5: Run tests.**

Run: `npx vitest run tests/dom/time-chip.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/panels/time-chip.ts tests/dom/time-chip.test.ts src/ui/tokens.css
git commit -m "feat(ui): Time chip — calendar label, rate badge, paused state"
```

---

## Phase 6 — Time bar

### Task 16: Time bar skeleton

**Files:**
- Create: `src/ui/panels/time-bar.ts`
- Test: `tests/dom/time-bar-skeleton.test.ts`

- [ ] **Step 1: Write the failing DOM test.**

```ts
// tests/dom/time-bar-skeleton.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

describe('TimeBar skeleton', () => {
  it('mounts and dismounts cleanly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bar = mountTimeBar(container, makeFakeDeps());
    expect(container.querySelector('.sg-time-bar')).not.toBeNull();
    bar.dispose();
    expect(container.querySelector('.sg-time-bar')).toBeNull();
  });
});

function makeFakeDeps() {
  return {
    timeline: {
      isScrubbed: false,
      currentTick: 0,
      maxTick: 0,
      jumpTo: () => {},
      returnToLive: () => {},
      commit: () => {},
      onAfterLiveTick: () => {},
    },
    scheduler: { setRate: () => {}, getRate: () => 1 },
    eventLog: {
      subscribe: () => () => {},
      since: () => [],
      size: () => 0,
    },
    clock: { now: () => 0 },
    onDismiss: () => {},
  } as unknown as Parameters<typeof mountTimeBar>[1];
}
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/time-bar-skeleton.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the skeleton.**

```ts
// src/ui/panels/time-bar.ts
import type { TimelineController } from '@/core/timeline';
import type { Scheduler } from '@/core/scheduler';
import type { EventLog } from '@/core/events';
import type { SimClock } from '@/core/clock';

export interface TimeBarDeps {
  timeline: TimelineController;
  scheduler: Scheduler;
  eventLog: EventLog;
  clock: SimClock;
  onDismiss(): void;
}

export interface TimeBarHandle {
  refresh(): void;
  dispose(): void;
}

export function mountTimeBar(container: HTMLElement, deps: TimeBarDeps): TimeBarHandle {
  const root = document.createElement('div');
  root.className = 'sg-time-bar sg-fade-up';
  root.style.cssText = [
    'position:absolute', 'left:18px', 'right:18px', 'bottom:18px',
    'z-index:25', 'pointer-events:auto',
  ].join(';');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Timeline');

  const mainRow = document.createElement('div');
  mainRow.className = 'sg-time-bar__row sg-time-bar__row--main';
  root.appendChild(mainRow);

  container.appendChild(root);

  function refresh(): void {
    // No-op in the skeleton; later tasks populate it.
  }

  return {
    refresh,
    dispose() { root.remove(); },
  };
}
```

- [ ] **Step 4: Append CSS for the bar shell** to `src/ui/tokens.css`:

```css
.sg-time-bar {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--lift-2);
  padding: 8px 12px;
}
.sg-time-bar__row {
  display: flex; align-items: center; gap: 12px;
}
.sg-time-bar__row--commit {
  background: oklch(0.94 0.04 225 / 0.65);
  border-bottom: 1px solid var(--line);
  padding: 8px 12px;
  margin: -8px -12px 8px -12px;
  border-radius: var(--r-4) var(--r-4) 0 0;
}
```

- [ ] **Step 5: Run tests.**

Run: `npx vitest run tests/dom/time-bar-skeleton.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/panels/time-bar.ts tests/dom/time-bar-skeleton.test.ts src/ui/tokens.css
git commit -m "feat(ui): TimeBar skeleton container"
```

---

### Task 17: Transport + speed buttons

**Files:**
- Modify: `src/ui/panels/time-bar.ts`
- Test: `tests/dom/time-bar-transport.test.ts`

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/dom/time-bar-transport.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

function makeDeps(over: Partial<any> = {}) {
  return {
    timeline: {
      isScrubbed: false,
      currentTick: 1240,
      maxTick: 1840,
      jumpTo: vi.fn(),
      returnToLive: vi.fn(),
      commit: vi.fn(),
      onAfterLiveTick: () => {},
    },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: { subscribe: () => () => {}, since: () => [], size: () => 0 },
    clock: { now: () => 1240 },
    onDismiss: vi.fn(),
    ...over,
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar transport + speed', () => {
  it('renders pause, jump-to-start, jump-to-now buttons', () => {
    const container = document.createElement('div');
    mountTimeBar(container, makeDeps());
    expect(container.querySelector('[data-action="rewind-to-start"]')).not.toBeNull();
    expect(container.querySelector('[data-action="toggle-pause"]')).not.toBeNull();
    expect(container.querySelector('[data-action="jump-to-now"]')).not.toBeNull();
  });

  it('renders 1×/2×/4×/8× speed buttons', () => {
    const container = document.createElement('div');
    mountTimeBar(container, makeDeps());
    expect(container.querySelectorAll('[data-rate]').length).toBe(4);
  });

  it('clicking 4× calls scheduler.setRate(4)', () => {
    const container = document.createElement('div');
    const deps = makeDeps();
    mountTimeBar(container, deps);
    (container.querySelector('[data-rate="4"]') as HTMLButtonElement).click();
    expect(deps.scheduler.setRate).toHaveBeenCalledWith(4);
  });

  it('clicking jump-to-now calls timeline.returnToLive', () => {
    const container = document.createElement('div');
    const deps = makeDeps();
    mountTimeBar(container, deps);
    (container.querySelector('[data-action="jump-to-now"]') as HTMLButtonElement).click();
    expect(deps.timeline.returnToLive).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/time-bar-transport.test.ts`
Expected: FAIL — buttons missing.

- [ ] **Step 3: Replace the skeleton main row** in `src/ui/panels/time-bar.ts`.

Replace the `mainRow` creation block with a `buildMainRow` call, and add the helper functions at the bottom of the file:

```ts
// Replace the existing block:
//   const mainRow = document.createElement('div');
//   mainRow.className = 'sg-time-bar__row sg-time-bar__row--main';
//   root.appendChild(mainRow);
// with:
root.appendChild(buildMainRow(deps));
```

Append below `mountTimeBar`:

```ts
function buildMainRow(deps: TimeBarDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-time-bar__row sg-time-bar__row--main';

  // Transport.
  const transport = document.createElement('div');
  transport.className = 'sg-time-bar__transport';
  transport.appendChild(makeIconBtn('rewind-to-start', '◄◄', () => deps.timeline.jumpTo(0)));
  transport.appendChild(makeIconBtn('toggle-pause', '▮▮', () => {
    if (deps.scheduler.getRate() === 0) deps.scheduler.setRate(1);
    else deps.scheduler.setRate(0);
  }));
  transport.appendChild(makeIconBtn('jump-to-now', '►|', () => deps.timeline.returnToLive()));
  row.appendChild(transport);

  // Track placeholder (Task 18 fills in glyphs and handle).
  const track = document.createElement('div');
  track.className = 'sg-time-bar__track';
  track.setAttribute('role', 'slider');
  row.appendChild(track);

  // Tick label.
  const tickLabel = document.createElement('div');
  tickLabel.className = 'sg-time-bar__label';
  tickLabel.textContent = `${deps.timeline.currentTick} / ${deps.timeline.maxTick}`;
  row.appendChild(tickLabel);

  // Speed buttons.
  const speed = document.createElement('div');
  speed.className = 'sg-time-bar__speed';
  speed.setAttribute('role', 'radiogroup');
  for (const rate of [1, 2, 4, 8] as const) {
    const b = document.createElement('button');
    b.dataset.rate = String(rate);
    b.textContent = `${rate}×`;
    b.className = 'sg-time-bar__speed-btn';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(deps.scheduler.getRate() === rate));
    b.addEventListener('click', () => {
      deps.scheduler.setRate(rate);
      refreshSpeedAria();
    });
    speed.appendChild(b);
  }
  row.appendChild(speed);

  // Dismiss.
  const dismiss = document.createElement('button');
  dismiss.className = 'sg-time-bar__dismiss';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.addEventListener('click', () => deps.onDismiss());
  row.appendChild(dismiss);

  function refreshSpeedAria(): void {
    const current = deps.scheduler.getRate();
    speed.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-checked', String(Number(b.dataset.rate) === current));
    });
  }

  return row;
}

function makeIconBtn(action: string, glyph: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.action = action;
  b.className = 'sg-icon-btn';
  b.textContent = glyph;
  b.addEventListener('click', onClick);
  return b;
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/dom/time-bar-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Append CSS** in `src/ui/tokens.css`:

```css
.sg-time-bar__transport, .sg-time-bar__speed { display:flex; gap:4px; }
.sg-icon-btn, .sg-time-bar__speed-btn, .sg-time-bar__dismiss {
  background: transparent; border: 1px solid transparent;
  color: var(--ink-2); padding: 4px 10px; border-radius: var(--r-2);
  cursor: pointer; font-family: var(--f-sans); font-size: var(--t-small);
}
.sg-icon-btn:hover, .sg-time-bar__speed-btn:hover { background: var(--paper-2); }
.sg-time-bar__speed-btn[aria-checked="true"] {
  background: oklch(0.95 0.04 45 / 0.8);
  border-color: oklch(0.78 0.07 45);
  color: var(--w-dusk);
}
.sg-time-bar__label { font-family: var(--f-mono); color: var(--ink-3); margin-left:auto; }
.sg-time-bar__track { flex:1; height: 32px; position: relative; }
```

- [ ] **Step 6: Commit.**

```bash
git add src/ui/panels/time-bar.ts tests/dom/time-bar-transport.test.ts src/ui/tokens.css
git commit -m "feat(ui): TimeBar transport + speed buttons wired to scheduler/timeline"
```

---

### Task 18: Scrub track with handle and hit area

**Files:**
- Modify: `src/ui/panels/time-bar.ts`
- Test: `tests/dom/time-bar-track.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/dom/time-bar-track.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

function makeDeps() {
  return {
    timeline: {
      isScrubbed: false,
      currentTick: 600,
      maxTick: 1200,
      jumpTo: vi.fn(),
      returnToLive: vi.fn(),
      commit: vi.fn(),
      onAfterLiveTick: () => {},
    },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: { subscribe: () => () => {}, since: () => [], size: () => 0 },
    clock: { now: () => 600 },
    onDismiss: vi.fn(),
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar scrub track', () => {
  it('renders a track with a handle positioned at currentTick / maxTick', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountTimeBar(container, makeDeps());
    const handle = container.querySelector('.sg-time-bar__handle') as HTMLElement;
    expect(handle).not.toBeNull();
    expect(handle.style.left).toBe('50%');
  });

  it('clicking the track at 25% calls timeline.jumpTo(0.25 * maxTick)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const deps = makeDeps();
    mountTimeBar(container, deps);
    const track = container.querySelector('.sg-time-bar__track') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 32, width: 400, height: 32, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    track.dispatchEvent(new MouseEvent('click', { clientX: 100, bubbles: true }));
    expect(deps.timeline.jumpTo).toHaveBeenCalledWith(300);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/time-bar-track.test.ts`
Expected: FAIL — handle missing.

- [ ] **Step 3: Expand the track block.**

In `buildMainRow` in `src/ui/panels/time-bar.ts`, replace the existing track placeholder with the expanded version:

```ts
// Replace:
//   const track = document.createElement('div');
//   track.className = 'sg-time-bar__track';
//   track.setAttribute('role', 'slider');
//   row.appendChild(track);
// with:

const track = document.createElement('div');
track.className = 'sg-time-bar__track';
track.setAttribute('role', 'slider');
track.setAttribute('tabindex', '0');
track.setAttribute('aria-valuemin', '0');
track.setAttribute('aria-valuemax', String(deps.timeline.maxTick));
track.setAttribute('aria-valuenow', String(deps.timeline.currentTick));

const line = document.createElement('div');
line.className = 'sg-time-bar__line';
track.appendChild(line);

const handle = document.createElement('div');
handle.className = 'sg-time-bar__handle';
track.appendChild(handle);

const positionHandle = (): void => {
  const max = Math.max(1, deps.timeline.maxTick);
  const pct = Math.min(100, Math.max(0, (deps.timeline.currentTick / max) * 100));
  handle.style.left = `${pct}%`;
};
positionHandle();

const tickFromClientX = (clientX: number): number => {
  const rect = track.getBoundingClientRect();
  const rel = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(rel * deps.timeline.maxTick);
};

track.addEventListener('click', (e) => {
  deps.timeline.jumpTo(tickFromClientX((e as MouseEvent).clientX));
});

let dragging = false;
handle.addEventListener('pointerdown', (e) => {
  dragging = true;
  handle.setPointerCapture(e.pointerId);
});
handle.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  deps.timeline.jumpTo(tickFromClientX(e.clientX));
});
handle.addEventListener('pointerup', (e) => {
  dragging = false;
  handle.releasePointerCapture(e.pointerId);
});

track.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 50 : 1;
  if (e.key === 'ArrowLeft')  deps.timeline.jumpTo(Math.max(0, deps.timeline.currentTick - step));
  if (e.key === 'ArrowRight') deps.timeline.jumpTo(Math.min(deps.timeline.maxTick, deps.timeline.currentTick + step));
  if (e.key === 'Home')       deps.timeline.jumpTo(0);
  if (e.key === 'End')        deps.timeline.jumpTo(deps.timeline.maxTick);
});

row.appendChild(track);
```

Also store `positionHandle` so `refresh()` can call it. Modify the return statement in `buildMainRow`:

```ts
// At the end of buildMainRow, before `return row;`, attach the helper:
(row as HTMLElement & { __positionHandle?: () => void }).__positionHandle = positionHandle;
return row;
```

Then in `mountTimeBar`'s `refresh`:

```ts
function refresh(): void {
  const main = root.querySelector('.sg-time-bar__row--main') as HTMLElement & { __positionHandle?: () => void };
  main.__positionHandle?.();
}
```

- [ ] **Step 4: Append CSS** to `src/ui/tokens.css`:

```css
.sg-time-bar__line  {
  position: absolute; left: 0; right: 0; top: 50%;
  height: 2px; transform: translateY(-1px); background: var(--time);
  border-radius: var(--r-pill);
}
.sg-time-bar__handle {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--w-dusk); border: 2px solid var(--paper);
  cursor: grab;
}
.sg-time-bar__handle:active { cursor: grabbing; }
.sg-time-bar--scrubbed .sg-time-bar__handle { background: var(--time); }
.sg-time-bar__track { cursor: pointer; }
```

- [ ] **Step 5: Run tests.**

Run: `npx vitest run tests/dom/time-bar-track.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/panels/time-bar.ts tests/dom/time-bar-track.test.ts src/ui/tokens.css
git commit -m "feat(ui): TimeBar scrub track — click/drag/keyboard jump"
```

---

### Task 19: Event glyphs on the track

**Files:**
- Modify: `src/ui/panels/time-bar.ts`
- Test: `tests/dom/time-bar-glyphs.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/dom/time-bar-glyphs.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';
import type { AppendedEvent } from '@/core/events';

function makeDeps(events: AppendedEvent[]) {
  return {
    timeline: { isScrubbed:false, currentTick:1200, maxTick:1200, jumpTo:vi.fn(), returnToLive:vi.fn(), commit:vi.fn(), onAfterLiveTick:()=>{} },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: {
      subscribe: () => () => {},
      since: () => events,
      size: () => events.length,
    },
    clock: { now: () => 1200 },
    onDismiss: vi.fn(),
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar event glyphs', () => {
  it('renders glyphs for whisper, belief_cross, region_realized', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const events: AppendedEvent[] = [
      { id: 1, t: 100,  event: { type: 'whisper',         spiritId: 'player' as any, npcId: 'n1' as any } },
      { id: 2, t: 700,  event: { type: 'belief_cross',    spiritId: 'player' as any, npcId: 'n1' as any, kind: 'high', faith: 0.4 } },
      { id: 3, t: 1000, event: { type: 'region_realized', region: {} as any, cause: 'belief_spread' } },
    ];
    mountTimeBar(container, makeDeps(events));
    const glyphs = container.querySelectorAll('.sg-time-bar__glyph');
    expect(glyphs.length).toBe(3);
    expect(glyphs[0].getAttribute('data-glyph-type')).toBe('whisper');
    expect(glyphs[1].getAttribute('data-glyph-type')).toBe('beliefRise');
    expect(glyphs[2].getAttribute('data-glyph-type')).toBe('realize');
  });

  it('appended events trigger a glyph re-render via subscribe', () => {
    let subFn: ((e: AppendedEvent) => void) | null = null;
    const events: AppendedEvent[] = [
      { id: 1, t: 100, event: { type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any } },
    ];
    const deps = {
      timeline: { isScrubbed:false, currentTick:1200, maxTick:1200, jumpTo:vi.fn(), returnToLive:vi.fn(), commit:vi.fn(), onAfterLiveTick:()=>{} },
      scheduler: { setRate: vi.fn(), getRate: () => 1 },
      eventLog: {
        subscribe: (fn: (e: AppendedEvent) => void) => { subFn = fn; return () => {}; },
        since: () => events,
        size: () => events.length,
      },
      clock: { now: () => 1200 },
      onDismiss: vi.fn(),
    } as unknown as Parameters<typeof mountTimeBar>[1];

    const container = document.createElement('div');
    document.body.appendChild(container);
    mountTimeBar(container, deps);
    expect(container.querySelectorAll('.sg-time-bar__glyph').length).toBe(1);

    events.push({ id: 2, t: 500, event: { type: 'whisper', spiritId: 'player' as any, npcId: 'n1' as any } });
    subFn!(events[1]);
    expect(container.querySelectorAll('.sg-time-bar__glyph').length).toBe(2);
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/time-bar-glyphs.test.ts`
Expected: FAIL — no glyphs rendered.

- [ ] **Step 3: Add glyph rendering** inside `buildMainRow`, right after `track.appendChild(handle);`:

```ts
const TYPE_TO_GLYPH: Record<string, { type: string; color: string }> = {
  whisper:         { type: 'whisper',     color: 'var(--w-dusk)' },
  belief_cross:    { type: 'beliefRise',  color: 'var(--w-sun)'  },
  region_realized: { type: 'realize',     color: 'var(--time)'   },
  spirit_manifest: { type: 'rival',       color: 'var(--danger)' },
  mood_cross:      { type: 'mood',        color: 'var(--ink-3)'  },
};

function renderGlyphs(): void {
  track.querySelectorAll('.sg-time-bar__glyph').forEach(el => el.remove());
  const max = Math.max(1, deps.timeline.maxTick);
  for (const a of deps.eventLog.since(0)) {
    const meta = TYPE_TO_GLYPH[a.event.type];
    if (!meta) continue;
    const el = document.createElement('div');
    el.className = 'sg-time-bar__glyph';
    el.dataset.glyphType = meta.type;
    el.style.left = `${(a.t / max) * 100}%`;
    el.style.color = meta.color;
    el.title = `tick ${a.t} · ${meta.type}`;
    track.appendChild(el);
  }
}

renderGlyphs();
deps.eventLog.subscribe(() => renderGlyphs());
```

Append CSS:

```css
.sg-time-bar__glyph {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 12px; height: 12px; border-radius: 2px;
  background: currentColor; opacity: 0.85;
  pointer-events: none;
}
```

- [ ] **Step 4: Run tests.**

Run: `npx vitest run tests/dom/time-bar-glyphs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/ui/panels/time-bar.ts tests/dom/time-bar-glyphs.test.ts src/ui/tokens.css
git commit -m "feat(ui): TimeBar event glyphs (whisper/beliefRise/realize/rival/mood)"
```

---

### Task 20: Commit row (shown when scrubbed)

**Files:**
- Modify: `src/ui/panels/time-bar.ts`
- Test: `tests/dom/time-bar-commit.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/dom/time-bar-commit.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { mountTimeBar } from '@/ui/panels/time-bar';

function makeDeps(over: Partial<any> = {}) {
  return {
    timeline: { isScrubbed: false, currentTick: 1180, maxTick: 1840, jumpTo: vi.fn(), returnToLive: vi.fn(), commit: vi.fn(), onAfterLiveTick:()=>{}, ...(over.timeline ?? {}) },
    scheduler: { setRate: vi.fn(), getRate: () => 1 },
    eventLog: { subscribe: () => () => {}, since: () => [], size: () => 0 },
    clock: { now: () => 1180 },
    onDismiss: vi.fn(),
  } as unknown as Parameters<typeof mountTimeBar>[1];
}

describe('TimeBar commit row', () => {
  it('is hidden when isScrubbed=false', () => {
    const container = document.createElement('div');
    mountTimeBar(container, makeDeps());
    expect(container.querySelector('.sg-time-bar__row--commit')).toBeNull();
  });

  it('is visible when isScrubbed=true with the three buttons', () => {
    const container = document.createElement('div');
    const deps = makeDeps({ timeline: { isScrubbed: true, currentTick: 1180, maxTick: 1840 } });
    const bar = mountTimeBar(container, deps);
    bar.refresh();
    expect(container.querySelector('.sg-time-bar__row--commit')).not.toBeNull();
    expect(container.querySelector('[data-action="back-to-now"]')).not.toBeNull();
    expect(container.querySelector('[data-action="commit"]')).not.toBeNull();
    expect(container.querySelector('[data-action="reroll"]')).not.toBeNull();
  });

  it('clicking Continue calls timeline.commit({ reroll: false })', () => {
    const container = document.createElement('div');
    const deps = makeDeps({ timeline: { isScrubbed: true, currentTick: 1180, maxTick: 1840 } });
    const bar = mountTimeBar(container, deps);
    bar.refresh();
    (container.querySelector('[data-action="commit"]') as HTMLButtonElement).click();
    expect(deps.timeline.commit).toHaveBeenCalledWith({ reroll: false });
  });

  it('clicking Try a different way calls timeline.commit({ reroll: true })', () => {
    const container = document.createElement('div');
    const deps = makeDeps({ timeline: { isScrubbed: true, currentTick: 1180, maxTick: 1840 } });
    const bar = mountTimeBar(container, deps);
    bar.refresh();
    (container.querySelector('[data-action="reroll"]') as HTMLButtonElement).click();
    expect(deps.timeline.commit).toHaveBeenCalledWith({ reroll: true });
  });
});
```

- [ ] **Step 2: Run and verify fail.**

Run: `npx vitest run tests/dom/time-bar-commit.test.ts`
Expected: FAIL — commit row missing.

- [ ] **Step 3: Add the commit-row builder and refresh logic.**

In `src/ui/panels/time-bar.ts`, modify `mountTimeBar` so it tracks the commit row and re-applies on every `refresh`:

```ts
// Inside mountTimeBar, after `container.appendChild(root);` and before `function refresh()`:
let commitRow: HTMLElement | null = null;

function refreshScrubState(): void {
  const wantsCommit = deps.timeline.isScrubbed;
  if (wantsCommit && !commitRow) {
    commitRow = buildCommitRow(deps);
    root.insertBefore(commitRow, root.firstChild);
    root.classList.add('sg-time-bar--scrubbed');
  } else if (!wantsCommit && commitRow) {
    commitRow.remove();
    commitRow = null;
    root.classList.remove('sg-time-bar--scrubbed');
  }
  if (commitRow) {
    const tickEl = commitRow.querySelector('.sg-commit__tick') as HTMLElement | null;
    if (tickEl) tickEl.textContent = String(deps.timeline.currentTick);
  }
}

refreshScrubState();
```

And update `refresh()`:

```ts
function refresh(): void {
  const main = root.querySelector('.sg-time-bar__row--main') as HTMLElement & { __positionHandle?: () => void };
  main.__positionHandle?.();
  refreshScrubState();
}
```

Append `buildCommitRow` to the bottom of the file:

```ts
function buildCommitRow(deps: TimeBarDeps): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sg-time-bar__row sg-time-bar__row--commit';

  const prompt = document.createElement('div');
  prompt.className = 'sg-commit__prompt';

  const dot = document.createElement('span');
  dot.className = 'sg-commit__dot';
  prompt.appendChild(dot);

  prompt.appendChild(document.createTextNode(" You're looking back to tick "));

  const tickSpan = document.createElement('span');
  tickSpan.className = 'sg-commit__tick';
  tickSpan.textContent = String(deps.timeline.currentTick);
  prompt.appendChild(tickSpan);

  prompt.appendChild(document.createTextNode('. '));

  const sub = document.createElement('span');
  sub.className = 'sg-commit__sub';
  sub.textContent = 'Change what happens next?';
  prompt.appendChild(sub);

  row.appendChild(prompt);

  const actions = document.createElement('div');
  actions.className = 'sg-commit__actions';
  actions.appendChild(mkActionBtn('back-to-now',          'Back to now',          'sg-btn',                () => deps.timeline.returnToLive()));
  actions.appendChild(mkActionBtn('commit',               'Continue',             'sg-btn sg-btn--default', () => deps.timeline.commit({ reroll: false })));
  actions.appendChild(mkActionBtn('reroll',               'Try a different way',  'sg-btn sg-btn--danger',  () => deps.timeline.commit({ reroll: true })));
  row.appendChild(actions);

  return row;
}

function mkActionBtn(action: string, label: string, klass: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.action = action;
  b.className = klass;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
```

- [ ] **Step 4: Append CSS** to `src/ui/tokens.css`:

```css
.sg-commit__dot {
  display:inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: var(--time); animation: sg-shimmer 1.6s ease-in-out infinite;
  margin-right: 6px; vertical-align: middle;
}
.sg-commit__sub { color: var(--ink-3); }
.sg-commit__actions { margin-left:auto; display:flex; gap: 6px; }
.sg-btn { padding: 6px 12px; border-radius: var(--r-2); border: 1px solid var(--line);
          background: var(--paper); color: var(--ink); cursor: pointer; font: var(--t-small)/1 var(--f-sans); }
.sg-btn--default { background: var(--w-dusk); color: var(--paper); border-color: transparent; }
.sg-btn--danger  { background: var(--paper); color: var(--danger); border-color: var(--danger); }
```

- [ ] **Step 5: Run tests.**

Run: `npx vitest run tests/dom/time-bar-commit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/panels/time-bar.ts tests/dom/time-bar-commit.test.ts src/ui/tokens.css
git commit -m "feat(ui): TimeBar commit row (Back to now / Continue / Try a different way)"
```

---

## Phase 7 — Integration & keyboard

### Task 21: Wire Chrome + Time chip + Time bar in `Game`

**Files:**
- Modify: `src/game.ts`

- [ ] **Step 1: Add imports.**

```ts
import { mountChrome, mountPastVeil, type ChromeHandle } from '@/ui/chrome';
import { mountTimeChip, type TimeChipHandle } from '@/ui/panels/time-chip';
import { mountTimeBar, type TimeBarHandle } from '@/ui/panels/time-bar';
```

- [ ] **Step 2: Add fields.**

```ts
private chrome!: ChromeHandle;
private veil!: ReturnType<typeof mountPastVeil>;
private timeChip!: TimeChipHandle;
private timeBar: TimeBarHandle | null = null;
```

- [ ] **Step 3: Construct chrome, veil, and chip** in the constructor right after `injectTokens` was called and right after `this.timeline = …`:

```ts
this.chrome = mountChrome(this.container);
this.veil = mountPastVeil(this.container);
this.timeChip = mountTimeChip(this.chrome.anchorTopRight, {
  clock: this.state.clock,
  getRate: () => this.scheduler.getRate(),
  isPaused: () => this.scheduler.getRate() === 0,
  onClick: () => this.toggleTimeBar(),
});
```

- [ ] **Step 4: Implement `toggleTimeBar`.**

```ts
private toggleTimeBar(): void {
  if (this.timeBar) {
    this.timeBar.dispose();
    this.timeBar = null;
    return;
  }
  this.timeBar = mountTimeBar(this.container, {
    timeline: this.timeline,
    scheduler: this.scheduler,
    eventLog: this.state.eventLog,
    clock: this.state.clock,
    onDismiss: () => this.toggleTimeBar(),
  });
}
```

- [ ] **Step 5: Refresh chip + bar + veil every frame** in `startLoop`'s `loop`, after `this.render()`:

```ts
this.timeChip.refresh();
this.timeBar?.refresh();
this.veil.setActive(this.timeline.isScrubbed);
```

- [ ] **Step 6: Add disposal** in the existing teardown method (search for `cancelAnimationFrame`):

```ts
this.timeBar?.dispose();
this.timeChip.dispose();
this.veil.dispose();
this.chrome.dispose();
```

- [ ] **Step 7: Build and smoke-test.**

Run: `npm run build && npm run dev`

Confirm in the browser:
- A pill in the top-right shows `Y1 spring · …  1×`.
- Clicking it slides up a bottom bar with transport, speed, scrub track.
- Clicking 2× makes the sim run faster.
- Clicking ▮▮ pauses; clicking again resumes at 1×.

- [ ] **Step 8: Commit.**

```bash
git add src/game.ts
git commit -m "feat(game): mount chrome, Time chip, summon-able Time bar, past-veil"
```

---

### Task 22: Keyboard wiring

**Files:**
- Modify: `src/ui/controls.ts`
- Modify: `src/game.ts`
- Test: `tests/dom/time-keys.test.ts`

- [ ] **Step 1: Read** `src/ui/controls.ts` to see the existing pattern.

Run: `head -60 src/ui/controls.ts`

Determine where `keydown` is dispatched. The plan adds an *additional* helper to avoid disturbing existing callers.

- [ ] **Step 2: Add a new exported helper** in `src/ui/controls.ts`.

```ts
export interface TimeKeyOptions {
  onToggleTimeBar(): void;
  onTogglePause(): void;
  onSetRate(rate: number): void;
  timeBarOpen(): boolean;
  onEscape(): void;
}

export function attachTimeKeys(target: HTMLElement | Window, opts: TimeKeyOptions): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      opts.onToggleTimeBar();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      opts.onTogglePause();
      return;
    }
    if (['1', '2', '4', '8'].includes(e.key) && opts.timeBarOpen()) {
      e.preventDefault();
      opts.onSetRate(Number(e.key));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      opts.onEscape();
      return;
    }
  };
  (target as EventTarget).addEventListener('keydown', handler as EventListener);
  return () => (target as EventTarget).removeEventListener('keydown', handler as EventListener);
}
```

- [ ] **Step 3: Wire it up** in `Game` constructor.

```ts
import { attachTimeKeys } from '@/ui/controls';
// ...
private detachTimeKeys: (() => void) | null = null;
// in constructor, after Chrome is mounted:
this.detachTimeKeys = attachTimeKeys(window, {
  onToggleTimeBar: () => this.toggleTimeBar(),
  onTogglePause:   () => this.scheduler.setRate(this.scheduler.getRate() === 0 ? 1 : 0),
  onSetRate:       (n) => this.scheduler.setRate(n),
  timeBarOpen:     () => this.timeBar !== null,
  onEscape:        () => { if (this.timeBar) this.toggleTimeBar(); },
});
```

And in the teardown method:

```ts
this.detachTimeKeys?.();
```

- [ ] **Step 4: Write the DOM test.**

```ts
// tests/dom/time-keys.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { attachTimeKeys } from '@/ui/controls';

describe('time keys', () => {
  it('T calls onToggleTimeBar', () => {
    const onToggle = vi.fn();
    const detach = attachTimeKeys(window, {
      onToggleTimeBar: onToggle,
      onTogglePause: () => {},
      onSetRate: () => {},
      timeBarOpen: () => false,
      onEscape: () => {},
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T' }));
    expect(onToggle).toHaveBeenCalled();
    detach();
  });

  it('1/2/4/8 only fire when timeBarOpen returns true', () => {
    const onSetRate = vi.fn();
    const detach = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause: () => {},
      onSetRate,
      timeBarOpen: () => false,
      onEscape: () => {},
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onSetRate).not.toHaveBeenCalled();
    detach();

    const onSetRate2 = vi.fn();
    const detach2 = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause: () => {},
      onSetRate: onSetRate2,
      timeBarOpen: () => true,
      onEscape: () => {},
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onSetRate2).toHaveBeenCalledWith(4);
    detach2();
  });
});
```

- [ ] **Step 5: Run tests + smoke-test.**

Run: `npm test -- --run && npm run dev`

Confirm in the browser:
- `T` toggles the Time bar.
- `Space` pauses/resumes the sim.
- `1` / `2` / `4` / `8` set rate (only when the bar is open).
- `Esc` closes the open Time bar.

- [ ] **Step 6: Commit.**

```bash
git add src/ui/controls.ts src/game.ts tests/dom/time-keys.test.ts
git commit -m "feat(ui): keyboard shortcuts for time bar — T, Space, 1/2/4/8, Esc"
```

---

## Phase 8 — Polish & budgets

### Task 23: Snapshot-size sanity test

**Files:**
- Test: `tests/integration/snapshot-size.test.ts`

- [ ] **Step 1: Write the test.**

```ts
// tests/integration/snapshot-size.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot } from '@/core/snapshot';
import { initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';

describe('snapshot size budget', () => {
  it('a snapshot with 200 NPCs serializes to < 200 KB JSON', () => {
    const state = createState();
    const tiles: Tile[][] = [];
    for (let y = 0; y < 60; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 60; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 60, height: 60, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    state.map = map;
    state.world = new World(map);
    for (let i = 0; i < 200; i++) {
      state.world.addEntity({
        id: `n${i}`, kind: 'npc', x: i % 60, y: Math.floor(i / 60),
        properties: initNpcProps(`npc${i}`, 'farmer', 30) as unknown as Record<string, unknown>,
      });
    }
    const snap = captureSnapshot(state);
    const bytes = JSON.stringify(snap).length;
    expect(bytes).toBeLessThan(200_000);
  });
});
```

- [ ] **Step 2: Run.**

Run: `npx vitest run tests/integration/snapshot-size.test.ts`
Expected: PASS. If it fails, identify the biggest field via `JSON.stringify(snap.<field>).length` and trim `captureSnapshot` accordingly.

- [ ] **Step 3: Commit.**

```bash
git add tests/integration/snapshot-size.test.ts
git commit -m "test(snapshot): 200 NPCs serialize to under 200 KB"
```

---

### Task 24: Replay speed sanity test

**Files:**
- Test: `tests/integration/replay-speed.test.ts`

- [ ] **Step 1: Write the test.**

```ts
// tests/integration/replay-speed.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

describe('replay speed budget', () => {
  it('jumpTo + returnToLive completes in < 200ms after 500 live ticks', () => {
    const state = createState();
    const tiles: Tile[][] = [];
    for (let y = 0; y < 30; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 30; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 30, height: 30, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    state.map = map;
    state.world = new World(map);
    for (let i = 0; i < 20; i++) {
      state.world.addEntity({
        id: `n${i}`, kind: 'npc', x: i, y: i,
        properties: initNpcProps(`n${i}`, 'farmer', 30) as unknown as Record<string, unknown>,
      });
    }
    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    const tl = new TimelineController({ state, scheduler: sched });

    for (let i = 0; i < 500; i++) {
      sched.tick(16, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
      tl.onAfterLiveTick();
    }

    const t0 = performance.now();
    tl.jumpTo(Math.floor(state.clock.now() / 2));
    tl.returnToLive();
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Run.**

Run: `npx vitest run tests/integration/replay-speed.test.ts`
Expected: PASS. If slow, lower `snapshotEveryNEvents` or investigate `captureSnapshot` cost.

- [ ] **Step 3: Commit.**

```bash
git add tests/integration/replay-speed.test.ts
git commit -m "test(replay): scrub + return-to-live completes under 200ms"
```

---

### Task 25: End-to-end smoke test

**Files:**
- Test: `tests/integration/spec-b-smoke.test.ts`

- [ ] **Step 1: Write the test.**

```ts
// tests/integration/spec-b-smoke.test.ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { whisper } from '@/sim/whisper';
import type { GameMap, Tile } from '@/core/types';

describe('Spec B smoke', () => {
  it('scrub → re-roll changes the future', () => {
    const state = createState();
    const tiles: Tile[][] = [];
    for (let y = 0; y < 15; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < 15; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
      tiles.push(row);
    }
    const map: GameMap = {
      tiles, width: 15, height: 15, villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
    };
    state.map = map;
    state.world = new World(map);
    state.world.addEntity({ id: 'n1', kind: 'npc', x: 7, y: 7, properties: initNpcProps('A', 'farmer', 42) as unknown as Record<string, unknown> });

    const sched = new Scheduler();
    sched.register(new NpcMovementSystem(() => state.map));
    sched.register(new NpcSimSystem());
    sched.register(new SpiritSystem());
    sched.register(new PerceptionSystem(identityOracle, () => state.map));
    const tl = new TimelineController({ state, scheduler: sched });

    const tickFor = (n: number) => {
      for (let i = 0; i < n; i++) {
        sched.tick(333, { world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
        tl.onAfterLiveTick();
      }
    };

    tickFor(60);
    const midTick = state.clock.now();
    whisper(state.spirits.get('player')!, state.world.registry.get('n1')!, state.eventLog);
    tickFor(60);
    const fateA = state.world.registry.get('n1')!.x + state.world.registry.get('n1')!.y;

    tl.jumpTo(midTick);
    tl.commit({ reroll: true });
    tickFor(60);
    const fateB = state.world.registry.get('n1')!.x + state.world.registry.get('n1')!.y;

    expect(fateA).not.toBe(fateB);
  });
});
```

- [ ] **Step 2: Run.**

Run: `npx vitest run tests/integration/spec-b-smoke.test.ts`
Expected: PASS. If the two fates happen to coincide by chance (very unlikely with 60 ticks of movement), retry with a different seed; if systematically equal, re-roll isn't actually swapping the rng — debug `TimelineController.commit`.

- [ ] **Step 3: Run the full suite.**

Run: `npm test -- --run`
Expected: PASS — every prior test plus Spec B's additions.

- [ ] **Step 4: Commit.**

```bash
git add tests/integration/spec-b-smoke.test.ts
git commit -m "test(spec-b): end-to-end smoke — scrub + re-roll diverges fate"
```

---

### Task 26: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Spec B to the project status** in `CLAUDE.md`.

Find the line beginning with "**Current Status:**" and append:

```
- Spec B (Time) complete: seedable sfc32 RNG, hybrid snapshot/replay, summoned Time bar with scrub + commit + re-roll, past-veil scrubbed treatment.
```

- [ ] **Step 2: Append new file locations** to the "Key File Locations" table:

```
| World RNG | `src/core/rng.ts` |
| Snapshot store + capture | `src/core/snapshot.ts` |
| Timeline controller | `src/core/timeline.ts` |
| Calendar helper | `src/core/calendar.ts` |
| UI chrome | `src/ui/chrome.ts` |
| Time chip | `src/ui/panels/time-chip.ts` |
| Time bar | `src/ui/panels/time-bar.ts` |
| Design tokens | `src/ui/tokens.css` |
```

- [ ] **Step 3: Commit.**

```bash
git add CLAUDE.md
git commit -m "docs: Spec B complete in CLAUDE.md"
```

---

## Self-review checklist before merge

After all 26 tasks are committed, run these once:

```bash
npm run build                                       # TypeScript clean
npm test -- --run                                   # All tests green
grep -rn 'Math.random' src/sim                      # Should be empty (Task 3 grep guard enforces it)
grep -rn 'TODO\|FIXME' src/core/rng.ts src/core/snapshot.ts src/core/timeline.ts  # Should be empty
grep -rn 'innerHTML' src/ui                         # Should be empty (XSS guard)
```

If anything fails, fix before merging.

---

## Open items not covered by this plan (defer / Spec C)

- **Glyph clustering** when track density is high — the spec defines the rule (`< 4 px per glyph → merge`); implementation deferred until a session exposes the problem in practice. Add as a follow-up issue.
- **View-state rewind** (camera + selection following the scrubbed tick) — out of scope per spec.
- **Branches UI** — Spec C will read `TimelineController.getDiscardedFutures()`.
- **Saving timelines between sessions** — out of scope.
- **Glyph SVG icons** — Task 19 uses solid-color squares with `data-glyph-type`; the design handoff's full SVG glyph set is a follow-up beautification task once the basic shape works.
