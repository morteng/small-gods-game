# Create Panel — Sub-project 2: Editor Tools + Recorded Authoring Commands (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `editor` capability tier with five god-mode world-edit verbs (`author_spawn_npc`, `author_remove_entity`, `author_modify_npc`, `author_place_object`, `author_move_entity`), apply them through the existing command channel (skipping spirit/power), and record applied editor commands as replayable history so a scrub-back-then-forward reproduces them deterministically.

**Architecture:** Editor verbs are declared on the same `CAPABILITY_REGISTRY` as the divine verbs but with `tier: 'editor'`, `cost: 0`, and structured `payload`. Their precondition/apply logic lives in a new focused module `src/sim/command/editor-verbs.ts`; `registry.ts` stays a thin wiring table. The executor gains an editor branch (skip spirit + power checks) and an `ApplyCtx` (adds `rng` + `now`) so applies can place/seed deterministically. Because the LLM's *choice* is exogenous and non-deterministic, applied editor commands are appended to a new `AuthorCommandLog` (`{tick, command}[]`); on silent replay the executor re-emits the entries due at each tick before draining, so they re-apply against the same restored RNG stream. The executor is registered FIRST, so editor commands apply at a stable point in the tick (and RNG stream) both live and on replay.

**Tech Stack:** TypeScript ESM, Vitest. All `src/sim/` randomness flows through `ctx.rng` (seeded sfc32) — never `Math.random` (guarded by `tests/unit/no-random-in-sim.test.ts`).

**Determinism invariant (load-bearing):** On live, an editor command sits in the queue at tick N alongside rival commands emitted during tick N-1's `RivalSystem`; the executor (registered first) drains them in emission order `[rival_{N-1}, author_N]`. On replay, the executor re-emits the recorded author commands for tick N at the *top* of N's executor tick — after the previous replay frame already re-emitted N-1's rival commands — yielding the same `[rival_{N-1}, author_N]` drain order and thus the same RNG consumption. Recording uses `ctx.now` (the apply tick), and re-emission keys off the same tick, so it is self-consistent.

**Scope:** Five entity-CRUD verbs. NOT in scope (deferred to a later spec): tile/biome/seed mutation; multi-turn read loops; the panel UI (that is SP3); generalizing the input-log to all exogenous commands. `author_remove_entity`'s `filter` supports `{kind?, role?}` only — `near`-in-filter is deferred (note it in code). Placement checks occupancy + walkability + in-bounds + realized but does not pathfind-validate reachability (god-mode; the movement system pathfinds out).

---

## File Structure

- **Create** `src/sim/command/author-command-log.ts` — `AuthorCommandLog` (ordered `{tick, command}[]`; `record`/`at`/`truncateAfter`/`reset`/`all`/`size`).
- **Create** `src/sim/command/editor-verbs.ts` — payload types, validation (precondition) + apply functions for all five editor verbs, plus shared helpers (`findPlacement`, adult name pool). One responsibility: the *effect* of editor verbs.
- **Modify** `src/sim/command/types.ts` — extend `CommandVerb` (+5 editor verbs), add `Command.payload?`, add `'invalid_payload'` to `RejectionReason`, add `ApplyCtx extends CommandCtx { rng; now }`.
- **Modify** `src/sim/command/registry.ts` — `CapabilityDef.tier` gains `'editor'`; `apply` takes `ApplyCtx`; wire five editor entries (delegating to `editor-verbs.ts`).
- **Modify** `src/sim/command/command-system.ts` — editor branch in `previewCommand`; `executeCommand`/`ctxFor` use `ApplyCtx`; executor records applied editor commands (live) and re-emits recorded ones (replay).
- **Modify** `src/core/events.ts` — five `authored_*` `SimEvent` variants.
- **Modify** `src/core/timeline.ts` — accept an `authorLog`; truncate it in `commit` and reset it in `commitSkip`.
- **Modify** `src/game.ts` — construct `AuthorCommandLog`; pass to `CommandExecutorSystem` and `TimelineController`.
- **Modify** `tests/unit/command-system.test.ts` — `ctx()` helper provides `rng` + `now` (now an `ApplyCtx`).
- **Create** `tests/unit/author-command-log.test.ts`, `tests/unit/editor-verbs.test.ts`, `tests/unit/author-replay-parity.test.ts`.

---

## Task 1: Type foundations + ApplyCtx + stub editor registry

Adds the editor verbs to the type system and threads `rng`/`now` into the apply path, with stub registry entries so everything compiles and editor verbs reject `not_implemented` until later tasks fill them in.

**Files:**
- Modify: `src/sim/command/types.ts`
- Modify: `src/sim/command/registry.ts`
- Modify: `src/sim/command/command-system.ts`
- Modify: `src/core/events.ts`
- Modify: `tests/unit/command-system.test.ts`
- Test: `tests/unit/command-system.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/command-system.test.ts` (inside the existing `describe('executeCommand', ...)` or a new describe):

```ts
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';

describe('editor tier (foundation)', () => {
  it('declares the five editor verbs as cost-0 editor-tier capabilities', () => {
    const editorVerbs = ['author_spawn_npc', 'author_remove_entity', 'author_modify_npc', 'author_place_object', 'author_move_entity'] as const;
    for (const v of editorVerbs) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def).toBeDefined();
      expect(def.tier).toBe('editor');
      expect(def.cost).toBe(0);
    }
  });

  it('rejects an unimplemented editor verb with not_implemented', () => {
    const world = new World(tinyMap());
    const res = executeCommand(
      command({ verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, payload: { entityId: 'x' } }),
      ctx(world, new Map()),
    );
    expect(res).toEqual({ status: 'rejected', verb: 'author_remove_entity', source: 'author', reason: 'not_implemented' });
  });
});
```

Update the `ctx()` helper at the top of the file to return an `ApplyCtx`:

```ts
import type { Command, CommandResult } from '@/sim/command/types';
import type { ApplyCtx } from '@/sim/command/types';
// ...
function ctx(world: World, spirits: Map<SpiritId, Spirit>): ApplyCtx {
  return { world, spirits, log: new EventLog(new SimClock()), rng: createRng(1), now: 0 };
}
```

