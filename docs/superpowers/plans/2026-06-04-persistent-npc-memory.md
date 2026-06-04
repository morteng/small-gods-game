# Persistent Episodic NPC Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each NPC a durable, salience-tagged episodic memory — distilled from every interaction, persisted via the existing snapshot/save path, and fed back into LLM prompts so backfill and whisper stop being amnesiac. No UI changes.

**Architecture:** A new pure module `src/llm/interaction-memory.ts` owns the distill/salience/ring/select logic. The persisted data is a `memories?: MemoryEntry[]` array on `NpcProperties` (rides `structuredClone` snapshot + SaveFile for free; optional → old saves default `[]`). Memory is written only on player-driven interactions (backfill, whisper, divine acts) — never in a tick system, so sim determinism and the `no-random-in-sim` guard are untouched. The two duplicate `createInteractionSummary` functions are consolidated into one `distillInteraction` (DRY), with back-compat re-exports keeping existing tests green.

**Tech Stack:** TypeScript ESM, Vitest, `@/` → `src/`. Run a single test file with `npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-06-04-persistent-npc-memory-design.md`

> **Type-home note (deviation from spec wording):** the spec says the new module "owns" `MemoryEntry`. To avoid a circular import (`types.ts` → `llm/interaction-memory.ts` → `types.ts`), the `MemoryKind` + `MemoryEntry` *types* live in `src/core/types.ts` (the canonical home for persisted entity fields). The module owns all the *logic*. This is the only departure from the spec.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/types.ts` (modify) | `MemoryKind`, `MemoryEntry` types; `memories?` field on `NpcProperties` |
| `src/llm/interaction-memory.ts` (create) | `distillInteraction`, `summarizeDivineAct`, `computeSalience`, `recordMemory`, `selectMemoriesForPrompt`, `MEMORY_MAX` |
| `src/llm/state-writeback.ts` (modify) | replace local `createInteractionSummary` with re-export of `distillInteraction` |
| `src/llm/npc-prompt-builder.ts` (modify) | replace local `createInteractionSummary` with re-export of `distillInteraction` |
| `src/game/llm-backfill.ts` (modify) | read memories → `previousInteractions`; write memory after writeback |
| `src/game/whisper-orchestrator.ts` (modify) | write memory after dialogue fill; pass past memories to the prompt |
| `src/llm/whisper-prompt-builder.ts` (modify) | render a "They remember of you" section |
| `src/game/divine-actions-controller.ts` (modify) | record memory on `dream()` / `answerPrayer()` success |

---

## Task 1: Memory types + distill/salience core

**Files:**
- Modify: `src/core/types.ts` (add types near `NpcProperties`, ~line 277)
- Create: `src/llm/interaction-memory.ts`
- Modify: `src/llm/state-writeback.ts:230-255` (replace def with re-export)
- Modify: `src/llm/npc-prompt-builder.ts:176-211` (replace def with re-export)
- Test: `tests/unit/interaction-memory.test.ts`

- [ ] **Step 1: Add the types to `src/core/types.ts`**

Insert immediately **above** `export interface NpcProperties {` (currently line 277):

```ts
/** What kind of interaction produced a memory. */
export type MemoryKind = 'whisper' | 'backfill' | 'dream' | 'miracle' | 'answer';

/** A distilled, salience-tagged episodic memory of one interaction with a god.
 *  Stored on NpcProperties; rides the snapshot (structuredClone) + SaveFile. */
export interface MemoryEntry {
  /** Sim tick when it happened. */
  tick: number;
  kind: MemoryKind;
  /** One-line distilled summary (from interaction-memory.distillInteraction / summarizeDivineAct). */
  summary: string;
  /** 0..1, deterministic — high-salience landmarks survive eviction. */
  salience: number;
}
```

Then add this field to `NpcProperties`, immediately after `recentEventIds: number[];` (currently line 329):

```ts
  /** Distilled, salience-tagged episodic memory of interactions with gods (Track 2).
   *  Optional → old saves/snapshots without it read as []. */
  memories?: MemoryEntry[];
```

- [ ] **Step 2: Write the failing test** — `tests/unit/interaction-memory.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { distillInteraction, computeSalience } from '@/llm/interaction-memory';
import type { LLMResponse } from '@/llm/state-writeback';

describe('distillInteraction', () => {
  it('summarizes dialogue, belief and mood', () => {
    const res: LLMResponse = { dialogue: 'The gods are watching us', belief_delta: { faith: 0.15, understanding: 0.05 }, mood_delta: 0.1 };
    const s = distillInteraction('Gwendolyn', res, 'Player');
    expect(s).toContain('Gwendolyn said:');
    expect(s).toContain('The gods are watching us');
    expect(s).toContain('faith+0.15');
    expect(s).toContain('understanding+0.05');
    expect(s).toContain('Mood improved');
  });

  it('falls back to a generic line for an empty response', () => {
    expect(distillInteraction('Silent', {}, 'Player')).toContain('Silent interacted with Player');
  });
});

describe('computeSalience', () => {
  it('orders kinds: miracle > answer > dream > whisper > backfill for equal deltas', () => {
    const sal = (k: Parameters<typeof computeSalience>[0]) => computeSalience(k);
    expect(sal('miracle')).toBeGreaterThan(sal('answer'));
    expect(sal('answer')).toBeGreaterThan(sal('dream'));
    expect(sal('dream')).toBeGreaterThan(sal('whisper'));
    expect(sal('whisper')).toBeGreaterThan(sal('backfill'));
  });

  it('answer-prayer alone clears the landmark bar (>= 0.6)', () => {
    expect(computeSalience('answer')).toBeGreaterThanOrEqual(0.6);
  });

  it('larger belief/mood deltas raise salience, clamped to [0,1]', () => {
    expect(computeSalience('whisper', { faith: 0.3 }, 0.2)).toBeGreaterThan(computeSalience('whisper'));
    expect(computeSalience('miracle', { faith: 1, understanding: 1, devotion: 1 }, 1)).toBe(1);
    expect(computeSalience('backfill')).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/interaction-memory.test.ts`
Expected: FAIL — `Failed to resolve import "@/llm/interaction-memory"`.

- [ ] **Step 4: Create `src/llm/interaction-memory.ts`**

```ts
/**
 * Interaction memory — distill an interaction into a compact, salience-tagged
 * MemoryEntry, store it in a bounded ring on the NPC, and select entries for
 * prompts. Pure & deterministic (no Math.random, no time-of-day): memory is
 * only ever written on player-driven interactions, never in a tick system.
 */
import type { MemoryEntry, MemoryKind, NpcProperties } from '@/core/types';
import type { LLMResponse } from '@/llm/state-writeback';

type BeliefDelta = NonNullable<LLMResponse['belief_delta']>;

/** Hard ceiling on stored memories per NPC. */
export const MEMORY_MAX = 20;

const KIND_WEIGHT: Record<MemoryKind, number> = {
  miracle: 1.0,
  answer: 0.6,
  dream: 0.4,
  whisper: 0.2,
  backfill: 0.1,
};

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/** Distill an LLM response into a one-line summary. Consolidates the two former
 *  createInteractionSummary functions (re-exported from their old homes). */
export function distillInteraction(npcName: string, response: LLMResponse, spiritName: string): string {
  const parts: string[] = [];

  if (response.dialogue) {
    const preview = response.dialogue.length > 50 ? response.dialogue.slice(0, 50) + '...' : response.dialogue;
    parts.push(`${npcName} said: "${preview}"`);
  }

  if (response.belief_delta) {
    const changes: string[] = [];
    const b = response.belief_delta;
    if (b.faith) changes.push(`faith${b.faith > 0 ? '+' : ''}${b.faith.toFixed(2)}`);
    if (b.understanding) changes.push(`understanding${b.understanding > 0 ? '+' : ''}${b.understanding.toFixed(2)}`);
    if (b.devotion) changes.push(`devotion${b.devotion > 0 ? '+' : ''}${b.devotion.toFixed(2)}`);
    if (changes.length > 0) parts.push(`Belief changed: ${changes.join(', ')}`);
  }

  if (response.mood_delta) {
    parts.push(`Mood ${response.mood_delta > 0 ? 'improved' : 'worsened'} by ${Math.abs(response.mood_delta).toFixed(2)}`);
  }

  return parts.join('; ') || `${npcName} interacted with ${spiritName}`;
}

/** Templated one-line summary for a non-LLM divine action. */
export function summarizeDivineAct(kind: MemoryKind, npcName: string, spiritName: string): string {
  switch (kind) {
    case 'dream': return `${spiritName} sent ${npcName} a dream`;
    case 'answer': return `${spiritName} answered ${npcName}'s prayer`;
    case 'miracle': return `${spiritName} worked a miracle for ${npcName}`;
    default: return `${spiritName} touched ${npcName}`;
  }
}

/** Deterministic 0..1 salience from the kind weight + the magnitude of belief/mood change. */
export function computeSalience(kind: MemoryKind, beliefDelta?: BeliefDelta, moodDelta?: number): number {
  const b = beliefDelta ?? {};
  const beliefMag = Math.abs(b.faith ?? 0) + Math.abs(b.understanding ?? 0) + Math.abs(b.devotion ?? 0);
  const moodMag = Math.abs(moodDelta ?? 0);
  return clamp01(KIND_WEIGHT[kind] + 2 * beliefMag + moodMag);
}
```

Now **replace** the body of `createInteractionSummary` in the two old homes with re-exports.

In `src/llm/state-writeback.ts`, delete the whole `export function createInteractionSummary(...) { ... }` block (currently lines ~226-255) and add near the top-level exports:

```ts
// Consolidated into interaction-memory (DRY). Re-exported under the old name for back-compat.
export { distillInteraction as createInteractionSummary } from '@/llm/interaction-memory';
```

In `src/llm/npc-prompt-builder.ts`, delete the whole `export function createInteractionSummary(...) { ... }` block (currently lines ~176-211) and add:

```ts
// Consolidated into interaction-memory (DRY). Re-exported under the old name for back-compat.
export { distillInteraction as createInteractionSummary } from '@/llm/interaction-memory';
```

- [ ] **Step 5: Run the new test + the two legacy tests**

Run: `npx vitest run tests/unit/interaction-memory.test.ts tests/unit/llm-prompt-builder.test.ts tests/unit/llm-state-writeback.test.ts`
Expected: PASS. The legacy `createInteractionSummary` tests still pass because their assertions are loose `toContain` checks that `distillInteraction`'s output satisfies (dialogue → `"Name said:"`, belief → `"faith+0.15"`, mood → `"Mood improved"`, empty → `"Name interacted with Player"`).

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/llm/interaction-memory.ts src/llm/state-writeback.ts src/llm/npc-prompt-builder.ts tests/unit/interaction-memory.test.ts
git commit -m "feat(memory): MemoryEntry type + distill/salience core (consolidates createInteractionSummary)"
```

---

## Task 2: Ring eviction + prompt selection

**Files:**
- Modify: `src/llm/interaction-memory.ts`
- Test: `tests/unit/interaction-memory.test.ts` (append)

- [ ] **Step 1: Write the failing test** — append to `tests/unit/interaction-memory.test.ts`

```ts
import { recordMemory, selectMemoriesForPrompt, MEMORY_MAX } from '@/llm/interaction-memory';
import type { NpcProperties, MemoryEntry } from '@/core/types';

function props(): NpcProperties { return { memories: [] } as unknown as NpcProperties; }
function entry(tick: number, salience: number, summary = `m${tick}`): MemoryEntry {
  return { tick, salience, summary, kind: 'whisper' };
}

describe('recordMemory', () => {
  it('appends and lazily creates the array', () => {
    const p = { } as unknown as NpcProperties;
    recordMemory(p, entry(1, 0.2));
    expect(p.memories).toHaveLength(1);
  });

  it('bounds at MEMORY_MAX, evicting the lowest-salience (oldest tiebreak)', () => {
    const p = props();
    for (let i = 0; i < MEMORY_MAX + 1; i++) recordMemory(p, entry(i, 0.1));
    expect(p.memories).toHaveLength(MEMORY_MAX);
    // tick 0 (oldest among equal salience) was evicted
    expect(p.memories!.some(m => m.tick === 0)).toBe(false);
    expect(p.memories!.some(m => m.tick === MEMORY_MAX)).toBe(true);
  });

  it('keeps a high-salience landmark through many low-salience inserts', () => {
    const p = props();
    recordMemory(p, entry(0, 0.95, 'LANDMARK'));
    for (let i = 1; i < MEMORY_MAX + 10; i++) recordMemory(p, entry(i, 0.1));
    expect(p.memories!.some(m => m.summary === 'LANDMARK')).toBe(true);
    expect(p.memories).toHaveLength(MEMORY_MAX);
  });
});

describe('selectMemoriesForPrompt', () => {
  it('returns all (chronological) when under the cap', () => {
    expect(selectMemoriesForPrompt([entry(2, 0.1, 'b'), entry(1, 0.1, 'a')], 6)).toEqual(['b', 'a']);
  });

  it('always includes the top-salience landmark, fills with most recent, chronological', () => {
    const mems = [entry(1, 0.95, 'LANDMARK'), entry(2, 0.1, 'x'), entry(3, 0.1, 'y'), entry(4, 0.1, 'z')];
    const out = selectMemoriesForPrompt(mems, 3);
    expect(out).toHaveLength(3);
    expect(out).toContain('LANDMARK');
    expect(out).toContain('z'); // most recent
    expect(out[0]).toBe('LANDMARK'); // earliest tick → first
  });

  it('returns [] for non-positive maxCount', () => {
    expect(selectMemoriesForPrompt([entry(1, 0.5)], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/interaction-memory.test.ts`
Expected: FAIL — `recordMemory`/`selectMemoriesForPrompt` not exported.

- [ ] **Step 3: Implement — append to `src/llm/interaction-memory.ts`**

```ts
/** Push an entry; if over MEMORY_MAX, evict the entry minimizing (salience, tick)
 *  — lowest salience first, oldest as tiebreak. Mutates props.memories in place. */
export function recordMemory(props: NpcProperties, entry: MemoryEntry): void {
  const mems = props.memories ?? (props.memories = []);
  mems.push(entry);
  if (mems.length <= MEMORY_MAX) return;
  let worst = 0;
  for (let i = 1; i < mems.length; i++) {
    const m = mems[i], w = mems[worst];
    if (m.salience < w.salience || (m.salience === w.salience && m.tick < w.tick)) worst = i;
  }
  mems.splice(worst, 1);
}

/** Select up to maxCount summaries for a prompt: always include the highest-salience
 *  landmark, fill the rest with the most recent, output chronological (tick-ascending). */
export function selectMemoriesForPrompt(memories: MemoryEntry[], maxCount: number): string[] {
  if (maxCount <= 0) return [];
  if (memories.length <= maxCount) return memories.map(m => m.summary);
  const landmark = memories.reduce((best, m) =>
    m.salience > best.salience || (m.salience === best.salience && m.tick < best.tick) ? m : best);
  const recent = memories.slice(-(maxCount - 1));
  const chosen = recent.includes(landmark) ? memories.slice(-maxCount) : [landmark, ...recent];
  return [...chosen].sort((a, b) => a.tick - b.tick).map(m => m.summary);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/interaction-memory.test.ts`
Expected: PASS (all `describe` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/llm/interaction-memory.ts tests/unit/interaction-memory.test.ts
git commit -m "feat(memory): salience-tagged ring eviction + prompt selection"
```

---

## Task 3: Wire backfill (read previous interactions + write memory)

**Files:**
- Modify: `src/game/llm-backfill.ts:46-74`
- Test: `tests/unit/llm-backfill-memory.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/llm-backfill-memory.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { LlmBackfillService } from '@/game/llm-backfill';
import { LLMClient, type LLMProvider } from '@/llm/llm-client';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { npcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { LlmDisplayHandle } from '@/ui/llm-display';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 5, height: 5, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

const noopDisplay = { showBoth() {}, showDialogue() {}, showNarration() {} } as unknown as LlmDisplayHandle;

/** Provider that records each user prompt and returns a canned reaction. */
function capturingProvider(captured: string[]): LLMProvider {
  return {
    isAvailable: () => true,
    async generate(messages) {
      captured.push(messages[messages.length - 1].content);
      return { content: JSON.stringify({ dialogue: 'I feel watched', belief_delta: { faith: 0.1 } }), latencyMs: 0 };
    },
  } as unknown as LLMProvider;
}

describe('backfill interaction memory', () => {
  it('records a memory and feeds it into the next prompt', async () => {
    const state = createState();
    state.map = makeMap();
    state.world = new World(state.map);
    const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: initNpcProps('Aelith', 'farmer', 1) as any };
    state.world.addEntity(npc);

    const captured: string[] = [];
    const svc = new LlmBackfillService({ state, llmDisplay: noopDisplay, client: new LLMClient(capturingProvider(captured)) });

    await svc.trigger(npc);
    expect(npcProps(npc).memories ?? []).toHaveLength(1);
    expect(npcProps(npc).memories![0].kind).toBe('backfill');

    await svc.trigger(npc);
    // The 2nd prompt's PREVIOUS INTERACTIONS section is now populated.
    expect(captured[1]).toContain('Aelith said:');
    expect(captured[1]).not.toContain('No previous interactions');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/llm-backfill-memory.test.ts`
Expected: FAIL — first `trigger` records nothing (`memories` undefined → length 0).

- [ ] **Step 3: Implement** — edit `src/game/llm-backfill.ts`

Add imports at the top (after the existing imports on lines 1-8):

```ts
import { selectMemoriesForPrompt, recordMemory, distillInteraction, computeSalience } from '@/llm/interaction-memory';
import { npcProps as _npcProps } from '@/world/npc-helpers'; // already imported as npcProps; do NOT add — see below
```

(`npcProps` is already imported on line 4 — do not re-import. The line above is illustrative; only add the `interaction-memory` import.)

Replace the body of `trigger` (lines 46-74) with:

```ts
  async trigger(npcEntity: Entity): Promise<void> {
    const { state, llmDisplay } = this.deps;
    if (!state.world) return;
    const props = npcProps(npcEntity);
    const player = state.spirits.get('player');
    if (!player) return;

    const context: NpcPromptContext = {
      npc: npcEntity,
      world: state.world,
      recentEvents: getRecentEventDescriptions(props, state.eventLog),
      previousInteractions: selectMemoriesForPrompt(props.memories ?? [], 6),
      nearbyNpcNames: getNearbyNpcNames(state.world, npcEntity, 3),
      activeEvents: getActiveEventsForPoi(state.world, props.homePoiId),
      playerSpiritId: 'player',
    };

    const prompt = buildNpcPrompt(context);
    try {
      const response = await this.client.generateNpcBackfill(prompt.system, prompt.user, { maxTokens: 200, temperature: 0.7 });
      const parsed = parseLLMJson(response.content);
      const writeback = applyLLMWriteback(npcEntity, parsed, 'player', state.eventLog);
      recordMemory(props, {
        tick: state.clock.now(),
        kind: 'backfill',
        summary: distillInteraction(props.name, parsed, player.name),
        salience: computeSalience('backfill', parsed.belief_delta, parsed.mood_delta),
      });
      if (writeback.narration && writeback.dialogue) llmDisplay.showBoth(props.name, writeback.dialogue, writeback.narration);
      else if (writeback.dialogue) llmDisplay.showDialogue(props.name, writeback.dialogue);
      else if (writeback.narration) llmDisplay.showNarration(writeback.narration);
      this.deps.onWriteback?.();
    } catch (err) {
      console.error('[LLM] Backfill failed:', err);
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/llm-backfill-memory.test.ts tests/unit/llm-backfill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/llm-backfill.ts tests/unit/llm-backfill-memory.test.ts
git commit -m "feat(memory): backfill reads previous interactions + records memory"
```

---

## Task 4: Wire whisper (write memory + feed past memories to prompt)

**Files:**
- Modify: `src/llm/whisper-prompt-builder.ts:5-10,35-56`
- Modify: `src/game/whisper-orchestrator.ts:35-72`
- Test: `tests/unit/whisper-orchestration.test.ts` (append a case)

- [ ] **Step 1: Write the failing test** — append to `tests/unit/whisper-orchestration.test.ts`

```ts
import { recordMemory } from '@/llm/interaction-memory';
import type { NpcProperties } from '@/core/types';

describe('whisper interaction memory', () => {
  it('records a memory after a successful whisper', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const e = npc();
    await sendWhisper(e, 'be brave', mkDeps(store, queue, stubClient({ dialogue: 'I will try', belief_bonus: 0.05, mood_delta: 0.1 })));
    const mems = (e.properties as unknown as NpcProperties).memories ?? [];
    expect(mems).toHaveLength(1);
    expect(mems[0].kind).toBe('whisper');
  });

  it('passes prior memories into the whisper prompt', async () => {
    const store = new NpcAttentionStore(); const queue = new CommandQueue();
    const e = npc();
    recordMemory(e.properties as unknown as NpcProperties, { tick: 1, kind: 'answer', summary: 'Fooob answered Maeve\'s prayer', salience: 0.7 });
    const captured: string[] = [];
    const client = new LLMClient({ async generate(messages: { content: string }[]) {
      captured.push(messages[messages.length - 1].content);
      return { content: JSON.stringify({ dialogue: 'ok', belief_bonus: 0, mood_delta: 0 }), latencyMs: 0 };
    } } as any);
    await sendWhisper(e, 'again', mkDeps(store, queue, client));
    expect(captured[0]).toContain('answered Maeve');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/whisper-orchestration.test.ts`
Expected: FAIL — no memory recorded; prompt has no "remember" section.

- [ ] **Step 3a: Add the memory section to `src/llm/whisper-prompt-builder.ts`**

Extend `WhisperPromptContext` (lines 5-10) with an optional field:

```ts
export interface WhisperPromptContext {
  npc: Entity;
  whisperText: string;
  recentTurns: WhisperTurn[];
  playerSpiritId: SpiritId;
  /** Distilled long-term memories of this god, for cross-session recall (Track 2). */
  pastMemories?: string[];
}
```

In `buildWhisperPrompt`, after the recent-turns block (after line 50, before `lines.push(\`You now whisper...\`)`), add:

```ts
  if (ctx.pastMemories && ctx.pastMemories.length) {
    lines.push('They remember of you:');
    for (const m of ctx.pastMemories) lines.push(`  - ${m}`);
  }
```

- [ ] **Step 3b: Record memory + pass memories in `src/game/whisper-orchestrator.ts`**

Add imports after the existing imports (lines 13-19):

```ts
import type { NpcProperties } from '@/core/types';
import { recordMemory, distillInteraction, computeSalience, selectMemoriesForPrompt } from '@/llm/interaction-memory';
```

In `sendWhisper`, change the prompt construction (line 54) to pass past memories, and record a memory on the success path (after line 68, inside the `try`, before the `catch`). The updated try-block:

```ts
  // 3. Soft narration.
  const props = npc.properties as unknown as NpcProperties;
  try {
    const prompt = buildWhisperPrompt({
      npc, whisperText: text, recentTurns: recentBefore, playerSpiritId: deps.playerSpiritId,
      pastMemories: selectMemoriesForPrompt(props.memories ?? [], 4),
    });
    const res = await deps.llm.generateNpcBackfill(prompt.system, prompt.user);
    const parsed = parseReaction(res);
    if (!parsed || typeof parsed.dialogue !== 'string' || parsed.dialogue.length === 0) {
      turn.degraded = true;
      return;
    }
    turn.dialogue = parsed.dialogue;
    if (typeof parsed.belief_bonus === 'number') {
      turn.faithBonus = applyWhisperBonus(npc, parsed.belief_bonus, deps.playerSpiritId);
    }
    if (typeof parsed.mood_delta === 'number') {
      props.mood = clamp(props.mood + clamp(parsed.mood_delta, -MOOD_DELTA_CLAMP, MOOD_DELTA_CLAMP), 0, 1);
    }
    recordMemory(props, {
      tick: deps.now(),
      kind: 'whisper',
      summary: distillInteraction(props.name, { dialogue: parsed.dialogue, belief_delta: { faith: parsed.belief_bonus }, mood_delta: parsed.mood_delta }, String(deps.playerSpiritId)),
      salience: computeSalience('whisper', { faith: parsed.belief_bonus }, parsed.mood_delta),
    });
  } catch {
    turn.degraded = true;
  }
```

Note: this also replaces the old line-66 inline `const props = npc.properties as unknown as { mood: number }` cast — `props` is now declared once above the `try` as `NpcProperties`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/whisper-orchestration.test.ts tests/unit/whisper-prompt-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/llm/whisper-prompt-builder.ts src/game/whisper-orchestrator.ts tests/unit/whisper-orchestration.test.ts
git commit -m "feat(memory): whisper records memory + recalls past memories in prompt"
```

---

## Task 5: Record divine-act memories (dream / answer prayer)

**Files:**
- Modify: `src/game/divine-actions-controller.ts:31-81`
- Test: `tests/unit/divine-actions-memory.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/unit/divine-actions-memory.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { DivineActionsController } from '@/game/divine-actions-controller';
import { CommandQueue } from '@/sim/command/command-queue';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { DivineEffects } from '@/render/divine-effects';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 5, height: 5, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

const noopEffects = { trigger() {} } as unknown as DivineEffects;

function setup(activity: string) {
  const state = createState();
  state.map = makeMap();
  state.world = new World(state.map);
  const props = initNpcProps('Maeve', 'farmer', 1) as any;
  props.activity = activity;
  const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: props };
  state.world.addEntity(npc);
  const queue = new CommandQueue();
  const ctrl = new DivineActionsController({ state, queue, divineEffects: noopEffects, now: () => 0 });
  return { state, npc, ctrl };
}

describe('divine-action memory', () => {
  it('answerPrayer records a high-salience landmark on a worshipping NPC', () => {
    const { npc, ctrl } = setup('worship');
    expect(ctrl.answerPrayer(npc)).toBe(true);
    const mems = npcProps(npc).memories ?? [];
    expect(mems).toHaveLength(1);
    expect(mems[0].kind).toBe('answer');
    expect(mems[0].salience).toBeGreaterThanOrEqual(0.6);
  });

  it('dream records a memory', () => {
    const { npc, ctrl } = setup('idle');
    expect(ctrl.dream(npc)).toBe(true);
    expect((npcProps(npc).memories ?? [])[0].kind).toBe('dream');
  });

  it('does not record when the action is gated out', () => {
    const { npc, ctrl } = setup('idle'); // not worshipping → answer_prayer precondition fails
    expect(ctrl.answerPrayer(npc)).toBe(false);
    expect(npcProps(npc).memories ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/divine-actions-memory.test.ts`
Expected: FAIL — no memory recorded.

- [ ] **Step 3: Implement** — edit `src/game/divine-actions-controller.ts`

Add imports after the existing imports (lines 14-21):

```ts
import type { MemoryKind } from '@/core/types';
import { recordMemory, summarizeDivineAct, computeSalience } from '@/llm/interaction-memory';
```

Add a private helper inside the class (e.g. after `tryEmit`, before the action methods):

```ts
  /** Record a salience-tagged memory of an NPC-targeted divine act. Called only
   *  after the command actually emitted (passed the registry preview). */
  private recordAct(npc: Entity, kind: MemoryKind): void {
    const props = npcProps(npc);
    const spiritName = this.deps.state.spirits.get('player')?.name ?? 'your god';
    recordMemory(props, {
      tick: this.deps.state.clock.now(),
      kind,
      summary: summarizeDivineAct(kind, props.name, spiritName),
      salience: computeSalience(kind),
    });
  }
```

Update `dream` and `answerPrayer` to record on success:

```ts
  dream(npc: Entity): boolean {
    if (this.tryEmit('dream', { kind: 'npc', npcId: npc.id })) {
      this.deps.divineEffects.trigger('dream', npc.x, npc.y);
      this.recordAct(npc, 'dream');
      return true;
    }
    return false;
  }

  answerPrayer(npc: Entity): boolean {
    if (this.tryEmit('answer_prayer', { kind: 'npc', npcId: npc.id })) {
      this.recordAct(npc, 'answer');
      return true;
    }
    return false;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/divine-actions-memory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/divine-actions-controller.ts tests/unit/divine-actions-memory.test.ts
git commit -m "feat(memory): record dream/answer-prayer as NPC memories"
```

---

## Task 6: Persistence round-trip (snapshot + old-save tolerance)

**Files:**
- Test: `tests/unit/snapshot-npc-memory.test.ts`

This task is test-only — persistence is already free via `structuredClone(e.properties)` in `captureSnapshot` (`src/core/snapshot.ts:36`) and `restoreSnapshot` (line 76). The test pins that contract and the old-save tolerance.

- [ ] **Step 1: Write the test** — `tests/unit/snapshot-npc-memory.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { World } from '@/world/world';
import { initNpcProps, getNpc, npcProps } from '@/world/npc-helpers';
import { recordMemory, selectMemoriesForPrompt } from '@/llm/interaction-memory';
import type { GameMap, Tile, Entity } from '@/core/types';

function makeState() {
  const state = createState();
  const tiles: Tile[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 5; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = { tiles, width: 5, height: 5, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  state.map = map;
  state.world = new World(map);
  const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: initNpcProps('Aelith', 'farmer', 1) as any };
  state.world.addEntity(npc);
  return { state, npc };
}

describe('snapshot persists NPC memory', () => {
  it('round-trips memories (snapshot is authoritative)', () => {
    const { state, npc } = makeState();
    recordMemory(npcProps(npc), { tick: 1, kind: 'answer', summary: 'a landmark', salience: 0.7 });
    const snap = captureSnapshot(state);
    npcProps(npc).memories = []; // mutate after capture
    restoreSnapshot(state, snap);
    const restored = npcProps(getNpc(state.world!, 'n1')!);
    expect(restored.memories).toHaveLength(1);
    expect(restored.memories![0].summary).toBe('a landmark');
  });

  it('tolerates an entity with no memories field (old save)', () => {
    const { state, npc } = makeState();
    delete (npcProps(npc) as { memories?: unknown }).memories;
    const snap = captureSnapshot(state);
    expect(() => restoreSnapshot(state, snap)).not.toThrow();
    const restored = npcProps(getNpc(state.world!, 'n1')!);
    expect(selectMemoriesForPrompt(restored.memories ?? [], 6)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes (it should pass immediately)**

Run: `npx vitest run tests/unit/snapshot-npc-memory.test.ts`
Expected: PASS — `structuredClone` carries the `memories` array; absent field reads as `[]`. If it FAILS, stop and investigate `snapshot.ts` (the persistence-is-free assumption is the load-bearing claim of this design).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/snapshot-npc-memory.test.ts
git commit -m "test(memory): pin snapshot round-trip + old-save tolerance for NPC memory"
```

---

## Task 7: Full-suite verification

**Files:** none (verification + final commit if needed)

- [ ] **Step 1: TypeScript check + full test suite**

Run: `npm run build && npm test`
Expected: tsc clean; all tests pass (prior count 1192 + the new memory tests, no regressions). The two legacy `createInteractionSummary` test files still pass via the re-exports.

- [ ] **Step 2: Confirm the sim stays Math.random-free**

Run: `npx vitest run tests/unit/no-random-in-sim.test.ts`
Expected: PASS. (Memory helpers live in `src/llm` + `src/game`, never `src/sim`, and contain no randomness — but this guard is the canonical check.)

- [ ] **Step 3: If `npm run build` surfaced any unused-import or type errors, fix them inline and re-run, then commit**

```bash
git add -A
git commit -m "chore(memory): full-suite green for persistent NPC memory"
```

(If steps 1-2 were already green with nothing to fix, skip the commit.)

---

## Self-Review

**Spec coverage:**
- Persistent episodic memory on the entity → Task 1 (type + field), Task 6 (persistence pinned). ✓
- Salience-tagged ring, MAX 20, evict lowest-salience-oldest-first → Task 2. ✓
- Consolidate the two `createInteractionSummary` (DRY) → Task 1 (re-exports keep legacy tests green). ✓
- Feed `previousInteractions` (backfill) → Task 3. ✓
- Persistent-memory section in whisper prompt → Task 4. ✓
- Write sites: backfill (Task 3), whisper (Task 4), divine acts dream/answer (Task 5). ✓
- Determinism: memory only written on player-driven interactions; guard re-run in Task 7. ✓
- No `SAVE_VERSION` bump; optional field; old-save tolerance → Task 6. ✓
- Out of scope (conversation UI, miracle/omen settlement fan-out, LLM compression) → not built. ✓ (`'miracle'` stays in `MemoryKind` as a reserved/forward value, exercised by the `computeSalience` ordering test; no call site writes it this slice.)

**Type consistency:** `MemoryKind`/`MemoryEntry` defined in `types.ts` Task 1, imported consistently. `recordMemory(props, entry)`, `computeSalience(kind, beliefDelta?, moodDelta?)`, `selectMemoriesForPrompt(memories, maxCount)`, `distillInteraction(npcName, response, spiritName)`, `summarizeDivineAct(kind, npcName, spiritName)` — signatures match across Tasks 3-5 call sites. `LLMResponse['belief_delta']` shape reused for `BeliefDelta`.

**Placeholder scan:** none — every code step shows complete code.
