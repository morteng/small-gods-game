# Persistent Episodic NPC Memory — Design

**Date:** 2026-06-04
**Track:** Track 2 (Phase 9 — LLM backfill) loose ends — *interaction memory*
**Status:** Approved (brainstorm complete), ready for implementation plan

> Closes the ROADMAP Track 2 item **"Interaction memory (compress + store; `createInteractionSummary()` is partial)."** The sibling Track 2 item *Conversation UI* is **deliberately deferred** — this slice ships the durable mechanic only; surfacing it in the panel is a later task.

---

## Goal

NPCs accrue a durable, salience-tagged memory of their history with each god — distilled from every interaction (LLM and divine), persisted via the existing snapshot/save path, and fed back into all LLM prompts so backfill and whisper stop being amnesiac. **No UI changes this round.**

## Motivation & current state

From a code audit (2026-06-04):

- **Belief/mood already persist** — they mutate the NPC entity and ride the snapshot. That is the *sim-truth* memory.
- **Narrative texture does not persist** — whisper transcripts + mind-wiki pages live in `NpcAttentionStore`, which is deliberately transient (wiped on snapshot restore, regenerated on focus).
- `createInteractionSummary()` exists in **two** places (`src/llm/npc-prompt-builder.ts:181`, `src/llm/state-writeback.ts:230`) and is **never called**.
- `NpcPromptContext.previousInteractions` is **hardcoded `[]`** in `LlmBackfillService.trigger` (`src/game/llm-backfill.ts:57`) — so even within a session, backfill has no memory.
- Whisper *is* already multi-turn within a session (`NpcAttentionStore.transcripts`, last 6 turns fed to `whisper-prompt-builder.ts`), but it is session-only and dies on scrub/reload.

This design adds a **persistent, distilled** memory layer (not raw prose) that lives on the entity. Distilled facts — like belief deltas — are consistent with the deliberate "soft content is ephemeral / regenerates on focus" decision from the mind-centric panel design.

## Design decisions (from brainstorming)

1. **Memory model: Persistent episodic.** Distill each interaction into a compact summary stored *on the NPC entity*, so it rides the snapshot + save. The NPC genuinely remembers the god across scrub/reload.
2. **Conversation UI: deferred.** Build the mechanic + prompt wiring only. No panel changes.
3. **Retention: salience-tagged ring.** Keep a bounded set; always retain high-impact memories (miracles, answered prayers, large belief swings); ordinary chatter fades oldest-first. Salience is computed deterministically from delta magnitudes — no extra LLM call.

## Determinism & persistence invariants

- **Memory is written only on player-driven interactions** (whisper, backfill, divine action dispatch) — **never inside a tick system**. Therefore sim ticks remain deterministic and the `tests/unit/no-random-in-sim.test.ts` guard is unaffected.
- All memory helpers are pure / template-based — no `Math.random`, no time-of-day. `computeSalience` is pure arithmetic; `summarizeDivineAct` is templated.
- **Persistence is free.** `captureSnapshot` does `structuredClone(e.properties)` (`src/core/snapshot.ts:36`) and `SaveFile` reuses the same snapshot. A new optional `memories` array on `NpcProperties` is captured automatically. Restore tolerates an absent field (old saves) by defaulting to `[]`. **No `SAVE_VERSION` bump.**
- Under timeline scrub, memory is restored to the snapshotted state (correct — it rides the snapshot). Under `SilentEventLog` replay nothing re-dispatches, so no double-recording.

---

## Architecture

### New module: `src/llm/interaction-memory.ts`

Single home for the memory type and all its logic. Replaces the two duplicate `createInteractionSummary` functions (DRY).

```ts
export type MemoryKind = 'whisper' | 'backfill' | 'dream' | 'miracle' | 'answer';

export interface MemoryEntry {
  tick: number;        // sim tick when it happened
  kind: MemoryKind;
  summary: string;     // distilled one-liner
  salience: number;    // 0..1, deterministic
}

/** Hard ceiling on stored memories per NPC. */
export const MEMORY_MAX = 20;

/** Distill an LLM response into a one-line summary (consolidates the old createInteractionSummary). */
export function distillInteraction(npcName: string, response: LLMResponse, spiritName: string): string;

/** Templated one-line summary for a non-LLM divine action. */
export function summarizeDivineAct(kind: MemoryKind, npcName: string, spiritName: string): string;

/** Deterministic 0..1 salience from the kind + the magnitude of belief/mood change. */
export function computeSalience(kind: MemoryKind, beliefDelta?: Partial<Belief>, moodDelta?: number): number;

/** Push an entry; evict lowest-salience, oldest-first if over MEMORY_MAX. Mutates props.memories in place. */
export function recordMemory(props: NpcProperties, entry: MemoryEntry): void;

/** Select up to maxCount entries for a prompt: landmarks + most recent, chronological. */
export function selectMemoriesForPrompt(memories: MemoryEntry[], maxCount: number): string[];
```

