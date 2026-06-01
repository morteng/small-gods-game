# Deterministic Time-Skip (D2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player jump the world forward N years in one closed-form, deterministic operation that turns over the population (deaths + diluted-faith births via D1's `projectTurnover`), advances the clock, and commits the result as a one-way timeline boundary.

**Architecture:** A pure transform `applySkip(world, clock, rng, log, years)` orchestrates `projectTurnover` → `killNpc` (deaths) → `materializeSynthChild` (births) → `clock.setNow` → emit `era_skipped`. Survivors are untouched (frozen belief); no power accrues (nothing ticks). The game layer then calls `TimelineController.commitSkip()` to rebaseline the snapshot store so scrub can't re-tick the un-replayable span. A minimal "Jump forward" preset control on the Time bar triggers it; a history chip summarizes it.

**Tech Stack:** TypeScript ESM, Vitest, Canvas 2D, `@/` → `src/`. All randomness flows through `state.rng` (seeded sfc32) — never `Math.random` (guarded by `tests/unit/no-random-in-sim.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-01-deterministic-time-skip-design.md`

---

## File Structure

- **Create:** `src/sim/time-skip.ts` — `applySkip` + `SkipSummary`.
- **Create:** `tests/unit/time-skip.test.ts` — transform tests.
- **Create:** `tests/unit/timeline-skip-boundary.test.ts` — boundary test.
- **Modify:** `src/core/events.ts` — add `era_skipped` to `SimEvent`.
- **Modify:** `src/sim/turnover.ts` — add `homePoiId` to `SynthChild` + populate it.
- **Modify:** `src/world/npc-lifecycle.ts` — add `materializeSynthChild`.
- **Modify:** `src/core/snapshot.ts` — add `SnapshotStore.reset()`.
- **Modify:** `src/core/timeline.ts` — add `TimelineController.commitSkip()`.
- **Modify:** `src/ui/panels/time-history.ts` — `era_skipped` chip.
- **Modify:** `src/ui/panels/time-bar.ts` — `onSkip` dep + "Jump forward" control.
- **Modify:** `src/game.ts` — wire `onSkip` → `applySkip` + `commitSkip` + refresh.

---

## Task 1: `era_skipped` event type

**Files:**
- Modify: `src/core/events.ts:30` (end of `SimEvent` union, before `system_error`)
- Test: `tests/unit/time-skip.test.ts` (created here; extended in Task 4)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/time-skip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';

describe('era_skipped event', () => {
  it('round-trips through the event log with all summary fields', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const captured: SimEvent[] = [];
    log.subscribe(a => captured.push(a.event));
    log.append({
      type: 'era_skipped', fromTick: 0, toTick: 23040, years: 1,
      deaths: 2, births: 3, believersBefore: 5, believersAfter: 6,
    });
    expect(captured).toHaveLength(1);
    const e = captured[0];
    expect(e.type).toBe('era_skipped');
    if (e.type === 'era_skipped') {
      expect(e.years).toBe(1);
      expect(e.deaths).toBe(2);
      expect(e.believersAfter).toBe(6);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/time-skip.test.ts`
Expected: FAIL — TypeScript error, `era_skipped` not assignable to `SimEvent`.

- [ ] **Step 3: Add the event type**

In `src/core/events.ts`, add to the `SimEvent` union (after the `timeline_commit` line, before `belief_cross`):

```ts
  | { type: 'era_skipped';        fromTick: number; toTick: number; years: number; deaths: number; births: number; believersBefore: number; believersAfter: number }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/time-skip.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts tests/unit/time-skip.test.ts
git commit -m "feat(d2): add era_skipped event type"
```

---

## Task 2: `SynthChild.homePoiId`

`materializeSynthChild` (Task 3) needs to know which POI a projected child belongs to. `projectTurnover` already knows it (`pa.homePoiId`) but doesn't expose it. Add it.

**Files:**
- Modify: `src/sim/turnover.ts:29-35` (`SynthChild` interface) and `:140-143` (the `births.push`)
- Test: `tests/unit/turnover.test.ts` (existing — add one case)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/turnover.test.ts` inside its top-level `describe` (mirror that file's existing world/NPC helpers; if it has an `addAdult`-style helper reuse it, otherwise construct two co-located fertile NPCs with `homePoiId: 'village'`). The assertion:

```ts
it('synthesized children carry their parents homePoiId', () => {
  const world = new World(emptyMap());
  // two co-located fertile adults (age 30) at 'village'
  const mk = (id: string) => {
    const p = initNpcProps(id, 'farmer', (id.charCodeAt(0) * 31) | 0);
    p.lineageId = id; p.birthTick = -30 * TICKS_PER_YEAR; p.homePoiId = 'village';
    world.addEntity({ id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> });
  };
  mk('mum'); mk('dad');
  const { births } = projectTurnover(queryNpcs(world), 20, 0, createRng(7));
  expect(births.length).toBeGreaterThan(0);
  expect(births.every(b => b.homePoiId === 'village')).toBe(true);
});
```

Ensure the test file imports `World`, `emptyMap` (or inline a minimal `GameMap`), `initNpcProps`, `queryNpcs`, `TICKS_PER_YEAR`, `projectTurnover`, `createRng`. (Match whatever imports the file already has; only add what's missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/turnover.test.ts`
Expected: FAIL — `homePoiId` does not exist on `SynthChild` (TS error) or is `undefined`.

- [ ] **Step 3: Add the field**

In `src/sim/turnover.ts`, in the `SynthChild` interface add:

```ts
  homePoiId?: string;
```

And in the `births.push({ ... })` call (inside the `for` loop), add `homePoiId`:

```ts
          births.push({
            id: child.id, parentIds: [pa.id, pb.id], lineageId: child.lineageId,
            birthYearOffset: y, beliefs, homePoiId: pa.homePoiId,
          });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/turnover.test.ts`
Expected: PASS (new case + all existing turnover cases).

- [ ] **Step 5: Commit**

```bash
git add src/sim/turnover.ts tests/unit/turnover.test.ts
git commit -m "feat(d2): expose homePoiId on projected SynthChild"
```

---

## Task 3: `materializeSynthChild`

Turn a `SynthChild` (projection output) into a real living NPC entity. Must work even when the recorded parents no longer exist as entities (a synth grandchild's parents were themselves projected, never materialized) — so build belief/lineage from the `SynthChild`, never by re-reading parents.

**Files:**
- Modify: `src/world/npc-lifecycle.ts` (append new export; it already has `NEWBORN_NAMES`, `clamp01`, imports)
- Test: `tests/unit/npc-lifecycle.test.ts` (existing — add a `describe`)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/npc-lifecycle.test.ts`:

```ts
import { materializeSynthChild } from '@/world/npc-lifecycle';
import type { SynthChild } from '@/sim/turnover';

describe('materializeSynthChild', () => {
  function world1Resident(): { world: World; log: EventLog } {
    const world = new World(emptyMap());
    const p = initNpcProps('resident', 'farmer', 11);
    p.homePoiId = 'village';
    world.addEntity({ id: 'resident', kind: 'npc', x: 7, y: 9, properties: p as unknown as Record<string, unknown> });
    const log = new EventLog(new SimClock());
    return { world, log };
  }

  it('materializes a child from projection data even when parents are absent', () => {
    const { world, log } = world1Resident();
    const births: string[] = [];
    log.subscribe(a => { if (a.event.type === 'npc_birth') births.push(a.event.npcId); });
    const child: SynthChild = {
      id: 'synth-0-0', parentIds: ['ghost-a', 'ghost-b'], lineageId: 'lin-1',
      birthYearOffset: 0, beliefs: { player: { faith: 0.2, understanding: 0.01, devotion: 0 } },
      homePoiId: 'village',
    };
    const e = materializeSynthChild(world, child, 5000, createRng(3), log);
    const p = npcProps(e);
    expect(e.kind).toBe('npc');
    expect(p.beliefs['player'].faith).toBeCloseTo(0.2);
    expect(p.lineageId).toBe('lin-1');
    expect(p.parentIds).toEqual(['ghost-a', 'ghost-b']);
    expect(p.birthTick).toBe(5000);
    expect(p.homePoiId).toBe('village');
    // placed at a co-located living resident's tile
    expect(e.x).toBe(7); expect(e.y).toBe(9);
    expect(births).toContain(e.id);
  });

  it('is deterministic: same seed -> same id', () => {
    const child: SynthChild = {
      id: 's', parentIds: [], lineageId: 'L', birthYearOffset: 0,
      beliefs: {}, homePoiId: 'village',
    };
    const run = () => {
      const { world, log } = world1Resident();
      return materializeSynthChild(world, child, 100, createRng(42), log).id;
    };
    expect(run()).toBe(run());
  });
});
```

Ensure the test file imports `World`, `EventLog`, `SimClock`, `createRng`, `initNpcProps`, `npcProps`, and an `emptyMap()` helper (reuse the file's existing one; if absent, copy the minimal `emptyMap` from `tests/unit/birth-system.test.ts`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/npc-lifecycle.test.ts`
Expected: FAIL — `materializeSynthChild` is not exported.

- [ ] **Step 3: Implement `materializeSynthChild`**

In `src/world/npc-lifecycle.ts`, add the import for the type and `NPC_KIND`/`queryNpcs` (the file already imports from `@/world/npc-helpers`; extend it), then append the function. Update the existing import line:

```ts
import { initNpcProps, npcProps, queryNpcs, NPC_KIND, REMAINS_KIND } from '@/world/npc-helpers';
import type { SynthChild } from '@/sim/turnover';
```

Append at the end of the file:

```ts
/**
 * Materialize a projected `SynthChild` (from `projectTurnover`) into a real living
 * NPC. Belief, lineage, and parent ids come from the projection — NOT from
 * re-reading parent entities, which may be remains or may never have existed as
 * entities (a synth grandchild's parents were themselves projected). Personality
 * and name are freshly seeded via `rng` (baseline: not blended). The child is
 * placed on a co-located living resident's tile when one exists, else the origin.
 * All randomness flows through `rng` so a time-skip reproduces under replay.
 */
export function materializeSynthChild(
  world: World, child: SynthChild, birthTick: number, rng: Rng, log: EventLog,
): Entity {
  const props = initNpcProps(rng.pick(NEWBORN_NAMES), 'child', rng.nextInt(0x7fffffff));
  props.beliefs = structuredClone(child.beliefs);
  props.lineageId = child.lineageId;
  props.parentIds = [...child.parentIds];
  props.birthTick = birthTick;
  props.homePoiId = child.homePoiId;

  // Borrow a co-located living resident's tile for placement (baseline).
  const sibling = child.homePoiId
    ? queryNpcs(world).find(e => npcProps(e).homePoiId === child.homePoiId)
    : undefined;
  const x = sibling ? sibling.x : 0;
  const y = sibling ? sibling.y : 0;
  props.homeX = x;
  props.homeY = y;

  // Deterministic, collision-guarded id (mirrors birthNpc).
  let id = '';
  do { id = `npc-b${birthTick}-${rng.nextInt(0x7fffffff)}`; } while (world.registry.get(id));

  world.addEntity({ id, kind: NPC_KIND, x, y, properties: props as unknown as Record<string, unknown> });
  log.append({ type: 'npc_birth', npcId: id, parentIds: props.parentIds, lineageId: props.lineageId });
  return world.registry.get(id)!;
}
```

> Note: `REMAINS_KIND` stays imported (used by `killNpc`). Adding `queryNpcs`/`NPC_KIND` does not conflict.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/npc-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/world/npc-lifecycle.ts tests/unit/npc-lifecycle.test.ts
git commit -m "feat(d2): materializeSynthChild — projection child to live NPC"
```

---

## Task 4: `applySkip` transform

The heart of D2. Pure transform over `(world, clock, rng, log)` — no timeline, no scheduler.

**Files:**
- Create: `src/sim/time-skip.ts`
- Test: `tests/unit/time-skip.test.ts` (extend from Task 1)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/time-skip.test.ts` (add imports at top of file):

```ts
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs, REMAINS_KIND } from '@/world/npc-helpers';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { applySkip } from '@/sim/time-skip';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, ageYears: number, poiId = 'village'): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  const e: Entity = { id, kind: 'npc', x: 3, y: 4, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function harness(seed: number) {
  const world = new World(emptyMap());
  const clock = new SimClock();
  const log = new EventLog(clock);
  return { world, clock, log, rng: createRng(seed) };
}

describe('applySkip', () => {
  it('advances the clock by exactly years * TICKS_PER_YEAR', () => {
    const h = harness(1);
    addNpc(h.world, 'a', 25); addNpc(h.world, 'b', 27);
    h.clock.setNow(1000);
    applySkip(h.world, h.clock, h.rng, h.log, 10);
    expect(h.clock.now()).toBe(1000 + 10 * TICKS_PER_YEAR);
  });

  it('converts the projected dead to remains and never deletes them', () => {
    const h = harness(2);
    addNpc(h.world, 'old1', 94); addNpc(h.world, 'old2', 94);
    const summary = applySkip(h.world, h.clock, h.rng, h.log, 3)!;
    const remains = h.world.registry.all().filter(e => e.kind === REMAINS_KIND);
    expect(remains.length).toBe(summary.deaths);
    expect(summary.deaths).toBe(2);          // age-94 over 3y: certain death
    expect(queryNpcs(h.world).length).toBe(0);
  });

  it('does not mutate surviving NPCs belief', () => {
    const h = harness(4);
    addNpc(h.world, 'm', 24); addNpc(h.world, 'f', 26);
    npcProps(h.world.registry.get('m')!).beliefs['player'] = { faith: 0.7, understanding: 0.5, devotion: 0.3 };
    const before = new Map(queryNpcs(h.world).map(e => [e.id, structuredClone(npcProps(e).beliefs)]));
    applySkip(h.world, h.clock, h.rng, h.log, 2);
    for (const e of queryNpcs(h.world)) {
      if (before.has(e.id)) expect(npcProps(e).beliefs).toEqual(before.get(e.id));
    }
  });

  it('emits exactly one era_skipped event with matching counts', () => {
    const h = harness(5);
    addNpc(h.world, 'm', 24); addNpc(h.world, 'f', 26);
    const events: string[] = [];
    h.log.subscribe(a => events.push(a.event.type));
    const summary = applySkip(h.world, h.clock, h.rng, h.log, 20)!;
    expect(events.filter(t => t === 'era_skipped')).toHaveLength(1);
    const living = queryNpcs(h.world).length;
    const remains = h.world.registry.all().filter(e => e.kind === REMAINS_KIND).length;
    expect(summary.births).toBe(living - (2 - summary.deaths)); // newborns = living minus surviving founders
    expect(summary.deaths).toBe(remains);
  });

  it('is deterministic: same seed -> identical world shape', () => {
    const run = () => {
      const h = harness(99);
      addNpc(h.world, 'm', 24); addNpc(h.world, 'f', 26); addNpc(h.world, 'g', 40);
      applySkip(h.world, h.clock, h.rng, h.log, 30);
      return h.world.registry.all().map(e => `${e.id}:${e.kind}`).sort().join('|');
    };
    expect(run()).toBe(run());
  });

  it('treats years <= 0 as a no-op (no event, no clock change)', () => {
    const h = harness(7);
    addNpc(h.world, 'm', 24);
    h.clock.setNow(500);
    const events: string[] = [];
    h.log.subscribe(a => events.push(a.event.type));
    expect(applySkip(h.world, h.clock, h.rng, h.log, 0)).toBeNull();
    expect(h.clock.now()).toBe(500);
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/time-skip.test.ts`
Expected: FAIL — `applySkip` / `src/sim/time-skip.ts` does not exist.

- [ ] **Step 3: Implement `applySkip`**

Create `src/sim/time-skip.ts`:

```ts
import type { World } from '@/world/world';
import type { SimClock } from '@/core/clock';
import type { Rng } from '@/core/rng';
import type { EventLog } from '@/core/events';
import { queryNpcs, NPC_KIND } from '@/world/npc-helpers';
import { killNpc, materializeSynthChild } from '@/world/npc-lifecycle';
import { projectTurnover } from '@/sim/turnover';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { countPlayerBelievers } from '@/sim/believers';

export interface SkipSummary {
  fromTick: number;
  toTick: number;
  years: number;
  deaths: number;
  births: number;
  believersBefore: number;
  believersAfter: number;
}

/**
 * Closed-form forward jump of `years` in-game years. Applies `projectTurnover`'s
 * projected deaths (npc → remains) and births (materialized live NPCs), advances
 * the clock, and emits one `era_skipped` summary event. Survivors are untouched
 * (frozen belief) and no power regenerates — nothing ticks. Fully deterministic
 * given `rng`. Returns the summary, or `null` for a non-positive `years` no-op.
 *
 * NOTE: death/birth events are stamped at the pre-advance tick (the clock moves
 * once, at the end); that's fine for the baseline — only the era_skipped event
 * (stamped post-advance) drives the history strip. The caller (game layer) is
 * responsible for committing the timeline boundary via TimelineController.commitSkip().
 */
export function applySkip(
  world: World, clock: SimClock, rng: Rng, log: EventLog, years: number,
): SkipSummary | null {
  if (years <= 0) return null;

  const fromTick = clock.now();
  const believersBefore = countPlayerBelievers(world);
  const living = queryNpcs(world);
  const { deaths, births } = projectTurnover(living, years, fromTick, rng);

  for (const d of deaths) {
    const e = world.registry.get(d.id);
    if (e && e.kind === NPC_KIND) {
      killNpc(world, e, fromTick + d.deathYearOffset * TICKS_PER_YEAR, d.cause, log);
    }
  }
  for (const c of births) {
    materializeSynthChild(world, c, fromTick + c.birthYearOffset * TICKS_PER_YEAR, rng, log);
  }

  const toTick = fromTick + years * TICKS_PER_YEAR;
  clock.setNow(toTick);
  const believersAfter = countPlayerBelievers(world);

  const summary: SkipSummary = {
    fromTick, toTick, years,
    deaths: deaths.length, births: births.length,
    believersBefore, believersAfter,
  };
  log.append({ type: 'era_skipped', ...summary });
  return summary;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/time-skip.test.ts`
Expected: PASS (all cases). If the `deaths === 2` extinction case is off, confirm `annualMortality(95) === 1.0` in `src/sim/mortality.ts` and that ages are 94 + 3-year span (age reaches 97 > MAX_AGE).

- [ ] **Step 5: Run the no-random guard**

Run: `npx vitest run tests/unit/no-random-in-sim.test.ts`
Expected: PASS — `time-skip.ts` uses only `rng`.

- [ ] **Step 6: Commit**

```bash
git add src/sim/time-skip.ts tests/unit/time-skip.test.ts
git commit -m "feat(d2): applySkip closed-form forward jump transform"
```

---

## Task 5: `SnapshotStore.reset()` + `TimelineController.commitSkip()`

Make a skip a one-way boundary by rebaselining the snapshot store.

**Files:**
- Modify: `src/core/snapshot.ts` (`SnapshotStore`, after `truncateAfter`)
- Modify: `src/core/timeline.ts` (`TimelineController`, after `commit`)
- Test: `tests/unit/timeline-skip-boundary.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/timeline-skip-boundary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { createState } from '@/core/state';
import { Scheduler } from '@/core/scheduler';
import { TimelineController } from '@/core/timeline';
import { initNpcProps, npcProps, queryNpcs, REMAINS_KIND } from '@/world/npc-helpers';
import { killNpc } from '@/world/npc-lifecycle';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('time-skip timeline boundary', () => {
  it('cannot scrub back across a committed skip', () => {
    const state = createState();
    state.world = new World(emptyMap());
    const p = initNpcProps('victim', 'farmer', 5);
    p.lineageId = 'victim'; p.birthTick = -90 * TICKS_PER_YEAR; p.homePoiId = 'village';
    const e: Entity = { id: 'victim', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
    state.world.addEntity(e);

    const scheduler = new Scheduler();
    const timeline = new TimelineController({ state, scheduler });
    // Baseline snapshot of the living world at tick 0.
    timeline.onAfterLiveTick();

    // Simulate a skip: advance the clock and kill the victim, then commit the boundary.
    const toTick = 50 * TICKS_PER_YEAR;
    killNpc(state.world, e, toTick, 'old_age', state.eventLog);
    state.clock.setNow(toTick);
    timeline.commitSkip();

    // Attempt to scrub back before the skip.
    timeline.jumpTo(0);

    // The victim must still be dead — the pre-skip living state is unreachable.
    expect(queryNpcs(state.world).length).toBe(0);
    expect(state.world.registry.all().filter(x => x.kind === REMAINS_KIND).length).toBe(1);
    // Pre-skip events remain readable in the canonical log.
    expect(state.eventLog.since(0).some(a => a.event.type === 'npc_death')).toBe(true);
  });
});
```

> If `Scheduler`'s constructor or `TimelineController` options differ, match the existing usage in `src/game.ts:99` (it constructs `new TimelineController({ state, scheduler })`). Adjust imports to the real `Scheduler` location (`@/core/scheduler`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/timeline-skip-boundary.test.ts`
Expected: FAIL — `timeline.commitSkip is not a function`.

- [ ] **Step 3: Add `SnapshotStore.reset()`**

In `src/core/snapshot.ts`, inside `class SnapshotStore`, after `truncateAfter`:

```ts
  /** Empty the ring buffer. Used when a time-skip rebaselines the timeline so the
   *  pre-skip span (which has no recorded ticks) can never be scrubbed into. */
  reset(): void {
    this.buf = [];
  }
```

- [ ] **Step 4: Add `TimelineController.commitSkip()`**

In `src/core/timeline.ts`, inside `class TimelineController`, after `commit(...)`:

```ts
  /**
   * Commit a closed-form time-skip as a one-way baseline. The skipped span has no
   * recorded ticks, so `forwardSilent` could not reproduce it; discard all pre-skip
   * snapshots and anchor a single fresh snapshot at the (already-advanced) current
   * tick. Afterward `jumpTo(t)` for any pre-skip `t` resolves to this baseline
   * rather than restoring unreachable pre-skip state. Call AFTER applySkip has
   * advanced the clock and mutated the world.
   */
  commitSkip(): void {
    this.store.reset();
    this.store.push(captureSnapshot(this.state));
    this.lastSnapshotEventCount = this.state.eventLog.size();
    this.liveSnapshot = null;
    this._isScrubbed = false;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/timeline-skip-boundary.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/snapshot.ts src/core/timeline.ts tests/unit/timeline-skip-boundary.test.ts
git commit -m "feat(d2): one-way skip boundary via SnapshotStore.reset + commitSkip"
```

---

## Task 6: `era_skipped` history chip + "Jump forward" control

**Files:**
- Modify: `src/ui/panels/time-history.ts`
- Modify: `src/ui/panels/time-bar.ts`
- Test: `tests/dom/time-history-era.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/dom/time-history-era.test.ts` (mirror the setup of existing `tests/dom/*` for jsdom; if the repo's DOM tests use a different harness, follow it):

```ts
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { mountTimeHistory } from '@/ui/panels/time-history';

describe('time-history era_skipped chip', () => {
  it('renders a chip for an era_skipped event', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const container = document.createElement('div');
    mountTimeHistory(container, {
      eventLog: log,
      timeline: { jumpTo() {}, currentTick: 0 },
    });
    log.append({
      type: 'era_skipped', fromTick: 0, toTick: 23040, years: 25,
      deaths: 4, births: 6, believersBefore: 8, believersAfter: 9,
    });
    const chip = container.querySelector('[data-kind="era_skipped"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('25');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dom/time-history-era.test.ts`
Expected: FAIL — no chip rendered (type not in `CHIP_LABELS`).

- [ ] **Step 3: Add `era_skipped` to the history strip**

In `src/ui/panels/time-history.ts`:

Extend the `ChipType` union:

```ts
type ChipType = 'timeline_commit' | 'whisper' | 'answer_prayer' | 'dream' | 'believer_lost' | 'era_skipped';
```

Add to `CHIP_LABELS`:

```ts
  era_skipped:     { icon: '⏭', label: 'era skipped' },
```

Make `buildChip` show the year span for skips. Replace the `el.textContent = ...` / `el.title = ...` lines with:

```ts
    if (t === 'era_skipped' && ev.event.type === 'era_skipped') {
      const yrs = ev.event.years;
      el.textContent = `${icon} +${yrs}y`;
      el.title = `skipped ${yrs} years at tick ${ev.t} — click to view`;
    } else {
      el.textContent = icon + ' ' + label + ' ' + ev.t;
      el.title = label + ' at tick ' + ev.t + ' — click to scrub';
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dom/time-history-era.test.ts`
Expected: PASS

- [ ] **Step 5: Add the "Jump forward" control + `onSkip` dep**

In `src/ui/panels/time-bar.ts`:

Extend `TimeBarDeps`:

```ts
export interface TimeBarDeps {
  timeline: TimelineController;
  scheduler: Scheduler;
  eventLog: EventLog;
  clock: SimClock;
  onDismiss(): void;
  onSkip(years: number): void;
}
```

In `buildMainRow`, immediately BEFORE the `// Dismiss.` block (i.e., after `row.appendChild(speed);`), insert a preset group:

```ts
  // Jump-forward presets (D2 time-skip). Each commits a one-way era boundary.
  const jump = document.createElement('div');
  jump.className = 'sg-time-bar__jump';
  jump.setAttribute('role', 'group');
  jump.setAttribute('aria-label', 'Jump forward');
  for (const years of [10, 25, 50] as const) {
    const b = document.createElement('button');
    b.dataset.skipYears = String(years);
    b.className = 'sg-time-bar__jump-btn';
    b.textContent = `+${years}y`;
    b.title = `Jump forward ${years} years`;
    b.addEventListener('click', () => deps.onSkip(years));
    jump.appendChild(b);
  }
  row.appendChild(jump);
```

- [ ] **Step 6: Run the full UI/DOM suite to confirm no regressions**

Run: `npx vitest run tests/dom`
Expected: PASS (existing time-bar tests still green; new chip test green). If an existing time-bar test constructs `TimeBarDeps` without `onSkip`, add `onSkip() {}` to that test's deps.

- [ ] **Step 7: Commit**

```bash
git add src/ui/panels/time-history.ts src/ui/panels/time-bar.ts tests/dom/time-history-era.test.ts
git commit -m "feat(d2): era_skipped history chip + jump-forward time-bar control"
```

---

## Task 7: Wire the skip into `game.ts`

Connect the Time bar's `onSkip` to `applySkip` + `timeline.commitSkip()` + a UI refresh.

**Files:**
- Modify: `src/game.ts` (where `mountTimeBar`/`TimeBarDeps` is constructed; imports)
- Test: manual (build + full suite); no new unit test (integration glue).

- [ ] **Step 1: Locate the Time bar construction**

Run: `grep -n "mountTimeBar\|TimeBarDeps\|onDismiss\|timeBar" src/game.ts`
Expected: a `mountTimeBar(container, { timeline, scheduler, eventLog, clock, onDismiss })` call.

- [ ] **Step 2: Add the import**

Near the other `@/sim` imports in `src/game.ts`:

```ts
import { applySkip } from '@/sim/time-skip';
```

- [ ] **Step 3: Add the `onSkip` handler to the time-bar deps**

In the `mountTimeBar(...)` deps object, add an `onSkip` alongside `onDismiss`:

```ts
      onSkip: (years: number) => {
        if (!this.state.world) return;
        // Skips are committed boundaries; never run while scrubbing the past.
        if (this.timeline.isScrubbed) this.timeline.returnToLive();
        applySkip(this.state.world, this.state.clock, this.state.rng, this.state.eventLog, years);
        this.timeline.commitSkip();
        // Refresh visible chrome (HUD believer counts, time bar tick label).
        this.timeBar?.refresh?.();
      },
```

> Match the real field names in `game.ts`: the time-bar handle may be stored under a different name than `this.timeBar`. If there is no stored handle, call whatever refresh path the dismiss flow uses, or omit the refresh line (the next live tick repaints). Keep the `applySkip` + `commitSkip` two-liner intact regardless.

- [ ] **Step 4: Type-check and build**

Run: `npm run build`
Expected: PASS (tsc clean + Vite build). Fix any signature mismatches surfaced by the compiler (e.g., an existing `TimeBarDeps` literal elsewhere now missing `onSkip`).

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all prior tests + the new D2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/game.ts
git commit -m "feat(d2): wire jump-forward control to applySkip + commitSkip"
```

---

## Final Verification

- [ ] Run `npm run build` — tsc clean + bundles.
- [ ] Run `npx vitest run` — full suite green (expect ~880+ tests).
- [ ] Run `npx vitest run tests/unit/no-random-in-sim.test.ts` — sim stays `Math.random`-free.
- [ ] Spot-check acceptance criteria (spec §10): clock advance, deaths==remains, births==living-newborns, survivor belief frozen, boundary holds, one event + one chip, extinction + zero-year behavior.

## Acceptance Criteria (from spec §10)

1. `applySkip` advances the clock by exactly `N · TICKS_PER_YEAR`. → Task 4
2. New remains == `projectTurnover` deaths; new living == its births, with matching lineage/diluted beliefs. → Tasks 3, 4
3. Surviving NPCs' belief unchanged across the skip. → Task 4
4. Same seed + world + N → identical post-skip world. → Task 4
5. After a committed skip, `jumpTo(pre-skip)` does not restore pre-skip state; pre-skip events still readable. → Task 5
6. One `era_skipped` event + one history chip per skip. → Tasks 4, 6
7. Extinction and `years <= 0` behave per spec §8. → Task 4
8. No `Math.random` in new sim code. → Task 4 (guard)
```
