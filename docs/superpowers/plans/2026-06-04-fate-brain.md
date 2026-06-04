# Fate Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An autonomous, reactive LLM "Fate brain" that reads plot threads + world state and arms staged beats via `llmClientCapable`, replacing the deterministic stub producer, with `inject_npc` wired as its first escalation lever.

**Architecture:** A `FateBrainService` in `src/game/fate/` (game layer, async, off the sim tick — mirrors `LlmBackfillService`) woken by a cooldown'd, single-flight `FateTrigger` subscribed to `EventLog`. It builds a Fate context (threads + triggering event + world digest), calls `generateWithTools` with one constrained tool (`arm_staged_beat`), validates the calls against existing settlement subjects, and arms beats on the snapshot-backed `StagingBuffer`. Beats stay latent until discovered; `inject_npc` rides as a beat's `hard` payload. The stub producer is gated to run only when no capable LLM is configured.

**Tech Stack:** TypeScript ES modules, Vitest, seeded `sfc32` RNG (`src/sim/` stays `Math.random`-free), `@/` → `src/` alias.

**Spec:** `docs/superpowers/specs/2026-06-04-fate-brain-design.md`

**Branch:** `fate-brain` (already created; spec committed at `06831db`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/sim/command/authoring-verbs.ts` (new) | `inject_npc` precondition/apply + Fate-role→NpcRole map. Sim-layer, deterministic. |
| `src/sim/command/editor-verbs.ts` (modify) | Export `resolveCenter` so `inject_npc` can reuse settlement-center resolution. |
| `src/sim/command/registry.ts` (modify) | Flip `inject_npc` to `implemented: true`, wire precondition/apply/describe. |
| `src/sim/threads/systems/plot-thread-system.ts` (modify) | Add `isProducerActive?` gate so stub producers run only when allowed. |
| `src/game/fate/fate-tools.ts` (new) | `arm_staged_beat` LLM tool schema + validated parse → `Omit<StagedBeat,'id'\|'status'>[]`. |
| `src/game/fate/fate-context.ts` (new) | `FateFocus`, `describeThreadsForFate`, `buildFateContext` (reuses `buildWorldSummary`). |
| `src/game/fate/fate-brain-service.ts` (new) | `FateBrainService` — single-flight, scrub-gated `deliberate()`. |
| `src/game/fate/fate-trigger.ts` (new) | `FateTrigger` — significance filter + cooldown over `EventLog`. |
| `src/game.ts` (modify) | Construct + wire `FateBrainService` + `FateTrigger`; pass the producer gate. |
| `docs/VISION.md` (modify) | §2.1 "Fate may prepare the stage" reconciliation paragraph. |

Build order: the escalation verb (Task 1) and the producer gate (Task 2) are independent sim-layer changes; the LLM seam (Tasks 3–6) builds bottom-up; Task 7 wires it into `game.ts` with the proof-of-life integration test; Task 8 updates canon.

---

### Task 1: `inject_npc` escalation verb

**Files:**
- Create: `src/sim/command/authoring-verbs.ts`
- Modify: `src/sim/command/editor-verbs.ts` (export `resolveCenter`)
- Modify: `src/sim/command/registry.ts` (wire `inject_npc`)
- Test: `tests/unit/authoring-verbs.test.ts`

- [ ] **Step 1: Export `resolveCenter` from editor-verbs**

In `src/sim/command/editor-verbs.ts`, change the declaration (around line 64) from:

```ts
function resolveCenter(near: unknown, ctx: CommandCtx): { x: number; y: number } | null {
```

to:

```ts
export function resolveCenter(near: unknown, ctx: CommandCtx): { x: number; y: number } | null {
```

(`findPlacement` and `isRealizedWalkable` are already exported.)

- [ ] **Step 2: Write the failing test**

Create `tests/unit/authoring-verbs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { executeCommand } from '@/sim/command/command-system';
import type { ApplyCtx, Command } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import { FATE_ROLE_MAP } from '@/sim/command/authoring-verbs';

function bigMap(n = 12): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null,
           stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function applyCtx(world: World, now = 10): ApplyCtx {
  return { world, spirits: new Map<SpiritId, Spirit>(), log: new EventLog(new SimClock()), rng: createRng(42), now };
}
function resident(id: string, x: number, y: number, poiId = 'poi1'): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homeX = x; p.homeY = y; p.homePoiId = poiId;
  return { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
}
function injectCmd(poiId: string, role: string): Command {
  return { verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId }, payload: { role }, seq: 0 };
}

describe('inject_npc', () => {
  it('spawns one stranger of the mapped role near a resident of the poi, faith 0', () => {
    const world = new World(bigMap());
    world.addEntity(resident('r1', 5, 5));
    const before = queryNpcs(world).length;
    const res = executeCommand(injectCmd('poi1', 'preacher'), applyCtx(world));
    expect(res.status).toBe('applied');
    const npcs = queryNpcs(world);
    expect(npcs.length).toBe(before + 1);
    const stranger = npcs.find(e => e.id !== 'r1')!;
    const p = npcProps(stranger) as NpcProperties & { fateRole?: string };
    expect(p.role).toBe(FATE_ROLE_MAP.preacher);   // 'priest'
    expect(p.fateRole).toBe('preacher');
    expect(p.beliefs.player.faith).toBe(0);
  });

  it('rejects an unknown role with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(resident('r1', 5, 5));
    const res = executeCommand(injectCmd('poi1', 'wizard'), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });

  it('rejects a poi with no resident (unresolvable center) with invalid_target', () => {
    const world = new World(bigMap());
    world.addEntity(resident('r1', 5, 5, 'poi1'));
    const res = executeCommand(injectCmd('poiX', 'refugee'), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/authoring-verbs.test.ts`
Expected: FAIL — `Cannot find module '@/sim/command/authoring-verbs'` (and `inject_npc` rejects `not_implemented`).

- [ ] **Step 4: Implement `authoring-verbs.ts`**

Create `src/sim/command/authoring-verbs.ts`:

```ts
/**
 * authoring-verbs.ts — the effect of Fate's authoring-tier verbs.
 *
 * These are Fate's reactive escalation levers: they amplify what the sim already
 * produces (VISION §2.1), never arbitrary plot. v1 implements `inject_npc` — a
 * stranger (preacher / skeptic / refugee) arrives at a settlement under an active
 * thread. All randomness flows through ctx.rng (seeded) — never Math.random.
 */
import type { NpcRole } from '@/core/types';
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { initNpcProps } from '@/world/npc-helpers';
import { resolveCenter, findPlacement } from './editor-verbs';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};
const STRANGER_NAMES = ['Wanderer', 'Pilgrim', 'Outsider', 'Traveller', 'Foundling', 'Exile'];

/** Fate-narrative roles → existing sim NpcRole. */
export const FATE_ROLE_MAP: Record<string, NpcRole> = {
  preacher: 'priest',
  skeptic: 'elder',
  refugee: 'beggar',
};

function poiOf(cmd: Command): string | undefined {
  return cmd.target.kind === 'settlement' ? cmd.target.poiId : undefined;
}

export function injectNpcPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const role = P(cmd).role as string | undefined;
  if (!role || !(role in FATE_ROLE_MAP)) return 'invalid_payload';
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  if (resolveCenter(poiId, ctx) === null) return 'invalid_target';   // no resident → can't place
  return null;
}

export function injectNpcApply(cmd: Command, ctx: ApplyCtx): boolean {
  const fateRole = P(cmd).role as string;
  const role = FATE_ROLE_MAP[fateRole];
  const center = resolveCenter(poiOf(cmd)!, ctx)!;       // validated in precondition
  const spot = findPlacement(ctx.world, center.x, center.y);
  if (!spot) return false;                                // no room → decline cleanly

  const seed = ctx.rng.nextInt(0x7fffffff);
  const props = initNpcProps(ctx.rng.pick(STRANGER_NAMES), role, seed);
  props.birthTick = ctx.now;
  props.homeX = spot.x; props.homeY = spot.y;
  props.beliefs.player.faith = 0;                         // a stranger, yet to believe
  (props as unknown as Record<string, unknown>).fateRole = fateRole;

  let id = '';
  do { id = `npc-f${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
  props.lineageId = id;                                   // founder of its own lineage
  ctx.world.addEntity({ id, kind: 'npc', x: spot.x, y: spot.y, properties: props as unknown as Record<string, unknown> });
  ctx.log.append({ type: 'authored_spawn', entityIds: [id], role, count: 1 });
  return true;
}
```

- [ ] **Step 5: Wire `inject_npc` into the registry**

In `src/sim/command/registry.ts`, add the import near the `editor-verbs` import (around line 19):

```ts
import { injectNpcPrecondition, injectNpcApply } from './authoring-verbs';
```

Replace the existing `inject_npc` entry (around lines 138-141) with:

```ts
  inject_npc: {
    verb: 'inject_npc', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: injectNpcPrecondition,
    apply: injectNpcApply,
    describe: (cmd) => `bring a ${cmd.payload?.role ?? 'stranger'} to ${targetLabel(cmd)}`,
  },
```

(Leave `bias_event` and `nudge_severity` declared/unimplemented — out of scope.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/authoring-verbs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/sim/command/authoring-verbs.ts src/sim/command/editor-verbs.ts src/sim/command/registry.ts tests/unit/authoring-verbs.test.ts
git commit -m "$(printf 'feat(fate): implement inject_npc escalation verb\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Producer gate on `PlotThreadSystem`

**Files:**
- Modify: `src/sim/threads/systems/plot-thread-system.ts`
- Test: `tests/unit/threads/plot-thread-system.test.ts` (add a case)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/threads/plot-thread-system.test.ts` (inside the top-level `describe`, reusing that file's existing imports — it already imports `PlotThreadStore`, `StagingBuffer`, `PlotThreadSystem`, and builds a `SystemContext`; mirror its existing setup helper). Add:

```ts
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { PlotThreadSystem } from '@/sim/threads/systems/plot-thread-system';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile } from '@/core/types';

function gateMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 3; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function gateCtx(log: EventLog, clock: SimClock): SystemContext {
  return { world: new World(gateMap()), spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now: 10 };
}

describe('PlotThreadSystem producer gate', () => {
  it('does NOT run stub producers when isProducerActive returns false', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const threads = new PlotThreadStore();
    const staging = new StagingBuffer();
    // A trial thread parked at `hardship` is exactly what the stub producer arms on.
    const t = threads.open('trial', { kind: 'settlement', poiId: 'p1' }, 0);
    threads.advance(t.id, 'hardship', 1, 0);
    const sys = new PlotThreadSystem(() => threads, () => staging, () => false);
    sys.tick(gateCtx(log, clock));
    expect(staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('DOES run stub producers when the gate is absent (default) or true', () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const threads = new PlotThreadStore();
    const staging = new StagingBuffer();
    const t = threads.open('trial', { kind: 'settlement', poiId: 'p1' }, 0);
    threads.advance(t.id, 'hardship', 1, 0);
    const sys = new PlotThreadSystem(() => threads, () => staging); // no gate ⇒ default on
    sys.tick(gateCtx(log, clock));
    expect(staging.armedByTrigger('discovery').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/threads/plot-thread-system.test.ts`
Expected: FAIL — the gated case still arms a beat (constructor ignores the 3rd arg; stub runs regardless).

- [ ] **Step 3: Add the gate to `PlotThreadSystem`**

In `src/sim/threads/systems/plot-thread-system.ts`, update the constructor and the producer block:

```ts
  /**
   * @param getStore         lazy thread-store getter (restore-safe).
   * @param getStaging       lazy staging-buffer getter; when supplied, producers run.
   * @param isProducerActive optional gate (default ⇒ true). game.ts passes
   *                         `() => llmClientCapable === null` so the deterministic
   *                         stub producers run ONLY as the offline fallback — when
   *                         the Fate brain is active it owns staging (no double-arm).
   */
  constructor(
    private readonly getStore: () => PlotThreadStore,
    private readonly getStaging?: () => StagingBuffer,
    private readonly isProducerActive: () => boolean = () => true,
  ) {}
```

In `tick`, gate the producer loop:

```ts
    const staging = this.getStaging?.();
    if (staging && this.isProducerActive()) {
      const pctx = { world: ctx.world, threads: store, staging, now: ctx.now };
      for (const produce of STUB_PRODUCERS) produce(pctx);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/threads/plot-thread-system.test.ts`
Expected: PASS (both new cases; existing cases unchanged since the default keeps producers on).

- [ ] **Step 5: Commit**

```bash
git add src/sim/threads/systems/plot-thread-system.ts tests/unit/threads/plot-thread-system.test.ts
git commit -m "$(printf 'feat(fate): gate stub producers behind isProducerActive\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `fate-tools.ts` — the `arm_staged_beat` tool + validated parse

**Files:**
- Create: `src/game/fate/fate-tools.ts`
- Test: `tests/unit/fate-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fate-tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { LLMToolCall } from '@/llm/llm-client';
import { FATE_TOOLS, parseFateToolCalls } from '@/game/fate/fate-tools';

function call(args: Record<string, unknown>): LLMToolCall {
  return { id: 'c0', name: 'arm_staged_beat', arguments: args };
}
const ctx = () => ({ validPoiIds: new Set(['poi1', 'poi2']), now: 100 });

describe('FATE_TOOLS', () => {
  it('exposes exactly one tool named arm_staged_beat', () => {
    expect(FATE_TOOLS).toHaveLength(1);
    expect(FATE_TOOLS[0].name).toBe('arm_staged_beat');
  });
});

describe('parseFateToolCalls', () => {
  it('builds an inject_npc discovery beat for a valid subject', () => {
    const beats = parseFateToolCalls(
      [call({ subjectPoiId: 'poi1', threadId: 7, hard: 'inject_npc', role: 'preacher', soft: 'A stranger lingers.' })],
      ctx(),
    );
    expect(beats).toHaveLength(1);
    const b = beats[0];
    expect(b.subject).toEqual({ kind: 'settlement', poiId: 'poi1' });
    expect(b.trigger).toEqual({ kind: 'discovery' });
    expect(b.threadId).toBe(7);
    expect(b.stagedTick).toBe(100);
    expect(b.hard).toHaveLength(1);
    expect(b.hard[0]).toMatchObject({
      verb: 'inject_npc', source: 'fate', target: { kind: 'settlement', poiId: 'poi1' }, payload: { role: 'preacher' },
    });
    expect(b.soft).toEqual({ kind: 'location_vibe', text: 'A stranger lingers.' });
  });

  it('hard:"none" yields a soft-only beat (empty hard)', () => {
    const beats = parseFateToolCalls([call({ subjectPoiId: 'poi2', hard: 'none', soft: 'Unease settles.' })], ctx());
    expect(beats[0].hard).toEqual([]);
    expect(beats[0].soft?.text).toBe('Unease settles.');
  });

  it('drops a call whose subjectPoiId is not a valid subject', () => {
    expect(parseFateToolCalls([call({ subjectPoiId: 'ghost', hard: 'inject_npc' })], ctx())).toHaveLength(0);
  });

  it('defaults an inject_npc with a missing/invalid role to refugee', () => {
    const beats = parseFateToolCalls([call({ subjectPoiId: 'poi1', hard: 'inject_npc' })], ctx());
    expect(beats[0].hard[0].payload).toMatchObject({ role: 'refugee' });
  });

  it('ignores tool calls that are not arm_staged_beat', () => {
    expect(parseFateToolCalls([{ id: 'x', name: 'something_else', arguments: {} }], ctx())).toHaveLength(0);
  });

  it('tolerates undefined calls', () => {
    expect(parseFateToolCalls(undefined, ctx())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/fate-tools.test.ts`
Expected: FAIL — `Cannot find module '@/game/fate/fate-tools'`.

- [ ] **Step 3: Implement `fate-tools.ts`**

Create `src/game/fate/fate-tools.ts`:

```ts
/**
 * fate-tools.ts — the LLM seam for the Fate brain.
 *
 * ONE constrained tool (`arm_staged_beat`). The brain can only stage into a
 * settlement that is already part of an active thread (validated against
 * `validPoiIds` — a drift guard, mirroring the Create panel) so Fate amplifies
 * existing conditions and never invents. A staged beat's hard payload is the
 * `inject_npc` command (latent until discovery); the soft payload is a vibe line.
 * This replaces the deterministic `stageStrangerOnHardship` stub as the producer.
 */
import type { LLMTool, LLMToolCall } from '@/llm/llm-client';
import type { Command } from '@/sim/command/types';
import type { StagedBeat } from '@/sim/threads/staging-types';

export const FATE_ROLES = ['preacher', 'skeptic', 'refugee'] as const;

export const FATE_TOOLS: LLMTool[] = [
  {
    name: 'arm_staged_beat',
    description:
      'Prepare a beat to be discovered at a settlement that is already part of an unfolding thread. ' +
      'The content stays hidden until the player notices that settlement. Stage at most one.',
    parameters: {
      type: 'object',
      properties: {
        subjectPoiId: { type: 'string', description: 'A settlement id from the listed active threads. Required.' },
        threadId: { type: 'integer', description: 'The thread id this beat belongs to (from the list).' },
        hard: {
          type: 'string', enum: ['inject_npc', 'none'],
          description: "'inject_npc' = a stranger arrives; 'none' = atmosphere only.",
        },
        role: {
          type: 'string', enum: ['preacher', 'skeptic', 'refugee'],
          description: 'If hard=inject_npc, who arrives.',
        },
        soft: { type: 'string', description: 'One line of atmosphere/narration primed on discovery.' },
      },
      required: ['subjectPoiId', 'hard'],
    },
  },
];

export interface FateToolCtx {
  validPoiIds: Set<string>;
  now: number;
}

/** Validate the model's tool calls into armable beats; drop anything ungrounded. */
export function parseFateToolCalls(
  calls: LLMToolCall[] | undefined,
  ctx: FateToolCtx,
): Array<Omit<StagedBeat, 'id' | 'status'>> {
  const beats: Array<Omit<StagedBeat, 'id' | 'status'>> = [];
  for (const c of calls ?? []) {
    if (c.name !== 'arm_staged_beat') continue;
    const a = c.arguments as {
      subjectPoiId?: unknown; threadId?: unknown; hard?: unknown; role?: unknown; soft?: unknown;
    };
    const poiId = typeof a.subjectPoiId === 'string' ? a.subjectPoiId : '';
    if (!ctx.validPoiIds.has(poiId)) {
      console.warn('[fate] dropped beat: unknown subjectPoiId', poiId);
      continue;
    }
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
    beats.push(beat);
  }
  return beats;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/fate-tools.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/fate/fate-tools.ts tests/unit/fate-tools.test.ts
git commit -m "$(printf 'feat(fate): arm_staged_beat tool + validated parse\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: `fate-context.ts` — the prompt builder

**Files:**
- Create: `src/game/fate/fate-context.ts`
- Test: `tests/unit/fate-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fate-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import { buildFateContext, describeThreadsForFate, type FateFocus } from '@/game/fate/fate-context';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function resident(id: string): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = 'poi1';
  return { id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> };
}
function state(): GameState {
  const world = new World(map());
  world.addEntity(resident('r1'));
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return {
    world, plotThreads, staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'Test', pois: [{ id: 'poi1', name: 'Northvale' }] },
  } as unknown as GameState;
}

describe('describeThreadsForFate', () => {
  it('lists active settlement threads and collects their poiIds', () => {
    const { text, poiIds } = describeThreadsForFate(state());
    expect(text).toContain('trial');
    expect(text).toContain('poi1');
    expect(text).toContain('Northvale');
    expect([...poiIds]).toEqual(['poi1']);
  });
});

describe('buildFateContext', () => {
  it('produces a system charter and a user block with world + threads + the event, and valid poiIds', () => {
    const focus: FateFocus = { event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 };
    const { system, user, validPoiIds } = buildFateContext(state(), focus);
    expect(system.toLowerCase()).toContain('fate');
    expect(system).toContain('subjectPoiId');
    expect(user).toContain('Northvale');     // from buildWorldSummary / threads
    expect(user).toContain('trial');         // active thread
    expect(user).toContain('climax');        // the triggering event
    expect([...validPoiIds]).toEqual(['poi1']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/fate-context.test.ts`
Expected: FAIL — `Cannot find module '@/game/fate/fate-context'`.

- [ ] **Step 3: Implement `fate-context.ts`**

Create `src/game/fate/fate-context.ts`:

```ts
/**
 * fate-context.ts — builds the Fate brain's prompt.
 *
 * Reuses buildWorldSummary for the world digest and adds a digest of ACTIVE
 * settlement threads + the triggering event. The enumerated settlement poiIds are
 * the only valid `subjectPoiId` values (the tool validator enforces this) — so the
 * brain can only stage into a story the sim already produced.
 */
import type { GameState } from '@/core/state';
import type { SimEvent } from '@/core/events';
import type { ThreadId } from '@/sim/threads/thread-types';
import { buildWorldSummary } from '@/llm/world-summary';

export interface FateFocus {
  event: SimEvent;
  threadId?: ThreadId;
}

const SYSTEM_CHARTER =
  'You are Fate — impersonal and reactive. You amplify and escalate what the mortals\' story already ' +
  'produces; you never invent arbitrary plot. You may PREPARE content to be discovered later, grounded ' +
  'in what is already happening. Use the arm_staged_beat tool at most once, and only with a subjectPoiId ' +
  'listed in the active threads. If nothing warrants escalation, call no tool.';

/** A compact, deterministic digest of active settlement threads + their poiIds. */
export function describeThreadsForFate(state: GameState): { text: string; poiIds: Set<string> } {
  const poiIds = new Set<string>();
  const poiName = new Map<string, string>();
  for (const p of state.worldSeed?.pois ?? []) poiName.set(p.id, p.name ?? p.id);

  const lines: string[] = [];
  for (const t of state.plotThreads.active()) {
    if (t.subject.kind !== 'settlement') continue;       // only settlement subjects are stageable in v1
    const poiId = t.subject.poiId;
    poiIds.add(poiId);
    const name = poiName.get(poiId) ?? poiId;
    lines.push(`- thread ${t.id}: ${t.shapeId} at "${name}" (${poiId}), phase ${t.phase}`);
  }
  const text = lines.length ? `Active threads:\n${lines.join('\n')}` : 'Active threads: none.';
  return { text, poiIds };
}

function describeEvent(ev: SimEvent): string {
  switch (ev.type) {
    case 'thread_opened': return `A new ${ev.shapeId} thread (${ev.threadId}) just opened.`;
    case 'thread_advanced': return `Thread ${ev.threadId} reached a ${ev.weight} beat (phase ${ev.phase}).`;
    case 'thread_resolved': return `Thread ${ev.threadId} ${ev.status}.`;
    default: return `Event: ${ev.type}.`;
  }
}

export function buildFateContext(
  state: GameState,
  focus: FateFocus,
): { system: string; user: string; validPoiIds: Set<string> } {
  const { text: threadsText, poiIds } = describeThreadsForFate(state);
  const user = [
    buildWorldSummary(state),
    threadsText,
    `Triggering event: ${describeEvent(focus.event)}`,
    'Decide whether to prepare one grounded beat to be discovered. Only use a subjectPoiId from the list above.',
  ].join('\n\n');
  return { system: SYSTEM_CHARTER, user, validPoiIds: poiIds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/fate-context.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/fate/fate-context.ts tests/unit/fate-context.test.ts
git commit -m "$(printf 'feat(fate): fate-context prompt builder (threads + event + world digest)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: `fate-brain-service.ts` — the deliberation loop

**Files:**
- Create: `src/game/fate/fate-brain-service.ts`
- Test: `tests/unit/fate-brain-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fate-brain-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(): GameState {
  const world = new World(map());
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
function canned(args: Record<string, unknown>): LLMToolCall[] {
  return [{ id: 'c0', name: 'arm_staged_beat', arguments: args }];
}
function clientArming(threadId = 1): LLMClient {
  return new LLMClient(new MockLLMProvider(0, {
    cannedToolCalls: canned({ subjectPoiId: 'poi1', threadId, hard: 'inject_npc', role: 'preacher', soft: 'A shadow at the gate.' }),
  }));
}
const focus = (): FateFocus => ({ event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 });

describe('FateBrainService', () => {
  it('arms exactly one beat from a tool call and marks the thread staged', async () => {
    const state = makeState();
    const armed: unknown[] = [];
    const brain = new FateBrainService({
      getState: () => state, getCapableClient: () => clientArming(), isScrubbed: () => false,
      onArmed: (b) => armed.push(b),
    });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(1);
    expect(armed).toHaveLength(1);
    expect(state.plotThreads.get(1)!.vars.staged).toBe(1);
  });

  it('no-ops when no capable client is configured', async () => {
    const state = makeState();
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => null, isScrubbed: () => false });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('no-ops while scrubbing', async () => {
    const state = makeState();
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => clientArming(), isScrubbed: () => true });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('arms nothing when the model returns no tool call', async () => {
    const state = makeState();
    const empty = new LLMClient(new MockLLMProvider(0, { cannedToolCalls: [] }));
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => empty, isScrubbed: () => false });
    await brain.deliberate(focus());
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);
  });

  it('is single-flight: a concurrent deliberate while one is in flight no-ops', async () => {
    const state = makeState();
    const brain = new FateBrainService({ getState: () => state, getCapableClient: () => clientArming(), isScrubbed: () => false });
    const a = brain.deliberate(focus());
    const b = brain.deliberate(focus());   // second call sees inFlight === true → no-op
    await Promise.all([a, b]);
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/fate-brain-service.test.ts`
Expected: FAIL — `Cannot find module '@/game/fate/fate-brain-service'`.

- [ ] **Step 3: Implement `fate-brain-service.ts`**

Create `src/game/fate/fate-brain-service.ts`:

```ts
/**
 * fate-brain-service.ts — the autonomous Fate producer.
 *
 * Runs OFF the sim tick (async, like LlmBackfillService), so src/sim/ stays
 * Math.random-free and replay-safe. It reads thread + world state, asks the
 * capable LLM to arm at most one staged beat, validates the result, and arms it
 * on the snapshot-backed StagingBuffer (full-state persistence — no SAVE_VERSION
 * bump). Gated on a capable client + not-scrubbing; single-flight. Replaces the
 * deterministic stageStrangerOnHardship stub as the authoring intelligence.
 */
import type { GameState } from '@/core/state';
import type { LLMClient } from '@/llm/llm-client';
import type { StagedBeat } from '@/sim/threads/staging-types';
import { buildFateContext, type FateFocus } from './fate-context';
import { FATE_TOOLS, parseFateToolCalls } from './fate-tools';

export interface FateBrainDeps {
  getState: () => GameState;
  getCapableClient: () => LLMClient | null;
  isScrubbed: () => boolean;
  onArmed?: (beat: StagedBeat) => void;
}

export class FateBrainService {
  private inFlight = false;

  constructor(private readonly deps: FateBrainDeps) {}

  isReady(): boolean {
    return this.deps.getCapableClient() !== null && !this.deps.isScrubbed() && !this.inFlight;
  }

  async deliberate(focus: FateFocus): Promise<void> {
    if (!this.isReady()) return;
    const client = this.deps.getCapableClient()!;
    this.inFlight = true;
    try {
      const state = this.deps.getState();
      const { system, user, validPoiIds } = buildFateContext(state, focus);
      const res = await client.generateWithTools(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        FATE_TOOLS,
      );
      const beats = parseFateToolCalls(res.toolCalls, { validPoiIds, now: state.clock.now() });
      for (const b of beats) {
        const armed = state.staging.arm(b);
        if (b.threadId !== undefined) {
          const t = state.plotThreads.get(b.threadId);
          if (t) t.vars.staged = 1;            // cooperate with the stub's once-per-thread guard
        }
        this.deps.onArmed?.(armed);
      }
    } catch (err) {
      console.warn('[fate] deliberation failed:', err);   // never swallow — log, arm nothing
    } finally {
      this.inFlight = false;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/fate-brain-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/fate/fate-brain-service.ts tests/unit/fate-brain-service.test.ts
git commit -m "$(printf 'feat(fate): FateBrainService deliberation loop (scrub-gated, single-flight)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: `fate-trigger.ts` — reactive, cooldown'd wake

**Files:**
- Create: `src/game/fate/fate-trigger.ts`
- Test: `tests/unit/fate-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fate-trigger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { FateFocus } from '@/game/fate/fate-context';
import { FateTrigger } from '@/game/fate/fate-trigger';

let nextId = 1;
function appended(event: SimEvent, t = 0): AppendedEvent {
  return { id: nextId++, t, event };
}
const climax: SimEvent = { type: 'thread_advanced', threadId: 5, phase: 'turning', weight: 'climax' };
const rising: SimEvent = { type: 'thread_advanced', threadId: 5, phase: 'hardship', weight: 'rising' };
const opened: SimEvent = { type: 'thread_opened', threadId: 6, shapeId: 'trial', subject: { kind: 'settlement', poiId: 'p1' } };

function harness(opts?: { ready?: boolean; now?: number; cooldown?: number }) {
  const clock = new SimClock();
  let now = opts?.now ?? 1000;
  clock.now = () => now;                      // controllable clock for the test
  const fired: FateFocus[] = [];
  const trig = new FateTrigger({
    clock,
    cooldownTicks: opts?.cooldown ?? 480,
    isReady: () => opts?.ready ?? true,
    onTrigger: (f) => fired.push(f),
  });
  return { trig, fired, setNow: (n: number) => { now = n; } };
}

describe('FateTrigger', () => {
  it('fires on a climax thread_advanced, with the event + threadId as focus', () => {
    const h = harness();
    h.trig.onEvent(appended(climax));
    expect(h.fired).toHaveLength(1);
    expect(h.fired[0].event).toEqual(climax);
    expect(h.fired[0].threadId).toBe(5);
  });

  it('fires on thread_opened', () => {
    const h = harness();
    h.trig.onEvent(appended(opened));
    expect(h.fired).toHaveLength(1);
  });

  it('ignores a non-climax (rising) thread_advanced', () => {
    const h = harness();
    h.trig.onEvent(appended(rising));
    expect(h.fired).toHaveLength(0);
  });

  it('suppresses a second significant event inside the cooldown window', () => {
    const h = harness({ now: 1000, cooldown: 480 });
    h.trig.onEvent(appended(climax));        // fires at 1000
    h.setNow(1300);                          // 300 < 480 → suppressed
    h.trig.onEvent(appended(opened));
    expect(h.fired).toHaveLength(1);
    h.setNow(1500);                          // 500 ≥ 480 → fires again
    h.trig.onEvent(appended(opened));
    expect(h.fired).toHaveLength(2);
  });

  it('does not fire when not ready', () => {
    const h = harness({ ready: false });
    h.trig.onEvent(appended(climax));
    expect(h.fired).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/fate-trigger.test.ts`
Expected: FAIL — `Cannot find module '@/game/fate/fate-trigger'`.

- [ ] **Step 3: Implement `fate-trigger.ts`**

Create `src/game/fate/fate-trigger.ts`:

```ts
/**
 * fate-trigger.ts — decides WHEN to wake the Fate brain.
 *
 * Subscribes to the EventLog and schedules a deliberation only on a SIGNIFICANT
 * recognized-story event (a thread opening, climaxing, or resolving) — so Fate
 * reacts to recognized story, not raw sim noise — throttled by a cooldown so it
 * cannot spam. Stateless beyond `lastTick` (transient runtime state; not sim
 * state). After a reload Fate may deliberate one cycle sooner — harmless.
 */
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { SimClock } from '@/core/clock';
import type { FateFocus } from './fate-context';

export interface FateTriggerDeps {
  clock: SimClock;
  cooldownTicks: number;
  isReady: () => boolean;
  onTrigger: (focus: FateFocus) => void;
}

function isSignificant(ev: SimEvent): boolean {
  if (ev.type === 'thread_opened' || ev.type === 'thread_resolved') return true;
  if (ev.type === 'thread_advanced') return ev.weight === 'climax';
  return false;
}

function threadIdOf(ev: SimEvent): number | undefined {
  if (ev.type === 'thread_opened' || ev.type === 'thread_advanced' || ev.type === 'thread_resolved') {
    return ev.threadId;
  }
  return undefined;
}

export class FateTrigger {
  private lastTick = -Infinity;

  constructor(private readonly deps: FateTriggerDeps) {}

  /** Wire to an EventLog: `attach((fn) => eventLog.subscribe(fn))`. Returns unsubscribe. */
  attach(subscribe: (fn: (e: AppendedEvent) => void) => () => void): () => void {
    return subscribe((e) => this.onEvent(e));
  }

  onEvent(e: AppendedEvent): void {
    if (!isSignificant(e.event)) return;
    if (!this.deps.isReady()) return;
    const now = this.deps.clock.now();
    if (now - this.lastTick < this.deps.cooldownTicks) return;
    this.lastTick = now;
    this.deps.onTrigger({ event: e.event, threadId: threadIdOf(e.event) });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/fate-trigger.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/game/fate/fate-trigger.ts tests/unit/fate-trigger.test.ts
git commit -m "$(printf 'feat(fate): FateTrigger reactive cooldown wake\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Wire into `game.ts` + proof-of-life integration test

**Files:**
- Modify: `src/game.ts`
- Test: `tests/unit/fate-integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/unit/fate-integration.test.ts`. It drives the full prep→discover→materialize loop with the brain in place of the stub: the brain arms an `inject_npc` beat, `StagingActivationSystem` fires it on discovery, the command executor materializes the stranger.

```ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog, type AppendedEvent } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { CommandQueue } from '@/sim/command/command-queue';
import { executeCommand } from '@/sim/command/command-system';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import { LLMClient, MockLLMProvider, type LLMToolCall } from '@/llm/llm-client';
import { initNpcProps, npcProps, queryNpcs } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity, NpcProperties } from '@/core/types';
import type { GameState } from '@/core/state';
import type { SystemContext } from '@/core/scheduler';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import { FATE_ROLE_MAP } from '@/sim/command/authoring-verbs';

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 6; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 6; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 6, height: 6, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function canned(): LLMToolCall[] {
  return [{ id: 'c0', name: 'arm_staged_beat',
            arguments: { subjectPoiId: 'poi1', threadId: 1, hard: 'inject_npc', role: 'preacher', soft: 'A figure waits.' } }];
}

describe('Fate brain integration (prep → discover → materialize)', () => {
  it('brain arms an inject_npc beat; discovering the settlement materializes the stranger', async () => {
    const clock = new SimClock();
    const log = new EventLog(clock);
    const fired: AppendedEvent[] = [];
    log.subscribe(e => { if (e.event.type === 'beat_fired') fired.push(e); });

    const world = new World(map());
    const r = initNpcProps('r1', 'farmer', 7); r.homePoiId = 'poi1'; r.homeX = 3; r.homeY = 3;
    world.addEntity({ id: 'r1', kind: 'npc', x: 3, y: 3, properties: r as unknown as Record<string, unknown> } as Entity);

    const plotThreads = new PlotThreadStore();
    const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
    plotThreads.advance(t.id, 'hardship', 1, 0);
    const staging = new StagingBuffer();

    const state = {
      world, plotThreads, staging, clock,
      worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }] },
    } as unknown as GameState;

    // 1. Brain deliberates → arms one beat.
    const brain = new FateBrainService({
      getState: () => state,
      getCapableClient: () => new LLMClient(new MockLLMProvider(0, { cannedToolCalls: canned() })),
      isScrubbed: () => false,
    });
    const focus: FateFocus = { event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 };
    await brain.deliberate(focus);
    expect(staging.armedByTrigger('discovery')).toHaveLength(1);

    // 2. Discover the settlement → activation fires the beat onto the command queue.
    const discovery = new DiscoveryQueue();
    const queue = new CommandQueue();
    const sys = new StagingActivationSystem(discovery, queue, () => staging, () => plotThreads);
    discovery.push({ subject: { kind: 'settlement', poiId: 'poi1' } });
    const ctx: SystemContext = { world, spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now: 20 };
    sys.tick(ctx);
    expect(fired).toHaveLength(1);

    // 3. Executor drains the queue → the stranger materializes.
    const before = queryNpcs(world).length;
    for (const cmd of queue.drain()) {
      executeCommand(cmd, { world, spirits: new Map(), log, rng: createRng(2), now: 20 });
    }
    const npcs = queryNpcs(world);
    expect(npcs.length).toBe(before + 1);
    const stranger = npcs.find(e => e.id !== 'r1')!;
    const p = npcProps(stranger) as NpcProperties & { fateRole?: string };
    expect(p.role).toBe(FATE_ROLE_MAP.preacher);
    expect(p.fateRole).toBe('preacher');
    expect(p.beliefs.player.faith).toBe(0);
  });
});
```

> API note (verified): `CommandQueue.drain(): Command[]`, `executeCommand(cmd, ApplyCtx): CommandResult`, and `StagingActivationSystem`'s 5th ctor arg `onSoftBeat?` is optional (the 4-arg call below is valid).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/fate-integration.test.ts`
Expected: PASS — it composes the modules from Tasks 1–6 directly (it does not depend on `game.ts`). This is the proof-of-life regression guard; the `game.ts` wiring below is verified separately by `npm run build`. Then proceed to wire `game.ts`.

- [ ] **Step 3: Wire `FateBrainService` + `FateTrigger` into `game.ts`**

In `src/game.ts`, add imports near the other `@/game` imports (around line 52):

```ts
import { FateBrainService } from '@/game/fate/fate-brain-service';
import { FateTrigger } from '@/game/fate/fate-trigger';
```

Add a field near `llmBackfill` (around line 86):

```ts
  private fateBrain!: FateBrainService;
```

Update the `PlotThreadSystem` registration (line ~135) to pass the producer gate:

```ts
    this.scheduler.register(new PlotThreadSystem(
      () => this.state.plotThreads,
      () => this.state.staging,
      () => this.llmClientCapable === null,   // stub runs only as the offline fallback
    ));
```

After the `llmBackfill` is constructed (after the `this.llmBackfill = new LlmBackfillService({ … })` block ending around line 367), construct the brain + trigger:

```ts
    // ── Fate brain (Track 4) — autonomous reactive producer ──────────────────
    this.fateBrain = new FateBrainService({
      getState: () => this.state,
      getCapableClient: () => this.llmClientCapable,
      isScrubbed: () => this.timeline.isScrubbed,
    });
    const fateTrigger = new FateTrigger({
      clock: this.state.clock,
      cooldownTicks: 480,                       // ~5 game-days between deliberations
      isReady: () => this.fateBrain.isReady(),
      onTrigger: (focus) => { void this.fateBrain.deliberate(focus); },
    });
    fateTrigger.attach((fn) => this.state.eventLog.subscribe(fn));
```

- [ ] **Step 4: Run the build + the focused test**

Run: `npm run build`
Expected: TypeScript compiles clean (no type errors in the wiring).

Run: `npx vitest run tests/unit/fate-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game.ts tests/unit/fate-integration.test.ts
git commit -m "$(printf 'feat(fate): wire FateBrainService + FateTrigger into game.ts\n\nProducer gate makes the stub an offline-only fallback. Integration test\nproves brain-arms -> discover -> stranger materializes via inject_npc.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: VISION §2.1 canon update

**Files:**
- Modify: `docs/VISION.md`

- [ ] **Step 1: Locate §2.1**

Run: `grep -n "2.1" docs/VISION.md`
Find the §2.1 section that describes Fate as impersonal & reactive ("amplifies and escalates what the sim already produces").

- [ ] **Step 2: Add the reconciliation paragraph**

At the end of the §2.1 Fate description, insert:

```markdown
**Fate may prepare the stage.** Fate is still reactive: any content it stages must (a) **amplify or escalate an existing sim condition** (a recognized plot thread), never an arbitrary plot device, and (b) be **latent until discovered** — it materializes only when the player's attention reaches its subject. Fate sets out grounded possibilities; the sim and the player's attention decide which become real. (This is the attention/realization cosmology of §2.3 applied to narrative.)
```

- [ ] **Step 3: Verify no other doc contradicts it**

Run: `grep -rn "never inject\|arbitrary plot\|prepare the stage" docs/VISION.md`
Expected: the new paragraph reconciles (does not contradict) the existing "never injects arbitrary plot" line — staging is grounded + discovery-gated, not arbitrary.

- [ ] **Step 4: Commit**

```bash
git add docs/VISION.md
git commit -m "$(printf 'docs(vision): reconcile staging with Fate-is-reactive (the brain landed)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (after all tasks)

- [ ] **Full suite green**

Run: `npm test`
Expected: all tests pass (the existing 1211 + the new Fate tests).

- [ ] **Build clean**

Run: `npm run build`
Expected: TypeScript check + Vite build succeed.

- [ ] **Determinism guard intact**

Run: `npx vitest run tests/unit/no-random-in-sim.test.ts`
Expected: PASS — `src/sim/command/authoring-verbs.ts` uses only `ctx.rng`; the brain/trigger/context/tools live in `src/game/fate/` (outside the guarded sim tree).

Then use **superpowers:finishing-a-development-branch** to complete the work (merge locally to `main` — the user merges locally and does not push unless asked).

---

## Notes for the implementer

- **Determinism:** never use `Math.random`/`Date.now()` in `src/sim/`. `authoring-verbs.ts` is sim-layer → `ctx.rng` only. The Fate brain/trigger/context/tools are game-layer (`src/game/fate/`) and may be async/non-deterministic — they never run inside a sim tick.
- **Persistence is free:** armed beats already serialize inside `Snapshot` via `StagingBuffer.serialize()` (no `SAVE_VERSION` bump). No snapshot changes in this plan.
- **Silent-failure rule:** the brain logs failures via `console.warn('[fate] …')` and arms nothing — never swallow an error into a misleading success.
- **`CommandQueue` method name:** Task 7's test uses `queue.drain()`. If the real method differs, read `src/sim/command/command-queue.ts` and match it; do not invent.
- **Mock LLM:** tests use `new LLMClient(new MockLLMProvider(0, { cannedToolCalls: [...] }))` — never a live network call.
```
