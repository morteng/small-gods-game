# Fate Amplification Levers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two declared-but-unimplemented Fate authoring verbs `bias_event` and `nudge_severity`, giving the autonomous Fate brain immediate sim-layer levers to amplify (or ease) a settlement's troubles beyond `inject_npc`.

**Architecture:** Both verbs apply immediately via the command queue (`source:'fate'`) — not staged-until-discovery. `nudge_severity` mutates active event severity in `world.activeEvents`; `bias_event` writes a one-shot forced-next-event onto new persistent state `world.forcedEvents`, consumed by `SettlementEventSystem`. The Fate brain reaches them through two new immediate tools; `parseFateToolCalls` returns `{ beats, commands }` and the brain emits commands onto the queue. Verb effects are pure mutations (no RNG) so the `no-random-in-sim` guard is unaffected.

**Tech Stack:** TypeScript ES modules, Vitest, `@/` → `src/` alias. Spec: `docs/superpowers/specs/2026-06-04-fate-amplify-levers-design.md`.

**Branch:** `fate-amplify-levers` (already created).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/world/world.ts` | World entity model + per-POI maps | Add `forcedEvents` map |
| `src/core/snapshot.ts` | Snapshot capture/restore | Round-trip `forcedEvents` (tolerant restore) |
| `src/sim/command/authoring-verbs.ts` | Fate authoring-verb effects | Add `bias_event` + `nudge_severity` effects |
| `src/sim/command/registry.ts` | Capability registry | Flip both verbs to `implemented`, wire pre/apply |
| `src/sim/systems/settlement-event-system.ts` | Per-POI event rolling | Consume `world.forcedEvents` before probability roll |
| `src/game/fate/fate-tools.ts` | LLM tool seam | Two new tools; `parseFateToolCalls` → `{ beats, commands }` |
| `src/game/fate/fate-context.ts` | Fate prompt builder | Enrich thread lines w/ active event; broaden charter |
| `src/game/fate/fate-brain-service.ts` | Autonomous producer | `emitCommand` dep; emit commands + arm beats |
| `src/game.ts` | Coordinator wiring | Pass `emitCommand: cmd => commandQueue.emit(cmd)` |

Test files: `tests/unit/snapshot*.test.ts` (forcedEvents), `tests/unit/authoring-verbs.test.ts`, `tests/unit/settlement-event-system.test.ts` (create if absent), `tests/unit/fate-tools.test.ts` (migrate), `tests/unit/fate-context.test.ts`, `tests/unit/fate-brain-service.test.ts` (migrate), `tests/unit/fate-amplify-integration.test.ts` (new).

---

## Task 1: `world.forcedEvents` + snapshot round-trip

**Files:**
- Modify: `src/world/world.ts:19-20`
- Modify: `src/core/snapshot.ts:10-28` (Snapshot type), `:39-56` (capture), `:78-81` (restore)
- Test: `tests/unit/snapshot-forced-events.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/snapshot-forced-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { EventLog } from '@/core/events';
import { captureSnapshot, restoreSnapshot, type Snapshot } from '@/core/snapshot';
import type { GameMap, Tile } from '@/core/types';
import type { GameState } from '@/core/state';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(): GameState {
  const m = map();
  return {
    world: new World(m), map: m, clock: new SimClock(), rng: createRng(1),
    eventLog: new EventLog(), spirits: new Map(),
    plotThreads: new PlotThreadStore(), staging: new StagingBuffer(),
  } as unknown as GameState;
}

