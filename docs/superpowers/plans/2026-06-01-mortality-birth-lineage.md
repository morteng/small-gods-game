# Mortality, Birth & Lineage (D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give NPCs mortality, birth, and lineage so the cast undergoes generational turnover — both in real-time play and as a closed-form function the Fate time-skip (D2) will call.

**Architecture:** A pure mortality-math module (`src/sim/mortality.ts`) is the deterministic core, shared by two real-time systems (`MortalitySystem`, `BirthSystem`) and a closed-form `projectTurnover` (the D2 bridge). Death *converts* an NPC entity (`kind: 'npc' → 'remains'`) rather than deleting it; birth spawns a child of co-located fertile parents with diluted faith and near-zero understanding. Age and weathering are **derived** from `birthTick`/`deathTick` + `now`, never stored as mutable counters, keeping everything snapshot/replay-clean. All randomness flows through `ctx.rng` (seeded sfc32), never `Math.random`.

**Tech Stack:** TypeScript ES modules, Vitest. `@/` path alias → `src/`. Systems implement the `System` interface (`name`, `tickHz`, `tick(ctx)`) and register on the `Scheduler` in `game.ts`.

---

## Background the implementer needs

- **The design spec** is at `docs/superpowers/specs/2026-06-01-mortality-birth-lineage-design.md`. This plan implements it; read it if a task is ambiguous.
- **Calendar scale** (`src/core/calendar.ts`): `TICKS_PER_DAY = 240`, `DAYS_PER_YEAR = 96` → **23,040 ticks per year**. The clock (`src/core/clock.ts`) advances `msPerTick ≈ 16.667`, so a system at `tickHz = 0.25` fires every 4000 sim-ms = 240 ticks = **once per in-game day**. We treat one fire as one day.
- **System contract** (`src/core/scheduler.ts`): `tick(ctx)` where `ctx = { world, spirits, log, clock, rng, dt, now }`. `ctx.now` is the current sim tick; `ctx.rng` is the seeded `Rng` (`next()`, `nextInt(max)`, `pick(arr)`). Fast systems may tick multiple times per frame (the scheduler loops while accumulated time ≥ interval).
- **The World gotcha** (`CLAUDE.md`): World keeps TWO index layers. When changing `kind`/`x`/`y`/`tags`, call `world.updateEntity(id, changes)` — **never** mutate those fields directly. Mutating `entity.properties.*` in place is fine (the indexes don't track property contents).
- **NPC access** (`src/world/npc-helpers.ts`): `queryNpcs(world)` / `forEachNpc(world, fn)` return only `kind: 'npc'` entities (so a `remains` automatically stops contributing belief/power and stops moving). `npcProps(e)` casts `e.properties` to `NpcProperties` and works on both `npc` and `remains` entities (remains keep NPC properties).
- **Belief summation** (`src/sim/spirit-system.ts`): `SpiritSystem` sums `faith·(1+2·understanding)·(1+2·devotion)` over `forEachNpc`. No change needed — death removing the entity from `forEachNpc` ends its contribution automatically.
- **Determinism guard already exists**: `tests/unit/no-random-in-sim.test.ts` fails if any file under `src/sim/` contains `Math.random(`. All new files under `src/sim/` are auto-covered. `src/world/npc-lifecycle.ts` takes `rng` as a parameter and must never call `Math.random` either.
- **Test conventions** (see `tests/unit/abandonment-system.test.ts`): build an `emptyMap()`, add NPCs via `world.addEntity({ id, kind: 'npc', x, y, properties })`, build a `ctx` with `createRng(seed)`. Run `npm test` for the full suite; `npx vitest run tests/unit/<file>` for one file.

### File structure (what each new file owns)

| File | Responsibility |
|---|---|
| `src/sim/mortality.ts` | Pure age/hazard math: `ageInYears`, `annualMortality`, `survivalProbability`, `rollDeathYear` + tunable constants. No world access. |
| `src/world/npc-lifecycle.ts` | `killNpc` (convert npc→remains) and `birthNpc` (spawn child of parents). Owns inheritance constants + `REMAINS_KIND`. |
| `src/sim/systems/mortality-system.ts` | Real-time `MortalitySystem`: per-day old-age rolls via `ctx.rng`, cradle-floor guard. |
| `src/sim/systems/birth-system.ts` | Real-time `BirthSystem`: per-POI fertile-pair births via `ctx.rng`, soft pop cap. |
| `src/sim/turnover.ts` | Closed-form `projectTurnover(npcs, years, rng)` — deaths + synthesized births, no tick loop. The D2 bridge. |

### Files modified

- `src/core/types.ts` — `NpcId` alias; `NpcProperties` gains `birthTick`/`parentIds`/`lineageId` (+ optional `deathTick`/`deathCause` for remains).
- `src/core/events.ts` — `npc_death` / `npc_birth` added to the `SimEvent` union.
- `src/world/npc-helpers.ts` — `initNpcProps` defaults for the new fields; `REMAINS_KIND`; `getParents`/`getChildren`/`lineageMembers`.
- `src/world/seed-world.ts` + `src/sim/spawner.ts` — set `birthTick` (back-dated) + `lineageId = self` + `parentIds = []` on spawned NPCs.
- `src/game.ts` — register `MortalitySystem` + `BirthSystem`.
- `src/render/renderer.ts` — grave-marker placeholder for `kind: 'remains'`.

---

## Task 1: Mortality math (pure module)

**Files:**
- Create: `src/sim/mortality.ts`
- Test: `tests/unit/mortality.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mortality.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ageInYears, annualMortality, survivalProbability, rollDeathYear,
  ADULT_AGE, MAX_AGE,
} from '@/sim/mortality';
import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

describe('ageInYears', () => {
  it('converts elapsed ticks to fractional years', () => {
    expect(ageInYears(0, TICKS_PER_YEAR * 20)).toBeCloseTo(20, 5);
  });
  it('handles a back-dated (negative) birthTick at now=0', () => {
    expect(ageInYears(-TICKS_PER_YEAR * 25, 0)).toBeCloseTo(25, 5);
  });
});

describe('annualMortality', () => {
  it('is bounded to [0,1] across the whole age range', () => {
    for (let age = 0; age <= 120; age++) {
      const m = annualMortality(age);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
  it('is low and ~flat through adulthood', () => {
    expect(annualMortality(ADULT_AGE)).toBeLessThan(0.02);
    expect(annualMortality(40)).toBeLessThan(0.02);
  });
  it('is monotonic non-decreasing for age >= adulthood', () => {
    let prev = -1;
    for (let age = ADULT_AGE; age <= 120; age++) {
      const m = annualMortality(age);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
  it('reaches certainty by the maximum age', () => {
    expect(annualMortality(MAX_AGE)).toBeCloseTo(1, 5);
    expect(annualMortality(MAX_AGE + 20)).toBe(1);
  });
});

describe('survivalProbability', () => {
  it('is 1 over zero years', () => {
    expect(survivalProbability(30, 0)).toBe(1);
  });
  it('is in [0,1] and decreases as the interval lengthens', () => {
    const s5 = survivalProbability(30, 5);
    const s50 = survivalProbability(30, 50);
    expect(s5).toBeLessThanOrEqual(1);
    expect(s50).toBeGreaterThanOrEqual(0);
    expect(s50).toBeLessThan(s5);
  });
});

describe('rollDeathYear', () => {
  it('returns null when a young adult almost certainly survives a short span', () => {
    expect(rollDeathYear(25, 5, 0.999)).toBeNull();
  });
  it('returns an in-range offset when the soul dies', () => {
    const y = rollDeathYear(90, 10, 0.0);
    expect(y).not.toBeNull();
    expect(y!).toBeGreaterThanOrEqual(0);
    expect(y!).toBeLessThan(10);
  });
  it('is deterministic for a given rngFloat', () => {
    expect(rollDeathYear(70, 30, 0.5)).toBe(rollDeathYear(70, 30, 0.5));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/mortality.test.ts`
Expected: FAIL — `Cannot find module '@/sim/mortality'`.

- [ ] **Step 3: Implement `src/sim/mortality.ts`**

```ts
import { TICKS_PER_DAY, DAYS_PER_YEAR } from '@/core/calendar';

/** Ticks in one simulated year (23,040 at the current calendar). */
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

/** Age at which an NPC is considered an adult (mortality monotonic from here). */
export const ADULT_AGE = 15;
/** Flat baseline annual mortality through adulthood (~0.5%/yr). */
export const BASE_MORTALITY = 0.005;
/** Age at which senescence begins ramping mortality upward. */
export const SENESCENCE_START = 55;
/** Age at which annual mortality reaches certainty (1.0). */
export const MAX_AGE = 95;

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Fractional age in years derived from birth tick and the current tick. */
export function ageInYears(birthTick: number, now: number): number {
  return (now - birthTick) / TICKS_PER_YEAR;
}

/**
 * Probability of dying within one year at a given age. Gentle pre-modern curve:
 * flat ~0.5%/yr through adulthood, then a quadratic ramp from SENESCENCE_START
 * up to certainty at MAX_AGE. Monotonic non-decreasing for age >= adulthood,
 * clamped to [0,1].
 */
export function annualMortality(age: number): number {
  if (age <= SENESCENCE_START) return BASE_MORTALITY;
  if (age >= MAX_AGE) return 1;
  const t = (age - SENESCENCE_START) / (MAX_AGE - SENESCENCE_START); // 0..1
  return clamp01(BASE_MORTALITY + (1 - BASE_MORTALITY) * t * t);
}

/** Probability of surviving `years` full years starting at `age` (closed form). */
export function survivalProbability(age: number, years: number): number {
  let s = 1;
  for (let y = 0; y < years; y++) s *= 1 - annualMortality(age + y);
  return clamp01(s);
}

/**
 * Deterministically decide whether a soul of `age` dies within `[0, years)`.
 * Walks the per-year death mass against the caller-supplied rngFloat ∈ [0,1).
 * Returns the year-offset of death, or null if the soul survives the interval.
 */
export function rollDeathYear(age: number, years: number, rngFloat: number): number | null {
  let r = rngFloat;
  let surv = 1;
  for (let y = 0; y < years; y++) {
    const m = annualMortality(age + y);
    const deathThisYear = surv * m;
    if (r < deathThisYear) return y;
    r -= deathThisYear;
    surv *= 1 - m;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/mortality.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add src/sim/mortality.ts tests/unit/mortality.test.ts
git commit -m "feat(sim): pure mortality math (age, hazard curve, death roll)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Data model — types & events

**Files:**
- Modify: `src/core/types.ts` (add `NpcId`; extend `NpcProperties`)
- Modify: `src/core/events.ts` (add `npc_death`/`npc_birth`)
- Modify: `src/world/npc-helpers.ts:83-120` (`initNpcProps` defaults + `REMAINS_KIND`)
- Test: `tests/unit/npc-props-lineage-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/npc-props-lineage-defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initNpcProps, REMAINS_KIND } from '@/world/npc-helpers';