**`computeSalience`:** `clamp01( kindWeight[kind] + 2 * |faith|+|understanding|+|devotion| + |moodDelta| )`, with `kindWeight = { miracle: 1.0, answer: 0.6, dream: 0.4, whisper: 0.2, backfill: 0.1 }`.

**`recordMemory` eviction:** after pushing, if `memories.length > MEMORY_MAX`, remove the entry minimizing the tuple `(salience, tick)` — lowest salience first, oldest as tiebreak. Landmarks survive; forgettable old chatter drops. One array, one rule, deterministic.

**`selectMemoriesForPrompt`:** return up to `maxCount` summaries — always include the highest-salience entries (landmarks), fill the rest with the most recent, output in chronological (tick-ascending) order.

### Data model change

`src/core/types.ts` — add to `NpcProperties`:
```ts
/** Distilled, salience-tagged episodic memory of interactions with gods (Track 2). Optional → old saves default to []. */
memories?: MemoryEntry[];
```

### Write sites (record memory)

| Path | File | When |
|---|---|---|
| Backfill | `src/game/llm-backfill.ts` | after `applyLLMWriteback` → `distillInteraction` → `recordMemory` |
| Whisper | `src/game/whisper-orchestrator.ts` | after the async dialogue fill → `recordMemory` |
| Divine acts (answer/dream/miracle) | `src/game/divine-actions-controller.ts` | on dispatch to an NPC target → `summarizeDivineAct` → `recordMemory` |

`tick` comes from `state.clock.now()`. `beliefDelta`/`moodDelta` for salience come from the LLM response (LLM paths) or the action's applied delta (divine paths).

### Read sites (feed prompts)

| File | Change |
|---|---|
| `src/game/llm-backfill.ts` | build `previousInteractions` via `selectMemoriesForPrompt(npcProps.memories ?? [], 6)` instead of `[]` |
| `src/llm/npc-prompt-builder.ts` | `buildInteractionsSection` already consumes `previousInteractions`; no change beyond it now being non-empty. Remove its duplicate `createInteractionSummary`. |
| `src/llm/state-writeback.ts` | remove its duplicate `createInteractionSummary` |
| `src/llm/whisper-prompt-builder.ts` | keep the live session transcript (`recentTurns`) for in-conversation continuity; add a short "what they remember of you" section sourced from persistent memory for long-term recall |

The two `createInteractionSummary` call sites in tests (`tests/unit/llm-prompt-builder.test.ts`, `tests/unit/llm-state-writeback.test.ts`) are re-pointed to import `distillInteraction` from `interaction-memory` (kept behavior-equivalent so existing assertions hold).

---

## Testing

**Unit — `tests/unit/interaction-memory.test.ts`:**
- `distillInteraction` produces the expected one-liner for dialogue / belief / mood / empty responses (port the existing `createInteractionSummary` assertions).
- `computeSalience` is deterministic and ordered: miracle > answer > whisper for equal deltas; larger belief delta → higher salience; result clamped to [0,1].
- `recordMemory` bounds at `MEMORY_MAX`; when over, evicts the lowest-salience entry (oldest as tiebreak); a high-salience landmark survives many subsequent low-salience inserts.
- `selectMemoriesForPrompt` returns ≤ maxCount, always includes the top-salience landmark, fills with most-recent, output chronological.

**Integration:**
- A backfill records exactly one memory; a *second* backfill's prompt context includes the first (i.e. `previousInteractions` non-empty).
- A whisper records a memory after dialogue fill.
- A divine act (answer prayer) records a high-salience (`>= 0.6`) memory.
- Snapshot round-trip preserves `memories` (capture → mutate → restore → original memories back).
- An old snapshot/save with no `memories` field restores without throwing and yields `[]`.

---

## Out of scope (explicitly deferred)

- **Conversation UI** — surfacing memory/transcript in the NPC panel (the sibling Track 2 item). Memory-only this round; presentation decided later.
- LLM-based compression of old memories (the salience ring is the bounding mechanism; no second compression layer — YAGNI).
- Rivals reading/writing NPC memory of *other* spirits (Track 3 concern). The `summary`/`kind` model is per-interaction and spirit-agnostic in shape, but this slice only records the player's interactions.

## File summary

**New:**
- `src/llm/interaction-memory.ts`
- `tests/unit/interaction-memory.test.ts`

**Modified:**
- `src/core/types.ts` (add `memories?` to `NpcProperties`)
- `src/game/llm-backfill.ts` (read + write)
- `src/game/whisper-orchestrator.ts` (write)
- `src/game/divine-actions-controller.ts` (write)
- `src/llm/npc-prompt-builder.ts` (remove duplicate `createInteractionSummary`)
- `src/llm/state-writeback.ts` (remove duplicate `createInteractionSummary`)
- `src/llm/whisper-prompt-builder.ts` (add persistent-memory section)
- `tests/unit/llm-prompt-builder.test.ts`, `tests/unit/llm-state-writeback.test.ts` (re-point to `distillInteraction`)