(`createRng` is already imported in this file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/command-system.test.ts`
Expected: FAIL — TS errors: `'author_*'` not in `CommandVerb`; `payload` not on `Command`; `ApplyCtx` not exported; `CAPABILITY_REGISTRY` has no editor keys.

- [ ] **Step 3: Extend the command types**

In `src/sim/command/types.ts`:

Add `Rng` to imports:
```ts
import type { Rng } from '@/core/rng';
```

Extend `CommandVerb`:
```ts
export type CommandVerb =
  // divine tier — implemented, belief-spending interventions
  | 'whisper' | 'omen' | 'dream' | 'miracle' | 'answer_prayer'
  // authoring tier — DECLARED, executor pending (filled in by the Fate cycle)
  | 'bias_event' | 'inject_npc' | 'nudge_severity'
  // editor tier — god-mode world authoring (the Create panel; cost 0, no spirit)
  | 'author_spawn_npc' | 'author_remove_entity' | 'author_modify_npc'
  | 'author_place_object' | 'author_move_entity';
```

Add `payload` to `Command` (after `params`):
```ts
  /** Structured args for editor-tier verbs (entityId, role, coords, …). */
  payload?: Record<string, unknown>;
```

Note the `source` doc — `'author'` is a non-spirit sentinel used only on the editor path. Update the comment:
```ts
  /** Who is acting: 'player', a rival id, 'fate', or 'author' (editor tier). */
  source: SpiritId;
```

Add `'invalid_payload'` to `RejectionReason`:
```ts
export type RejectionReason =
  | 'insufficient_power'
  | 'precondition_failed'
  | 'not_implemented'
  | 'invalid_target'
  | 'invalid_payload'
  | 'unknown_source';
```

Add `ApplyCtx` after `CommandCtx`:
```ts
/**
 * The context an `apply` receives — `CommandCtx` plus the seeded RNG and current
 * tick. Editor verbs need these to place/seed deterministically; divine verbs
 * ignore them. Kept separate from `CommandCtx` so read-only callers
 * (previewCommand, the player UI's optimistic gate) need not supply them.
 */
export interface ApplyCtx extends CommandCtx {
  rng: Rng;
  now: number;
}
```

- [ ] **Step 4: Update the registry — `editor` tier + apply takes `ApplyCtx` + stub entries**

In `src/sim/command/registry.ts`:

Change the `CapabilityDef` tier + apply signature:
```ts
  tier: 'divine' | 'authoring' | 'editor';
```
```ts
  apply?(cmd: Command, ctx: ApplyCtx): boolean;
```
Import `ApplyCtx`:
```ts
import type { Command, CommandCtx, ApplyCtx, CommandVerb, RejectionReason } from './types';
```

Add five stub entries to `CAPABILITY_REGISTRY` (after `nudge_severity`), implemented:false so the executor rejects `not_implemented` until later tasks:
```ts
  // ── Editor tier — god-mode authoring (Create panel). cost 0, no spirit. ──────
  // precondition/apply wired in SP2 tasks 3-6; stubs reject not_implemented.
  author_spawn_npc: {
    verb: 'author_spawn_npc', tier: 'editor', cost: 0, targetKind: 'none', implemented: false,
    describe: (cmd) => `spawn ${(cmd.payload?.count as number) ?? 1}× ${cmd.payload?.role ?? 'npc'}`,
  },
  author_remove_entity: {
    verb: 'author_remove_entity', tier: 'editor', cost: 0, targetKind: 'none', implemented: false,
    describe: (cmd) => `remove ${cmd.payload?.entityId ?? 'entities'}`,
  },
  author_modify_npc: {
    verb: 'author_modify_npc', tier: 'editor', cost: 0, targetKind: 'none', implemented: false,
    describe: (cmd) => `modify ${cmd.payload?.entityId ?? 'an npc'}`,
  },
  author_place_object: {
    verb: 'author_place_object', tier: 'editor', cost: 0, targetKind: 'none', implemented: false,
    describe: (cmd) => `place ${(cmd.payload?.count as number) ?? 1}× ${cmd.payload?.kind ?? 'object'}`,
  },
  author_move_entity: {
    verb: 'author_move_entity', tier: 'editor', cost: 0, targetKind: 'none', implemented: false,
    describe: (cmd) => `move ${cmd.payload?.entityId ?? 'an entity'}`,
  },
```

- [ ] **Step 5: Thread `ApplyCtx` through the executor**

In `src/sim/command/command-system.ts`:

Change `executeCommand`'s ctx type and the system's `ctxFor`:
```ts
import type { Command, CommandCtx, ApplyCtx, CommandResult, RejectionReason } from './types';
```
```ts
/** Validate + apply a single command. Deterministic; no RNG of its own. */
export function executeCommand(cmd: Command, ctx: ApplyCtx): CommandResult {
```
(`previewCommand` keeps `CommandCtx` — it is read-only.)

In `CommandExecutorSystem.tick`, build an `ApplyCtx`:
```ts
    const ctxFor: ApplyCtx = {
      world: ctx.world, spirits: ctx.spirits, log: ctx.log,
      rng: ctx.rng, now: ctx.now,
    };
```

- [ ] **Step 6: Add the `authored_*` SimEvent variants**

In `src/core/events.ts`, add to the `SimEvent` union (after `era_skipped`):
```ts
  | { type: 'authored_spawn';  entityIds: EntityId[]; role: string; count: number }
  | { type: 'authored_remove'; entityIds: EntityId[]; count: number }
  | { type: 'authored_modify'; entityId: EntityId; fields: string[] }
  | { type: 'authored_place';  entityIds: EntityId[]; kind: string; count: number }
  | { type: 'authored_move';   entityId: EntityId; to: { x: number; y: number } }
```
(`describeSimEvent` in `npc-helpers.ts` has a `default` branch, so no exhaustive-switch break; UI display is SP3.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/command-system.test.ts`
Expected: PASS (existing whisper/divine tests + the two new editor-foundation tests).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (Confirms `CAPABILITY_REGISTRY: Record<CommandVerb, CapabilityDef>` now has all 13 keys and the `divine-actions-controller` `CommandCtx` site still type-checks — it only calls `previewCommand`.)

- [ ] **Step 9: Commit**

```bash
git add src/sim/command/types.ts src/sim/command/registry.ts src/sim/command/command-system.ts src/core/events.ts tests/unit/command-system.test.ts
git commit -m "$(cat <<'EOF'
feat(command): editor tier types + ApplyCtx + authored_* events (stubs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: AuthorCommandLog

The replayable record of applied editor commands. Pure data structure; no engine wiring yet.

**Files:**
- Create: `src/sim/command/author-command-log.ts`
- Test: `tests/unit/author-command-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/author-command-log.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import type { Command } from '@/sim/command/types';

function cmd(verb: Command['verb'], payload: Record<string, unknown> = {}): Command {
  return { verb, source: 'author', target: { kind: 'none' }, payload, seq: 0 };
}

describe('AuthorCommandLog', () => {
  it('records and retrieves commands by exact tick', () => {
    const log = new AuthorCommandLog();
    log.record(5, cmd('author_remove_entity', { entityId: 'a' }));
    log.record(5, cmd('author_spawn_npc', { role: 'farmer' }));
    log.record(9, cmd('author_move_entity', { entityId: 'b' }));

    expect(log.at(5).map(c => c.verb)).toEqual(['author_remove_entity', 'author_spawn_npc']);
    expect(log.at(9)).toHaveLength(1);
    expect(log.at(7)).toEqual([]);
    expect(log.size()).toBe(3);
  });

  it('preserves insertion order within a tick', () => {
    const log = new AuthorCommandLog();
    log.record(1, cmd('author_spawn_npc', { role: 'a' }));
    log.record(1, cmd('author_spawn_npc', { role: 'b' }));
    expect(log.at(1).map(c => c.payload?.role)).toEqual(['a', 'b']);
  });

  it('truncateAfter drops entries strictly after the cutoff', () => {
    const log = new AuthorCommandLog();
    log.record(2, cmd('author_remove_entity'));
    log.record(5, cmd('author_remove_entity'));
    log.record(8, cmd('author_remove_entity'));
    log.truncateAfter(5);
    expect(log.all().map(e => e.tick)).toEqual([2, 5]);
  });

  it('reset clears everything', () => {
    const log = new AuthorCommandLog();
    log.record(1, cmd('author_remove_entity'));
    log.reset();
    expect(log.size()).toBe(0);
    expect(log.at(1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/author-command-log.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/sim/command/author-command-log.ts`:

```ts
/**
 * AuthorCommandLog — the replayable record of applied editor (god-mode) commands.
 *
 * Editor edits are exogenous: the LLM's choice is non-deterministic and cannot be
 * re-derived on replay. So we record the *resolved* command keyed by the tick it
 * applied, and the executor re-emits the entries due at each tick during silent
 * replay — they re-apply deterministically against the restored RNG stream.
 *
 * This is history, not transient input: unlike CommandQueue it is NOT cleared on
 * snapshot restore. It truncates on timeline commit/re-roll and resets on a
 * one-way time-skip baseline (no recorded ticks survive a skip to replay against).
 */
import type { Command } from './types';

export interface AuthorEntry {
  tick: number;
  command: Command;
}

export class AuthorCommandLog {
  private entries: AuthorEntry[] = [];

  /** Append an applied editor command at the tick it applied. */
  record(tick: number, command: Command): void {
    this.entries.push({ tick, command });
  }

  /** Commands recorded at exactly `tick`, in insertion order. */
  at(tick: number): Command[] {
    return this.entries.filter(e => e.tick === tick).map(e => e.command);
  }

  /** Drop entries strictly after `cutoff` (mirrors EventLog.truncateAfter). */
  truncateAfter(cutoff: number): void {
    this.entries = this.entries.filter(e => e.tick <= cutoff);
  }

  /** Clear all entries (one-way time-skip baseline). */
  reset(): void {
    this.entries = [];
  }

  all(): readonly AuthorEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/author-command-log.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/command/author-command-log.ts tests/unit/author-command-log.test.ts
git commit -m "$(cat <<'EOF'
feat(command): AuthorCommandLog — replayable record of editor edits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: editor-verbs module + `author_remove_entity` + executor editor branch

Stand up the editor-verbs module with the simplest verb (remove — no RNG), and add the executor's editor-tier path (skip spirit + power).

**Files:**
- Create: `src/sim/command/editor-verbs.ts`
- Modify: `src/sim/command/registry.ts` (wire `author_remove_entity`)
- Modify: `src/sim/command/command-system.ts` (`previewCommand` editor branch)
- Test: `tests/unit/editor-verbs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/editor-verbs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { executeCommand } from '@/sim/command/command-system';
import type { ApplyCtx, Command } from '@/sim/command/types';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, queryNpcs } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function bigMap(n = 12): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function applyCtx(world: World, now = 10): ApplyCtx {
  return { world, spirits: new Map<SpiritId, Spirit>(), log: new EventLog(new SimClock()), rng: createRng(42), now };
}

function npc(id: string, x: number, y: number, mut: (p: NpcProperties) => void = () => {}): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homeX = x; p.homeY = y; p.homePoiId = 'poi1';
  mut(p);
  return { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
}

function authorCmd(verb: Command['verb'], payload: Record<string, unknown>): Command {
  return { verb, source: 'author', target: { kind: 'none' }, payload, seq: 0 };
}

describe('author_remove_entity', () => {
  it('removes a single entity by id', () => {
    const world = new World(bigMap());
    world.addEntity(npc('n1', 2, 2));
    const res = executeCommand(authorCmd('author_remove_entity', { entityId: 'n1' }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(world.registry.get('n1')).toBeUndefined();
  });

  it('rejects a missing entityId with invalid_target', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_remove_entity', { entityId: 'nope' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('removes all entities matching a {kind, role} filter', () => {
    const world = new World(bigMap());
    world.addEntity(npc('b1', 1, 1, p => { p.role = 'beggar'; }));
    world.addEntity(npc('b2', 2, 2, p => { p.role = 'beggar'; }));
    world.addEntity(npc('f1', 3, 3, p => { p.role = 'farmer'; }));
    const res = executeCommand(authorCmd('author_remove_entity', { filter: { kind: 'npc', role: 'beggar' } }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(queryNpcs(world).map(e => e.id).sort()).toEqual(['f1']);
  });

  it('rejects a payload with neither entityId nor filter as invalid_payload', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_remove_entity', {}), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});
```

(Confirm `queryNpcs` is exported from `@/world/npc-helpers`; the Explore confirmed it is used there. If the export name differs, use `world.query({ kind: 'npc' })`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/editor-verbs.test.ts`
Expected: FAIL — `author_remove_entity` is `implemented: false` → rejects `not_implemented`.

- [ ] **Step 3: Create the editor-verbs module with remove**

Create `src/sim/command/editor-verbs.ts`:

```ts
/**
 * editor-verbs.ts — the effect of god-mode authoring (Create panel) verbs.
 *
 * Each verb exposes a `precondition` (read-only payload validation → RejectionReason
 * or null) and an `apply` (the mutation, using ApplyCtx.rng / .now; appends an
 * `authored_*` SimEvent). registry.ts wires these into CapabilityDef entries.
 *
 * All randomness flows through ctx.rng (seeded) — never Math.random.
 */
import type { Entity, NpcProperties, NpcRole } from '@/core/types';
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { npcProps, queryNpcs } from '@/world/npc-helpers';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};

// ── author_remove_entity ─────────────────────────────────────────────────────
// payload: { entityId } | { filter: { kind?, role? } }   (near-filter deferred)

interface RemoveFilter { kind?: string; role?: string }

export function removePrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const entityId = p.entityId as string | undefined;
  const filter = p.filter as RemoveFilter | undefined;
  if (!entityId && !filter) return 'invalid_payload';
  if (entityId && !ctx.world.registry.get(entityId)) return 'invalid_target';
  return null;
}

export function removeApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const entityId = p.entityId as string | undefined;
  const filter = p.filter as RemoveFilter | undefined;

  const targets: Entity[] = entityId
    ? [ctx.world.registry.get(entityId)!]                       // existence checked in precondition
    : matchFilter(ctx, filter!);

  for (const e of targets) ctx.world.removeEntity(e.id);
  ctx.log.append({ type: 'authored_remove', entityIds: targets.map(e => e.id), count: targets.length });
  return true;
}

function matchFilter(ctx: CommandCtx, filter: RemoveFilter): Entity[] {
  let candidates: Entity[] = filter.kind
    ? ctx.world.query({ kind: filter.kind })
    : ctx.world.query({});
  if (filter.role) {
    candidates = candidates.filter(e => e.kind === 'npc' && npcProps(e).role === filter.role);
  }
  return candidates;
}
```

- [ ] **Step 4: Wire `author_remove_entity` into the registry**

In `src/sim/command/registry.ts`, add the import:
```ts
import { removePrecondition, removeApply } from './editor-verbs';
```
Replace the `author_remove_entity` stub with the implemented entry:
```ts
  author_remove_entity: {
    verb: 'author_remove_entity', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: removePrecondition,
    apply: removeApply,
    describe: (cmd) => `remove ${cmd.payload?.entityId ?? `${cmd.payload?.filter ? 'matching entities' : 'entities'}`}`,
  },
```

- [ ] **Step 5: Add the editor branch to `previewCommand`**

In `src/sim/command/command-system.ts`, in `previewCommand`, after the `not_implemented` guard and BEFORE the `unknown_source` / target / power checks, add the editor short-circuit:

```ts
  if (!def.implemented || !def.apply) return 'not_implemented';

  // Editor tier is god-mode: no spirit, no power, payload-based targeting.
  // Validation is entirely the verb's precondition (it inspects cmd.payload).
  if (def.tier === 'editor') {
    return def.precondition?.(cmd, ctx) ?? null;
  }

  if (!ctx.spirits.has(cmd.source)) return 'unknown_source';
  // ... existing target-kind + power + precondition checks unchanged ...
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/unit/editor-verbs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Confirm divine path untouched**

Run: `npx vitest run tests/unit/command-system.test.ts`
Expected: PASS (divine verbs still gated by spirit/power/target; editor-foundation tests now show `author_remove_entity` implemented — the "rejects an unimplemented editor verb" test used `author_remove_entity`; CHANGE that test to use a still-stubbed verb, e.g. `author_modify_npc`, so it stays meaningful).

Edit the Task-1 test in `command-system.test.ts`:
```ts
  it('rejects an unimplemented editor verb with not_implemented', () => {
    const world = new World(tinyMap());
    const res = executeCommand(
      command({ verb: 'author_modify_npc', source: 'author', target: { kind: 'none' }, payload: { entityId: 'x' } }),
      ctx(world, new Map()),
    );
    expect(res).toEqual({ status: 'rejected', verb: 'author_modify_npc', source: 'author', reason: 'not_implemented' });
  });
```

Re-run: `npx vitest run tests/unit/command-system.test.ts` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/sim/command/editor-verbs.ts src/sim/command/registry.ts src/sim/command/command-system.ts tests/unit/editor-verbs.test.ts tests/unit/command-system.test.ts
git commit -m "$(cat <<'EOF'
feat(command): author_remove_entity + editor-tier executor branch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `author_spawn_npc` + placement helper

Spawn NPCs near a target, seeded from `ctx.rng`. Deterministic ids and appearance from the RNG stream.

**Files:**
- Modify: `src/sim/command/editor-verbs.ts`
- Modify: `src/sim/command/registry.ts`
- Test: `tests/unit/editor-verbs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/editor-verbs.test.ts`:

```ts
describe('author_spawn_npc', () => {
  it('spawns `count` npcs near a resident of the given poiId, with belief overrides', () => {
    const world = new World(bigMap());
    world.addEntity(npc('anchor', 6, 6, p => { p.homePoiId = 'poi1'; }));
    const before = queryNpcs(world).length;

    const res = executeCommand(authorCmd('author_spawn_npc', {
      role: 'farmer', count: 3, near: 'poi1', faith: 0.9, understanding: 0.4, devotion: 0.2,
    }), applyCtx(world));

    expect(res.status).toBe('applied');
    const after = queryNpcs(world);
    expect(after.length).toBe(before + 3);
    const spawned = after.filter(e => e.id !== 'anchor');
    for (const e of spawned) {
      const b = npcProps(e).beliefs.player;
      expect(b.faith).toBeCloseTo(0.9);
      expect(b.understanding).toBeCloseTo(0.4);
      expect(b.devotion).toBeCloseTo(0.2);
      expect(npcProps(e).role).toBe('farmer');
      // placed on a distinct, walkable, unoccupied tile
      expect(world.tiles.tiles[e.y][e.x].walkable).toBe(true);
    }
    // distinct tiles
    const coords = new Set(spawned.map(e => `${e.x},${e.y}`));
    expect(coords.size).toBe(3);
  });

  it('spawns at explicit coords when near is {x,y}', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_spawn_npc', { role: 'priest', near: { x: 5, y: 5 } }), applyCtx(world));
    expect(res.status).toBe('applied');
    expect(queryNpcs(world).length).toBe(1);
  });

  it('rejects when near is a poiId with no residents and no coords (invalid_target)', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_spawn_npc', { role: 'farmer', near: 'ghost-town' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects a missing role with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(npc('anchor', 6, 6));
    const res = executeCommand(authorCmd('author_spawn_npc', { near: 'poi1' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });

  it('is deterministic: same rng seed → same spawned ids', () => {
    const ids = (seed: number) => {
      const world = new World(bigMap());
      world.addEntity(npc('anchor', 6, 6));
      executeCommand(authorCmd('author_spawn_npc', { role: 'farmer', count: 2, near: 'poi1' }),
        { world, spirits: new Map<SpiritId, Spirit>(), log: new EventLog(new SimClock()), rng: createRng(seed), now: 10 });
      return queryNpcs(world).filter(e => e.id !== 'anchor').map(e => e.id).sort();
    };
    expect(ids(123)).toEqual(ids(123));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/editor-verbs.test.ts -t author_spawn_npc`
Expected: FAIL — `author_spawn_npc` still a stub (`not_implemented`).

- [ ] **Step 3: Implement spawn + placement helper**

Append to `src/sim/command/editor-verbs.ts`:

```ts
import { initNpcProps } from '@/world/npc-helpers';

const VALID_ROLES: NpcRole[] = ['priest', 'elder', 'farmer', 'merchant', 'soldier', 'noble', 'child', 'beggar'];
const ADULT_NAMES = ['Aldous', 'Bryn', 'Corin', 'Dara', 'Edda', 'Faro', 'Gwen', 'Hale', 'Ivo', 'Juna', 'Kess', 'Lorn'];

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Resolve the spawn center from a `near` payload (poiId via a resident, or {x,y}). */
function resolveCenter(near: unknown, ctx: CommandCtx): { x: number; y: number } | null {
  if (near && typeof near === 'object' && 'x' in (near as object) && 'y' in (near as object)) {
    const n = near as { x: number; y: number };
    return { x: Math.round(n.x), y: Math.round(n.y) };
  }
  if (typeof near === 'string') {
    const resident = queryNpcs(ctx).find(e => npcProps(e).homePoiId === near);
    if (resident) return { x: resident.x, y: resident.y };
  }
  return null;
}

/**
 * Find the nearest in-bounds, realized, walkable, unoccupied tile to (cx,cy),
 * scanning outward in rings. Returns null if none within maxRadius.
 */
export function findPlacement(
  world: CommandCtx['world'], cx: number, cy: number, maxRadius = 6,
): { x: number; y: number } | null {
  const map = world.tiles;
  const ok = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const t = map.tiles[y]?.[x];
    if (!t || !t.walkable || t.state !== 'realized') return false;
    return world.registry.canPlace(x, y, 1, 1, 0);
  };
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring shell only
        const x = cx + dx, y = cy + dy;
        if (ok(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function spawnPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const role = p.role as string | undefined;
  if (!role || !VALID_ROLES.includes(role as NpcRole)) return 'invalid_payload';
  if (resolveCenter(p.near, ctx) === null) return 'invalid_target';
  return null;
}

export function spawnApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const role = p.role as NpcRole;
  const count = Math.max(1, Math.min(20, Math.floor((p.count as number) ?? 1)));
  const center = resolveCenter(p.near, ctx)!;             // validated in precondition

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const spot = findPlacement(ctx.world, center.x, center.y);
    if (!spot) break;                                      // ran out of room; spawn fewer
    const seed = ctx.rng.nextInt(0x7fffffff);
    const name = (p.name as string) ?? ctx.rng.pick(ADULT_NAMES);
    const props = initNpcProps(name, role, seed);
    props.birthTick = ctx.now;
    props.homeX = spot.x; props.homeY = spot.y;
    if (p.faith !== undefined) props.beliefs.player.faith = clamp01(p.faith as number);
    if (p.understanding !== undefined) props.beliefs.player.understanding = clamp01(p.understanding as number);
    if (p.devotion !== undefined) props.beliefs.player.devotion = clamp01(p.devotion as number);

    let id = '';
    do { id = `npc-a${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
    props.lineageId = id;                                  // founder of its own lineage
    ctx.world.addEntity({ id, kind: 'npc', x: spot.x, y: spot.y, properties: props as unknown as Record<string, unknown> });
    ids.push(id);
  }
  ctx.log.append({ type: 'authored_spawn', entityIds: ids, role, count: ids.length });
  return true;
}
```

NOTE: `queryNpcs` is called with `ctx` (a `CommandCtx`) in `resolveCenter`/`removeApply` — confirm `queryNpcs` accepts the world. The Explore showed `queryNpcs(world)`. Adjust calls to `queryNpcs(ctx.world)` if `queryNpcs` takes a `World`, not a ctx. (Use `ctx.world` consistently.)

Fix the two `queryNpcs(ctx)` / `queryNpcs(ctx.world)` call sites to pass `ctx.world`.

- [ ] **Step 4: Wire spawn into the registry**

In `src/sim/command/registry.ts`, extend the import:
```ts
import { removePrecondition, removeApply, spawnPrecondition, spawnApply } from './editor-verbs';
```
Replace the `author_spawn_npc` stub:
```ts
  author_spawn_npc: {
    verb: 'author_spawn_npc', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: spawnPrecondition,
    apply: spawnApply,
    describe: (cmd) => `spawn ${(cmd.payload?.count as number) ?? 1}× ${cmd.payload?.role ?? 'npc'}`,
  },
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/editor-verbs.test.ts`
Expected: PASS (remove + spawn describes).

- [ ] **Step 6: Run the no-random guard**

Run: `npx vitest run tests/unit/no-random-in-sim.test.ts`
Expected: PASS (editor-verbs.ts uses only `ctx.rng`, no `Math.random`). NOTE: `clamp01` uses `Math.max/min` — that's fine; the guard targets `Math.random` specifically.

- [ ] **Step 7: Commit**

```bash
git add src/sim/command/editor-verbs.ts src/sim/command/registry.ts tests/unit/editor-verbs.test.ts
git commit -m "$(cat <<'EOF'
feat(command): author_spawn_npc with seeded placement + belief overrides

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `author_modify_npc`

Edit fields on an existing NPC. Scalar/belief fields are mutated in place via `npcProps` (not indexed); identity stays.

**Files:**
- Modify: `src/sim/command/editor-verbs.ts`
- Modify: `src/sim/command/registry.ts`
- Test: `tests/unit/editor-verbs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/editor-verbs.test.ts`:

```ts
describe('author_modify_npc', () => {
  it('sets name, role, belief, mood, and activity on an existing npc', () => {
    const world = new World(bigMap());
    world.addEntity(npc('m1', 4, 4, p => { p.beliefs.player = { faith: 0.1, understanding: 0.1, devotion: 0.1 }; }));
    const res = executeCommand(authorCmd('author_modify_npc', {
      entityId: 'm1',
      set: { name: 'Brother Aldous', role: 'priest', faith: 0.95, understanding: 0.6, devotion: 0.7, mood: 0.8, activity: 'worship' },
    }), applyCtx(world));

    expect(res.status).toBe('applied');
    const p = npcProps(world.registry.get('m1')!);
    expect(p.name).toBe('Brother Aldous');
    expect(p.role).toBe('priest');
    expect(p.beliefs.player.faith).toBeCloseTo(0.95);
    expect(p.beliefs.player.understanding).toBeCloseTo(0.6);
    expect(p.beliefs.player.devotion).toBeCloseTo(0.7);
    expect(p.mood).toBeCloseTo(0.8);
    expect(p.activity).toBe('worship');
  });

  it('rejects a missing entity with invalid_target', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_modify_npc', { entityId: 'ghost', set: { faith: 0.5 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects a non-npc target with invalid_target', () => {
    const world = new World(bigMap());
    world.addEntity({ id: 'rock', kind: 'boulder', x: 1, y: 1 });
    const res = executeCommand(authorCmd('author_modify_npc', { entityId: 'rock', set: { faith: 0.5 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects an empty/missing set with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(npc('m2', 4, 4));
    const res = executeCommand(authorCmd('author_modify_npc', { entityId: 'm2' }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/editor-verbs.test.ts -t author_modify_npc`
Expected: FAIL — stub `not_implemented`.

- [ ] **Step 3: Implement modify**

Append to `src/sim/command/editor-verbs.ts`:

```ts
// ── author_modify_npc ────────────────────────────────────────────────────────
// payload: { entityId, set: { name?, role?, faith?, understanding?, devotion?,
//            needs?, mood?, activity? } }   (targets the 'player' spirit's belief)

interface ModifySet {
  name?: string; role?: NpcRole;
  faith?: number; understanding?: number; devotion?: number;
  needs?: Partial<NpcProperties['needs']>; mood?: number;
  activity?: NpcProperties['activity'];
}

export function modifyPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const entityId = p.entityId as string | undefined;
  const set = p.set as ModifySet | undefined;
  if (!set || Object.keys(set).length === 0) return 'invalid_payload';
  if (!entityId) return 'invalid_payload';
  const e = ctx.world.registry.get(entityId);
  if (!e || e.kind !== 'npc') return 'invalid_target';
  if (set.role && !VALID_ROLES.includes(set.role)) return 'invalid_payload';
  return null;
}

export function modifyApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const entityId = p.entityId as string;
  const set = p.set as ModifySet;
  const props = npcProps(ctx.world.registry.get(entityId)!);
  const fields: string[] = [];

  if (set.name !== undefined) { props.name = set.name; fields.push('name'); }
  if (set.role !== undefined) { props.role = set.role; fields.push('role'); }
  const belief = props.beliefs.player ?? (props.beliefs.player = { faith: 0, understanding: 0, devotion: 0 });
  if (set.faith !== undefined) { belief.faith = clamp01(set.faith); fields.push('faith'); }
  if (set.understanding !== undefined) { belief.understanding = clamp01(set.understanding); fields.push('understanding'); }
  if (set.devotion !== undefined) { belief.devotion = clamp01(set.devotion); fields.push('devotion'); }
  if (set.mood !== undefined) { props.mood = clamp01(set.mood); fields.push('mood'); }
  if (set.activity !== undefined) { props.activity = set.activity; fields.push('activity'); }
  if (set.needs) {
    for (const [k, v] of Object.entries(set.needs)) {
      (props.needs as Record<string, number>)[k] = clamp01(v as number);
    }
    fields.push('needs');
  }

  ctx.log.append({ type: 'authored_modify', entityId, fields });
  return true;
}
```

(Belief fields target the `player` spirit by default — consistent with `initNpcProps`. Multi-spirit modify is out of scope for v1.)

- [ ] **Step 4: Wire into registry**

Import + replace stub in `src/sim/command/registry.ts`:
```ts
import { /* …, */ modifyPrecondition, modifyApply } from './editor-verbs';
```
```ts
  author_modify_npc: {
    verb: 'author_modify_npc', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: modifyPrecondition,
    apply: modifyApply,
    describe: (cmd) => `modify ${cmd.payload?.entityId ?? 'an npc'}`,
  },
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run tests/unit/editor-verbs.test.ts` → PASS.

```bash
git add src/sim/command/editor-verbs.ts src/sim/command/registry.ts tests/unit/editor-verbs.test.ts
git commit -m "$(cat <<'EOF'
feat(command): author_modify_npc (identity/belief/mood/activity edits)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `author_place_object` + `author_move_entity`

The last two verbs: place validated entity-kinds, and move an entity (via `updateEntity` to keep indexes in sync).

**Files:**
- Modify: `src/sim/command/editor-verbs.ts`
- Modify: `src/sim/command/registry.ts`
- Test: `tests/unit/editor-verbs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/editor-verbs.test.ts`:

```ts
import { listEntityKinds } from '@/world/entity-kinds'; // if available; else hard-code a known kind

describe('author_place_object', () => {
  it('places `count` objects of a valid kind near (x,y) on distinct tiles', () => {
    const world = new World(bigMap());
    // pick a real kind id; 'well' is a prop per the layer-visibility mapping
    const res = executeCommand(authorCmd('author_place_object', { kind: 'well', x: 5, y: 5, count: 2 }), applyCtx(world));
    expect(res.status).toBe('applied');
    const placed = world.query({ kind: 'well' });
    expect(placed.length).toBe(2);
    const coords = new Set(placed.map(e => `${e.x},${e.y}`));
    expect(coords.size).toBe(2);
  });

  it('rejects an unknown kind with invalid_payload', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_place_object', { kind: 'not_a_kind', x: 2, y: 2 }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});

describe('author_move_entity', () => {
  it('moves an entity to new coords and keeps the spatial index in sync', () => {
    const world = new World(bigMap());
    world.addEntity(npc('mv', 1, 1));
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'mv', to: { x: 7, y: 8 } }), applyCtx(world));
    expect(res.status).toBe('applied');
    const e = world.registry.get('mv')!;
    expect([e.x, e.y]).toEqual([7, 8]);
    // spatial index reflects the move (query the new region finds it, old does not)
    expect(world.query({ region: { x: 7, y: 8, w: 1, h: 1 } }).map(x => x.id)).toContain('mv');
    expect(world.query({ region: { x: 1, y: 1, w: 1, h: 1 } }).map(x => x.id)).not.toContain('mv');
  });

  it('rejects a missing entity with invalid_target', () => {
    const world = new World(bigMap());
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'ghost', to: { x: 2, y: 2 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_target' });
  });

  it('rejects out-of-bounds coords with invalid_payload', () => {
    const world = new World(bigMap());
    world.addEntity(npc('mv2', 1, 1));
    const res = executeCommand(authorCmd('author_move_entity', { entityId: 'mv2', to: { x: 999, y: 0 } }), applyCtx(world));
    expect(res).toMatchObject({ status: 'rejected', reason: 'invalid_payload' });
  });
});
```

NOTE: confirm a valid prop kind id (`'well'`) exists in `entity-kinds.ts`; if not, substitute any real kind id. If `listEntityKinds` is not exported, remove that import (it is only illustrative).

Also confirm `Region` is `{ x, y, w, h }` (the Explore showed `query({ region })` with `{x,y,w,h}`); adjust the region literals if the field names differ.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/editor-verbs.test.ts -t "author_place_object|author_move_entity"`
Expected: FAIL — both stubs `not_implemented`.

- [ ] **Step 3: Implement place + move**

Append to `src/sim/command/editor-verbs.ts`:

```ts
import { tryGetEntityKindDef } from '@/world/entity-kinds';

// ── author_place_object ──────────────────────────────────────────────────────
// payload: { kind, x, y, count?, scatterRadius? }

export function placePrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const kind = p.kind as string | undefined;
  if (!kind || !tryGetEntityKindDef(kind)) return 'invalid_payload';
  if (typeof p.x !== 'number' || typeof p.y !== 'number') return 'invalid_payload';
  const map = ctx.world.tiles;
  if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return 'invalid_payload';
  return null;
}

export function placeApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const kind = p.kind as string;
  const count = Math.max(1, Math.min(50, Math.floor((p.count as number) ?? 1)));
  const radius = Math.max(1, Math.min(12, Math.floor((p.scatterRadius as number) ?? Math.ceil(Math.sqrt(count)))));
  const cx = Math.round(p.x as number), cy = Math.round(p.y as number);

  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const spot = findPlacement(ctx.world, cx, cy, radius);
    if (!spot) break;
    let id = '';
    do { id = `${kind}-a${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
    const def = tryGetEntityKindDef(kind)!;
    ctx.world.addEntity({ id, kind, x: spot.x, y: spot.y, tags: def.defaultTags });
    ids.push(id);
  }
  ctx.log.append({ type: 'authored_place', entityIds: ids, kind, count: ids.length });
  return true;
}

// ── author_move_entity ───────────────────────────────────────────────────────
// payload: { entityId, to: { x, y } }

export function movePrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const p = P(cmd);
  const entityId = p.entityId as string | undefined;
  const to = p.to as { x?: number; y?: number } | undefined;
  if (!to || typeof to.x !== 'number' || typeof to.y !== 'number') return 'invalid_payload';
  const map = ctx.world.tiles;
  if (to.x < 0 || to.y < 0 || to.x >= map.width || to.y >= map.height) return 'invalid_payload';
  if (!entityId || !ctx.world.registry.get(entityId)) return 'invalid_target';
  return null;
}

export function moveApply(cmd: Command, ctx: ApplyCtx): boolean {
  const p = P(cmd);
  const entityId = p.entityId as string;
  const to = p.to as { x: number; y: number };
  ctx.world.updateEntity(entityId, { x: Math.round(to.x), y: Math.round(to.y) });
  ctx.log.append({ type: 'authored_move', entityId, to: { x: Math.round(to.x), y: Math.round(to.y) } });
  return true;
}
```

- [ ] **Step 4: Wire both into the registry**

Import + replace stubs in `src/sim/command/registry.ts`:
```ts
import { /* …, */ placePrecondition, placeApply, movePrecondition, moveApply } from './editor-verbs';
```
```ts
  author_place_object: {
    verb: 'author_place_object', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: placePrecondition,
    apply: placeApply,
    describe: (cmd) => `place ${(cmd.payload?.count as number) ?? 1}× ${cmd.payload?.kind ?? 'object'}`,
  },
  author_move_entity: {
    verb: 'author_move_entity', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: movePrecondition,
    apply: moveApply,
    describe: (cmd) => `move ${cmd.payload?.entityId ?? 'an entity'}`,
  },
```

- [ ] **Step 5: Run + guard + commit**

Run: `npx vitest run tests/unit/editor-verbs.test.ts` → PASS (all five verbs).
Run: `npx vitest run tests/unit/no-random-in-sim.test.ts` → PASS.

```bash
git add src/sim/command/editor-verbs.ts src/sim/command/registry.ts tests/unit/editor-verbs.test.ts
git commit -m "$(cat <<'EOF'
feat(command): author_place_object + author_move_entity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Recording + replay re-emission + wiring

Make applied editor commands replayable: the executor records them live and re-emits them on silent replay; the timeline truncates the log on commit/skip; `game.ts` constructs and shares the log.

**Files:**
- Modify: `src/sim/command/command-system.ts` (record + replay re-emit)
- Modify: `src/core/timeline.ts` (own + truncate the log)
- Modify: `src/game.ts` (construct + wire)
- Test: `tests/unit/command-system.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/command-system.test.ts`:

```ts
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import { SilentEventLog } from '@/core/events';
import type { SystemContext } from '@/core/scheduler';

describe('CommandExecutorSystem — author recording & replay', () => {
  function sysCtx(world: World, log: EventLog, now: number): SystemContext {
    return { world, spirits: new Map(), log, clock: new SimClock(), rng: createRng(1), dt: 16, now };
  }

  it('records an applied editor command (live) with the apply tick', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('victim', () => {}));
    const queue = new CommandQueue();
    const authorLog = new AuthorCommandLog();
    const sys = new CommandExecutorSystem(queue, undefined, authorLog);

    queue.emit({ verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, payload: { entityId: 'victim' } });
    sys.tick(sysCtx(world, new EventLog(new SimClock()), 42));

    expect(world.registry.get('victim')).toBeUndefined();
    expect(authorLog.at(42)).toHaveLength(1);
    expect(authorLog.at(42)[0].verb).toBe('author_remove_entity');
  });

  it('does NOT record during silent replay, and re-emits recorded commands', () => {
    const world = new World(tinyMap());
    world.addEntity(worldNpc('victim', () => {}));
    const queue = new CommandQueue();
    const authorLog = new AuthorCommandLog();
    // pre-seed the log as if recorded on a prior live run at tick 42
    authorLog.record(42, { verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, payload: { entityId: 'victim' }, seq: 0 });

    const sys = new CommandExecutorSystem(queue, undefined, authorLog);
    // replay: log is a SilentEventLog; queue is empty (cleared on restore)
    sys.tick(sysCtx(world, new SilentEventLog(new SimClock()), 42));

    expect(world.registry.get('victim')).toBeUndefined(); // re-applied from the log
    expect(authorLog.size()).toBe(1);                      // not double-recorded
  });

  it('does not record rejected or non-editor commands', () => {
    const world = new World(tinyMap());
    const queue = new CommandQueue();
    const authorLog = new AuthorCommandLog();
    const sys = new CommandExecutorSystem(queue, undefined, authorLog);
    queue.emit({ verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, payload: { entityId: 'nope' } });
    sys.tick(sysCtx(world, new EventLog(new SimClock()), 5));
    expect(authorLog.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/command-system.test.ts -t "author recording"`
Expected: FAIL — `CommandExecutorSystem` takes only `(queue, onResult)`; no recording/replay logic.

- [ ] **Step 3: Implement record + replay in the executor**

In `src/sim/command/command-system.ts`:

Add imports:
```ts
import { getCapability } from './registry';
import { SilentEventLog } from '@/core/events';
import type { AuthorCommandLog } from './author-command-log';
```

Extend the constructor and `tick`:
```ts
export class CommandExecutorSystem implements System {
  readonly name = 'command-executor';
  readonly tickHz = 60;

  constructor(
    private readonly queue: CommandQueue,
    private readonly onResult?: (r: CommandResult) => void,
    private readonly authorLog?: AuthorCommandLog,
  ) {}

  tick(ctx: SystemContext): void {
    const ctxFor: ApplyCtx = {
      world: ctx.world, spirits: ctx.spirits, log: ctx.log,
      rng: ctx.rng, now: ctx.now,
    };
    const replaying = ctx.log instanceof SilentEventLog;

    // Replay: re-emit recorded author commands due at this tick BEFORE draining,
    // so they re-apply in the same drain order (and RNG position) as live.
    if (replaying && this.authorLog) {
      for (const c of this.authorLog.at(ctx.now)) {
        this.queue.emit({ verb: c.verb, source: c.source, target: c.target, params: c.params, payload: c.payload });
      }
    }

    for (const cmd of this.queue.drain()) {
      const result = executeCommand(cmd, ctxFor);
      // Live only: record applied editor commands as replayable history.
      if (!replaying && this.authorLog && result.status === 'applied'
          && getCapability(cmd.verb)?.tier === 'editor') {
        this.authorLog.record(ctx.now, cmd);
      }
      this.onResult?.(result);
    }
  }
}
```

- [ ] **Step 4: Run executor tests**

Run: `npx vitest run tests/unit/command-system.test.ts`
Expected: PASS.

- [ ] **Step 5: Timeline truncation — write the failing test**

Append to `tests/unit/timeline.test.ts` (or create `tests/unit/timeline-author-log.test.ts` if the suite is large — match the existing timeline test file location). Minimal direct test:

```ts
import { AuthorCommandLog } from '@/sim/command/author-command-log';
// ... existing timeline test harness imports ...

it('truncates the author command log on commit', () => {
  const authorLog = new AuthorCommandLog();
  authorLog.record(3, { verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, seq: 0 });
  authorLog.record(20, { verb: 'author_remove_entity', source: 'author', target: { kind: 'none' }, seq: 0 });
  const tl = makeTimeline({ authorLog }); // extend the harness to pass authorLog
  // scrub to before tick 20, commit
  tl.jumpTo(3);
  tl.commit({ reroll: false });
  expect(authorLog.all().map(e => e.tick)).toEqual([3]);
});
```

(Adapt to the existing `timeline.test.ts` harness; the key assertion is that `commit` truncates the log at the cutoff.)

- [ ] **Step 6: Implement timeline ownership**

In `src/core/timeline.ts`:

Add to `TimelineOptions`:
```ts
  /** Replayable editor-command log; truncated on commit, reset on skip. */
  authorLog?: AuthorCommandLog;
```
Import:
```ts
import type { AuthorCommandLog } from '@/sim/command/author-command-log';
```
Store it:
```ts
  private readonly authorLog?: AuthorCommandLog;
  // in constructor:
  this.authorLog = opts.authorLog;
```
In `commit`, after `this.store.truncateAfter(cutoff);`:
```ts
    this.authorLog?.truncateAfter(cutoff);
```
In `commitSkip`, after `this.store.reset();`:
```ts
    this.authorLog?.reset();
```

- [ ] **Step 7: Wire into `game.ts`**

In `src/game.ts`:
- Add a field near `commandQueue` (line ~61): `private authorLog = new AuthorCommandLog();` and import it.
- Pass it as the 3rd arg to `CommandExecutorSystem` (line ~97):
```ts
this.scheduler.register(new CommandExecutorSystem(this.commandQueue, (r) => {
  if (r.status === 'rejected' && r.source === 'player') {
    console.debug('[command] player command rejected:', r.verb, r.reason);
  }
}, this.authorLog));
```
- Find where `TimelineController` is constructed in `game.ts` and add `authorLog: this.authorLog` to its options. Also confirm the existing `onRestore` already calls `this.commandQueue.clear()` (it must — the queue is transient). Do NOT clear `authorLog` on restore (it is history).

Import in `game.ts`:
```ts
import { AuthorCommandLog } from '@/sim/command/author-command-log';
```

- [ ] **Step 8: Typecheck + run**

Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run tests/unit/command-system.test.ts tests/unit/timeline.test.ts` → PASS.

- [ ] **Step 9: Commit**

```bash
git add src/sim/command/command-system.ts src/core/timeline.ts src/game.ts tests/unit/command-system.test.ts tests/unit/timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(command): record + replay editor commands; wire AuthorCommandLog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Replay-parity integration test + full suite

The load-bearing test: author-edit a world, let it run, scrub back before the edit, replay forward, and assert the edit reappears identically.

**Files:**
- Create: `tests/unit/author-replay-parity.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/unit/author-replay-parity.test.ts`. Build the smallest harness that uses a real `Scheduler` + `CommandExecutorSystem` (registered first) + `TimelineController` + `AuthorCommandLog`, mirroring `game.ts` wiring. Drive ticks via `scheduler.tick`. The test:

1. Set up `GameState` (clock, rng, eventLog, world with a tiny realized map, spirits map with a `player`).
2. Register `CommandExecutorSystem(queue, undefined, authorLog)` FIRST on the scheduler.
3. Run several live ticks (via the same loop `game.ts` uses) capturing snapshots through `TimelineController.onAfterLiveTick()`.
4. At a known tick, emit `author_spawn_npc` (count 2) onto the queue; tick once so it applies; record the spawned ids and the count of NPCs.
5. Run more live ticks.
6. `timeline.jumpTo(tickBeforeSpawn)` → assert the spawned NPCs are GONE (restored to pre-spawn snapshot or replayed up to before the spawn).
7. `timeline.jumpTo(tickAfterSpawn)` → assert the spawned NPCs REAPPEAR with the **same ids** (deterministic re-application from the AuthorCommandLog against the restored RNG stream).
8. Assert NPC count matches the original live count at that tick.

Concretely:

```ts
import { describe, it, expect } from 'vitest';
import { Scheduler } from '@/core/scheduler';
import { CommandQueue } from '@/sim/command/command-queue';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import { TimelineController } from '@/core/timeline';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, queryNpcs } from '@/world/npc-helpers';
import type { GameState } from '@/core/state';
import type { GameMap, Entity, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function realizedMap(n = 12): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function anchorNpc(): Entity {
  const p = initNpcProps('anchor', 'farmer', 7);
  p.homePoiId = 'poi1'; p.homeX = 6; p.homeY = 6;
  return { id: 'anchor', kind: 'npc', x: 6, y: 6, properties: p as unknown as Record<string, unknown> };
}

function setup() {
  const clock = new SimClock();
  const map = realizedMap();
  const world = new World(map);
  world.addEntity(anchorNpc());
  const spirits = new Map<SpiritId, Spirit>([['player', { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 100, manifestation: null }]]);
  const eventLog = new EventLog(clock);
  const state = { clock, map, world, spirits, eventLog, rng: createRng(999) } as unknown as GameState;

  const queue = new CommandQueue();
  const authorLog = new AuthorCommandLog();
  const scheduler = new Scheduler();
  scheduler.register(new CommandExecutorSystem(queue, undefined, authorLog)); // FIRST

  const timeline = new TimelineController({
    state, scheduler, snapshotEveryNEvents: 1, authorLog,
    onRestore: () => queue.clear(),
  });

  const STEP = 1000 / 60;
  const baseCtx = () => ({ world: state.world!, spirits: state.spirits, log: state.eventLog, clock: state.clock, rng: state.rng });
  const liveTick = () => { scheduler.tick(STEP, baseCtx()); timeline.onAfterLiveTick(); };

  return { state, queue, authorLog, scheduler, timeline, liveTick };
}

describe('author edit replay parity', () => {
  it('a spawned cohort disappears when scrubbed before the edit and reappears identically when scrubbed past it', () => {
    const { state, queue, timeline, liveTick } = setup();

    for (let i = 0; i < 5; i++) liveTick();
    const spawnTick = state.clock.now();

    queue.emit({ verb: 'author_spawn_npc', source: 'author', target: { kind: 'none' }, payload: { role: 'farmer', count: 2, near: 'poi1' } });
    liveTick(); // applies the spawn at spawnTick (+1 step)
    const afterTick = state.clock.now();

    const liveIds = queryNpcs(state.world!).map(e => e.id).sort();
    expect(liveIds.length).toBe(3); // anchor + 2

    for (let i = 0; i < 5; i++) liveTick();

    // Scrub BEFORE the spawn → only the anchor exists.
    timeline.jumpTo(spawnTick - 1);
    expect(queryNpcs(state.world!).map(e => e.id)).toEqual(['anchor']);

    // Scrub PAST the spawn → the cohort reappears with identical ids.
    timeline.jumpTo(afterTick);
    expect(queryNpcs(state.world!).map(e => e.id).sort()).toEqual(liveIds);
  });
});
```

NOTE: the exact `GameState` shape and `baseCtx` fields must match what `scheduler.tick`/`forwardSilent` expect (the Explore confirmed `forwardSilent` builds `{ world, spirits, log, clock, rng }`). If `GameState` requires more fields for `captureSnapshot`/`restoreSnapshot` (it reads `state.map`, `state.world`, `state.spirits`, `state.clock`, `state.rng`, `state.eventLog`), include them. Adjust until the harness mirrors `game.ts`.

- [ ] **Step 2: Run the parity test**

Run: `npx vitest run tests/unit/author-replay-parity.test.ts`
Expected: PASS. If the "scrub past" ids differ, the determinism invariant is violated — investigate executor registration order (must be FIRST) and that the spawn consumes RNG only via `ctx.rng`.

- [ ] **Step 3: no-random guard + typecheck**

Run: `npx vitest run tests/unit/no-random-in-sim.test.ts` → PASS.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: all green (prior baseline 1024 + the new SP2 tests).

- [ ] **Step 5: Commit**

```bash
git add tests/unit/author-replay-parity.test.ts
git commit -m "$(cat <<'EOF'
test(command): replay parity — author edits reappear identically on scrub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage (design §3 SP2):** editor tier + cost-0/no-spirit (Task 1, 3); all five verbs with the listed payloads + safe-API applies (Tasks 3-6); `Command.payload` widening (Task 1); `source: 'author'` non-spirit (Task 1, 3); executor skips spirit/power for editor (Task 3); `authored_*` SimEvents (Task 1); `AuthorCommandLog` (Task 2); live record + silent re-emit (Task 7); not cleared on restore, truncated on commit, reset on skip (Tasks 2, 7); replay parity test (Task 8); `no-random-in-sim` stays green (Tasks 4, 6, 8).
- **Determinism:** all editor randomness via `ctx.rng`; executor registered first; re-emission preserves drain order; recording keys off the apply tick. The parity test is the proof.
- **Type consistency:** `ApplyCtx` (rng+now) used by `apply`/`executeCommand`/`ctxFor`; `CommandCtx` (read-only) used by `previewCommand`/preconditions and the player UI. `findPlacement(world, cx, cy, maxRadius)` signature reused identically by spawn + place. `removePrecondition`/`removeApply`/`spawnPrecondition`/… export names match their registry imports.
- **Deviations to confirm during implementation (line numbers are approximate; match by surrounding code):** `queryNpcs` arity (pass `ctx.world`); `Region` field names in `query({region})`; a real entity-kind id for the place test; the exact `TimelineController` construction site in `game.ts`; the existing `timeline.test.ts` harness shape. Each is flagged inline in the relevant task.
- **Out of scope (kept out):** tile/biome/seed mutation; multi-turn read loops; the panel UI (SP3); `near`-in-remove-filter; multi-spirit belief modify; pathfinding-reachable placement validation.