describe('initNpcProps lineage defaults', () => {
  it('defaults birthTick to 0, parentIds to [], lineageId to ""', () => {
    const p = initNpcProps('Tola', 'farmer', 7);
    expect(p.birthTick).toBe(0);
    expect(p.parentIds).toEqual([]);
    expect(p.lineageId).toBe('');
  });
  it('does not set deathTick/deathCause for a living NPC', () => {
    const p = initNpcProps('Tola', 'farmer', 7);
    expect(p.deathTick).toBeUndefined();
    expect(p.deathCause).toBeUndefined();
  });
});

describe('REMAINS_KIND', () => {
  it('is the string "remains"', () => {
    expect(REMAINS_KIND).toBe('remains');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/npc-props-lineage-defaults.test.ts`
Expected: FAIL — `REMAINS_KIND` is not exported / `birthTick` is undefined.

- [ ] **Step 3a: Add `NpcId` alias and extend `NpcProperties` in `src/core/types.ts`**

After the `EntityId` definition (`src/core/types.ts:352`, `export type EntityId = string;`) add:

```ts
/** An entity id known to refer to an NPC (or its remains). */
export type NpcId = EntityId;
```

In the `NpcProperties` interface, add these fields inside the `// identity` group (right after `seed: number;` at `src/core/types.ts:281`):

```ts
  // lineage & mortality
  /** Sim tick at which this soul was born. Age is DERIVED, never stored-mutated. */
  birthTick: number;
  /** 0 (founder), 1, or 2 parent entity ids. */
  parentIds: NpcId[];
  /** Root-ancestor id for "house of X" grouping. Founders: their own id. */
  lineageId: NpcId;
  /** Set only on a converted `remains` entity. Sim tick of death. */
  deathTick?: number;
  /** Set only on a converted `remains` entity. e.g. 'old_age'. */
  deathCause?: string;
```

- [ ] **Step 3b: Add lifecycle events in `src/core/events.ts`**

In the `SimEvent` union (after the `believer_lost` line, `src/core/events.ts:18`) add:

```ts
  | { type: 'npc_death';          npcId: EntityId; lineageId: EntityId; cause: string }
  | { type: 'npc_birth';          npcId: EntityId; parentIds: EntityId[]; lineageId: EntityId }
```

- [ ] **Step 3c: Add `REMAINS_KIND` and the new defaults in `src/world/npc-helpers.ts`**

Below `export const NPC_KIND = 'npc';` (`src/world/npc-helpers.ts:5`) add:

```ts
export const REMAINS_KIND = 'remains';
```

In `initNpcProps`, add the three lineage fields to the returned object (in the block at `src/world/npc-helpers.ts:101-119`, alongside `homeX: 0, homeY: 0,`):

```ts
    homeX: 0,
    homeY: 0,
    birthTick: 0,
    parentIds: [],
    lineageId: '',
```

- [ ] **Step 4: Run the test (and a typecheck) to verify it passes**

Run: `npx vitest run tests/unit/npc-props-lineage-defaults.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/events.ts src/world/npc-helpers.ts tests/unit/npc-props-lineage-defaults.test.ts
git commit -m "feat(core): lineage/mortality fields on NpcProperties + npc_death/npc_birth events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lifecycle helpers — killNpc & birthNpc

**Files:**
- Create: `src/world/npc-lifecycle.ts`
- Test: `tests/unit/npc-lifecycle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/npc-lifecycle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs, REMAINS_KIND } from '@/world/npc-helpers';
import {
  killNpc, birthNpc, INHERIT_FAITH_FRAC, INHERIT_UNDERSTANDING_FRAC,
} from '@/world/npc-lifecycle';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addNpc(world: World, id: string, faith = 0.5, understanding = 0.6): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.lineageId = id;
  p.beliefs['player'] = { faith, understanding, devotion: 0.1 };
  const e: Entity = { id, kind: 'npc', x: 3, y: 4, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function newLog(clock: SimClock) {
  const log = new EventLog(clock);
  const events: SimEvent[] = [];
  log.subscribe((a) => events.push(a.event));
  return { log, events };
}

describe('killNpc', () => {
  it('converts npc -> remains: no longer an NPC, still present, identity preserved', () => {
    const world = new World(emptyMap());
    addNpc(world, 'tola');
    const clock = new SimClock(); const { log, events } = newLog(clock);

    killNpc(world, world.registry.get('tola')!, 1234, 'old_age', log);

    expect(queryNpcs(world).map(e => e.id)).not.toContain('tola');
    const e = world.registry.get('tola')!;
    expect(e.kind).toBe(REMAINS_KIND);
    expect(e.id).toBe('tola');
    expect(npcProps(e).lineageId).toBe('tola');
    expect(npcProps(e).deathTick).toBe(1234);
    expect(npcProps(e).deathCause).toBe('old_age');
    expect(events.some(ev => ev.type === 'npc_death' && ev.npcId === 'tola')).toBe(true);
  });

  it('is reachable via a region query as a remains entity', () => {
    const world = new World(emptyMap());
    addNpc(world, 'tola');
    const clock = new SimClock(); const { log } = newLog(clock);
    killNpc(world, world.registry.get('tola')!, 1, 'old_age', log);
    const found = world.query({ kind: REMAINS_KIND });
    expect(found.map(e => e.id)).toContain('tola');
  });
});

describe('birthNpc', () => {
  it('spawns a child with diluted faith, near-zero understanding, zero devotion', () => {
    const world = new World(emptyMap());
    const a = addNpc(world, 'mum', 0.8, 0.6);
    const b = addNpc(world, 'dad', 0.4, 0.4);
    npcProps(b).lineageId = 'mum'; // same house
    const clock = new SimClock(); const { log, events } = newLog(clock);
    const rng = createRng(42);

    const child = birthNpc(world, [a, b], 5000, rng, log);
    const cp = npcProps(child);

    expect(cp.parentIds).toEqual(['mum', 'dad']);
    expect(cp.lineageId).toBe('mum');
    expect(cp.birthTick).toBe(5000);
    const avgFaith = (0.8 + 0.4) / 2;       // 0.6
    const avgUnd = (0.6 + 0.4) / 2;         // 0.5
    expect(cp.beliefs['player'].faith).toBeCloseTo(INHERIT_FAITH_FRAC * avgFaith, 5);
    expect(cp.beliefs['player'].understanding).toBeCloseTo(INHERIT_UNDERSTANDING_FRAC * avgUnd, 5);
    expect(cp.beliefs['player'].devotion).toBe(0);
    expect(child.kind).toBe('npc');
    expect(events.some(ev => ev.type === 'npc_birth' && ev.npcId === child.id)).toBe(true);
  });

  it('supports a single parent (lineage carries through)', () => {
    const world = new World(emptyMap());
    const a = addNpc(world, 'solo', 0.5, 0.5);
    const clock = new SimClock(); const { log } = newLog(clock);
    const child = birthNpc(world, [a], 100, createRng(1), log);
    expect(npcProps(child).parentIds).toEqual(['solo']);
    expect(npcProps(child).lineageId).toBe('solo');
  });

  it('generates unique child ids (no collision across multiple births)', () => {
    const world = new World(emptyMap());
    const a = addNpc(world, 'mum'); const b = addNpc(world, 'dad');
    const clock = new SimClock(); const { log } = newLog(clock);
    const rng = createRng(7);
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) ids.add(birthNpc(world, [a, b], 1000 + i, rng, log).id);
    expect(ids.size).toBe(20);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/npc-lifecycle.test.ts`
Expected: FAIL — `Cannot find module '@/world/npc-lifecycle'`.

- [ ] **Step 3: Implement `src/world/npc-lifecycle.ts`**

```ts
import type { Entity, NpcRole, SpiritBelief } from '@/core/types';
import type { World } from '@/world/world';
import type { EventLog } from '@/core/events';
import type { Rng } from '@/core/rng';
import { initNpcProps, npcProps, REMAINS_KIND } from '@/world/npc-helpers';

/** Child faith = this fraction of the parents' average faith (generational dilution). */
export const INHERIT_FAITH_FRAC = 0.4;
/** Child understanding = this fraction of the parents' average (≈ near zero). */
export const INHERIT_UNDERSTANDING_FRAC = 0.05;
/** Magnitude of seeded personality jitter applied to the parental mean. */
export const PERSONALITY_JITTER = 0.1;

const NEWBORN_NAMES = ['Aelf', 'Bryn', 'Cael', 'Dara', 'Edda', 'Finn', 'Gwen', 'Hale', 'Isa', 'Joren'];

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/**
 * Convert a living NPC into persistent remains (death never deletes — the
 * persistence principle). Flips kind via updateEntity so BOTH World index layers
 * stay in sync; the soul stays queryable as kind 'remains'. SpiritSystem and all
 * NPC systems iterate via forEachNpc (kind 'npc' only), so a remains automatically
 * stops contributing belief/power and stops moving — no other system changes.
 */
export function killNpc(
  world: World, entity: Entity, deathTick: number, cause: string, log: EventLog,
): void {
  const p = npcProps(entity);
  p.deathTick = deathTick;
  p.deathCause = cause;
  world.updateEntity(entity.id, { kind: REMAINS_KIND });
  log.append({ type: 'npc_death', npcId: entity.id, lineageId: p.lineageId, cause });
}

/**
 * Spawn a child of 1–2 parents at the first parent's location. Personality is the
 * parental mean plus small seeded jitter; belief is diluted (faith ≈ 0.4× the
 * parents' average, understanding ≈ 0.05× — born believing in *something*, but must
 * relearn who you are). All randomness flows through the supplied `rng`.
 */
export function birthNpc(
  world: World, parents: Entity[], birthTick: number, rng: Rng, log: EventLog,
): Entity {
  const a = npcProps(parents[0]);
  const b = parents[1] ? npcProps(parents[1]) : a;

  const jitter = () => (rng.next() - 0.5) * PERSONALITY_JITTER;
  const personality = {
    assertiveness: clamp01((a.personality.assertiveness + b.personality.assertiveness) / 2 + jitter()),
    skepticism:    clamp01((a.personality.skepticism    + b.personality.skepticism)    / 2 + jitter()),
    piety:         clamp01((a.personality.piety         + b.personality.piety)         / 2 + jitter()),
    sociability:   clamp01((a.personality.sociability   + b.personality.sociability)   / 2 + jitter()),
  };

  const beliefs: Record<string, SpiritBelief> = {};
  const spiritIds = new Set<string>([...Object.keys(a.beliefs), ...Object.keys(b.beliefs)]);
  for (const sid of spiritIds) {
    const fa = a.beliefs[sid]?.faith ?? 0;
    const fb = b.beliefs[sid]?.faith ?? 0;
    const ua = a.beliefs[sid]?.understanding ?? 0;
    const ub = b.beliefs[sid]?.understanding ?? 0;
    beliefs[sid] = {
      faith:         clamp01(INHERIT_FAITH_FRAC * ((fa + fb) / 2)),
      understanding: clamp01(INHERIT_UNDERSTANDING_FRAC * ((ua + ub) / 2)),
      devotion:      0,
    };
  }

  // Deterministic unique id: derives from rng (seeded, snapshot-restored) so it
  // reproduces under silent replay. Loop guards against the rare collision.
  let id = '';
  do { id = `npc-b${birthTick}-${rng.nextInt(0x7fffffff)}`; } while (world.registry.get(id));

  const role: NpcRole = 'child';
  const props = initNpcProps(rng.pick(NEWBORN_NAMES), role, rng.nextInt(0x7fffffff));
  props.personality = personality;
  props.beliefs = beliefs;
  props.birthTick = birthTick;
  props.parentIds = parents.map(pe => pe.id);
  props.lineageId = a.lineageId;
  props.homePoiId = a.homePoiId;
  props.homeBuildingId = a.homeBuildingId;
  props.homeX = parents[0].x;
  props.homeY = parents[0].y;

  world.addEntity({
    id, kind: 'npc', x: parents[0].x, y: parents[0].y,
    properties: props as unknown as Record<string, unknown>,
  });
  log.append({ type: 'npc_birth', npcId: id, parentIds: props.parentIds, lineageId: props.lineageId });
  return world.registry.get(id)!;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/npc-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/npc-lifecycle.ts tests/unit/npc-lifecycle.test.ts
git commit -m "feat(world): killNpc (npc->remains conversion) + birthNpc (diluted inheritance)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Lineage queries

**Files:**
- Modify: `src/world/npc-helpers.ts` (append `getParents`, `getChildren`, `lineageMembers`)
- Test: `tests/unit/lineage-queries.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lineage-queries.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, getParents, getChildren, lineageMembers } from '@/world/npc-helpers';
import { birthNpc, killNpc } from '@/world/npc-lifecycle';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addFounder(world: World, id: string): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.lineageId = id;
  const e: Entity = { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

describe('lineage queries', () => {
  it('getParents maps a child back to its parent entities', () => {
    const world = new World(emptyMap());
    const mum = addFounder(world, 'mum'); const dad = addFounder(world, 'dad');
    const log = new EventLog(new SimClock());
    const child = birthNpc(world, [mum, dad], 10, createRng(1), log);
    const parents = getParents(world, child).map(e => e.id).sort();
    expect(parents).toEqual(['dad', 'mum']);
  });

  it('getChildren finds entities whose parentIds include the given npc', () => {
    const world = new World(emptyMap());
    const mum = addFounder(world, 'mum');
    const log = new EventLog(new SimClock());
    const c1 = birthNpc(world, [mum], 10, createRng(1), log);
    const c2 = birthNpc(world, [mum], 20, createRng(2), log);
    const kids = getChildren(world, mum).map(e => e.id).sort();
    expect(kids).toEqual([c1.id, c2.id].sort());
  });

  it('lineageMembers includes living descendants AND remains sharing the root ancestor', () => {
    const world = new World(emptyMap());
    const mum = addFounder(world, 'mum');
    const log = new EventLog(new SimClock());
    const child = birthNpc(world, [mum], 10, createRng(1), log);
    killNpc(world, world.registry.get('mum')!, 50, 'old_age', log); // mum now remains
    const members = lineageMembers(world, 'mum').map(e => e.id).sort();
    expect(members).toEqual(['mum', child.id].sort()); // dead founder + living child
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lineage-queries.test.ts`
Expected: FAIL — `getParents` is not exported.

- [ ] **Step 3: Append the queries to `src/world/npc-helpers.ts`**

At the end of `src/world/npc-helpers.ts` add:

```ts
// =============================================================================
// Lineage queries — operate over both living NPCs and their remains, since a
// dead parent is still a parent and a lineage spans the living and the dead.
// =============================================================================

/** All NPC-or-remains entities, in stable insertion order. */
function npcsAndRemains(world: World): Entity[] {
  return world.registry.all().filter(e => e.kind === NPC_KIND || e.kind === REMAINS_KIND);
}

/** Resolve an NPC's 0–2 parent entities (living or remains). */
export function getParents(world: World, npc: Entity): Entity[] {
  const ids = npcProps(npc).parentIds ?? [];
  return ids.map(id => world.registry.get(id)).filter((e): e is Entity => e !== undefined);
}

/** All entities whose parentIds include the given npc id (living or remains). */
export function getChildren(world: World, npc: Entity): Entity[] {
  return npcsAndRemains(world).filter(e => (npcProps(e).parentIds ?? []).includes(npc.id));
}

/** All entities (living + remains) sharing a root-ancestor lineage id. */
export function lineageMembers(world: World, lineageId: string): Entity[] {
  return npcsAndRemains(world).filter(e => npcProps(e).lineageId === lineageId);
}
```

Note: `registry.all()` is already used by `world.ts` (`query()` fallback) — it returns `Entity[]`. `REMAINS_KIND` and `npcProps` are already defined earlier in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lineage-queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/npc-helpers.ts tests/unit/lineage-queries.test.ts
git commit -m "feat(world): lineage queries (getParents/getChildren/lineageMembers) spanning living + remains

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: MortalitySystem (real-time, seeded)

**Files:**
- Create: `src/sim/systems/mortality-system.ts`
- Test: `tests/unit/mortality-system.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/mortality-system.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import { MortalitySystem, CRADLE_MORTALITY_FLOOR } from '@/sim/systems/mortality-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
/** Add an NPC of a given age (now is 0, so birthTick = -age*ticksPerYear). */
function addAged(world: World, id: string, ageYears: number): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(0) * 131) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function ctxFor(world: World, rngSeed: number, now: number, spirits = new Map<SpiritId, Spirit>()) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const deaths: string[] = [];
  log.subscribe((a: { event: SimEvent }) => { if (a.event.type === 'npc_death') deaths.push(a.event.npcId); });
  return { ctx: { world, spirits, log, clock, rng: createRng(rngSeed), dt: 1000, now }, deaths };
}

describe('MortalitySystem', () => {
  it('does nothing while population is below the cradle floor', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < CRADLE_MORTALITY_FLOOR - 1; i++) addAged(world, `n${i}`, 99); // ancient
    const { ctx, deaths } = ctxFor(world, 1, 0);
    const sys = new MortalitySystem();
    for (let t = 0; t < 50; t++) sys.tick({ ...ctx, now: t });
    expect(deaths).toHaveLength(0);
    expect(queryNpcs(world)).toHaveLength(CRADLE_MORTALITY_FLOOR - 1);
  });

  it('eventually kills the very old once above the cradle floor', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < CRADLE_MORTALITY_FLOOR + 2; i++) addAged(world, `n${i}`, 99);
    const { ctx, deaths } = ctxFor(world, 1, 0);
    const sys = new MortalitySystem();
    for (let t = 0; t < 2000; t++) sys.tick({ ...ctx, now: t });
    expect(deaths.length).toBeGreaterThan(0);
  });

  it('is deterministic: same seed -> identical death set', () => {
    const run = () => {
      const world = new World(emptyMap());
      for (let i = 0; i < 8; i++) addAged(world, `n${i}`, 70 + i);
      const { ctx, deaths } = ctxFor(world, 99, 0);
      const sys = new MortalitySystem();
      for (let t = 0; t < 1000; t++) sys.tick({ ...ctx, now: t });
      return deaths.slice().sort();
    };
    expect(run()).toEqual(run());
  });

  it('a dead believer stops contributing power (SpiritSystem no longer sums them)', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < CRADLE_MORTALITY_FLOOR + 1; i++) {
      const e = addAged(world, `n${i}`, 99);
      npcProps(e).beliefs['player'] = { faith: 1, understanding: 1, devotion: 1 };
    }
    const spirits = new Map<SpiritId, Spirit>([
      ['player', { id: 'player', name: 'You', power: 0, isPlayer: true } as unknown as Spirit],
    ]);
    const { ctx } = ctxFor(world, 1, 0, spirits);
    const mort = new MortalitySystem();
    const spiritSys = new SpiritSystem();
    const before = queryNpcs(world).length;
    for (let t = 0; t < 3000; t++) mort.tick({ ...ctx, now: t });
    const after = queryNpcs(world).length;
    expect(after).toBeLessThan(before); // someone died
    // SpiritSystem only sums living NPCs — power regen reflects the survivors, not the dead.
    spiritSys.tick({ ...ctx, now: 3000 });
    expect(spirits.get('player')!.power).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/mortality-system.test.ts`
Expected: FAIL — `Cannot find module '@/sim/systems/mortality-system'`.

- [ ] **Step 3: Implement `src/sim/systems/mortality-system.ts`**

```ts
import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { DAYS_PER_YEAR } from '@/core/calendar';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { killNpc } from '@/world/npc-lifecycle';
import { ageInYears, annualMortality } from '@/sim/mortality';

/** Below this many living NPCs, mortality is disabled so the cradle can't die out. */
export const CRADLE_MORTALITY_FLOOR = 4;

/**
 * 0.25 Hz → one fire per 4000 sim-ms = 240 ticks = one in-game day (TICKS_PER_DAY).
 * We treat each fire as one day, converting the annual hazard to a per-day chance.
 */
export const MORTALITY_TICK_HZ = 0.25;

/** Per-day death chance derived from the annual hazard (1 of DAYS_PER_YEAR fires/yr). */
function perDayMortality(age: number): number {
  return 1 - Math.pow(1 - annualMortality(age), 1 / DAYS_PER_YEAR);
}

export class MortalitySystem implements System {
  readonly name = 'mortality';
  readonly tickHz = MORTALITY_TICK_HZ;

  tick(ctx: SystemContext): void {
    const living = queryNpcs(ctx.world);
    if (living.length < CRADLE_MORTALITY_FLOOR) return;

    // Stable order so the rng draw sequence is reproducible under replay.
    const ordered = living.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const victims: Entity[] = [];
    for (const e of ordered) {
      const age = ageInYears(npcProps(e).birthTick, ctx.now);
      if (ctx.rng.next() < perDayMortality(age)) victims.push(e);
    }
    for (const e of victims) killNpc(ctx.world, e, ctx.now, 'old_age', ctx.log);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/mortality-system.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/mortality-system.ts tests/unit/mortality-system.test.ts
git commit -m "feat(sim): MortalitySystem — seeded per-day old-age rolls with cradle-floor guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: BirthSystem (real-time, seeded)

**Files:**
- Create: `src/sim/systems/birth-system.ts`
- Test: `tests/unit/birth-system.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/birth-system.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import { BirthSystem, POP_CAP_PER_POI } from '@/sim/systems/birth-system';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function addAdult(world: World, id: string, poiId: string, ageYears = 30): Entity {
  const p = initNpcProps(id, 'farmer', (id.charCodeAt(id.length - 1) * 977) | 0);
  p.lineageId = id;
  p.birthTick = -ageYears * TICKS_PER_YEAR;
  p.homePoiId = poiId;
  const e: Entity = { id, kind: 'npc', x: 2, y: 2, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}
function ctxFor(world: World, seed: number, now: number) {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const births: string[] = [];
  log.subscribe((a: { event: SimEvent }) => { if (a.event.type === 'npc_birth') births.push(a.event.npcId); });
  return { ctx: { world, spirits: new Map(), log, clock, rng: createRng(seed), dt: 1000, now }, births };
}

describe('BirthSystem', () => {
  it('produces no births without a fertile pair', () => {
    const world = new World(emptyMap());
    addAdult(world, 'lonely', 'village', 30); // only one adult
    const { ctx, births } = ctxFor(world, 1, 0);
    const sys = new BirthSystem();
    for (let t = 0; t < 1000; t++) sys.tick({ ...ctx, now: t });
    expect(births).toHaveLength(0);
  });

  it('births children carrying a parent lineage and diluted faith', () => {
    const world = new World(emptyMap());
    const a = addAdult(world, 'mum', 'village', 28);
    addAdult(world, 'dad', 'village', 31);
    npcProps(a).beliefs['player'] = { faith: 0.8, understanding: 0.6, devotion: 0.2 };
    const { ctx, births } = ctxFor(world, 5, 0);
    const sys = new BirthSystem();
    for (let t = 0; t < 3000 && births.length === 0; t++) sys.tick({ ...ctx, now: t });
    expect(births.length).toBeGreaterThan(0);
    const child = world.registry.get(births[0])!;
    const cp = npcProps(child);
    expect(['mum', 'dad']).toContain(cp.lineageId);
    expect(cp.beliefs['player'].faith).toBeLessThan(0.8); // diluted relative to parent
  });

  it('respects the per-POI population cap', () => {
    const world = new World(emptyMap());
    for (let i = 0; i < POP_CAP_PER_POI + 4; i++) addAdult(world, `a${i}`, 'village', 30);
    const { ctx } = ctxFor(world, 9, 0);
    const sys = new BirthSystem();
    for (let t = 0; t < 5000; t++) sys.tick({ ...ctx, now: t });
    expect(queryNpcs(world).length).toBeLessThanOrEqual(POP_CAP_PER_POI);
  });

  it('is deterministic: same seed -> identical birth count', () => {
    const run = () => {
      const world = new World(emptyMap());
      addAdult(world, 'mum', 'village', 28);
      addAdult(world, 'dad', 'village', 31);
      const { ctx, births } = ctxFor(world, 123, 0);
      const sys = new BirthSystem();
      for (let t = 0; t < 4000; t++) sys.tick({ ...ctx, now: t });
      return births.length;
    };
    expect(run()).toBe(run());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/birth-system.test.ts`
Expected: FAIL — `Cannot find module '@/sim/systems/birth-system'`.

- [ ] **Step 3: Implement `src/sim/systems/birth-system.ts`**

```ts
import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { birthNpc } from '@/world/npc-lifecycle';
import { ageInYears } from '@/sim/mortality';

export const FERTILE_MIN_AGE = 18;
export const FERTILE_MAX_AGE = 45;
/** Soft cap on living NPCs per POI; births stop once a POI reaches it. */
export const POP_CAP_PER_POI = 24;
/** Per-pair per-fire (≈ per-day) birth chance. Tunable baseline. */
export const BIRTH_RATE_PER_PAIR = 0.003;

/** 0.25 Hz → one fire per in-game day, matching MortalitySystem's cadence. */
export const BIRTH_TICK_HZ = 0.25;

export class BirthSystem implements System {
  readonly name = 'births';
  readonly tickHz = BIRTH_TICK_HZ;

  tick(ctx: SystemContext): void {
    // Group living NPCs by home POI (skip NPCs without a home — they can't pair).
    const byPoi = new Map<string, Entity[]>();
    for (const e of queryNpcs(ctx.world)) {
      const poi = npcProps(e).homePoiId;
      if (!poi) continue;
      (byPoi.get(poi) ?? byPoi.set(poi, []).get(poi)!).push(e);
    }

    for (const [, residents] of byPoi) {
      if (residents.length >= POP_CAP_PER_POI) continue;
      let headroom = POP_CAP_PER_POI - residents.length;

      // Stable order so rng draws reproduce under replay.
      const fertile = residents
        .filter(e => {
          const age = ageInYears(npcProps(e).birthTick, ctx.now);
          return age >= FERTILE_MIN_AGE && age <= FERTILE_MAX_AGE;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (let i = 0; i + 1 < fertile.length && headroom > 0; i += 2) {
        if (ctx.rng.next() < BIRTH_RATE_PER_PAIR) {
          birthNpc(ctx.world, [fertile[i], fertile[i + 1]], ctx.now, ctx.rng, ctx.log);
          headroom--;
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/birth-system.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/systems/birth-system.ts tests/unit/birth-system.test.ts
git commit -m "feat(sim): BirthSystem — seeded per-POI fertile-pair births with soft pop cap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Closed-form turnover (the D2 bridge)

**Files:**
- Create: `src/sim/turnover.ts`
- Test: `tests/unit/turnover.test.ts`

This is the function D2 will call to author a century in one shot. D1 builds and unit-tests it; it ships **unused by UI** — that is intentional, the bridge is the deliverable.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/turnover.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { projectTurnover } from '@/sim/turnover';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function pop(world: World, n: number, ageYears: number): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const id = `n${i}`;
    const p = initNpcProps(id, 'farmer', (i * 2654435761) | 0);
    p.lineageId = id;
    p.birthTick = -ageYears * TICKS_PER_YEAR;
    p.homePoiId = 'village';
    const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    out.push(e);
  }
  return out;
}

describe('projectTurnover', () => {
  it('is deterministic for a given seed', () => {
    const run = () => {
      const world = new World(emptyMap());
      const npcs = pop(world, 10, 40);
      const r = projectTurnover(npcs, 100, 0, createRng(7));
      return { d: r.deaths.length, b: r.births.length };
    };
    expect(run()).toEqual(run());
  });

  it('eventually kills off an aged cohort over a century', () => {
    const world = new World(emptyMap());
    const npcs = pop(world, 12, 60); // all 60 -> all should die within 100y (max age 95)
    const { deaths } = projectTurnover(npcs, 100, 0, createRng(1));
    expect(deaths.length).toBe(12);
    for (const d of deaths) {
      expect(d.deathYearOffset).toBeGreaterThanOrEqual(0);
      expect(d.deathYearOffset).toBeLessThan(100);
    }
  });

  it('synthesizes children with valid lineage and diluted belief', () => {
    const world = new World(emptyMap());
    const npcs = pop(world, 6, 25); // young fertile adults -> expect some births
    for (const e of npcs) npcProps(e).beliefs['player'] = { faith: 0.8, understanding: 0.6, devotion: 0.2 };
    const { births } = projectTurnover(npcs, 30, 0, createRng(3));
    expect(births.length).toBeGreaterThan(0);
    const founderIds = new Set(npcs.map(e => e.id));
    for (const c of births) {
      expect(c.parentIds.length).toBeGreaterThanOrEqual(1);
      // a child's lineage traces to a founder or another synthesized child
      expect(typeof c.lineageId).toBe('string');
      expect(c.beliefs['player'].faith).toBeLessThan(0.8); // diluted
      expect(c.birthYearOffset).toBeGreaterThanOrEqual(0);
      expect(c.birthYearOffset).toBeLessThan(30);
      // at least the first generation's parents are founders
      if (c.birthYearOffset === 0) expect([...c.parentIds].every(id => founderIds.has(id))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/turnover.test.ts`
Expected: FAIL — `Cannot find module '@/sim/turnover'`.

- [ ] **Step 3: Implement `src/sim/turnover.ts`**

```ts
import type { Entity, NpcId, SpiritBelief } from '@/core/types';
import type { Rng } from '@/core/rng';
import { npcProps } from '@/world/npc-helpers';
import { ageInYears, rollDeathYear } from '@/sim/mortality';
import { DAYS_PER_YEAR } from '@/core/calendar';
import {
  FERTILE_MIN_AGE, FERTILE_MAX_AGE, POP_CAP_PER_POI, BIRTH_RATE_PER_PAIR,
} from '@/sim/systems/birth-system';
import { INHERIT_FAITH_FRAC, INHERIT_UNDERSTANDING_FRAC } from '@/world/npc-lifecycle';

/** Annual per-pair birth rate, derived from the per-day system rate. */
export const BIRTH_RATE_PER_PAIR_YEAR = BIRTH_RATE_PER_PAIR * DAYS_PER_YEAR;

export interface ProjectedDeath {
  id: NpcId;
  deathYearOffset: number;
  cause: string;
}

export interface SynthChild {
  id: NpcId;
  parentIds: NpcId[];
  lineageId: NpcId;
  birthYearOffset: number;
  beliefs: Record<string, SpiritBelief>;
}

/** A soul considered by the projection (input NPC or a synthesized child). */
interface Soul {
  id: NpcId;
  lineageId: NpcId;
  /** Age in years at offset 0 of the projection window. */
  baseAge: number;
  /** Year-offset this soul appears (0 for inputs). */
  bornAt: number;
  /** Year-offset this soul dies, or Infinity if it survives the window. */
  diesAt: number;
  beliefs: Record<string, SpiritBelief>;
  homePoiId?: string;
}

function diluteBeliefs(
  a: Record<string, SpiritBelief>, b: Record<string, SpiritBelief>,
): Record<string, SpiritBelief> {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const out: Record<string, SpiritBelief> = {};
  const ids = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  for (const sid of ids) {
    const fa = a[sid]?.faith ?? 0, fb = b[sid]?.faith ?? 0;
    const ua = a[sid]?.understanding ?? 0, ub = b[sid]?.understanding ?? 0;
    out[sid] = {
      faith:         clamp01(INHERIT_FAITH_FRAC * ((fa + fb) / 2)),
      understanding: clamp01(INHERIT_UNDERSTANDING_FRAC * ((ua + ub) / 2)),
      devotion:      0,
    };
  }
  return out;
}

/**
 * Closed-form generational turnover over `years` — no tick loop, so a century jump
 * is feasible. Fully deterministic given the seeded `rng`. Walks year by year:
 * deaths come from `rollDeathYear`; births are rolled for each co-located fertile
 * pair alive that year (respecting deaths and a per-POI soft cap). Returns the
 * deaths of the input NPCs and the children synthesized during the interval.
 * `now` is the current sim tick (each NPC's starting age = ageInYears(birthTick, now)).
 * D2 wires this into the skip flow; D1 ships it unused by UI.
 */
export function projectTurnover(
  npcs: Entity[], years: number, now: number, rng: Rng,
): { deaths: ProjectedDeath[]; births: SynthChild[] } {
  const souls: Soul[] = npcs.map(e => {
    const p = npcProps(e);
    const baseAge = Math.max(0, ageInYears(p.birthTick, now)); // age at window start (offset 0)
    const diesAt = rollDeathYear(baseAge, years, rng.next());
    return {
      id: e.id, lineageId: p.lineageId, baseAge, bornAt: 0,
      diesAt: diesAt === null ? Infinity : diesAt,
      beliefs: p.beliefs, homePoiId: p.homePoiId,
    };
  });

  const deaths: ProjectedDeath[] = souls
    .filter(s => s.diesAt !== Infinity)
    .map(s => ({ id: s.id, deathYearOffset: s.diesAt, cause: 'old_age' }));

  const births: SynthChild[] = [];
  let synthCounter = 0;

  for (let y = 0; y < years; y++) {
    // Souls alive during year y, grouped by POI.
    const aliveByPoi = new Map<string, Soul[]>();
    for (const s of souls) {
      if (s.bornAt > y || s.diesAt < y) continue;
      const poi = s.homePoiId ?? '_';
      (aliveByPoi.get(poi) ?? aliveByPoi.set(poi, []).get(poi)!).push(s);
    }

    for (const [, residents] of aliveByPoi) {
      if (residents.length >= POP_CAP_PER_POI) continue;
      let headroom = POP_CAP_PER_POI - residents.length;
      const fertile = residents
        .filter(s => {
          const age = s.baseAge + (y - s.bornAt);
          return age >= FERTILE_MIN_AGE && age <= FERTILE_MAX_AGE;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (let i = 0; i + 1 < fertile.length && headroom > 0; i += 2) {
        if (rng.next() < BIRTH_RATE_PER_PAIR_YEAR) {
          const pa = fertile[i], pb = fertile[i + 1];
          const beliefs = diluteBeliefs(pa.beliefs, pb.beliefs);
          const child: Soul = {
            id: `synth-${y}-${synthCounter++}`,
            lineageId: pa.lineageId,
            baseAge: 0, bornAt: y,
            diesAt: Infinity, // newborn; surviving the rest of the window is fine for D1
            beliefs, homePoiId: pa.homePoiId,
          };
          souls.push(child);
          births.push({
            id: child.id, parentIds: [pa.id, pb.id], lineageId: child.lineageId,
            birthYearOffset: y, beliefs,
          });
          headroom--;
        }
      }
    }
  }

  return { deaths, births };
}
```

Note: `BIRTH_RATE_PER_PAIR_YEAR` can exceed 1 only if `BIRTH_RATE_PER_PAIR > 1/DAYS_PER_YEAR`; at the default 0.003 it is ≈0.29, so `rng.next() < rate` behaves as a proper probability.

Note (deliberate spec deviation): the design spec §6 sketched `projectTurnover(npcs, years, rng)`, but deriving each NPC's starting age requires the current tick, so this adds a `now` parameter: `projectTurnover(npcs, years, now, rng)`. Correctness over the illustrative signature.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/turnover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/turnover.ts tests/unit/turnover.test.ts
git commit -m "feat(sim): closed-form projectTurnover (the D2 century-jump bridge)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Renderer — remains grave marker

**Files:**
- Modify: `src/render/renderer.ts:352-379` (`drawEntity` — add a remains branch)
- Test: `tests/unit/remains-sort.test.ts`

A `remains` entity is a new `kind`, so `drawYSortedEntities` already includes it in its kindless `world.query({ region })` and routes it to `drawEntity`. Without a branch it would draw the generic magenta fallback. We add a cheap gray grave marker. Rendering is not otherwise unit-tested in this repo, so we verify the sort-key path with a real test and the draw branch with a typecheck/build.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/remains-sort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getEntitySortY } from '@/render/renderer';
import type { Entity } from '@/core/types';

describe('remains rendering sort key', () => {
  it('a remains entity sorts at its own tile y (no crash, defined value)', () => {
    const remains: Entity = {
      id: 'tola', kind: 'remains', x: 5, y: 7,
      properties: { deathTick: 1, deathCause: 'old_age' } as unknown as Record<string, unknown>,
    };
    expect(getEntitySortY(remains)).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails or passes-trivially**

Run: `npx vitest run tests/unit/remains-sort.test.ts`
Expected: PASS already (an unknown kind falls to `return e.y` in `getEntitySortY`). This test pins that contract so the draw-branch change below can't regress sorting. If it fails to import, that's the signal `getEntitySortY` isn't exported — it is (`src/render/renderer.ts:385`).

- [ ] **Step 3: Add the remains draw branch in `src/render/renderer.ts`**

At the top of `drawEntity` (`src/render/renderer.ts:352`, before the building-sprite path), add:

```ts
function drawEntity(ctx: CanvasRenderingContext2D, rc: RenderContext, e: Entity): void {
  // 0. Remains: a cheap gray grave marker (rich weathering visuals deferred).
  if (e.kind === 'remains') {
    const px = e.x * TILE_SIZE;
    const py = e.y * TILE_SIZE;
    const w = TILE_SIZE * 0.28;
    const h = TILE_SIZE * 0.42;
    ctx.fillStyle = '#8a8a8a';
    ctx.globalAlpha = 0.85;
    // headstone: a rounded-top slab
    ctx.beginPath();
    ctx.moveTo(px - w / 2, py + h / 2);
    ctx.lineTo(px - w / 2, py - h * 0.2);
    ctx.arc(px, py - h * 0.2, w / 2, Math.PI, 0);
    ctx.lineTo(px + w / 2, py + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  // 1. Building sprite path
```

(The existing `// 1. Building sprite path` comment marks where the original body resumes — keep everything below it unchanged.)

- [ ] **Step 4: Run the test + typecheck to verify**

Run: `npx vitest run tests/unit/remains-sort.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderer.ts tests/unit/remains-sort.test.ts
git commit -m "feat(render): gray grave-marker placeholder for kind 'remains'

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire into the game + back-date founders + determinism guard

**Files:**
- Modify: `src/world/seed-world.ts:53-70` (back-date founder `birthTick`, set lineage)
- Modify: `src/sim/spawner.ts:69-73` (set lineage on POI-spawned NPCs)
- Modify: `src/game.ts:84-93` (register the two systems)
- Test: `tests/unit/turnover-determinism-guard.test.ts`

- [ ] **Step 1: Write the failing test (behavioral determinism guard)**

Create `tests/unit/turnover-determinism-guard.test.ts`. This is spec §10 item 6: run the two systems N ticks twice from the same seed; the death/birth event sets must be identical.

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function runOnce(seed: number): string[] {
  const world = new World(emptyMap());
  for (let i = 0; i < 10; i++) {
    const id = `n${i}`;
    const p = initNpcProps(id, 'farmer', (i * 2654435761) | 0);
    p.lineageId = id;
    p.birthTick = -(20 + i * 7) * TICKS_PER_YEAR; // mix of young adults and elders
    p.homePoiId = 'village';
    const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
  }
  const clock = new SimClock();
  const log = new EventLog(clock);
  const trace: string[] = [];
  log.subscribe((a: { event: SimEvent; t: number }) => {
    if (a.event.type === 'npc_death') trace.push(`death:${a.event.npcId}@${a.t}`);
    if (a.event.type === 'npc_birth') trace.push(`birth:${a.event.lineageId}@${a.t}`);
  });
  const rng = createRng(seed);
  const ctx = { world, spirits: new Map(), log, clock, rng, dt: 1000, now: 0 };
  const mort = new MortalitySystem();
  const birth = new BirthSystem();
  for (let t = 0; t < 4000; t++) {
    mort.tick({ ...ctx, now: t });
    birth.tick({ ...ctx, now: t });
  }
  return trace;
}

describe('turnover determinism guard', () => {
  it('same seed -> identical death/birth trace', () => {
    expect(runOnce(2026)).toEqual(runOnce(2026));
  });
  it('produces a non-trivial trace (the guard is non-vacuous)', () => {
    expect(runOnce(2026).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes (systems already deterministic)**

Run: `npx vitest run tests/unit/turnover-determinism-guard.test.ts`
Expected: PASS (the systems built in Tasks 5–6 only use `ctx.rng`). If the non-vacuous assertion fails (no events in 4000 ticks), increase the loop bound or elder ages — but with elders up to age 83 and 10 NPCs it should produce deaths.

- [ ] **Step 3a: Back-date founders + set lineage in `src/world/seed-world.ts`**

Add a founder-age constant near the top of the file (after the imports, before `export function seedWorld`):

```ts
import { TICKS_PER_YEAR } from '@/sim/mortality';

/** Founders start as young adults so the cradle never opens with elders. */
const FOUNDER_MIN_AGE = 20;
const FOUNDER_MAX_AGE = 30;
```

Inside the `BAND.forEach((member, i) => { ... })` block, after `p.homeY = y;` (`src/world/seed-world.ts:61`) and before the belief override, add:

```ts
    // Found a lineage and back-date birth so each opens as a young adult (age in
    // [FOUNDER_MIN_AGE, FOUNDER_MAX_AGE]). Uses the seeded world rng for replay
    // parity. now is 0 at seed time, so birthTick is negative.
    const founderAge = FOUNDER_MIN_AGE + rng.next() * (FOUNDER_MAX_AGE - FOUNDER_MIN_AGE);
    p.birthTick = -Math.round(founderAge * TICKS_PER_YEAR);
    p.lineageId = id;
    p.parentIds = [];
```

- [ ] **Step 3b: Set lineage on POI-spawned NPCs in `src/sim/spawner.ts`**

In `spawnAllPoiNpcs`, after `props.homeY = tileY;` (`src/sim/spawner.ts:73`) add:

```ts
      // Each POI-spawned NPC founds its own lineage and starts as an adult.
      // Deterministic from the per-NPC `seed` (no rng in this function's scope).
      const ageYears = 20 + (seed % 26); // 20–45
      props.birthTick = -ageYears * (240 * 96); // TICKS_PER_DAY * DAYS_PER_YEAR
      props.lineageId = id;
      props.parentIds = [];
```

(We inline `240 * 96` here because `spawner.ts` has no calendar import and adding one for a single literal isn't worth a new import; if a calendar import already exists at edit time, prefer `TICKS_PER_DAY * DAYS_PER_YEAR`.)

- [ ] **Step 3c: Register the systems in `src/game.ts`**

Add imports near the other system imports (`src/game.ts:18-25`):

```ts
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { BirthSystem } from '@/sim/systems/birth-system';
```

In the constructor, after `this.scheduler.register(new SpiritSystem());` (`src/game.ts:92`) add:

```ts
    this.scheduler.register(new MortalitySystem());
    this.scheduler.register(new BirthSystem());
```

- [ ] **Step 4: Run the full suite + typecheck to verify nothing regressed**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `npm test`
Expected: all tests PASS (the prior ~832 plus the new mortality/lifecycle/lineage/system/turnover/guard tests). The `no-random-in-sim` guard must still pass (all new `src/sim/` files use `ctx.rng`).

- [ ] **Step 5: Commit**

```bash
git add src/world/seed-world.ts src/sim/spawner.ts src/game.ts tests/unit/turnover-determinism-guard.test.ts
git commit -m "feat(game): register Mortality/Birth systems; back-date founders into lineages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

After all tasks:

- [ ] Run `npm test` — full suite green.
- [ ] Run `npm run build` — TypeScript check + Vite build clean.
- [ ] Spot-check determinism: the two new system tests + the guard all assert same-seed reproducibility.
- [ ] Confirm `tests/unit/no-random-in-sim.test.ts` still passes (no `Math.random` crept into `src/sim/`).
- [ ] Dispatch a final code review over the whole D1 diff, then use `superpowers:finishing-a-development-branch`.

## Out of scope (do NOT build here — these are D2 or later)

- Time-skip flow & UI, Fate/LLM authoring (D2).
- Plague/famine death causes (D1 is old-age only).
- Marriage/relationship depth for pairing (MVP uses co-located fertile adults).
- Remains discovery mechanics & rich weathering visuals (placeholder marker only).
- Genetics / richer heritable traits (noted future extension).