describe('snapshot forcedEvents', () => {
  it('round-trips world.forcedEvents through capture/restore', () => {
    const state = makeState();
    state.world.forcedEvents.set('poi1', 'plague');
    const snap = captureSnapshot(state);
    state.world.forcedEvents.clear();          // mutate away after capture
    restoreSnapshot(state, snap);
    expect([...state.world.forcedEvents]).toEqual([['poi1', 'plague']]);
  });

  it('tolerates a snapshot with no forcedEvents field (older save)', () => {
    const state = makeState();
    state.world.forcedEvents.set('poi1', 'drought');
    const snap = captureSnapshot(state);
    delete (snap as Partial<Snapshot>).forcedEvents;   // simulate a pre-feature save
    restoreSnapshot(state, snap);
    expect(state.world.forcedEvents.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- snapshot-forced-events`
Expected: FAIL — `forcedEvents` does not exist on `World` / `Snapshot`.

- [ ] **Step 3: Add `forcedEvents` to World**

In `src/world/world.ts`, after the `activeEvents` declaration (line 20), add:

```ts
  /** Fate's one-shot forced next-event per POI (authoring verb bias_event). */
  readonly forcedEvents = new Map<string, import('@/core/types').SettlementEventType>();
```

- [ ] **Step 4: Round-trip it through the snapshot**

In `src/core/snapshot.ts`:

Add the import type (line 2 already imports from `@/core/types`; extend it):
```ts
import type { Entity, ActiveEvent, SettlementEventType } from '@/core/types';
```

Add to the `Snapshot` interface (after the `activeEvents` field, ~line 20):
```ts
  /** Fate's forced next-event per POI. Optional so older saves restore via `?? []`. */
  forcedEvents?: [string, SettlementEventType][];
```

In `captureSnapshot`, after building `activeEvents` (~line 44) and before the `return`:
```ts
  const forcedEvents: [string, SettlementEventType][] = [];
  for (const [poiId, type] of state.world.forcedEvents) forcedEvents.push([poiId, type]);
```
and add `forcedEvents,` to the returned object (next to `activeEvents,`).

In `restoreSnapshot`, after the `activeEvents` restore loop (~line 80):
```ts
  for (const [poiId, type] of snap.forcedEvents ?? []) fresh.forcedEvents.set(poiId, type);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- snapshot-forced-events`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/world/world.ts src/core/snapshot.ts tests/unit/snapshot-forced-events.test.ts
git commit -m "feat(fate): world.forcedEvents + snapshot round-trip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `bias_event` verb effect + registry wiring

**Files:**
- Modify: `src/sim/command/authoring-verbs.ts` (add precondition + apply)
- Modify: `src/sim/command/registry.ts:26` (import), `:135-138` (wire `bias_event`)
- Test: `tests/unit/authoring-verbs.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/authoring-verbs.test.ts` (a new `describe`). It exercises the verb through the registry's executor path so target/payload validation is covered. Match the existing file's helpers; if it builds an `ApplyCtx` differently, reuse that. The self-contained version:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { executeCommand } from '@/sim/command/command-system';
import type { ApplyCtx, Command } from '@/sim/command/types';
import type { GameMap, Tile } from '@/core/types';

function biasMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function biasCtx(world: World): ApplyCtx {
  return { world, spirits: new Map(), log: new EventLog(), rng: createRng(1), now: 0 };
}
function biasCmd(payload: Record<string, unknown>, poiId = 'poi1'): Command {
  return { verb: 'bias_event', source: 'fate', target: { kind: 'settlement', poiId }, payload, seq: 0 };
}

describe('bias_event', () => {
  it('sets world.forcedEvents for a valid eventType', () => {
    const world = new World(biasMap());
    const res = executeCommand(biasCmd({ eventType: 'plague' }), biasCtx(world));
    expect(res.status).toBe('applied');
    expect(world.forcedEvents.get('poi1')).toBe('plague');
  });

  it('rejects an unknown eventType as invalid_payload', () => {
    const world = new World(biasMap());
    const res = executeCommand(biasCmd({ eventType: 'banana' }), biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
    expect(world.forcedEvents.size).toBe(0);
  });

  it('rejects a non-settlement target as invalid_target', () => {
    const world = new World(biasMap());
    const cmd: Command = { verb: 'bias_event', source: 'fate', target: { kind: 'none' }, payload: { eventType: 'drought' }, seq: 0 };
    const res = executeCommand(cmd, biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- authoring-verbs`
Expected: FAIL — `bias_event` is `not_implemented` (registry `implemented: false`).

- [ ] **Step 3: Add the effect to `authoring-verbs.ts`**

Append to `src/sim/command/authoring-verbs.ts`:

```ts
import type { SettlementEventType } from '@/core/types';

const EVENT_TYPES: ReadonlySet<string> = new Set<SettlementEventType>([
  'drought', 'festival', 'dispute', 'plague', 'raiders', 'trading_caravan', 'stranger_arrives', 'harvest_blessing',
]);

export function biasEventPrecondition(cmd: Command, _ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  const type = P(cmd).eventType;
  if (typeof type !== 'string' || !EVENT_TYPES.has(type)) return 'invalid_payload';
  return null;
}

export function biasEventApply(cmd: Command, ctx: ApplyCtx): boolean {
  ctx.world.forcedEvents.set(poiOf(cmd)!, P(cmd).eventType as SettlementEventType);
  return true;
}
```

(`poiOf`, `P`, `Command`, `CommandCtx`, `ApplyCtx`, `RejectionReason` are already imported/defined in this file.)

- [ ] **Step 4: Wire it in the registry**

In `src/sim/command/registry.ts`, extend the import on line 26:
```ts
import { injectNpcPrecondition, injectNpcApply, biasEventPrecondition, biasEventApply } from './authoring-verbs';
```

Replace the `bias_event` entry (lines ~135-138) with:
```ts
  bias_event: {
    verb: 'bias_event', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: biasEventPrecondition,
    apply: biasEventApply,
    describe: (cmd) => `force next event at ${targetLabel(cmd)} to be ${cmd.payload?.eventType ?? 'an event'}`,
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- authoring-verbs`
Expected: PASS (existing inject_npc tests + 3 new bias_event tests).

Then run the registry introspection test to ensure nothing asserts `bias_event` is unimplemented:
Run: `npm test -- command-registry`
Expected: PASS. If it fails on a "bias_event is not implemented" assertion, update that assertion to expect `implemented: true` for `bias_event` (leave `nudge_severity` as unimplemented for now — Task 4 handles it).

- [ ] **Step 6: Commit**

```bash
git add src/sim/command/authoring-verbs.ts src/sim/command/registry.ts tests/unit/authoring-verbs.test.ts tests/unit/command-registry.test.ts
git commit -m "feat(fate): bias_event verb sets world.forcedEvents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `SettlementEventSystem` consumes `forcedEvents`

**Files:**
- Modify: `src/sim/systems/settlement-event-system.ts:151-201` (`rollNewEvents`)
- Test: `tests/unit/settlement-event-forced.test.ts` (Create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/settlement-event-forced.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { initNpcProps } from '@/world/npc-helpers';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile, Entity, SimEvent } from '@/core/types';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function ctxFor(world: World, log: EventLog, clock: SimClock): SystemContext {
  return { world, clock, rng: createRng(1), log, spirits: new Map(), now: clock.now(), dt: 1 } as unknown as SystemContext;
}
function resident(world: World, poiId: string) {
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = poiId;
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
}

describe('SettlementEventSystem forced events', () => {
  it('materializes the forced event type on the next eligible tick and clears the bias', () => {
    const world = new World(map()); const log = new EventLog(); const clock = new SimClock();
    resident(world, 'poi1');
    world.forcedEvents.set('poi1', 'plague');
    const sys = new SettlementEventSystem();
    sys.tick(ctxFor(world, log, clock));
    const events = world.activeEvents.get('poi1');
    expect(events).toHaveLength(1);
    expect(events![0].type).toBe('plague');
    expect(world.forcedEvents.has('poi1')).toBe(false);
    const begins = log.since(0).filter((e) => e.type === 'settlement_begin');
    expect(begins.some((e) => (e as { eventType: string }).eventType === 'plague')).toBe(true);
  });

  it('leaves the bias intact while the POI already has an active event', () => {
    const world = new World(map()); const log = new EventLog(); const clock = new SimClock();
    resident(world, 'poi1');
    world.activeEvents.set('poi1', [{ type: 'festival', poiId: 'poi1', severity: 0.5, durationTicks: 100, ticksElapsed: 0 }]);
    world.forcedEvents.set('poi1', 'plague');
    const sys = new SettlementEventSystem();
    sys.tick(ctxFor(world, log, clock));
    expect(world.activeEvents.get('poi1')![0].type).toBe('festival');  // unchanged
    expect(world.forcedEvents.get('poi1')).toBe('plague');             // still pending
  });
});
```

> Note: `log.since(0)` returns every appended event (confirmed accessor in `src/core/events.ts`; there is no `all()`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settlement-event-forced`
Expected: FAIL — the forced event is not materialized (rolling is probabilistic; `forcedEvents` is ignored).

- [ ] **Step 3: Consume `forcedEvents` in `rollNewEvents`**

In `src/sim/systems/settlement-event-system.ts`, inside `rollNewEvents`, replace the body of the `for (const poiId of poiIds)` loop so the forced check runs first. The loop currently starts (lines ~159-167):

```ts
    for (const poiId of poiIds) {
      // Skip POIs that already have an active event (max 1 at a time)
      if (ctx.world.activeEvents.has(poiId)) continue;
```

Insert, immediately after that `if (...) continue;` guard:

```ts
      // Fate override: if a forced next-event is pending for this POI, materialize
      // it now (bypassing probability + cooldown) and clear the one-shot bias.
      const forced = ctx.world.forcedEvents.get(poiId);
      if (forced) {
        const cfg = EVENT_CONFIGS[forced];
        const severity = 0.3 + this.rng.next() * 0.4; // 0.3–0.7, same band as natural
        const duration = cfg.minDuration +
          Math.floor(this.rng.next() * (cfg.maxDuration - cfg.minDuration + 1));
        ctx.world.activeEvents.set(poiId, [{
          type: forced, poiId,
          severity: Math.round(severity * 100) / 100,
          durationTicks: duration, ticksElapsed: 0,
        }]);
        ctx.log.append({ type: 'settlement_begin', poiId, eventType: forced, severity, durationTicks: duration });
        ctx.world.forcedEvents.delete(poiId);
        continue; // forced event occupies the POI; skip the probability roll
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- settlement-event-forced`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing settlement-event suite (no regressions)**

Run: `npm test -- settlement-event`
Expected: PASS (existing + new files).

- [ ] **Step 6: Commit**

```bash
git add src/sim/systems/settlement-event-system.ts tests/unit/settlement-event-forced.test.ts
git commit -m "feat(fate): SettlementEventSystem materializes forced next-events

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `nudge_severity` verb effect + registry wiring

**Files:**
- Modify: `src/sim/command/authoring-verbs.ts` (add precondition + apply)
- Modify: `src/sim/command/registry.ts:26` (import), `:145-148` (wire `nudge_severity`)
- Test: `tests/unit/authoring-verbs.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append a new `describe` to `tests/unit/authoring-verbs.test.ts` (reuse the `biasMap`/`biasCtx` helpers added in Task 2):

```ts
function nudgeCmd(delta: unknown, poiId = 'poi1'): Command {
  return { verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId }, payload: { delta }, seq: 0 };
}
function withEvent(world: World, severity: number) {
  world.activeEvents.set('poi1', [{ type: 'drought', poiId: 'poi1', severity, durationTicks: 100, ticksElapsed: 0 }]);
}

describe('nudge_severity', () => {
  it('raises severity and clamps at 1.0', () => {
    const world = new World(biasMap()); withEvent(world, 0.8);
    const res = executeCommand(nudgeCmd(0.5), biasCtx(world));
    expect(res.status).toBe('applied');
    expect(world.activeEvents.get('poi1')![0].severity).toBe(1.0);
  });

  it('lowers severity and clamps at the 0.05 floor', () => {
    const world = new World(biasMap()); withEvent(world, 0.2);
    executeCommand(nudgeCmd(-0.5), biasCtx(world));
    expect(world.activeEvents.get('poi1')![0].severity).toBe(0.05);
  });

  it('rejects precondition_failed when the POI has no active event', () => {
    const world = new World(biasMap());
    const res = executeCommand(nudgeCmd(0.2), biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'precondition_failed' });
  });

  it('rejects a non-finite delta as invalid_payload', () => {
    const world = new World(biasMap()); withEvent(world, 0.5);
    const res = executeCommand(nudgeCmd('lots'), biasCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- authoring-verbs`
Expected: FAIL — `nudge_severity` is `not_implemented`.

- [ ] **Step 3: Add the effect to `authoring-verbs.ts`**

Append to `src/sim/command/authoring-verbs.ts`:

```ts
const SEVERITY_MIN = 0.05;
const SEVERITY_MAX = 1.0;
const MAX_NUDGE = 0.5;       // per-call magnitude cap

export function nudgeSeverityPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  const delta = P(cmd).delta;
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return 'invalid_payload';
  const events = ctx.world.activeEvents.get(poiId);
  if (!events || events.length === 0) return 'precondition_failed';
  return null;
}

export function nudgeSeverityApply(cmd: Command, ctx: ApplyCtx): boolean {
  const events = ctx.world.activeEvents.get(poiOf(cmd)!);
  if (!events || events.length === 0) return false;          // lost a race after the pre-gate
  const raw = P(cmd).delta as number;
  const delta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw));
  for (const e of events) {
    e.severity = Math.round(Math.max(SEVERITY_MIN, Math.min(SEVERITY_MAX, e.severity + delta)) * 100) / 100;
  }
  return true;
}
```

- [ ] **Step 4: Wire it in the registry**

In `src/sim/command/registry.ts`, extend the authoring-verbs import (line 26) to also pull in the two new functions:
```ts
import {
  injectNpcPrecondition, injectNpcApply,
  biasEventPrecondition, biasEventApply,
  nudgeSeverityPrecondition, nudgeSeverityApply,
} from './authoring-verbs';
```

Replace the `nudge_severity` entry (lines ~145-148) with:
```ts
  nudge_severity: {
    verb: 'nudge_severity', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: nudgeSeverityPrecondition,
    apply: nudgeSeverityApply,
    describe: (cmd) => `nudge severity of ${targetLabel(cmd)} event by ${cmd.payload?.delta ?? 0}`,
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- authoring-verbs`
Expected: PASS (inject_npc + bias_event + nudge_severity).

Run: `npm test -- command-registry`
Expected: PASS. If an assertion still claims `nudge_severity` is unimplemented, update it to expect `implemented: true` (now all three authoring verbs are implemented — adjust any "all authoring verbs unimplemented" assertion accordingly).

- [ ] **Step 6: Commit**

```bash
git add src/sim/command/authoring-verbs.ts src/sim/command/registry.ts tests/unit/authoring-verbs.test.ts tests/unit/command-registry.test.ts
git commit -m "feat(fate): nudge_severity verb adjusts active-event severity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fate tools — two immediate tools + `parseFateToolCalls` returns `{ beats, commands }`

**Files:**
- Modify: `src/game/fate/fate-tools.ts` (tools + return shape)
- Test: `tests/unit/fate-tools.test.ts` (migrate + extend)

- [ ] **Step 1: Write the failing test (migrate existing + add new)**

Rewrite `tests/unit/fate-tools.test.ts` so existing assertions read from `.beats` and new ones cover `.commands`:

```ts
import { describe, it, expect } from 'vitest';
import type { LLMToolCall } from '@/llm/llm-client';
import { FATE_TOOLS, parseFateToolCalls } from '@/game/fate/fate-tools';

function armCall(args: Record<string, unknown>): LLMToolCall {
  return { id: 'c0', name: 'arm_staged_beat', arguments: args };
}
const ctx = () => ({ validPoiIds: new Set(['poi1', 'poi2']), now: 100 });

describe('FATE_TOOLS', () => {
  it('exposes the staged + two immediate tools', () => {
    const names = FATE_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['arm_staged_beat', 'force_next_event', 'nudge_event_severity']);
  });
});

describe('parseFateToolCalls — staged beats', () => {
  it('builds an inject_npc discovery beat for a valid subject', () => {
    const { beats } = parseFateToolCalls(
      [armCall({ subjectPoiId: 'poi1', threadId: 7, hard: 'inject_npc', role: 'preacher', soft: 'A stranger lingers.' })],
      ctx(),
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].subject).toEqual({ kind: 'settlement', poiId: 'poi1' });
    expect(beats[0].hard[0]).toMatchObject({ verb: 'inject_npc', source: 'fate', payload: { role: 'preacher' } });
  });

  it('drops a beat whose subjectPoiId is not valid', () => {
    const { beats } = parseFateToolCalls([armCall({ subjectPoiId: 'ghost', hard: 'inject_npc' })], ctx());
    expect(beats).toHaveLength(0);
  });

  it('tolerates undefined calls', () => {
    expect(parseFateToolCalls(undefined, ctx())).toEqual({ beats: [], commands: [] });
  });
});

describe('parseFateToolCalls — immediate commands', () => {
  it('builds a nudge_severity command from force/severity tool', () => {
    const { commands } = parseFateToolCalls(
      [{ id: 'c1', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.3 } }],
      ctx(),
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { delta: 0.3 },
    });
  });

  it('caps an oversized delta to ±0.5', () => {
    const { commands } = parseFateToolCalls(
      [{ id: 'c1', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 9 } }],
      ctx(),
    );
    expect(commands[0].payload).toEqual({ delta: 0.5 });
  });

  it('builds a bias_event command from force_next_event', () => {
    const { commands } = parseFateToolCalls(
      [{ id: 'c1', name: 'force_next_event', arguments: { subjectPoiId: 'poi2', eventType: 'plague' } }],
      ctx(),
    );
    expect(commands[0]).toMatchObject({
      verb: 'bias_event', source: 'fate', target: { kind: 'settlement', poiId: 'poi2' }, payload: { eventType: 'plague' },
    });
  });

  it('drops immediate calls with an ungrounded poiId, bad eventType, or non-finite delta', () => {
    const { commands } = parseFateToolCalls([
      { id: 'a', name: 'nudge_event_severity', arguments: { subjectPoiId: 'ghost', delta: 0.2 } },
      { id: 'b', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 'lots' } },
      { id: 'c', name: 'force_next_event', arguments: { subjectPoiId: 'poi1', eventType: 'banana' } },
    ], ctx());
    expect(commands).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fate-tools`
Expected: FAIL — only one tool exists; `parseFateToolCalls` returns an array, not `{ beats, commands }`.

- [ ] **Step 3: Update `fate-tools.ts`**

In `src/game/fate/fate-tools.ts`:

Add the event-type vocabulary near the top (after `FATE_ROLES`):
```ts
import type { SettlementEventType } from '@/core/types';

export const FATE_EVENT_TYPES: readonly SettlementEventType[] = [
  'drought', 'festival', 'dispute', 'plague', 'raiders', 'trading_caravan', 'stranger_arrives', 'harvest_blessing',
];
const MAX_NUDGE = 0.5;
```

Add two tools to the `FATE_TOOLS` array (after the existing `arm_staged_beat` object):
```ts
  {
    name: 'nudge_event_severity',
    description:
      "Raise (positive delta) or lower (negative delta) the intensity of a settlement's CURRENT event. " +
      'Only for a settlement listed with an active event. Applies immediately.',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads.' },
        delta: { type: 'number', description: 'Severity change, -0.5…0.5. Positive worsens, negative eases.' },
      },
      required: ['subjectPoiId', 'delta'],
    },
  },
  {
    name: 'force_next_event',
    description:
      'Steer what befalls a settlement NEXT: the next event rolled there will be the chosen type, ' +
      'from the existing vocabulary. Applies immediately (latent until the next roll).',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads.' },
        eventType: { type: 'string', enum: [...FATE_EVENT_TYPES], description: 'Which event to bring next.' },
      },
      required: ['subjectPoiId', 'eventType'],
    },
  },
```

Add the `Command` import (top of file already imports `Command` type — confirm; if not):
```ts
import type { Command } from '@/sim/command/types';
```

Change the return type + body of `parseFateToolCalls`. Replace the function with:
```ts
export interface ParsedFateActions {
  beats: Array<Omit<StagedBeat, 'id' | 'status'>>;
  commands: Array<Omit<Command, 'seq'>>;
}

/** Validate the model's tool calls into armable beats + immediate commands; drop anything ungrounded. */
export function parseFateToolCalls(
  calls: LLMToolCall[] | undefined,
  ctx: FateToolCtx,
): ParsedFateActions {
  const beats: ParsedFateActions['beats'] = [];
  const commands: ParsedFateActions['commands'] = [];
  for (const c of calls ?? []) {
    if (c.name === 'arm_staged_beat') {
      const beat = parseArmBeat(c, ctx);
      if (beat) beats.push(beat);
    } else if (c.name === 'nudge_event_severity') {
      const cmd = parseNudge(c, ctx);
      if (cmd) commands.push(cmd);
    } else if (c.name === 'force_next_event') {
      const cmd = parseForceEvent(c, ctx);
      if (cmd) commands.push(cmd);
    }
  }
  return { beats, commands };
}

function parseArmBeat(c: LLMToolCall, ctx: FateToolCtx): Omit<StagedBeat, 'id' | 'status'> | null {
  const a = c.arguments as {
    subjectPoiId?: unknown; threadId?: unknown; hard?: unknown; role?: unknown; soft?: unknown;
  };
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped beat: unknown subjectPoiId', poiId); return null; }
  const hard: Command[] = [];
  if (a.hard === 'inject_npc') {
    const role = typeof a.role === 'string' && (FATE_ROLES as readonly string[]).includes(a.role) ? a.role : 'refugee';
    hard.push({ verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId }, payload: { role }, seq: 0 });
  }
  const beat: Omit<StagedBeat, 'id' | 'status'> = {
    subject: { kind: 'settlement', poiId },
    trigger: { kind: 'discovery' },
    hard,
    stagedTick: ctx.now,
  };
  if (typeof a.threadId === 'number') beat.threadId = a.threadId;
  if (typeof a.soft === 'string' && a.soft.trim()) beat.soft = { kind: 'location_vibe', text: a.soft.trim() };
  return beat;
}

function parseNudge(c: LLMToolCall, ctx: FateToolCtx): Omit<Command, 'seq'> | null {
  const a = c.arguments as { subjectPoiId?: unknown; delta?: unknown };
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped nudge: unknown subjectPoiId', poiId); return null; }
  if (typeof a.delta !== 'number' || !Number.isFinite(a.delta)) { console.warn('[fate] dropped nudge: bad delta', a.delta); return null; }
  const delta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, a.delta));
  return { verb: 'nudge_severity', source: 'fate', target: { kind: 'settlement', poiId }, payload: { delta } };
}

function parseForceEvent(c: LLMToolCall, ctx: FateToolCtx): Omit<Command, 'seq'> | null {
  const a = c.arguments as { subjectPoiId?: unknown; eventType?: unknown };
  const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
  if (!ctx.validPoiIds.has(poiId)) { console.warn('[fate] dropped force_next_event: unknown subjectPoiId', poiId); return null; }
  if (typeof a.eventType !== 'string' || !(FATE_EVENT_TYPES as readonly string[]).includes(a.eventType)) {
    console.warn('[fate] dropped force_next_event: bad eventType', a.eventType); return null;
  }
  return { verb: 'bias_event', source: 'fate', target: { kind: 'settlement', poiId }, payload: { eventType: a.eventType } };
}
```

(Keep `FATE_ROLES`, `FateToolCtx` as-is. Delete the old single-function body that returned an array.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fate-tools`
Expected: PASS (all migrated + new).

- [ ] **Step 5: Commit**

```bash
git add src/game/fate/fate-tools.ts tests/unit/fate-tools.test.ts
git commit -m "feat(fate): two immediate tools; parseFateToolCalls returns {beats,commands}

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Enrich Fate context with active events + broaden charter

**Files:**
- Modify: `src/game/fate/fate-context.ts` (`describeThreadsForFate`, `SYSTEM_CHARTER`)
- Test: `tests/unit/fate-context.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/fate-context.test.ts`. Extend the `state()` helper used there OR add a focused test that seeds an active event. Append this `describe`:

```ts
import type { ActiveEvent } from '@/core/types';

describe('describeThreadsForFate active events', () => {
  it("annotates a thread settlement's active event with type and severity", () => {
    const s = state();
    const ev: ActiveEvent = { type: 'drought', poiId: 'poi1', severity: 0.45, durationTicks: 100, ticksElapsed: 0 };
    s.world.activeEvents.set('poi1', [ev]);
    const { text } = describeThreadsForFate(s);
    expect(text).toContain('drought');
    expect(text).toContain('0.45');
  });

  it('marks a thread settlement with no active event', () => {
    const { text } = describeThreadsForFate(state());
    expect(text.toLowerCase()).toContain('no active event');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fate-context`
Expected: FAIL — the thread line has no event annotation.

- [ ] **Step 3: Annotate thread lines + broaden the charter**

In `src/game/fate/fate-context.ts`, update the loop in `describeThreadsForFate` (the `lines.push(...)` line) to append the active-event digest:

```ts
  for (const t of state.plotThreads.active()) {
    if (t.subject.kind !== 'settlement') continue;       // only settlement subjects are stageable in v1
    const poiId = t.subject.poiId;
    poiIds.add(poiId);
    const name = poiName.get(poiId) ?? poiId;
    const events = state.world?.activeEvents.get(poiId);
    const evText = events && events.length
      ? `active event: ${events[0].type} (severity ${events[0].severity})`
      : 'no active event';
    lines.push(`- thread ${t.id}: ${t.shapeId} at "${name}" (${poiId}), phase ${t.phase}; ${evText}`);
  }
```

Broaden `SYSTEM_CHARTER` to mention the new capability + direction. Replace it with:
```ts
const SYSTEM_CHARTER =
  'You are Fate — impersonal and reactive. You amplify, escalate, or let fade what the mortals\' story ' +
  'already produces; you never invent arbitrary plot. You may PREPARE content to be discovered later ' +
  '(arm_staged_beat) OR act on a settlement\'s ongoing troubles now: nudge_event_severity changes the ' +
  'intensity of its current event, force_next_event steers what befalls it next. Only ever use a ' +
  'subjectPoiId listed in the active threads. Act sparingly — often the right choice is to call no tool.';
```

(The existing `fate-context` test asserts `system` contains `subjectPoiId` and "fate" — both still hold.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fate-context`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/game/fate/fate-context.ts tests/unit/fate-context.test.ts
git commit -m "feat(fate): context shows each thread settlement's active event; broaden charter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `FateBrainService` emits commands + `game.ts` wiring

**Files:**
- Modify: `src/game/fate/fate-brain-service.ts` (`emitCommand` dep, emit loop)
- Modify: `src/game.ts:362-366` (pass `emitCommand`)
- Test: `tests/unit/fate-brain-service.test.ts` (migrate + extend)

- [ ] **Step 1: Write the failing test**

In `tests/unit/fate-brain-service.test.ts`, every `new FateBrainService({...})` must now also pass `emitCommand`. Update the existing constructions to include `emitCommand: () => {}` and add one new test. Add a helper + new case:

```ts
import type { Command } from '@/sim/command/types';

function clientNudging(): LLMClient {
  return new LLMClient(new MockLLMProvider(0, {
    cannedToolCalls: [{ id: 'c0', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.3 } }],
  }));
}

it('emits immediate commands via emitCommand', async () => {
  const state = makeState();
  const emitted: Array<Omit<Command, 'seq'>> = [];
  const brain = new FateBrainService({
    getState: () => state, getCapableClient: () => clientNudging(), isScrubbed: () => false,
    emitCommand: (c) => emitted.push(c),
  });
  await brain.deliberate(focus());
  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toMatchObject({ verb: 'nudge_severity', source: 'fate', payload: { delta: 0.3 } });
});
```

And update each existing `new FateBrainService({ ... })` in this file to add `emitCommand: () => {},` to its deps object (5 sites).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fate-brain-service`
Expected: FAIL — `emitCommand` is not a known dep / not invoked (TypeScript error on the new required field, and the new test fails).

- [ ] **Step 3: Add `emitCommand` to the service**

In `src/game/fate/fate-brain-service.ts`:

Add the import:
```ts
import type { Command } from '@/sim/command/types';
```

Add to `FateBrainDeps` (after `isScrubbed`):
```ts
  /** Emit an immediate command (nudge_severity / bias_event) onto the queue. */
  emitCommand: (cmd: Omit<Command, 'seq'>) => void;
```

In `deliberate`, replace the parse + arm block with one that handles both beats and commands:
```ts
      const { beats, commands } = parseFateToolCalls(res.toolCalls, { validPoiIds, now: state.clock.now() });
      for (const b of beats) {
        const armed = state.staging.arm(b);
        if (b.threadId !== undefined) {
          const t = state.plotThreads.get(b.threadId);
          if (t) t.vars.staged = 1;            // cooperate with the stub's once-per-thread guard
        }
        this.deps.onArmed?.(armed);
      }
      for (const c of commands) this.deps.emitCommand(c);
```

- [ ] **Step 4: Wire `game.ts`**

In `src/game.ts`, the `FateBrainService` construction (lines ~362-366) gains the `emitCommand` dep:
```ts
    this.fateBrain = new FateBrainService({
      getState: () => this.state,
      getCapableClient: () => this.llmClientCapable,
      isScrubbed: () => this.timeline.isScrubbed,
      emitCommand: (cmd) => this.commandQueue.emit(cmd),
    });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- fate-brain-service`
Expected: PASS (5 migrated + 1 new).

Run: `npm run build`
Expected: TypeScript compiles clean (verifies the `game.ts` wiring type-checks).

- [ ] **Step 6: Commit**

```bash
git add src/game/fate/fate-brain-service.ts src/game.ts tests/unit/fate-brain-service.test.ts
git commit -m "feat(fate): FateBrainService emits immediate commands; wire game.ts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end integration test

**Files:**
- Test: `tests/unit/fate-amplify-integration.test.ts` (Create)

- [ ] **Step 1: Write the integration test**

Create `tests/unit/fate-amplify-integration.test.ts`. It drives the brain with canned tool calls and asserts the world changes through the real verb + system path (no game.ts):

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { CommandQueue } from '@/sim/command/command-queue';
import { executeCommand } from '@/sim/command/command-system';
import { SettlementEventSystem } from '@/sim/systems/settlement-event-system';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import type { ApplyCtx as CmdApplyCtx } from '@/sim/command/types';
import type { SystemContext } from '@/core/scheduler';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 2; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 2; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 2, height: 2, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(world: World): GameState {
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = 'poi1';
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return {
    world, plotThreads, staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }] },
  } as unknown as GameState;
}
const focus = (): FateFocus => ({ event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 });
function clientWith(calls: LLMToolCall[]): LLMClient {
  return new LLMClient(new MockLLMProvider(0, { cannedToolCalls: calls }));
}
function drain(queue: CommandQueue, ctx: CmdApplyCtx) {
  for (const cmd of queue.drain()) executeCommand(cmd, ctx);
}

describe('Fate amplify levers — integration', () => {
  it('brain force_next_event → roller materializes that event', () => {
    return (async () => {
      const world = new World(map()); const state = makeState(world);
      const queue = new CommandQueue(); const log = new EventLog();
      const brain = new FateBrainService({
        getState: () => state, isScrubbed: () => false,
        getCapableClient: () => clientWith([{ id: 'c0', name: 'force_next_event', arguments: { subjectPoiId: 'poi1', eventType: 'plague' } }]),
        emitCommand: (c) => queue.emit(c),
      });
      await brain.deliberate(focus());

      const applyCtx: CmdApplyCtx = { world, spirits: new Map(), log, rng: createRng(1), now: 0 };
      drain(queue, applyCtx);
      expect(world.forcedEvents.get('poi1')).toBe('plague');

      const sys = new SettlementEventSystem();
      sys.tick({ world, clock: state.clock, rng: createRng(1), log, spirits: new Map(), now: 0, dt: 1 } as unknown as SystemContext);
      expect(world.activeEvents.get('poi1')![0].type).toBe('plague');
      expect(world.forcedEvents.has('poi1')).toBe(false);
    })();
  });

  it('brain nudge_event_severity → active event severity rises', () => {
    return (async () => {
      const world = new World(map()); const state = makeState(world);
      world.activeEvents.set('poi1', [{ type: 'drought', poiId: 'poi1', severity: 0.4, durationTicks: 100, ticksElapsed: 0 }]);
      const queue = new CommandQueue(); const log = new EventLog();
      const brain = new FateBrainService({
        getState: () => state, isScrubbed: () => false,
        getCapableClient: () => clientWith([{ id: 'c0', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.3 } }]),
        emitCommand: (c) => queue.emit(c),
      });
      await brain.deliberate(focus());
      drain(queue, { world, spirits: new Map(), log, rng: createRng(1), now: 0 });
      expect(world.activeEvents.get('poi1')![0].severity).toBeCloseTo(0.7, 5);
    })();
  });
});
```

> Note: drop the unused `ApplyCtx` import from `@/core/types` if it isn't a real export — only `CmdApplyCtx` (from `@/sim/command/types`) is needed. The implementer should remove any import that fails to resolve.

- [ ] **Step 2: Run test to verify it passes** (the machinery already exists from Tasks 1–7)

Run: `npm test -- fate-amplify-integration`
Expected: PASS (2 tests). If an import fails to resolve, fix the import per the note, not the assertions.

- [ ] **Step 3: Run the FULL suite + build (no regressions)**

Run: `npm test`
Expected: PASS — all prior tests plus the new ones (≈1237 + new cases).

Run: `npm run build`
Expected: TypeScript clean, Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/fate-amplify-integration.test.ts
git commit -m "test(fate): end-to-end amplify levers — force event + nudge severity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (for the executor)

- **`EventLog` accessor:** Task 3's test uses `log.since(0)` (returns all appended events — confirmed; there is no `all()`).
- **`command-registry.test.ts` assertions:** Tasks 2 & 4 may break introspection tests that assert authoring verbs are unimplemented. Update those assertions to match reality (all three authoring verbs are now implemented) — do not weaken any unrelated assertion.
- **`SystemContext` shape:** the settlement-event + integration tests cast a partial `SystemContext`. If `SettlementEventSystem.tick` reads a field not provided (it uses `ctx.world`, `ctx.rng`, `ctx.log`, `ctx.clock`), add it to the cast.
- **No RNG in verb effects:** `bias_event`/`nudge_severity` apply functions must not call `Math.random` or `ctx.rng` — they are pure mutations. `tests/unit/no-random-in-sim.test.ts` must stay green.
