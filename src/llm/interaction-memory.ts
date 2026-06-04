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
